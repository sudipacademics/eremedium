/**
 * Standalone worker process entrypoint.
 *
 * Run one or more of these alongside the API (`npm run start:worker`). Redlock guarantees that a
 * given call session's billing tick executes exactly once regardless of replica count.
 */
import { logger } from '../lib/logger.js';
import { disconnectPrisma } from '../lib/prisma.js';
import { closeRedis } from '../lib/redis.js';
import { closeQueues } from '../queues/index.js';
import { hub } from '../ws/hub.js';
import { createBillingWorker } from './billing.worker.js';
import { createMatchingWorker } from './matching.worker.js';

async function main(): Promise<void> {
  // Workers publish client events through the same Redis fan-out the API consumes.
  await hub.initialise();

  const billingWorker = createBillingWorker();
  const matchingWorker = createMatchingWorker();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker shutting down');
    await Promise.allSettled([billingWorker.close(), matchingWorker.close()]);
    await closeQueues();
    await disconnectPrisma();
    await closeRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Worker failed to start');
  process.exit(1);
});
