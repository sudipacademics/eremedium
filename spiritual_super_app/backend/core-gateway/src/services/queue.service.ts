import { AstrologerStatus } from '@prisma/client';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { money, prisma } from '../lib/prisma.js';
import { redis, redisKeys } from '../lib/redis.js';
import { matchingQueue } from '../queues/index.js';
import { hub } from '../ws/hub.js';
import { ServerEvent } from '../ws/protocol.js';
import { LiveKitTokenService } from './livekit.service.js';
import { WalletService } from './wallet.service.js';

export type AstrologerPresence = 'ONLINE' | 'BUSY' | 'OFFLINE';

export class QueueError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'QueueError';
  }
}

export interface WaitlistPosition {
  readonly astrologerId: string;
  readonly userId: string;
  readonly position: number;
  readonly waitingAhead: number;
  readonly estimatedWaitMinutes: number;
  readonly queueLength: number;
}

/** Average consultation length used for wait estimates until we have per-astrologer telemetry. */
const ASSUMED_CALL_MINUTES = 8;

function presenceToDbStatus(presence: AstrologerPresence): AstrologerStatus {
  switch (presence) {
    case 'ONLINE':
      return AstrologerStatus.IDLE;
    case 'BUSY':
      return AstrologerStatus.BUSY;
    case 'OFFLINE':
      return AstrologerStatus.OFFLINE;
  }
}

