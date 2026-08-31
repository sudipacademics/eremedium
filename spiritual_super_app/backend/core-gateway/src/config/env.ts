import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('ssa-core-gateway'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 12),

  ASTRO_SERVICE_URL: z.string().url(),
  INTERNAL_SERVICE_TOKEN: z.string().min(8),

  LIVEKIT_URL: z.string().url(),
  LIVEKIT_PUBLIC_URL: z.string().default('wss://localhost/rtc'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(16),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 2),

  BILLING_TICK_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  MIN_CALL_MINUTES_BUFFER: z.coerce.number().int().min(1).max(60).default(5),
  BILLING_LOCK_TTL_MS: z.coerce.number().int().min(1_000).default(10_000),
  CALL_QUEUE_CLAIM_TTL_SECONDS: z.coerce.number().int().min(10).default(120),
});

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: AppEnv = loadEnv();
