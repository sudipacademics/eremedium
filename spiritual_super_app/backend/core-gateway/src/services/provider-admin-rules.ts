import { Prisma, type ProviderAccountStatus, type ProviderPayoutStatus } from '@prisma/client';
import { z } from 'zod';

function money(value: Prisma.Decimal | string | number): Prisma.Decimal {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface LifecycleFields {
  readonly accountStatus: ProviderAccountStatus;
  readonly deboardEffectiveAt: Date | null;
}

/** A scheduled deboarding takes effect on its date without needing a job to flip the stored status. */
export function effectiveAccountStatus(row: LifecycleFields, now = new Date()): ProviderAccountStatus {
  if (row.accountStatus === 'DEBOARDING' && row.deboardEffectiveAt && row.deboardEffectiveAt <= now) {
    return 'DEBOARDED';
  }
  return row.accountStatus;
}

/** Bookable and shown on the public website. */
export function isPubliclyListable(row: LifecycleFields, now = new Date()): boolean {
  const status = effectiveAccountStatus(row, now);
  return status === 'ACTIVE' || status === 'DEBOARDING';
}

/** The Prisma equivalent of isPubliclyListable, for list queries. */
export function publicListableWhere(now = new Date()): Prisma.AstrologerWhereInput {
  return {
    OR: [
      { accountStatus: 'ACTIVE' },
      { accountStatus: 'DEBOARDING', OR: [{ deboardEffectiveAt: null }, { deboardEffectiveAt: { gt: now } }] },
    ],
  };
}

export const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const slotSchema = z
  .object({ start: z.string().regex(TIME, 'Use HH:mm'), end: z.string().regex(TIME, 'Use HH:mm') })
  .refine((slot) => slot.start < slot.end, 'A slot must end after it starts');

const daySchema = z
  .array(slotSchema)
  .max(4)
  .refine((slots) => {
    const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
    return sorted.every((slot, index) => index === 0 || sorted[index - 1]!.end <= slot.start);
  }, 'Slots on the same day must not overlap');

export const weeklyScheduleSchema = z.object(
  Object.fromEntries(SCHEDULE_DAYS.map((day) => [day, daySchema.default([])])) as Record<ScheduleDay, z.ZodDefault<typeof daySchema>>,
).strict();

export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

/** Stored JSON is re-validated on read so a hand-edited row cannot break the admin page. */
export function readSchedule(value: unknown): WeeklySchedule | null {
  if (value === null || value === undefined) return null;
  const parsed = weeklyScheduleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Statuses whose amount is already spoken for and must not be paid again. */
export const COMMITTED_PAYOUT_STATUSES: readonly ProviderPayoutStatus[] = ['PROCESSING', 'QUEUED', 'PENDING', 'PROCESSED'];

export function pendingPayout(earned: Prisma.Decimal | string | number, committed: Prisma.Decimal | string | number): Prisma.Decimal {
  const pending = money(earned).minus(money(committed));
  return pending.isNegative() ? money(0) : pending;
}

const RAZORPAY_STATUS: Record<string, ProviderPayoutStatus> = {
  queued: 'QUEUED',
  pending: 'PENDING',
  scheduled: 'PENDING',
  processing: 'PROCESSING',
  processed: 'PROCESSED',
  failed: 'FAILED',
  reversed: 'REVERSED',
  cancelled: 'CANCELLED',
  rejected: 'REJECTED',
};

export function mapRazorpayPayoutStatus(status: string): ProviderPayoutStatus | null {
  return RAZORPAY_STATUS[status.toLowerCase()] ?? null;
}

export function maskAccountNumber(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

export interface PayoutAccountShape {
  readonly accountType: string;
  readonly accountNumber: string | null;
  readonly ifsc: string | null;
  readonly vpa: string | null;
}

export function describeDestination(account: PayoutAccountShape): string {
  if (account.accountType === 'UPI') return account.vpa ?? 'UPI';
  return `${account.ifsc?.slice(0, 4) ?? 'Bank'} ${account.accountNumber ? maskAccountNumber(account.accountNumber) : ''}`.trim();
}

export const payoutAccountSchema = z.discriminatedUnion('accountType', [
  z.object({
    accountType: z.literal('BANK'),
    accountName: z.string().trim().min(3).max(120),
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
    ifsc: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234')),
  }),
  z.object({
    accountType: z.literal('UPI'),
    accountName: z.string().trim().min(3).max(120),
    vpa: z.string().trim().regex(/^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/, 'Enter a valid UPI ID, e.g. name@okhdfc'),
  }),
]);

export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>;

/** Percentage change, or null when there is no baseline to compare against. */
export function changePct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export const DEBOARD_REASONS = [
  'Provider requested to leave',
  'Policy or conduct violation',
  'Quality concerns',
  'Inactive for a long period',
  'KYC / verification failed',
  'Contract ended',
  'Other',
] as const;

/** The money columns of a payout row as a JSON-safe view. */
export function toAmount(value: Prisma.Decimal | null | undefined): string {
  return money(value ?? 0).toFixed(2);
}
