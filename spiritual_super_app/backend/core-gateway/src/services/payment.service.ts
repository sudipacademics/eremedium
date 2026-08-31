import { PaymentOrderStatus, PaymentProvider, ReferenceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Prisma, money, prisma, type PrismaTransaction } from '../lib/prisma.js';
import {
  PaymentsNotConfiguredError,
  RazorpayClient,
  paymentsConfigured,
  toPaise,
} from './razorpay.client.js';
import { WalletService } from './wallet.service.js';

export class TopUpAmountError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'TopUpAmountError';
  }
}

export interface CreatedTopUp {
  readonly paymentOrderId: string;
  readonly providerOrderId: string;
  readonly amount: string;
  readonly currency: string;
  readonly razorpayKeyId: string;
}

export type WebhookOutcome =
  | { readonly handled: true; readonly action: 'credited'; readonly transactionId: string }
  | { readonly handled: true; readonly action: 'replayed' | 'marked_failed' | 'ignored'; readonly reason?: string }
  | { readonly handled: false; readonly reason: string };

interface LockedOrderRow {
  id: string;
  user_id: string;
  amount: Prisma.Decimal;
  status: PaymentOrderStatus;
  provider_payment_id: string | null;
}

async function lockOrderByProviderOrderId(
  tx: PrismaTransaction,
  providerOrderId: string,
): Promise<LockedOrderRow | null> {
  const rows = await tx.$queryRaw<LockedOrderRow[]>`
    SELECT "id", "user_id", "amount", "status", "provider_payment_id"
    FROM "payment_orders"
    WHERE "provider_order_id" = ${providerOrderId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export const PaymentService = {
  /**
   * Records our intent to accept money. Creates the provider order first: persisting a row for an
   * order the provider rejected would leave permanent CREATED garbage in the audit trail.
   */
  async createTopUpOrder(userId: string, amount: string): Promise<CreatedTopUp> {
    if (!paymentsConfigured() || !env.RAZORPAY_KEY_ID) {
      throw new PaymentsNotConfiguredError();
    }

    const requested = money(amount);
    if (requested.lessThan(money(env.TOPUP_MIN_AMOUNT))) {
      throw new TopUpAmountError(`Minimum top-up is ${money(env.TOPUP_MIN_AMOUNT).toFixed(2)}`);
    }
    if (requested.greaterThan(money(env.TOPUP_MAX_AMOUNT))) {
      throw new TopUpAmountError(`Maximum top-up is ${money(env.TOPUP_MAX_AMOUNT).toFixed(2)}`);
    }

    // Wallet existence is checked up front: a paid webhook that cannot find a wallet is far worse
    // than a rejected order.
    await WalletService.getBalanceByUserId(userId);

    const receipt = `ssa-topup-${randomUUID()}`;
    const order = await RazorpayClient.createOrder({
      amount: requested,
      receipt,
      notes: { userId },
    });

    const created = await prisma.paymentOrder.create({
      data: {
        userId,
        provider: PaymentProvider.RAZORPAY,
        providerOrderId: order.id,
        amount: requested,
        currency: order.currency,
        status: PaymentOrderStatus.CREATED,
      },
      select: { id: true },
    });

    logger.info(
      { userId, paymentOrderId: created.id, providerOrderId: order.id, amount: requested.toFixed(2) },
      'Top-up order created',
    );

    return {
      paymentOrderId: created.id,
      providerOrderId: order.id,
      amount: requested.toFixed(2),
      currency: order.currency,
      razorpayKeyId: env.RAZORPAY_KEY_ID,
    };
  },

  /**
   * The ONLY path that credits a wallet from an external payment.
   *
   * Runs entirely inside one transaction that locks the payment order row, so two concurrent
   * webhook deliveries for the same payment serialise instead of both crediting.
   */
  async handleCapturedPayment(input: {
    providerOrderId: string;
    providerPaymentId: string;
    amountInPaise: number;
  }): Promise<WebhookOutcome> {
    return prisma.$transaction(
      async (tx) => {
        const order = await lockOrderByProviderOrderId(tx, input.providerOrderId);
        if (!order) {
          // Not ours: a webhook for an order created by another system sharing this Razorpay account.
          return { handled: false, reason: 'unknown_order' } as const;
        }

        if (order.status === PaymentOrderStatus.PAID) {
          if (order.provider_payment_id === input.providerPaymentId) {
            return { handled: true, action: 'replayed' } as const;
          }
          // A second, different payment against an already-paid order. Never credit twice; this
          // needs a human to reconcile a likely refund case.
          logger.error(
            {
              providerOrderId: input.providerOrderId,
              existingPaymentId: order.provider_payment_id,
              incomingPaymentId: input.providerPaymentId,
            },
            'Second distinct payment for an already-paid order; not crediting',
          );
          return { handled: true, action: 'ignored', reason: 'order_already_paid' } as const;
        }

        // Trust the amount we recorded at order time, not the amount in the webhook body.
        const expectedPaise = toPaise(money(order.amount));
        if (input.amountInPaise !== expectedPaise) {
          await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
              status: PaymentOrderStatus.FAILED,
              providerPaymentId: input.providerPaymentId,
              failureReason: `Amount mismatch: expected ${expectedPaise} paise, webhook reported ${input.amountInPaise}`,
            },
          });
          logger.error(
            { providerOrderId: input.providerOrderId, expectedPaise, received: input.amountInPaise },
            'Top-up amount mismatch; marked FAILED without crediting',
          );
          return { handled: true, action: 'marked_failed', reason: 'amount_mismatch' } as const;
        }

        const movement = await WalletService.creditByUserId(
          order.user_id,
          {
            amount: money(order.amount),
            referenceType: ReferenceType.RECHARGE,
            referenceId: input.providerPaymentId,
            // Second, independent replay guard: unique in wallet_transactions.
            idempotencyKey: `razorpay:${input.providerPaymentId}`,
          },
          tx,
        );

        await tx.paymentOrder.update({
          where: { id: order.id },
          data: {
            status: PaymentOrderStatus.PAID,
            providerPaymentId: input.providerPaymentId,
            walletTransactionId: movement.transactionId,
            paidAt: new Date(),
          },
        });

        logger.info(
          {
            userId: order.user_id,
            providerPaymentId: input.providerPaymentId,
            credited: movement.amount.toFixed(2),
            balanceAfter: movement.balanceAfter.toFixed(2),
          },
          'Wallet credited from verified payment webhook',
        );

        return { handled: true, action: 'credited', transactionId: movement.transactionId } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  },

  async handleFailedPayment(input: {
    providerOrderId: string;
    providerPaymentId: string;
    reason: string;
  }): Promise<WebhookOutcome> {
    return prisma.$transaction(async (tx) => {
      const order = await lockOrderByProviderOrderId(tx, input.providerOrderId);
      if (!order) {
        return { handled: false, reason: 'unknown_order' } as const;
      }
      // A failure notice must never undo a captured payment.
      if (order.status === PaymentOrderStatus.PAID) {
        return { handled: true, action: 'ignored', reason: 'already_paid' } as const;
      }
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: PaymentOrderStatus.FAILED,
          providerPaymentId: input.providerPaymentId,
          failureReason: input.reason.slice(0, 300),
        },
      });
      return { handled: true, action: 'marked_failed' } as const;
    });
  },
} as const;
