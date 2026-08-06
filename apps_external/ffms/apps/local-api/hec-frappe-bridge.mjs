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

/**
 * Send Email OTP via MSG91 (ERP). MSG91 generates and emails the code.
 */
export async function sendEmailOtpViaErp(email) {
  const recipient = String(email || '').trim().toLowerCase();
  if (!recipient || !recipient.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const form = new URLSearchParams();
  form.set('email', recipient);
  const raw = Buffer.from(form.toString());
  const response = await postForm(
    frappeMethodUrl('health_ecosystem_core.health_ecosystem_core.otp_auth.send_email_otp'),
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
    throw new Error(err || `Email OTP send failed (${response.status})`);
  }
  const data = message?.data && typeof message.data === 'object' ? message.data : {};
  return {
    email: String(data.email || recipient),
    expires_in: Number(data.expires_in || 300),
    test_mode: Boolean(data.test_mode),
    hint: data.hint ? String(data.hint) : '',
    channel: 'email',
  };
}

/**
 * Verify MSG91 Email OTP through ERP (no Frappe session).
 */
export async function verifyEmailOtpViaErp(email, otp) {
  const recipient = String(email || '').trim().toLowerCase();
  const code = String(otp || '').trim();
  if (!recipient || !recipient.includes('@')) {
    throw new Error('Invalid email for OTP verification.');
  }
  if (!/^\d{4,8}$/.test(code)) {
    throw new Error('Enter the OTP from your email.');
  }
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const form = new URLSearchParams();
  form.set('email', recipient);
  form.set('otp', code);
  const raw = Buffer.from(form.toString());
  const response = await postForm(
    frappeMethodUrl('health_ecosystem_core.health_ecosystem_core.otp_auth.verify_email_otp'),
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
    throw new Error(err || `Email OTP verify failed (${response.status})`);
  }
  return {
    email: String(message?.data?.email || recipient),
    verified: true,
    test_mode: Boolean(message?.data?.test_mode),
    channel: 'email',
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

export function rfmsContactOtpUsesErp() {
  const flag = String(process.env.RFMS_CONTACT_OTP_VIA_ERP ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(flag);
}

export function rfmsGatewaySimulate() {
  const flag = String(process.env.RFMS_GATEWAY_SIMULATE ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(flag);
}

function signCanonical(canonical) {
  const hmacSecret = secret();
  if (!hmacSecret) throw new Error('ONBOARD_HMAC_SECRET is not configured');
  return createHmac('sha256', hmacSecret).update(canonical).digest('hex');
}

async function postSignedHecMethod(methodPath, canonical) {
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const signature = signCanonical(canonical);
  const form = new URLSearchParams();
  form.set('hec_payload', canonical);
  const raw = Buffer.from(form.toString());
  const response = await postForm(
    frappeMethodUrl(methodPath),
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
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
  const message = unwrapFrappeMessage(json);
  const err = frappePayloadError(message);
  if (response.status === 401 || (err && /signature|authenticated/i.test(err))) {
    throw new Error(err || 'ERP bridge authentication failed.');
  }
  if (response.status < 200 || response.status >= 300 || err) {
    throw new Error(err || `ERP bridge call failed (${response.status})`);
  }
  const data = message?.data && typeof message.data === 'object' ? message.data : message;
  return data && typeof data === 'object' ? data : {};
}

/** Safe public config from mother ERP (never includes Razorpay/MSG91 secrets). */
export async function fetchRfmsIntegrationConfig() {
  const canonical = JSON.stringify({
    action: 'get_rfms_integration_config',
    ts: String(Math.floor(Date.now() / 1000)),
  });
  return postSignedHecMethod(
    'health_ecosystem_core.health_ecosystem_core.api.get_rfms_integration_config',
    canonical,
  );
}

export async function createRfmsRazorpayOrderViaErp({
  amount,
  applicationId = '',
  paymentKey = '',
  receipt = '',
  currency = 'INR',
} = {}) {
  const canonical = JSON.stringify({
    action: 'create_rfms_razorpay_order',
    amount: String(Number(amount) || 0),
    application_id: String(applicationId || ''),
    currency: String(currency || 'INR'),
    payment_key: String(paymentKey || ''),
    receipt: String(receipt || '').slice(0, 40),
  });
  return postSignedHecMethod(
    'health_ecosystem_core.health_ecosystem_core.api.create_rfms_razorpay_order',
    canonical,
  );
}

export async function verifyRfmsRazorpayPaymentViaErp({
  applicationId = '',
  razorpayOrderId = '',
  razorpayPaymentId = '',
  razorpaySignature = '',
} = {}) {
  const canonical = JSON.stringify({
    action: 'verify_rfms_razorpay_payment',
    application_id: String(applicationId || ''),
    razorpay_order_id: String(razorpayOrderId || ''),
    razorpay_payment_id: String(razorpayPaymentId || ''),
    razorpay_signature: String(razorpaySignature || ''),
  });
  return postSignedHecMethod(
    'health_ecosystem_core.health_ecosystem_core.api.verify_rfms_razorpay_payment',
    canonical,
  );
}

/** Phase 85c: create/update Franchisee Profile + opening wallet after paid milestone. */
export async function activateRfmsPaidFranchiseeViaErp({
  applicationId = '',
  applicationNumber = '',
  businessName = '',
  depositAmount = 0,
  district = '',
  email = '',
  franchiseModel = '',
  franchiseeProfile = '',
  fullName = '',
  mobile = '',
  paymentKey = '',
  pincode = '',
  preferredLocation = '',
  registeredAddress = '',
  territoryRegion = '',
} = {}) {
  const amount = Number(depositAmount) || 0;
  const amountCanonical = Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(2)));
  const canonical = JSON.stringify({
    action: 'activate_rfms_paid_franchisee',
    application_id: String(applicationId || ''),
    application_number: String(applicationNumber || ''),
    business_name: String(businessName || ''),
    deposit_amount: amountCanonical,
    district: String(district || ''),
    email: String(email || '').toLowerCase(),
    franchise_model: String(franchiseModel || '').toUpperCase(),
    franchisee_profile: String(franchiseeProfile || ''),
    full_name: String(fullName || ''),
    mobile: String(mobile || ''),
    payment_key: String(paymentKey || ''),
    pincode: String(pincode || ''),
    preferred_location: String(preferredLocation || ''),
    registered_address: String(registeredAddress || ''),
    territory_region: String(territoryRegion || ''),
  });
  return postSignedHecMethod(
    'health_ecosystem_core.health_ecosystem_core.api.activate_rfms_paid_franchisee',
    canonical,
  );
}

export async function provisionPartnerPortalCredentialsViaErp({
  applicationId = '',
  applicationNumber = '',
  businessName = '',
  district = '',
  email = '',
  franchiseModel = '',
  franchiseeProfile = '',
  fullName = '',
  loginUrl = 'https://partners.e-remedium.in',
  mobile = '',
  password = '',
  pincode = '',
  preferredLocation = '',
  registeredAddress = '',
  territoryRegion = '',
} = {}) {
  const canonical = JSON.stringify({
    action: 'provision_partner_portal_credentials',
    application_id: String(applicationId || ''),
    application_number: String(applicationNumber || ''),
    business_name: String(businessName || ''),
    district: String(district || ''),
    email: String(email || '').toLowerCase(),
    franchise_model: String(franchiseModel || '').toUpperCase(),
    franchisee_profile: String(franchiseeProfile || ''),
    full_name: String(fullName || ''),
    login_url: String(loginUrl || 'https://partners.e-remedium.in').replace(/\/+$/, ''),
    mobile: String(mobile || ''),
    password: String(password || ''),
    pincode: String(pincode || ''),
    preferred_location: String(preferredLocation || ''),
    registered_address: String(registeredAddress || ''),
    territory_region: String(territoryRegion || ''),
  });
  return postSignedHecMethod(
    'health_ecosystem_core.health_ecosystem_core.api.provision_partner_portal_credentials',
    canonical,
  );
}

/** Refresh Partner Portal hub name/branch details from Franchise Directory (no password change). */
export async function syncRfmsHubFromDirectoryViaErp({
  applicationId = '',
  applicationNumber = '',
  businessName = '',
  district = '',
  email = '',
  franchiseModel = '',
  franchiseeProfile = '',
  fullName = '',
  mobile = '',
  pincode = '',
  preferredLocation = '',
  registeredAddress = '',
  territoryRegion = '',
} = {}) {
  const canonical = JSON.stringify({
    action: 'sync_rfms_hub_from_directory',
    application_id: String(applicationId || ''),
    application_number: String(applicationNumber || ''),
    business_name: String(businessName || ''),
    district: String(district || ''),
    email: String(email || '').toLowerCase(),
    franchise_model: String(franchiseModel || '').toUpperCase(),
    franchisee_profile: String(franchiseeProfile || ''),
    full_name: String(fullName || ''),
    mobile: String(mobile || ''),
    pincode: String(pincode || ''),
    preferred_location: String(preferredLocation || ''),
    registered_address: String(registeredAddress || ''),
    territory_region: String(territoryRegion || ''),
  });
  return postSignedHecMethod(
    'health_ecosystem_core.health_ecosystem_core.api.sync_rfms_hub_from_directory',
    canonical,
  );
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

function getJson(urlString, headers = {}) {
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
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
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
    req.end();
  });
}

/** WB district → subdivision → block/PIN hierarchy from mother ERP. */
export async function fetchWbGeoHierarchy() {
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const response = await getJson(frappeMethodUrl('health_ecosystem_core.health_ecosystem_core.api.get_wb_geo_hierarchy'), {
    'X-Frappe-Site': site,
    Host: site,
  });
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = { raw: response.text };
  }
  const message = unwrapFrappeMessage(json);
  const err = frappePayloadError(message);
  if (response.status < 200 || response.status >= 300 || err) {
    throw new Error(err || `WB geo hierarchy failed (${response.status})`);
  }
  const data = message?.data && typeof message.data === 'object' ? message.data : message;
  return data && typeof data === 'object' ? data : { districts: [], count: 0 };
}

export async function resolveWbPincodeViaErp(pincode) {
  const pin = String(pincode || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(pin)) throw new Error('Enter a valid 6-digit PIN code.');
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const url = `${frappeMethodUrl('health_ecosystem_core.health_ecosystem_core.api.resolve_wb_pincode')}?pincode=${encodeURIComponent(pin)}`;
  const response = await getJson(url, { 'X-Frappe-Site': site, Host: site });
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = { raw: response.text };
  }
  const message = unwrapFrappeMessage(json);
  const err = frappePayloadError(message);
  if (response.status < 200 || response.status >= 300 || err) {
    throw new Error(err || `PIN resolve failed (${response.status})`);
  }
  const data = message?.data && typeof message.data === 'object' ? message.data : message;
  return data && typeof data === 'object' ? data : { pincode: pin, matches: [], count: 0 };
}

/** Phase 86 — ERP franchise ads webhook method path (Meta/Google configure this URL). */
export function franchiseAdsIngestMethodUrl() {
  return frappeMethodUrl('health_ecosystem_core.health_ecosystem_core.api.ingest_franchise_ad_lead');
}

export function franchiseAdsWebhookSecret() {
  return String(process.env.FRANCHISE_ADS_WEBHOOK_SECRET || process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET || '').trim();
}

export function whatsappCloudWebhookSecret() {
  return String(process.env.WHATSAPP_CLOUD_WEBHOOK_SECRET || process.env.FRANCHISE_ADS_WEBHOOK_SECRET || process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET || '').trim();
}

async function postWhatsappCloudMethod(methodPath, fields = {}) {
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const secret = whatsappCloudWebhookSecret();
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    form.set(key, String(value));
  }
  const raw = Buffer.from(form.toString());
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'X-Frappe-Site': site,
    Host: site,
  };
  if (secret) headers['X-WhatsApp-Cloud-Secret'] = secret;
  const response = await postForm(frappeMethodUrl(methodPath), headers, raw);
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = { raw: response.text };
  }
  const message = unwrapFrappeMessage(json);
  const err = frappePayloadError(message);
  if (response.status < 200 || response.status >= 300 || err) {
    throw new Error(err || `WhatsApp Cloud ERP call failed (${response.status})`);
  }
  const data = message?.data && typeof message.data === 'object' ? message.data : message;
  return data && typeof data === 'object' ? data : {};
}

