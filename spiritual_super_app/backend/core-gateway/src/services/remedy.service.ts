import { randomUUID } from 'node:crypto';

import { CallSessionStatus, PujaBookingStatus, ReferenceType } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { Prisma, money, prisma } from '../lib/prisma.js';
import { redis, redisKeys } from '../lib/redis.js';
import { hub } from '../ws/hub.js';
import { ServerEvent } from '../ws/protocol.js';
import { WalletService } from './wallet.service.js';

export class RemedyError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'RemedyError';
  }
}

export interface PujaRemedyCard {
  readonly cardId: string;
  readonly callSessionId: string;
  readonly userId: string;
  readonly astrologerId: string;
  readonly templeId: string;
  readonly templeName: string;
  readonly templeLocation: string;
  readonly primaryDeity: string;
  readonly liveStreamUrl: string | null;
  readonly pujaName: string;
  readonly packagePrice: string;
  readonly sankalpName: string;
  readonly sankalpGotra: string | null;
  readonly sankalpWish: string | null;
  readonly expiresAt: string;
  /** Debit authorisation is one click: the client posts this cardId back to authorise. */
  readonly authorizationEndpoint: string;
}

export interface RemedyAuthorizationResult {
  readonly cardId: string;
  readonly pujaBookingId: string;
  readonly amountDebited: string;
  readonly walletBalanceAfter: string;
  readonly status: PujaBookingStatus;
}

interface DispatchInput {
  readonly callSessionId: string;
  readonly astrologerId: string;
  readonly templeId: string;
  readonly pujaName: string;
  readonly packagePrice: string;
  readonly sankalpWish?: string | undefined;
  readonly expiresInSeconds: number;
}

export const InCallRemedyDispatcher = {
  /**
   * Pushes an interactive PujaRemedyCard to the user's client over WebSockets during a live call.
   * Only the astrologer currently on the session may dispatch, and the card is short-lived.
   */
  async dispatch(input: DispatchInput): Promise<PujaRemedyCard> {
    const session = await prisma.callSession.findUnique({
      where: { id: input.callSessionId },
      select: {
        id: true,
        status: true,
        astrologerId: true,
        userId: true,
        user: { select: { name: true, gotra: true } },
      },
    });
    if (!session) {
      throw new RemedyError(`Call session ${input.callSessionId} not found`);
    }
    if (session.astrologerId !== input.astrologerId) {
      throw new RemedyError('Only the astrologer on this session may push a remedy');
    }
    if (session.status !== CallSessionStatus.ACTIVE) {
      throw new RemedyError(`Session is ${session.status}; remedies require an ACTIVE call`);
    }

    const temple = await prisma.temple.findUnique({
      where: { id: input.templeId },
      select: { id: true, name: true, location: true, primaryDeity: true, liveStreamUrl: true },
    });
    if (!temple) {
      throw new RemedyError(`Temple ${input.templeId} not found`);
    }

    const price = money(input.packagePrice);
    if (price.lessThanOrEqualTo(0)) {
      throw new RemedyError('packagePrice must be greater than zero');
    }

    const cardId = randomUUID();
    const card: PujaRemedyCard = {
      cardId,
      callSessionId: session.id,
      userId: session.userId,
      astrologerId: input.astrologerId,
      templeId: temple.id,
      templeName: temple.name,
      templeLocation: temple.location,
      primaryDeity: temple.primaryDeity,
      liveStreamUrl: temple.liveStreamUrl,
      pujaName: input.pujaName,
      packagePrice: price.toFixed(2),
      sankalpName: session.user.name,
      sankalpGotra: session.user.gotra,
      sankalpWish: input.sankalpWish ?? null,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000).toISOString(),
      authorizationEndpoint: `/api/v1/remedies/${cardId}/authorize`,
    };

    await redis.set(
      redisKeys.remedyCard(cardId),
      JSON.stringify(card),
      'EX',
      input.expiresInSeconds,
    );
    await hub.emitToUser(session.userId, ServerEvent.PUJA_REMEDY_CARD, card);

    logger.info(
      { cardId, callSessionId: session.id, astrologerId: input.astrologerId, price: card.packagePrice },
      'PujaRemedyCard dispatched',
    );
    return card;
  },

  async getCard(cardId: string): Promise<PujaRemedyCard | null> {
    const raw = await redis.get(redisKeys.remedyCard(cardId));
    return raw === null ? null : (JSON.parse(raw) as PujaRemedyCard);
  },

  /**
   * One-click authorisation: debits the wallet and creates the PujaBooking in one PostgreSQL
   * transaction, attributing the referral to the astrologer who pushed the card.
   */
  async authorize(cardId: string, actingUserId: string): Promise<RemedyAuthorizationResult> {
    const card = await this.getCard(cardId);
    if (!card) {
      throw new RemedyError('Remedy card has expired or does not exist');
    }
    if (card.userId !== actingUserId) {
      throw new RemedyError('This remedy card belongs to another user');
    }

    // Consume the card first: a second click must not create a second booking.
    const consumed = await redis.del(redisKeys.remedyCard(cardId));
    if (consumed !== 1) {
      throw new RemedyError('Remedy card already used');
    }

    const price = money(card.packagePrice);

    const restoreCard = async (): Promise<void> => {
      const remainingMs = new Date(card.expiresAt).getTime() - Date.now();
      if (remainingMs > 1_000) {
        await redis.set(
          redisKeys.remedyCard(cardId),
          JSON.stringify(card),
          'PX',
          remainingMs,
        );
      }
    };

    const result = await prisma
      .$transaction(
      async (tx) => {
        const debit = await WalletService.debitByUserId(
          actingUserId,
          {
            amount: price,
            referenceType: ReferenceType.PUJA_BOOKING,
            referenceId: cardId,
            idempotencyKey: `remedy:${cardId}`,
          },
          tx,
        );

        const booking = await tx.pujaBooking.create({
          data: {
            userId: actingUserId,
            templeId: card.templeId,
            referredByAstrologerId: card.astrologerId,
            sankalpName: card.sankalpName,
            sankalpGotra: card.sankalpGotra,
            sankalpWish: card.sankalpWish,
            packagePrice: price,
            status: PujaBookingStatus.CONFIRMED,
          },
          select: { id: true, status: true },
        });

        return { debit, booking };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
      )
      .catch(async (error: unknown) => {
        // The booking never happened, so let the user try again while the card is still valid.
        await restoreCard();
        throw error;
      });

    const payload: RemedyAuthorizationResult = {
      cardId,
      pujaBookingId: result.booking.id,
      amountDebited: result.debit.amount.toFixed(2),
      walletBalanceAfter: result.debit.balanceAfter.toFixed(2),
      status: result.booking.status,
    };

    const astrologer = await prisma.astrologer.findUnique({
      where: { id: card.astrologerId },
      select: { userId: true },
    });
    const recipients = [actingUserId, ...(astrologer ? [astrologer.userId] : [])];
    await hub.emitToUsers(recipients, ServerEvent.PUJA_REMEDY_RESULT, payload);

    logger.info({ cardId, pujaBookingId: payload.pujaBookingId }, 'PujaRemedyCard authorised');
    return payload;
  },
} as const;
