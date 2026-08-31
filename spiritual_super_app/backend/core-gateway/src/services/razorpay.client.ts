import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';
import { Prisma, money } from '../lib/prisma.js';

export class PaymentsNotConfiguredError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Wallet top-up is not configured on this environment');
    this.name = 'PaymentsNotConfiguredError';
  }
}

export class PaymentProviderError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export interface RazorpayOrder {
  readonly id: string;
  readonly amountInPaise: number;
  readonly currency: string;
}

export function paymentsConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
}

/**
 * Rupees -> integer paise. Razorpay works exclusively in the minor unit, and doing this with
 * JavaScript numbers is how rounding drift gets into a ledger, so it goes through Decimal.
 * `money` already quantises to 2dp, making the integer check a belt-and-braces guard against a
 * future caller bypassing it.
 */
export function toPaise(amount: Prisma.Decimal | string): number {
  const paise = money(amount).mul(100);
  if (!paise.isInteger()) {
    throw new Error(`Amount ${money(amount).toFixed(4)} is finer than one paise`);
  }
  return paise.toNumber();
}

export function fromPaise(paise: number): Prisma.Decimal {
  return money(new Prisma.Decimal(paise).div(100));
}

export const RazorpayClient = {
  async createOrder(input: {
    amount: Prisma.Decimal | string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOrder> {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new PaymentsNotConfiguredError();
    }

    const credentials = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(`${env.RAZORPAY_API_BASE}/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({
          amount: toPaise(input.amount),
          currency: 'INR',
          receipt: input.receipt,
          // Razorpay auto-captures so we never hold an authorised-but-uncaptured payment.
          payment_capture: 1,
          ...(input.notes ? { notes: input.notes } : {}),
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new PaymentProviderError(
          `Razorpay order creation failed: ${response.status} ${text.slice(0, 300)}`,
        );
      }

      const parsed = JSON.parse(text) as { id?: string; amount?: number; currency?: string };
      if (!parsed.id || typeof parsed.amount !== 'number') {
        throw new PaymentProviderError('Razorpay returned an order without an id or amount');
      }

      return { id: parsed.id, amountInPaise: parsed.amount, currency: parsed.currency ?? 'INR' };
    } catch (error) {
      if (error instanceof PaymentProviderError || error instanceof PaymentsNotConfiguredError) {
        throw error;
      }
      throw new PaymentProviderError(
        error instanceof Error ? `Razorpay request failed: ${error.message}` : 'Razorpay request failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * Verifies the webhook HMAC over the EXACT raw request body. Re-serialising the parsed JSON would
   * change byte order or spacing and break the signature, which is why the route keeps the raw buffer.
   */
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) {
      return false;
    }
    const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
  },
} as const;
