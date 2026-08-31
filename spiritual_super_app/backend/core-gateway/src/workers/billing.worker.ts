import { CallSessionStatus, ReferenceType } from '@prisma/client';
import { Worker, type Job } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Prisma, money, prisma } from '../lib/prisma.js';
import { redis, redisKeys } from '../lib/redis.js';
import { withLock } from '../lib/redlock.js';
import { QueueName, type BillingTickJobData } from '../queues/index.js';
import { CallService } from '../services/call.service.js';
import { InsufficientFundsError, WalletService } from '../services/wallet.service.js';
import { hub } from '../ws/hub.js';
import { ServerEvent } from '../ws/protocol.js';

const workerLogger = logger.child({ component: 'PerMinuteBillingWorker' });

/** Warn the user once their balance drops below this many further minutes. */
const LOW_BALANCE_WARNING_MINUTES = 2;

type TickOutcome =
  | { kind: 'BILLED'; minute: number; deducted: Prisma.Decimal; balanceAfter: Prisma.Decimal }
  | { kind: 'STOPPED'; reason: string }
  | { kind: 'DROPPED'; reason: string };

interface ActiveSession {
  id: string;
  userId: string;
  astrologerId: string;
  astrologerUserId: string;
  channelId: string;
  ratePerMinute: Prisma.Decimal;
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
      astrologer: { select: { userId: true } },
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
    totalMinutes: session.totalMinutes,
    status: session.status,
  };
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
