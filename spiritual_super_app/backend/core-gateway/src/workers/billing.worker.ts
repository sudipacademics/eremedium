import { CallSessionStatus, ReferenceType } from '@prisma/client';
import { Worker, type Job } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Prisma, money, prisma } from '../lib/prisma.js';
import { redis, redisKeys } from '../lib/redis.js';
import { withLock } from '../lib/redlock.js';
import { QueueName, type BillingTickJobData } from '../queues/index.js';
import { CallService } from '../services/call.service.js';
import { LiveKitTokenService } from '../services/livekit.service.js';
import { InsufficientFundsError, WalletService } from '../services/wallet.service.js';
import { hub } from '../ws/hub.js';
import { ServerEvent } from '../ws/protocol.js';

const workerLogger = logger.child({ component: 'PerMinuteBillingWorker' });

/** Warn the user once their balance drops below this many further minutes. */
const LOW_BALANCE_WARNING_MINUTES = 2;

type TickOutcome =
  | { kind: 'BILLED'; minute: number; deducted: Prisma.Decimal; balanceAfter: Prisma.Decimal }
  | { kind: 'STOPPED'; reason: string }
  | { kind: 'DROPPED'; reason: string }
  /** Room looked short-handed but within grace: charge nothing, keep the loop alive. */
  | { kind: 'SKIPPED'; reason: string }
  /** Room has been short-handed past grace: the call is over, end it. */
  | { kind: 'ABANDONED'; reason: string };

/**
 * How many consecutive ticks may see fewer than both participants before we declare the call over.
 * One tolerated miss absorbs a brief reconnect; the user is not charged for a tolerated miss either,
 * so the cost of being wrong is a free minute rather than a wrongly billed one.
 */
const ABSENCE_STRIKES_BEFORE_TERMINATION = 2;
const EXPECTED_PARTICIPANTS = 2;

interface ActiveSession {
  id: string;
  userId: string;
  astrologerId: string;
  astrologerUserId: string;
  channelId: string;
  ratePerMinute: Prisma.Decimal;
  commissionSplit: Prisma.Decimal;
  totalMinutes: number;
  status: CallSessionStatus;
}

async function loadActiveSession(callSessionId: string): Promise<ActiveSession | null> {
  const session = await prisma.callSession.findUnique({
    where: { id: callSessionId },
    select: {
      id: true,
      userId: true,
      astrologerId: true,
      channelId: true,
      ratePerMinute: true,
      totalMinutes: true,
      status: true,
      astrologer: { select: { userId: true, commissionSplit: true } },
    },
  });
  if (!session) {
    return null;
  }
  return {
    id: session.id,
    userId: session.userId,
    astrologerId: session.astrologerId,
    astrologerUserId: session.astrologer.userId,
    channelId: session.channelId,
    ratePerMinute: money(session.ratePerMinute),
    commissionSplit: new Prisma.Decimal(session.astrologer.commissionSplit),
    totalMinutes: session.totalMinutes,
    status: session.status,
  };
}

/**
 * Splits a billed minute between astrologer and platform.
 *
 * The platform takes the remainder rather than its own rounded share, so the two halves always sum
 * to exactly the gross. Rounding the platform side independently is how a ledger ends up a paisa
 * short (or long) of what the user actually paid.
 */
function splitMinute(
  gross: Prisma.Decimal,
  commissionSplit: Prisma.Decimal,
): { net: Prisma.Decimal; platformFee: Prisma.Decimal } {
  const net = money(gross.times(commissionSplit));
  return { net, platformFee: money(gross.minus(net)) };
}

/**
 * One billing minute, executed under an exclusive Redlock on the session so that a retried job or a
 * second worker replica can never double-charge the same minute.
 *
 * The wallet debit, the ledger insert and the CallSession roll-up all happen in a single PostgreSQL
 * transaction with `SELECT ... FOR UPDATE` on the wallet row (see WalletService.debitByUserId).
 */
