import { afterAll, afterEach, beforeAll } from 'vitest';

import { assertDisposableDatabase } from './global-setup.js';

// Imported after the env vars in vitest.config.ts are in place: config/env.ts validates on import
// and would throw before any test could run.
const { prisma, disconnectPrisma } = await import('../src/lib/prisma.js');
const { redis, closeRedis } = await import('../src/lib/redis.js');
const { closeQueues } = await import('../src/queues/index.js');

// Every table a test can write to. Anything missing here leaks into the next test: temples are not
// owned by a user, so they survived the users CASCADE and made catalog assertions depend on
// execution order.
const TABLES = [
  'astrologer_earnings',
  'wallet_transactions',
  'payment_orders',
  'call_sessions',
  'puja_bookings',
  'puja_offerings',
  'temples',
  // Not owned by a user, so a users CASCADE leaves it behind: a leaked chart makes the next test's
  // cache-miss assertion fail as a cache hit.
  'natal_charts',
  'astrologers',
  'wallets',
  'users',
];

// One statement so foreign keys never block the reset.
async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
  await redis.flushdb();
}

beforeAll(async () => {
  assertDisposableDatabase(process.env.DATABASE_URL ?? '');
  assertDisposableRedis(process.env.REDIS_URL ?? '');
  // Also reset on the way IN. A run that crashed, or an older run whose table list was incomplete,
  // otherwise leaves rows behind and the first test of the next run fails on a unique constraint
  // that has nothing to do with the code being tested.
  await resetDatabase();
});

afterEach(resetDatabase);

afterAll(async () => {
  // Without this the ioredis and BullMQ connections keep the process alive and the run never exits.
  await closeQueues();
  await closeRedis();
  await disconnectPrisma();
});

/**
 * The suite calls FLUSHDB. Redis database 0 is where the running application keeps live queues,
 * astrologer presence and OTP challenges, so tests must be pointed at a different index.
 */
function assertDisposableRedis(redisUrl: string): void {
  const index = new URL(redisUrl).pathname.replace(/^\//, '');
  if (!index || Number(index) < 1) {
    throw new Error(
      `Refusing to run tests against Redis database "${index || '0'}": use index 1 or higher, ` +
        'because the suite calls FLUSHDB.',
    );
  }
}
