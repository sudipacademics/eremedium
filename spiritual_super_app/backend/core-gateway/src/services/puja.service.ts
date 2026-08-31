import { PujaBookingStatus, ReferenceType } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { Prisma, money, prisma } from '../lib/prisma.js';
import { hub } from '../ws/hub.js';
import { ServerEvent } from '../ws/protocol.js';
import { WalletService } from './wallet.service.js';

export class PujaError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'PujaError';
    this.statusCode = statusCode;
  }
}

export interface OfferingView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly price: string;
  readonly durationLabel: string | null;
  readonly prasadIncluded: string | null;
}

export interface TempleView {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly primaryDeity: string;
  readonly liveStreamUrl: string | null;
  readonly offerings: readonly OfferingView[];
}

export interface BookingView {
  readonly id: string;
  readonly status: PujaBookingStatus;
  readonly pujaName: string;
  readonly packagePrice: string;
  readonly templeId: string;
  readonly templeName: string;
  readonly templeLocation: string;
  readonly liveStreamUrl: string | null;
  readonly sankalpName: string;
  readonly sankalpGotra: string | null;
  readonly sankalpWish: string | null;
  readonly referredByAstrologerId: string | null;
  readonly scheduledFor: string | null;
  readonly performedAt: string | null;
  readonly videoProofUrl: string | null;
  readonly prasadAwb: string | null;
  readonly prasadCourier: string | null;
  readonly prasadDispatchedAt: string | null;
  readonly createdAt: string;
}

export interface BookingResult {
  readonly booking: BookingView;
  readonly amountDebited: string;
  readonly walletBalanceAfter: string;
}

const bookingInclude = {
  temple: { select: { id: true, name: true, location: true, liveStreamUrl: true } },
} as const;

type BookingRow = Prisma.PujaBookingGetPayload<{ include: typeof bookingInclude }>;

