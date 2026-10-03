import { ReferenceType, TransactionType } from '@prisma/client';

export interface DescribableTransaction {
  readonly type: TransactionType;
  readonly referenceType: ReferenceType;
  readonly referenceId: string;
}

export interface TransactionDescription {
  readonly title: string;
  readonly detail: string | null;
}

export interface TransactionLookups {
  readonly calls: ReadonlyMap<string, { astrologer: string; expertise: string | null }>;
  readonly pujas: ReadonlyMap<string, string>;
  readonly orders: ReadonlyMap<string, string>;
}

/** The human label for one ledger row given what its reference points at. */
export function describeTransaction(row: DescribableTransaction, lookups: TransactionLookups): TransactionDescription {
  const credit = row.type === TransactionType.CREDIT;
  switch (row.referenceType) {
    case ReferenceType.RECHARGE:
      return { title: 'Wallet top up', detail: 'Razorpay' };
    case ReferenceType.CALL_SESSION: {
      const call = lookups.calls.get(row.referenceId);
      const detail = call ? (call.expertise ? `${call.astrologer} (${call.expertise})` : call.astrologer) : null;
      return { title: credit ? 'Consultation refund' : 'Consultation payment', detail };
    }
    case ReferenceType.PUJA_BOOKING:
      return { title: credit ? 'E-Puja refund' : 'E-Puja booking', detail: lookups.pujas.get(row.referenceId) ?? null };
    case ReferenceType.AYURVEDA_ORDER:
      return { title: credit ? 'Order refund' : 'Product purchase', detail: lookups.orders.get(row.referenceId) ?? null };
    default:
      return { title: credit ? 'Credit' : 'Debit', detail: null };
  }
}
