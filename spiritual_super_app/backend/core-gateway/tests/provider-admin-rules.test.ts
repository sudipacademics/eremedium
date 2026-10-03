import { describe, expect, it } from 'vitest';

import {
  changePct,
  describeDestination,
  effectiveAccountStatus,
  isPubliclyListable,
  mapRazorpayPayoutStatus,
  payoutAccountSchema,
  pendingPayout,
  readSchedule,
  weeklyScheduleSchema,
} from '../src/services/provider-admin-rules.js';

const now = new Date('2026-10-04T06:00:00Z');

describe('provider lifecycle', () => {
  it('treats a deboarding as deboarded once its effective date has passed', () => {
    expect(effectiveAccountStatus({ accountStatus: 'DEBOARDING', deboardEffectiveAt: new Date('2026-10-03T18:30:00Z') }, now)).toBe('DEBOARDED');
    expect(effectiveAccountStatus({ accountStatus: 'DEBOARDING', deboardEffectiveAt: new Date('2026-10-10T00:00:00Z') }, now)).toBe('DEBOARDING');
  });

  it('lists only active providers and deboardings still in their notice period', () => {
    expect(isPubliclyListable({ accountStatus: 'ACTIVE', deboardEffectiveAt: null }, now)).toBe(true);
    expect(isPubliclyListable({ accountStatus: 'DEBOARDING', deboardEffectiveAt: new Date('2026-10-10T00:00:00Z') }, now)).toBe(true);
    expect(isPubliclyListable({ accountStatus: 'DEBOARDING', deboardEffectiveAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe(false);
    expect(isPubliclyListable({ accountStatus: 'SUSPENDED', deboardEffectiveAt: null }, now)).toBe(false);
    expect(isPubliclyListable({ accountStatus: 'DEBOARDED', deboardEffectiveAt: null }, now)).toBe(false);
  });
});

describe('weekly schedule', () => {
  it('fills missing days and accepts non-overlapping slots', () => {
    const schedule = weeklyScheduleSchema.parse({ mon: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] });
    expect(schedule.mon).toHaveLength(2);
    expect(schedule.sun).toEqual([]);
  });

  it('rejects overlapping or inverted slots and unknown days', () => {
    expect(weeklyScheduleSchema.safeParse({ mon: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }).success).toBe(false);
    expect(weeklyScheduleSchema.safeParse({ tue: [{ start: '18:00', end: '09:00' }] }).success).toBe(false);
    expect(weeklyScheduleSchema.safeParse({ funday: [] }).success).toBe(false);
  });

  it('ignores corrupt stored JSON instead of throwing', () => {
    expect(readSchedule({ mon: 'always' })).toBeNull();
    expect(readSchedule(null)).toBeNull();
  });
});

describe('payout maths', () => {
  it('never reports a negative pending payout', () => {
    expect(pendingPayout('1500.50', '500').toFixed(2)).toBe('1000.50');
    expect(pendingPayout('100', '250').toFixed(2)).toBe('0.00');
  });

  it('maps RazorpayX statuses and ignores unknown ones', () => {
    expect(mapRazorpayPayoutStatus('processed')).toBe('PROCESSED');
    expect(mapRazorpayPayoutStatus('Reversed')).toBe('REVERSED');
    expect(mapRazorpayPayoutStatus('mystery')).toBeNull();
  });

  it('masks bank accounts in the destination label', () => {
    expect(describeDestination({ accountType: 'BANK', accountNumber: '123456789012', ifsc: 'HDFC0001234', vpa: null })).toBe('HDFC ••••9012');
    expect(describeDestination({ accountType: 'UPI', accountNumber: null, ifsc: null, vpa: 'guru@okhdfc' })).toBe('guru@okhdfc');
  });

  it('validates payout account details', () => {
    expect(payoutAccountSchema.parse({ accountType: 'BANK', accountName: 'Pt. Sharma', accountNumber: '123456789', ifsc: 'hdfc0001234' })).toMatchObject({
      ifsc: 'HDFC0001234',
    });
    expect(payoutAccountSchema.safeParse({ accountType: 'BANK', accountName: 'Pt. Sharma', accountNumber: '12', ifsc: 'HDFC0001234' }).success).toBe(false);
    expect(payoutAccountSchema.safeParse({ accountType: 'UPI', accountName: 'Pt. Sharma', vpa: 'not-a-vpa' }).success).toBe(false);
  });

  it('computes change against a baseline only when there is one', () => {
    expect(changePct(112, 100)).toBe(12);
    expect(changePct(5, 0)).toBeNull();
  });
});
