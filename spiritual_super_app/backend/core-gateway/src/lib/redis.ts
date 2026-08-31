import { Redis, type RedisOptions } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from './logger.js';

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
};

function createClient(role: string): Redis {
  const client = new Redis(env.REDIS_URL, baseOptions);
  client.on('error', (error) => logger.error({ err: error, role }, 'Redis client error'));
  client.on('ready', () => logger.info({ role }, 'Redis client ready'));
  return client;
}

/** Command connection: shared by BullMQ, Redlock and application state. */
export const redis: Redis = createClient('commands');

/** Dedicated connections: a Redis connection in subscriber mode cannot issue other commands. */
export const redisSubscriber: Redis = createClient('subscriber');
export const redisPublisher: Redis = createClient('publisher');

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit(), redisPublisher.quit()]);
  logger.info('Redis connections closed');
}

export const redisKeys = {
  astrologerQueue: (astrologerId: string) => `ssa:queue:astrologer:${astrologerId}`,
  astrologerStatus: (astrologerId: string) => `ssa:status:astrologer:${astrologerId}`,
  astrologerActiveClaim: (astrologerId: string) => `ssa:claim:astrologer:${astrologerId}`,
  userQueueMembership: (userId: string) => `ssa:queue:user:${userId}`,
  sessionTickCounter: (sessionId: string) => `ssa:billing:ticks:${sessionId}`,
  billingLock: (sessionId: string) => `ssa:lock:billing:${sessionId}`,
  remedyCard: (cardId: string) => `ssa:remedy:card:${cardId}`,
  otpChallenge: (phone: string) => `ssa:otp:challenge:${phone}`,
  otpCooldown: (phone: string) => `ssa:otp:cooldown:${phone}`,
  otpRequestCount: (phone: string) => `ssa:otp:count:${phone}`,
} as const;

export const redisChannels = {
  clientEvents: 'ssa:events:client',
} as const;
