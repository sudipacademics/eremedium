import { ReferenceType, TransactionType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { describeTransaction } from '../src/services/wallet-describe-rules.js';

const lookups = {
  calls: new Map([['c1', { astrologer: 'Dr. Meera Sharma', expertise: 'Vedic' }]]),
  pujas: new Map([['p1', 'Mahalakshmi Puja']]),
  orders: new Map([['o1', 'Crystal Healing Set']]),
};

describe('describeTransaction', () => {
  it('names each kind of ledger row from what it references', () => {
    expect(describeTransaction({ type: TransactionType.DEBIT, referenceType: ReferenceType.CALL_SESSION, referenceId: 'c1' }, lookups)).toEqual({
      title: 'Consultation payment',
      detail: 'Dr. Meera Sharma (Vedic)',
    });
    expect(describeTransaction({ type: TransactionType.DEBIT, referenceType: ReferenceType.PUJA_BOOKING, referenceId: 'p1' }, lookups)).toEqual({
      title: 'E-Puja booking',
      detail: 'Mahalakshmi Puja',
    });
    expect(describeTransaction({ type: TransactionType.DEBIT, referenceType: ReferenceType.AYURVEDA_ORDER, referenceId: 'o1' }, lookups)).toEqual({
      title: 'Product purchase',
      detail: 'Crystal Healing Set',
    });
    expect(describeTransaction({ type: TransactionType.CREDIT, referenceType: ReferenceType.RECHARGE, referenceId: 'pay_1' }, lookups)).toEqual({
      title: 'Wallet top up',
      detail: 'Razorpay',
    });
  });

  it('labels refunds as credits and leaves the detail empty when the record is gone', () => {
    expect(describeTransaction({ type: TransactionType.CREDIT, referenceType: ReferenceType.PUJA_BOOKING, referenceId: 'missing' }, lookups)).toEqual({
      title: 'E-Puja refund',
      detail: null,
    });
  });
});
