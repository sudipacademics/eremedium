import { defineConfig } from 'vitest/config';

/**
 * Integration-first test setup.
 *
 * These tests run against a REAL PostgreSQL and Redis rather than mocks, because the invariants
 * worth protecting are enforced by the database and not by application code: `SELECT ... FOR UPDATE`
 * on the wallet row, the unique index on (call_session_id, minute_number) that makes a retried
 * billing tick a no-op, the unique idempotency_key that absorbs a replayed webhook, and the CHECK
 * constraints on the earnings split. A mocked Prisma client would assert that the code calls the
 * functions I wrote, which is exactly the class of bug these tests exist to catch.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    /*
     * One process, one test at a time. The suite shares a single database and Redis keyspace, and
     * the billing tests deliberately exercise a distributed lock, so parallel files would produce
     * failures that say nothing about the code under test.
     */
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      // Supplied by CI or the local runner; both must point at a throwaway database.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? '',
      JWT_SECRET: 'test-jwt-secret-that-is-long-enough-to-pass-validation',
      ASTRO_SERVICE_URL: 'http://astro-service.invalid',
      INTERNAL_SERVICE_TOKEN: 'test-internal-token',
      LIVEKIT_URL: 'http://livekit.invalid',
      LIVEKIT_PUBLIC_URL: 'wss://livekit.invalid',
      LIVEKIT_API_KEY: 'test-livekit-key',
      LIVEKIT_API_SECRET: 'test-livekit-secret-long-enough',
      RAZORPAY_KEY_ID: 'rzp_test_key',
      RAZORPAY_KEY_SECRET: 'rzp_test_secret',
      RAZORPAY_WEBHOOK_SECRET: 'rzp_test_webhook_secret',
      // Deliberately short so the rate-limit tests do not have to sleep for a real minute.
      OTP_RESEND_COOLDOWN_SECONDS: '15',
      OTP_TEST_NUMBERS: '+919999900001:424242',
    },
  },
});
