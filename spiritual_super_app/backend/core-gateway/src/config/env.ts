import { z } from 'zod';

/** z.coerce.boolean() treats the string "false" as true, which is the opposite of what env files mean. */
const booleanFromEnv = z.enum(['true', 'false']).transform((value) => value === 'true');

const decimalAmount = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Treats an empty string as absent.
 *
 * docker-compose renders an unset `${VAR:-}` as an empty string rather than omitting the variable,
 * and a bare `.optional()` would then fail its own `.min()` check and take the whole gateway down at
 * boot instead of leaving the optional feature switched off.
 */
function optionalSecret(minLength: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(minLength).optional(),
  );
}

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

  // --- Call lifecycle backstops ----------------------------------------------------------------
  // An INITIATED session reserves the astrologer, so an invite nobody joins must expire or that
  // astrologer stays unbookable forever.
  STALE_INITIATED_SESSION_SECONDS: z.coerce.number().int().min(60).default(300),
  STALE_ACTIVE_SESSION_SECONDS: z.coerce.number().int().min(60).default(180),
  STALE_SESSION_SWEEP_SECONDS: z.coerce.number().int().min(30).default(120),

  // --- Astrologer supply side ------------------------------------------------------------------
  // Applied to new astrologer profiles. Pricing is a platform decision, never caller-supplied.
  ASTROLOGER_DEFAULT_RATE: z.string().regex(decimalAmount).default('20.00'),
  // Phone numbers (E.164, comma separated) that receive the ADMIN role at OTP login. The only way
  // to obtain admin rights, since no endpoint grants them.
  ADMIN_PHONES: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),

  // --- Phone OTP -----------------------------------------------------------------------------
  // "phone:code" pairs, comma separated, that receive a FIXED code instead of a random SMS. Lets the
  // web app be demonstrated without an SMS vendor. Empty by default; never list a real user's number.
  OTP_TEST_NUMBERS: z
    .string()
    .default('')
    .transform((value) =>
      Object.fromEntries(
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.includes(':'))
          .map((entry) => {
            const separator = entry.lastIndexOf(':');
            return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()] as const;
          })
          .filter(([phone, code]) => phone.length > 0 && /^\d{4,8}$/.test(code)),
      ),
    ),
  // Codes are peppered before hashing so a Redis dump alone cannot be brute-forced offline.
  // Defaults to JWT_SECRET to avoid a mandatory new secret on already-deployed environments.
  OTP_PEPPER: optionalSecret(16),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  OTP_REQUEST_MAX_PER_WINDOW: z.coerce.number().int().min(1).max(20).default(3),
  OTP_REQUEST_WINDOW_SECONDS: z.coerce.number().int().min(60).default(900),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).default(60),
  // Returns the code in the API response. Staging convenience ONLY; rejected in production below.
  OTP_DEBUG_ECHO: booleanFromEnv.default('false'),

  SMS_PROVIDER: z.enum(['log', 'msg91']).default('log'),
  MSG91_AUTH_KEY: optionalSecret(8),
  MSG91_TEMPLATE_ID: optionalSecret(4),
  MSG91_SENDER: optionalSecret(3),

  // --- Wallet top-up via Razorpay -------------------------------------------------------------
  // Optional so the service still boots unconfigured; the routes answer 503 until all three are
  // present, rather than the whole gateway refusing to start.
  RAZORPAY_KEY_ID: optionalSecret(8),
  RAZORPAY_KEY_SECRET: optionalSecret(8),
  RAZORPAY_WEBHOOK_SECRET: optionalSecret(8),
  RAZORPAY_API_BASE: z.string().url().default('https://api.razorpay.com/v1'),
  TOPUP_MIN_AMOUNT: z.string().regex(decimalAmount).default('10.00'),
  TOPUP_MAX_AMOUNT: z.string().regex(decimalAmount).default('100000.00'),
})
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.OTP_DEBUG_ECHO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_DEBUG_ECHO'],
        message: 'OTP_DEBUG_ECHO must be false in production: it returns login codes to any caller',
      });
    }
    if (value.SMS_PROVIDER === 'msg91' && !value.MSG91_AUTH_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MSG91_AUTH_KEY'],
        message: 'MSG91_AUTH_KEY is required when SMS_PROVIDER=msg91',
      });
    }
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
