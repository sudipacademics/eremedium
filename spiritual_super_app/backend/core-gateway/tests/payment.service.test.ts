import { PaymentOrderStatus, PaymentProvider } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { PaymentService } from '../src/services/payment.service.js';
import { balanceOf, seedUser } from './helpers/factories.js';

async function seedOrder(userId: string, amount: string, providerOrderId: string): Promise<string> {
  const order = await prisma.paymentOrder.create({
    data: {
      userId,
      provider: PaymentProvider.RAZORPAY,
      providerOrderId,
      amount,
      currency: 'INR',
      status: PaymentOrderStatus.CREATED,
    },
    select: { id: true },
  });
  return order.id;
}

describe('crediting a wallet from a captured payment', () => {
  it('credits the recorded amount and links the payment to the ledger entry', async () => {
    const { userId } = await seedUser('0.00');
    const orderId = await seedOrder(userId, '500.00', 'order_1');

    const outcome = await PaymentService.handleCapturedPayment({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountInPaise: 50_000,
    });

    expect(outcome).toMatchObject({ handled: true, action: 'credited' });
    expect(await balanceOf(userId)).toBe('500.00');

    const order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(PaymentOrderStatus.PAID);
    expect(order.providerPaymentId).toBe('pay_1');
    expect(order.paidAt).not.toBeNull();
    // The two-way link is what makes the money auditable in both directions.
    expect(order.walletTransactionId).not.toBeNull();
  });

  it('credits once when the provider delivers the same webhook twice', async () => {
    const { userId } = await seedUser('0.00');
    await seedOrder(userId, '500.00', 'order_1');
    const payload = {
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountInPaise: 50_000,
    };

    await PaymentService.handleCapturedPayment(payload);
    const replay = await PaymentService.handleCapturedPayment(payload);

    expect(replay).toMatchObject({ action: 'replayed' });
    expect(await balanceOf(userId)).toBe('500.00');
    expect(await prisma.walletTransaction.count()).toBe(1);
  });

  it('credits once when two deliveries of the same payment arrive simultaneously', async () => {
    const { userId } = await seedUser('0.00');
    await seedOrder(userId, '500.00', 'order_1');
    const payload = {
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountInPaise: 50_000,
    };

    await Promise.allSettled([
      PaymentService.handleCapturedPayment(payload),
      PaymentService.handleCapturedPayment(payload),
    ]);

    expect(await balanceOf(userId)).toBe('500.00');
    expect(await prisma.walletTransaction.count()).toBe(1);
  });
});

describe('refusing to credit the wrong amount', () => {
  /**
   * The webhook body is attacker-influenced in a way the stored order is not. Trusting the amount it
   * reports would let a 1 rupee payment credit a 10,000 rupee wallet.
   */
  it('marks the order failed instead of crediting when the amount does not match', async () => {
    const { userId } = await seedUser('0.00');
    const orderId = await seedOrder(userId, '500.00', 'order_1');

    const outcome = await PaymentService.handleCapturedPayment({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountInPaise: 100,
    });

    expect(outcome).toMatchObject({ action: 'marked_failed', reason: 'amount_mismatch' });
    expect(await balanceOf(userId)).toBe('0.00');
    expect(await prisma.walletTransaction.count()).toBe(0);

    const order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(PaymentOrderStatus.FAILED);
    expect(order.failureReason).toMatch(/Amount mismatch/);
  });

  it('does not credit an order it has never heard of', async () => {
    const { userId } = await seedUser('0.00');

    const outcome = await PaymentService.handleCapturedPayment({
      providerOrderId: 'order_belonging_to_someone_else',
      providerPaymentId: 'pay_1',
      amountInPaise: 50_000,
    });

    expect(outcome).toMatchObject({ handled: false, reason: 'unknown_order' });
    expect(await balanceOf(userId)).toBe('0.00');
  });

  it('never credits twice when a second, different payment hits a paid order', async () => {
    const { userId } = await seedUser('0.00');
    await seedOrder(userId, '500.00', 'order_1');

    await PaymentService.handleCapturedPayment({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountInPaise: 50_000,
    });
    const second = await PaymentService.handleCapturedPayment({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_2_different',
      amountInPaise: 50_000,
    });

    expect(second).toMatchObject({ action: 'ignored', reason: 'order_already_paid' });
    expect(await balanceOf(userId)).toBe('500.00');
    expect(await prisma.walletTransaction.count()).toBe(1);
  });
});

describe('failure notices', () => {
  it('marks an unpaid order failed', async () => {
    const { userId } = await seedUser('0.00');
    const orderId = await seedOrder(userId, '500.00', 'order_1');

    const outcome = await PaymentService.handleFailedPayment({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      reason: 'card declined',
    });

    expect(outcome).toMatchObject({ action: 'marked_failed' });
    const order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(PaymentOrderStatus.FAILED);
    expect(await balanceOf(userId)).toBe('0.00');
  });

  /** A late failure notice for a captured payment must not claw back money already credited. */
  it('leaves a paid order and its credit alone', async () => {
    const { userId } = await seedUser('0.00');
    const orderId = await seedOrder(userId, '500.00', 'order_1');
    await PaymentService.handleCapturedPayment({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountInPaise: 50_000,
    });

    const outcome = await PaymentService.handleFailedPayment({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      reason: 'late failure notice',
    });

    expect(outcome).toMatchObject({ action: 'ignored', reason: 'already_paid' });
    const order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(PaymentOrderStatus.PAID);
    expect(await balanceOf(userId)).toBe('500.00');
  });
});
