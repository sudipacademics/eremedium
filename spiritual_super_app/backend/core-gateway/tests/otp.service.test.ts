import { describe, expect, it, vi } from 'vitest';

// The log provider would otherwise print a code per test; stubbing also proves the fixed-code path
// never reaches a vendor.
const sendSms = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/sms.js', () => ({ sendSms: (...args: unknown[]) => sendSms(...args) }));

const { OtpService, OtpInvalidError, OtpRateLimitedError } = await import('../src/services/otp.service.js');
const { redis, redisKeys } = await import('../src/lib/redis.js');
const { env } = await import('../src/config/env.js');

const PHONE = '+919812345678';
const TEST_PHONE = '+919999900001'; // Allowlisted with fixed code 424242 in vitest.config.ts.

/** Lets a test request another code without waiting out the real resend cooldown. */
async function clearCooldown(phone: string): Promise<void> {
  await redis.del(redisKeys.otpCooldown(phone));
}

async function issuedCode(phone: string): Promise<string> {
  sendSms.mockClear();
  await clearCooldown(phone);
  await OtpService.request(phone);
  const call = sendSms.mock.calls.at(-1);
  return call?.[1] as string;
}

describe('requesting a code', () => {
  it('sends a code of the configured length and stores only a hash', async () => {
    const code = await issuedCode(PHONE);

    expect(code).toMatch(new RegExp(`^\\d{${env.OTP_LENGTH}}$`));

    const stored = await redis.get(redisKeys.otpChallenge(PHONE));
    expect(stored).toBeTruthy();
    const record = JSON.parse(stored!) as { hash: string; attempts: number };
    // A Redis dump must not reveal the code itself.
    expect(stored).not.toContain(code);
    expect(record.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.attempts).toBe(0);
  });

  it('expires the challenge, so a code cannot be used days later', async () => {
    await issuedCode(PHONE);
    const ttl = await redis.ttl(redisKeys.otpChallenge(PHONE));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(env.OTP_TTL_SECONDS);
  });

  it('refuses an immediate resend, so the SMS budget cannot be used as an SMS bomb', async () => {
    await issuedCode(PHONE);
    await expect(OtpService.request(PHONE)).rejects.toThrow(OtpRateLimitedError);
  });

  it('caps the number of codes per number within the window', async () => {
    for (let i = 0; i < env.OTP_REQUEST_MAX_PER_WINDOW; i += 1) {
      await clearCooldown(PHONE);
      await OtpService.request(PHONE);
    }
    await clearCooldown(PHONE);

    await expect(OtpService.request(PHONE)).rejects.toThrow(OtpRateLimitedError);
  });
});

describe('verifying a code', () => {
  it('accepts the right code and consumes it, so one code cannot mint two sessions', async () => {
    const code = await issuedCode(PHONE);

    await expect(OtpService.verify(PHONE, code)).resolves.toBeUndefined();
    await expect(OtpService.verify(PHONE, code)).rejects.toThrow(OtpInvalidError);
  });

  it('rejects a wrong code without revealing anything about the right one', async () => {
    await issuedCode(PHONE);
    await expect(OtpService.verify(PHONE, '000000')).rejects.toThrow(OtpInvalidError);
  });

  it('rejects a code for a number that never requested one', async () => {
    await expect(OtpService.verify('+919000000123', '123456')).rejects.toThrow(OtpInvalidError);
  });

  /**
   * Six digits is only a million possibilities. Without an attempt cap the code could be brute
   * forced well inside its five-minute lifetime.
   */
  it('destroys the challenge after too many wrong attempts', async () => {
    const code = await issuedCode(PHONE);

    for (let attempt = 1; attempt < env.OTP_MAX_VERIFY_ATTEMPTS; attempt += 1) {
      await expect(OtpService.verify(PHONE, '000000')).rejects.toThrow(OtpInvalidError);
    }
    await expect(OtpService.verify(PHONE, '000000')).rejects.toThrow(/Too many incorrect attempts/);

    // Even the correct code is now useless: the challenge is gone.
    expect(await redis.get(redisKeys.otpChallenge(PHONE))).toBeNull();
    await expect(OtpService.verify(PHONE, code)).rejects.toThrow(OtpInvalidError);
  });

  it('does not extend the challenge lifetime on a failed attempt', async () => {
    await issuedCode(PHONE);
    await redis.expire(redisKeys.otpChallenge(PHONE), 30);

    await expect(OtpService.verify(PHONE, '000000')).rejects.toThrow(OtpInvalidError);

    const ttl = await redis.ttl(redisKeys.otpChallenge(PHONE));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });
});

describe('staging test numbers', () => {
  it('uses the fixed code and sends no SMS for an allowlisted number', async () => {
    sendSms.mockClear();
    await clearCooldown(TEST_PHONE);

    await OtpService.request(TEST_PHONE);

    expect(sendSms).not.toHaveBeenCalled();
    await expect(OtpService.verify(TEST_PHONE, '424242')).resolves.toBeUndefined();
  });

  /**
   * The fixed code is implemented by seeding the normal challenge rather than by a bypass in
   * verify(), so every protection still applies to it. If this ever fails, the allowlist has become
   * a way around verification entirely.
   */
  it('still rejects a wrong code for an allowlisted number', async () => {
    await clearCooldown(TEST_PHONE);
    await OtpService.request(TEST_PHONE);

    await expect(OtpService.verify(TEST_PHONE, '999999')).rejects.toThrow(OtpInvalidError);
  });

  it('leaves numbers outside the allowlist on random codes', async () => {
    const code = await issuedCode(PHONE);
    expect(code).not.toBe('424242');
    await expect(OtpService.verify(PHONE, '424242')).rejects.toThrow(OtpInvalidError);
  });
});
