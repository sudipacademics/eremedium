import { CallSessionStatus } from '@prisma/client';

import { prisma } from '../lib/prisma.js';

export class ProviderReviewError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'ProviderReviewError';
    this.statusCode = statusCode;
  }
}

const ENDED: readonly CallSessionStatus[] = [CallSessionStatus.COMPLETED, CallSessionStatus.DROPPED_INSUFFICIENT_FUNDS];

export interface ReviewView {
  rating: number;
  comment: string | null;
  createdAt: string;
}

export const ProviderReviewService = {
  /** Only the paying user of a call that actually connected may rate it; re-rating replaces the earlier one. */
  async submit(userId: string, callSessionId: string, input: { rating: number; comment?: string | undefined }): Promise<ReviewView> {
    const session = await prisma.callSession.findUnique({
      where: { id: callSessionId },
      select: { userId: true, astrologerId: true, status: true, startTime: true },
    });
    if (!session) throw new ProviderReviewError('Call session not found', 404);
    if (session.userId !== userId) throw new ProviderReviewError('Only the person who booked this call can rate it', 403);
    if (!ENDED.includes(session.status)) throw new ProviderReviewError('You can rate the call once it has ended');
    if (!session.startTime) throw new ProviderReviewError('This call never connected, so there is nothing to rate');

    const comment = input.comment?.trim() || null;
    const review = await prisma.providerReview.upsert({
      where: { callSessionId },
      create: { callSessionId, astrologerId: session.astrologerId, userId, rating: input.rating, comment },
      update: { rating: input.rating, comment },
      select: { rating: true, comment: true, createdAt: true },
    });
    return { rating: review.rating, comment: review.comment, createdAt: review.createdAt.toISOString() };
  },

  async forSession(callSessionId: string): Promise<ReviewView | null> {
    const review = await prisma.providerReview.findUnique({
      where: { callSessionId },
      select: { rating: true, comment: true, createdAt: true },
    });
    return review ? { rating: review.rating, comment: review.comment, createdAt: review.createdAt.toISOString() } : null;
  },
};
