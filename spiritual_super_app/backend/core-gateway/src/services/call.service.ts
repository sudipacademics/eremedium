import { randomUUID } from 'node:crypto';

import { AstrologerStatus, CallSessionStatus } from '@prisma/client';

import { AppRole } from '../auth/jwt.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { money, prisma } from '../lib/prisma.js';
import { redis, redisKeys } from '../lib/redis.js';
import { withLock } from '../lib/redlock.js';
import { billingJobId, billingQueue, matchingQueue } from '../queues/index.js';
import { hub } from '../ws/hub.js';
import { ServerEvent } from '../ws/protocol.js';
import { LiveKitTokenService, type MintedRtcToken } from './livekit.service.js';
import { QueueService } from './queue.service.js';
import { InsufficientFundsError, WalletService } from './wallet.service.js';

export class CallSessionError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'CallSessionError';
  }
}

export interface InitiatedCall {
  readonly callSessionId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly astrologerId: string;
  readonly ratePerMinute: string;
  readonly userToken: MintedRtcToken;
  readonly astrologerToken: MintedRtcToken;
}

export const TERMINAL_STATUSES: readonly CallSessionStatus[] = [
  CallSessionStatus.COMPLETED,
  CallSessionStatus.DROPPED_INSUFFICIENT_FUNDS,
];

