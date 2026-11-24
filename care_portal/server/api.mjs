import {
  addDays,
  audit,
  getSettings,
  insert,
  nextSeq,
  row,
  rows,
  run,
  stamp,
  todayStr,
  tx,
  update,
  weekday,
} from './db.mjs';
import { clearDemo } from './seed.mjs';
import {
  extractCrmTrackingTag,
  fetchAestheticCatalog,
  fetchCareCatalog,
  fetchLabCatalog,
  notifyCrmSalesClose,
  saveDiagnosticTest,
} from './erp.mjs';
import { labCount, patientLabBookings } from './lab.mjs';

const LAB_WORKFLOW = 'Lab tests are booked from Test & Lab → Book lab test; the booking goes to Remedium Labs and its bill is created with it';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (message) => {
  throw new HttpError(400, message);
};

/* The Aesthetic instance (CARE_FLAVOR=aesthetic) names plans and package lines as treatments. */
const AESTHETIC = process.env.CARE_FLAVOR === 'aesthetic';
const LINE = AESTHETIC ? 'Treatment' : 'Physiotherapy';
const PLAN_PREFIX = AESTHETIC ? 'AT' : 'PT';

const TYPES = ['consultation', 'physiotherapy', 'lab', 'diagnostic'];
const INVOICE_TYPES = ['consultation', 'physiotherapy', 'lab', 'diagnostic', 'pharmacy', 'other'];
const STATUSES = ['Scheduled', 'Checked In', 'Waiting', 'In Session', 'Sample Collected', 'Report Pending', 'Completed', 'Reported', 'Cancelled', 'No Show'];
const PLAN_STATUSES = ['Active', 'On Hold', 'Completed', 'Discontinued'];
const ASSET_STATUSES = ['Working', 'Under Maintenance', 'Out of Order', 'Retired'];
const PAY_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Insurance'];
const ROLES = ['Doctor', 'Physiotherapist', 'Lab Technician', 'Radiologist', 'Diagnostic Technician', 'Pharmacist', 'Receptionist', 'Nurse', 'Manager'];
if (AESTHETIC && !ROLES.includes('Cosmetologist')) ROLES.push('Cosmetologist');
const CLINICIAN_ROLES = AESTHETIC ? ['Doctor', 'Cosmetologist'] : ['Doctor'];
/* Bookings that carry a list of tests (and a written report) instead of a single service. */
const TEST_TYPES = ['lab', 'diagnostic'];
const ITEM_CATEGORIES = ['Medicine', 'Physio Supply', 'Orthotic', 'Consumable', 'Lab Consumable', 'Housekeeping'];
const ACTIVE_STATUSES = ['Checked In', 'In Session'];

const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const opt = (v, max = 300) => str(v, max) || null;
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const int = (v, fallback = 0) => Math.trunc(num(v, fallback));
const money = (v) => Math.round(num(v) * 100) / 100;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isTime = (v) => /^\d{2}:\d{2}$/.test(String(v || ''));
const oneOf = (v, list, label) => {
  if (!list.includes(v)) bad(`${label} must be one of: ${list.join(', ')}`);
  return v;
};
const required = (v, label) => {
  if (v === '' || v == null) bad(`${label} is required`);
  return v;
};
const like = (q) => `%${q.replace(/[%_]/g, '')}%`;
const parse = (json, fallback) => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

function branchWhere(q, col = 'branch_id') {
  const id = int(q.branch);
  return id ? { sql: ` AND ${col} = ?`, args: [id] } : { sql: '', args: [] };
}

function page(q, max = 200, size = 50) {
  const limit = Math.min(Math.max(int(q.limit, size), 1), max);
  const offset = Math.max(int(q.offset), 0);
  return { limit, offset };
}

function mustGet(db, table, id, label) {
  const found = row(db, `SELECT * FROM ${table} WHERE id = ?`, int(id));
  if (!found) throw new HttpError(404, `${label} not found`);
  return found;
}

function defaultBranch(db, value) {
  const id = int(value);
  if (id && row(db, 'SELECT id FROM branches WHERE id = ?', id)) return id;
  return row(db, 'SELECT id FROM branches WHERE active = 1 ORDER BY id LIMIT 1')?.id ?? null;
}

export function invoiceStatus(total, paid) {
  if (paid >= total - 0.001) return 'Paid';
  return paid > 0 ? 'Partially Paid' : 'Unpaid';
}

function pct(now, before) {
  if (!before) return now ? 100 : 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/* ---------------------------------------------------------------- meta */

export function meta({ db }) {
  return {
    branches: rows(db, 'SELECT * FROM branches ORDER BY active DESC, name'),
    services: rows(db, "SELECT * FROM services WHERE NOT (source = 'erp' AND category IN ('lab', 'diagnostic')) ORDER BY category, name"),
    diagnostic_tests: row(db, "SELECT COUNT(*) AS n FROM services WHERE category = 'diagnostic' AND active = 1").n,
    lab_catalog: {
      erp_tests: row(db, "SELECT COUNT(*) AS n FROM services WHERE source = 'erp' AND active = 1").n,
      synced_at: getSettings(db).lab_catalog_synced_at || null,
    },
    practitioners: rows(db, 'SELECT * FROM practitioners ORDER BY active DESC, name'),
    settings: (({ invoice_signature, ...rest }) => ({ ...rest, has_signature: invoice_signature ? '1' : '' }))(getSettings(db)),
    today: todayStr(),
    enums: {
      types: TYPES,
      statuses: STATUSES,
      planStatuses: PLAN_STATUSES,
      assetStatuses: ASSET_STATUSES,
      payModes: PAY_MODES,
      roles: ROLES,
      itemCategories: ITEM_CATEGORIES,
    },
    has_demo: row(db, 'SELECT COUNT(*) AS n FROM patients WHERE demo = 1').n > 0,
  };
}

/* ---------------------------------------------------------------- dashboard */

export function dashboard({ db, q }) {
  const b = branchWhere(q);
  const today = todayStr();
  let days;
  let from;
  let end;
  if (isDate(q.from) && isDate(q.to) && q.from <= q.to) {
    from = q.from;
    end = addDays(q.to, 1);
    days = Math.min(366, Math.max(1, Math.round((Date.parse(q.to + 'T00:00:00Z') - Date.parse(q.from + 'T00:00:00Z')) / 86400000) + 1));
  } else {
    days = Math.min(Math.max(int(q.range, 30), 7), 365);
    from = addDays(today, -(days - 1));
    end = addDays(today, 1);
  }
  const prevFrom = addDays(from, -days);

  const count = (sql, ...args) => row(db, sql, ...args).n;
  const apptCount = (type, a, z) =>
    count(`SELECT COUNT(*) AS n FROM appointments WHERE type = ? AND date >= ? AND date < ? AND status NOT IN ('Cancelled','No Show')${b.sql}`, type, a, z, ...b.args) +
    (type === 'lab' ? labCount(db, a, z, q.branch) : 0);
  const inv = (a, z, type) =>
    row(
      db,
      `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM invoices WHERE status != 'Cancelled' AND created_at >= ? AND created_at < ?${type ? ' AND service_type = ?' : ''}${b.sql}`,
      a, z, ...(type ? [type] : []), ...b.args,
    );

  const patientsTotal = count(`SELECT COUNT(*) AS n FROM patients WHERE 1=1${b.sql}`, ...b.args);
  const newNow = count(`SELECT COUNT(*) AS n FROM patients WHERE created_at >= ? AND created_at < ?${b.sql}`, from, end, ...b.args);
  const newBefore = count(`SELECT COUNT(*) AS n FROM patients WHERE created_at >= ? AND created_at < ?${b.sql}`, prevFrom, from, ...b.args);
  const invNow = inv(from, end);
  const invBefore = inv(prevFrom, from);
  const pharmNow = inv(from, end, 'pharmacy');
  const pharmBefore = inv(prevFrom, from, 'pharmacy');

  const kpis = {
    patients: { value: patientsTotal, new: newNow, delta: pct(newNow, newBefore) },
    consultations: { value: apptCount('consultation', from, end), delta: pct(apptCount('consultation', from, end), apptCount('consultation', prevFrom, from)) },
    physiotherapy: { value: apptCount('physiotherapy', from, end), delta: pct(apptCount('physiotherapy', from, end), apptCount('physiotherapy', prevFrom, from)) },
    lab: { value: apptCount('lab', from, end), delta: pct(apptCount('lab', from, end), apptCount('lab', prevFrom, from)) },
    invoices: { value: invNow.n, amount: invNow.amount, delta: pct(invNow.n, invBefore.n) },
    pharmacy: { value: pharmNow.amount, count: pharmNow.n, delta: pct(pharmNow.amount, pharmBefore.amount) },
  };

  const todayAppointments = rows(
    db,
    `SELECT a.id, a.code, a.type, a.service, a.time, a.status, a.session_no, a.patient_id, a.invoice_id, p.name AS patient,
            t.total_sessions, pr.name AS practitioner
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       LEFT JOIN therapy_plans t ON t.id = a.plan_id
       LEFT JOIN practitioners pr ON pr.id = a.practitioner_id
      WHERE a.date = ?${branchWhere(q, 'a.branch_id').sql}
      ORDER BY a.time, a.id`,
    today, ...b.args,
  );

  const series = rows(
    db,
    `SELECT substr(created_at,1,10) AS day, service_type AS type, SUM(total) AS amount
       FROM invoices WHERE status != 'Cancelled' AND created_at >= ? AND created_at < ?${b.sql}
      GROUP BY day, type`,
    from, end, ...b.args,
  );
  const byDay = new Map();
  for (let i = 0; i < days; i += 1) byDay.set(addDays(from, i), { date: addDays(from, i), consultation: 0, physiotherapy: 0, lab: 0, diagnostic: 0, pharmacy: 0, other: 0 });
  for (const r of series) {
    const slotted = byDay.get(r.day);
    if (slotted) slotted[r.type in slotted ? r.type : 'other'] += r.amount;
  }
  const revenueDays = [...byDay.values()];
  const sum = (key) => revenueDays.reduce((s, d) => s + d[key], 0);
  const prevRevenue = inv(prevFrom, from).amount;

  const queue = ['consultation', 'physiotherapy', 'lab', 'diagnostic'].map((type) => {
    const list = todayAppointments.filter((a) => a.type === type && !['Cancelled', 'No Show'].includes(a.status));
    const pending = { lab: ['Waiting', 'Scheduled'], diagnostic: ['Report Pending'] }[type] || ACTIVE_STATUSES;
    return { type, total: list.length, active: list.filter((a) => pending.includes(a.status)).length };
  });
  const pharmToday = row(
    db,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN status IN ('Unpaid','Partially Paid') THEN 1 ELSE 0 END) AS open
       FROM invoices WHERE service_type = 'pharmacy' AND status != 'Cancelled' AND created_at >= ? AND created_at < ?${b.sql}`,
    today, end, ...b.args,
  );
  queue.push({ type: 'pharmacy', total: pharmToday.n, active: pharmToday.open || 0 });

  const recentInvoices = rows(
    db,
    `SELECT i.id, i.number, i.service_type, i.total, i.status, i.created_at, COALESCE(p.name, i.customer, 'Walk-in') AS patient
       FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id
      WHERE 1=1${branchWhere(q, 'i.branch_id').sql}
      ORDER BY i.created_at DESC, i.id DESC LIMIT 6`,
    ...b.args,
  );

  return {
    range: days,
    from,
    today,
    kpis,
    todayAppointments,
    revenue: {
      total: sum('consultation') + sum('physiotherapy') + sum('lab') + sum('diagnostic') + sum('pharmacy') + sum('other'),
      delta: pct(invNow.amount, prevRevenue),
      totals: { consultation: sum('consultation'), physiotherapy: sum('physiotherapy'), lab: sum('lab'), diagnostic: sum('diagnostic'), pharmacy: sum('pharmacy') },
      days: revenueDays,
    },
    queue,
    recentInvoices,
    alerts: stockAlerts(db, q).slice(0, 6),
  };
}

function stockAlerts(db, q) {
  const b = branchWhere(q);
  const today = todayStr();
  const soon = addDays(today, 60);
  const list = rows(
    db,
    `SELECT id, name, unit, stock, reorder_level, expiry, category FROM items
      WHERE active = 1 AND ((reorder_level > 0 AND stock <= reorder_level * 1.5) OR stock <= 0 OR (expiry IS NOT NULL AND expiry <= ?))${b.sql}`,
    soon, ...b.args,
  );
  return list
    .map((it) => {
      let level = 'reorder';
      if (it.stock <= 0) level = 'out';
      else if (it.reorder_level > 0 && it.stock <= it.reorder_level) level = 'low';
      else if (it.expiry && it.expiry <= soon && !(it.reorder_level > 0 && it.stock <= it.reorder_level * 1.5)) level = it.expiry < today ? 'expired' : 'expiry';
      return { ...it, level };
    })
    .sort((a, b2) => ['out', 'expired', 'low', 'expiry', 'reorder'].indexOf(a.level) - ['out', 'expired', 'low', 'expiry', 'reorder'].indexOf(b2.level));
}

export function alerts({ db, q }) {
  const today = todayStr();
  const b = branchWhere(q);
  const out = [];
  const stock = stockAlerts(db, q);
  const low = stock.filter((s) => ['out', 'low'].includes(s.level)).length;
  const expiry = stock.filter((s) => ['expired', 'expiry'].includes(s.level)).length;
  if (low) out.push({ id: 'stock', tone: 'danger', text: `${low} inventory item${low > 1 ? 's' : ''} at or below reorder level`, href: '/inventory?filter=low' });
  if (expiry) out.push({ id: 'expiry', tone: 'warn', text: `${expiry} item${expiry > 1 ? 's' : ''} expired or expiring within 60 days`, href: '/inventory?filter=expiry' });
  const assetsDue = row(db, `SELECT COUNT(*) AS n FROM assets WHERE status != 'Retired' AND next_service IS NOT NULL AND next_service <= ?${b.sql}`, addDays(today, 7), ...b.args).n;
  if (assetsDue) out.push({ id: 'assets', tone: 'warn', text: `${assetsDue} equipment service${assetsDue > 1 ? 's' : ''} due this week`, href: '/assets?filter=due' });
  const waiting = row(db, `SELECT COUNT(*) AS n FROM appointments WHERE date = ? AND status IN ('Checked In','Waiting')${b.sql}`, today, ...b.args).n;
  if (waiting) out.push({ id: 'waiting', tone: 'info', text: `${waiting} patient${waiting > 1 ? 's' : ''} checked in and waiting`, href: '/appointments' });
  const dues = row(db, `SELECT COUNT(*) AS n, COALESCE(SUM(total - paid),0) AS amount FROM invoices WHERE status IN ('Unpaid','Partially Paid')${b.sql}`, ...b.args);
  if (dues.n) out.push({ id: 'dues', tone: 'info', text: `${dues.n} invoice${dues.n > 1 ? 's' : ''} with ₹${Math.round(dues.amount).toLocaleString('en-IN')} due`, href: '/billing?status=due' });
  const reports = row(db, `SELECT COUNT(*) AS n FROM appointments WHERE type = 'lab' AND status = 'Sample Collected' AND date <= ?${b.sql}`, today, ...b.args).n;
  if (reports) out.push({ id: 'reports', tone: 'info', text: `${reports} lab sample${reports > 1 ? 's' : ''} awaiting report`, href: '/lab?status=Sample%20Collected' });
  const scans = row(db, `SELECT COUNT(*) AS n FROM appointments WHERE type = 'diagnostic' AND status = 'Report Pending' AND date <= ?${b.sql}`, today, ...b.args).n;
  if (scans) out.push({ id: 'scans', tone: 'info', text: `${scans} diagnostic test${scans > 1 ? 's' : ''} awaiting report`, href: '/diagnostics?status=Report%20Pending' });
  return out;
}

/* ---------------------------------------------------------------- search */

export function search({ db, q, can }) {
  const term = str(q.q, 80);
  if (term.length < 2) return { patients: [], invoices: [], appointments: [], items: [] };
  const l = like(term);
  const pb = branchWhere(q, 'branch_id');
  const ib = branchWhere(q, 'i.branch_id');
  const ab = branchWhere(q, 'a.branch_id');
  return {
    patients: can('Patients')
      ? rows(db, `SELECT id, code, name, mobile FROM patients WHERE (name LIKE ? OR mobile LIKE ? OR code LIKE ?)${pb.sql} ORDER BY id DESC LIMIT 6`, l, l, l, ...pb.args)
      : [],
    invoices: can('Billing & Invoice')
      ? rows(db, `SELECT i.id, i.number, i.total, i.status, COALESCE(p.name, i.customer, 'Walk-in') AS patient FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id WHERE (i.number LIKE ? OR p.name LIKE ?)${ib.sql} ORDER BY i.id DESC LIMIT 5`, l, l, ...ib.args)
      : [],
    appointments: can('Appointments')
      ? rows(db, `SELECT a.id, a.code, a.type, a.service, a.date, a.time, a.status, p.name AS patient FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE (a.code LIKE ? OR a.service LIKE ? OR p.name LIKE ?)${ab.sql} ORDER BY a.date DESC LIMIT 5`, l, l, l, ...ab.args)
      : [],
    items: can('Inventory Management') || can('Pharmacy')
      ? rows(db, `SELECT id, name, sku, stock, unit FROM items WHERE active = 1 AND (name LIKE ? OR sku LIKE ?)${pb.sql} LIMIT 5`, l, l, ...pb.args)
      : [],
  };
}

/* ---------------------------------------------------------------- patients */

export function listPatients({ db, q }) {
  const b = branchWhere(q, 'p.branch_id');
  const term = str(q.q, 80);
  let where = `WHERE 1=1${b.sql}`;
  const args = [...b.args];
  if (term) {
    where += ' AND (p.name LIKE ? OR p.mobile LIKE ? OR p.code LIKE ? OR p.email LIKE ?)';
    args.push(like(term), like(term), like(term), like(term));
  }
  const gender = str(q.gender, 20);
  if (gender) {
    where += ' AND p.gender = ?';
    args.push(gender);
  }
  const { limit, offset } = page(q);
  const total = row(db, `SELECT COUNT(*) AS n FROM patients p ${where}`, ...args).n;
  const dueN = row(
    db,
    `SELECT COUNT(*) AS n FROM patients p ${where}
      AND EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('Unpaid','Partially Paid') AND i.total > i.paid)`,
    ...args,
  ).n;
  const newMonth = row(
    db,
    `SELECT COUNT(*) AS n FROM patients p ${where} AND p.created_at >= date('now','+330 minutes','start of month')`,
    ...args,
  ).n;
  const items = rows(
    db,
    `SELECT p.*, br.name AS branch,
            (SELECT MAX(date) FROM appointments a WHERE a.patient_id = p.id AND a.date <= date('now','+330 minutes')) AS last_visit,
            (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status NOT IN ('Cancelled','No Show')) AS visits,
            (SELECT COALESCE(SUM(total - paid),0) FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('Unpaid','Partially Paid')) AS due
       FROM patients p LEFT JOIN branches br ON br.id = p.branch_id
       ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    ...args, limit, offset,
  );
  return { total, items, due: dueN, new_month: newMonth };
}

