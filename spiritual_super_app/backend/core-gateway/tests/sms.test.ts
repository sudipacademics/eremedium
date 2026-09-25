import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = await import('../src/config/env.js');
const { sendViaMsg91, SmsDeliveryError } = await import('../src/services/sms.js');

const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { ...mutableEnv };

function reply(status: number, body: string) {
  return vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'content-type': 'application/json' } }));
}

describe('MSG91 delivery', () => {
  beforeEach(() => {
    Object.assign(mutableEnv, {
      MSG91_AUTH_KEY: 'test-auth-key-123',
      MSG91_TEMPLATE_ID: 'tmpl-otp-1',
      MSG91_SENDER: 'VEDSTR',
      OTP_TTL_SECONDS: 300,
    });
  });

  afterEach(() => {
    Object.assign(mutableEnv, saved);
    vi.unstubAllGlobals();
  });

  it('posts the code to the v5 OTP API with the auth key in a header', async () => {
    const fetchMock = reply(200, '{"type":"success","request_id":"abc"}');
    vi.stubGlobal('fetch', fetchMock);

    await sendViaMsg91('+919812345678', '482913');

    const [url, init] = fetchMock.mock.calls[0]! as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://control.msg91.com/api/v5/otp');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template_id: 'tmpl-otp-1',
      mobile: '919812345678',
      otp: '482913',
      otp_length: '6',
      otp_expiry: '5',
      realTimeResponse: '1',
      sender: 'VEDSTR',
    });
    expect(url.searchParams.has('authkey')).toBe(false);
    expect((init.headers as Record<string, string>).authkey).toBe('test-auth-key-123');
    expect(init.method).toBe('POST');
  });

  it('treats an HTTP 200 {"type":"error"} as a failure and hides the vendor text from users', async () => {
    vi.stubGlobal('fetch', reply(200, '{"type":"error","message":"Template ID is not approved"}'));

    const error = await sendViaMsg91('+919812345678', '482913').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SmsDeliveryError);
    const delivery = error as InstanceType<typeof SmsDeliveryError>;
    expect(delivery.statusCode).toBe(502);
    expect(delivery.message).toBe('We could not send the SMS right now. Please try again in a minute.');
    expect(delivery.detail).toContain('Template ID is not approved');
  });

  it('fails on non-2xx and on network errors', async () => {
    vi.stubGlobal('fetch', reply(401, '{"type":"error","message":"Authentication failure"}'));
    await expect(sendViaMsg91('+919812345678', '111111')).rejects.toThrow(SmsDeliveryError);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const error = (await sendViaMsg91('+919812345678', '111111').catch((caught: unknown) => caught)) as InstanceType<
      typeof SmsDeliveryError
    >;
    expect(error.detail).toContain('ECONNRESET');
  });

  it('refuses to call MSG91 without a template', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mutableEnv.MSG91_TEMPLATE_ID = undefined;

    await expect(sendViaMsg91('+919812345678', '111111')).rejects.toThrow(SmsDeliveryError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