function toBookingView(row: BookingRow): BookingView {
  return {
    id: row.id,
    status: row.status,
    pujaName: row.pujaName,
    packagePrice: money(row.packagePrice).toFixed(2),
    templeId: row.temple.id,
    templeName: row.temple.name,
    templeLocation: row.temple.location,
    liveStreamUrl: row.temple.liveStreamUrl,
    sankalpName: row.sankalpName,
    sankalpGotra: row.sankalpGotra,
    sankalpWish: row.sankalpWish,
    referredByAstrologerId: row.referredByAstrologerId,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    performedAt: row.performedAt?.toISOString() ?? null,
    videoProofUrl: row.videoProofUrl,
    prasadAwb: row.prasadAwb,
    prasadCourier: row.prasadCourier,
    prasadDispatchedAt: row.prasadDispatchedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The fulfilment pipeline, in order.
 *
 * A devotee has paid for something that happens out of their sight, hundreds of kilometres away, so
 * the only thing they have is this status and the evidence attached to it. Transitions are therefore
 * one-way and explicit: nothing may skip a stage, and nothing may go backwards. The database
 * additionally refuses COMPLETED without video proof and PRASAD_DISPATCHED without a tracking
 * number, so a mistake here cannot turn into a false claim that a puja was performed.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<PujaBookingStatus, readonly PujaBookingStatus[]>> = {
  [PujaBookingStatus.CONFIRMED]: [PujaBookingStatus.IN_PROGRESS],
  [PujaBookingStatus.IN_PROGRESS]: [PujaBookingStatus.COMPLETED],
  [PujaBookingStatus.COMPLETED]: [PujaBookingStatus.PRASAD_DISPATCHED],
  [PujaBookingStatus.PRASAD_DISPATCHED]: [],
};

export interface BookInput {
  readonly userId: string;
  readonly offeringId: string;
  readonly sankalpName?: string | undefined;
  readonly sankalpGotra?: string | undefined;
  readonly sankalpWish?: string | undefined;
  /** Required: makes a retried request return the original booking rather than buying twice. */
  readonly idempotencyKey: string;
  readonly referredByAstrologerId?: string | undefined;
}

export const PujaService = {
  /** The public catalog: active temples with their active offerings. */
  async listTemples(): Promise<TempleView[]> {
    const temples = await prisma.temple.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        location: true,
        primaryDeity: true,
        liveStreamUrl: true,
        offerings: {
          where: { active: true },
          orderBy: { price: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            durationLabel: true,
            prasadIncluded: true,
          },
        },
      },
    });

    return temples.map((temple) => ({
      id: temple.id,
      name: temple.name,
      location: temple.location,
      primaryDeity: temple.primaryDeity,
      liveStreamUrl: temple.liveStreamUrl,
      offerings: temple.offerings.map((offering) => ({
        id: offering.id,
        name: offering.name,
        description: offering.description,
        price: money(offering.price).toFixed(2),
        durationLabel: offering.durationLabel,
        prasadIncluded: offering.prasadIncluded,
      })),
    }));
  },

  /**
   * Loads a bookable offering and its temple.
   *
   * Every price in this module comes from here. No caller may pass an amount: that was the previous
   * behaviour and it let the client decide what a devotee paid.
   */
  async requireBookableOffering(offeringId: string) {
    const offering = await prisma.pujaOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        name: true,
        price: true,
        active: true,
        temple: {
          select: { id: true, name: true, location: true, primaryDeity: true, liveStreamUrl: true, active: true },
        },
      },
    });
    if (!offering) {
      throw new PujaError(`Puja offering ${offeringId} not found`, 404);
    }
    if (!offering.active || !offering.temple.active) {
      throw new PujaError('This puja is no longer available for booking');
    }
    return offering;
  },

  /**
   * Books a puja and pays for it in one transaction.
   *
   * The booking row is created first so the wallet ledger can reference the booking it paid for;
   * either both land or neither does. An insufficient balance surfaces as the wallet's own 402.
   */
  async book(input: BookInput): Promise<BookingResult> {
    const replay = await prisma.pujaBooking.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: bookingInclude,
    });
    if (replay) {
      if (replay.userId !== input.userId) {
        throw new PujaError('Idempotency key already used by another account');
      }
      logger.warn({ bookingId: replay.id }, 'Replayed puja booking request ignored');
      const balance = await WalletService.getBalanceByUserId(input.userId);
      return {
        booking: toBookingView(replay),
        amountDebited: money(replay.packagePrice).toFixed(2),
        walletBalanceAfter: balance.balance.toFixed(2),
      };
    }

    const offering = await this.requireBookableOffering(input.offeringId);
    const price = money(offering.price);

    // The devotee names the sankalp, and it is often not their own name: pujas are routinely booked
    // for a parent or a child. Their profile is only the default.
    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { name: true, gotra: true },
    });

    const { booking, debit } = await prisma.$transaction(
      async (tx) => {
        const created = await tx.pujaBooking.create({
          data: {
            userId: input.userId,
            templeId: offering.temple.id,
            pujaOfferingId: offering.id,
            pujaName: offering.name,
            sankalpName: input.sankalpName?.trim() || profile.name,
            sankalpGotra: input.sankalpGotra?.trim() || profile.gotra,
            sankalpWish: input.sankalpWish?.trim() || null,
            packagePrice: price,
            status: PujaBookingStatus.CONFIRMED,
            idempotencyKey: input.idempotencyKey,
            ...(input.referredByAstrologerId === undefined
              ? {}
              : { referredByAstrologerId: input.referredByAstrologerId }),
          },
          include: bookingInclude,
        });

        const movement = await WalletService.debitByUserId(
          input.userId,
          {
            amount: price,
            referenceType: ReferenceType.PUJA_BOOKING,
            referenceId: created.id,
            idempotencyKey: `puja:${input.idempotencyKey}`,
          },
          tx,
        );

        return { booking: created, debit: movement };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
    );

    logger.info(
      {
        bookingId: booking.id,
        userId: input.userId,
        offeringId: offering.id,
        charged: price.toFixed(2),
      },
      'Puja booked and paid',
    );

    return {
      booking: toBookingView(booking),
      amountDebited: debit.amount.toFixed(2),
      walletBalanceAfter: debit.balanceAfter.toFixed(2),
    };
  },

  async listBookingsForUser(userId: string): Promise<BookingView[]> {
    const rows = await prisma.pujaBooking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: bookingInclude,
    });
    return rows.map(toBookingView);
  },

  /** Readable by the devotee who booked it; admins use the queue below. */
  async getBookingForUser(bookingId: string, userId: string): Promise<BookingView> {
    const row = await prisma.pujaBooking.findUnique({ where: { id: bookingId }, include: bookingInclude });
    if (!row) {
      throw new PujaError(`Booking ${bookingId} not found`, 404);
    }
    if (row.userId !== userId) {
      throw new PujaError('This booking belongs to another account', 403);
    }
    return toBookingView(row);
  },

  /** The fulfilment work queue: everything not yet dispatched, oldest first. */
  async listPendingFulfilment(): Promise<BookingView[]> {
    const rows = await prisma.pujaBooking.findMany({
      where: { status: { not: PujaBookingStatus.PRASAD_DISPATCHED } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: bookingInclude,
    });
    return rows.map(toBookingView);
  },

  /** Records the date the temple will perform the puja. Does not change status. */
  async schedule(bookingId: string, scheduledFor: Date): Promise<BookingView> {
    const existing = await prisma.pujaBooking.findUnique({
      where: { id: bookingId },
      select: { status: true },
    });
    if (!existing) {
      throw new PujaError(`Booking ${bookingId} not found`, 404);
    }
    if (existing.status !== PujaBookingStatus.CONFIRMED) {
      throw new PujaError(`Cannot schedule a booking that is ${existing.status}`);
    }
    const row = await prisma.pujaBooking.update({
      where: { id: bookingId },
      data: { scheduledFor },
      include: bookingInclude,
    });
    await this.notify(row);
    return toBookingView(row);
  },

  /**
   * Advances the fulfilment pipeline by exactly one stage.
   *
   * Evidence is required at the stages that make a claim to the devotee, and the transition table
   * refuses anything out of order, so a booking cannot be marked delivered without ever having been
   * performed.
   */
  async advance(
    bookingId: string,
    to: PujaBookingStatus,
    evidence: { videoProofUrl?: string | undefined; prasadAwb?: string | undefined; prasadCourier?: string | undefined },
  ): Promise<BookingView> {
    const existing = await prisma.pujaBooking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new PujaError(`Booking ${bookingId} not found`, 404);
    }
    if (existing.status === to) {
      throw new PujaError(`Booking is already ${to}`);
    }
    if (!ALLOWED_TRANSITIONS[existing.status].includes(to)) {
      throw new PujaError(
        `Cannot move a booking from ${existing.status} to ${to}; ` +
          `the next stage is ${ALLOWED_TRANSITIONS[existing.status][0] ?? 'none, it is complete'}`,
      );
    }

    const data: Prisma.PujaBookingUpdateInput = { status: to };

    if (to === PujaBookingStatus.COMPLETED) {
      if (!evidence.videoProofUrl) {
        throw new PujaError('videoProofUrl is required to mark a puja completed', 400);
      }
      data.videoProofUrl = evidence.videoProofUrl;
      data.performedAt = new Date();
    }

    if (to === PujaBookingStatus.PRASAD_DISPATCHED) {
      if (!evidence.prasadAwb) {
        throw new PujaError('prasadAwb is required to mark prasad dispatched', 400);
      }
      data.prasadAwb = evidence.prasadAwb;
      data.prasadDispatchedAt = new Date();
      if (evidence.prasadCourier) {
        data.prasadCourier = evidence.prasadCourier;
      }
    }

    const row = await prisma.pujaBooking.update({
      where: { id: bookingId },
      data,
      include: bookingInclude,
    });

    logger.info({ bookingId, from: existing.status, to }, 'Puja booking advanced');
    await this.notify(row);
    return toBookingView(row);
  },

  /** Tells the devotee, live, that something happened to the puja they paid for. */
  async notify(row: BookingRow): Promise<void> {
    await hub.emitToUser(row.userId, ServerEvent.PUJA_BOOKING_UPDATED, toBookingView(row));
  },
} as const;
