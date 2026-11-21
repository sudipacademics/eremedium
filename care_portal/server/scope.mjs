/* Branch-based access. HRMS decides which branches a login may use (Portal Access → Care Backend → Branches,
   else the branch of the employee's Unit / Centre); every request is held to those branches here, whatever
   the browser sends. */
import { HttpError } from './api.mjs';

/* Records reached by id in the URL, and the table that holds their branch. */
const ID_ROUTES = [
  [/^\/patients\/(\d+)/, 'patients'],
  [/^\/appointments\/(\d+)/, 'appointments'],
  [/^\/plans\/(\d+)/, 'therapy_plans'],
  [/^\/invoices\/(\d+)/, 'invoices'],
  [/^\/session-bills\/(\d+)/, 'session_bills'],
  [/^\/items\/(\d+)/, 'items'],
  [/^\/assets\/(\d+)/, 'assets'],
  [/^\/doctors\/(\d+)/, 'practitioners'],
  [/^\/practitioners\/(\d+)/, 'practitioners'],
  [/^\/lab\/bookings\/(\d+)/, 'lab_bookings'],
  [/^\/branches\/(\d+)/, 'branches'],
  [/^\/vouchers\/(\d+)/, 'vouchers'],
];

/* Record ids a request body may point at. */
const BODY_REFS = {
  patient_id: 'patients',
  appointment_id: 'appointments',
  plan_id: 'therapy_plans',
  invoice_id: 'invoices',
  package_invoice_id: 'invoices',
  item_id: 'items',
  asset_id: 'assets',
  practitioner_id: 'practitioners',
};

/* Company-wide actions, left to logins that may use every branch. */
const ALL_BRANCH_ONLY = [
  ['POST', /^\/branches$/],
  ['PUT', /^\/settings$/],
  ['POST', /^\/settings\/clear-sample-data$/],
  ['GET', /^\/activity$/],
];

/* Active branches the session may use, or null for every branch. */
export function activeScope(db, session) {
  if (session.branches === null || session.branches === undefined) return null;
  const active = new Set(db.prepare('SELECT id FROM branches WHERE active = 1').all().map((r) => r.id));
  return session.branches.filter((id) => active.has(id));
}

function inScope(db, scope, table, id) {
  const col = table === 'branches' ? 'id' : 'branch_id';
  const rec = db.prepare(`SELECT ${col} AS b FROM ${table} WHERE id = ?`).get(Number(id));
  if (!rec) return true;
  return rec.b == null || scope.includes(Number(rec.b));
}

/* Runs before every handler. Pins the working branch (ctx.q.branch) to an allowed one and refuses records,
   references and actions outside the session's branches. */
export function enforceBranchScope(ctx, method, path, scope) {
  const voucherDesk = path.startsWith('/vouchers') || path.startsWith('/voucher-categories');
  if (voucherDesk && ctx.user && (ctx.user.ops_approver || ctx.user.ops_voucher_view)) {
    const want = Number(ctx.q.branch);
    ctx.q.branch = want > 0 ? String(want) : '';
    return;
  }
  if (scope === null) return;
  if (!scope.length) {
    throw new HttpError(
      403,
      ctx.user && ctx.user.flavor === 'aesthetic'
        ? 'No Aesthetic branch is assigned to you in HRMS. Ask HR to set your Unit / Centre or your Aesthetic branches.'
        : 'No Remedium Care branch is assigned to you in HRMS. Ask HR to set your Unit / Centre or your Care branches.',
    );
  }
  if (ALL_BRANCH_ONLY.some(([m, re]) => m === method && re.test(path))) {
    throw new HttpError(403, 'Only staff with access to every branch can do this');
  }
  const want = Number(ctx.q.branch);
  ctx.q.branch = String(scope.includes(want) ? want : scope[0]);

  for (const [re, table] of ID_ROUTES) {
    const m = re.exec(path);
    if (m && !inScope(ctx.db, scope, table, m[1])) throw new HttpError(404, 'Not found in your branch');
  }
  for (const [key, table] of Object.entries(BODY_REFS)) {
    const v = Number(ctx.body[key]);
    if (v > 0 && !inScope(ctx.db, scope, table, v)) throw new HttpError(403, 'That record belongs to another branch');
  }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const hasBranch = Object.prototype.hasOwnProperty.call(ctx.body, 'branch_id');
    if (hasBranch ? !scope.includes(Number(ctx.body.branch_id)) : method === 'POST') ctx.body.branch_id = Number(ctx.q.branch);
  }
}

/* Trims responses that list branches or staff of every branch. */
export function scopeResponse(method, path, data, scope) {
  if (scope === null || !data) return data;
  const mine = (id) => id == null || scope.includes(Number(id));
  if (path === '/meta') {
    return {
      ...data,
      branches: (data.branches || []).filter((b) => scope.includes(b.id)),
      practitioners: (data.practitioners || []).filter((p) => mine(p.branch_id)),
    };
  }
  if (path === '/branches' && method === 'GET' && Array.isArray(data)) return data.filter((b) => scope.includes(b.id));
  return data;
}
