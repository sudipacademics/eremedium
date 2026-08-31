import { ReferenceType, TransactionType } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { Prisma, money, prisma, type PrismaTransaction } from '../lib/prisma.js';

export class InsufficientFundsError extends Error {
  readonly statusCode = 402;

  constructor(
    readonly walletId: string,
    readonly required: Prisma.Decimal,
    readonly available: Prisma.Decimal,
  ) {
    super(
      `Insufficient wallet balance: required ${required.toFixed(2)}, available ${available.toFixed(2)}`,
    );
    this.name = 'InsufficientFundsError';
  }
}

export class WalletNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(identifier: string) {
    super(`Wallet not found for ${identifier}`);
    this.name = 'WalletNotFoundError';
  }
}

interface LockedWalletRow {
  id: string;
  user_id: string;
  balance: Prisma.Decimal;
  currency: string;
}

export interface LedgerMovement {
  readonly walletId: string;
  readonly userId: string;
  readonly transactionId: string;
  readonly amount: Prisma.Decimal;
  readonly balanceBefore: Prisma.Decimal;
  readonly balanceAfter: Prisma.Decimal;
  readonly currency: string;
}

export interface MutationInput {
  readonly amount: Prisma.Decimal | string;
  readonly referenceType: ReferenceType;
  readonly referenceId: string;
  /** Supplying a key makes the movement replay-safe (e.g. a retried billing tick). */
  readonly idempotencyKey?: string;
}

/**
 * Locks the wallet row for the remainder of the surrounding transaction.
 * MUST be called inside `prisma.$transaction` — enforced by requiring the transaction client.
 */
async function lockWalletByUserId(tx: PrismaTransaction, userId: string): Promise<LockedWalletRow> {
  const rows = await tx.$queryRaw<LockedWalletRow[]>`
    SELECT "id", "user_id", "balance", "currency"
    FROM "wallets"
    WHERE "user_id" = ${userId}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new WalletNotFoundError(`user ${userId}`);
  }
  return row;
}

async function lockWalletById(tx: PrismaTransaction, walletId: string): Promise<LockedWalletRow> {
  const rows = await tx.$queryRaw<LockedWalletRow[]>`
    SELECT "id", "user_id", "balance", "currency"
    FROM "wallets"
    WHERE "id" = ${walletId}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new WalletNotFoundError(`wallet ${walletId}`);
  }
  return row;
}

async function findExistingMovement(
  tx: PrismaTransaction,
  idempotencyKey: string,
): Promise<LedgerMovement | null> {
  const existing = await tx.walletTransaction.findUnique({
    where: { idempotencyKey },
    include: { wallet: { select: { userId: true, currency: true } } },
  });
  if (!existing) {
    return null;
  }
  const balanceAfter = money(existing.balanceAfter);
  const amount = money(existing.amount);
  return {
    walletId: existing.walletId,
    userId: existing.wallet.userId,
    transactionId: existing.id,
    amount,
    balanceBefore:
      existing.type === TransactionType.DEBIT ? balanceAfter.plus(amount) : balanceAfter.minus(amount),
    balanceAfter,
    currency: existing.wallet.currency,
  };
}

async function applyMovement(
  tx: PrismaTransaction,
  wallet: LockedWalletRow,
  type: TransactionType,
  input: MutationInput,
): Promise<LedgerMovement> {
  const amount = money(input.amount);
  if (amount.lessThanOrEqualTo(0)) {
    throw new Error('Ledger amount must be strictly positive');
  }

  const balanceBefore = money(wallet.balance);
  if (type === TransactionType.DEBIT && balanceBefore.lessThan(amount)) {
    throw new InsufficientFundsError(wallet.id, amount, balanceBefore);
  }

  const balanceAfter =
    type === TransactionType.DEBIT ? money(balanceBefore.minus(amount)) : money(balanceBefore.plus(amount));

  await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: balanceAfter },
  });

  const ledgerEntry = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      amount,
      type,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      balanceAfter,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    },
    select: { id: true },
  });

  return {
    walletId: wallet.id,
    userId: wallet.user_id,
    transactionId: ledgerEntry.id,
    amount,
    balanceBefore,
    balanceAfter,
    currency: wallet.currency,
  };
}

export const WalletService = {
  /** Read-only snapshot; never use this value as the basis for a write. */
  async getBalanceByUserId(userId: string): Promise<{ walletId: string; balance: Prisma.Decimal; currency: string }> {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, balance: true, currency: true },
    });
    if (!wallet) {
      throw new WalletNotFoundError(`user ${userId}`);
    }
    return { walletId: wallet.id, balance: money(wallet.balance), currency: wallet.currency };
  },

  /**
   * BEGIN … SELECT FOR UPDATE … UPDATE … INSERT ledger … COMMIT.
   * `tx` may be supplied to enlist in a caller-owned transaction (e.g. the billing tick, which also
   * updates the CallSession totals atomically).
   */
  async debitByUserId(userId: string, input: MutationInput, tx?: PrismaTransaction): Promise<LedgerMovement> {
    const run = async (client: PrismaTransaction): Promise<LedgerMovement> => {
      if (input.idempotencyKey) {
        const replay = await findExistingMovement(client, input.idempotencyKey);
        if (replay) {
          logger.warn({ userId, idempotencyKey: input.idempotencyKey }, 'Replayed debit ignored');
          return replay;
        }
      }
      const wallet = await lockWalletByUserId(client, userId);
      return applyMovement(client, wallet, TransactionType.DEBIT, input);
    };

    return tx ? run(tx) : prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  },

  async creditByUserId(userId: string, input: MutationInput, tx?: PrismaTransaction): Promise<LedgerMovement> {
    const run = async (client: PrismaTransaction): Promise<LedgerMovement> => {
      if (input.idempotencyKey) {
        const replay = await findExistingMovement(client, input.idempotencyKey);
        if (replay) {
          logger.warn({ userId, idempotencyKey: input.idempotencyKey }, 'Replayed credit ignored');
          return replay;
        }
      }
      const wallet = await lockWalletByUserId(client, userId);
      return applyMovement(client, wallet, TransactionType.CREDIT, input);
    };

    return tx ? run(tx) : prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  },

  async debitByWalletId(walletId: string, input: MutationInput, tx?: PrismaTransaction): Promise<LedgerMovement> {
    const run = async (client: PrismaTransaction): Promise<LedgerMovement> => {
      const wallet = await lockWalletById(client, walletId);
      return applyMovement(client, wallet, TransactionType.DEBIT, input);
    };
    return tx ? run(tx) : prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  },

  /** Solvency gate used before minting RTC tokens and before every billing tick. */
  async hasSolvencyFor(userId: string, required: Prisma.Decimal | string): Promise<boolean> {
    const { balance } = await this.getBalanceByUserId(userId);
    return balance.greaterThanOrEqualTo(money(required));
  },

  async recharge(userId: string, amount: string, referenceId: string): Promise<LedgerMovement> {
    return this.creditByUserId(userId, {
      amount,
      referenceType: ReferenceType.RECHARGE,
      referenceId,
      idempotencyKey: `recharge:${referenceId}`,
    });
  },

  ReferenceType,
  TransactionType,
} as const;
