import http from 'node:http';
import https from 'node:https';

const API = '/api/method/health_ecosystem_core.health_ecosystem_core.';

/* Call ERPNext. Host is set explicitly so the request can go straight to the
   local frontend container while Frappe still resolves the right site. */
export function erpRequest(cfg, method, { form, sid, timeout = 15000 } = {}) {
  const url = new URL(`${API}${method}`, cfg.erpUrl);
  const body = form ? new URLSearchParams(form).toString() : '';
  const lib = url.protocol === 'https:' ? https : http;
  const headers = { Accept: 'application/json', 'X-Frappe-Site-Name': cfg.erpSite };
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  if (sid) headers.Cookie = `sid=${sid}`;
  if (cfg.erpHost) headers.Host = cfg.erpHost;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: form ? 'POST' : 'GET', headers, timeout }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(data);
        } catch {
          json = {};
        }
        const m = json && typeof json.message === 'object' && json.message ? json.message : json;
        resolve({ status: res.statusCode, message: m, data: m && m.data !== undefined ? m.data : m });
      });
    });
    req.on('timeout', () => req.destroy(new Error('ERP timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/* Diagnostic test master plus the physiotherapy and consultation items, from clinical_care_catalog. */
export async function fetchCareCatalog(cfg) {
  const res = await erpRequest(cfg, 'clinical_care_catalog.get_care_service_catalog', { timeout: 60000 });
  const data = res.data;
  if (res.status !== 200 || !data || !Array.isArray(data.diagnostics)) throw new Error(`ERP returned ${res.status} for the care service catalogue`);
  return data;
}

/* Create or update one diagnostic test in the ERP master, as the signed-in user. */
export async function saveDiagnosticTest(cfg, sid, test) {
  const res = await erpRequest(cfg, 'clinical_care_catalog.save_care_diagnostic_test', { form: { sid, test: JSON.stringify(test) }, sid, timeout: 60000 });
  if (res.status !== 200 || !res.message || res.message.status !== 'success') {
    const err = new Error((res.message && res.message.message) || `ERP returned ${res.status}`);
    err.status = res.status === 401 || res.status === 403 ? res.status : 400;
    throw err;
  }
  return res.data;
}

/* Branch pharmacy on the Operations pharmacy stock (clinical_care_pharmacy), as the signed-in user. */
export function carePharmacy(cfg, sid, method, data = {}) {
  return careLab(cfg, sid, method, data, 'clinical_care_pharmacy', 'Pharmacy stock system');
}

/* Lab bookings for the Remedium Care collection centre (clinical_care_lab), as the signed-in user. */
export async function careLab(cfg, sid, method, data = {}, module = 'clinical_care_lab', system = 'Lab system') {
  const res = await erpRequest(cfg, `${module}.${method}`, { form: { sid, data: JSON.stringify(data) }, sid, timeout: 60000 });
  if (res.status !== 200 || !res.message || res.message.status !== 'success') {
    const text = (res.message && res.message.message) || (res.status ? `${system} returned ${res.status}` : `${system} is not reachable`);
    const err = new Error(String(text).replace(/<[^>]+>/g, ''));
    err.status = [401, 403, 404].includes(res.status) ? res.status : res.status >= 500 || !res.status ? 502 : 400;
    throw err;
  }
  return res.data;
}

/* Authorised report PDF for a Remedium Care booking. Resolves { status, type, filename, body }. */
export function careLabReport(cfg, sid, trfId) {
  const url = new URL(`${API}clinical_care_lab.care_lab_report`, cfg.erpUrl);
  const body = new URLSearchParams({ sid, trf_id: trfId }).toString();
  const lib = url.protocol === 'https:' ? https : http;
  const headers = {
    'X-Frappe-Site-Name': cfg.erpSite,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
    Cookie: `sid=${sid}`,
  };
  if (cfg.erpHost) headers.Host = cfg.erpHost;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'POST', headers, timeout: 60000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const type = String(res.headers['content-type'] || '');
        const disposition = String(res.headers['content-disposition'] || '');
        const filename = (/filename="?([^";]+)"?/i.exec(disposition) || [])[1] || `${trfId}.pdf`;
        if (res.statusCode === 200 && !type.includes('json')) return resolve({ status: 200, type: type || 'application/pdf', filename, body: buf });
        let message = `Lab system returned ${res.statusCode}`;
        try {
          const json = JSON.parse(buf.toString('utf8'));
          const m = json && typeof json.message === 'object' && json.message ? json.message : json;
          if (m && m.message) message = String(m.message).replace(/<[^>]+>/g, '');
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode === 200 ? 409 : res.statusCode, error: message });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Lab system timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

const CRM_TAG_RE = /(?:\[CRM_TAG:)?(CRM-[A-Z0-9]{2,6}-[A-Z0-9-]{3,24})\]?/i;

/** Pull CRM tracking tag from referral / notes text. */
export function extractCrmTrackingTag(...texts) {
  for (const text of texts) {
    const m = CRM_TAG_RE.exec(String(text || ''));
    if (m) return m[1].toUpperCase();
  }
  return '';
}

/**
 * When Care / Aesthetic generates a bill, push the closed amount to Smilecure CRM
 * so the telecaller executive is credited for the sale.
 */
export async function notifyCrmSalesClose(cfg, sid, payload = {}) {
  const tracking_tag = extractCrmTrackingTag(payload.tracking_tag, payload.referred_by, payload.notes);
  if (!tracking_tag) return null;
  const form = {
    sid: sid || '',
    tracking_tag,
    amount: String(payload.amount ?? payload.total ?? 0),
    bill_ref: payload.bill_ref || payload.invoice_number || payload.number || '',
    portal: payload.portal || (cfg.flavor === 'aesthetic' ? 'aesthetic' : 'care'),
    patient_name: payload.patient_name || payload.patient || '',
    mobile: payload.mobile || '',
    notes: payload.notes || '',
    referred_by: payload.referred_by || '',
    booking_id: payload.booking_id || '',
    executive: payload.executive || '',
  };
  try {
    const res = await erpRequest(cfg, 'api.record_crm_sales_close', { form, sid, timeout: 12000 });
    if (res.status >= 400) return null;
    return res.data;
  } catch {
    return null;
  }
}

/* Aesthetic treatments (allied-health service catalogue, aesthetics wing): the treatment master of the Aesthetic instance. */
export async function fetchAestheticCatalog(cfg) {
  const res = await erpRequest(cfg, 'appointments.get_allied_health_services', { form: { wing_id: 'aesthetics' }, timeout: 60000 });
  const services = res.data && Array.isArray(res.data.services) ? res.data.services : null;
  if (res.status !== 200 || !services) throw new Error(`ERP returned ${res.status} for the aesthetic service catalogue`);
  return services;
}

/* The published lab test master (Item group "Lab Tests") from the main ERP. */
export async function fetchLabCatalog(cfg) {
  const res = await erpRequest(cfg, 'api.get_lab_test_catalog', { timeout: 60000 });
  const items = res.data && Array.isArray(res.data.items) ? res.data.items : null;
  if (res.status !== 200 || !items) throw new Error(`ERP returned ${res.status} for the lab test catalogue`);
  return items;
}