export async function fetchFranchiseWhatsappThreadViaErp({ phone = '', rfmsLeadId = '', conversationId = '' } = {}) {
  return postWhatsappCloudMethod('health_ecosystem_core.health_ecosystem_core.api.get_franchise_whatsapp_thread', {
    phone,
    rfms_lead_id: rfmsLeadId,
    conversation_id: conversationId,
  });
}

export async function sendFranchiseWhatsappReplyViaErp({ phone = '', message = '', rfmsLeadId = '', conversationId = '' } = {}) {
  return postWhatsappCloudMethod('health_ecosystem_core.health_ecosystem_core.api.send_franchise_whatsapp_reply', {
    phone,
    message,
    rfms_lead_id: rfmsLeadId,
    conversation_id: conversationId,
  });
}

async function postFranchiseAdsMethod(methodPath, fields = {}) {
  const site = process.env.FRAPPE_SITE || 'health.localhost';
  const secret = franchiseAdsWebhookSecret();
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    form.set(key, String(value));
  }
  const raw = Buffer.from(form.toString());
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'X-Frappe-Site': site,
    Host: site,
  };
  if (secret) headers['X-Franchise-Ads-Secret'] = secret;
  const response = await postForm(frappeMethodUrl(methodPath), headers, raw);
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = { raw: response.text };
  }
  const message = unwrapFrappeMessage(json);
  const err = frappePayloadError(message);
  if (response.status < 200 || response.status >= 300 || err) {
    throw new Error(err || `REACH sync ERP call failed (${response.status})`);
  }
  const data = message?.data && typeof message.data === 'object' ? message.data : message;
  return data && typeof data === 'object' ? data : {};
}