async function processTick(job: Job<BillingTickJobData>): Promise<TickOutcome> {
  const { callSessionId, tickNumber } = job.data;
  const lockKey = redisKeys.billingLock(callSessionId);

  const result = await withLock<TickOutcome>(lockKey, async () => {
    const session = await loadActiveSession(callSessionId);
    if (!session) {
      return { kind: 'STOPPED', reason: 'SESSION_NOT_FOUND' };
    }
    if (session.status !== CallSessionStatus.ACTIVE) {
      return { kind: 'STOPPED', reason: `SESSION_${session.status}` };
    }

    /*
     * Ask LiveKit whether the call is still happening BEFORE taking any money.
     *
     * Nothing else stops this loop when a client vanishes without hanging up: a crashed app, a dead
     * battery or a dropped network leaves the row ACTIVE and would otherwise bill every minute until
     * the wallet fell below the per-minute rate. A null answer means LiveKit was unreachable, which
     * is NOT evidence of an empty room, so we skip the minute rather than either billing blindly or
     * killing a live call.
     */
    const absenceKey = redisKeys.sessionAbsenceStrikes(callSessionId);
    const participants = await LiveKitTokenService.countParticipants(session.channelId);

    if (participants === null) {
      return { kind: 'SKIPPED', reason: 'LIVEKIT_UNREACHABLE' };
    }

    if (participants < EXPECTED_PARTICIPANTS) {
      const strikes = await redis.incr(absenceKey);
      await redis.expire(absenceKey, 3_600);
      if (strikes >= ABSENCE_STRIKES_BEFORE_TERMINATION) {
        return {
          kind: 'ABANDONED',
          reason: `ROOM_HELD_${participants}_PARTICIPANTS_FOR_${strikes}_TICKS`,
        };
      }
      return { kind: 'SKIPPED', reason: `ROOM_HELD_${participants}_PARTICIPANTS` };
    }

    // Both present: clear any earlier strike so a single blip never accumulates across a long call.
    await redis.del(absenceKey);

    const rate = session.ratePerMinute;

    // Solvency pre-check: never rely on the CHECK constraint to reject the debit.
    const { balance } = await WalletService.getBalanceByUserId(session.userId);
    if (balance.lessThan(rate)) {
      return { kind: 'DROPPED', reason: 'WALLET_BALANCE_BELOW_PER_MINUTE_RATE' };
    }

    try {
      const movement = await prisma.$transaction(
        async (tx) => {
          const debit = await WalletService.debitByUserId(
            session.userId,
            {
              amount: rate,
              referenceType: ReferenceType.CALL_SESSION,
              referenceId: session.id,
              idempotencyKey: `call:${session.id}:minute:${tickNumber}`,
            },
            tx,
          );

          await tx.callSession.update({
            where: { id: session.id },
            data: {
              totalMinutes: { increment: 1 },
              totalDeducted: { increment: rate },
            },
          });

          // Same transaction as the debit: the astrologer's payable and the user's charge either both
          // exist or neither does. The unique (callSessionId, minuteNumber) index makes a retried
          // tick a no-op instead of a double payment.
          const { net, platformFee } = splitMinute(rate, session.commissionSplit);
          await tx.astrologerEarning.upsert({
            where: {
              callSessionId_minuteNumber: {
                callSessionId: session.id,
                minuteNumber: tickNumber,
              },
            },
            create: {
              astrologerId: session.astrologerId,
              callSessionId: session.id,
              minuteNumber: tickNumber,
              grossAmount: rate,
              netAmount: net,
              platformFee,
              commissionSplit: session.commissionSplit,
            },
            update: {},
          });

          return debit;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
      );

      await redis.set(redisKeys.sessionTickCounter(callSessionId), tickNumber);

      return {
        kind: 'BILLED',
        minute: tickNumber,
        deducted: movement.amount,
        balanceAfter: movement.balanceAfter,
      };
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return { kind: 'DROPPED', reason: 'WALLET_BALANCE_BELOW_PER_MINUTE_RATE' };
      }
      throw error;
    }
  }, env.BILLING_LOCK_TTL_MS);

  if (result === null) {
    // Another worker holds the tick for this session; treat as a no-op rather than retrying.
    workerLogger.debug({ callSessionId, tickNumber }, 'Tick skipped: lock held elsewhere');
    return { kind: 'STOPPED', reason: 'LOCK_CONTENTION' };
  }
  return result;
}

async function handleOutcome(job: Job<BillingTickJobData>, outcome: TickOutcome): Promise<void> {
  const { callSessionId, tickNumber } = job.data;
  const session = await loadActiveSession(callSessionId);

  switch (outcome.kind) {
    case 'BILLED': {
      if (session) {
        const remainingMinutes = outcome.balanceAfter.dividedBy(session.ratePerMinute).floor().toNumber();
        await hub.emitToUsers([session.userId, session.astrologerUserId], ServerEvent.BILLING_TICK, {
          callSessionId,
          minute: outcome.minute,
          deducted: outcome.deducted.toFixed(2),
          balanceAfter: outcome.balanceAfter.toFixed(2),
          remainingMinutes,
        });
        if (remainingMinutes <= LOW_BALANCE_WARNING_MINUTES) {
          await hub.emitToUser(session.userId, ServerEvent.LOW_BALANCE_WARNING, {
            callSessionId,
            balance: outcome.balanceAfter.toFixed(2),
            remainingMinutes,
            ratePerMinute: session.ratePerMinute.toFixed(2),
          });
        }
      }
      await CallService.scheduleNextTick(callSessionId, tickNumber + 1);
      return;
    }
    case 'DROPPED': {
      await CallService.terminate(
        callSessionId,
        CallSessionStatus.DROPPED_INSUFFICIENT_FUNDS,
        outcome.reason,
      );
      return;
    }
    case 'SKIPPED': {
      // No charge, but the clock must keep running or a recovered call would continue for free.
      workerLogger.warn({ callSessionId, tickNumber, reason: outcome.reason }, 'Minute not billed');
      await CallService.scheduleNextTick(callSessionId, tickNumber + 1);
      return;
    }
    case 'ABANDONED': {
      workerLogger.warn(
        { callSessionId, tickNumber, reason: outcome.reason },
        'Ending call: participants gone without a hangup',
      );
      await CallService.terminate(callSessionId, CallSessionStatus.COMPLETED, outcome.reason);
      return;
    }
    case 'STOPPED': {
      workerLogger.info({ callSessionId, tickNumber, reason: outcome.reason }, 'Billing loop stopped');
      return;
    }
  }
}

export function createBillingWorker(): Worker<BillingTickJobData> {
  const worker = new Worker<BillingTickJobData>(
    QueueName.BILLING,
    async (job) => {
      const outcome = await processTick(job);
      await handleOutcome(job, outcome);
      return outcome.kind;
    },
    {
      connection: redis,
      concurrency: 50,
      lockDuration: 30_000,
    },
  );

  worker.on('failed', (job, error) => {
    workerLogger.error(
      { err: error, callSessionId: job?.data.callSessionId, tickNumber: job?.data.tickNumber },
      'Billing tick failed',
    );
  });

  worker.on('completed', (job, outcome) => {
    workerLogger.debug({ callSessionId: job.data.callSessionId, outcome }, 'Billing tick completed');
  });

  workerLogger.info({ tickSeconds: env.BILLING_TICK_SECONDS }, 'Per-minute billing worker started');
  return worker;
}
