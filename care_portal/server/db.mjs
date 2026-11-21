import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const LEVELS = ['none', 'view', 'create', 'edit', 'approve', 'manage'];

export const MODULES = [
  'Dashboard',
  'Appointments',
  'Doctors',
  'Physiotherapy',
  'Patients',
  'Test & Lab',
  'Diagnostics',
  'Billing & Invoice',
  'Pharmacy',
  'Inventory Management',
  'Branch Management',
  'Reports & Analytics',
  'Assets Management',
  'User & Access',
  'Settings',
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT, city TEXT, address TEXT, phone TEXT,
  manager TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 30, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS practitioners (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, specialty TEXT, phone TEXT, email TEXT,
  branch_id INTEGER, fee REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, mobile TEXT, gender TEXT, age INTEGER,
  email TEXT, address TEXT, condition TEXT, referred_by TEXT, branch_id INTEGER,
  created_at TEXT, created_by TEXT, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS therapy_plans (
  id INTEGER PRIMARY KEY, code TEXT, patient_id INTEGER NOT NULL, condition TEXT, practitioner_id INTEGER,
  total_sessions INTEGER NOT NULL DEFAULT 1, fee REAL NOT NULL DEFAULT 0, start_date TEXT, frequency TEXT,
  status TEXT NOT NULL DEFAULT 'Active', notes TEXT, branch_id INTEGER, created_at TEXT, created_by TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, code TEXT, patient_id INTEGER NOT NULL, type TEXT NOT NULL, service TEXT, tests TEXT,
  practitioner_id INTEGER, plan_id INTEGER, session_no INTEGER, date TEXT NOT NULL, time TEXT,
  status TEXT NOT NULL DEFAULT 'Scheduled', fee REAL NOT NULL DEFAULT 0, notes TEXT, result TEXT,
  invoice_id INTEGER, branch_id INTEGER, created_at TEXT, created_by TEXT, updated_at TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE, patient_id INTEGER, customer TEXT, service_type TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]', subtotal REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, status TEXT NOT NULL, payment_mode TEXT,
  appointment_id INTEGER, notes TEXT, branch_id INTEGER, created_at TEXT, created_by TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL, amount REAL NOT NULL, mode TEXT, reference TEXT,
  at TEXT, by TEXT, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sku TEXT, category TEXT, unit TEXT, stock REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0,
  expiry TEXT, vendor TEXT, branch_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, qty REAL NOT NULL, kind TEXT, ref TEXT, note TEXT,
  at TEXT, by TEXT, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY, tag TEXT, name TEXT NOT NULL, category TEXT, branch_id INTEGER,
  status TEXT NOT NULL DEFAULT 'Working', purchase_date TEXT, cost REAL, vendor TEXT, last_service TEXT,
  next_service TEXT, notes TEXT, created_at TEXT, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS asset_logs (
  id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL, at TEXT, kind TEXT, note TEXT, by TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS physio_packages (
  id INTEGER PRIMARY KEY, code TEXT, name TEXT NOT NULL, sessions INTEGER NOT NULL DEFAULT 1, therapies TEXT NOT NULL DEFAULT '[]',
  price REAL NOT NULL DEFAULT 0, validity_days INTEGER, description TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, created_by TEXT, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session_bills (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE, appointment_id INTEGER NOT NULL UNIQUE, plan_id INTEGER NOT NULL,
  package_invoice_id INTEGER NOT NULL, patient_id INTEGER, session_no INTEGER, amount REAL NOT NULL DEFAULT 0,
  snapshot TEXT NOT NULL DEFAULT '{}', branch_id INTEGER, created_at TEXT, created_by TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS lab_bookings (
  id INTEGER PRIMARY KEY, trf_id TEXT NOT NULL UNIQUE, barcode TEXT, patient_id INTEGER, patient_name TEXT, mobile TEXT,
  branch_id INTEGER, invoice_id INTEGER, tests TEXT NOT NULL DEFAULT '[]', referred_by TEXT,
  net REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, due REAL NOT NULL DEFAULT 0, payment_status TEXT,
  status TEXT, order_status TEXT, stage_index INTEGER NOT NULL DEFAULT 0, report_ready INTEGER NOT NULL DEFAULT 0,
  report_status TEXT, journey_id TEXT, authorized_on TEXT, detail TEXT NOT NULL DEFAULT '{}',
  booked_at TEXT, created_at TEXT, created_by TEXT, synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_patient ON lab_bookings(patient_id);
CREATE TABLE IF NOT EXISTS feedback_requests (
  id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, appointment_id INTEGER NOT NULL UNIQUE, patient_id INTEGER,
  plan_id INTEGER, session_no INTEGER, service TEXT, branch_id INTEGER, practitioner_id INTEGER, mobile TEXT,
  status TEXT NOT NULL DEFAULT 'Not sent', channel TEXT, send_error TEXT, send_attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT, opened_at TEXT, expires_at TEXT, submitted_at TEXT, created_at TEXT, created_by TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fbreq_patient ON feedback_requests(patient_id);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, request_id INTEGER NOT NULL UNIQUE, appointment_id INTEGER NOT NULL UNIQUE,
  patient_id INTEGER, plan_id INTEGER, session_no INTEGER, service TEXT, branch_id INTEGER, practitioner_id INTEGER,
  rating INTEGER NOT NULL, feedback TEXT, suggestions TEXT, status TEXT NOT NULL DEFAULT 'To Review', flag_reason TEXT,
  submitted_at TEXT, moderated_at TEXT, moderated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_patient ON reviews(patient_id);
CREATE TABLE IF NOT EXISTS review_events (
  id INTEGER PRIMARY KEY, request_id INTEGER, review_id INTEGER, at TEXT, user TEXT, action TEXT NOT NULL, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_events_request ON review_events(request_id);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT, user TEXT, action TEXT, entity TEXT, ref TEXT);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_plan ON appointments(plan_id);
CREATE INDEX IF NOT EXISTS idx_inv_created ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_inv_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_moves_item ON stock_moves(item_id);
CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, tone TEXT, active INTEGER NOT NULL DEFAULT 1,
  custom INTEGER NOT NULL DEFAULT 0, created_at TEXT, created_by TEXT
);
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, branch_id INTEGER NOT NULL, voucher_date TEXT NOT NULL,
  category_id INTEGER, category TEXT NOT NULL, payee TEXT NOT NULL, amount REAL NOT NULL, paid REAL NOT NULL DEFAULT 0,
  payment_mode TEXT, purpose TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'Pending',
  approval_note TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, created_by TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_vouchers_branch_date ON vouchers(branch_id, voucher_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE TABLE IF NOT EXISTS voucher_files (
  id INTEGER PRIMARY KEY, voucher_id INTEGER NOT NULL, name TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0,
  stored TEXT, created_at TEXT, created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_vfiles_voucher ON voucher_files(voucher_id);
CREATE TABLE IF NOT EXISTS voucher_payments (
  id INTEGER PRIMARY KEY, voucher_id INTEGER NOT NULL, amount REAL NOT NULL, mode TEXT, reference TEXT,
  paid_on TEXT, note TEXT, at TEXT, by_user TEXT
);
CREATE INDEX IF NOT EXISTS idx_vpay_voucher ON voucher_payments(voucher_id);
CREATE TABLE IF NOT EXISTS voucher_events (
  id INTEGER PRIMARY KEY, voucher_id INTEGER NOT NULL, at TEXT, user TEXT, action TEXT NOT NULL, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_vevt_voucher ON voucher_events(voucher_id);
`;

/* Columns added after the first release; created on start-up when missing. */
const MIGRATIONS = {
  services: {
    code: 'TEXT',
    mrp: 'REAL',
    sample_type: 'TEXT',
    tat_hours: 'INTEGER',
    lab_group: 'TEXT',
    preparation: 'TEXT',
    source: "TEXT NOT NULL DEFAULT 'local'",
    price_override: 'INTEGER NOT NULL DEFAULT 0',
    synced_at: 'TEXT',
    modality: 'TEXT',
    body_part: 'TEXT',
    needs_report: 'INTEGER NOT NULL DEFAULT 0',
    description: 'TEXT',
  },
  therapy_plans: {
    billing: "TEXT NOT NULL DEFAULT 'per_session'",
    package_id: 'INTEGER',
    package_name: 'TEXT',
    therapies: 'TEXT',
    package_price: 'REAL',
    invoice_id: 'INTEGER',
    valid_until: 'TEXT',
    ref_type: 'TEXT',
    ref_doctor_id: 'INTEGER',
    referred_by: 'TEXT',
    ref_contact: 'TEXT',
  },
  appointments: {
    reported_by: 'TEXT',
    reported_at: 'TEXT',
  },
  invoices: {
    discount_type: 'TEXT',
    discount_value: 'REAL',
    practitioner_id: 'INTEGER',
    referred_by: 'TEXT',
    trf_id: 'TEXT',
    gst_rate: 'REAL',
    gst_amount: 'REAL NOT NULL DEFAULT 0',
  },
  practitioners: {
    qualification: 'TEXT',
    registration_no: 'TEXT',
    slot_minutes: 'INTEGER',
    availability: 'TEXT',
  },
  branches: {
    email: 'TEXT',
    gst_registered: 'INTEGER NOT NULL DEFAULT 0',
    gstin: 'TEXT',
    state: 'TEXT',
    state_code: 'TEXT',
  },
  assets: {
    model: 'TEXT',
    serial: 'TEXT',
    description: 'TEXT',
    photo: 'TEXT',
    amc_vendor: 'TEXT',
    amc_ref: 'TEXT',
    amc_start: 'TEXT',
    amc_end: 'TEXT',
    amc_cost: 'REAL',
  },
};

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  for (const [table, columns] of Object.entries(MIGRATIONS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(columns)) {
      if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_services_code ON services(code) WHERE code IS NOT NULL');
  return db;
}

const clean = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

export const rows = (db, sql, ...args) => db.prepare(sql).all(...clean(args));
export const row = (db, sql, ...args) => db.prepare(sql).get(...clean(args));
export const run = (db, sql, ...args) => db.prepare(sql).run(...clean(args));

export function insert(db, table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(run(db, sql, ...keys.map((k) => data[k])).lastInsertRowid);
}

export function update(db, table, id, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return;
  run(db, `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function nextSeq(db, name) {
  run(db, 'INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1', name);
  return row(db, 'SELECT value FROM counters WHERE name = ?', name).value;
}

export function getSettings(db) {
  const out = {};
  for (const r of rows(db, 'SELECT key, value FROM settings')) {
    if (String(r.key).startsWith('branch_cfg_')) continue;
    out[r.key] = r.value;
  }
  return out;
}

export function audit(db, user, action, entity, ref) {
  run(db, 'INSERT INTO audit (at, user, action, entity, ref) VALUES (?, ?, ?, ?, ?)', stamp(), user, action, entity, String(ref ?? ''));
}

/* Clinic time is India Standard Time regardless of the server's timezone. */
const IST_OFFSET_MS = 330 * 60 * 1000;
export const nowIst = () => new Date(Date.now() + IST_OFFSET_MS);
export const todayStr = () => nowIst().toISOString().slice(0, 10);
export const stamp = () => nowIst().toISOString().slice(0, 19).replace('T', ' ');
export const clockStr = () => nowIst().toISOString().slice(11, 16);

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
