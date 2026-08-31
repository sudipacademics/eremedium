import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { redis, redisKeys } from '../lib/redis.js';
import { sendSms } from './sms.js';

export class OtpRateLimitedError extends Error {
  readonly statusCode = 429;

  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = 'OtpRateLimitedError';
  }
}

export class OtpInvalidError extends Error {
  readonly statusCode = 401;

  constructor(message = 'Invalid or expired code') {
    super(message);
    this.name = 'OtpInvalidError';
  }
}

interface OtpRecord {
  hash: string;
  attempts: number;
}

export interface OtpChallenge {
  readonly expiresInSeconds: number;
  readonly resendAfterSeconds: number;
  /** Populated only when OTP_DEBUG_ECHO is on, which env.ts forbids in production. */
  readonly debugCode?: string;
}

/**
 * Peppered HMAC rather than a bare hash: a 6-digit code has only a million possibilities, so an
 * attacker who dumps Redis could otherwise recover every live code instantly with a rainbow table.
 */
function hashCode(phone: string, code: string): string {
  const pepper = env.OTP_PEPPER ?? env.JWT_SECRET;
  return createHmac('sha256', pepper).update(`${phone}:${code}`).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function generateCode(): string {
  // randomInt is CSPRNG-backed; Math.random would make codes predictable from prior codes.
  const max = 10 ** env.OTP_LENGTH;
  return randomInt(0, max).toString().padStart(env.OTP_LENGTH, '0');
}

export const OtpService = {
  /**
   * Issues a code for `phone`. Callers MUST NOT vary their response based on whether the phone is
   * already registered, or this endpoint becomes a user-enumeration oracle.
   */
  async request(phone: string): Promise<OtpChallenge> {
    const cooldownKey = redisKeys.otpCooldown(phone);
    const cooldownTtl = await redis.ttl(cooldownKey);
    if (cooldownTtl > 0) {
      throw new OtpRateLimitedError('A code was just sent; wait before requesting another', cooldownTtl);
    }

    // Fixed window per phone. Caps vendor spend and stops using our SMS budget as an SMS bomb.
    const windowKey = redisKeys.otpRequestCount(phone);
    const count = await redis.incr(windowKey);
    if (count === 1) {
      await redis.expire(windowKey, env.OTP_REQUEST_WINDOW_SECONDS);
    }
    if (count > env.OTP_REQUEST_MAX_PER_WINDOW) {
      const ttl = await redis.ttl(windowKey);
      throw new OtpRateLimitedError(
        'Too many codes requested for this number; try again later',
        ttl > 0 ? ttl : env.OTP_REQUEST_WINDOW_SECONDS,
      );
    }

    /*
     * Staging test numbers get a fixed code so the app can be demonstrated without a live SMS
     * vendor. Deliberately implemented by seeding the NORMAL challenge rather than adding a bypass
     * in verify(): the hash, TTL, attempt cap and single-use deletion all still apply, and there is
     * no code path that skips verification. Only numbers explicitly listed in env are affected, and
     * the list is empty by default.
     */
    const fixedCode = env.OTP_TEST_NUMBERS[phone];
    const code = fixedCode ?? generateCode();
    const record: OtpRecord = { hash: hashCode(phone, code), attempts: 0 };
    await redis.set(redisKeys.otpChallenge(phone), JSON.stringify(record), 'EX', env.OTP_TTL_SECONDS);
    await redis.set(cooldownKey, '1', 'EX', env.OTP_RESEND_COOLDOWN_SECONDS);

    if (fixedCode) {
      logger.warn({ phone }, 'Issued fixed staging OTP for an allowlisted test number');
    } else {
      await sendSms(phone, code);
    }

    return {
      expiresInSeconds: env.OTP_TTL_SECONDS,
      resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
      ...(env.OTP_DEBUG_ECHO ? { debugCode: code } : {}),
    };
  },

  /**
   * Consumes the challenge on success. Deletes it on attempt exhaustion so a stolen phone number
   * cannot be brute-forced across a million guesses within the TTL.
   */
  async verify(phone: string, code: string): Promise<void> {
    const key = redisKeys.otpChallenge(phone);
    const raw = await redis.get(key);
    if (!raw) {
      throw new OtpInvalidError();
    }

    let record: OtpRecord;
    try {
      record = JSON.parse(raw) as OtpRecord;
    } catch {
      await redis.del(key);
      throw new OtpInvalidError();
    }

    if (!constantTimeEquals(record.hash, hashCode(phone, code))) {
      const attempts = record.attempts + 1;
      if (attempts >= env.OTP_MAX_VERIFY_ATTEMPTS) {
        await redis.del(key);
        logger.warn({ phone }, 'OTP challenge destroyed after too many failed attempts');
        throw new OtpInvalidError('Too many incorrect attempts; request a new code');
      }
      // Preserve the original TTL: refreshing it would let an attacker extend the window forever.
      const ttl = await redis.ttl(key);
      await redis.set(
        key,
        JSON.stringify({ ...record, attempts } satisfies OtpRecord),
        'EX',
        ttl > 0 ? ttl : env.OTP_TTL_SECONDS,
      );
      throw new OtpInvalidError();
    }

    // Single-use: delete before issuing a token so the same code cannot mint two sessions.
    await redis.del(key);
    await redis.del(redisKeys.otpRequestCount(phone));
  },
} as const;