function patientFields(body) {
  const age = body.age === '' || body.age == null ? null : int(body.age);
  if (age != null && (age < 0 || age > 120)) bad('Age must be between 0 and 120');
  const mobile = str(body.mobile, 15).replace(/[^\d+]/g, '');
  if (mobile && !/^\+?\d{10,13}$/.test(mobile)) bad('Mobile number must have 10 digits');
  return {
    name: required(str(body.name, 120), 'Patient name'),
    mobile: mobile || null,
    gender: opt(body.gender, 20),
    age,
    email: opt(body.email, 120),
    address: opt(body.address, 300),
    condition: opt(body.condition, 200),
    referred_by: opt(body.referred_by, 120),
  };
}

export function createPatient({ db, body, user }) {
  const fields = patientFields(body);
  if (fields.mobile) {
    const dup = row(db, 'SELECT id, code, name FROM patients WHERE mobile = ? AND lower(name) = lower(?)', fields.mobile, fields.name);
    if (dup) bad(`${dup.name} is already registered as ${dup.code}`);
  }
  return tx(db, () => {
    const code = `RC-P-${String(nextSeq(db, 'patient')).padStart(5, '0')}`;
    const id = insert(db, 'patients', { ...fields, code, branch_id: defaultBranch(db, body.branch_id), created_at: stamp(), created_by: user.user });
    audit(db, user.user, 'create', 'patient', code);
    return row(db, 'SELECT * FROM patients WHERE id = ?', id);
  });
}

export function updatePatient({ db, body, params, user }) {
  const current = mustGet(db, 'patients', params.id, 'Patient');
  update(db, 'patients', current.id, { ...patientFields({ ...current, ...body }), branch_id: body.branch_id ? defaultBranch(db, body.branch_id) : undefined });
  audit(db, user.user, 'update', 'patient', current.code);
  return row(db, 'SELECT * FROM patients WHERE id = ?', current.id);
}

export function getPatient({ db, params }) {
  const patient = row(db, 'SELECT p.*, b.name AS branch FROM patients p LEFT JOIN branches b ON b.id = p.branch_id WHERE p.id = ?', int(params.id));
  if (!patient) throw new HttpError(404, 'Patient not found');
  return {
    patient,
    appointments: rows(
      db,
      `SELECT a.*, pr.name AS practitioner, t.total_sessions FROM appointments a
         LEFT JOIN practitioners pr ON pr.id = a.practitioner_id LEFT JOIN therapy_plans t ON t.id = a.plan_id
        WHERE a.patient_id = ? ORDER BY a.date DESC, a.time DESC LIMIT 100`,
      patient.id,
    ),
    plans: planRows(db, ' AND t.patient_id = ?', [patient.id]),
    invoices: rows(db, 'SELECT * FROM invoices WHERE patient_id = ? ORDER BY created_at DESC LIMIT 100', patient.id),
    lab_bookings: patientLabBookings(db, patient.id),
  };
}

/* ---------------------------------------------------------------- appointments */

const APPT_SELECT = `
  SELECT a.*, p.name AS patient, p.mobile, p.code AS patient_code, p.age AS patient_age, p.address AS patient_address,
         p.condition AS patient_condition, p.referred_by AS patient_referred_by, pr.name AS practitioner, br.name AS branch,
         t.total_sessions, t.code AS plan_code, t.billing AS plan_billing, i.number AS invoice_number, i.status AS invoice_status,
         t.ref_type AS plan_ref_type, t.referred_by AS plan_referred_by, t.ref_contact AS plan_ref_contact, t.ref_doctor_id AS plan_ref_doctor_id,
         i.total AS appt_invoice_total, i.paid AS appt_invoice_paid,
         (SELECT sb.id FROM session_bills sb WHERE sb.appointment_id = a.id) AS session_bill_id,
         (SELECT sb.number FROM session_bills sb WHERE sb.appointment_id = a.id) AS session_bill_number
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN practitioners pr ON pr.id = a.practitioner_id
    LEFT JOIN branches br ON br.id = a.branch_id
    LEFT JOIN therapy_plans t ON t.id = a.plan_id
    LEFT JOIN invoices i ON i.id = a.invoice_id`;

export function listAppointments({ db, q }) {
  const b = branchWhere(q, 'a.branch_id');
  let where = `WHERE 1=1${b.sql}`;
  const args = [...b.args];
  if (q.type) {
    where += ' AND a.type = ?';
    args.push(oneOf(q.type, TYPES, 'Type'));
  }
  if (isDate(q.date)) {
    where += ' AND a.date = ?';
    args.push(q.date);
  } else {
    if (isDate(q.from)) {
      where += ' AND a.date >= ?';
      args.push(q.from);
    }
    if (isDate(q.to)) {
      where += ' AND a.date <= ?';
      args.push(q.to);
    }
  }
  if (q.status) {
    const list = String(q.status).split(',').filter((s) => STATUSES.includes(s));
    if (list.length) {
      where += ` AND a.status IN (${list.map(() => '?').join(',')})`;
      args.push(...list);
    }
  }
  if (int(q.practitioner)) {
    where += ' AND a.practitioner_id = ?';
    args.push(int(q.practitioner));
  }
  const term = str(q.q, 80);
  if (term) {
    where += ' AND (p.name LIKE ? OR p.mobile LIKE ? OR a.code LIKE ? OR a.service LIKE ?)';
    args.push(like(term), like(term), like(term), like(term));
  }
  const { limit, offset } = page(q, 500, 100);
  const total = row(db, `SELECT COUNT(*) AS n FROM appointments a JOIN patients p ON p.id = a.patient_id ${where}`, ...args).n;
  const order = q.order === 'desc' ? 'a.date DESC, a.time DESC' : 'a.date, a.time';
  const items = rows(db, `${APPT_SELECT} ${where} ORDER BY ${order}, a.id LIMIT ? OFFSET ?`, ...args, limit, offset);
  const counts = rows(db, `SELECT a.status, COUNT(*) AS n FROM appointments a JOIN patients p ON p.id = a.patient_id ${where} GROUP BY a.status`, ...args);
  return { total, items, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

function parseTests(raw) {
  const list = Array.isArray(raw) ? raw : parse(raw, []);
  return list
    .map((t) => ({ code: opt(t.code, 80), name: str(t.name, 160), price: money(t.price) }))
    .filter((t) => t.name);
}

/* Referral on a booking: 'self', a doctor from the directory, or an outside doctor typed in. */
function parseReferral(db, body) {
  const type = oneOf(body.ref_type || 'self', ['self', 'doctor', 'outside'], 'Referred by');
  if (type === 'self') return { ref_type: 'self', ref_doctor_id: null, referred_by: 'Self', ref_contact: null };
  if (type === 'doctor') {
    const doctor = int(body.ref_doctor_id) ? row(db, "SELECT id, name FROM practitioners WHERE id = ? AND role = 'Doctor'", int(body.ref_doctor_id)) : null;
    if (!doctor) bad('Choose the referring doctor from the doctor directory');
    return { ref_type: 'doctor', ref_doctor_id: doctor.id, referred_by: doctor.name, ref_contact: null };
  }
  return {
    ref_type: 'outside',
    ref_doctor_id: null,
    referred_by: required(str(body.referred_by, 120), 'Referring doctor name'),
    ref_contact: opt(body.ref_contact, 160),
  };
}

const referralText = (r) => (r.ref_type && r.ref_type !== 'self' ? [r.referred_by, r.ref_contact].filter(Boolean).join(', ') : null);

function planReferral(db, appointmentId) {
  const plan = row(db, 'SELECT t.ref_type, t.referred_by, t.ref_contact FROM appointments a JOIN therapy_plans t ON t.id = a.plan_id WHERE a.id = ?', appointmentId);
  return plan ? referralText(plan) : null;
}

export function createInvoiceRow(db, user, data) {
  const items = data.items;
  const subtotal = money(items.reduce((s, it) => s + it.amount, 0));
  const discountType = data.discount_type === 'percent' ? 'percent' : 'flat';
  const discountValue = num(data.discount);
  if (discountValue < 0) bad('Discount cannot be negative');
  if (discountType === 'percent' && discountValue > 100) bad('Percentage discount cannot be more than 100%');
  if (discountType === 'flat' && discountValue > subtotal + 0.001) bad(`Discount cannot be more than the bill amount (₹${subtotal})`);
  const discount = discountType === 'percent' ? money((subtotal * discountValue) / 100) : money(discountValue);
  const total = money(subtotal - discount);
  const includeGst = data.include_gst === true || data.include_gst === 1 || data.include_gst === '1';
  const gstRate = includeGst ? 5 : null;
  const gstAmount = gstRate ? money((total * gstRate) / (100 + gstRate)) : 0;
  const paid = Math.min(money(data.paid), total);
  if (paid < 0) bad('Paid amount cannot be negative');
  const created = stamp();
  const prefix = getSettings(db).invoice_prefix || 'RC/INV';
  const number = `${prefix}/${created.slice(2, 10).replace(/-/g, '')}-${String(nextSeq(db, 'invoice')).padStart(4, '0')}`;
  const mode = paid > 0 ? oneOf(data.mode || 'Cash', PAY_MODES, 'Payment mode') : null;
  const id = insert(db, 'invoices', {
    number,
    patient_id: data.patient_id || null,
    customer: data.customer || null,
    service_type: data.service_type,
    items: JSON.stringify(items),
    subtotal,
    discount,
    discount_type: discount > 0 ? discountType : null,
    discount_value: discount > 0 ? money(discountValue) : null,
    gst_rate: gstRate,
    gst_amount: gstAmount,
    total,
    paid,
    status: invoiceStatus(total, paid),
    payment_mode: mode,
    appointment_id: data.appointment_id || null,
    practitioner_id: data.practitioner_id || null,
    referred_by: data.referred_by ?? (data.appointment_id ? planReferral(db, data.appointment_id) : null),
    notes: data.notes || null,
    branch_id: data.branch_id,
    created_at: created,
    created_by: user.user,
  });
  if (paid > 0) insert(db, 'payments', { invoice_id: id, amount: paid, mode, reference: data.reference || null, at: created, by: user.user });
  if (data.appointment_id) run(db, 'UPDATE appointments SET invoice_id = ? WHERE id = ?', id, data.appointment_id);
  audit(db, user.user, 'create', 'invoice', number);
  return id;
}

/* Consultations entered the next day with yesterday's visit date kept the entry day on the bill.
   Date the bill and its payment on the visit day, once. Later payments and package bills stay put. */
export function redateVisitInvoices(db) {
  if (row(db, "SELECT key FROM settings WHERE key = 'invoice_visit_dates'")) return 0;
  const found = rows(
    db,
    `SELECT i.id, i.number, i.created_at, a.date AS visit
       FROM invoices i
       JOIN appointments a ON a.invoice_id = i.id AND a.type = 'consultation'
      WHERE i.status != 'Cancelled'
        AND a.created_at = i.created_at
        AND substr(i.created_at, 1, 10) > a.date
        AND (SELECT COUNT(*) FROM appointments x WHERE x.invoice_id = i.id) = 1
        AND (SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id AND p.at != i.created_at) = 0`,
  );
  let n = 0;
  tx(db, () => {
    for (const inv of found) {
      const match = String(inv.number).match(/^(.*\/)(\d{6})-(\d+)$/);
      const ymd = String(inv.visit).slice(2, 10).replace(/-/g, '');
      const next = match ? `${match[1]}${ymd}-${match[3]}` : null;
      if (!next || next === inv.number || row(db, 'SELECT id FROM invoices WHERE number = ?', next)) continue;
      const at = `${inv.visit}${String(inv.created_at).slice(10)}`;
      run(db, 'UPDATE invoices SET number = ?, created_at = ? WHERE id = ?', next, at, inv.id);
      run(db, 'UPDATE payments SET at = ? WHERE invoice_id = ? AND at = ?', at, inv.id, inv.created_at);
      run(db, "UPDATE audit SET ref = ? WHERE entity = 'invoice' AND ref = ?", next, inv.number);
      audit(db, 'system', 'date', 'invoice', `${inv.number} → ${next}`);
      n += 1;
    }
    run(db, "INSERT INTO settings (key, value) VALUES ('invoice_visit_dates', ?)", String(n));
  });
  return n;
}

export function createAppointment({ db, body, user }) {
  const type = oneOf(body.type, TYPES, 'Appointment type');
  if (type === 'lab') bad(LAB_WORKFLOW);
  const patient = mustGet(db, 'patients', required(int(body.patient_id) || null, 'Patient'), 'Patient');
  const date = isDate(body.date) ? body.date : bad('Choose a valid date');
  if (date < todayStr()) bad('A booking can only be made for today or a later day');
  const time = isTime(body.time) ? body.time : bad('Choose a valid time');
  const practitioner = int(body.practitioner_id) ? mustGet(db, 'practitioners', body.practitioner_id, 'Practitioner') : null;
  if (practitioner && CLINICIAN_ROLES.includes(practitioner.role) && !body.override_availability) {
    const a = doctorAvailability(practitioner, date, time);
    if (!a.ok) bad(`${practitioner.name} is ${a.reason} (${date} ${time}). Choose another time or tick “Book anyway”.`);
  }
  let tests = null;
  let service = str(body.service, 200);
  let fee = money(body.fee);
  if (TEST_TYPES.includes(type)) {
    tests = parseTests(body.tests);
    if (!tests.length) bad('Add at least one test');
    service = tests.map((t) => t.name).join(', ');
    fee = money(tests.reduce((s, t) => s + t.price, 0));
  } else {
    required(service, 'Service');
  }
  let plan = null;
  let sessionNo = null;
  if (type === 'physiotherapy' && int(body.plan_id)) {
    plan = mustGet(db, 'therapy_plans', body.plan_id, 'Therapy plan');
    if (plan.patient_id !== patient.id) bad('That therapy plan belongs to another patient');
    sessionNo = row(db, "SELECT COUNT(*) AS n FROM appointments WHERE plan_id = ? AND status NOT IN ('Cancelled')", plan.id).n + 1;
    if (sessionNo > plan.total_sessions) bad(`All ${plan.total_sessions} sessions of ${plan.code} are already booked`);
  }
  return tx(db, () => {
    const code = `AP-${String(nextSeq(db, 'appointment')).padStart(6, '0')}`;
    const branchId = defaultBranch(db, body.branch_id || patient.branch_id);
    const id = insert(db, 'appointments', {
      code, patient_id: patient.id, type, service: plan?.billing === 'package' ? service || plan.package_name : service,
      tests: tests ? JSON.stringify(tests) : null,
      practitioner_id: practitioner?.id ?? plan?.practitioner_id ?? null, plan_id: plan?.id ?? null, session_no: sessionNo,
      date, time, status: 'Scheduled', fee: plan?.billing === 'package' ? plan.fee : fee, notes: opt(body.notes, 500), branch_id: branchId,
      invoice_id: plan?.billing === 'package' ? plan.invoice_id : null,
      created_at: stamp(), created_by: user.user, updated_at: stamp(),
    });
    audit(db, user.user, 'create', 'appointment', code);
    if (body.collect && fee > 0 && plan?.billing !== 'package') {
      const items = tests
        ? tests.map((t) => ({ name: t.name, qty: 1, rate: t.price, amount: t.price }))
        : [{ name: sessionNo ? `${service} (Session ${sessionNo}/${plan.total_sessions})` : service, qty: 1, rate: fee, amount: fee }];
      const crmTag = extractCrmTrackingTag(patient.referred_by, body.notes);
      createInvoiceRow(db, user, {
        items, service_type: type, patient_id: patient.id, appointment_id: id, branch_id: branchId,
        practitioner_id: practitioner?.role === 'Doctor' ? practitioner.id : null,
        discount: body.discount, discount_type: body.discount_type, paid: body.paid ?? fee, mode: body.mode,
        referred_by: patient.referred_by || null,
        notes: crmTag ? `[CRM_TAG:${crmTag}]` : null,
      });
    }
    return row(db, `${APPT_SELECT} WHERE a.id = ?`, id);
  });
}

/* Value of session prices after the package discount (sessions are priced before discount). */
function packageValue(pkg, sessionFees) {
  const ratio = pkg.subtotal > 0 ? pkg.total / pkg.subtotal : 1;
  return money(sessionFees * ratio);
}

/* A physiotherapy session can only be completed once its payment is recorded: for package plans the package payments
   must cover every session taken including this one; otherwise the session's own bill must be fully paid. */
function paymentShortfall(db, a) {
  const plan = a.plan_id ? row(db, 'SELECT * FROM therapy_plans WHERE id = ?', a.plan_id) : null;
  if (plan?.billing === 'package' && plan.invoice_id) {
    const pkg = row(db, 'SELECT subtotal, total, paid, status FROM invoices WHERE id = ?', plan.invoice_id);
    if (!pkg || pkg.status === 'Cancelled') return 'The package invoice for this plan is cancelled';
    const done = row(db, "SELECT COUNT(*) AS n, COALESCE(SUM(fee), 0) AS fees FROM appointments WHERE plan_id = ? AND status = 'Completed' AND id != ?", plan.id, a.id);
    const required = money(Math.min(packageValue(pkg, done.fees + a.fee), pkg.total));
    if (pkg.paid + 0.001 < required) {
      return `Payment not recorded: ₹${money(required - pkg.paid)} must be collected before completing session ${a.session_no} (₹${pkg.paid} paid, ₹${required} needed for ${done.n + 1} sessions)`;
    }
    return null;
  }
  if (!a.invoice_id) return 'Payment not recorded: bill and collect this session before completing it';
  const inv = row(db, 'SELECT number, total, paid, status FROM invoices WHERE id = ?', a.invoice_id);
  if (!inv || inv.status === 'Cancelled') return 'Payment not recorded: the bill for this session is cancelled';
  if (inv.paid + 0.001 < inv.total) return `Payment not recorded: ₹${money(inv.total - inv.paid)} is still due on ${inv.number}`;
  return null;
}

export function updateAppointment({ db, body, params, user, can }) {
  const current = mustGet(db, 'appointments', params.id, 'Appointment');
  if (current.type === 'lab' && !(body.status === 'Cancelled' && Object.keys(body).length === 1)) {
    bad('Older clinic lab records are read-only. Samples, results and reports are now handled by Remedium Labs');
  }
  const patch = { updated_at: stamp() };
  if (body.status !== undefined) patch.status = oneOf(body.status, STATUSES, 'Status');
  if (patch.status === 'Completed' && current.status !== 'Completed' && current.type === 'physiotherapy') {
    const shortfall = paymentShortfall(db, current);
    if (shortfall) {
      if (!body.allow_unpaid) bad(shortfall);
      if (!can?.('Billing & Invoice', 'approve')) bad(`${shortfall}. Completing without payment needs Approve access to Billing & Invoice.`);
      audit(db, user.user, 'complete without payment', 'appointment', `${current.code}: ${shortfall}`);
    }
  }
  if (body.date !== undefined) {
    patch.date = isDate(body.date) ? body.date : bad('Choose a valid date');
    if (patch.date !== current.date && patch.date < todayStr()) bad('A booking can only be moved to today or a later day');
  }
  if (body.time !== undefined) patch.time = isTime(body.time) ? body.time : bad('Choose a valid time');
  if (body.practitioner_id !== undefined) patch.practitioner_id = int(body.practitioner_id) ? mustGet(db, 'practitioners', body.practitioner_id, 'Practitioner').id : null;
  if (body.notes !== undefined) patch.notes = opt(body.notes, 1000);
  if (body.result !== undefined) patch.result = opt(body.result, 8000);
  if (body.reported_by !== undefined) patch.reported_by = opt(body.reported_by, 120);
  if (patch.status === 'Reported' && current.status !== 'Reported') patch.reported_at = stamp();
  const plan = current.plan_id ? row(db, 'SELECT * FROM therapy_plans WHERE id = ?', current.plan_id) : null;
  const packageSession = plan?.billing === 'package' && plan.invoice_id;
  if (body.fee !== undefined && money(body.fee) !== current.fee) {
    if (money(body.fee) < 0) bad('Session price cannot be negative');
    if (current.status === 'Cancelled') bad('This session is cancelled');
    if (current.invoice_id && !packageSession) {
      const inv = row(db, 'SELECT number, status FROM invoices WHERE id = ?', current.invoice_id);
      if (inv && inv.status !== 'Cancelled') bad(`This session is already billed on ${inv.number}; cancel that bill to change the price`);
    }
    patch.fee = money(body.fee);
  }
  tx(db, () => {
    update(db, 'appointments', current.id, patch);
    if (patch.fee !== undefined && packageSession) recalcPackage(db, user, plan.id);
    if (current.plan_id && patch.status) {
      const plan = row(db, 'SELECT * FROM therapy_plans WHERE id = ?', current.plan_id);
      const done = row(db, "SELECT COUNT(*) AS n FROM appointments WHERE plan_id = ? AND status = 'Completed'", plan.id).n;
      if (plan.status === 'Active' && done >= plan.total_sessions) run(db, "UPDATE therapy_plans SET status = 'Completed' WHERE id = ?", plan.id);
      if (patch.status === 'Completed' && plan.billing === 'package' && plan.invoice_id) {
        const pkg = row(db, 'SELECT status FROM invoices WHERE id = ?', plan.invoice_id);
        if (pkg && pkg.status !== 'Cancelled') issueSessionBill(db, user, current.id);
      }
    }
    audit(db, user.user, patch.status ? `status:${patch.status}` : 'update', 'appointment', current.code);
  });
  return row(db, `${APPT_SELECT} WHERE a.id = ?`, current.id);
}

/* ---------------------------------------------------------------- therapy plans */

function planRows(db, extra = '', args = [], tail = '') {
  return rows(
    db,
    `SELECT t.*, p.name AS patient, p.mobile, pr.name AS practitioner, inv.number AS invoice_number, inv.status AS invoice_status,
            inv.subtotal AS invoice_subtotal, inv.discount AS invoice_discount, inv.discount_type AS invoice_discount_type,
            inv.discount_value AS invoice_discount_value, inv.total AS invoice_total, inv.paid AS invoice_paid,
            (SELECT COUNT(*) FROM appointments a WHERE a.plan_id = t.id AND a.status = 'Completed') AS completed,
            (SELECT COUNT(*) FROM appointments a WHERE a.plan_id = t.id AND a.status NOT IN ('Cancelled')) AS booked,
            (SELECT MIN(a.date || ' ' || a.time) FROM appointments a WHERE a.plan_id = t.id AND a.status IN ('Scheduled','Checked In','In Session') AND a.date >= date('now','+330 minutes')) AS next_session
       FROM therapy_plans t JOIN patients p ON p.id = t.patient_id LEFT JOIN practitioners pr ON pr.id = t.practitioner_id
       LEFT JOIN invoices inv ON inv.id = t.invoice_id
      WHERE 1=1${extra} ORDER BY CASE t.status WHEN 'Active' THEN 0 WHEN 'On Hold' THEN 1 ELSE 2 END, t.id DESC${tail}`,
    ...args,
  );
}

export function listPlans({ db, q }) {
  const b = branchWhere(q, 't.branch_id');
  let extra = b.sql;
  const args = [...b.args];
  if (q.status) {
    extra += ' AND t.status = ?';
    args.push(oneOf(q.status, PLAN_STATUSES, 'Status'));
  }
  const term = str(q.q, 80);
  if (term) {
    extra += ' AND (p.name LIKE ? OR t.code LIKE ? OR t.condition LIKE ?)';
    args.push(like(term), like(term), like(term));
  }
  const { limit, offset } = page(q, 500, 50);
  return { items: planRows(db, extra, [...args, limit, offset], ' LIMIT ? OFFSET ?') };
}

export function getPlan({ db, params }) {
  const plan = planRows(db, ' AND t.id = ?', [int(params.id)])[0];
  if (!plan) throw new HttpError(404, 'Therapy plan not found');
  return {
    plan,
    sessions: rows(db, `${APPT_SELECT} WHERE a.plan_id = ? ORDER BY a.session_no, a.date`, plan.id),
    payments: plan.invoice_id ? rows(db, 'SELECT amount, mode, reference, at FROM payments WHERE invoice_id = ? ORDER BY id', plan.invoice_id) : [],
  };
}

/* Physiotherapy services by id, as [{ service_id, name, price }]. */
function therapiesFromIds(db, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => int(x)).filter(Boolean))];
  if (!list.length) bad('Choose at least one therapy');
  return list.map((id) => {
    const s = row(db, "SELECT id, name, price FROM services WHERE id = ? AND category = 'physiotherapy'", id);
    if (!s) bad('One of the chosen therapies is not in the therapy master');
    return { service_id: s.id, name: s.name, price: s.price };
  });
}

