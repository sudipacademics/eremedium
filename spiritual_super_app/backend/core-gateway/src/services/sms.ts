import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * The vendor's own error text stays in `detail` (logged server-side); callers only ever see the
 * generic message, so MSG91 account or template details never reach a browser.
 */
export class SmsDeliveryError extends Error {
  readonly statusCode = 502;

  constructor(readonly detail: string) {
    super('We could not send the SMS right now. Please try again in a minute.');
    this.name = 'SmsDeliveryError';
  }
}

/**
 * Logs the code instead of sending it. Used until an SMS vendor is contracted; combined with
 * OTP_DEBUG_ECHO it allows end-to-end login testing on staging.
 *
 * Deliberately logs at warn so an unconfigured vendor in a real environment is noisy rather than
 * silently "working".
 */
async function sendViaLog(phone: string, _code: string): Promise<void> {
  // Never log the code: production fail-closed still allows this provider under ALLOW_STAGING_AUTH,
  // and a warn with the OTP would undo that control.
  logger.warn(
    { phoneLast4: phone.slice(-4), provider: 'log' },
    'SMS provider not configured; OTP not delivered (log sink)',
  );
}

/**
 * MSG91 is the usual choice for Indian transactional SMS (DLT-registered template required).
 * The template must contain a ##OTP## variable, which MSG91 substitutes from `otp`.
 */
export async function sendViaMsg91(phone: string, code: string): Promise<void> {
  const phoneLast4 = phone.slice(-4);
  const fail = (detail: string): never => {
    logger.error({ phoneLast4, provider: 'msg91', detail }, 'OTP SMS delivery failed');
    throw new SmsDeliveryError(detail);
  };

  if (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
    fail('MSG91 is selected but MSG91_AUTH_KEY/MSG91_TEMPLATE_ID are missing');
  }

  // We generate and verify the code ourselves and hand it to MSG91 purely for delivery.
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.search = new URLSearchParams({
    template_id: env.MSG91_TEMPLATE_ID!,
    // MSG91 expects the number with country code and no leading '+'.
    mobile: phone.replace(/^\+/, ''),
    otp: code,
    otp_length: String(code.length),
    otp_expiry: String(Math.max(1, Math.ceil(env.OTP_TTL_SECONDS / 60))),
    // Surfaces DLT/template rejections in this response instead of failing silently later.
    realTimeResponse: '1',
    ...(env.MSG91_SENDER ? { sender: env.MSG91_SENDER } : {}),
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let status = 0;
  let text = '';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authkey: env.MSG91_AUTH_KEY! },
      body: '{}',
      signal: controller.signal,
    });
    status = response.status;
    text = await response.text().catch(() => '');
  } catch (error) {
    fail(error instanceof Error ? `MSG91 request failed: ${error.message}` : 'MSG91 request failed');
  } finally {
    clearTimeout(timeout);
  }

  // MSG91 reports most failures (bad key, unapproved template, blocked number) as HTTP 200 with
  // {"type":"error"}, so the status code alone says nothing about delivery.
  let parsed: { type?: string; message?: string } | null = null;
  try {
    parsed = JSON.parse(text) as { type?: string; message?: string };
  } catch {
    parsed = null;
  }
  if (status < 200 || status >= 300 || parsed?.type !== 'success') {
    fail(`MSG91 rejected the request: HTTP ${status} ${(parsed?.message ?? text).slice(0, 200)}`);
  }
}

export async function sendSms(phone: string, code: string): Promise<void> {
  switch (env.SMS_PROVIDER) {
    case 'msg91':
      return sendViaMsg91(phone, code);
    case 'log':
    default:
      return sendViaLog(phone, code);
  }
}