export async function listReachRepsViaErp() {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_list_reach_reps', {});
}

export async function assignReachLeadViaErp({
  hecLeadId = '',
  rfmsLeadId = '',
  salesRepId = '',
  assignedToName = '',
  assigneeRole = 'reach',
  createVisit = true,
  assignedFrom = 'FFMS Admin',
  lead = null,
} = {}) {
  const payload = {
    hec_lead_id: hecLeadId,
    rfms_lead_id: rfmsLeadId,
    sales_rep_id: salesRepId,
    assigned_to_name: assignedToName,
    assignee_role: assigneeRole,
    create_visit: createVisit ? '1' : '0',
    assigned_from: assignedFrom,
  };
  if (lead && typeof lead === 'object') {
    payload.lead_json = JSON.stringify(lead);
    for (const key of [
      'name', 'lead_name', 'email', 'phone', 'mobile', 'territory_query', 'address',
      'notes', 'stage', 'source', 'campaign_name', 'franchise_model', 'city', 'district', 'pincode',
    ]) {
      if (lead[key] != null && String(lead[key]).trim()) payload[`lead_${key}`] = lead[key];
    }
  }
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_assign_reach_lead', payload);
}

export async function updateReachLeadStatusViaErp({ hecLeadId = '', rfmsLeadId = '', stage = '', status = '' } = {}) {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_update_lead_status', {
    hec_lead_id: hecLeadId,
    rfms_lead_id: rfmsLeadId,
    stage,
    status,
  });
}

