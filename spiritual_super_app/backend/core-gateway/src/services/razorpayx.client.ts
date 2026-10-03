import { env } from '../config/env.js';
import { Prisma } from '../lib/prisma.js';
import { PaymentProviderError, toPaise } from './razorpay.client.js';

export class PayoutsNotConfiguredError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('RazorpayX payouts are not configured: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAYX_ACCOUNT_NUMBER');
    this.name = 'PayoutsNotConfiguredError';
  }
}

/** Razorpay refused the request (4xx): retrying the same input will not succeed. */
export class PayoutRejectedError extends Error {
  readonly statusCode = 422;

  constructor(message: string) {
    super(message);
    this.name = 'PayoutRejectedError';
  }
}

export function payoutsConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAYX_ACCOUNT_NUMBER);
}

export interface RazorpayPayout {
  readonly id: string;
  readonly status: string;
  readonly utr: string | null;
  readonly failureReason: string | null;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (!payoutsConfigured()) throw new PayoutsNotConfiguredError();
  const credentials = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${env.RAZORPAY_API_BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Basic ${credentials}`, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let description = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { description?: string } };
        if (parsed.error?.description) description = parsed.error.description;
      } catch {
        // keep the raw text
      }
      if (response.status >= 400 && response.status < 500) throw new PayoutRejectedError(`RazorpayX: ${description}`);
      throw new PaymentProviderError(`RazorpayX ${response.status}: ${description}`);
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof PayoutRejectedError || error instanceof PaymentProviderError || error instanceof PayoutsNotConfiguredError) throw error;
    throw new PaymentProviderError(error instanceof Error ? `RazorpayX request failed: ${error.message}` : 'RazorpayX request failed');
  } finally {
    clearTimeout(timeout);
  }
}

interface RawPayout {
  id: string;
  status: string;
  utr?: string | null;
  failure_reason?: string | null;
  status_details?: { description?: string | null } | null;
}

function toPayout(raw: RawPayout): RazorpayPayout {
  return {
    id: raw.id,
    status: raw.status,
    utr: raw.utr ?? null,
    failureReason: raw.failure_reason ?? raw.status_details?.description ?? null,
  };
}

/** Narration appears on the beneficiary's statement: max 30 chars, letters, digits and spaces only. */
export function payoutNarration(text: string): string {
  return text.replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) || 'Vedsutra payout';
}

export const RazorpayXClient = {
  async createContact(input: { name: string; phone: string; email: string | null; referenceId: string }): Promise<string> {
    const contact = await call<{ id: string }>('POST', '/contacts', {
      name: input.name.slice(0, 50),
      contact: input.phone.replace(/\D/g, '').slice(-10),
      ...(input.email ? { email: input.email } : {}),
      type: 'vendor',
      reference_id: input.referenceId.slice(0, 40),
    });
    return contact.id;
  },

  async createFundAccount(
    contactId: string,
    account: { accountType: string; accountName: string; accountNumber: string | null; ifsc: string | null; vpa: string | null },
  ): Promise<string> {
    const body =
      account.accountType === 'UPI'
        ? { contact_id: contactId, account_type: 'vpa', vpa: { address: account.vpa } }
        : {
            contact_id: contactId,
            account_type: 'bank_account',
            bank_account: { name: account.accountName, ifsc: account.ifsc, account_number: account.accountNumber },
          };
    const fundAccount = await call<{ id: string }>('POST', '/fund_accounts', body);
    return fundAccount.id;
  },

  /** The idempotency key makes a retried request return the original payout instead of paying twice. */
  async createPayout(input: {
    fundAccountId: string;
    amount: Prisma.Decimal;
    mode: 'IMPS' | 'NEFT' | 'UPI';
    referenceId: string;
    narration: string;
    idempotencyKey: string;
  }): Promise<RazorpayPayout> {
    const raw = await call<RawPayout>(
      'POST',
      '/payouts',
      {
        account_number: env.RAZORPAYX_ACCOUNT_NUMBER,
        fund_account_id: input.fundAccountId,
        amount: toPaise(input.amount),
        currency: 'INR',
        mode: input.mode,
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: input.referenceId.slice(0, 40),
        narration: payoutNarration(input.narration),
      },
      { 'X-Payout-Idempotency': input.idempotencyKey },
    );
    return toPayout(raw);
  },

  async fetchPayout(payoutId: string): Promise<RazorpayPayout> {
    return toPayout(await call<RawPayout>('GET', `/payouts/${encodeURIComponent(payoutId)}`));
  },
} as const;
