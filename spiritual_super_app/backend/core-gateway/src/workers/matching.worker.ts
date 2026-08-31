import { Worker } from 'bullmq';

import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { QueueName, type MatchingJobData } from '../queues/index.js';
import { CallService, CallSessionError } from '../services/call.service.js';
import { QueueService } from '../services/queue.service.js';
import { InsufficientFundsError } from '../services/wallet.service.js';

const workerLogger = logger.child({ component: 'AstrologerMatchingWorker' });

export function createMatchingWorker(): Worker<MatchingJobData> {
  const worker = new Worker<MatchingJobData>(
    QueueName.MATCHING,
    async (job) => {
      const { astrologerId } = job.data;
      const userId = await QueueService.claimNextEligibleUser(astrologerId);
      if (userId === null) {
        return 'NO_ELIGIBLE_USER';
      }

      try {
        const call = await CallService.initiate(userId, astrologerId);
        return `INITIATED:${call.callSessionId}`;
      } catch (error) {
        await QueueService.releaseClaim(astrologerId);
        if (error instanceof InsufficientFundsError || error instanceof CallSessionError) {
          workerLogger.warn({ err: error, astrologerId, userId }, 'Match aborted, user returned to queue');
          await QueueService.joinQueue(userId, astrologerId).catch(() => undefined);
          return 'MATCH_ABORTED';
        }
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 10,
    },
  );

  worker.on('failed', (job, error) => {
    workerLogger.error({ err: error, astrologerId: job?.data.astrologerId }, 'Matching job failed');
  });

  workerLogger.info('Astrologer matching worker started');
  return worker;
}
