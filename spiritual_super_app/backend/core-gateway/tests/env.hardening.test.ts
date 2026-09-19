import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Env validation runs at import time. Each case loads a fresh module copy with a tailored
 * process.env so production fail-closed rules can be asserted without poisoning later suites.
 */
async function loadEnvModule(overrides: Record<string, string>) {
  vi.resetModules();
  const snapshot = { ...process.env };
  const base: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379/0',
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-to-pass-validation',
    ASTRO_SERVICE_URL: 'http://astro.invalid',
    INTERNAL_SERVICE_TOKEN: 'test-internal-token-that-is-long-enough',
    LIVEKIT_URL: 'http://livekit.invalid',
    LIVEKIT_PUBLIC_URL: 'wss://livekit.invalid',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'test-livekit-secret-long-enough',
    SMS_PROVIDER: 'msg91',
    MSG91_AUTH_KEY: 'msg91-auth-key-value',
    MSG91_TEMPLATE_ID: 'tmpl',
    OTP_DEBUG_ECHO: 'false',
    ALLOW_STAGING_AUTH: 'false',
    OTP_TEST_NUMBERS: '',
    ...overrides,
  };
  // Clear keys we control, then apply the fixture.
  for (const key of Object.keys(base)) {
    delete process.env[key];
  }
  Object.assign(process.env, base);

  try {
    return await import('../src/config/env.js');
  } finally {
    // Restore the vitest.config.ts environment for subsequent files.
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, snapshot);
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('production auth fail-closed', () => {
  it('rejects log SMS without ALLOW_STAGING_AUTH', async () => {
    await expect(loadEnvModule({ SMS_PROVIDER: 'log', MSG91_AUTH_KEY: '' })).rejects.toThrow(
      /SMS_PROVIDER/,
    );
  });

  it('rejects OTP_TEST_NUMBERS without ALLOW_STAGING_AUTH', async () => {
    await expect(
      loadEnvModule({ OTP_TEST_NUMBERS: '+919000000001:123456' }),
    ).rejects.toThrow(/OTP_TEST_NUMBERS/);
  });

  it('allows log SMS when ALLOW_STAGING_AUTH is set', async () => {
    const mod = await loadEnvModule({
      SMS_PROVIDER: 'log',
      MSG91_AUTH_KEY: '',
      ALLOW_STAGING_AUTH: 'true',
      OTP_TEST_NUMBERS: '+919000000001:123456',
    });
    expect(mod.env.ALLOW_STAGING_AUTH).toBe(true);
    expect(mod.env.SMS_PROVIDER).toBe('log');
  });
});