export function createPlan({ db, body, user, cfg, sid }) {
  const patient = mustGet(db, 'patients', required(int(body.patient_id) || null, 'Patient'), 'Patient');
  const billing = oneOf(body.billing || 'per_session', ['per_session', 'package'], 'Billing');
  let pkg = null;
  let therapies = null;
  let packageName = null;
  let packagePrice = null;
  let validityDays = null;
  if (billing === 'package') {
    if (int(body.package_id)) {
      pkg = mustGet(db, 'physio_packages', body.package_id, 'Package');
      if (!pkg.active) bad(`${pkg.name} is no longer offered`);
      therapies = parse(pkg.therapies, []);
      packageName = pkg.name;
      validityDays = pkg.validity_days;
    } else {
      therapies = therapiesFromIds(db, body.therapy_ids);
      packageName = opt(body.package_name, 120) || `Custom package (${therapies.map((t) => t.name).join(' + ')})`.slice(0, 160);
      validityDays = body.validity_days === '' || body.validity_days == null ? null : int(body.validity_days);
    }
    packagePrice = money(body.package_price ?? pkg?.price);
    if (packagePrice < 0) bad('Package price cannot be negative');
  }
  const total = int(body.total_sessions || pkg?.sessions);
  if (total < 1 || total > 100) bad('Number of sessions must be between 1 and 100');
  const fee = billing === 'package' ? money(packagePrice / total) : money(body.fee);
  const chosenDates = Array.isArray(body.session_dates)
    ? body.session_dates.map((d, i) => (isDate(d) ? d : bad(`Choose a date for session ${i + 1}`)))
    : null;
  if (chosenDates && chosenDates.length !== total) bad(`Choose a date for each of the ${total} sessions`);
  if (chosenDates) {
    const earliest = todayStr();
    chosenDates.forEach((d, i) => {
      if (d < earliest) bad(`Session ${i + 1} can only be booked for today or a later day`);
    });
  }
  const start = chosenDates ? chosenDates[0] : isDate(body.start_date) ? body.start_date : bad('Choose a start date');
  if (start < todayStr()) bad('A booking can only be made for today or a later day');
  const time = isTime(body.time) ? body.time : bad('Choose a session time');
  const frequency = chosenDates ? 'custom' : oneOf(body.frequency || 'daily', ['daily', 'alternate', 'weekly', 'mwf'], 'Frequency');
  const practitioner = int(body.practitioner_id) ? mustGet(db, 'practitioners', body.practitioner_id, 'Therapist') : null;
  const service = therapies ? therapies.map((t) => t.name).join(' + ').slice(0, 200) : str(body.service, 200) || `${LINE} Session`;
  const referral = parseReferral(db, body);
  const result = tx(db, () => {
    const code = `${PLAN_PREFIX}-${String(nextSeq(db, 'plan')).padStart(5, '0')}`;
    const branchId = defaultBranch(db, body.branch_id || patient.branch_id);
    if (billing === 'package' && !pkg && body.save_package) {
      const pkgCode = `PKG-${String(nextSeq(db, 'package')).padStart(4, '0')}`;
      const pkgId = insert(db, 'physio_packages', {
        code: pkgCode, name: packageName, sessions: total, therapies: JSON.stringify(therapies), price: packagePrice,
        validity_days: validityDays || null, description: null, active: 1, created_at: stamp(), created_by: user.user,
      });
      pkg = { id: pkgId };
      audit(db, user.user, 'create', 'physio package', pkgCode);
    }
    const id = insert(db, 'therapy_plans', {
      code, patient_id: patient.id, condition: opt(body.condition, 200) || patient.condition, practitioner_id: practitioner?.id ?? null,
      total_sessions: total, fee, start_date: start, frequency, status: 'Active', notes: opt(body.notes, 1000),
      branch_id: branchId, created_at: stamp(), created_by: user.user,
      billing, package_id: pkg?.id ?? null, package_name: packageName, therapies: therapies ? JSON.stringify(therapies) : null,
      package_price: packagePrice, valid_until: validityDays ? addDays(start, validityDays - 1) : null,
      ...referral,
    });
    if (body.schedule !== false) {
      const dates = chosenDates || [];
      if (!chosenDates) {
        let date = start;
        for (let s = 1; s <= total; s += 1) {
          while (weekday(date) === 0 || (frequency === 'mwf' && ![1, 3, 5].includes(weekday(date)))) date = addDays(date, 1);
          dates.push(date);
          date = addDays(date, frequency === 'daily' || frequency === 'mwf' ? 1 : frequency === 'alternate' ? 2 : 7);
        }
      }
      dates.forEach((date, i) => {
        const s = i + 1;
        insert(db, 'appointments', {
          code: `AP-${String(nextSeq(db, 'appointment')).padStart(6, '0')}`, patient_id: patient.id, type: 'physiotherapy',
          service, practitioner_id: practitioner?.id ?? null, plan_id: id, session_no: s, date, time, status: 'Scheduled',
          fee: billing === 'package' && s === total ? money(packagePrice - fee * (total - 1)) : fee,
          branch_id: branchId, created_at: stamp(), created_by: user.user, updated_at: stamp(),
        });
      });
    }
    let invoiceId = null;
    if (billing === 'package') {
      const crmTag = extractCrmTrackingTag(patient.referred_by, body.notes, referralText(referral));
      invoiceId = createInvoiceRow(db, user, {
        items: [{ name: `${LINE} package: ${packageName} — ${total} sessions`, qty: 1, rate: packagePrice, amount: packagePrice }],
        service_type: 'physiotherapy', patient_id: patient.id, branch_id: branchId,
        discount: body.discount, discount_type: body.discount_type, include_gst: body.include_gst, paid: body.paid ?? 0, mode: body.mode,
        notes: [`Plan ${code}`, crmTag ? `[CRM_TAG:${crmTag}]` : ''].filter(Boolean).join(' · '),
        referred_by: patient.referred_by || referralText(referral),
      });
      run(db, 'UPDATE therapy_plans SET invoice_id = ? WHERE id = ?', invoiceId, id);
      run(db, 'UPDATE appointments SET invoice_id = ? WHERE plan_id = ?', invoiceId, id);
    }
    audit(db, user.user, 'create', 'therapy plan', code);
    return { plan: planRows(db, ' AND t.id = ?', [id])[0], invoice_id: invoiceId };
  });
  if (result?.invoice_id) pushCrmSalesClose(cfg, sid, db, result.invoice_id);
  return result.plan;
}

/* Switch a pay-per-visit plan to package billing: one invoice for the whole plan. Any per-visit invoices already
   raised are cancelled and the money received on them is carried over as payments on the package invoice. */
