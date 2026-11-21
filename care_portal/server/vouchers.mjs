/* Expense vouchers for the aesthetic clinic. One row is shared with Ops approvals. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit, insert, nextSeq, row, rows, run, stamp, todayStr, tx, update } from './db.mjs';
import { HttpError } from './api.mjs';

const STATUSES = ['Pending', 'Approved', 'Rejected', 'Paid', 'Cancelled'];
const MODES = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'];
const DEFAULT_CATEGORIES = [
  ['Rent', 'blue'],
  ['Utilities', 'green'],
  ['Staff Expense', 'sand'],
  ['Consumables', 'red'],
  ['Maintenance', 'purple'],
  ['Marketing', 'amber'],
  ['Travel', 'teal'],
  ['Miscellaneous', 'gray'],
];
const FILE_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const MAX_FILE = 5 * 1024 * 1024;

const bad = (message) => {
  throw new HttpError(400, message);
};
const denied = (message) => {
  throw new HttpError(403, message);
};

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const actor = (user) => (user && (user.full_name || user.user)) || 'Staff';

function levelAt(session, mod, level) {
  const rank = ['none', 'view', 'create', 'edit', 'approve', 'manage'];
  const have = (session && session.modules && session.modules[mod]) || 'none';
  return rank.indexOf(have) >= rank.indexOf(level);
}

export function voucherAccess(user) {
  const u = user || {};
  return {
    view: Boolean(u.ops_voucher_view || u.ops_approver || levelAt(u, 'Billing & Invoice', 'view')),
    create: levelAt(u, 'Billing & Invoice', 'create'),
    edit: levelAt(u, 'Billing & Invoice', 'edit'),
    categories: levelAt(u, 'Settings', 'edit') || levelAt(u, 'Billing & Invoice', 'manage') || Boolean(u.aes_manager || u.exempt),
    approve: Boolean(u.ops_approver || u.exempt),
  };
}

function guard(ctx, key) {
  const access = voucherAccess(ctx.user);
  if (!access[key]) denied(key === 'approve' ? 'Only an Ops Purchase Manager or Admin can approve vouchers' : 'You do not have access to expense vouchers');
  return access;
}

export function ensure(db) {
  db.exec(`
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
  `);
  for (const [name, tone] of DEFAULT_CATEGORIES) {
    const have = row(db, 'SELECT id FROM expense_categories WHERE name = ?', name);
    if (!have) {
      insert(db, 'expense_categories', { name, tone, active: 1, custom: 0, created_at: stamp(), created_by: 'system' });
    }
  }
}

function fileDir(cfg) {
  const dir = path.join(path.dirname(cfg.dbFile), 'voucher-files');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function branchIds(ctx) {
  if (ctx.user && (ctx.user.ops_approver || ctx.user.ops_voucher_view)) {
    const id = Number(ctx.q.branch);
    return id > 0 ? [id] : null;
  }
  if (ctx.scope === null) {
    const id = Number(ctx.q.branch);
    return id > 0 ? [id] : null;
  }
  const allow = Array.isArray(ctx.scope) ? ctx.scope.map(Number) : [];
  const id = Number(ctx.q.branch);
  if (id > 0) {
    if (!allow.includes(id)) denied('That branch is not assigned to you');
    return [id];
  }
  return allow;
}

function branchRow(db, id) {
  const branch = row(db, 'SELECT id, name, code, active FROM branches WHERE id = ?', Number(id));
  if (!branch || !branch.active) bad('Choose a branch');
  return branch;
}

function branchCode(branch) {
  const code = String(branch.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code) return code.slice(0, 6);
  const letters = String(branch.name || 'BR').replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters || 'BR').slice(0, 3);
}

function nextNumber(db, branch) {
  const seq = nextSeq(db, `voucher-${branch.id}`);
  return `PV-${branchCode(branch)}-${String(seq).padStart(4, '0')}`;
}

function categoryById(db, id) {
  const cat = row(db, 'SELECT id, name, tone, active FROM expense_categories WHERE id = ?', Number(id));
  if (!cat || !cat.active) bad('Choose an expense category');
  return cat;
}

function event(db, voucherId, user, action, note) {
  insert(db, 'voucher_events', {
    voucher_id: voucherId,
    at: stamp(),
    user: actor(user),
    action,
    note: text(note, 500),
  });
  audit(db, actor(user), action, 'voucher', voucherId);
}

function saveFiles(ctx, voucherId, files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length > 6) bad('Attach up to 6 files');
  const dir = fileDir(ctx.cfg);
  for (const file of list) {
    const mime = String(file.mime || file.type || '').toLowerCase();
    const ext = FILE_TYPES[mime];
    if (!ext) bad('Attach a PDF, JPG or PNG');
    const raw = String(file.data || '').replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) bad('That attachment is empty');
    if (buf.length > MAX_FILE) bad('Each attachment must be 5 MB or smaller');
    const stored = `${voucherId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, stored), buf, { mode: 0o640 });
    insert(dbOf(ctx), 'voucher_files', {
      voucher_id: voucherId,
      name: text(file.name, 180) || `bill.${ext}`,
      mime,
      size: buf.length,
      stored,
      created_at: stamp(),
      created_by: actor(ctx.user),
    });
  }
}

function dbOf(ctx) {
  return ctx.db;
}

function filesOf(db, voucherId) {
  return rows(db, 'SELECT id, name, mime, size, created_at FROM voucher_files WHERE voucher_id = ? ORDER BY id', voucherId);
}

function paymentsOf(db, voucherId) {
  return rows(db, 'SELECT id, amount, mode, reference, paid_on, note, at, by_user FROM voucher_payments WHERE voucher_id = ? ORDER BY id', voucherId);
}

function eventsOf(db, voucherId) {
  return rows(db, 'SELECT id, at, user, action, note FROM voucher_events WHERE voucher_id = ? ORDER BY id', voucherId);
}

function present(db, voucher) {
  if (!voucher) return null;
  const branch = row(db, 'SELECT id, name, code FROM branches WHERE id = ?', voucher.branch_id) || {};
  const paid = money(voucher.paid);
  const amount = money(voucher.amount);
  return {
    ...voucher,
    amount,
    paid,
    balance: money(amount - paid),
    branch_name: branch.name || '',
    branch_code: branch.code || '',
    files: filesOf(db, voucher.id),
    payments: paymentsOf(db, voucher.id),
    history: eventsOf(db, voucher.id),
  };
}

function loadVoucher(ctx, id) {
  const voucher = row(ctx.db, 'SELECT * FROM vouchers WHERE id = ?', Number(id));
  if (!voucher) throw new HttpError(404, 'Voucher not found');
  const ids = branchIds(ctx);
  if (ids && !ids.includes(Number(voucher.branch_id))) throw new HttpError(404, 'Voucher not found');
  return voucher;
}

function whereBranch(ids, args) {
  if (!ids) return '';
  if (!ids.length) return ' AND 1 = 0';
  args.push(...ids);
  return ` AND branch_id IN (${ids.map(() => '?').join(',')})`;
}

function monthSpan(iso) {
  const [y, m] = iso.split('-');
  const start = `${y}-${m}-01`;
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return [start, `${y}-${m}-${String(last).padStart(2, '0')}`];
}

export function listCategories(ctx) {
  guard(ctx, 'view');
  return {
    items: rows(ctx.db, 'SELECT id, name, tone, active, custom FROM expense_categories ORDER BY custom, name'),
    access: voucherAccess(ctx.user),
  };
}

export function saveCategory(ctx) {
  guard(ctx, 'categories');
  const name = text(ctx.body.name, 60);
  if (name.length < 2) bad('Enter a category name');
  const existing = row(ctx.db, 'SELECT id FROM expense_categories WHERE lower(name) = lower(?)', name);
  if (existing) bad('That category already exists');
  const id = insert(ctx.db, 'expense_categories', {
    name,
    tone: text(ctx.body.tone, 20) || 'gray',
    active: 1,
    custom: 1,
    created_at: stamp(),
    created_by: actor(ctx.user),
  });
  audit(ctx.db, actor(ctx.user), 'category-add', 'expense_category', id);
  return row(ctx.db, 'SELECT id, name, tone, active, custom FROM expense_categories WHERE id = ?', id);
}

export function updateCategory(ctx) {
  guard(ctx, 'categories');
  const current = row(ctx.db, 'SELECT id, custom FROM expense_categories WHERE id = ?', Number(ctx.params.id));
  if (!current) throw new HttpError(404, 'Category not found');
  const name = ctx.body.name != null ? text(ctx.body.name, 60) : undefined;
  if (name !== undefined && name.length < 2) bad('Enter a category name');
  const active = ctx.body.active == null ? undefined : ctx.body.active ? 1 : 0;
  update(ctx.db, 'expense_categories', current.id, { name, active });
  audit(ctx.db, actor(ctx.user), 'category-update', 'expense_category', current.id);
  return row(ctx.db, 'SELECT id, name, tone, active, custom FROM expense_categories WHERE id = ?', current.id);
}

function readFields(ctx, current) {
  const date = text(ctx.body.date || ctx.body.voucher_date, 10);
  if (!isDate(date)) bad('Enter a voucher date');
  const cat = categoryById(ctx.db, ctx.body.category_id);
  const payee = text(ctx.body.payee, 120);
  if (payee.length < 2) bad('Enter who was paid');
  const amount = money(ctx.body.amount);
  if (!(amount > 0)) bad('Enter an amount greater than zero');
  const mode = text(ctx.body.payment_mode || ctx.body.mode, 40);
  if (!MODES.includes(mode)) bad('Choose a payment mode');
  const purpose = text(ctx.body.purpose, 250);
  if (purpose.length < 2) bad('Enter the purpose');
  let branchId = Number(ctx.body.branch_id || (current && current.branch_id) || ctx.q.branch);
  const ids = branchIds(ctx);
  if (!branchId && ids && ids.length === 1) branchId = ids[0];
  if (ids && !ids.includes(branchId)) denied('That branch is not assigned to you');
  const branch = branchRow(ctx.db, branchId);
  return {
    voucher_date: date,
    category_id: cat.id,
    category: cat.name,
    payee,
    amount,
    payment_mode: mode,
    purpose,
    notes: text(ctx.body.notes, 500),
    branch_id: branch.id,
    branch,
  };
}

export function createVoucher(ctx) {
  guard(ctx, 'create');
  const fields = readFields(ctx);
  const { branch, ...data } = fields;
  const id = tx(ctx.db, () => {
    const number = nextNumber(ctx.db, branch);
    const voucherId = insert(ctx.db, 'vouchers', {
      ...data,
      number,
      paid: 0,
      status: 'Pending',
      created_at: stamp(),
      created_by: actor(ctx.user),
      updated_at: stamp(),
    });
    event(ctx.db, voucherId, ctx.user, 'submitted', 'Sent to Ops for approval');
    return voucherId;
  });
  saveFiles(ctx, id, ctx.body.files);
  return present(ctx.db, row(ctx.db, 'SELECT * FROM vouchers WHERE id = ?', id));
}

export function updateVoucher(ctx) {
  guard(ctx, 'edit');
  const current = loadVoucher(ctx, ctx.params.id);
  if (!['Pending', 'Rejected'].includes(current.status)) bad('Only a pending or rejected voucher can be edited');
  if (money(current.paid) > 0) bad('This voucher already has a payment');
  const fields = readFields(ctx, current);
  const { branch, ...data } = fields;
  const resubmit = current.status === 'Rejected';
  tx(ctx.db, () => {
    update(ctx.db, 'vouchers', current.id, {
      ...data,
      status: 'Pending',
      approval_note: resubmit ? '' : current.approval_note,
      approved_by: resubmit ? '' : current.approved_by,
      approved_at: resubmit ? '' : current.approved_at,
      updated_at: stamp(),
    });
    event(ctx.db, current.id, ctx.user, resubmit ? 'resubmitted' : 'updated', resubmit ? 'Sent back to Ops for approval' : '');
  });
  saveFiles(ctx, current.id, ctx.body.files);
  const drop = Array.isArray(ctx.body.remove_files) ? ctx.body.remove_files.map(Number) : [];
  for (const fileId of drop) removeFile(ctx, current.id, fileId);
  return present(ctx.db, row(ctx.db, 'SELECT * FROM vouchers WHERE id = ?', current.id));
}

function removeFile(ctx, voucherId, fileId) {
  const file = row(ctx.db, 'SELECT id, stored FROM voucher_files WHERE id = ? AND voucher_id = ?', fileId, voucherId);
  if (!file) return;
  run(ctx.db, 'DELETE FROM voucher_files WHERE id = ?', file.id);
  if (file.stored) {
    const full = path.join(fileDir(ctx.cfg), path.basename(file.stored));
    fs.rmSync(full, { force: true });
  }
}

export function cancelVoucher(ctx) {
  guard(ctx, 'edit');
  const current = loadVoucher(ctx, ctx.params.id);
  if (current.status !== 'Pending') bad('Only a pending voucher can be cancelled');
  update(ctx.db, 'vouchers', current.id, { status: 'Cancelled', updated_at: stamp() });
  event(ctx.db, current.id, ctx.user, 'cancelled', text(ctx.body.note, 300));
  return present(ctx.db, row(ctx.db, 'SELECT * FROM vouchers WHERE id = ?', current.id));
}

export function decideVoucher(ctx) {
  guard(ctx, 'approve');
  const current = loadVoucher(ctx, ctx.params.id);
  if (current.status !== 'Pending') bad('This voucher is not waiting for approval');
  const decision = text(ctx.body.decision || ctx.body.status, 20);
  const note = text(ctx.body.note || ctx.body.remark, 500);
  if (decision === 'Rejected' && note.length < 2) bad('Enter a reason for the rejection');
  if (!['Approved', 'Rejected'].includes(decision)) bad('Approve or reject this voucher');
  update(ctx.db, 'vouchers', current.id, {
    status: decision,
    approval_note: note,
    approved_by: actor(ctx.user),
    approved_at: stamp(),
    updated_at: stamp(),
  });
  event(ctx.db, current.id, ctx.user, decision === 'Approved' ? 'approved' : 'rejected', note);
  return present(ctx.db, row(ctx.db, 'SELECT * FROM vouchers WHERE id = ?', current.id));
}

export function addPayment(ctx) {
  guard(ctx, 'edit');
  const current = loadVoucher(ctx, ctx.params.id);
  if (!['Approved', 'Paid'].includes(current.status)) bad('Record the payment after Ops approves the voucher');
  const amount = money(ctx.body.amount);
  const balance = money(current.amount - current.paid);
  if (!(amount > 0)) bad('Enter the amount paid');
  if (amount - balance > 0.001) bad('That is more than the balance');
  const mode = text(ctx.body.mode || ctx.body.payment_mode, 40) || current.payment_mode;
  if (!MODES.includes(mode)) bad('Choose a payment mode');
  const paidOn = text(ctx.body.paid_on || ctx.body.date, 10);
  if (!isDate(paidOn)) bad('Enter the payment date');
  const reference = text(ctx.body.reference, 80);
  if (mode !== 'Cash' && reference.length < 2) bad('Enter the transaction or reference number');
  const paid = money(current.paid + amount);
  const status = paid + 0.001 >= money(current.amount) ? 'Paid' : 'Approved';
  tx(ctx.db, () => {
    insert(ctx.db, 'voucher_payments', {
      voucher_id: current.id,
      amount,
      mode,
      reference,
      paid_on: paidOn,
      note: text(ctx.body.note, 300),
      at: stamp(),
      by_user: actor(ctx.user),
    });
    update(ctx.db, 'vouchers', current.id, { paid, status, updated_at: stamp() });
    event(ctx.db, current.id, ctx.user, 'paid', `${mode} ${amount}${reference ? ` · ${reference}` : ''}`);
  });
  return present(ctx.db, row(ctx.db, 'SELECT * FROM vouchers WHERE id = ?', current.id));
}

export function getVoucher(ctx) {
  guard(ctx, 'view');
  return { voucher: present(ctx.db, loadVoucher(ctx, ctx.params.id)), access: voucherAccess(ctx.user) };
}

export function fileBody(ctx) {
  guard(ctx, 'view');
  loadVoucher(ctx, ctx.params.id);
  const file = row(ctx.db, 'SELECT name, mime, stored FROM voucher_files WHERE id = ? AND voucher_id = ?', Number(ctx.params.fid), Number(ctx.params.id));
  if (!file || !file.stored) throw new HttpError(404, 'Attachment not found');
  const full = path.join(fileDir(ctx.cfg), path.basename(file.stored));
  if (!full.startsWith(fileDir(ctx.cfg)) || !fs.existsSync(full)) throw new HttpError(404, 'Attachment not found');
  return { raw: { body: fs.readFileSync(full), type: file.mime || 'application/octet-stream', filename: file.name || 'bill' } };
}

function kpis(db, ids) {
  const today = todayStr();
  const [start, end] = monthSpan(today);
  const prevDate = new Date(`${start}T00:00:00Z`);
  prevDate.setUTCDate(0);
  const prevIso = prevDate.toISOString().slice(0, 10);
  const [prevStart, prevEnd] = monthSpan(prevIso);
  const sum = (from, to) => {
    const args = [from, to];
    const sql = `SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM vouchers WHERE status != 'Cancelled' AND voucher_date >= ? AND voucher_date <= ?${whereBranch(ids, args)}`;
    return row(db, sql, ...args);
  };
  const cur = sum(start, end);
  const prev = sum(prevStart, prevEnd);
  const amount = money(cur.amount);
  const prevAmount = money(prev.amount);
  const delta = prevAmount > 0 ? Math.round(((amount - prevAmount) / prevAmount) * 1000) / 10 : amount > 0 ? 100 : 0;
  const counts = {};
  for (const status of STATUSES) {
    const args = [status];
    counts[status] = row(db, `SELECT COUNT(*) AS n FROM vouchers WHERE status = ?${whereBranch(ids, args)}`, ...args).n;
  }
  const allArgs = [];
  const all = row(db, `SELECT COUNT(*) AS n FROM vouchers WHERE 1 = 1${whereBranch(ids, allArgs)}`, ...allArgs).n;
  const monthArgs = [start, end];
  const monthCount = row(db, `SELECT COUNT(*) AS n FROM vouchers WHERE status != 'Cancelled' AND voucher_date >= ? AND voucher_date <= ?${whereBranch(ids, monthArgs)}`, ...monthArgs).n;
  return {
    month_amount: amount,
    month_count: monthCount,
    average: monthCount ? money(amount / monthCount) : 0,
    delta,
    counts,
    all,
    month_start: start,
    month_end: end,
  };
}

export function listVouchers(ctx) {
  guard(ctx, 'view');
  const ids = branchIds(ctx);
  const args = [];
  let sql = ` FROM vouchers WHERE 1 = 1${whereBranch(ids, args)}`;
  const q = text(ctx.q.q, 80);
  if (q) {
    sql += ' AND (number LIKE ? OR payee LIKE ? OR purpose LIKE ? OR category LIKE ?)';
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like, like);
  }
  const status = text(ctx.q.status, 20);
  if (STATUSES.includes(status)) {
    sql += ' AND status = ?';
    args.push(status);
  }
  const category = Number(ctx.q.category_id || ctx.q.category);
  if (category > 0) {
    sql += ' AND category_id = ?';
    args.push(category);
  }
  let from = text(ctx.q.from, 10);
  let to = text(ctx.q.to, 10);
  if (ctx.q.tab === 'month') [from, to] = monthSpan(todayStr());
  if (isDate(from)) {
    sql += ' AND voucher_date >= ?';
    args.push(from);
  }
  if (isDate(to)) {
    sql += ' AND voucher_date <= ?';
    args.push(to);
  }
  const total = row(ctx.db, `SELECT COUNT(*) AS n${sql}`, ...args).n;
  const limit = Math.min(Math.max(Number(ctx.q.limit) || 5, 1), 100);
  const page = Math.max(Number(ctx.q.page) || 1, 1);
  const offset = (page - 1) * limit;
  const items = rows(ctx.db, `SELECT *${sql} ORDER BY voucher_date DESC, id DESC LIMIT ? OFFSET ?`, ...args, limit, offset).map((item) => present(ctx.db, item));
  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    kpis: kpis(ctx.db, ids),
    modes: MODES,
    access: voucherAccess(ctx.user),
  };
}

export function report(ctx) {
  guard(ctx, 'view');
  const ids = branchIds(ctx);
  const today = todayStr();
  let from = text(ctx.q.from, 10);
  let to = text(ctx.q.to, 10);
  const period = text(ctx.q.period, 20) || 'month';
  if (!isDate(from) || !isDate(to)) {
    if (period === 'day') from = to = today;
    else if (period === 'year') {
      from = `${today.slice(0, 4)}-01-01`;
      to = today;
    } else {
      [from, to] = monthSpan(today);
    }
  }
  if (from > to) bad('The start date is after the end date');
  const args = [from, to];
  const sql = `FROM vouchers WHERE status IN ('Approved', 'Paid') AND voucher_date >= ? AND voucher_date <= ?${whereBranch(ids, args)}`;
  const head = row(ctx.db, `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(paid), 0) AS paid ${sql}`, ...args);
  const group = (col) => rows(ctx.db, `SELECT ${col} AS name, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(paid), 0) AS paid ${sql} GROUP BY ${col} ORDER BY amount DESC`, ...args);
  const lines = rows(ctx.db, `SELECT id, number, voucher_date, branch_id, category, payee, purpose, amount, paid, status ${sql} ORDER BY voucher_date, id`, ...args).map((line) => {
    const branch = row(ctx.db, 'SELECT name FROM branches WHERE id = ?', line.branch_id);
    return { ...line, amount: money(line.amount), paid: money(line.paid), balance: money(line.amount - line.paid), branch_name: branch ? branch.name : '' };
  });
  return {
    from,
    to,
    period,
    totals: { count: head.count, amount: money(head.amount), paid: money(head.paid), balance: money(head.amount - head.paid) },
    by_category: group('category').map(roundGroup),
    by_vendor: group('payee').map(roundGroup),
    by_branch: rows(ctx.db, `SELECT branch_id, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(paid), 0) AS paid ${sql} GROUP BY branch_id ORDER BY amount DESC`, ...args).map((item) => {
      const branch = row(ctx.db, 'SELECT name FROM branches WHERE id = ?', item.branch_id);
      return roundGroup({ ...item, name: branch ? branch.name : 'Branch' });
    }),
    by_day: group('voucher_date').map(roundGroup),
    lines,
    access: voucherAccess(ctx.user),
  };
}

function roundGroup(item) {
  return { name: item.name || '—', count: item.count, amount: money(item.amount), paid: money(item.paid), balance: money(item.amount - item.paid) };
}
