import {
  AstrologerStatus,
  JoinRequestStatus,
  type Prisma,
  type ProviderKycStatus,
  type ProviderPayoutStatus,
  type ProviderCategory,
} from '@prisma/client';

import { logger } from '../lib/logger.js';
import { Prisma as PrismaValues, money, prisma } from '../lib/prisma.js';
import { cleanTags } from './astrologer-directory.js';
import {
  COMMITTED_PAYOUT_STATUSES,
  describeDestination,
  effectiveAccountStatus,
  mapRazorpayPayoutStatus,
  maskAccountNumber,
  pendingPayout,
  readSchedule,
  toAmount,
  changePct,
  type PayoutAccountInput,
  type WeeklySchedule,
} from './provider-admin-rules.js';
import { QueueService } from './queue.service.js';
import { PayoutRejectedError, RazorpayXClient, payoutsConfigured } from './razorpayx.client.js';

export class ProviderAdminError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'ProviderAdminError';
    this.statusCode = statusCode;
  }
}

export interface StaffActor {
  userId: string;
}

const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  ASTROLOGER: 'Astrologer',
  NUMEROLOGIST: 'Numerologist',
  VASTU_EXPERT: 'Vastu Expert',
  AYURVEDA_EXPERT: 'Ayurveda Expert',
  PANDIT: 'Pandit',
  SPIRITUAL_GUIDE: 'Spiritual Guide',
  OTHER: 'Other',
};

const PROVIDER_SELECT = {
  id: true,
  displayName: true,
  category: true,
  status: true,
  languages: true,
  expertise: true,
  services: true,
  experienceYears: true,
  perMinuteRate: true,
  commissionSplit: true,
  photoUpdatedAt: true,
  accountStatus: true,
  suspendedAt: true,
  suspensionReason: true,
  deboardReason: true,
  deboardEffectiveAt: true,
  kycStatus: true,
  identityVerified: true,
  profileApproved: true,
  weeklySchedule: true,
  createdAt: true,
  user: { select: { id: true, phone: true, name: true, email: true } },
} satisfies Prisma.AstrologerSelect;

type ProviderRow = Prisma.AstrologerGetPayload<{ select: typeof PROVIDER_SELECT }>;