export const CallService = {
  /**
   * Reserves the astrologer, creates the session row and mints both RTC tokens.
   * The astrologer transition IDLE -> IN_CALL happens inside a conditional UPDATE so two concurrent
   * matches cannot both win the same astrologer.
   */
  async initiate(userId: string, astrologerId: string): Promise<InitiatedCall> {
    const channelId = `call_${randomUUID()}`;

    const created = await prisma.$transaction(async (tx) => {
      const astrologer = await tx.astrologer.findUnique({
        where: { id: astrologerId },
        select: { id: true, userId: true, perMinuteRate: true, status: true, displayName: true },
      });
      if (!astrologer) {
        throw new CallSessionError(`Astrologer ${astrologerId} not found`);
      }
      if (astrologer.status !== AstrologerStatus.IDLE) {
        throw new CallSessionError(`Astrologer is ${astrologer.status}, not available`);
      }

      const ratePerMinute = money(astrologer.perMinuteRate);
      const minimumBalance = LiveKitTokenService.minimumBalanceFor(ratePerMinute);
      const { balance, walletId } = await WalletService.getBalanceByUserId(userId);
      if (balance.lessThan(minimumBalance)) {
        throw new InsufficientFundsError(walletId, minimumBalance, balance);
      }

      const reserved = await tx.astrologer.updateMany({
        where: { id: astrologerId, status: AstrologerStatus.IDLE },
        data: { status: AstrologerStatus.IN_CALL },
      });
      if (reserved.count !== 1) {
        throw new CallSessionError('Astrologer was claimed by another session');
      }

      const session = await tx.callSession.create({
        data: {
          userId,
          astrologerId,
          channelId,
          ratePerMinute,
          status: CallSessionStatus.INITIATED,
        },
        select: { id: true, channelId: true, ratePerMinute: true },
      });

      return { session, astrologerUserId: astrologer.userId, displayName: astrologer.displayName };
    });

    const [userToken, astrologerToken] = await Promise.all([
      LiveKitTokenService.mintUserToken({ userId, astrologerId, roomName: channelId }),
      LiveKitTokenService.mintAstrologerToken({
        astrologerUserId: created.astrologerUserId,
        roomName: channelId,
      }),
    ]);

    const payload: InitiatedCall = {
      callSessionId: created.session.id,
      channelId: created.session.channelId,
      userId,
      astrologerId,
      ratePerMinute: money(created.session.ratePerMinute).toFixed(2),
      userToken,
      astrologerToken,
    };

    await hub.emitToUser(userId, ServerEvent.CALL_READY, {
      callSessionId: payload.callSessionId,
      channelId: payload.channelId,
      astrologerId,
      astrologerName: created.displayName,
      ratePerMinute: payload.ratePerMinute,
      rtc: userToken,
    });
    await hub.emitToUser(created.astrologerUserId, ServerEvent.CALL_READY, {
      callSessionId: payload.callSessionId,
      channelId: payload.channelId,
      userId,
      ratePerMinute: payload.ratePerMinute,
      rtc: astrologerToken,
    });

    logger.info({ callSessionId: payload.callSessionId, userId, astrologerId }, 'Call session initiated');
    return payload;
  },

  /** Called when both participants have actually joined the LiveKit room. Starts the billing clock. */
  async activate(callSessionId: string): Promise<void> {
    const startTime = new Date();
    const updated = await prisma.callSession.updateMany({
      where: { id: callSessionId, status: CallSessionStatus.INITIATED },
      data: { status: CallSessionStatus.ACTIVE, startTime },
    });
    if (updated.count !== 1) {
      logger.warn({ callSessionId }, 'activate() ignored: session not in INITIATED state');
      return;
    }

    await redis.set(redisKeys.sessionTickCounter(callSessionId), 0);
    await this.scheduleNextTick(callSessionId, 1);

    const session = await prisma.callSession.findUniqueOrThrow({
      where: { id: callSessionId },
      select: {
        userId: true,
        ratePerMinute: true,
        astrologer: { select: { userId: true } },
      },
    });

    await hub.emitToUsers([session.userId, session.astrologer.userId], ServerEvent.CALL_STARTED, {
      callSessionId,
      startTime: startTime.toISOString(),
      ratePerMinute: money(session.ratePerMinute).toFixed(2),
      billingTickSeconds: env.BILLING_TICK_SECONDS,
    });
  },

  async scheduleNextTick(callSessionId: string, tickNumber: number): Promise<void> {
    await billingQueue.add(
      'tick',
      { callSessionId, tickNumber },
      {
        jobId: billingJobId(callSessionId, tickNumber),
        delay: env.BILLING_TICK_SECONDS * 1_000,
      },
    );
  },

  async cancelPendingTicks(callSessionId: string): Promise<void> {
    const jobs = await billingQueue.getJobs(['delayed', 'waiting', 'paused']);
    await Promise.all(
      jobs
        .filter((job) => job.data.callSessionId === callSessionId)
        .map((job) => job.remove().catch(() => undefined)),
    );
    await redis.del(redisKeys.sessionTickCounter(callSessionId));
  },

  /**
   * Terminates a session. `status` distinguishes a normal hang-up from a solvency drop; in both
   * cases the astrologer is freed and the room torn down.
   */
  async terminate(
    callSessionId: string,
    status: Extract<CallSessionStatus, 'COMPLETED' | 'DROPPED_INSUFFICIENT_FUNDS'>,
    reason: string,
  ): Promise<void> {
    const endTime = new Date();

    const session = await prisma.$transaction(async (tx) => {
      const existing = await tx.callSession.findUnique({
        where: { id: callSessionId },
        select: {
          id: true,
          status: true,
          channelId: true,
          userId: true,
          astrologerId: true,
          totalMinutes: true,
          totalDeducted: true,
          astrologer: { select: { userId: true } },
        },
      });
      if (!existing) {
        throw new CallSessionError(`Call session ${callSessionId} not found`);
      }
      if (TERMINAL_STATUSES.includes(existing.status)) {
        return existing;
      }

      await tx.callSession.update({
        where: { id: callSessionId },
        data: { status, endTime },
      });
      await tx.astrologer.updateMany({
        where: { id: existing.astrologerId, status: AstrologerStatus.IN_CALL },
        data: { status: AstrologerStatus.IDLE },
      });
      return existing;
    });

    await this.cancelPendingTicks(callSessionId);
    await QueueService.releaseClaim(session.astrologerId);

    if (status === CallSessionStatus.DROPPED_INSUFFICIENT_FUNDS) {
      await LiveKitTokenService.publishRoomData(session.channelId, {
        event: ServerEvent.FORCE_DISCONNECT,
        callSessionId,
        reason,
      });
      await LiveKitTokenService.removeUserFromRoom(session.channelId, AppRole.USER, session.userId);
      await hub.emitToUsers([session.userId, session.astrologer.userId], ServerEvent.FORCE_DISCONNECT, {
        callSessionId,
        reason,
      });
    }

    await LiveKitTokenService.closeRoom(session.channelId);

    const final = await prisma.callSession.findUniqueOrThrow({
      where: { id: callSessionId },
      select: { totalMinutes: true, totalDeducted: true },
    });

    await hub.emitToUsers([session.userId, session.astrologer.userId], ServerEvent.CALL_ENDED, {
      callSessionId,
      status,
      reason,
      endTime: endTime.toISOString(),
      totalMinutes: final.totalMinutes,
      totalDeducted: money(final.totalDeducted).toFixed(2),
    });

    await matchingQueue.add(
      'match',
      { astrologerId: session.astrologerId },
      { jobId: `match:${session.astrologerId}:${Date.now()}` },
    );

    logger.info({ callSessionId, status, reason }, 'Call session terminated');
  },

  /**
   * Last-resort sweep for sessions that neither the client, the webhook nor the billing tick closed.
   *
   * Two distinct leaks are handled:
   *
   *  - INITIATED sessions nobody ever joined. `initiate()` flips the astrologer to IN_CALL up front,
   *    so an abandoned invite would otherwise keep that astrologer unbookable forever.
   *  - ACTIVE sessions whose LiveKit room no longer exists. The billing tick normally catches these,
   *    but if its queue job was lost the row would sit ACTIVE indefinitely.
   *
   * Serialised across replicas by a Redlock, so running this in every API instance is safe.
   */
  async reapStaleSessions(): Promise<{ initiated: number; active: number }> {
    const result = await withLock(
      redisKeys.staleSessionReaperLock,
      async () => {
        const now = Date.now();
        const initiatedCutoff = new Date(now - env.STALE_INITIATED_SESSION_SECONDS * 1_000);
        let initiated = 0;
        let active = 0;

        const abandonedInvites = await prisma.callSession.findMany({
          where: { status: CallSessionStatus.INITIATED, createdAt: { lt: initiatedCutoff } },
          select: { id: true },
          take: 100,
        });
        for (const session of abandonedInvites) {
          await this.terminate(session.id, CallSessionStatus.COMPLETED, 'NEVER_ACTIVATED');
          initiated += 1;
        }

        // Only sessions old enough to have had a chance to start, so we never race a room that is
        // still being created.
        const activeCutoff = new Date(now - env.STALE_ACTIVE_SESSION_SECONDS * 1_000);
        const stillActive = await prisma.callSession.findMany({
          where: { status: CallSessionStatus.ACTIVE, startTime: { lt: activeCutoff } },
          select: { id: true, channelId: true },
          take: 100,
        });
        for (const session of stillActive) {
          const participants = await LiveKitTokenService.countParticipants(session.channelId);
          // null means LiveKit was unreachable: leave the session alone rather than ending a live call.
          if (participants !== null && participants === 0) {
            await this.terminate(session.id, CallSessionStatus.COMPLETED, 'ROOM_EMPTY_REAPED');
            active += 1;
          }
        }

        return { initiated, active };
      },
      env.BILLING_LOCK_TTL_MS,
    );

    if (result === null) {
      return { initiated: 0, active: 0 };
    }
    if (result.initiated > 0 || result.active > 0) {
      logger.warn(result, 'Stale call sessions reaped');
    }
    return result;
  },
} as const;
