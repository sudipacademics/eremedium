import { Queue, type JobsOptions } from 'bullmq';

import { redis } from '../lib/redis.js';

export const QueueName = {
  MATCHING: 'ssa-astrologer-matching',
  BILLING: 'ssa-per-minute-billing',
} as const;

export interface MatchingJobData {
  readonly astrologerId: string;
}

export interface BillingTickJobData {
  readonly callSessionId: string;
  readonly tickNumber: number;
}

const defaultJobOptions: JobsOptions = {
  removeOnComplete: { age: 3_600, count: 5_000 },
  removeOnFail: { age: 86_400, count: 5_000 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
};

/** BullMQ shares the single ioredis command connection (maxRetriesPerRequest: null is required). */
export const matchingQueue = new Queue<MatchingJobData>(QueueName.MATCHING, {
  connection: redis,
  defaultJobOptions,
});

export const billingQueue = new Queue<BillingTickJobData>(QueueName.BILLING, {
  connection: redis,
  defaultJobOptions: {
    ...defaultJobOptions,
    // A missed tick must never be silently dropped: retry fast, then let the reconciler catch it.
    attempts: 5,
    backoff: { type: 'fixed', delay: 2_000 },
  },
});

export function billingJobId(callSessionId: string, tickNumber: number): string {
  return `tick:${callSessionId}:${tickNumber}`;
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([matchingQueue.close(), billingQueue.close()]);
}