export async function archiveReachLeadViaErp({ hecLeadId = '', rfmsLeadId = '', reason = 'Deleted from FFMS Admin' } = {}) {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_archive_reach_lead', {
    hec_lead_id: hecLeadId,
    rfms_lead_id: rfmsLeadId,
    reason,
  });
}

export async function archiveFieldVisitViaErp({ hecVisitId = '', reason = 'Deleted from FFMS Admin' } = {}) {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_archive_field_visit', {
    hec_visit_id: hecVisitId,
    reason,
  });
}

export async function disablePartnerPortalViaErp({
  franchiseeProfile = '',
  userId = '',
  franchiseeId = '',
  reason = 'Deleted or deboarded from FFMS Admin',
} = {}) {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_disable_partner_portal', {
    franchisee_profile: franchiseeProfile,
    user_id: userId,
    franchisee_id: franchiseeId,
    reason,
  });
}

export async function deboardFranchiseeViaErp({
  franchiseeProfile = '',
  franchiseeId = '',
  reason = 'Deboarded from FFMS Admin',
} = {}) {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_deboard_franchisee', {
    franchisee_profile: franchiseeProfile,
    franchisee_id: franchiseeId,
    reason,
  });
}

export async function updateB2bSalesStatusViaErp({
  hecSalesId = '',
  status = '',
  assignedLogisticsPerson = '',
  remarks = '',
} = {}) {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_update_b2b_sales_status', {
    hec_sales_id: hecSalesId,
    status,
    assigned_logistics_person: assignedLogisticsPerson,
    remarks,
  });
}

export async function updateB2bCentreViaErp({ hecCentreId = '', status = '', logisticsAssignments = [] } = {}) {
  return postFranchiseAdsMethod('health_ecosystem_core.health_ecosystem_core.api.ffms_update_b2b_centre', {
    hec_centre_id: hecCentreId,
    status,
    logistics_assignments: logisticsAssignments,
  });
}
