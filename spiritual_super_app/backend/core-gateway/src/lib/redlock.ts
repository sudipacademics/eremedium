import Redlock, { type Lock, ResourceLockedError } from 'redlock';

import { env } from '../config/env.js';
import { logger } from './logger.js';
import { redis } from './redis.js';

/**
 * Single-node Redlock. On a dedicated Hetzner host with one Redis instance this still provides the
 * mutual exclusion the billing worker needs; add further independent Redis nodes to this array when
 * the deployment grows to a Redis cluster.
 */
export const redlock = new Redlock([redis], {
  driftFactor: 0.01,
  retryCount: 3,
  retryDelay: 200,
  retryJitter: 100,
  automaticExtensionThreshold: 500,
});

redlock.on('error', (error) => {
  if (error instanceof ResourceLockedError) {
    // Expected under contention: another worker already owns the tick.
    return;
  }
  logger.error({ err: error }, 'Redlock error');
});

export class LockUnavailableError extends Error {
  constructor(resource: string) {
    super(`Could not acquire lock for ${resource}`);
    this.name = 'LockUnavailableError';
  }
}

/**
 * Run `handler` while holding an exclusive lock on `resource`.
 * Returns `null` when the lock is already held elsewhere, so callers can skip rather than double-bill.
 */
export async function withLock<T>(
  resource: string,
  handler: (lock: Lock) => Promise<T>,
  ttlMs: number = env.BILLING_LOCK_TTL_MS,
): Promise<T | null> {
  let lock: Lock;
  try {
    lock = await redlock.acquire([resource], ttlMs);
  } catch (error) {
    if (error instanceof ResourceLockedError) {
      logger.debug({ resource }, 'Lock busy, skipping');
      return null;
    }
    throw error;
  }

  try {
    return await handler(lock);
  } finally {
    await lock.release().catch((error: unknown) => {
      logger.warn({ err: error, resource }, 'Failed to release lock (will expire by TTL)');
    });
  }
}