export const QueueService = {
  async setAstrologerPresence(astrologerId: string, presence: AstrologerPresence): Promise<AstrologerStatus> {
    const current = await prisma.astrologer.findUnique({
      where: { id: astrologerId },
      select: { status: true },
    });
    if (!current) {
      throw new QueueError(`Astrologer ${astrologerId} not found`);
    }
    if (current.status === AstrologerStatus.IN_CALL && presence !== 'OFFLINE') {
      throw new QueueError('Cannot change presence while IN_CALL; end the session first');
    }

    const status = presenceToDbStatus(presence);
    await prisma.astrologer.update({ where: { id: astrologerId }, data: { status } });
    await redis.set(redisKeys.astrologerStatus(astrologerId), status);

    if (status === AstrologerStatus.OFFLINE) {
      await this.drainQueue(astrologerId, 'ASTROLOGER_WENT_OFFLINE');
    } else if (status === AstrologerStatus.IDLE) {
      await matchingQueue.add('match', { astrologerId }, { jobId: `match:${astrologerId}:${Date.now()}` });
    }

    await hub.emitToUsers(await this.waitingUserIds(astrologerId), ServerEvent.ASTROLOGER_STATUS, {
      astrologerId,
      status,
    });

    logger.info({ astrologerId, status }, 'Astrologer presence updated');
    return status;
  },

  /** FIFO enqueue. Solvency is verified on entry and re-verified at match time. */
  async joinQueue(userId: string, astrologerId: string): Promise<WaitlistPosition> {
    const astrologer = await prisma.astrologer.findUnique({
      where: { id: astrologerId },
      select: { id: true, perMinuteRate: true, status: true },
    });
    if (!astrologer) {
      throw new QueueError(`Astrologer ${astrologerId} not found`);
    }
    if (astrologer.status === AstrologerStatus.OFFLINE) {
      throw new QueueError('Astrologer is offline');
    }

    const minimumBalance = LiveKitTokenService.minimumBalanceFor(astrologer.perMinuteRate);
    if (!(await WalletService.hasSolvencyFor(userId, minimumBalance))) {
      throw new QueueError(
        `Wallet must hold at least ${minimumBalance.toFixed(2)} to queue for this astrologer`,
      );
    }

    const key = redisKeys.astrologerQueue(astrologerId);
    const existingIndex = await redis.lpos(key, userId);
    if (existingIndex === null) {
      await redis.rpush(key, userId);
      await redis.sadd(redisKeys.userQueueMembership(userId), astrologerId);
    }

    await matchingQueue.add('match', { astrologerId }, { jobId: `match:${astrologerId}:${Date.now()}` });
    const position = await this.positionOf(userId, astrologerId);
    await hub.emitToUser(userId, ServerEvent.QUEUE_POSITION, position);
    return position;
  },

  async leaveQueue(userId: string, astrologerId: string): Promise<void> {
    await redis.lrem(redisKeys.astrologerQueue(astrologerId), 0, userId);
    await redis.srem(redisKeys.userQueueMembership(userId), astrologerId);
    await hub.emitToUser(userId, ServerEvent.QUEUE_LEFT, { astrologerId });
    await this.broadcastPositions(astrologerId);
  },

  async positionOf(userId: string, astrologerId: string): Promise<WaitlistPosition> {
    const key = redisKeys.astrologerQueue(astrologerId);
    const [index, length] = await Promise.all([redis.lpos(key, userId), redis.llen(key)]);
    if (index === null) {
      throw new QueueError('User is not in this queue');
    }
    return {
      astrologerId,
      userId,
      position: index + 1,
      waitingAhead: index,
      estimatedWaitMinutes: index * ASSUMED_CALL_MINUTES,
      queueLength: length,
    };
  },

  async waitingUserIds(astrologerId: string): Promise<string[]> {
    return redis.lrange(redisKeys.astrologerQueue(astrologerId), 0, -1);
  },

  async broadcastPositions(astrologerId: string): Promise<void> {
    const key = redisKeys.astrologerQueue(astrologerId);
    const waiting = await redis.lrange(key, 0, -1);
    await Promise.all(
      waiting.map((userId, index) =>
        hub.emitToUser(userId, ServerEvent.QUEUE_POSITION, {
          astrologerId,
          userId,
          position: index + 1,
          waitingAhead: index,
          estimatedWaitMinutes: index * ASSUMED_CALL_MINUTES,
          queueLength: waiting.length,
        } satisfies WaitlistPosition),
      ),
    );
  },

  async drainQueue(astrologerId: string, reason: string): Promise<void> {
    const key = redisKeys.astrologerQueue(astrologerId);
    const waiting = await redis.lrange(key, 0, -1);
    if (waiting.length === 0) {
      return;
    }
    const pipeline = redis.multi();
    pipeline.del(key);
    for (const userId of waiting) {
      pipeline.srem(redisKeys.userQueueMembership(userId), astrologerId);
    }
    await pipeline.exec();
    await hub.emitToUsers(waiting, ServerEvent.QUEUE_LEFT, { astrologerId, reason });
  },

  /**
   * Pops the head of the FIFO queue and hands it to the caller, skipping users who have become
   * insolvent while waiting. Returns null when nobody eligible remains.
   */
  async claimNextEligibleUser(astrologerId: string): Promise<string | null> {
    const astrologer = await prisma.astrologer.findUnique({
      where: { id: astrologerId },
      select: { perMinuteRate: true, status: true },
    });
    if (!astrologer || astrologer.status !== AstrologerStatus.IDLE) {
      return null;
    }

    const minimumBalance = money(
      LiveKitTokenService.minimumBalanceFor(astrologer.perMinuteRate),
    );
    const key = redisKeys.astrologerQueue(astrologerId);

    for (;;) {
      const userId = await redis.lpop(key);
      if (userId === null) {
        return null;
      }
      await redis.srem(redisKeys.userQueueMembership(userId), astrologerId);

      if (!hub.isOnline(userId)) {
        // The waiting client is gone; drop them silently and try the next in line.
        continue;
      }
      if (!(await WalletService.hasSolvencyFor(userId, minimumBalance))) {
        await hub.emitToUser(userId, ServerEvent.QUEUE_LEFT, {
          astrologerId,
          reason: 'INSUFFICIENT_BALANCE_AT_MATCH',
          minimumBalanceRequired: minimumBalance.toFixed(2),
        });
        continue;
      }

      await redis.set(
        redisKeys.astrologerActiveClaim(astrologerId),
        userId,
        'EX',
        env.CALL_QUEUE_CLAIM_TTL_SECONDS,
      );
      await this.broadcastPositions(astrologerId);
      return userId;
    }
  },

  async releaseClaim(astrologerId: string): Promise<void> {
    await redis.del(redisKeys.astrologerActiveClaim(astrologerId));
  },
} as const;