function monthStart(now: Date, offset = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/** Sums keyed by provider id, so a list of N providers costs a fixed number of queries. */
async function aggregatesFor(ids: readonly string[], now: Date) {
  const where = { astrologerId: { in: [...ids] } };
  const [earned, earnedMonth, sessions, ratings, committed, joins] = await Promise.all([
    prisma.astrologerEarning.groupBy({ by: ['astrologerId'], where, _sum: { netAmount: true, grossAmount: true } }),
    prisma.astrologerEarning.groupBy({
      by: ['astrologerId'],
      where: { ...where, createdAt: { gte: monthStart(now) } },
      _sum: { netAmount: true },
    }),
    prisma.callSession.groupBy({ by: ['astrologerId'], where: { ...where, totalMinutes: { gt: 0 } }, _count: { _all: true } }),
    prisma.providerReview.groupBy({ by: ['astrologerId'], where: { ...where, hidden: false }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.providerPayout.groupBy({
      by: ['astrologerId'],
      where: { ...where, status: { in: [...COMMITTED_PAYOUT_STATUSES] } },
      _sum: { amount: true },
    }),
    prisma.providerJoinRequest.findMany({
      where: { providerAstrologerId: { in: [...ids] } },
      select: { id: true, applicationNo: true, city: true, state: true, providerAstrologerId: true },
    }),
  ]);
  const byId = <T extends { astrologerId: string }>(rows: T[]) => new Map(rows.map((row) => [row.astrologerId, row]));
  return {
    earned: byId(earned),
    earnedMonth: byId(earnedMonth),
    sessions: byId(sessions),
    ratings: byId(ratings),
    committed: byId(committed),
    joins: new Map(joins.map((row) => [row.providerAstrologerId!, row])),
  };
}

type Aggregates = Awaited<ReturnType<typeof aggregatesFor>>;

function toItem(row: ProviderRow, agg: Aggregates, now: Date) {
  const earned = agg.earned.get(row.id)?._sum.netAmount ?? null;
  const committed = agg.committed.get(row.id)?._sum.amount ?? null;
  const rating = agg.ratings.get(row.id);
  const join = agg.joins.get(row.id);
  const schedule = readSchedule(row.weeklySchedule);
  return {
    id: row.id,
    code: `VDP${row.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    displayName: row.displayName,
    photoVersion: row.photoUpdatedAt?.getTime() ?? null,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category],
    presence: row.status,
    accountStatus: effectiveAccountStatus(row, now),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    deboardReason: row.deboardReason,
    deboardEffectiveAt: row.deboardEffectiveAt?.toISOString() ?? null,
    kycStatus: row.kycStatus,
    identityVerified: row.identityVerified,
    profileApproved: row.profileApproved,
    languages: row.languages,
    expertise: row.expertise,
    services: row.services,
    experienceYears: row.experienceYears,
    perMinuteRate: money(row.perMinuteRate).toFixed(2),
    commissionSplit: row.commissionSplit.toFixed(4),
    rating: rating?._avg.rating == null ? null : Math.round(Number(rating._avg.rating) * 10) / 10,
    ratingCount: rating?._count._all ?? 0,
    sessions: agg.sessions.get(row.id)?._count._all ?? 0,
    totalEarnings: toAmount(earned),
    monthEarnings: toAmount(agg.earnedMonth.get(row.id)?._sum.netAmount),
    grossRevenue: toAmount(agg.earned.get(row.id)?._sum.grossAmount),
    pendingPayout: pendingPayout(earned ?? 0, committed ?? 0).toFixed(2),
    availableDays: schedule ? Object.entries(schedule).filter(([, slots]) => slots.length > 0).map(([day]) => day) : [],
    phone: row.user.phone,
    email: row.user.email,
    location: join ? [join.city, join.state].filter(Boolean).join(', ') : null,
    joinRequest: join ? { id: join.id, applicationNo: join.applicationNo } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ProviderListItem = ReturnType<typeof toItem>;

async function kpis(now: Date) {
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(now, -1);
  const [total, totalBefore, online, pendingKyc, joinOpen, joinNew, paidThis, paidLast] = await Promise.all([
    prisma.astrologer.count(),
    prisma.astrologer.count({ where: { createdAt: { lt: thisMonth } } }),
    prisma.astrologer.count({ where: { status: { not: AstrologerStatus.OFFLINE }, accountStatus: { in: ['ACTIVE', 'DEBOARDING'] } } }),
    prisma.astrologer.count({ where: { kycStatus: 'PENDING', accountStatus: { not: 'DEBOARDED' } } }),
    prisma.providerJoinRequest.count({
      where: { status: { in: [JoinRequestStatus.PENDING, JoinRequestStatus.UNDER_REVIEW, JoinRequestStatus.MORE_INFO_REQUESTED] } },
    }),
    prisma.providerJoinRequest.count({ where: { createdAt: { gte: thisMonth } } }),
    prisma.providerPayout.aggregate({ where: { status: 'PROCESSED', processedAt: { gte: thisMonth } }, _sum: { amount: true } }),
    prisma.providerPayout.aggregate({ where: { status: 'PROCESSED', processedAt: { gte: lastMonth, lt: thisMonth } }, _sum: { amount: true } }),
  ]);
  const paid = Number(paidThis._sum.amount ?? 0);
  return {
    totalProviders: { value: total, changePct: changePct(total, totalBefore) },
    onlineNow: { value: online },
    pendingKyc: { value: pendingKyc },
    joinRequests: { value: joinOpen, newThisMonth: joinNew },
    payoutThisMonth: { value: toAmount(paidThis._sum.amount), changePct: changePct(paid, Number(paidLast._sum.amount ?? 0)) },
  };
}

/** Moves the stored status of deboardings that have reached their date, and takes them offline. */
async function finalizeDueDeboardings(now: Date): Promise<void> {
  const due = await prisma.astrologer.findMany({
    where: { accountStatus: 'DEBOARDING', deboardEffectiveAt: { lte: now } },
    select: { id: true, status: true },
  });
  for (const row of due) {
    await prisma.astrologer.update({ where: { id: row.id }, data: { accountStatus: 'DEBOARDED' } });
    await takeOffline(row.id, row.status);
  }
}

/** Never interrupts a live call; queued users are released either way. */
async function takeOffline(id: string, status: AstrologerStatus): Promise<void> {
  try {
    if (status === AstrologerStatus.IDLE) {
      await QueueService.setAstrologerPresence(id, 'OFFLINE');
    } else if (status !== AstrologerStatus.OFFLINE) {
      await QueueService.drainQueue(id, 'ASTROLOGER_WENT_OFFLINE');
    }
  } catch (error) {
    logger.warn({ err: error, astrologerId: id }, 'Could not take provider offline');
  }
}

async function loadRow(id: string): Promise<ProviderRow> {
  const row = await prisma.astrologer.findUnique({ where: { id }, select: PROVIDER_SELECT });
  if (!row) throw new ProviderAdminError('Provider not found', 404);
  return row;
}

async function itemFor(id: string, now = new Date()): Promise<ProviderListItem> {
  const row = await loadRow(id);
  return toItem(row, await aggregatesFor([id], now), now);
}

export interface ProviderUpdate {
  displayName?: string | undefined;
  category?: ProviderCategory | undefined;
  bio?: string | null | undefined;
  languages?: string[] | undefined;
  expertise?: string[] | undefined;
  services?: string[] | undefined;
  experienceYears?: number | null | undefined;
  perMinuteRate?: string | undefined;
  commissionSplit?: string | undefined;
  weeklySchedule?: WeeklySchedule | null | undefined;
  kycStatus?: ProviderKycStatus | undefined;
  identityVerified?: boolean | undefined;
  profileApproved?: boolean | undefined;
  photoDataUrl?: string | null | undefined;
}

export interface ManualPayoutInput {
  method: 'MANUAL';
  amount: string;
  reference: string;
  mode: string;
  paidOn: Date;
  note?: string | undefined;
}

export interface RazorpayPayoutInput {
  method: 'RAZORPAYX';
  amount: string;
  note?: string | undefined;
}

function payoutView(row: {
  id: string;
  amount: Prisma.Decimal;
  method: string;
  status: ProviderPayoutStatus;
  mode: string | null;
  razorpayPayoutId: string | null;
  reference: string | null;
  failureReason: string | null;
  note: string | null;
  destination: string | null;
  processedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    amount: toAmount(row.amount),
    method: row.method,
    status: row.status,
    mode: row.mode,
    razorpayPayoutId: row.razorpayPayoutId,
    reference: row.reference,
    failureReason: row.failureReason,
    note: row.note,
    destination: row.destination,
    processedAt: row.processedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const ProviderAdminService = {
  async list() {
    const now = new Date();
    await finalizeDueDeboardings(now);
    const rows = await prisma.astrologer.findMany({ orderBy: { createdAt: 'desc' }, take: 500, select: PROVIDER_SELECT });
    const agg = await aggregatesFor(
      rows.map((row) => row.id),
      now,
    );
    return { kpis: await kpis(now), payoutsEnabled: payoutsConfigured(), items: rows.map((row) => toItem(row, agg, now)) };
  },

  async detail(id: string) {
    const now = new Date();
    const [item, extra, reviews, sessions, history] = await Promise.all([
      itemFor(id, now),
      prisma.astrologer.findUnique({ where: { id }, select: { bio: true, weeklySchedule: true } }),
      prisma.providerReview.findMany({
        where: { astrologerId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, rating: true, comment: true, hidden: true, createdAt: true, user: { select: { name: true } } },
      }),
      prisma.callSession.findMany({
        where: { astrologerId: id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, status: true, totalMinutes: true, totalDeducted: true, createdAt: true, user: { select: { name: true } } },
      }),
      prisma.auditLog.findMany({
        where: { entityId: id, entityType: { in: ['provider', 'astrologers'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, action: true, summary: true, actorPhone: true, actorRole: true, metadata: true, createdAt: true },
      }),
    ]);
    const files = item.joinRequest
      ? await prisma.joinRequestFile.findMany({
          where: { requestId: item.joinRequest.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, kind: true, label: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
        })
      : [];
    return {
      ...item,
      bio: extra?.bio ?? null,
      weeklySchedule: readSchedule(extra?.weeklySchedule),
      documents: files.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })),
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        hidden: review.hidden,
        userName: review.user.name,
        createdAt: review.createdAt.toISOString(),
      })),
      recentSessions: sessions.map((session) => ({
        id: session.id,
        status: session.status,
        minutes: session.totalMinutes,
        amount: toAmount(session.totalDeducted),
        userName: session.user.name,
        createdAt: session.createdAt.toISOString(),
      })),
      history: history.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    };
  },

  async update(id: string, body: ProviderUpdate) {
    const existing = await loadRow(id);
    const data: Prisma.AstrologerUpdateInput = {
      ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.bio !== undefined ? { bio: body.bio?.trim() || null } : {}),
      ...(body.languages !== undefined ? { languages: cleanTags(body.languages) } : {}),
      ...(body.expertise !== undefined ? { expertise: cleanTags(body.expertise) } : {}),
      ...(body.services !== undefined ? { services: cleanTags(body.services) } : {}),
      ...(body.experienceYears !== undefined ? { experienceYears: body.experienceYears } : {}),
      ...(body.perMinuteRate !== undefined ? { perMinuteRate: money(body.perMinuteRate) } : {}),
      ...(body.commissionSplit !== undefined ? { commissionSplit: body.commissionSplit } : {}),
      ...(body.weeklySchedule !== undefined
        ? { weeklySchedule: body.weeklySchedule === null ? PrismaValues.DbNull : (body.weeklySchedule as Prisma.InputJsonValue) }
        : {}),
      ...(body.kycStatus !== undefined ? { kycStatus: body.kycStatus } : {}),
      ...(body.identityVerified !== undefined ? { identityVerified: body.identityVerified } : {}),
      ...(body.profileApproved !== undefined ? { profileApproved: body.profileApproved } : {}),
      ...(body.photoDataUrl !== undefined
        ? { photoDataUrl: body.photoDataUrl, photoUpdatedAt: body.photoDataUrl ? new Date() : null }
        : {}),
    };
    if (body.languages !== undefined && cleanTags(body.languages).length === 0) {
      throw new ProviderAdminError('Add at least one language', 400);
    }
    await prisma.astrologer.update({ where: { id }, data });
    const changed = Object.keys(body).filter((key) => body[key as keyof ProviderUpdate] !== undefined);
    return { item: await itemFor(id), changed, before: { displayName: existing.displayName } };
  },

  async suspend(id: string, reason: string) {
    const row = await loadRow(id);
    const status = effectiveAccountStatus(row);
    if (status === 'SUSPENDED') throw new ProviderAdminError('Provider is already suspended');
    if (status === 'DEBOARDED') throw new ProviderAdminError('A deboarded provider cannot be suspended');
    await prisma.astrologer.update({
      where: { id },
      data: { accountStatus: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason },
    });
    await takeOffline(id, row.status);
    return { item: await itemFor(id), from: status };
  },

  async reinstate(id: string) {
    const row = await loadRow(id);
    const status = effectiveAccountStatus(row);
    if (status === 'ACTIVE') throw new ProviderAdminError('Provider is already active');
    await prisma.astrologer.update({
      where: { id },
      data: {
        accountStatus: 'ACTIVE',
        suspendedAt: null,
        suspensionReason: null,
        deboardReason: null,
        deboardNotes: null,
        deboardEffectiveAt: null,
        deboardRequestedAt: null,
      },
    });
    return { item: await itemFor(id), from: status };
  },

  async deboard(id: string, input: { reason: string; effectiveDate: Date; notes?: string | undefined }) {
    const row = await loadRow(id);
    const status = effectiveAccountStatus(row);
    if (status === 'DEBOARDED') throw new ProviderAdminError('Provider is already deboarded');
    const now = new Date();
    const immediate = input.effectiveDate <= now;
    await prisma.astrologer.update({
      where: { id },
      data: {
        accountStatus: immediate ? 'DEBOARDED' : 'DEBOARDING',
        deboardReason: input.reason,
        deboardNotes: input.notes?.trim() || null,
        deboardEffectiveAt: input.effectiveDate,
        deboardRequestedAt: now,
      },
    });
    if (immediate) await takeOffline(id, row.status);
    return { item: await itemFor(id), from: status, immediate };
  },

  /** Only for providers with no money or call history; everyone else is deboarded instead. */
  async remove(id: string) {
    const row = await loadRow(id);
    const [sessions, payouts] = await Promise.all([
      prisma.callSession.count({ where: { astrologerId: id } }),
      prisma.providerPayout.count({ where: { astrologerId: id } }),
    ]);
    if (sessions > 0 || payouts > 0) {
      throw new ProviderAdminError(
        'This provider has consultation or payout history, which must be kept. Deboard them instead to remove them from the website.',
      );
    }
    if (row.status === AstrologerStatus.BUSY || row.status === AstrologerStatus.IN_CALL) {
      throw new ProviderAdminError('Provider is in a call; try again when they are free');
    }
    await takeOffline(id, row.status);
    await prisma.$transaction([
      prisma.providerJoinRequest.updateMany({ where: { providerAstrologerId: id }, data: { providerAstrologerId: null } }),
      prisma.astrologer.delete({ where: { id } }),
    ]);
    return { displayName: row.displayName, phone: row.user.phone };
  },

  async setReviewHidden(astrologerId: string, reviewId: string, hidden: boolean) {
    const review = await prisma.providerReview.findFirst({ where: { id: reviewId, astrologerId }, select: { id: true } });
    if (!review) throw new ProviderAdminError('Review not found', 404);
    await prisma.providerReview.update({ where: { id: reviewId }, data: { hidden } });
    return { id: reviewId, hidden };
  },

  // --- Payouts -----------------------------------------------------------------------------------

  async payouts(id: string) {
    const now = new Date();
    await loadRow(id);
    const [earned, earnedMonth, committed, processed, account, history] = await Promise.all([
      prisma.astrologerEarning.aggregate({ where: { astrologerId: id }, _sum: { netAmount: true } }),
      prisma.astrologerEarning.aggregate({ where: { astrologerId: id, createdAt: { gte: monthStart(now) } }, _sum: { netAmount: true } }),
      prisma.providerPayout.aggregate({ where: { astrologerId: id, status: { in: [...COMMITTED_PAYOUT_STATUSES] } }, _sum: { amount: true } }),
      prisma.providerPayout.aggregate({ where: { astrologerId: id, status: 'PROCESSED' }, _sum: { amount: true } }),
      prisma.providerPayoutAccount.findUnique({ where: { astrologerId: id } }),
      prisma.providerPayout.findMany({ where: { astrologerId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return {
      payoutsEnabled: payoutsConfigured(),
      totalEarnings: toAmount(earned._sum.netAmount),
      monthEarnings: toAmount(earnedMonth._sum.netAmount),
      paidOut: toAmount(processed._sum.amount),
      inFlight: money(committed._sum.amount ?? 0).minus(money(processed._sum.amount ?? 0)).toFixed(2),
      pendingPayout: pendingPayout(earned._sum.netAmount ?? 0, committed._sum.amount ?? 0).toFixed(2),
      account: account
        ? {
            accountType: account.accountType,
            accountName: account.accountName,
            accountNumberMasked: account.accountNumber ? maskAccountNumber(account.accountNumber) : null,
            ifsc: account.ifsc,
            vpa: account.vpa,
            destination: describeDestination(account),
            updatedAt: account.updatedAt.toISOString(),
          }
        : null,
      history: history.map(payoutView),
    };
  },

  async savePayoutAccount(id: string, input: PayoutAccountInput, actor: StaffActor) {
    await loadRow(id);
    const fields = {
      accountType: input.accountType,
      accountName: input.accountName,
      accountNumber: input.accountType === 'BANK' ? input.accountNumber : null,
      ifsc: input.accountType === 'BANK' ? input.ifsc : null,
      vpa: input.accountType === 'UPI' ? input.vpa : null,
      // New details need a new RazorpayX fund account; the contact stays.
      razorpayFundAccountId: null,
      updatedBy: actor.userId,
    };
    await prisma.providerPayoutAccount.upsert({
      where: { astrologerId: id },
      create: { astrologerId: id, ...fields },
      update: fields,
    });
    return describeDestination(fields);
  },

  async createPayout(id: string, input: ManualPayoutInput | RazorpayPayoutInput, actor: StaffActor) {
    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) throw new ProviderAdminError('Amount must be more than zero', 400);
    const row = await loadRow(id);
    const account = await prisma.providerPayoutAccount.findUnique({ where: { astrologerId: id } });
    if (input.method === 'RAZORPAYX') {
      if (!payoutsConfigured()) throw new ProviderAdminError('RazorpayX payouts are not configured on this server', 503);
      if (!account) throw new ProviderAdminError('Add the provider’s bank account or UPI ID before paying out', 400);
    }
    if (input.method === 'MANUAL' && input.paidOn > new Date()) {
      throw new ProviderAdminError('The paid-on date cannot be in the future', 400);
    }

    // The row lock serialises payouts per provider, so two admins cannot both pay the same balance.
    const payout = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM astrologers WHERE id = ${id}::uuid FOR UPDATE`;
      const [earned, committed] = await Promise.all([
        tx.astrologerEarning.aggregate({ where: { astrologerId: id }, _sum: { netAmount: true } }),
        tx.providerPayout.aggregate({ where: { astrologerId: id, status: { in: [...COMMITTED_PAYOUT_STATUSES] } }, _sum: { amount: true } }),
      ]);
      const pending = pendingPayout(earned._sum.netAmount ?? 0, committed._sum.amount ?? 0);
      if (amount.greaterThan(pending)) {
        throw new ProviderAdminError(`Amount exceeds the pending payout of ₹${pending.toFixed(2)}`, 400);
      }
      return tx.providerPayout.create({
        data:
          input.method === 'MANUAL'
            ? {
                astrologerId: id,
                amount,
                method: 'MANUAL',
                status: 'PROCESSED',
                mode: input.mode,
                reference: input.reference,
                note: input.note ?? null,
                destination: account ? describeDestination(account) : null,
                processedAt: input.paidOn,
                createdBy: actor.userId,
              }
            : {
                astrologerId: id,
                amount,
                method: 'RAZORPAYX',
                status: 'PROCESSING',
                mode: account!.accountType === 'UPI' ? 'UPI' : amount.greaterThan(500_000) ? 'NEFT' : 'IMPS',
                note: input.note ?? null,
                destination: describeDestination(account!),
                createdBy: actor.userId,
              },
      });
    });

    if (input.method === 'RAZORPAYX') {
      return { payout: await this.dispatch(payout.id, row.displayName), displayName: row.displayName };
    }
    return { payout: payoutView(payout), displayName: row.displayName };
  },

  /** Sends (or safely re-sends, thanks to the idempotency key) a RazorpayX payout row. */
  async dispatch(payoutId: string, displayName: string) {
    const payout = await prisma.providerPayout.findUniqueOrThrow({ where: { id: payoutId } });
    const account = await prisma.providerPayoutAccount.findUnique({ where: { astrologerId: payout.astrologerId } });
    if (!account) throw new ProviderAdminError('Payout account missing', 400);
    try {
      let contactId = account.razorpayContactId;
      if (!contactId) {
        const owner = await prisma.astrologer.findUniqueOrThrow({
          where: { id: payout.astrologerId },
          select: { user: { select: { phone: true, email: true } } },
        });
        contactId = await RazorpayXClient.createContact({
          name: account.accountName,
          phone: owner.user.phone,
          email: owner.user.email,
          referenceId: payout.astrologerId,
        });
        await prisma.providerPayoutAccount.update({ where: { astrologerId: payout.astrologerId }, data: { razorpayContactId: contactId } });
      }
      let fundAccountId = account.razorpayFundAccountId;
      if (!fundAccountId) {
        fundAccountId = await RazorpayXClient.createFundAccount(contactId, account);
        await prisma.providerPayoutAccount.update({ where: { astrologerId: payout.astrologerId }, data: { razorpayFundAccountId: fundAccountId } });
      }
      const result = await RazorpayXClient.createPayout({
        fundAccountId,
        amount: payout.amount,
        mode: (payout.mode as 'IMPS' | 'NEFT' | 'UPI') ?? 'IMPS',
        referenceId: payout.id,
        narration: `Vedsutra ${displayName}`,
        idempotencyKey: payout.id,
      });
      const status = mapRazorpayPayoutStatus(result.status) ?? 'PROCESSING';
      const updated = await prisma.providerPayout.update({
        where: { id: payout.id },
        data: {
          razorpayPayoutId: result.id,
          status,
          reference: result.utr,
          failureReason: result.failureReason,
          ...(status === 'PROCESSED' ? { processedAt: new Date() } : {}),
        },
      });
      return payoutView(updated);
    } catch (error) {
      if (error instanceof PayoutRejectedError) {
        const failed = await prisma.providerPayout.update({
          where: { id: payout.id },
          data: { status: 'FAILED', failureReason: error.message.slice(0, 500) },
        });
        return payoutView(failed);
      }
      // Unknown outcome (timeout / 5xx): keep it committed so it is not paid twice; Refresh retries safely.
      const pending = await prisma.providerPayout.update({
        where: { id: payout.id },
        data: { failureReason: 'Awaiting confirmation from RazorpayX. Use “Refresh status” to retry safely.' },
      });
      logger.error({ err: error, payoutId: payout.id }, 'RazorpayX payout outcome unknown');
      return payoutView(pending);
    }
  },

  async refreshPayout(astrologerId: string, payoutId: string) {
    const payout = await prisma.providerPayout.findFirst({ where: { id: payoutId, astrologerId } });
    if (!payout) throw new ProviderAdminError('Payout not found', 404);
    if (payout.method !== 'RAZORPAYX') return payoutView(payout);
    if (!payout.razorpayPayoutId) {
      if (payout.status !== 'PROCESSING') return payoutView(payout);
      const owner = await prisma.astrologer.findUniqueOrThrow({ where: { id: astrologerId }, select: { displayName: true } });
      return this.dispatch(payout.id, owner.displayName);
    }
    const remote = await RazorpayXClient.fetchPayout(payout.razorpayPayoutId);
    return payoutView(await applyRemoteStatus(payout.id, remote.status, remote.utr, remote.failureReason));
  },

  /** RazorpayX webhook (payout.*). Unknown payouts are ignored. */
  async applyWebhook(input: { razorpayPayoutId: string; status: string; utr: string | null; failureReason: string | null }) {
    const payout = await prisma.providerPayout.findUnique({ where: { razorpayPayoutId: input.razorpayPayoutId }, select: { id: true } });
    if (!payout) return { action: 'ignored' as const, reason: 'unknown_payout' };
    const updated = await applyRemoteStatus(payout.id, input.status, input.utr, input.failureReason);
    return { action: 'updated' as const, status: updated.status };
  },
};

async function applyRemoteStatus(payoutId: string, remoteStatus: string, utr: string | null, failureReason: string | null) {
  const status = mapRazorpayPayoutStatus(remoteStatus);
  const current = await prisma.providerPayout.findUniqueOrThrow({ where: { id: payoutId } });
  if (!status) return current;
  return prisma.providerPayout.update({
    where: { id: payoutId },
    data: {
      status,
      ...(utr ? { reference: utr } : {}),
      failureReason: status === 'FAILED' || status === 'REVERSED' || status === 'REJECTED' ? failureReason : null,
      ...(status === 'PROCESSED' && !current.processedAt ? { processedAt: new Date() } : {}),
    },
  });
}
