/**
 * CGPEY Agreement eSign adapter (verify.cgpey.com / IDTOAI).
 * Auth headers: x-merchant-id, x-api-key, x-secret-key
 * Prefer Health Ecosystem Settings via ERP bridge; env RFMS_CGPEY_* overrides.
 * Never log Aadhaar, OTP, credentials, or PDF bytes. Never put secrets in public-config.
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

/** Agreement eSign API host. Marketing/docs/KYC hosts are rewritten to verify. */
function normalizeCgpeyBaseUrl(raw) {
  const fallback = 'https://verify.cgpey.com';
  let value = String(raw || fallback).trim().replace(/\/+$/, '');
  if (!value) return fallback;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (
      host === 'www.cgpey.com'
      || host === 'cgpey.com'
      || host === 'api.cgpey.com'
      || host === 'docs.cgpey.com'
    ) {
      return fallback;
    }
    u.pathname = u.pathname
      .replace(/\/api\/v1\/esign(?:\/.*)?$/i, '')
      .replace(/\/api\/kyc(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
    return `${u.origin}${u.pathname === '/' ? '' : u.pathname}`.replace(/\/+$/, '') || fallback;
  } catch {
    return fallback;
  }
}

export function cgpeyConfigFromEnv() {
  return {
    apiKey: env('RFMS_CGPEY_API_KEY'),
    apiSecret: env('RFMS_CGPEY_API_SECRET'),
    merchantId: env('RFMS_CGPEY_MERCHANT_ID'),
    baseUrl: normalizeCgpeyBaseUrl(env('RFMS_CGPEY_BASE_URL', 'https://verify.cgpey.com')),
    simulate: ['1', 'true', 'yes', 'on'].includes(env('RFMS_CGPEY_SIMULATE', '0').toLowerCase()),
  };
}

/** @deprecated Prefer mergeCgpeyConfig() which includes ERP settings. */
export function cgpeyConfig() {
  return cgpeyConfigFromEnv();
}

export function mergeCgpeyConfig(override = null) {
  const base = cgpeyConfigFromEnv();
  if (!override || typeof override !== 'object') return base;
  return {
    apiKey: String(override.apiKey || override.cgpey_api_key || base.apiKey || '').trim(),
    apiSecret: String(override.apiSecret || override.cgpey_api_secret || base.apiSecret || '').trim(),
    merchantId: String(override.merchantId || override.cgpey_merchant_id || base.merchantId || '').trim(),
    baseUrl: normalizeCgpeyBaseUrl(override.baseUrl || override.cgpey_base_url || base.baseUrl || 'https://verify.cgpey.com'),
    simulate: Boolean(override.simulate ?? override.cgpey_simulate ?? base.simulate),
  };
}

export function cgpeyConfigured(config = null) {
  const cfg = mergeCgpeyConfig(config);
  if (cfg.simulate) return true;
  return Boolean(cfg.apiKey && cfg.apiSecret && cfg.merchantId);
}

export function cgpeySimulate(config = null) {
  return Boolean(mergeCgpeyConfig(config).simulate);
}

export function maskAadhaar(aadhaarNumber) {
  const digits = String(aadhaarNumber || '').replace(/\D/g, '');
  if (digits.length < 4) return 'XXXXXXXXXXXX';
  return `${'X'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeMobile(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) {
    const error = new Error('A valid 10-digit Indian mobile number is required for CGPEY Aadhaar eSign.');
    error.code = 'MOBILE_INVALID';
    throw error;
  }
  return ten;
}

function providerMessage(json, fallback) {
  if (!json || typeof json !== 'object') return fallback;
  if (Array.isArray(json.error) && json.error.length) return String(json.error[0]);
  const nested = json.error && typeof json.error === 'object' ? json.error : null;
  return String(
    json.message
    || nested?.message
    || json.data?.message
    || fallback,
  ).trim() || fallback;
}

/** Best-effort PDF page count from raw base64 (no PDF library). */
function pdfPageCountFromBase64(base64) {
  try {
    const text = Buffer.from(String(base64 || ''), 'base64').toString('latin1');
    if (!text.startsWith('%PDF')) return 0;
    const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^]*?\/Count\s+(\d+)/g)]
      .map((match) => Number(match[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (counts.length) return Math.max(...counts);
    const pages = (text.match(/\/Type\s*\/Page\b(?!\s*s)/g) || []).length;
    return pages > 0 ? pages : 0;
  } catch {
    return 0;
  }
}

/**
 * Operator default is page 20 for the 20-page franchise agreement template.
 * If the uploaded PDF has fewer pages, clamp to the last page so IDTOAI does not reject.
 * Override with RFMS_CGPEY_ESIGN_PAGE_NUMBER when needed.
 */
function resolveEsignPageNumber(pageCount) {
  const fallback = pageCount > 0 ? pageCount : 1;
  const raw = env('RFMS_CGPEY_ESIGN_PAGE_NUMBER', '20');
  const requested = Number.parseInt(raw, 10);
  if (!Number.isFinite(requested) || requested < 1) return String(fallback);
  if (pageCount > 0 && requested > pageCount) return String(pageCount);
  return String(requested);
}

function deepFindSigningLink(value, depth = 0) {
  if (depth > 8 || value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\/.+/i.test(trimmed) && /sign|esign|desk|melento|idto|invitation|aadhaar/i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindSigningLink(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const preferredKeys = [
      'invitation_link',
      'invitationLink',
      'signing_link',
      'signingLink',
      'esign_url',
      'esignUrl',
      'redirect_url',
      'redirectUrl',
      'url',
    ];
    for (const key of preferredKeys) {
      if (key in value) {
        const found = deepFindSigningLink(value[key], depth + 1);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value)) {
      const found = deepFindSigningLink(nested, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function invitationFrom(json) {
  const nestedErrorData = json?.error && typeof json.error === 'object' && !Array.isArray(json.error)
    ? json.error.data
    : null;
  const outer = json?.data && typeof json.data === 'object' ? json.data : null;
  // CGPEY wraps IDTOAI as data: { ..., data: { docket_id, signer_info } }
  const inner = outer?.data && typeof outer.data === 'object' ? outer.data : null;
  const candidates = [inner, outer, nestedErrorData, json].filter((item) => item && typeof item === 'object');
  const data = candidates.find((item) => (
    item.docket_id || item.docketId || item.signer_info || item.signers_info || item.invitation_link
  )) || outer || json;
  const signers = Array.isArray(data?.signer_info)
    ? data.signer_info
    : Array.isArray(data?.signers_info)
      ? data.signers_info
      : [];
  const first = signers[0] && typeof signers[0] === 'object' ? signers[0] : {};
  const invitationLink = String(
    first.invitation_link
    || first.invitationLink
    || data?.invitation_link
    || deepFindSigningLink(json)
    || '',
  ).trim();
  return {
    docketId: String(data?.docket_id || data?.docketId || '').trim(),
    documentId: String(data?.document_id || data?.documentId || first.document_id || '').trim(),
    signerId: String(first.signer_id || first.signerId || '').trim(),
    invitationLink,
    transactionId: String(
      outer?.transactionId
      || json?.error?.transactionId
      || data?.transactionId
      || json?.requestId
      || '',
    ).trim(),
  };
}

function postJson(urlString, headers, body) {
  const u = new URL(urlString);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const strictTls = ['1', 'true', 'yes', 'on'].includes(env('RFMS_CGPEY_TLS_STRICT', '0').toLowerCase());
  const agent = u.protocol === 'https:'
    ? new https.Agent({ rejectUnauthorized: strictTls, keepAlive: false })
    : undefined;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        agent,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Accept: 'application/json',
          'User-Agent': 'RFMS-CGPEY-eSign/1.0',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = null; }
          resolve({ status: res.statusCode || 0, text, json });
        });
      },
    );
    req.on('error', (error) => {
      const message = String(error?.message || error || '');
      if (/certificate|CERT_|SSL|TLS|UNABLE_TO_VERIFY/i.test(message)) {
        const wrapped = new Error(
          `Unable to connect securely to CGPEY (${u.hostname}). ${message}.`,
        );
        wrapped.code = 'CGPEY_TLS_ERROR';
        wrapped.cause = error;
        reject(wrapped);
        return;
      }
      reject(error);
    });
    req.setTimeout(60_000, () => {
      req.destroy(new Error('CGPEY eSign request timed out.'));
    });
    req.write(payload);
    req.end();
  });
}

async function cgpeyEsignPost(path, body, config = null) {
  const cfg = mergeCgpeyConfig(config);
  if (!cgpeyConfigured(cfg)) {
    const error = new Error('CGPEY eSign credentials are not configured. Paste API key, secret and merchant ID in Health Ecosystem Settings.');
    error.code = 'CGPEY_NOT_CONFIGURED';
    throw error;
  }
  const response = await postJson(
    `${cfg.baseUrl}${path}`,
    {
      'x-merchant-id': cfg.merchantId,
      'x-api-key': cfg.apiKey,
      'x-secret-key': cfg.apiSecret,
    },
    body,
  );
  const okHttp = response.status >= 200 && response.status < 300;
  const parsedPreview = invitationFrom(response.json);
  const explicitFail = response.json?.success === false
    || String(response.json?.status || '').toLowerCase() === 'failed';
  const okBody = !explicitFail && (
    response.json?.success === true
    || Boolean(parsedPreview.docketId || parsedPreview.invitationLink || parsedPreview.transactionId)
  );
  if (!okHttp || !okBody) {
    let message = providerMessage(response.json, `CGPEY eSign request failed (${response.status || 'network'}).`);
    if (/invalid merchant credentials/i.test(message)) {
      message = 'CGPEY rejected the API credentials. Confirm key, secret and merchant ID in Health Ecosystem Settings, and use base URL https://verify.cgpey.com.';
    } else if (/page_number/i.test(message)) {
      message = `${message} Use a page that exists in the uploaded agreement PDF (signature page).`;
    } else if (/idtoai|esign request failed/i.test(message)) {
      message = 'CGPEY accepted the request but the eSign provider (IDTOAI) rejected it. '
        + 'In CGPEY Control Tower open eSign Agreement / Request Balance, confirm eSign is enabled for this merchant, then retry. '
        + `(${message})`;
    }
    const error = new Error(message);
    error.code = 'CGPEY_ESIGN_FAILED';
    error.status = response.status;
    error.payload = response.json;
    throw error;
  }
  return response.json;
}

/** Portal URL CGPEY/IDTOAI redirects to after Aadhaar eSign (same-tab return). */
export function buildEsignReturnUrl({
  portalBaseUrl = '',
  referenceDocId = '',
  applicationNumber = '',
} = {}) {
  const explicit = env('RFMS_CGPEY_ESIGN_RETURN_URL');
  const base = String(
    explicit
    || portalBaseUrl
    || env('RFMS_PORTAL_BASE_URL')
    || 'https://www.e-remedium.in/onboard',
  ).trim().replace(/\/+$/, '');
  const url = new URL(base.includes('://') ? base : `https://${base}`);
  // Keep operator path (usually /onboard) and force profile + agreement return flags.
  url.searchParams.set('view', 'profile');
  url.searchParams.set('section', 'agreement');
  url.searchParams.set('esign_return', '1');
  if (referenceDocId) url.searchParams.set('esign_ref', String(referenceDocId).slice(0, 80));
  if (applicationNumber) url.searchParams.set('application', String(applicationNumber).slice(0, 80));
  return url.toString();
}

/**
 * Start CGPEY / IDTOAI Aadhaar eSign for an agreement PDF.
 * Fixed payload values are for the CGPEY API only — never written back to applicant records.
 * Returns a hosted invitation_link where the applicant completes Aadhaar OTP signing.
 */
export async function initiateAgreementEsign({
  pdfBase64,
  signerName,
  signerMobile,
  referencePrefix = 'RFMS',
  returnUrl = '',
  applicationNumber = '',
  config = null,
} = {}) {
  const cfg = mergeCgpeyConfig(config);
  const content = String(pdfBase64 || '').replace(/^data:application\/pdf;base64,/i, '').trim();
  if (!content || content.length < 32) {
    const error = new Error('Agreement PDF is missing or unreadable for CGPEY eSign.');
    error.code = 'AGREEMENT_PDF_MISSING';
    throw error;
  }
  const name = String(signerName || 'Applicant').trim() || 'Applicant';
  const mobile = normalizeMobile(signerMobile);
  // One shared reference for document + signer (CGPEY operator requirement).
  const referenceDocId = `${String(referencePrefix || 'RFMS').replace(/[^A-Za-z0-9_-]/g, '') || 'RFMS'}-${Date.now()}`;

  // Fixed eSign API values only — do not persist over applicant email/profile.
  const FIXED_SIGNER_EMAIL = 'smilecurelifestyle@gmail.com';
  const FIXED_FINAL_COPY_RECIPIENTS = 'smilecurelifestyle@gmail.com';
  const resolvedReturnUrl = buildEsignReturnUrl({
    portalBaseUrl: String(returnUrl || '').trim() || env('RFMS_PORTAL_BASE_URL') || 'https://www.e-remedium.in/onboard',
    referenceDocId,
    applicationNumber,
  });
  const pageCount = pdfPageCountFromBase64(content);
  const pageNumber = resolveEsignPageNumber(pageCount);

  if (cgpeySimulate(cfg)) {
    return {
      simulated: true,
      docketId: `SIM-DOCKET-${Date.now()}`,
      documentId: referenceDocId,
      signerId: referenceDocId,
      invitationLink: '',
      returnUrl: resolvedReturnUrl,
      message: 'Simulated CGPEY eSign started. Complete eSign in the portal to finish local testing.',
      reference: `SIM-CGPEY-ESIGN-${Date.now()}`,
      pageNumber,
      pageCount,
    };
  }

  const body = {
    agreement_type: 'Agreement',
    docket_title: 'franchise-agreement',
    docket_description: 'final-agreement',
    final_copy_recipients: FIXED_FINAL_COPY_RECIPIENTS,
    documents: [{
      reference_doc_id: referenceDocId,
      content_type: 'pdf',
      content,
      signature_sequence: 'sequential',
      return_url: resolvedReturnUrl,
    }],
    signers_info: [{
      signer_ref_id: referenceDocId,
      signer_name: name,
      signer_email: FIXED_SIGNER_EMAIL,
      signer_mobile: mobile,
      signature_type: 'aadhaar',
      authentication_mode: 'mobile',
      document_to_be_signed: referenceDocId,
      signer_position: { appearance: 'bottom-left' },
      page_number: pageNumber,
      sequence: '1',
      trigger_esign_request: true,
    }],
  };

  const json = await cgpeyEsignPost('/api/v1/esign/initiate', body, cfg);
  const parsed = invitationFrom(json);
  if (!parsed.invitationLink) {
    const detail = providerMessage(json, 'CGPEY eSign did not return a browser signing URL.');
    const error = new Error(
      `${detail} An SMS may still arrive, but the portal needs invitation_link to open the provider route. `
      + `(signature page ${pageNumber}`
      + (pageCount > 0 ? ` of ${pageCount}` : '')
      + (parsed.docketId ? `; docket ${parsed.docketId}` : '')
      + ').',
    );
    error.code = 'CGPEY_ESIGN_LINK_MISSING';
    error.payload = json;
    throw error;
  }
  return {
    simulated: false,
    docketId: parsed.docketId,
    documentId: parsed.documentId || referenceDocId,
    signerId: parsed.signerId || referenceDocId,
    invitationLink: parsed.invitationLink,
    returnUrl: resolvedReturnUrl,
    message: providerMessage(json, 'Redirecting to CGPEY Aadhaar eSign…'),
    reference: parsed.docketId || parsed.transactionId || referenceDocId,
    pageNumber,
    pageCount,
    raw: json,
  };
}

/** Legacy KYC OTP helpers kept as explicit failures so old callers do not silently hit the wrong product. */
export async function generateAadhaarOtp() {
  const error = new Error('CGPEY Aadhaar KYC OTP is not used for agreement eSign. Use CGPEY eSign on verify.cgpey.com.');
  error.code = 'CGPEY_KYC_DEPRECATED';
  throw error;
}

export async function verifyAadhaarOtp() {
  const error = new Error('CGPEY Aadhaar KYC OTP verify is not used for agreement eSign. Complete signing via the CGPEY invitation link.');
  error.code = 'CGPEY_KYC_DEPRECATED';
  throw error;
}