export function billPlanAsPackage({ db, body, params, user, cfg, sid }) {
  const plan = mustGet(db, 'therapy_plans', params.id, 'Therapy plan');
  if (plan.billing === 'package') bad(`${plan.code} is already billed as a package`);
  if (['Discontinued'].includes(plan.status)) bad(`${plan.code} is discontinued`);
  const sessionSum = money(row(db, "SELECT COALESCE(SUM(fee), 0) AS n FROM appointments WHERE plan_id = ? AND status != 'Cancelled'", plan.id).n);
  const price = body.package_price === undefined || body.package_price === '' ? sessionSum : money(body.package_price);
  const keepSessionPrices = Math.abs(price - sessionSum) < 0.01;
  if (price <= 0) bad('Enter the package amount');
  const service = row(db, 'SELECT service FROM appointments WHERE plan_id = ? ORDER BY session_no LIMIT 1', plan.id)?.service || LINE;
  const packageName = opt(body.package_name, 120) || service;
  const old = rows(
    db,
    "SELECT DISTINCT i.* FROM invoices i JOIN appointments a ON a.invoice_id = i.id WHERE a.plan_id = ? AND i.status != 'Cancelled' ORDER BY i.id",
    plan.id,
  );
  const carried = money(old.reduce((s, i) => s + i.paid, 0));
  if (carried > price) bad(`₹${carried} has already been received for this plan, more than the package amount`);
  const result = tx(db, () => {
    const now = stamp();
    const patient = row(db, 'SELECT name, mobile, referred_by FROM patients WHERE id = ?', plan.patient_id);
    const apptNotes = rows(db, 'SELECT notes FROM appointments WHERE plan_id = ? ORDER BY id DESC LIMIT 5', plan.id)
      .map((a) => a.notes)
      .join(' ');
    const crmTag = extractCrmTrackingTag(patient?.referred_by, plan.referred_by, body.notes, apptNotes);
    const invoiceId = createInvoiceRow(db, user, {
      items: [{ name: `${LINE} package: ${packageName} — ${plan.total_sessions} sessions`, qty: 1, rate: price, amount: price }],
      service_type: 'physiotherapy', patient_id: plan.patient_id, branch_id: plan.branch_id,
      discount: body.discount, discount_type: body.discount_type, paid: 0,
      referred_by: patient?.referred_by || plan.referred_by || null,
      notes: [`Plan ${plan.code}${old.length ? ` · replaces ${old.map((i) => i.number).join(', ')}` : ''}`, crmTag ? `[CRM_TAG:${crmTag}]` : '']
        .filter(Boolean)
        .join(' · '),
    });
    const number = row(db, 'SELECT number FROM invoices WHERE id = ?', invoiceId).number;
    for (const inv of old) {
      for (const p of rows(db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY id', inv.id)) {
        insert(db, 'payments', { invoice_id: invoiceId, amount: p.amount, mode: p.mode, reference: p.reference || `from ${inv.number}`, at: p.at, by: p.by });
      }
      update(db, 'invoices', inv.id, { status: 'Cancelled', notes: [inv.notes, `Merged into package invoice ${number}`].filter(Boolean).join('\n') });
      audit(db, user.user, 'cancel (merged into package)', 'invoice', inv.number);
    }
    const total = row(db, 'SELECT total FROM invoices WHERE id = ?', invoiceId).total;
    const extra = money(body.paid);
    if (extra < 0) bad('Amount received cannot be negative');
    if (carried + extra > total + 0.001) bad(`Only ₹${money(total - carried)} is due on the package`);
    if (extra > 0) insert(db, 'payments', { invoice_id: invoiceId, amount: extra, mode: oneOf(body.mode || 'Cash', PAY_MODES, 'Payment mode'), reference: opt(body.reference, 80), at: now, by: user.user });
    const paid = money(carried + extra);
    const lastMode = row(db, 'SELECT mode FROM payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1', invoiceId)?.mode || null;
    update(db, 'invoices', invoiceId, { paid, status: invoiceStatus(total, paid), payment_mode: lastMode });
    update(db, 'therapy_plans', plan.id, {
      billing: 'package', package_name: packageName, package_price: price, fee: money(price / plan.total_sessions), invoice_id: invoiceId,
    });
    if (keepSessionPrices) run(db, "UPDATE appointments SET invoice_id = ? WHERE plan_id = ? AND status != 'Cancelled'", invoiceId, plan.id);
    else run(db, "UPDATE appointments SET invoice_id = ?, fee = ? WHERE plan_id = ? AND status != 'Cancelled'", invoiceId, money(price / plan.total_sessions), plan.id);
    audit(db, user.user, 'bill as package', 'therapy plan', `${plan.code} → ${number}`);
    return { plan: planRows(db, ' AND t.id = ?', [plan.id])[0], invoice_id: invoiceId, invoice_number: number, carried };
  });
  if (result?.invoice_id) pushCrmSalesClose(cfg, sid, db, result.invoice_id);
  return result;
}

/* ---------------------------------------------------------------- session invoices (package plans) */

/* A per-session document for a package plan. The package invoice stays the financial record (revenue counted once);
   each session invoice snapshots that package's payment history at the time it is issued. */
function issueSessionBill(db, user, appointmentId) {
  const a = row(db, `${APPT_SELECT} WHERE a.id = ?`, appointmentId);
  if (!a?.plan_id) bad('This booking is not part of a therapy plan');
  const plan = row(db, 'SELECT * FROM therapy_plans WHERE id = ?', a.plan_id);
  if (plan.billing !== 'package' || !plan.invoice_id) bad('Session invoices are for package plans; bill this session from Billing instead');
  const pkg = row(db, 'SELECT * FROM invoices WHERE id = ?', plan.invoice_id);
  if (!pkg || pkg.status === 'Cancelled') bad('The package invoice for this plan is cancelled');
  const now = stamp();
  const payments = rows(db, 'SELECT amount, mode, reference, at, by FROM payments WHERE invoice_id = ? AND at <= ? ORDER BY at, id', pkg.id, now);
  const paid = money(payments.reduce((s, p) => s + p.amount, 0));
  const doneRow = row(db, "SELECT COUNT(*) AS n, COALESCE(SUM(fee), 0) AS fees FROM appointments WHERE plan_id = ? AND status = 'Completed' AND session_no <= ?", plan.id, a.session_no);
  const done = doneRow.n;
  const snapshot = {
    session: { no: a.session_no, of: plan.total_sessions, date: a.date, time: a.time, service: a.service, therapist: a.practitioner, value: a.fee, status: a.status },
    package: {
      name: plan.package_name || a.service, code: plan.code, invoice_number: pkg.number, sessions: plan.total_sessions,
      subtotal: pkg.subtotal, discount: pkg.discount, discount_type: pkg.discount_type, discount_value: pkg.discount_value,
      gst_rate: pkg.gst_rate || null, gst_amount: pkg.gst_amount || 0, total: pkg.total,
      valid_until: plan.valid_until,
      referred_by: referralText(plan),
    },
    payments,
    paid_to_date: paid,
    balance: money(Math.max(pkg.total - paid, 0)),
    sessions_completed: done,
    value_used: packageValue(pkg, doneRow.fees),
  };
  const existing = row(db, 'SELECT id FROM session_bills WHERE appointment_id = ?', a.id);
  if (existing) {
    update(db, 'session_bills', existing.id, { snapshot: JSON.stringify(snapshot), amount: a.fee, updated_at: now });
    return existing.id;
  }
  const number = `${pkg.number}/S${a.session_no}`;
  const id = insert(db, 'session_bills', {
    number, appointment_id: a.id, plan_id: plan.id, package_invoice_id: pkg.id, patient_id: a.patient_id, session_no: a.session_no,
    amount: a.fee, snapshot: JSON.stringify(snapshot), branch_id: a.branch_id, created_at: now, created_by: user.user, updated_at: now,
  });
  audit(db, user.user, 'issue session invoice', 'invoice', number);
  return id;
}

const SESSION_BILL_SELECT = `
  SELECT sb.*, p.name AS patient, p.code AS patient_code, p.mobile, p.address AS patient_address, br.name AS branch
    FROM session_bills sb LEFT JOIN patients p ON p.id = sb.patient_id LEFT JOIN branches br ON br.id = sb.branch_id`;

export function getSessionBill({ db, params }) {
  const bill = row(db, `${SESSION_BILL_SELECT} WHERE sb.id = ?`, int(params.id));
  if (!bill) throw new HttpError(404, 'Session invoice not found');
  return {
    bill: { ...bill, snapshot: parse(bill.snapshot, {}) },
    settings: getSettings(db),
    branch: bill.branch_id ? row(db, 'SELECT id, name, code, city, address, phone, email, gst_registered, gstin, state, state_code FROM branches WHERE id = ?', bill.branch_id) : null,
  };
}

export function listSessionBills({ db, q }) {
  const b = branchWhere(q, 'sb.branch_id');
  let where = `WHERE 1=1${b.sql}`;
  const args = [...b.args];
  if (int(q.plan_id)) {
    where += ' AND sb.plan_id = ?';
    args.push(int(q.plan_id));
  }
  if (int(q.package_invoice_id)) {
    where += ' AND sb.package_invoice_id = ?';
    args.push(int(q.package_invoice_id));
  }
  const term = str(q.q, 80);
  if (term) {
    where += ' AND (sb.number LIKE ? OR p.name LIKE ? OR p.mobile LIKE ?)';
    args.push(like(term), like(term), like(term));
  }
  const { limit, offset } = page(q);
  const total = row(db, `SELECT COUNT(*) AS n FROM session_bills sb LEFT JOIN patients p ON p.id = sb.patient_id ${where}`, ...args).n;
  const items = rows(db, `${SESSION_BILL_SELECT} ${where} ORDER BY sb.created_at DESC, sb.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset).map((s) => {
    const snap = parse(s.snapshot, {});
    return { ...s, snapshot: undefined, package_name: snap.package?.name, package_total: snap.package?.total, paid_to_date: snap.paid_to_date, balance: snap.balance, session_of: snap.session?.of };
  });
  return { total, items };
}

/* Issue (or refresh) a session's invoice, optionally taking a payment towards the package first. */
export function sessionBillForAppointment({ db, body, params, user, cfg, sid }) {
  const a = mustGet(db, 'appointments', params.id, 'Appointment');
  const plan = a.plan_id ? row(db, 'SELECT * FROM therapy_plans WHERE id = ?', a.plan_id) : null;
  if (!plan || plan.billing !== 'package' || !plan.invoice_id) bad('Session invoices are for package plans');
  const result = tx(db, () => {
    const amount = money(body.paid);
    if (amount < 0) bad('Amount cannot be negative');
    if (amount > 0) {
      const pkg = row(db, 'SELECT * FROM invoices WHERE id = ?', plan.invoice_id);
      const due = money(pkg.total - pkg.paid);
      if (amount > due + 0.001) bad(`Only ₹${due} is due on the package`);
      const mode = oneOf(body.mode || 'Cash', PAY_MODES, 'Payment mode');
      insert(db, 'payments', { invoice_id: pkg.id, amount, mode, reference: opt(body.reference, 80) || `Session ${a.session_no}`, at: stamp(), by: user.user });
      const paid = money(pkg.paid + amount);
      update(db, 'invoices', pkg.id, { paid, status: invoiceStatus(pkg.total, paid), payment_mode: mode });
      audit(db, user.user, `payment:${amount}`, 'invoice', pkg.number);
    }
    const id = issueSessionBill(db, user, a.id);
    return { bill: getSessionBill({ db, params: { id } }), package_invoice_id: plan.invoice_id };
  });
  if (result?.package_invoice_id) pushCrmSalesClose(cfg, sid, db, result.package_invoice_id);
  return result.bill;
}

/* Completed package sessions that have no session invoice yet (e.g. completed before this feature). */
export function backfillSessionBills(db) {
  const missing = rows(
    db,
    `SELECT a.id FROM appointments a JOIN therapy_plans t ON t.id = a.plan_id
      WHERE t.billing = 'package' AND t.invoice_id IS NOT NULL AND a.status = 'Completed'
        AND NOT EXISTS (SELECT 1 FROM session_bills sb WHERE sb.appointment_id = a.id)
      ORDER BY a.date, a.session_no`,
  );
  for (const m of missing) tx(db, () => issueSessionBill(db, { user: 'system' }, m.id));
  return missing.length;
}

/* ---------------------------------------------------------------- physiotherapy packages */

function packageRow(db, p) {
  const therapies = parse(p.therapies, []);
  const listValue = money(therapies.reduce((s, t) => s + num(t.price), 0) * p.sessions);
  return {
    ...p,
    therapies,
    list_value: listValue,
    per_session: p.sessions ? money(p.price / p.sessions) : 0,
    saving_pct: listValue > 0 ? Math.round(((listValue - p.price) / listValue) * 100) : 0,
    sold: row(db, 'SELECT COUNT(*) AS n FROM therapy_plans WHERE package_id = ?', p.id).n,
  };
}

export function listPackages({ db, q }) {
  const where = q.active === 'all' ? '' : 'WHERE active = 1';
  return rows(db, `SELECT * FROM physio_packages ${where} ORDER BY active DESC, name`).map((p) => packageRow(db, p));
}

function packageFields(db, body) {
  const sessions = int(body.sessions);
  if (sessions < 1 || sessions > 100) bad('Sessions must be between 1 and 100');
  const price = money(body.price);
  if (price < 0) bad('Price cannot be negative');
  const validity = body.validity_days === '' || body.validity_days == null ? null : int(body.validity_days);
  if (validity !== null && (validity < 1 || validity > 730)) bad('Validity must be between 1 and 730 days');
  return {
    name: required(str(body.name, 120), 'Package name'),
    sessions,
    therapies: JSON.stringify(therapiesFromIds(db, body.therapy_ids)),
    price,
    validity_days: validity,
    description: opt(body.description, 500),
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}

export function createPackage({ db, body, user }) {
  const fields = packageFields(db, body);
  return tx(db, () => {
    const code = `PKG-${String(nextSeq(db, 'package')).padStart(4, '0')}`;
    const id = insert(db, 'physio_packages', { ...fields, code, created_at: stamp(), created_by: user.user });
    audit(db, user.user, 'create', 'physio package', code);
    return packageRow(db, row(db, 'SELECT * FROM physio_packages WHERE id = ?', id));
  });
}

export function updatePackage({ db, body, params, user }) {
  const current = mustGet(db, 'physio_packages', params.id, 'Package');
  const merged = { ...current, therapy_ids: parse(current.therapies, []).map((t) => t.service_id), ...body };
  update(db, 'physio_packages', current.id, packageFields(db, merged));
  audit(db, user.user, 'update', 'physio package', current.code);
  return packageRow(db, row(db, 'SELECT * FROM physio_packages WHERE id = ?', current.id));
}

/* Package plans: the package is the sum of its (non-cancelled) session prices. Rebuilds the package invoice line,
   re-applies its discount and keeps the payments; refuses a total below what has already been paid. */
function recalcPackage(db, user, planId) {
  const plan = row(db, 'SELECT * FROM therapy_plans WHERE id = ?', planId);
  if (plan.billing !== 'package' || !plan.invoice_id) return;
  const inv = row(db, 'SELECT * FROM invoices WHERE id = ?', plan.invoice_id);
  if (!inv || inv.status === 'Cancelled') return;
  const sessions = rows(db, "SELECT fee FROM appointments WHERE plan_id = ? AND status != 'Cancelled'", plan.id);
  const subtotal = money(sessions.reduce((s, a) => s + a.fee, 0));
  let discount = 0;
  if (inv.discount > 0) {
    discount = inv.discount_type === 'percent' && inv.discount_value ? money((subtotal * inv.discount_value) / 100) : Math.min(inv.discount, subtotal);
  }
  const total = money(subtotal - discount);
  if (total + 0.001 < inv.paid) bad(`₹${inv.paid} has already been paid on this package; the package cannot be reduced to ₹${total}`);
  const name = plan.package_name || LINE;
  const items = [{ name: `${LINE} package: ${name} — ${sessions.length} sessions`, qty: 1, rate: subtotal, amount: subtotal }];
  const gstAmount = inv.gst_rate ? money((total * inv.gst_rate) / (100 + inv.gst_rate)) : 0;
  update(db, 'invoices', inv.id, { items: JSON.stringify(items), subtotal, discount, total, gst_amount: gstAmount, status: invoiceStatus(total, inv.paid) });
  update(db, 'therapy_plans', plan.id, { package_price: subtotal, total_sessions: sessions.length, fee: sessions.length ? money(subtotal / sessions.length) : plan.fee });
  if (inv.total !== total) audit(db, user.user, `package total ₹${inv.total} → ₹${total}`, 'invoice', inv.number);
}

/* Adds sessions after the last one (same time and frequency) or cancels the last not-yet-attended ones. */
function resizePlan(db, user, plan, total) {
  const live = rows(db, "SELECT * FROM appointments WHERE plan_id = ? AND status != 'Cancelled' ORDER BY session_no", plan.id);
  if (total === live.length) return;
  if (total > live.length) {
    const last = live[live.length - 1];
    const step = plan.frequency === 'alternate' ? 2 : plan.frequency === 'weekly' ? 7 : 1;
    let date = addDays(last ? last.date : plan.start_date, last ? step : 0);
    const maxNo = row(db, 'SELECT COALESCE(MAX(session_no), 0) AS n FROM appointments WHERE plan_id = ?', plan.id).n;
    const fee = last ? last.fee : plan.fee;
    for (let i = 0; i < total - live.length; i += 1) {
      while (weekday(date) === 0 || (plan.frequency === 'mwf' && ![1, 3, 5].includes(weekday(date)))) date = addDays(date, 1);
      insert(db, 'appointments', {
        code: `AP-${String(nextSeq(db, 'appointment')).padStart(6, '0')}`, patient_id: plan.patient_id, type: 'physiotherapy',
        service: last?.service || plan.package_name || `${LINE} Session`, practitioner_id: last?.practitioner_id ?? plan.practitioner_id,
        plan_id: plan.id, session_no: maxNo + i + 1, date, time: last?.time || '10:00', status: 'Scheduled', fee,
        invoice_id: plan.billing === 'package' ? plan.invoice_id : null, branch_id: plan.branch_id,
        created_at: stamp(), created_by: user.user, updated_at: stamp(),
      });
      date = addDays(date, step);
    }
    return;
  }
  const removable = live.filter((a) => a.status === 'Scheduled' && !(plan.billing !== 'package' && a.invoice_id)).reverse();
  const toCancel = live.length - total;
  if (removable.length < toCancel) {
    bad(`Only ${removable.length} upcoming session(s) can be removed; the rest are attended, in progress or billed`);
  }
  for (const a of removable.slice(0, toCancel)) {
    update(db, 'appointments', a.id, { status: 'Cancelled', notes: [a.notes, 'Removed when the plan was shortened'].filter(Boolean).join('\n'), updated_at: stamp() });
  }
}

/* Outside doctors used on earlier bookings, most used first, for quick re-entry. */
export function listReferrers({ db, q }) {
  const b = branchWhere(q);
  return rows(
    db,
    `SELECT referred_by AS name, MAX(ref_contact) AS contact, COUNT(*) AS bookings FROM therapy_plans
      WHERE ref_type = 'outside' AND referred_by IS NOT NULL${b.sql} GROUP BY referred_by ORDER BY bookings DESC, name LIMIT 200`,
    ...b.args,
  );
}

function applySessionSchedule(db, plan, sessions) {
  if (!Array.isArray(sessions)) return;
  const locked = new Set(['Completed', 'Cancelled', 'Reported', 'No Show']);
  for (const s of sessions) {
    const a = row(db, 'SELECT * FROM appointments WHERE id = ? AND plan_id = ?', int(s.id), plan.id);
    if (!a || locked.has(a.status)) continue;
    const next = {};
    if (s.date !== undefined) next.date = isDate(s.date) ? s.date : bad(`Choose a date for session ${a.session_no}`);
    if (s.time !== undefined) next.time = isTime(s.time) ? s.time : bad(`Choose a time for session ${a.session_no}`);
    if (Object.keys(next).length) update(db, 'appointments', a.id, { ...next, updated_at: stamp() });
  }
}

function spreadPackageFees(db, planId, price) {
  const live = rows(db, "SELECT id FROM appointments WHERE plan_id = ? AND status != 'Cancelled' ORDER BY session_no", planId);
  if (!live.length) return money(0);
  const fee = money(price / live.length);
  live.forEach((a, i) => {
    const amount = i === live.length - 1 ? money(price - fee * (live.length - 1)) : fee;
    update(db, 'appointments', a.id, { fee: amount, updated_at: stamp() });
  });
  return fee;
}

export function updatePlan({ db, body, params, user }) {
  const plan = mustGet(db, 'therapy_plans', params.id, 'Therapy plan');
  const patch = {};
  if (body.status !== undefined) patch.status = oneOf(body.status, PLAN_STATUSES, 'Status');
  if (body.notes !== undefined) patch.notes = opt(body.notes, 1000);
  if (body.condition !== undefined) patch.condition = opt(body.condition, 200);
  if (body.package_name !== undefined && plan.billing === 'package') patch.package_name = opt(body.package_name, 160) || plan.package_name;
  if (body.practitioner_id !== undefined) patch.practitioner_id = int(body.practitioner_id) || null;
  if (body.ref_type !== undefined) Object.assign(patch, parseReferral(db, body));
  let resizeTo = null;
  if (body.total_sessions !== undefined) {
    resizeTo = int(body.total_sessions);
    if (resizeTo < 1 || resizeTo > 100) bad('Number of sessions must be between 1 and 100');
    if (plan.status === 'Discontinued' && resizeTo !== plan.total_sessions) {
      bad(`${plan.code} is discontinued; sessions cannot be changed`);
    }
  }
  const packagePrice = body.package_price !== undefined && plan.billing === 'package' ? money(body.package_price) : null;
  if (packagePrice !== null && packagePrice < 0) bad('Package price cannot be negative');
  const visitFee = body.fee !== undefined && plan.billing !== 'package' ? money(body.fee) : null;
  if (visitFee !== null && visitFee < 0) bad('Fee cannot be negative');
  tx(db, () => {
    applySessionSchedule(db, plan, body.sessions);
    const beforeMax = row(db, 'SELECT COALESCE(MAX(session_no), 0) AS n FROM appointments WHERE plan_id = ?', plan.id).n;
    if (resizeTo !== null) {
      resizePlan(db, user, plan, resizeTo);
      patch.total_sessions = resizeTo;
      if (plan.status === 'Completed' && resizeTo > plan.total_sessions) patch.status = 'Active';
      const created = rows(db, 'SELECT id, session_no FROM appointments WHERE plan_id = ? AND session_no > ? ORDER BY session_no', plan.id, beforeMax);
      (Array.isArray(body.new_sessions) ? body.new_sessions : []).forEach((s, i) => {
        const a = created[i];
        if (!a) return;
        const next = {};
        if (isDate(s.date)) next.date = s.date;
        if (isTime(s.time)) next.time = s.time;
        if (Object.keys(next).length) update(db, 'appointments', a.id, { ...next, updated_at: stamp() });
      });
    }
    if (packagePrice !== null) {
      patch.package_price = packagePrice;
      patch.fee = spreadPackageFees(db, plan.id, packagePrice);
    }
    if (visitFee !== null) {
      patch.fee = visitFee;
      run(db, "UPDATE appointments SET fee = ?, updated_at = ? WHERE plan_id = ? AND status = 'Scheduled'", visitFee, stamp(), plan.id);
    }
    update(db, 'therapy_plans', plan.id, patch);
    if (resizeTo !== null || packagePrice !== null || patch.package_name) recalcPackage(db, user, plan.id);
    if (patch.status === 'Discontinued') {
      run(db, "UPDATE appointments SET status = 'Cancelled', updated_at = ? WHERE plan_id = ? AND status = 'Scheduled' AND date >= ?", stamp(), plan.id, todayStr());
    }
    if (patch.practitioner_id !== undefined) {
      run(db, "UPDATE appointments SET practitioner_id = ? WHERE plan_id = ? AND status = 'Scheduled'", patch.practitioner_id, plan.id);
    }
    if (patch.ref_type !== undefined) {
      const text = referralText(patch);
      run(
        db,
        `UPDATE invoices SET referred_by = ? WHERE status != 'Cancelled'
           AND (id = ? OR id IN (SELECT invoice_id FROM appointments WHERE plan_id = ? AND invoice_id IS NOT NULL))`,
        text, plan.invoice_id, plan.id,
      );
    }
    audit(db, user.user, 'update', 'therapy plan', plan.code);
  });
  return planRows(db, ' AND t.id = ?', [plan.id])[0];
}

/* ---------------------------------------------------------------- invoices */

const INV_SELECT = `
  SELECT i.*, COALESCE(p.name, i.customer, 'Walk-in') AS patient, p.mobile, p.code AS patient_code, p.address AS patient_address, br.name AS branch,
         dr.name AS doctor, dr.specialty AS doctor_specialty, dr.qualification AS doctor_qualification, dr.registration_no AS doctor_registration
    FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id LEFT JOIN branches br ON br.id = i.branch_id
    LEFT JOIN practitioners dr ON dr.id = i.practitioner_id`;

export function listInvoices({ db, q }) {
  const b = branchWhere(q, 'i.branch_id');
  let where = `WHERE 1=1${b.sql}`;
  const args = [...b.args];
  if (q.type) {
    where += ' AND i.service_type = ?';
    args.push(oneOf(q.type, INVOICE_TYPES, 'Service type'));
  }
  if (q.status === 'due') where += " AND i.status IN ('Unpaid','Partially Paid')";
  else if (q.status) {
    where += ' AND i.status = ?';
    args.push(oneOf(q.status, ['Paid', 'Partially Paid', 'Unpaid', 'Cancelled'], 'Status'));
  }
  if (isDate(q.from)) {
    where += ' AND i.created_at >= ?';
    args.push(q.from);
  }
  if (isDate(q.to)) {
    where += ' AND i.created_at < ?';
    args.push(addDays(q.to, 1));
  }
  const term = str(q.q, 80);
  if (term) {
    where += ' AND (i.number LIKE ? OR p.name LIKE ? OR i.customer LIKE ? OR p.mobile LIKE ?)';
    args.push(like(term), like(term), like(term), like(term));
  }
  const { limit, offset } = page(q, 500, 50);
  const totals = row(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN i.status != 'Cancelled' THEN i.total END),0) AS billed,
            COALESCE(SUM(CASE WHEN i.status != 'Cancelled' THEN i.paid END),0) AS collected
       FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id ${where}`,
    ...args,
  );
  const items = rows(
    db,
    `SELECT base.*,
            (SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) FROM payments WHERE invoice_id = base.id) AS collected_amount,
            (SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) FROM payments WHERE invoice_id = base.id) AS refunded_amount
       FROM (${INV_SELECT} ${where} ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?) base`,
    ...args,
    limit,
    offset,
  );
  return { total: totals.n, billed: totals.billed, collected: totals.collected, items };
}

export function getInvoice({ db, params }) {
  const invoice = row(db, `${INV_SELECT} WHERE i.id = ?`, int(params.id));
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  const payments = rows(db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY at', invoice.id);
  const package_usage = packageUsage(db, invoice);
  const branchCfg = savedBranchConfig(db, invoice.branch_id);
  const settings = { ...getSettings(db) };
  if (branchCfg) {
    const applies = branchCfg.applies || {};
    if (applies.invoice) {
      if (branchCfg.tagline) settings.tagline = branchCfg.tagline;
      if (branchCfg.signature) settings.invoice_signature = branchCfg.signature;
      if (branchCfg.display_name) settings.branch_display_name = branchCfg.display_name;
      if (branchCfg.invoice_footer) settings.invoice_footer = branchCfg.invoice_footer;
      if (branchCfg.policy_note) settings.policy_note = branchCfg.policy_note;
    }
    if (applies.invoice || applies.billing) {
      if (branchCfg.upi_id) settings.upi_id = branchCfg.upi_id;
      if (branchCfg.upi_qr) settings.upi_qr = branchCfg.upi_qr;
    }
  }
  return {
    invoice: { ...invoice, items: labItemCodes(db, invoice, parse(invoice.items, [])) },
    payments,
    settings,
    branch: invoice.branch_id
      ? row(db, 'SELECT id, name, code, city, address, phone, email, gst_registered, gstin, state, state_code FROM branches WHERE id = ?', invoice.branch_id) || null
      : null,
    session_bills: rows(db, 'SELECT id, number, session_no, amount, created_at FROM session_bills WHERE package_invoice_id = ? ORDER BY session_no', invoice.id),
    package_usage,
    refunds: buildAdvanceRefunds(invoice, payments, package_usage?.sessions || []),
  };
}

/* Lab invoice lines are stored by test name. Keep the ERP item code beside the name so a manager can edit the booking. */
function labItemCodes(db, invoice, items) {
  if (!invoice.trf_id) return items;
  const saved = parse(row(db, 'SELECT tests FROM lab_bookings WHERE trf_id = ?', invoice.trf_id)?.tests, []);
  return items.map((it) => {
    if (it.item) return it;
    const name = String(it.name || '').trim().toLowerCase();
    const hit = saved.find((t) => t.item && String(t.item_name || t.item || '').trim().toLowerCase() === name);
    if (hit) return { ...it, item: hit.item };
    const svc = name
      ? row(db, "SELECT code FROM services WHERE category = 'lab' AND lower(name) = ? AND code IS NOT NULL AND code != '' LIMIT 1", name)
      : null;
    return svc?.code ? { ...it, item: svc.code } : it;
  });
}

function medSignature(items) {
  return items
    .filter((it) => it.med)
    .map((it) => `${it.med}\t${it.qty}`)
    .sort()
    .join('\n');
}

/* The bill a manager sends back: names, quantities and rates. Medicine quantities cannot change,
   because those units were already taken from a batch. */
export function readBillItems(body, invoice) {
  const oldItems = parse(invoice.items, []);
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) bad('Add at least one line item');
  const batches = new Map();
  for (const it of oldItems) {
    if (it.med && it.batches) batches.set(`${it.med}\t${it.qty}`, it.batches);
  }
  const items = raw.map((it) => {
    const qty = num(it.qty, 1);
    if (qty <= 0) bad('Quantity must be more than zero');
    const rate = money(it.rate);
    if (rate < 0) bad('Rate cannot be negative');
    const name = required(str(it.name, 160), 'Item name');
    const med = opt(it.med, 140);
    if (med && !Number.isInteger(qty)) bad(`Sell ${name} in whole units`);
    const itemCode = opt(it.item, 140);
    const itemId = med ? null : int(it.item_id) || null;
    const line = { name, qty, rate, amount: money(qty * rate) };
    if (itemId) line.item_id = itemId;
    if (med) {
      line.med = med;
      const batch = batches.get(`${med}\t${qty}`);
      if (batch) line.batches = batch;
    }
    if (itemCode) line.item = itemCode;
    return line;
  });
  if (medSignature(items) !== medSignature(oldItems)) {
    bad('Medicine quantities stay with the batch that was dispensed. Change the rate, or cancel this bill and create a new one.');
  }
  return items;
}

function priceBill(items, discountTypeRaw, discountRaw) {
  const subtotal = money(items.reduce((s, it) => s + it.amount, 0));
  const discountType = discountTypeRaw === 'percent' ? 'percent' : 'flat';
  const discountValue = num(discountRaw);
  if (discountValue < 0) bad('Discount cannot be negative');
  if (discountType === 'percent' && discountValue > 100) bad('Percentage discount cannot be more than 100%');
  if (discountType === 'flat' && discountValue > subtotal + 0.001) bad(`Discount cannot be more than the bill amount (₹${subtotal})`);
  const discount = discountType === 'percent' ? money((subtotal * discountValue) / 100) : money(discountValue);
  const total = money(subtotal - discount);
  return {
    subtotal,
    discount,
    discount_type: discount > 0 ? discountType : null,
    discount_value: discount > 0 ? money(discountValue) : null,
    total,
  };
}

/* Drop the newest payments until the amount received equals the revised bill. */
export function shrinkPayments(db, invoiceId, newPaid) {
  const payments = rows(db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY id DESC', invoiceId);
  let excess = money(payments.reduce((s, p) => s + p.amount, 0) - newPaid);
  if (excess <= 0.001) return;
  for (const payment of payments) {
    if (excess <= 0.001) break;
    if (payment.amount <= 0.001) continue;
    const take = Math.min(payment.amount, excess);
    const left = money(payment.amount - take);
    if (left <= 0.001) run(db, 'DELETE FROM payments WHERE id = ?', payment.id);
    else update(db, 'payments', payment.id, { amount: left });
    excess = money(excess - take);
  }
}

function applyStockEdit(db, user, invoice, oldItems, items) {
  const sum = (list) => {
    const totals = new Map();
    for (const it of list) {
      if (!it.item_id) continue;
      totals.set(it.item_id, (totals.get(it.item_id) || 0) + Number(it.qty));
    }
    return totals;
  };
  const before = sum(oldItems);
  const after = sum(items);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const delta = money((after.get(id) || 0) - (before.get(id) || 0));
    if (Math.abs(delta) < 0.0001) continue;
    const stock = row(db, 'SELECT id, name, stock, active FROM items WHERE id = ?', id);
    if (!stock) bad('One of the items is no longer in the inventory');
    if (delta > 0) {
      if (!stock.active) bad(`${stock.name} is inactive`);
      if (stock.stock + 0.0001 < delta) bad(`Only ${stock.stock} of ${stock.name} left in stock`);
    }
    run(db, 'UPDATE items SET stock = stock - ? WHERE id = ?', delta, id);
    insert(db, 'stock_moves', {
      item_id: id,
      qty: -delta,
      kind: delta > 0 ? 'Sale' : 'Return',
      ref: invoice.number,
      note: 'Bill edited',
      at: stamp(),
      by: user.user,
    });
  }
}

/* Replace the lines, keep the discount rule, and fit the amount already received to the new total.
   A smaller bill reduces the recorded payments. A larger bill leaves them and shows the extra as due. */
export function applyInvoiceRevision(db, user, invoice, items, discountBody) {
  if (invoice.status === 'Cancelled') bad('This invoice is cancelled');
  if (row(db, "SELECT id FROM therapy_plans WHERE invoice_id = ? AND billing = 'package'", invoice.id)) {
    bad('This package bill follows its session prices. Change those on the plan and the bill updates with them.');
  }
  const priced = priceBill(items, discountBody.discount_type, discountBody.discount);
  const gstAmount = invoice.gst_rate ? money((priced.total * invoice.gst_rate) / (100 + invoice.gst_rate)) : 0;
  const paid = money(Math.min(Math.max(invoice.paid, 0), priced.total));
  applyStockEdit(db, user, invoice, parse(invoice.items, []), items);
  if (paid + 0.001 < invoice.paid) shrinkPayments(db, invoice.id, paid);
  update(db, 'invoices', invoice.id, {
    items: JSON.stringify(items),
    subtotal: priced.subtotal,
    discount: priced.discount,
    discount_type: priced.discount_type,
    discount_value: priced.discount_value,
    gst_amount: gstAmount,
    total: priced.total,
    paid,
    status: invoiceStatus(priced.total, paid),
  });
  if (invoice.appointment_id) {
    const appointment = row(db, 'SELECT id, invoice_id FROM appointments WHERE id = ?', invoice.appointment_id);
    if (appointment?.invoice_id === invoice.id) update(db, 'appointments', appointment.id, { fee: priced.total });
  }
  audit(db, user.user, `edit bill ₹${invoice.total} → ₹${priced.total}; paid ₹${invoice.paid} → ₹${paid}`, 'invoice', invoice.number);
  return priced;
}

export function reviseInvoice({ db, body, params, user }) {
  const invoice = mustGet(db, 'invoices', params.id, 'Invoice');
  if (invoice.trf_id) bad('This lab bill is revised with its lab booking');
  const items = readBillItems(body, invoice);
  return tx(db, () => {
    applyInvoiceRevision(db, user, invoice, items, body);
    return getInvoice({ db, params: { id: invoice.id } });
  });
}

/* For a package invoice: sessions taken against it, the value used and what is owed for sessions already taken. */
function packageUsage(db, invoice) {
  const plan = row(db, "SELECT * FROM therapy_plans WHERE invoice_id = ? AND billing = 'package'", invoice.id);
  if (!plan) return null;
  const sessions = rows(
    db,
    `SELECT a.id, a.session_no, a.date, a.time, a.status, a.fee, sb.id AS session_bill_id, sb.number AS session_bill_number
       FROM appointments a LEFT JOIN session_bills sb ON sb.appointment_id = a.id
      WHERE a.plan_id = ? ORDER BY a.session_no`,
    plan.id,
  );
  const completedRows = sessions.filter((s) => s.status === 'Completed');
  const completed = completedRows.length;
  const used = packageValue(invoice, completedRows.reduce((s, x) => s + x.fee, 0));
  const live = sessions.filter((s) => s.status !== 'Cancelled');
  const perSession = live.length ? money(invoice.total / live.length) : plan.fee;
  return {
    plan_code: plan.code,
    total_sessions: live.length,
    completed,
    remaining: Math.max(live.length - completed, 0),
    per_session: perSession,
    value_used: used,
    paid: invoice.paid,
    due_for_used: money(Math.max(used - invoice.paid, 0)),
    advance: money(Math.max(invoice.paid - used, 0)),
    sessions,
  };
}

function crmSaleFromInvoice(db, invoiceId) {
  const inv = row(
    db,
    `SELECT i.id, i.number, i.total, i.paid, i.referred_by, i.notes, i.appointment_id, i.patient_id,
            p.name AS patient_name, p.mobile, p.referred_by AS patient_referred_by
       FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id WHERE i.id = ?`,
    invoiceId,
  );
  if (!inv) return null;
  const appt = inv.appointment_id ? row(db, 'SELECT notes FROM appointments WHERE id = ?', inv.appointment_id) : null;
  let tracking_tag = extractCrmTrackingTag(inv.referred_by, inv.notes, inv.patient_referred_by, appt?.notes);
  if (!tracking_tag && inv.patient_id) {
    const taggedAppt = row(
      db,
      `SELECT notes FROM appointments WHERE patient_id = ? AND notes LIKE '%CRM%' ORDER BY id DESC LIMIT 1`,
      inv.patient_id,
    );
    const plan = row(
      db,
      `SELECT notes, referred_by FROM therapy_plans WHERE patient_id = ? ORDER BY id DESC LIMIT 1`,
      inv.patient_id,
    );
    tracking_tag = extractCrmTrackingTag(taggedAppt?.notes, plan?.notes, plan?.referred_by, inv.patient_referred_by);
  }
  if (!tracking_tag) return null;
  const amount = Number(inv.paid) > 0 ? Number(inv.paid) : Number(inv.total) || 0;
  return {
    tracking_tag,
    amount,
    bill_ref: inv.number,
    patient_name: inv.patient_name || '',
    mobile: inv.mobile || '',
    referred_by: inv.referred_by || inv.patient_referred_by || '',
    notes: inv.notes || appt?.notes || '',
  };
}

function pushCrmSalesClose(cfg, sid, db, invoiceId) {
  if (!cfg) return;
  const payload = crmSaleFromInvoice(db, invoiceId);
  if (!payload) return;
  setImmediate(() => {
    notifyCrmSalesClose(cfg, sid, payload).catch(() => {});
  });
}

/** Paid / billed invoices that carry a CRM tracking tag — for Smilecure CRM sync. */
export function listCrmBillCloses({ db, q }) {
  const limit = Math.min(Math.max(int(q.limit) || 200, 1), 500);
  const items = rows(
    db,
    `SELECT i.id, i.number, i.total, i.paid, i.status, i.notes, i.referred_by, i.appointment_id, i.patient_id,
            i.created_at, p.name AS patient_name, p.mobile, p.referred_by AS patient_referred_by
       FROM invoices i
       LEFT JOIN patients p ON p.id = i.patient_id
      WHERE i.status != 'Cancelled'
      ORDER BY i.id DESC
      LIMIT ?`,
    limit,
  );
  const closes = [];
  for (const inv of items) {
    const payload = crmSaleFromInvoice(db, inv.id);
    if (!payload) continue;
    if (!(Number(inv.paid) > 0 || Number(inv.total) > 0)) continue;
    const tag = String(payload.tracking_tag || '').toUpperCase();
    const tagParts = tag.split('-');
    const executiveCode = tagParts.length >= 2 ? tagParts[1] : '';
    const referred = String(payload.referred_by || '').trim();
    closes.push({
      tracking_tag: tag,
      booking_id: '',
      amount: payload.amount,
      bill_ref: payload.bill_ref,
      portal: process.env.CARE_FLAVOR === 'aesthetic' ? 'aesthetic' : 'care',
      patient_name: payload.patient_name,
      mobile: payload.mobile,
      notes: payload.notes,
      closed_at: inv.created_at || null,
      executive: referred && !/^CRM-/i.test(referred) ? referred : '',
      executive_code: executiveCode,
    });
  }
  return { closes, total_amount: closes.reduce((s, c) => s + (Number(c.amount) || 0), 0) };
}

export function createInvoice({ db, body, user, cfg, sid }) {
  const serviceType = oneOf(body.service_type, INVOICE_TYPES, 'Service type');
  if (serviceType === 'lab') bad(LAB_WORKFLOW);
  const patient = int(body.patient_id) ? mustGet(db, 'patients', body.patient_id, 'Patient') : null;
  const customer = opt(body.customer, 120);
  if (!patient && !(serviceType === 'pharmacy' && customer)) bad('Choose a patient (pharmacy walk-ins need a customer name)');
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) bad('Add at least one line item');
  const items = raw.map((it) => {
    const qty = num(it.qty, 1);
    if (qty <= 0) bad('Quantity must be more than zero');
    const rate = money(it.rate);
    if (rate < 0) bad('Rate cannot be negative');
    const med = serviceType === 'pharmacy' ? opt(it.med, 140) : null;
    if (med && !Number.isInteger(qty)) bad(`Sell ${str(it.name, 160)} in whole units`);
    return { item_id: med ? undefined : int(it.item_id) || undefined, med: med || undefined, name: required(str(it.name, 160), 'Item name'), qty, rate, amount: money(qty * rate) };
  });
  const appointment = int(body.appointment_id) ? mustGet(db, 'appointments', body.appointment_id, 'Appointment') : null;
  if (appointment?.invoice_id) {
    const existing = row(db, 'SELECT number, status FROM invoices WHERE id = ?', appointment.invoice_id);
    if (existing && existing.status !== 'Cancelled') bad(`This appointment is already billed on ${existing.number}`);
  }
  const doctorId = int(body.practitioner_id) || (appointment?.practitioner_id ?? 0);
  const doctor = doctorId ? row(db, 'SELECT * FROM practitioners WHERE id = ?', doctorId) : null;
  if (serviceType === 'consultation') {
    if (!doctor || doctor.role !== 'Doctor') bad('Choose the consulting doctor');
    if (!doctor.active && !appointment) bad(`${doctor.name} is inactive`);
  }
  const referredBy =
    opt(body.referred_by, 120) ||
    patient?.referred_by ||
    (appointment ? planReferral(db, appointment.id) : null) ||
    extractCrmTrackingTag(appointment?.notes) ||
    null;
  const notes = [opt(body.notes, 400), extractCrmTrackingTag(patient?.referred_by, appointment?.notes) ? `[CRM_TAG:${extractCrmTrackingTag(patient?.referred_by, appointment?.notes)}]` : '']
    .filter(Boolean)
    .join(' · ')
    .slice(0, 500) || null;
  const invoice = tx(db, () => {
    for (const it of items) {
      if (!it.item_id) continue;
      const stock = row(db, 'SELECT id, name, stock FROM items WHERE id = ? AND active = 1', it.item_id);
      if (!stock) bad(`${it.name} is not in the inventory`);
      if (stock.stock < it.qty) bad(`Only ${stock.stock} of ${stock.name} left in stock`);
    }
    const branchId = defaultBranch(db, body.branch_id || patient?.branch_id);
    const id = createInvoiceRow(db, user, {
      items, service_type: serviceType, patient_id: patient?.id, customer: patient ? null : customer,
      appointment_id: appointment?.id, branch_id: branchId, discount: body.discount, discount_type: body.discount_type, paid: body.paid,
      mode: body.mode, reference: opt(body.reference, 80), notes,
      referred_by: referredBy,
      practitioner_id: doctor?.role === 'Doctor' ? doctor.id : null,
    });
    const number = row(db, 'SELECT number FROM invoices WHERE id = ?', id).number;
    for (const it of items) {
      if (!it.item_id) continue;
      run(db, 'UPDATE items SET stock = stock - ? WHERE id = ?', it.qty, it.item_id);
      insert(db, 'stock_moves', { item_id: it.item_id, qty: -it.qty, kind: 'Sale', ref: number, note: patient?.name || customer, at: stamp(), by: user.user });
    }
    return getInvoice({ db, params: { id } });
  });
  pushCrmSalesClose(cfg, sid, db, invoice.id);
  return invoice;
}

