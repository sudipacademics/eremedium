import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export class SmsDeliveryError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
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
async function sendViaLog(phone: string, code: string): Promise<void> {
  logger.warn({ phone, code, provider: 'log' }, 'SMS provider not configured; OTP written to logs only');
}

/**
 * MSG91 is the usual choice for Indian transactional SMS (DLT-registered template required).
 * The template must contain a ##OTP## variable, which MSG91 substitutes from `otp`.
 */
async function sendViaMsg91(phone: string, code: string): Promise<void> {
  if (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
    throw new SmsDeliveryError('MSG91 is selected but MSG91_AUTH_KEY/MSG91_TEMPLATE_ID are missing');
  }

  // MSG91 expects the number without a leading '+'.
  const mobile = phone.replace(/^\+/, '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authkey: env.MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: env.MSG91_TEMPLATE_ID,
        mobile,
        otp: code,
        ...(env.MSG91_SENDER ? { sender: env.MSG91_SENDER } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      throw new SmsDeliveryError(`MSG91 rejected the request: ${response.status} ${body.slice(0, 200)}`);
    }
  } catch (error) {
    if (error instanceof SmsDeliveryError) {
      throw error;
    }
    throw new SmsDeliveryError(
      error instanceof Error ? `MSG91 request failed: ${error.message}` : 'MSG91 request failed',
    );
  } finally {
    clearTimeout(timeout);
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
