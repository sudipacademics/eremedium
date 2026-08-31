import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { closeRedis } from './lib/redis.js';
import { closeQueues } from './queues/index.js';
import { createBillingWorker } from './workers/billing.worker.js';
import { createMatchingWorker } from './workers/matching.worker.js';
import { hub } from './ws/hub.js';

/**
 * In the default single-node Hetzner deployment the API also hosts the BullMQ workers. Set
 * RUN_WORKERS_IN_API=false and run `npm run start:worker` separately to scale them independently.
 */
const runWorkersInApi = process.env.RUN_WORKERS_IN_API !== 'false';

async function main(): Promise<void> {
  const app = await buildApp();

  const workers = runWorkersInApi ? [createBillingWorker(), createMatchingWorker()] : [];

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info(
    { host: env.HOST, port: env.PORT, workersInApi: runWorkersInApi },
    'Core gateway listening',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');
    hub.closeAll();
    await app.close();
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await closeQueues();
    await disconnectPrisma();
    await closeRedis();
    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Core gateway failed to start');
  process.exit(1);
});