function sessionNoFromRef(reference) {
  const match = String(reference || '').match(/session\s*(\d+)/i) || String(reference || '').match(/^s(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

const REFUND_WAIT_DAYS = 7;
const REFUND_DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TAKEN = new Set(['Completed', 'Reported']);
const SESSION_STARTED = new Set(['In Session', 'Checked In', 'Waiting']);

function paymentInstant(value) {
  const time = Date.parse(String(value || '').replace(' ', 'T'));
  return Number.isFinite(time) ? time : 0;
}

function refundPaymentId(reference) {
  const match = String(reference || '').match(/refund\s*#(\d+)/i);
  return match ? Number(match[1]) : 0;
}

/* Advance paid for a session that has not been taken. It can be refunded only after 7 days
   with no completed treatment in that window. Money already covering a completed session stays. */
export function buildAdvanceRefunds(invoice, payments, sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return { wait_days: REFUND_WAIT_DAYS, unused: 0, offers: [] };
  const live = list
    .filter((s) => s.status !== 'Cancelled' && s.status !== 'No Show')
    .sort((a, b) => Number(a.session_no) - Number(b.session_no));
  const gross = live.reduce((sum, s) => sum + Number(s.fee || 0), 0);
  const payable = Number(invoice.total) || 0;
  const rounded = live.map((s) => (gross > 0 ? (Number(s.fee || 0) * payable) / gross : (live.length ? payable / live.length : 0))).map(money);
  if (rounded.length) {
    const drift = money(payable - rounded.reduce((sum, n) => sum + n, 0));
    rounded[rounded.length - 1] = money(rounded[rounded.length - 1] + drift);
  }
  const byNo = {};
  list.forEach((s) => { byNo[Number(s.session_no)] = s; });
  const takenShare = live.reduce((sum, s, i) => (SESSION_TAKEN.has(s.status) ? sum + rounded[i] : sum), 0);
  const netPaid = money((payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const unused = money(Math.max(Math.min(netPaid, Number(invoice.paid) || 0) - takenShare, 0));
  const refundedByPayment = {};
  (payments || []).forEach((p) => {
    const id = refundPaymentId(p.reference);
    if (id && Number(p.amount) < 0) refundedByPayment[id] = money((refundedByPayment[id] || 0) + Math.abs(Number(p.amount)));
  });
  const now = Date.now();
  const upcoming = live.some((s) => !SESSION_TAKEN.has(s.status) && !SESSION_STARTED.has(s.status));
  const candidates = [];
  (payments || []).forEach((p) => {
    const amount = Number(p.amount) || 0;
    if (amount <= 0 || /^refund\b/i.test(String(p.reference || ''))) return;
    const no = sessionNoFromRef(p.reference);
    const session = no ? byNo[no] : null;
    if (no && session && SESSION_TAKEN.has(session.status)) return;
    if (!no && !upcoming) return;
    const left = money(amount - (refundedByPayment[p.id] || 0));
    if (left <= 0) return;
    const at = paymentInstant(p.at);
    const opensAt = at + REFUND_WAIT_DAYS * REFUND_DAY_MS;
    const treated = Boolean(at) && list.some((s) => {
      if (!SESSION_TAKEN.has(s.status)) return false;
      const when = Date.parse(`${String(s.date || '').slice(0, 10)}T12:00:00`);
      return Number.isFinite(when) && when >= at && when <= opensAt;
    });
    let blocked = '';
    if (no && session && SESSION_STARTED.has(session.status)) blocked = `Session ${no} has started, so this advance cannot be refunded.`;
    else if (treated) blocked = 'A treatment was completed within 7 days of this payment, so this advance stays on the plan.';
    else if (!at || now < opensAt) blocked = `Refund opens on ${new Date(opensAt).toISOString().slice(0, 10)}. The session has not been taken yet.`;
    candidates.push({
      payment_id: p.id,
      session_no: no || 0,
      amount: left,
      paid_at: p.at,
      mode: p.mode || '',
      ready: !blocked,
      opens_on: !blocked || now >= opensAt ? null : new Date(opensAt).toISOString().slice(0, 10),
      blocked,
    });
  });
  candidates.sort((a, b) => Number(b.ready) - Number(a.ready) || String(a.paid_at).localeCompare(String(b.paid_at)));
  let pool = unused;
  const offers = [];
  candidates.forEach((item) => {
    const amount = money(Math.min(item.amount, Math.max(pool, 0)));
    if (amount <= 0) return;
    pool = money(pool - amount);
    offers.push({ ...item, amount });
  });
  return { wait_days: REFUND_WAIT_DAYS, unused, offers };
}

export function refundAdvance({ db, body, params, user }) {
  const invoice = mustGet(db, 'invoices', params.id, 'Invoice');
  if (invoice.status === 'Cancelled') bad('This invoice is cancelled');
  if (invoice.trf_id) bad('Lab bookings are refunded by Remedium Labs');
  const payments = rows(db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY id', invoice.id);
  const usage = packageUsage(db, invoice);
  const review = buildAdvanceRefunds(invoice, payments, usage?.sessions || []);
  const paymentId = int(body.payment_id);
  const offer = review.offers.find((item) => item.payment_id === paymentId);
  if (!offer) bad('This payment is not an unused advance for an upcoming session');
  if (!offer.ready) bad(offer.blocked || 'This advance cannot be refunded yet');
  const amount = money(body.amount);
  if (amount <= 0) bad('Enter the amount to refund');
  if (amount > offer.amount + 0.001) bad(`Only ₹${offer.amount} of this advance can be refunded`);
  const source = payments.find((p) => p.id === paymentId);
  tx(db, () => {
    insert(db, 'payments', {
      invoice_id: invoice.id,
      amount: -amount,
      mode: source?.mode || oneOf(body.mode || 'Cash', PAY_MODES, 'Payment mode'),
      reference: offer.session_no ? `Refund #${paymentId} Session ${offer.session_no}` : `Refund #${paymentId} advance`,
      at: stamp(),
      by: user.user,
    });
    const paid = money(Math.max(Number(invoice.paid) - amount, 0));
    update(db, 'invoices', invoice.id, { paid, status: invoiceStatus(invoice.total, paid) });
    audit(db, user.user, `refund:${amount}`, 'invoice', invoice.number);
  });
  return getInvoice({ db, params });
}

/* Move extra money recorded on one session onto another session of the same package.
   The invoice total and the amount received stay the same; only the session tag changes. */
export function adjustSessionPayment({ db, body, params, user }) {
  const invoice = mustGet(db, 'invoices', params.id, 'Invoice');
  if (invoice.status === 'Cancelled') bad('This invoice is cancelled');
  const fromNo = int(body.from_session);
  const toNo = int(body.to_session);
  if (!fromNo || !toNo || fromNo === toNo) bad('Choose the session that was overpaid and the session the extra should cover');
  const amount = money(body.amount);
  if (amount <= 0) bad('Enter the extra amount to move');
  const plan = row(db, "SELECT id FROM therapy_plans WHERE invoice_id = ? AND billing = 'package'", invoice.id);
  if (!plan) bad('Only a package invoice can move money between sessions');
  const sessions = rows(db, "SELECT session_no, fee, status FROM appointments WHERE plan_id = ? AND status NOT IN ('Cancelled', 'No Show') ORDER BY session_no", plan.id);
  if (!sessions.some((s) => Number(s.session_no) === fromNo) || !sessions.some((s) => Number(s.session_no) === toNo)) bad('That session is not on this plan');
  const gross = sessions.reduce((sum, s) => sum + Number(s.fee || 0), 0);
  const shares = sessions.map((s) => (gross > 0 ? (Number(s.fee || 0) * invoice.total) / gross : invoice.total / sessions.length));
  const rounded = shares.map(money);
  if (rounded.length) {
    const drift = money(invoice.total - rounded.reduce((sum, n) => sum + n, 0));
    rounded[rounded.length - 1] = money(rounded[rounded.length - 1] + drift);
  }
  const fromIndex = sessions.findIndex((s) => Number(s.session_no) === fromNo);
  const share = rounded[fromIndex] || 0;
  const payments = rows(db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY id', invoice.id);
  const mine = payments.filter((p) => sessionNoFromRef(p.reference) === fromNo);
  const tagged = money(mine.reduce((sum, p) => sum + p.amount, 0));
  const extra = money(Math.max(tagged - share, 0));
  if (amount > extra + 0.001) bad(`Session ${fromNo} only has ₹${extra} extra to move (₹${tagged} recorded, ₹${share} is this session)`);
  tx(db, () => {
    let left = amount;
    for (const payment of mine.slice().reverse()) {
      if (left <= 0.001) break;
      const take = money(Math.min(payment.amount, left));
      if (take + 0.001 >= payment.amount) update(db, 'payments', payment.id, { reference: `Session ${toNo}` });
      else {
        update(db, 'payments', payment.id, { amount: money(payment.amount - take) });
        insert(db, 'payments', { invoice_id: invoice.id, amount: take, mode: payment.mode, reference: `Session ${toNo}`, at: stamp(), by: user.user });
      }
      left = money(left - take);
    }
    audit(db, user.user, `adjust:session ${fromNo}->${toNo}:${amount}`, 'invoice', invoice.number);
  });
  return getInvoice({ db, params });
}

export function addPayment({ db, body, params, user, cfg, sid }) {
  const invoice = mustGet(db, 'invoices', params.id, 'Invoice');
  if (invoice.status === 'Cancelled') bad('This invoice is cancelled');
  const due = money(invoice.total - invoice.paid);
  const amount = money(body.amount);
  if (amount <= 0) bad('Enter the amount received');
  if (amount > due + 0.001) bad(`Only ₹${due} is due on this invoice`);
  const mode = oneOf(body.mode || 'Cash', PAY_MODES, 'Payment mode');
  tx(db, () => {
    insert(db, 'payments', { invoice_id: invoice.id, amount, mode, reference: opt(body.reference, 80), at: stamp(), by: user.user });
    const paid = money(invoice.paid + amount);
    update(db, 'invoices', invoice.id, { paid, status: invoiceStatus(invoice.total, paid), payment_mode: mode });
    audit(db, user.user, `payment:${amount}`, 'invoice', invoice.number);
  });
  pushCrmSalesClose(cfg, sid, db, invoice.id);
  return getInvoice({ db, params });
}

export function cancelInvoice({ db, body, params, user }) {
  const invoice = mustGet(db, 'invoices', params.id, 'Invoice');
  if (invoice.status === 'Cancelled') bad('This invoice is already cancelled');
  if (invoice.trf_id) bad(`This bill belongs to lab booking ${invoice.trf_id}; lab bookings are cancelled or refunded by Remedium Labs`);
  tx(db, () => {
    for (const it of parse(invoice.items, [])) {
      if (!it.item_id) continue;
      run(db, 'UPDATE items SET stock = stock + ? WHERE id = ?', it.qty, it.item_id);
      insert(db, 'stock_moves', { item_id: it.item_id, qty: it.qty, kind: 'Return', ref: invoice.number, note: 'Invoice cancelled', at: stamp(), by: user.user });
    }
    const reason = opt(body.reason, 300);
    update(db, 'invoices', invoice.id, { status: 'Cancelled', notes: [invoice.notes, reason && `Cancelled: ${reason}`].filter(Boolean).join('\n') || null });
    run(db, 'UPDATE appointments SET invoice_id = NULL WHERE invoice_id = ?', invoice.id);
    audit(db, user.user, 'cancel', 'invoice', invoice.number);
  });
  return getInvoice({ db, params });
}

/* ---------------------------------------------------------------- inventory */

export function listItems({ db, q }) {
  const b = branchWhere(q);
  let where = `WHERE active = 1${b.sql}`;
  const args = [...b.args];
  if (q.category) {
    const cats = String(q.category).split(',').filter((c) => ITEM_CATEGORIES.includes(c));
    if (cats.length) {
      where += ` AND category IN (${cats.map(() => '?').join(',')})`;
      args.push(...cats);
    }
  }
  if (q.filter === 'low') where += ' AND (stock <= 0 OR (reorder_level > 0 AND stock <= reorder_level))';
  if (q.filter === 'expiry') {
    where += ' AND expiry IS NOT NULL AND expiry <= ?';
    args.push(addDays(todayStr(), 60));
  }
  const term = str(q.q, 80);
  if (term) {
    where += ' AND (name LIKE ? OR sku LIKE ? OR vendor LIKE ?)';
    args.push(like(term), like(term), like(term));
  }
  const items = rows(db, `SELECT * FROM items ${where} ORDER BY name`, ...args);
  const value = items.reduce((s, it) => s + Math.max(it.stock, 0) * it.cost, 0);
  return { items, value, alerts: stockAlerts(db, q) };
}

function itemFields(body) {
  const reorder = num(body.reorder_level);
  if (reorder < 0) bad('Reorder level cannot be negative');
  return {
    name: required(str(body.name, 160), 'Item name'),
    category: oneOf(body.category || 'Consumable', ITEM_CATEGORIES, 'Category'),
    unit: str(body.unit, 30) || 'piece',
    reorder_level: reorder,
    cost: money(body.cost),
    price: money(body.price),
    expiry: isDate(body.expiry) ? body.expiry : null,
    vendor: opt(body.vendor, 120),
  };
}

const MEDICINE_IN =
  'Medicines come in only through Pharmacy: a requisition to the Operations central store, or an outside purchase approved by the Operations Manager.';

export function createItem({ db, body, user }) {
  const fields = itemFields(body);
  const opening = num(body.stock);
  if (opening < 0) bad('Opening stock cannot be negative');
  if (opening > 0 && fields.category === 'Medicine') bad(MEDICINE_IN);
  return tx(db, () => {
    const sku = str(body.sku, 40) || `RC-${String(nextSeq(db, 'item')).padStart(4, '0')}`;
    const id = insert(db, 'items', { ...fields, sku, stock: opening, branch_id: defaultBranch(db, body.branch_id), active: 1, created_at: stamp() });
    if (opening) insert(db, 'stock_moves', { item_id: id, qty: opening, kind: 'Opening', note: 'Opening stock', at: stamp(), by: user.user });
    audit(db, user.user, 'create', 'item', fields.name);
    return row(db, 'SELECT * FROM items WHERE id = ?', id);
  });
}

export function updateItem({ db, body, params, user }) {
  const current = mustGet(db, 'items', params.id, 'Item');
  if (body.active === false) {
    update(db, 'items', current.id, { active: 0 });
    audit(db, user.user, 'archive', 'item', current.name);
    return row(db, 'SELECT * FROM items WHERE id = ?', current.id);
  }
  update(db, 'items', current.id, { ...itemFields({ ...current, ...body }), sku: body.sku !== undefined ? str(body.sku, 40) || current.sku : undefined });
  audit(db, user.user, 'update', 'item', current.name);
  return row(db, 'SELECT * FROM items WHERE id = ?', current.id);
}

export function moveStock({ db, body, params, user }) {
  const item = mustGet(db, 'items', params.id, 'Item');
  const qty = num(body.qty);
  if (qty <= 0) bad('Quantity must be more than zero');
  const direction = oneOf(body.direction, ['in', 'out'], 'Direction');
  const kind = oneOf(body.kind || (direction === 'in' ? 'Purchase' : 'Consumption'), ['Purchase', 'Return', 'Adjustment', 'Consumption', 'Damaged / Expired', 'Transfer'], 'Movement type');
  if (direction === 'in' && item.category === 'Medicine') bad(MEDICINE_IN);
  const signed = direction === 'in' ? qty : -qty;
  if (item.stock + signed < 0) bad(`Only ${item.stock} ${item.unit} in stock`);
  tx(db, () => {
    run(db, 'UPDATE items SET stock = stock + ? WHERE id = ?', signed, item.id);
    if (body.cost !== undefined && direction === 'in' && money(body.cost) > 0) run(db, 'UPDATE items SET cost = ? WHERE id = ?', money(body.cost), item.id);
    if (isDate(body.expiry)) run(db, 'UPDATE items SET expiry = ? WHERE id = ?', body.expiry, item.id);
    insert(db, 'stock_moves', { item_id: item.id, qty: signed, kind, ref: opt(body.ref, 80), note: opt(body.note, 300), at: stamp(), by: user.user });
    audit(db, user.user, `stock:${signed}`, 'item', item.name);
  });
  return row(db, 'SELECT * FROM items WHERE id = ?', item.id);
}

export function itemMoves({ db, params }) {
  const item = mustGet(db, 'items', params.id, 'Item');
  return { item, moves: rows(db, 'SELECT * FROM stock_moves WHERE item_id = ? ORDER BY at DESC, id DESC LIMIT 100', item.id) };
}

/* ---------------------------------------------------------------- branches */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function branchFields(body) {
  const gstRegistered = body.gst_registered === true || body.gst_registered === 1 || body.gst_registered === '1' ? 1 : 0;
  const gstin = str(body.gstin, 15).toUpperCase().replace(/\s/g, '') || null;
  if (gstRegistered && !gstin) bad('Enter the GSTIN for a GST-registered branch');
  if (gstin && !GSTIN_RE.test(gstin)) bad('GSTIN must be 15 characters, e.g. 19ABCDE1234F1Z5');
  const stateCode = opt(body.state_code, 2) || (gstin ? gstin.slice(0, 2) : null);
  if (gstin && stateCode && stateCode !== gstin.slice(0, 2)) bad(`State code ${stateCode} does not match the GSTIN (${gstin.slice(0, 2)})`);
  return {
    name: required(str(body.name, 120), 'Branch name'),
    code: opt(body.code, 12),
    city: opt(body.city, 80),
    address: opt(body.address, 300),
    phone: opt(body.phone, 20),
    email: opt(body.email, 120),
    manager: opt(body.manager, 120),
    gst_registered: gstRegistered,
    gstin,
    state: opt(body.state, 60),
    state_code: stateCode,
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}

export function listBranches({ db, q }) {
  const today = todayStr();
  const from = addDays(today, -29);
  const id = int(q && q.branch);
  const where = id ? ' WHERE b.id = ?' : '';
  return rows(
    db,
    `SELECT b.*,
            (SELECT COUNT(*) FROM patients p WHERE p.branch_id = b.id) AS patients,
            (SELECT COUNT(*) FROM appointments a WHERE a.branch_id = b.id AND a.date = ? AND a.status NOT IN ('Cancelled','No Show')) AS today,
            (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.branch_id = b.id AND i.status != 'Cancelled' AND i.created_at >= ?) AS revenue30,
            (SELECT COUNT(*) FROM practitioners s WHERE s.branch_id = b.id AND s.active = 1) AS staff,
            (SELECT COUNT(*) FROM assets x WHERE x.branch_id = b.id AND x.status != 'Retired') AS assets
       FROM branches b${where} ORDER BY b.active DESC, b.name`,
    today, from, ...(id ? [id] : []),
  );
}

export function createBranch({ db, body, user }) {
  const fields = branchFields(body);
  const id = insert(db, 'branches', { ...fields, created_at: stamp() });
  audit(db, user.user, 'create', 'branch', fields.name);
  return row(db, 'SELECT * FROM branches WHERE id = ?', id);
}

export function updateBranch({ db, body, params, user }) {
  const current = mustGet(db, 'branches', params.id, 'Branch');
  const fields = branchFields({ ...current, ...body });
  if (!fields.active && row(db, 'SELECT COUNT(*) AS n FROM branches WHERE active = 1 AND id != ?', current.id).n === 0) bad('At least one branch must stay active');
  update(db, 'branches', current.id, fields);
  audit(db, user.user, 'update', 'branch', fields.name);
  return row(db, 'SELECT * FROM branches WHERE id = ?', current.id);
}

/* ---------------------------------------------------------------- practitioners & services */

function practitionerFields(body) {
  return {
    name: required(str(body.name, 120), 'Name'),
    role: oneOf(body.role || 'Doctor', ROLES, 'Role'),
    specialty: opt(body.specialty, 120),
    phone: opt(body.phone, 20),
    email: opt(body.email, 120),
    fee: money(body.fee),
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}

export function listPractitioners({ db, q }) {
  const from = addDays(todayStr(), -29);
  const b = branchWhere(q, 's.branch_id');
  return rows(
    db,
    `SELECT s.*, b.name AS branch,
            (SELECT COUNT(*) FROM appointments a WHERE a.practitioner_id = s.id AND a.status IN ('Completed','Reported') AND a.date >= ?) AS completed30
       FROM practitioners s LEFT JOIN branches b ON b.id = s.branch_id WHERE 1=1${b.sql} ORDER BY s.active DESC, s.role, s.name`,
    from, ...b.args,
  );
}

export function createPractitioner({ db, body, user }) {
  const fields = practitionerFields(body);
  const id = insert(db, 'practitioners', { ...fields, branch_id: defaultBranch(db, body.branch_id) });
  audit(db, user.user, 'create', 'practitioner', fields.name);
  return row(db, 'SELECT * FROM practitioners WHERE id = ?', id);
}

export function updatePractitioner({ db, body, params, user }) {
  const current = mustGet(db, 'practitioners', params.id, 'Staff member');
  update(db, 'practitioners', current.id, { ...practitionerFields({ ...current, ...body }), branch_id: body.branch_id ? defaultBranch(db, body.branch_id) : undefined });
  audit(db, user.user, 'update', 'practitioner', current.name);
  return row(db, 'SELECT * FROM practitioners WHERE id = ?', current.id);
}

/* ---------------------------------------------------------------- doctors */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* availability JSON: { weekly: { "1": { from, to } … (0 = Sunday) }, extra: [{ date, from, to }], leave: ["YYYY-MM-DD"] } */
function cleanAvailability(raw) {
  const src = typeof raw === 'string' ? parse(raw, {}) : raw || {};
  const slot = (s, label) => {
    const from = isTime(s?.from) ? s.from : null;
    const to = isTime(s?.to) ? s.to : null;
    if (!from || !to) bad(`Set both start and end time for ${label}`);
    if (from >= to) bad(`End time must be after start time for ${label}`);
    return { from, to };
  };
  const weekly = {};
  for (const [day, s] of Object.entries(src.weekly || {})) {
    const d = int(day, -1);
    if (d < 0 || d > 6 || !s) continue;
    weekly[d] = slot(s, DAY_NAMES[d]);
  }
  const extra = (Array.isArray(src.extra) ? src.extra : [])
    .filter((e) => e && isDate(e.date))
    .map((e) => ({ date: e.date, ...slot(e, e.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const leave = [...new Set((Array.isArray(src.leave) ? src.leave : []).filter(isDate))].sort();
  return { weekly, extra, leave };
}

function hasSchedule(av) {
  return Boolean(av && (Object.keys(av.weekly || {}).length || (av.extra || []).length));
}

/* { ok, reason, from, to } for a doctor on a date (and optional HH:MM time). */
export function doctorAvailability(doctor, date, time) {
  const av = parse(doctor.availability || 'null', null);
  if (!hasSchedule(av)) return { ok: true, reason: 'No schedule set' };
  if ((av.leave || []).includes(date)) return { ok: false, reason: 'on leave' };
  const slots = [...(av.extra || []).filter((e) => e.date === date), ...(av.weekly?.[weekday(date)] ? [av.weekly[weekday(date)]] : [])];
  if (!slots.length) return { ok: false, reason: `not available on ${DAY_NAMES[weekday(date)]}s` };
  if (time && !slots.some((s) => time >= s.from && time < s.to)) {
    return { ok: false, reason: `available ${slots.map((s) => `${s.from}–${s.to}`).join(', ')} only`, from: slots[0].from, to: slots[0].to };
  }
  return { ok: true, from: slots[0].from, to: slots[0].to };
}

function clinicianRole(body, fallback = 'Doctor') {
  const wanted = str(body.role || fallback, 40) || fallback;
  if (CLINICIAN_ROLES.includes(wanted)) return wanted;
  return 'Doctor';
}

function doctorFields(body) {
  return {
    ...practitionerFields({ ...body, role: clinicianRole(body) }),
    qualification: opt(body.qualification, 160),
    registration_no: opt(body.registration_no, 60),
    slot_minutes: body.slot_minutes === '' || body.slot_minutes == null ? null : Math.min(Math.max(int(body.slot_minutes), 5), 240),
    availability: JSON.stringify(cleanAvailability(body.availability)),
  };
}

export function listDoctors({ db, q }) {
  const today = todayStr();
  /* Voucher doctor payments: doctors often sit at several centres; list every active doctor and
     prefer the selected payment branch in sort order (do not hide others). */
  const forPayment = q.for_payment === '1' || q.for_payment === 'true' || q.voucher === '1';
  const prefer = forPayment ? int(q.prefer_branch || q.branch) : 0;
  const b = forPayment ? { sql: '', args: [] } : branchWhere(q, 's.branch_id');
  /* CRM / Care booking may ask for Physiotherapist; default stays doctor (+ cosmetologist on Aesthetic). */
  const wanted = String(q.role || '').trim();
  const roleList =
    wanted === 'Physiotherapist'
      ? ['Physiotherapist']
      : wanted && CLINICIAN_ROLES.includes(wanted)
        ? [wanted]
        : forPayment
          ? ['Doctor']
          : CLINICIAN_ROLES;
  const roles = roleList.map(() => '?').join(',');
  const order = forPayment && prefer
    ? `CASE WHEN s.branch_id = ${prefer} THEN 0 ELSE 1 END, s.active DESC, s.name`
    : 's.active DESC, s.role, s.name';
  const list = rows(
    db,
    `SELECT s.*, br.name AS branch,
            (SELECT COUNT(*) FROM appointments a WHERE a.practitioner_id = s.id AND a.date = ? AND a.status NOT IN ('Cancelled','No Show')) AS today,
            (SELECT COUNT(*) FROM appointments a WHERE a.practitioner_id = s.id AND a.date > ? AND a.status = 'Scheduled') AS upcoming,
            (SELECT COUNT(*) FROM appointments a WHERE a.practitioner_id = s.id AND a.status = 'Completed' AND a.date >= ?) AS completed30
       FROM practitioners s LEFT JOIN branches br ON br.id = s.branch_id
      WHERE s.role IN (${roles})${q.active === 'all' ? '' : ' AND s.active = 1'}${b.sql}
      ORDER BY ${order}`,
    today, today, addDays(today, -29), ...roleList, ...b.args,
  );
  return list.map((d) => {
    const days = [];
    for (let i = 0; i < 14; i += 1) {
      const date = addDays(today, i);
      const a = doctorAvailability(d, date);
      days.push({ date, ok: a.ok, reason: a.reason || null, from: a.from || null, to: a.to || null });
    }
    return { ...d, availability: parse(d.availability || 'null', null), next14: days, scheduled: hasSchedule(parse(d.availability || 'null', null)) };
  });
}

export function createDoctor({ db, body, user }) {
  const fields = doctorFields(body);
  const id = insert(db, 'practitioners', { ...fields, branch_id: defaultBranch(db, body.branch_id) });
  audit(db, user.user, 'create', fields.role === 'Cosmetologist' ? 'cosmetologist' : 'doctor', fields.name);
  return row(db, 'SELECT * FROM practitioners WHERE id = ?', id);
}

export function updateDoctor({ db, body, params, user }) {
  const current = mustGet(db, 'practitioners', params.id, 'Doctor');
  if (!CLINICIAN_ROLES.includes(current.role)) bad('This staff member is not a doctor or cosmetologist');
  const merged = { ...current, availability: parse(current.availability || 'null', null), ...body, role: body.role || current.role };
  update(db, 'practitioners', current.id, { ...doctorFields(merged), branch_id: body.branch_id ? defaultBranch(db, body.branch_id) : undefined });
  audit(db, user.user, 'update', current.role === 'Cosmetologist' ? 'cosmetologist' : 'doctor', current.name);
  return row(db, 'SELECT * FROM practitioners WHERE id = ?', current.id);
}

export function checkDoctor({ db, q }) {
  const doctor = mustGet(db, 'practitioners', q.id, 'Doctor');
  if (!CLINICIAN_ROLES.includes(doctor.role)) bad('This staff member is not a doctor or cosmetologist');
  const date = isDate(q.date) ? q.date : todayStr();
  return { doctor: doctor.name, date, ...doctorAvailability(doctor, date, isTime(q.time) ? q.time : undefined) };
}

function serviceFields(body) {
  const price = money(body.price);
  if (price < 0) bad('Price cannot be negative');
  return {
    category: oneOf(body.category, TYPES, 'Category'),
    name: required(str(body.name, 160), 'Service name'),
    price,
    duration: Math.max(int(body.duration, 30), 0),
    active: body.active === false || body.active === 0 ? 0 : 1,
    mrp: body.mrp === '' || body.mrp == null ? null : money(body.mrp),
    description: opt(body.description, 500),
  };
}

export function createService({ db, body, user }) {
  const fields = serviceFields(body);
  if (fields.category === 'diagnostic') bad('Add diagnostic tests from Diagnostics → Diagnostic Test Master so they are created in the ERP');
  const id = insert(db, 'services', { ...fields, source: 'local' });
  audit(db, user.user, 'create', 'service', fields.name);
  return row(db, 'SELECT * FROM services WHERE id = ?', id);
}

export function updateService({ db, body, params, user }) {
  const current = mustGet(db, 'services', params.id, 'Service');
  if (current.category === 'diagnostic' || body.category === 'diagnostic') bad('Edit diagnostic tests from Diagnostics → Diagnostic Test Master so the ERP stays the master');
  const fields = serviceFields({ ...current, ...body });
  if (current.source === 'erp') {
    // Name and category belong to the ERP master; a changed price is kept through later syncs.
    fields.name = current.name;
    fields.category = current.category;
    if (body.price_override !== undefined) fields.price_override = body.price_override ? 1 : 0;
    else if (fields.price !== current.price) fields.price_override = 1;
  }
  update(db, 'services', current.id, fields);
  audit(db, user.user, 'update', 'service', current.name);
  return row(db, 'SELECT * FROM services WHERE id = ?', current.id);
}

export function listServices({ db, q }) {
  let where = 'WHERE 1=1';
  const args = [];
  if (q.category) {
    where += ' AND category = ?';
    args.push(oneOf(q.category, TYPES, 'Category'));
  }
  if (q.source === 'erp' || q.source === 'local') {
    where += ' AND source = ?';
    args.push(q.source);
  }
  if (q.group) {
    where += ' AND lab_group = ?';
    args.push(str(q.group, 80));
  }
  if (q.active !== 'all') where += ' AND active = 1';
  const term = str(q.q, 80);
  if (q.modality) {
    where += ' AND modality = ?';
    args.push(str(q.modality, 60));
  }
  if (term) {
    where += ' AND (name LIKE ? OR code LIKE ? OR lab_group LIKE ? OR modality LIKE ? OR body_part LIKE ?)';
    args.push(like(term), like(term), like(term), like(term), like(term));
  }
  const { limit, offset } = page(q, 500, 50);
  const total = row(db, `SELECT COUNT(*) AS n FROM services ${where}`, ...args).n;
  const order = term
    ? "CASE WHEN lower(name) LIKE lower(?) THEN 0 ELSE 1 END, source = 'erp', lab_group, name"
    : "source = 'erp', lab_group, name";
  const items = rows(db, `SELECT * FROM services ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, ...(term ? [`${term.replace(/[%_]/g, '')}%`] : []), limit, offset);
  const scope = q.category ? ' AND category = ?' : '';
  const scopeArgs = q.category ? [q.category] : [];
  const groups = rows(db, `SELECT lab_group AS name, COUNT(*) AS n FROM services WHERE lab_group IS NOT NULL AND lab_group != '' AND active = 1${scope} GROUP BY lab_group ORDER BY n DESC`, ...scopeArgs);
  const modalities = rows(db, `SELECT modality AS name, COUNT(*) AS n FROM services WHERE modality IS NOT NULL AND modality != '' AND active = 1${scope} GROUP BY modality ORDER BY n DESC`, ...scopeArgs);
  const key = q.category === 'lab' || !q.category ? 'lab_catalog' : 'care_catalog';
  const settings = getSettings(db);
  return {
    total,
    items,
    groups,
    modalities,
    sync: {
      at: settings[`${key}_synced_at`] || null,
      by: settings[`${key}_synced_by`] || null,
      result: parse(settings[`${key}_sync_result`] || 'null', null),
    },
  };
}

/* Upsert ERP master rows into the clinic price list, matched on the ERP item code. A clinic service of the same
   category and name is linked rather than duplicated. Prices follow the ERP rate unless staff set a custom price;
   rows withdrawn from the ERP (within the synced categories) are hidden, never deleted. */
function upsertErpServices(db, rowsIn, { categories, key, label, by }) {
  const clean = rowsIn.filter((it) => it.code && it.name && categories.includes(it.category));
  if (!clean.length) bad(`The ERP returned no ${label}, nothing was changed`);
  const now = stamp();
  const result = { received: clean.length, added: 0, updated: 0, linked: 0, unchanged: 0, hidden: 0 };
  tx(db, () => {
    const seen = new Set();
    for (const it of clean) {
      if (seen.has(it.code)) continue;
      seen.add(it.code);
      let current = row(db, 'SELECT * FROM services WHERE code = ?', it.code);
      let linked = false;
      if (!current) {
        current = row(db, 'SELECT * FROM services WHERE category = ? AND code IS NULL AND lower(name) = lower(?) LIMIT 1', it.category, it.name);
        if (current) {
          update(db, 'services', current.id, { code: it.code, source: 'erp', price_override: 0 });
          current = { ...current, code: it.code, source: 'erp', price_override: 0 };
          linked = true;
        }
      }
      const { code, price, category, ...fields } = it;
      if (!current) {
        /* Aesthetic: new catalogue rows stay Hidden until the clinic marks them Available for booking. */
        insert(db, 'services', {
          duration: 0,
          ...fields,
          code,
          category,
          price,
          active: AESTHETIC ? 0 : 1,
          source: 'erp',
          price_override: 0,
          synced_at: now,
        });
        result.added += 1;
        continue;
      }
      /* Do not flip clinic availability on sync — staff control Available / Hidden in Treatment Master. */
      const next = { ...fields, category, active: current.active };
      if (!current.price_override) next.price = price;
      const changed = Object.keys(next).some((k) => (current[k] ?? null) !== (next[k] ?? null));
      update(db, 'services', current.id, { ...next, synced_at: now });
      if (linked) result.linked += 1;
      else if (changed) result.updated += 1;
      else result.unchanged += 1;
    }
    const stale = rows(db, `SELECT id, code FROM services WHERE source = 'erp' AND active = 1 AND category IN (${categories.map(() => '?').join(',')})`, ...categories).filter((s) => !seen.has(s.code));
    for (const s of stale) update(db, 'services', s.id, { active: 0, synced_at: now });
    result.hidden = stale.length;
    for (const [k, value] of [[`${key}_synced_at`, now], [`${key}_synced_by`, by], [`${key}_sync_result`, JSON.stringify(result)]]) {
      run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, value);
    }
    audit(db, by, `import ${label} from ERP`, 'services', `${result.added} added, ${result.updated} updated, ${result.hidden} hidden`);
  });
  return result;
}

/* The main ERP's published lab test master. */
export function applyLabCatalog(db, items, by) {
  const mapped = items.map((it) => ({
    category: 'lab',
    code: str(it.name, 140),
    name: str(it.item_name || it.name, 160),
    price: money(it.rate ?? it.standard_rate),
    mrp: it.mrp == null ? null : money(it.mrp),
    sample_type: opt(it.sample_type, 60),
    tat_hours: it.report_tat_hours == null ? null : int(it.report_tat_hours),
    lab_group: opt(it.lab_category, 80),
    preparation: opt(it.preparation, 500),
  }));
  return upsertErpServices(db, mapped, { categories: ['lab'], key: 'lab_catalog', label: 'lab tests', by });
}

function diagnosticRow(d) {
  return {
    category: 'diagnostic',
    code: str(d.code, 140),
    name: str(d.test_name, 160),
    price: money(d.rate),
    mrp: d.mrp == null ? null : money(d.mrp),
    tat_hours: d.tat_hours == null ? null : int(d.tat_hours),
    duration: int(d.duration_min),
    lab_group: opt(d.department, 80),
    modality: opt(d.modality, 60),
    body_part: opt(d.body_part, 140),
    preparation: opt(d.preparation, 1000),
    needs_report: d.needs_reporting_doctor ? 1 : 0,
    active: d.disabled ? 0 : 1,
  };
}

/* Diagnostic test master, physiotherapy and consultation items from clinical_care_catalog. */
export function applyCareCatalog(db, data, by) {
  const mapped = [
    ...data.diagnostics.map(diagnosticRow),
    ...(data.physiotherapy || []).map((it) => ({ category: 'physiotherapy', code: str(it.code, 140), name: str(it.name, 160), price: money(it.rate), lab_group: opt(it.group, 80) })),
    ...(data.consultation || []).map((it) => ({ category: 'consultation', code: str(it.code, 140), name: str(it.name, 160), price: money(it.rate), lab_group: opt(it.group, 80) })),
  ];
  return upsertErpServices(db, mapped, { categories: ['diagnostic', 'physiotherapy', 'consultation'], key: 'care_catalog', label: 'care services', by });
}

/* Aesthetic instance: treatments are kept in the physiotherapy category the plan engine uses. */
export function applyAestheticCatalog(db, services, by) {
  const mapped = services.map((s) => ({
    category: 'physiotherapy',
    code: str(s.service_code, 140),
    name: str(s.service_name, 160),
    price: money(s.rate),
    duration: int(String(s.duration || '').match(/\d+/)?.[0]),
    lab_group: opt(s.department_name || s.item_group, 80),
    description: opt(s.short_description, 500),
  }));
  return upsertErpServices(db, mapped, { categories: ['physiotherapy'], key: 'aesthetic_catalog', label: 'aesthetic treatments', by });
}

export async function importAestheticCatalog({ db, cfg, user }) {
  let services;
  try {
    services = await fetchAestheticCatalog(cfg);
  } catch (err) {
    throw new HttpError(502, `Could not load the aesthetic service catalogue: ${err.message}`);
  }
  return applyAestheticCatalog(db, services, user.user);
}

export async function importLabTests({ db, cfg, user }) {
  let items;
  try {
    items = await fetchLabCatalog(cfg);
  } catch (err) {
    throw new HttpError(502, `Could not load the test master from the ERP: ${err.message}`);
  }
  return applyLabCatalog(db, items, user.user);
}

export async function importCareCatalog({ db, cfg, user }) {
  let data;
  try {
    data = await fetchCareCatalog(cfg);
  } catch (err) {
    throw new HttpError(502, `Could not load the care catalogue from the ERP: ${err.message}`);
  }
  return applyCareCatalog(db, data, user.user);
}

/* Create or edit a diagnostic test in the ERP master, then mirror it into the local price list. */
export async function saveDiagnostic({ db, cfg, body, user, sid }) {
  const test = {
    code: opt(body.code, 140),
    test_name: required(str(body.test_name, 140), 'Test name'),
    modality: required(str(body.modality, 60), 'Modality'),
    department: opt(body.department, 80),
    body_part: opt(body.body_part, 140),
    rate: money(body.rate),
    mrp: body.mrp === '' || body.mrp == null ? null : money(body.mrp),
    tat_hours: body.tat_hours === '' || body.tat_hours == null ? null : int(body.tat_hours),
    duration_min: body.duration_min === '' || body.duration_min == null ? null : int(body.duration_min),
    needs_reporting_doctor: body.needs_reporting_doctor === false ? 0 : 1,
    preparation: opt(body.preparation, 1000),
    description: opt(body.description, 1000),
    disabled: body.disabled ? 1 : 0,
  };
  if (test.rate < 0) bad('Rate cannot be negative');
  if (!sid) throw new HttpError(401, 'Sign in again to change the ERP test master');
  let saved;
  try {
    saved = await saveDiagnosticTest(cfg, sid, test);
  } catch (err) {
    throw new HttpError(err.status || 502, `ERP: ${err.message}`);
  }
  const it = diagnosticRow(saved);
  const now = stamp();
  tx(db, () => {
    const current = row(db, 'SELECT id FROM services WHERE code = ?', it.code);
    const { code, ...fields } = it;
    if (current) update(db, 'services', current.id, { ...fields, source: 'erp', price_override: 0, synced_at: now });
    else insert(db, 'services', { ...fields, code, source: 'erp', price_override: 0, synced_at: now });
    audit(db, user.user, test.code ? 'update diagnostic test in ERP' : 'create diagnostic test in ERP', 'services', code);
  });
  return row(db, 'SELECT * FROM services WHERE code = ?', it.code);
}

/* ---------------------------------------------------------------- assets */

function assetFields(body) {
  return {
    name: required(str(body.name, 160), 'Asset name'),
    category: opt(body.category, 80),
    status: oneOf(body.status || 'Working', ASSET_STATUSES, 'Status'),
    purchase_date: isDate(body.purchase_date) ? body.purchase_date : null,
    cost: body.cost === '' || body.cost == null ? null : money(body.cost),
    vendor: opt(body.vendor, 120),
    last_service: isDate(body.last_service) ? body.last_service : null,
    next_service: isDate(body.next_service) ? body.next_service : null,
    notes: opt(body.notes, 1000),
    model: opt(body.model, 160),
    serial: opt(body.serial, 80),
    description: opt(body.description, 300),
    photo: opt(body.photo, 500),
    amc_vendor: opt(body.amc_vendor, 160),
    amc_ref: opt(body.amc_ref, 80),
    amc_start: isDate(body.amc_start) ? body.amc_start : null,
    amc_end: isDate(body.amc_end) ? body.amc_end : null,
    amc_cost: body.amc_cost === '' || body.amc_cost == null ? null : money(body.amc_cost),
  };
}

export function listAssets({ db, q }) {
  const b = branchWhere(q, 'x.branch_id');
  let where = `WHERE 1=1${b.sql}`;
  const args = [...b.args];
  if (q.filter === 'due') {
    where += " AND x.status != 'Retired' AND x.next_service IS NOT NULL AND x.next_service <= ?";
    args.push(addDays(todayStr(), 7));
  }
  if (q.status) {
    where += ' AND x.status = ?';
    args.push(oneOf(q.status, ASSET_STATUSES, 'Status'));
  }
  const term = str(q.q, 80);
  if (q.category) {
    where += ' AND x.category = ?';
    args.push(str(q.category, 80));
  }
  if (term) {
    where += ' AND (x.name LIKE ? OR x.tag LIKE ? OR x.category LIKE ? OR IFNULL(x.model,\'\') LIKE ? OR IFNULL(x.serial,\'\') LIKE ? OR IFNULL(x.vendor,\'\') LIKE ?)';
    args.push(like(term), like(term), like(term), like(term), like(term), like(term));
  }
  const items = rows(db, `SELECT x.*, b.name AS branch FROM assets x LEFT JOIN branches b ON b.id = x.branch_id ${where} ORDER BY x.status = 'Retired', x.next_service IS NULL, x.next_service, x.name`, ...args);
  const dueBy = addDays(todayStr(), 30);
  return {
    items,
    categories: rows(db, 'SELECT DISTINCT category AS name FROM assets WHERE category IS NOT NULL AND category != \'\' ORDER BY category').map((r) => r.name),
    summary: {
      total: items.filter((a) => a.status !== 'Retired').length,
      operational: items.filter((a) => a.status === 'Working').length,
      under_service: items.filter((a) => a.status === 'Under Maintenance').length,
      not_operational: items.filter((a) => a.status === 'Out of Order').length,
      due_30: items.filter((a) => a.status !== 'Retired' && a.next_service && a.next_service <= dueBy).length,
    },
  };
}

export function createAsset({ db, body, user }) {
  const fields = assetFields(body);
  return tx(db, () => {
    const tag = str(body.tag, 40) || `${AESTHETIC ? 'RA-MCH' : 'RC-AST'}-${String(nextSeq(db, 'asset')).padStart(3, '0')}`;
    const id = insert(db, 'assets', { ...fields, tag, branch_id: defaultBranch(db, body.branch_id), created_at: stamp() });
    insert(db, 'asset_logs', { asset_id: id, at: stamp(), kind: 'Added', note: fields.status, by: user.user });
    audit(db, user.user, 'create', 'asset', tag);
    return row(db, 'SELECT * FROM assets WHERE id = ?', id);
  });
}

export function updateAsset({ db, body, params, user }) {
  const current = mustGet(db, 'assets', params.id, 'Asset');
  const fields = assetFields({ ...current, ...body });
  tx(db, () => {
    update(db, 'assets', current.id, { ...fields, branch_id: body.branch_id ? defaultBranch(db, body.branch_id) : undefined });
    if (fields.status !== current.status) insert(db, 'asset_logs', { asset_id: current.id, at: stamp(), kind: 'Status', note: `${current.status} → ${fields.status}`, by: user.user });
    audit(db, user.user, 'update', 'asset', current.tag);
  });
  return row(db, 'SELECT * FROM assets WHERE id = ?', current.id);
}

export function serviceAsset({ db, body, params, user }) {
  const current = mustGet(db, 'assets', params.id, 'Asset');
  const date = isDate(body.date) ? body.date : todayStr();
  const next = isDate(body.next_service) ? body.next_service : null;
  if (next && next <= date) bad('Next service date must be after the service date');
  tx(db, () => {
    update(db, 'assets', current.id, { last_service: date, next_service: next, status: body.status ? oneOf(body.status, ASSET_STATUSES, 'Status') : 'Working' });
    insert(db, 'asset_logs', { asset_id: current.id, at: `${date} ${stamp().slice(11)}`, kind: 'Service', note: opt(body.note, 500) || 'Serviced', by: user.user });
    audit(db, user.user, 'service', 'asset', current.tag);
  });
  return row(db, 'SELECT * FROM assets WHERE id = ?', current.id);
}

export function assetLogs({ db, params }) {
  const asset = mustGet(db, 'assets', params.id, 'Asset');
  const named = row(db, 'SELECT x.*, b.name AS branch FROM assets x LEFT JOIN branches b ON b.id = x.branch_id WHERE x.id = ?', asset.id);
  return { asset: named || asset, logs: rows(db, 'SELECT * FROM asset_logs WHERE asset_id = ? ORDER BY at DESC, id DESC', asset.id) };
}

/* ---------------------------------------------------------------- reports */

export function reports({ db, q }) {
  const to = isDate(q.to) ? q.to : todayStr();
  const from = isDate(q.from) ? q.from : addDays(to, -29);
  if (from > to) bad('From date must be before To date');
  const end = addDays(to, 1);
  const b = branchWhere(q, 'i.branch_id');
  const ba = branchWhere(q, 'a.branch_id');
  const invWhere = `i.status != 'Cancelled' AND i.created_at >= ? AND i.created_at < ?${b.sql}`;
  const invArgs = [from, end, ...b.args];

  const summary = row(db, `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total),0) AS billed, COALESCE(SUM(i.discount),0) AS discount FROM invoices i WHERE ${invWhere}`, ...invArgs);
  const collected = row(db, `SELECT COALESCE(SUM(pm.amount),0) AS n FROM payments pm JOIN invoices i ON i.id = pm.invoice_id WHERE i.status != 'Cancelled' AND pm.at >= ? AND pm.at < ?${b.sql}`, from, end, ...b.args).n;
  const outstanding = row(db, `SELECT COALESCE(SUM(i.total - i.paid),0) AS n FROM invoices i WHERE i.status IN ('Unpaid','Partially Paid')${b.sql}`, ...b.args).n;
  const newPatients = row(db, `SELECT COUNT(*) AS n FROM patients p WHERE p.created_at >= ? AND p.created_at < ?${branchWhere(q, 'p.branch_id').sql}`, from, end, ...b.args).n;

  const byType = rows(db, `SELECT i.service_type AS type, COUNT(*) AS count, SUM(i.total) AS amount FROM invoices i WHERE ${invWhere} GROUP BY i.service_type ORDER BY amount DESC`, ...invArgs);
  const byMode = rows(db, `SELECT COALESCE(pm.mode,'Other') AS mode, COUNT(*) AS count, SUM(pm.amount) AS amount FROM payments pm JOIN invoices i ON i.id = pm.invoice_id WHERE i.status != 'Cancelled' AND pm.at >= ? AND pm.at < ?${b.sql} GROUP BY pm.mode ORDER BY amount DESC`, from, end, ...b.args);
  const daily = rows(db, `SELECT substr(i.created_at,1,10) AS date, SUM(i.total) AS amount, COUNT(*) AS count FROM invoices i WHERE ${invWhere} GROUP BY date ORDER BY date`, ...invArgs);

  const lines = new Map();
  for (const inv of rows(db, `SELECT i.service_type, i.items FROM invoices i WHERE ${invWhere}`, ...invArgs)) {
    for (const it of parse(inv.items, [])) {
      const name = String(it.name || '').replace(/ \(Session \d+\/\d+\)$/, '');
      const key = `${inv.service_type}|${name}`;
      const cur = lines.get(key) || { type: inv.service_type, name, qty: 0, amount: 0 };
      cur.qty += num(it.qty, 1);
      cur.amount += num(it.amount);
      lines.set(key, cur);
    }
  }
  const allLines = [...lines.values()].sort((x, y) => y.amount - x.amount);

  const appts = rows(db, `SELECT a.type, a.status, COUNT(*) AS n FROM appointments a WHERE a.date >= ? AND a.date <= ?${ba.sql} GROUP BY a.type, a.status`, from, to, ...ba.args);
  const clinical = TYPES.map((type) => {
    const list = appts.filter((r) => r.type === type);
    const total = list.reduce((s, r) => s + r.n, 0);
    const get = (...st) => list.filter((r) => st.includes(r.status)).reduce((s, r) => s + r.n, 0);
    return { type, total, completed: get('Completed', 'Reported'), noShow: get('No Show'), cancelled: get('Cancelled'), open: total - get('Completed', 'Reported', 'No Show', 'Cancelled') };
  });
  const staff = rows(
    db,
    `SELECT s.name, s.role, COUNT(a.id) AS appointments,
            SUM(CASE WHEN a.status IN ('Completed','Reported') THEN 1 ELSE 0 END) AS completed,
            COALESCE(SUM(CASE WHEN a.status IN ('Completed','Reported') THEN a.fee END),0) AS value
       FROM practitioners s JOIN appointments a ON a.practitioner_id = s.id AND a.date >= ? AND a.date <= ?${ba.sql}
      GROUP BY s.id ORDER BY completed DESC`,
    from, to, ...ba.args,
  );
  const plans = row(
    db,
    `SELECT SUM(CASE WHEN t.status = 'Active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN t.status = 'Discontinued' THEN 1 ELSE 0 END) AS discontinued FROM therapy_plans t WHERE 1=1${branchWhere(q, 't.branch_id').sql}`,
    ...b.args,
  );
  const dues = rows(db, `${INV_SELECT} WHERE i.status IN ('Unpaid','Partially Paid')${b.sql} ORDER BY (i.total - i.paid) DESC LIMIT 10`, ...b.args);

  const bi = branchWhere(q, 'it.branch_id');
  const stock = row(db, `SELECT COUNT(*) AS items, COALESCE(SUM(CASE WHEN it.stock > 0 THEN it.stock * it.cost END),0) AS value, SUM(CASE WHEN it.stock <= it.reorder_level AND it.reorder_level > 0 THEN 1 ELSE 0 END) AS low FROM items it WHERE it.active = 1${bi.sql}`, ...bi.args);
  const consumption = rows(
    db,
    `SELECT it.name, it.unit, SUM(-m.qty) AS qty, m.kind FROM stock_moves m JOIN items it ON it.id = m.item_id
      WHERE m.qty < 0 AND m.at >= ? AND m.at < ?${bi.sql} GROUP BY it.id, m.kind ORDER BY qty DESC LIMIT 15`,
    from, end, ...bi.args,
  );

  return {
    from,
    to,
    summary: { ...summary, collected, outstanding, newPatients, average: summary.invoices ? summary.billed / summary.invoices : 0 },
    byType,
    byMode,
    daily,
    topServices: allLines.filter((l) => l.type !== 'pharmacy').slice(0, 10),
    topMedicines: allLines.filter((l) => l.type === 'pharmacy').slice(0, 10),
    clinical,
    staff,
    plans,
    dues,
    stock,
    consumption,
  };
}

/* ---------------------------------------------------------------- settings */

const SETTING_KEYS = ['clinic_name', 'tagline', 'support_email', 'phone', 'address', 'gstin', 'invoice_prefix', 'invoice_footer', 'signatory_name', 'signatory_title', 'invoice_signature'];
const SIGNATURE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function saveSettings({ db, body, user }) {
  tx(db, () => {
    for (const key of SETTING_KEYS) {
      if (body[key] === undefined) continue;
      let value;
      if (key === 'invoice_signature') {
        value = String(body[key] || '');
        if (value && !SIGNATURE_RE.test(value)) bad('Signature must be a PNG, JPG or WEBP image');
        if (value.length > 400000) bad('Signature image is too large; use one under 300 KB');
      } else {
        value = str(body[key], 500);
      }
      if (key === 'invoice_prefix') value = value.replace(/[^A-Za-z0-9/-]/g, '').slice(0, 16) || 'RC/INV';
      run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    }
    audit(db, user.user, 'update', 'settings', '');
  });
  return getSettings(db);
}

export function readSettings({ db }) {
  return getSettings(db);
}

const BRANCH_CFG = 'branch_cfg_';
const REFUND_UNITS = ['Business Days', 'Calendar Days', 'Hours'];
const APPLY_KEYS = ['invoice', 'billing', 'portal', 'booking', 'reports'];
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

function branchConfigDefaults() {
  return {
    tagline: '',
    gst_rate: 18,
    signature: '',
    refund_days: 7,
    refund_unit: 'Business Days',
    upi_id: '',
    upi_qr: '',
    applies: { invoice: true, billing: true, portal: true, booking: true, reports: true },
    display_name: '',
    invoice_footer: '',
    pay_cash: true,
    pay_card: true,
    pay_upi: true,
    pay_bank: false,
    policy_note: '',
    cancel_note: '',
  };
}

function loadBranchConfig(db, id) {
  const raw = row(db, 'SELECT value FROM settings WHERE key = ?', BRANCH_CFG + int(id));
  const saved = raw && raw.value ? parse(raw.value, {}) : {};
  const base = branchConfigDefaults();
  const applies = { ...base.applies };
  if (saved.applies && typeof saved.applies === 'object') {
    for (const key of APPLY_KEYS) if (saved.applies[key] != null) applies[key] = saved.applies[key] === true || saved.applies[key] === 1;
  }
  const gst = Number(saved.gst_rate);
  const days = Number(saved.refund_days);
  return {
    tagline: str(saved.tagline, 100),
    gst_rate: Number.isFinite(gst) ? gst : base.gst_rate,
    signature: typeof saved.signature === 'string' ? saved.signature : '',
    refund_days: Number.isFinite(days) ? days : base.refund_days,
    refund_unit: REFUND_UNITS.includes(saved.refund_unit) ? saved.refund_unit : base.refund_unit,
    upi_id: str(saved.upi_id, 80),
    upi_qr: typeof saved.upi_qr === 'string' ? saved.upi_qr : '',
    applies,
    display_name: str(saved.display_name, 120),
    invoice_footer: str(saved.invoice_footer, 300),
    pay_cash: saved.pay_cash == null ? true : Boolean(saved.pay_cash),
    pay_card: saved.pay_card == null ? true : Boolean(saved.pay_card),
    pay_upi: saved.pay_upi == null ? true : Boolean(saved.pay_upi),
    pay_bank: Boolean(saved.pay_bank),
    policy_note: str(saved.policy_note, 500),
    cancel_note: str(saved.cancel_note, 500),
    saved: Boolean(raw && raw.value),
  };
}

function checkImage(value, label) {
  if (!value) return '';
  if (!IMAGE_RE.test(value)) bad(`${label} must be a PNG or JPG image`);
  if (value.length > 280000) bad(`${label} is too large after resizing; use a simpler image`);
  return value;
}

export function readBranchConfig({ db, params }) {
  mustGet(db, 'branches', params.id, 'Branch');
  return loadBranchConfig(db, params.id);
}

export function saveBranchConfig({ db, body, params, user }) {
  const branch = mustGet(db, 'branches', params.id, 'Branch');
  const next = loadBranchConfig(db, branch.id);
  if (body.tagline !== undefined) next.tagline = str(body.tagline, 100);
  if (body.gst_rate !== undefined) {
    const n = Number(body.gst_rate);
    if (!Number.isFinite(n) || n < 0 || n > 100) bad('GST rate must be between 0 and 100');
    next.gst_rate = Math.round(n * 100) / 100;
  }
  if (body.signature !== undefined) next.signature = checkImage(String(body.signature || ''), 'Signature');
  if (body.upi_qr !== undefined) next.upi_qr = checkImage(String(body.upi_qr || ''), 'UPI QR');
  if (body.refund_days !== undefined) {
    const n = Math.round(Number(body.refund_days));
    if (!Number.isFinite(n) || n < 0 || n > 365) bad('Refund timeline must be between 0 and 365');
    next.refund_days = n;
  }
  if (body.refund_unit !== undefined) {
    if (!REFUND_UNITS.includes(body.refund_unit)) bad('Choose a refund timeline unit');
    next.refund_unit = body.refund_unit;
  }
  if (body.upi_id !== undefined) next.upi_id = str(body.upi_id, 80);
  if (body.display_name !== undefined) next.display_name = str(body.display_name, 120);
  if (body.invoice_footer !== undefined) next.invoice_footer = str(body.invoice_footer, 300);
  if (body.policy_note !== undefined) next.policy_note = str(body.policy_note, 500);
  if (body.cancel_note !== undefined) next.cancel_note = str(body.cancel_note, 500);
  for (const key of ['pay_cash', 'pay_card', 'pay_upi', 'pay_bank']) {
    if (body[key] !== undefined) next[key] = body[key] === true || body[key] === 1;
  }
  if (body.applies && typeof body.applies === 'object') {
    for (const key of APPLY_KEYS) if (body.applies[key] !== undefined) next.applies[key] = body.applies[key] === true || body.applies[key] === 1;
  }
  delete next.saved;
  const payload = JSON.stringify(next);
  if (payload.length > 700000) bad('Branch settings are too large');
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', BRANCH_CFG + branch.id, payload);
  audit(db, user.user, 'update', 'branch settings', branch.name);
  return { ...next, saved: true };
}

export function savedBranchConfig(db, id) {
  if (!id) return null;
  const raw = row(db, 'SELECT value FROM settings WHERE key = ?', BRANCH_CFG + int(id));
  if (!raw || !raw.value) return null;
  return loadBranchConfig(db, id);
}

export function activity({ db, q }) {
  const { limit, offset } = page(q, 200, 50);
  return { items: rows(db, 'SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset) };
}

export function removeSampleData({ db, user }) {
  const removed = clearDemo(db);
  audit(db, user.user, 'clear sample data', 'settings', JSON.stringify(removed));
  return { removed };
}
