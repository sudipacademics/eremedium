import { ReferenceType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { Prisma, prisma } from '../src/lib/prisma.js';
import { InsufficientFundsError, WalletNotFoundError, WalletService } from '../src/services/wallet.service.js';
import { balanceOf, seedUser } from './helpers/factories.js';

const callRef = (id: string) => ({
  referenceType: ReferenceType.CALL_SESSION,
  referenceId: id,
});

describe('WalletService debits', () => {
  it('moves the balance by exactly the amount charged and records the resulting balance', async () => {
    const { userId } = await seedUser('100.00');

    const movement = await WalletService.debitByUserId(userId, { amount: '20.00', ...callRef('s1') });

    expect(movement.balanceBefore.toFixed(2)).toBe('100.00');
    expect(movement.balanceAfter.toFixed(2)).toBe('80.00');
    expect(await balanceOf(userId)).toBe('80.00');

    const ledger = await prisma.walletTransaction.findMany({ where: { referenceId: 's1' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount.toFixed(2)).toBe('20.00');
    expect(ledger[0]!.balanceAfter.toFixed(2)).toBe('80.00');
  });

  it('refuses a debit larger than the balance and leaves the wallet untouched', async () => {
    const { userId } = await seedUser('15.00');

    await expect(
      WalletService.debitByUserId(userId, { amount: '20.00', ...callRef('s1') }),
    ).rejects.toThrow(InsufficientFundsError);

    expect(await balanceOf(userId)).toBe('15.00');
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  it('allows a debit that empties the wallet exactly', async () => {
    const { userId } = await seedUser('20.00');

    const movement = await WalletService.debitByUserId(userId, { amount: '20.00', ...callRef('s1') });

    expect(movement.balanceAfter.toFixed(2)).toBe('0.00');
    expect(await balanceOf(userId)).toBe('0.00');
  });

  it('rejects a zero or negative amount rather than writing a meaningless ledger row', async () => {
    const { userId } = await seedUser('100.00');

    await expect(
      WalletService.debitByUserId(userId, { amount: '0.00', ...callRef('s1') }),
    ).rejects.toThrow(/strictly positive/);
    await expect(
      WalletService.debitByUserId(userId, { amount: '-5.00', ...callRef('s1') }),
    ).rejects.toThrow(/strictly positive/);

    expect(await balanceOf(userId)).toBe('100.00');
  });

  it('reports a missing wallet instead of silently succeeding', async () => {
    await expect(
      WalletService.debitByUserId('00000000-0000-0000-0000-000000000000', {
        amount: '5.00',
        ...callRef('s1'),
      }),
    ).rejects.toThrow(WalletNotFoundError);
  });
});

describe('WalletService idempotency', () => {
  it('charges once when the same debit is replayed, which is what makes a retried tick safe', async () => {
    const { userId } = await seedUser('100.00');
    const input = { amount: '20.00', ...callRef('s1'), idempotencyKey: 'call:s1:minute:1' };

    const first = await WalletService.debitByUserId(userId, input);
    const replay = await WalletService.debitByUserId(userId, input);

    expect(await balanceOf(userId)).toBe('80.00');
    expect(await prisma.walletTransaction.count()).toBe(1);
    // The replay must report the original movement, not a fabricated one.
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.balanceAfter.toFixed(2)).toBe('80.00');
  });

  it('reconstructs balanceBefore correctly for a replayed credit as well as a debit', async () => {
    const { userId } = await seedUser('50.00');

    const credit = await WalletService.creditByUserId(userId, {
      amount: '30.00',
      referenceType: ReferenceType.RECHARGE,
      referenceId: 'order-1',
      idempotencyKey: 'topup:order-1',
    });
    const replay = await WalletService.creditByUserId(userId, {
      amount: '30.00',
      referenceType: ReferenceType.RECHARGE,
      referenceId: 'order-1',
      idempotencyKey: 'topup:order-1',
    });

    expect(credit.balanceAfter.toFixed(2)).toBe('80.00');
    expect(replay.balanceBefore.toFixed(2)).toBe('50.00');
    expect(replay.balanceAfter.toFixed(2)).toBe('80.00');
    expect(await balanceOf(userId)).toBe('80.00');
  });

  it('treats distinct keys for the same reference as distinct minutes', async () => {
    const { userId } = await seedUser('100.00');

    await WalletService.debitByUserId(userId, {
      amount: '20.00',
      ...callRef('s1'),
      idempotencyKey: 'call:s1:minute:1',
    });
    await WalletService.debitByUserId(userId, {
      amount: '20.00',
      ...callRef('s1'),
      idempotencyKey: 'call:s1:minute:2',
    });

    expect(await balanceOf(userId)).toBe('60.00');
    expect(await prisma.walletTransaction.count()).toBe(2);
  });
});

describe('WalletService under concurrency', () => {
  /**
   * The row lock is the whole point of debitByUserId. Two simultaneous debits against a balance that
   * only covers one must not both succeed: without SELECT ... FOR UPDATE both would read 20.00,
   * both would consider themselves solvent, and the wallet would end up negative.
   */
  it('serialises simultaneous debits so the balance cannot go negative', async () => {
    const { userId } = await seedUser('20.00');

    const results = await Promise.allSettled([
      WalletService.debitByUserId(userId, { amount: '20.00', ...callRef('a') }),
      WalletService.debitByUserId(userId, { amount: '20.00', ...callRef('b') }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(await balanceOf(userId)).toBe('0.00');
  });

  it('keeps the ledger consistent with the balance across many sequential debits', async () => {
    const { userId } = await seedUser('100.00');

    for (let minute = 1; minute <= 5; minute += 1) {
      await WalletService.debitByUserId(userId, {
        amount: '20.00',
        ...callRef('s1'),
        idempotencyKey: `call:s1:minute:${minute}`,
      });
    }

    const debited = await prisma.walletTransaction.aggregate({
      where: { referenceId: 's1' },
      _sum: { amount: true },
    });

    expect(debited._sum.amount?.toFixed(2)).toBe('100.00');
    expect(await balanceOf(userId)).toBe('0.00');
    await expect(
      WalletService.debitByUserId(userId, { amount: '20.00', ...callRef('s1') }),
    ).rejects.toThrow(InsufficientFundsError);
  });
});

describe('money handling', () => {
  it('never lets a fractional rate drift the ledger away from the balance', async () => {
    const { userId } = await seedUser('10.00');

    // 3 x 3.33 = 9.99, so the wallet must hold exactly 0.01 afterwards.
    for (let i = 1; i <= 3; i += 1) {
      await WalletService.debitByUserId(userId, {
        amount: '3.33',
        ...callRef('s1'),
        idempotencyKey: `k${i}`,
      });
    }

    expect(await balanceOf(userId)).toBe('0.01');
    const sum = await prisma.walletTransaction.aggregate({ _sum: { amount: true } });
    expect(sum._sum.amount?.toFixed(2)).toBe('9.99');
  });

  it('stores amounts as decimals, so a value unrepresentable in binary floating point survives', async () => {
    const { userId } = await seedUser('0.30');

    await WalletService.debitByUserId(userId, { amount: '0.10', ...callRef('s1') });
    await WalletService.debitByUserId(userId, { amount: '0.20', ...callRef('s2') });

    expect(await balanceOf(userId)).toBe('0.00');
    // The float equivalent, 0.3 - 0.1 - 0.2, is -2.7e-17 rather than 0.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balance).toBeInstanceOf(Prisma.Decimal);
    expect(wallet.balance.equals(new Prisma.Decimal(0))).toBe(true);
  });
});
