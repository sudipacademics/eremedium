/**
 * HEC mother-server bridge: HMAC session accept + Frappe ingest callbacks.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { URL } from 'node:url';

const secret = () => String(process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET || '').trim();

export function b64urlDecode(data) {
  const pad = '='.repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function verifyHecToken(token) {
  const hmacSecret = secret();
  if (!hmacSecret) throw new Error('ONBOARD_HMAC_SECRET is not configured');
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('Invalid token format');
  const [body, sig] = parts;
  const expected = createHmac('sha256', hmacSecret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Invalid token signature');
  const claims = JSON.parse(b64urlDecode(body).toString('utf8'));
  if (Number(claims.exp || 0) < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  if (!claims.fp) throw new Error('Token missing franchisee id (fp)');
  return claims;
}

/** Stable canonical JSON for HMAC (must match Frappe ingest). */
export function canonicalOnboardingPayload(payload) {
  const ordered = {
    franchisee_id: String(payload.franchisee_id || ''),
    session_id: String(payload.session_id || ''),
    aadhaar_ref: String(payload.aadhaar_ref || ''),
    status: String(payload.status || 'Completed'),
    agreement_pdf_b64: String(payload.agreement_pdf_b64 || ''),
    agreement_filename: String(payload.agreement_filename || 'signed-agreement.pdf'),
    notes: String(payload.notes || ''),
  };
  return JSON.stringify(ordered);
}

function postForm(urlString, headers, bodyBuf) {
  const u = new URL(urlString);
  const lib = u.protocol === 'https:' ? https : http;
  const port = u.port || (u.protocol === 'https:' ? 443 : 80);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': bodyBuf.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

export async function notifyFrappeOnboardingResult({
  franchiseeId,
  sessionId = '',
  aadhaarRef = '',
  status = 'Completed',
  agreementPdfBytes = null,
  agreementFilename = 'signed-agreement.pdf',
  notes = '',
}) {
  const callbackUrl = String(
    process.env.FRAPPE_CALLBACK_URL
      || 'http://backend:8000/api/method/health_ecosystem_core.health_ecosystem_core.api.ingest_onboarding_result',
  ).trim();
  const hmacSecret = secret();
  if (!hmacSecret || !franchiseeId) {
    console.warn('[hec-bridge] skip Frappe callback (missing secret or franchiseeId)');
    return null;
  }
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const payload = {
    franchisee_id: franchiseeId,
    session_id: sessionId,
    aadhaar_ref: aadhaarRef,
    status,
    agreement_pdf_b64: agreementPdfBytes ? Buffer.from(agreementPdfBytes).toString('base64') : '',
    agreement_filename: agreementFilename,
    notes,
  };
  const canonical = canonicalOnboardingPayload(payload);
  const signature = createHmac('sha256', hmacSecret).update(canonical).digest('hex');

  // Single hec_payload field = exact canonical JSON that was signed.
  // Do not use form key `data` — Frappe reserves it and can raise stream errors.
  const form = new URLSearchParams();
  form.set('hec_payload', canonical);
  const raw = Buffer.from(form.toString());
  const response = await postForm(
    callbackUrl,
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Onboard-Signature': signature,
      'X-Frappe-Site': site,
      Host: site,
    },
    raw,
  );
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = { raw: response.text };
  }
  if (response.status < 200 || response.status >= 300) {
    console.error('[hec-bridge] Frappe callback failed', response.status, response.text.slice(0, 500));
    throw new Error(`Frappe callback failed: ${response.status}`);
  }
  console.log('[hec-bridge] Frappe callback ok', franchiseeId, status);
  return json;
}

function frappeMethodUrl(methodPath) {
  const base = String(
    process.env.FRAPPE_API_BASE_URL
      || process.env.FRAPPE_OTP_BASE_URL
      || 'http://backend:8000',
  ).trim().replace(/\/+$/, '');
  return `${base}/api/method/${methodPath}`;
}

function unwrapFrappeMessage(json) {
  if (!json || typeof json !== 'object') return null;
  const message = json.message;
  if (message && typeof message === 'object') return message;
  return json;
}

function frappePayloadError(message) {
  if (!message || typeof message !== 'object') return 'OTP request failed.';
  if (message.status === 'error') return String(message.message || 'OTP request failed.');
  if (message.success === false) return String(message.message || message.error || 'OTP request failed.');
  return '';
}

/**
 * Send OTP through ERP MSG91 stack (same path as erp.e-remedium.in patient OTP).
 * Returns { mobile, expires_in, test_mode }.
 */
export async function sendOtpViaErp(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw new Error('Enter a valid 10-digit Indian mobile number.');
  }
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const form = new URLSearchParams();
  form.set('mobile', digits);
  const raw = Buffer.from(form.toString());
  const response = await postForm(
    frappeMethodUrl('health_ecosystem_core.health_ecosystem_core.otp_auth.send_otp'),
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'X-Frappe-Site': site,
      Host: site,
    },
    raw,
  );
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = { raw: response.text };
  }
  const message = unwrapFrappeMessage(json);
  const err = frappePayloadError(message);
  if (response.status < 200 || response.status >= 300 || err) {
    throw new Error(err || `OTP send failed (${response.status})`);
  }
  const data = message?.data && typeof message.data === 'object' ? message.data : {};
  return {
    mobile: String(data.mobile || digits),
    expires_in: Number(data.expires_in || 300),
    test_mode: Boolean(data.test_mode),
    hint: data.hint ? String(data.hint) : '',
  };
}

/**
 * Verify OTP through ERP cache (MSG91-delivered code). Does not create a Frappe session.
 */
export async function verifyOtpViaErp(mobile, otp) {
  const digits = String(mobile || '').replace(/\D/g, '').slice(-10);
  const code = String(otp || '').trim();
  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw new Error('Invalid mobile number for OTP verification.');
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Enter the 6-digit OTP.');
  }
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const form = new URLSearchParams();
  form.set('mobile', digits);
  form.set('otp', code);
  const raw = Buffer.from(form.toString());
  const response = await postForm(
    frappeMethodUrl('health_ecosystem_core.health_ecosystem_core.otp_auth.verify_otp'),
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'X-Frappe-Site': site,
      Host: site,
    },
    raw,
  );
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = { raw: response.text };
  }
  const message = unwrapFrappeMessage(json);
  const err = frappePayloadError(message);
  if (response.status === 401 || err) {
    throw new Error(err || 'The OTP is incorrect or expired.');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(err || `OTP verify failed (${response.status})`);
  }
  return {
    mobile: String(message?.data?.mobile || digits),
    verified: true,
    test_mode: Boolean(message?.data?.test_mode),
  };
}

/** Local/dev fallback when ERP OTP bridge is disabled. */
export function rfmsOtpUsesErp() {
  const flag = String(process.env.RFMS_OTP_VIA_ERP ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(flag);
}

export function rfmsDevOtpEnabled() {
  const flag = String(process.env.RFMS_OTP_DEV_FALLBACK ?? '').trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(flag)) return true;
  // Keep localhost demos working when ERP bridge is explicitly off.
  return !rfmsOtpUsesErp();
}

export async function loadUploadBytes(uploadsDirectory, fileUrl) {
  if (!fileUrl) return null;
  const match = String(fileUrl).match(/\/uploads\/([A-Za-z0-9._-]+)$/);
  if (!match) return null;
  try {
    return await readFile(path.join(uploadsDirectory, match[1]));
  } catch {
    return null;
  }
}
