import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { seedDemo, seedMasters } from './seed.mjs';
import * as api from './api.mjs';
import { applyAestheticBranchScope, canReviseBill, forgetSession, hasAnyAccess, hasLevel, resolveSession } from './auth.mjs';
import { activeScope, enforceBranchScope, scopeResponse } from './scope.mjs';
import { fetchAestheticCatalog, fetchCareCatalog, fetchLabCatalog } from './erp.mjs';
import * as lab from './lab.mjs';
import * as pharmacy from './pharmacy.mjs';
import * as feedback from './feedback.mjs';
import * as vouchers from './vouchers.mjs';
import * as aesDashboard from './aes-dashboard.mjs';

const cfg = {
  host: process.env.CARE_HOST || '127.0.0.1',
  port: Number(process.env.CARE_PORT || 8095),
  dbFile: process.env.CARE_DB || fileURLToPath(new URL('../data/care.db', import.meta.url)),
  erpUrl: process.env.CARE_ERP_URL || 'http://127.0.0.1:8080',
  erpHost: process.env.CARE_ERP_HOST || 'www.remediumlabs.in',
  erpSite: process.env.CARE_ERP_SITE || 'health.localhost',
  devUser: process.env.CARE_DEV_USER || '',
  seedDemo: process.env.CARE_SEED_DEMO !== '0',
  labSync: process.env.CARE_LAB_SYNC !== '0',
  /* 'aesthetic' runs this engine for the Remedium Aesthetic console (own database, Aesthetic Backend access). */
  flavor: process.env.CARE_FLAVOR === 'aesthetic' ? 'aesthetic' : 'care',
};
const AESTHETIC = cfg.flavor === 'aesthetic';

const db = openDb(cfg.dbFile);
if (seedMasters(db, cfg.flavor) && cfg.seedDemo && !AESTHETIC) seedDemo(db);
const backfilled = api.backfillSessionBills(db);
if (backfilled) console.log(`issued ${backfilled} session invoice(s) for completed package sessions`);
if (!AESTHETIC) {
  const redated = api.redateVisitInvoices(db);
  if (redated) console.log(`dated ${redated} consultation invoice(s) on the visit day`);
}
if (AESTHETIC) {
  const missing = feedback.ensureRequests(db);
  if (missing) console.log(`added ${missing} feedback request(s) for sessions completed earlier`);
  vouchers.ensure(db);
}

const P = 'Patients';
const A = 'Appointments';
const L = 'Test & Lab';
const B = 'Billing & Invoice';
const PH = 'Pharmacy';
const I = 'Inventory Management';
const BR = 'Branch Management';
const R = 'Reports & Analytics';
const AS = 'Assets Management';
const U = 'User & Access';
const S = 'Settings';
const D = 'Diagnostics';
const DR = 'Doctors';
const PT = 'Physiotherapy';
const BK = 'Bookings';
/* Price-list edits: physiotherapy items belong to the Physiotherapy module, lab items to Test & Lab, the rest to Settings. */
const serviceModule = (category) => (category === 'physiotherapy' ? [PT, S] : category === 'lab' ? [L, S] : S);
const moduleForType = (type) => (type === 'lab' ? L : type === 'diagnostic' ? D : A);

/* [method, path, module(s) — any one grants access, minimum level, handler] */
const ROUTES = [
  ['GET', '/meta', null, 'view', api.meta],
  ['GET', '/dashboard', 'Dashboard', 'view', api.dashboard],
  ['GET', '/alerts', null, 'view', api.alerts],
  ['GET', '/search', null, 'view', api.search],
  /* Smilecure CRM pulls paid tagged invoices when ERP sales-close rows are missing. */
  ['GET', '/crm-bill-closes', [A, B, P, BK], 'view', api.listCrmBillCloses],

  ['GET', '/patients', AESTHETIC ? [P, A, L, D, B, PH, BK] : [P, A, L, D, B, PH], 'view', api.listPatients],
  ['POST', '/patients', AESTHETIC ? [P, A, L, D, B, PH, BK] : [P, A, L, D, B, PH], 'create', api.createPatient],
  ['GET', '/patients/:id', AESTHETIC ? [P, A, L, D, B, BK] : [P, A, L, D, B], 'view', api.getPatient],
  ['PATCH', '/patients/:id', AESTHETIC ? [P, BK] : P, 'edit', api.updatePatient],

  ['GET', '/appointments', [A, L, D], 'view', api.listAppointments],
  ['POST', '/appointments', [A, L, D], 'create', (ctx) => {
    ctx.need(moduleForType(ctx.body.type), 'create');
    return api.createAppointment(ctx);
  }],
  ['PATCH', '/appointments/:id', [A, L, D], 'edit', (ctx) => {
    const current = ctx.db.prepare('SELECT type FROM appointments WHERE id = ?').get(Number(ctx.params.id));
    ctx.need(moduleForType(current?.type), 'edit');
    const updated = api.updateAppointment(ctx);
    if (AESTHETIC) feedback.afterAppointment(ctx, updated);
    return updated;
  }],

  ['GET', '/plans', A, 'view', api.listPlans],
  ['POST', '/plans', A, 'create', api.createPlan],
  ['GET', '/plans/referrers', A, 'view', api.listReferrers],
  ['GET', '/plans/:id', A, 'view', api.getPlan],
  ['PATCH', '/plans/:id', A, 'edit', api.updatePlan],
  ['POST', '/appointments/:id/session-bill', [A, B], 'edit', (ctx) => {
    if (Number(ctx.body.paid) > 0) ctx.need(B, 'edit');
    return api.sessionBillForAppointment(ctx);
  }],
  ['GET', '/session-bills', [B, A], 'view', api.listSessionBills],
  ['GET', '/session-bills/:id', [B, A, P], 'view', api.getSessionBill],
  ['POST', '/plans/:id/package-billing', A, 'edit', (ctx) => {
    ctx.need(B, 'create');
    return api.billPlanAsPackage(ctx);
  }],

  ['GET', '/invoices', [B, PH], 'view', api.listInvoices],
  ['POST', '/invoices', [B, PH], 'create', (ctx) => {
    ctx.need(ctx.body.service_type === 'pharmacy' ? [PH, B] : B, 'create');
    return ctx.body.service_type === 'pharmacy' ? pharmacy.createPharmacyInvoice(ctx) : api.createInvoice(ctx);
  }],
  ['GET', '/invoices/:id', [B, PH, P], 'view', api.getInvoice],
  ['POST', '/invoices/:id/adjust-session', [B, PH], 'edit', api.adjustSessionPayment],
  ['POST', '/invoices/:id/refund', [B, PH], 'edit', api.refundAdvance],
  ['POST', '/invoices/:id/payments', [B, PH], 'edit', (ctx) => {
    const invoice = ctx.db.prepare('SELECT id, trf_id FROM invoices WHERE id = ?').get(Number(ctx.params.id));
    return invoice?.trf_id ? lab.payLabInvoice(ctx, invoice) : api.addPayment(ctx);
  }],

  ['GET', '/lab/bookings', [L, B], 'view', lab.listLab],
  ['POST', '/lab/bookings', L, 'create', lab.bookLab],
  ['POST', '/lab/quote', L, 'view', lab.quoteLab],
  ['GET', '/lab/bookings/:id', [L, B], 'view', lab.getLab],
  ['POST', '/lab/bookings/:id/payments', [B, L], 'create', (ctx) => lab.payLab(ctx)],
  ['GET', '/lab/bookings/:id/report', [L, B], 'view', lab.labReport],
  ['POST', '/invoices/:id/items', [B, PH], 'approve', (ctx) => {
    if (!canReviseBill(ctx.user)) throw new api.HttpError(403, 'Only a manager with access to every branch can edit a bill');
    const invoice = ctx.db.prepare('SELECT service_type, trf_id FROM invoices WHERE id = ?').get(Number(ctx.params.id));
    ctx.need(invoice?.service_type === 'pharmacy' ? [PH, B] : B, 'approve');
    return invoice?.trf_id ? lab.reviseLabInvoice(ctx) : api.reviseInvoice(ctx);
  }],
  ['POST', '/invoices/:id/cancel', [B, PH], 'approve', pharmacy.cancelPharmacyInvoice],

  ['GET', '/pharmacy/board', PH, 'view', pharmacy.board],
  ['GET', '/pharmacy/sellable', [PH, B], 'view', pharmacy.sellable],
  ['GET', '/pharmacy/ledger', PH, 'view', pharmacy.ledger],
  ['GET', '/pharmacy/challan', PH, 'view', pharmacy.challan],
  ['POST', '/pharmacy/requisitions', PH, 'create', pharmacy.requisition],
  ['POST', '/pharmacy/requisitions/cancel', PH, 'create', pharmacy.cancel],
  ['POST', '/pharmacy/receive', PH, 'create', pharmacy.receive],
  ['POST', '/pharmacy/returns', PH, 'create', pharmacy.stockReturn],
  ['POST', '/pharmacy/adjustments', PH, 'create', pharmacy.adjustment],
  ['POST', '/pharmacy/external', PH, 'create', pharmacy.externalRequest],
  ['POST', '/pharmacy/external/cancel', PH, 'create', pharmacy.externalCancel],
  ['POST', '/pharmacy/external/receive', PH, 'create', pharmacy.externalReceive],

  ['GET', '/items', [I, PH], 'view', api.listItems],
  ['POST', '/items', I, 'create', api.createItem],
  ['PATCH', '/items/:id', I, 'edit', api.updateItem],
  ['POST', '/items/:id/stock', [I, PH], 'edit', api.moveStock],
  ['GET', '/items/:id/moves', [I, PH], 'view', api.itemMoves],

  ['GET', '/branches', BR, 'view', api.listBranches],
  ['POST', '/branches', BR, 'create', api.createBranch],
  ['PATCH', '/branches/:id', BR, 'edit', api.updateBranch],
  ['GET', '/branches/:id/settings', [S, BR], 'view', api.readBranchConfig],
  ['PUT', '/branches/:id/settings', [S, BR], 'edit', api.saveBranchConfig],

  ['GET', '/doctors', [DR, A, B], 'view', api.listDoctors],
  ['GET', '/doctors/check', [DR, A, B], 'view', api.checkDoctor],
  ['POST', '/doctors', DR, 'create', api.createDoctor],
  ['PATCH', '/doctors/:id', DR, 'edit', api.updateDoctor],

  ['GET', '/practitioners', [U, BR], 'view', api.listPractitioners],
  ['POST', '/practitioners', U, 'create', api.createPractitioner],
  ['PATCH', '/practitioners/:id', U, 'edit', api.updatePractitioner],

  ['GET', '/services', [S, L, D, A, B, PT], 'view', api.listServices],
  ['POST', '/services', [S, L, PT], 'create', (ctx) => {
    ctx.need(serviceModule(ctx.body.category), 'create');
    return api.createService(ctx);
  }],
  ['PATCH', '/services/:id', [S, L, PT], 'edit', (ctx) => {
    const current = ctx.db.prepare('SELECT category FROM services WHERE id = ?').get(Number(ctx.params.id));
    ctx.need(serviceModule(current?.category), 'edit');
    return api.updateService(ctx);
  }],

  ['GET', '/physio/packages', [PT, A, B], 'view', api.listPackages],
  ['POST', '/physio/packages', PT, 'create', api.createPackage],
  ['PATCH', '/physio/packages/:id', PT, 'edit', api.updatePackage],
  ['POST', '/services/import-lab', [S, L], 'manage', api.importLabTests],
  ['POST', '/services/import-care', AESTHETIC ? [S, PT] : [S, D], 'manage', AESTHETIC ? api.importAestheticCatalog : api.importCareCatalog],
  ['POST', '/diagnostics/tests', D, 'create', (ctx) => {
    if (ctx.body.code) ctx.need(D, 'edit');
    return api.saveDiagnostic(ctx);
  }],

  ['GET', '/assets', AS, 'view', api.listAssets],
  ['POST', '/assets', AS, 'create', api.createAsset],
  ['PATCH', '/assets/:id', AS, 'edit', api.updateAsset],
  ['POST', '/assets/:id/service', AS, 'edit', api.serviceAsset],
  ['GET', '/assets/:id/logs', AS, 'view', api.assetLogs],

  ['GET', '/reports', R, 'view', api.reports],

  ['GET', '/settings', S, 'view', api.readSettings],
  ['PUT', '/settings', S, 'manage', api.saveSettings],
  ['GET', '/activity', [S, U], 'view', api.activity],
  ['POST', '/settings/clear-sample-data', S, 'manage', api.removeSampleData],

  ...(AESTHETIC
    ? [
        ['GET', '/feedback/summary', [BK, A], 'view', feedback.feedbackSummary],
        ['GET', '/feedback/reviews', [BK, A], 'view', feedback.listReviews],
        ['GET', '/feedback/reviews/:id', [BK, A], 'view', feedback.getReview],
        ['POST', '/feedback/reviews/:id/status', BK, 'edit', feedback.moderateReview],
        ['GET', '/feedback/requests', [BK, A], 'view', feedback.listRequests],
        ['POST', '/feedback/requests/:id/send', [BK, A], 'edit', feedback.sendRequest],
        ['POST', '/feedback/requests/:id/link', [BK, A], 'edit', feedback.copyLink],
        ['GET', '/feedback/settings', [BK, A, S], 'view', feedback.readSettings],
        ['PUT', '/feedback/settings', [BK, S], 'edit', feedback.saveSettings],
        ['GET', '/feedback/delivery', [BK, A], 'view', feedback.deliveryStatus],
        ['GET', '/voucher-categories', null, 'view', vouchers.listCategories],
        ['POST', '/voucher-categories', null, 'view', vouchers.saveCategory],
        ['PATCH', '/voucher-categories/:id', null, 'view', vouchers.updateCategory],
        ['GET', '/vouchers', null, 'view', vouchers.listVouchers],
        ['GET', '/vouchers/report', null, 'view', vouchers.report],
        ['POST', '/vouchers', null, 'view', vouchers.createVoucher],
        ['GET', '/vouchers/:id', null, 'view', vouchers.getVoucher],
        ['PATCH', '/vouchers/:id', null, 'view', vouchers.updateVoucher],
        ['POST', '/vouchers/:id/cancel', null, 'view', vouchers.cancelVoucher],
        ['POST', '/vouchers/:id/decision', null, 'view', vouchers.decideVoucher],
        ['POST', '/vouchers/:id/payments', null, 'view', vouchers.addPayment],
        ['GET', '/vouchers/:id/files/:fid', null, 'view', vouchers.fileBody],
        ['GET', '/aes-dashboard', 'Dashboard', 'view', aesDashboard.dashboard],
      ]
    : []),
].map(([method, path, modules, level, handler]) => {
  const keys = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '(\\d+)'; })}$`);
  return { method, pattern, keys, modules: modules == null ? null : [].concat(modules), level, handler };
});

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readBody(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new api.HttpError(413, 'Request is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new api.HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://care.local');
  const path = url.pathname.replace(/^\/care-api/, '') || '/';
  const sid = req.headers['x-care-sid'] ? String(req.headers['x-care-sid']) : '';

  if (path === '/health') return send(res, 200, { ok: true });

  /* Branch names only, read by HRMS so HR can assign staff to branches (new branches appear automatically). */
  if (path === '/branch-directory' && req.method === 'GET') {
    return send(res, 200, { data: db.prepare('SELECT id, name, code, city, active FROM branches ORDER BY name').all() });
  }

  /* Patient feedback links: no sign-in, the link token is the only key. */
  if (AESTHETIC && path.startsWith('/public/feedback/')) {
    const token = path.slice('/public/feedback/'.length);
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
    if (req.method === 'GET') {
      feedback.throttle(ip, 'view', 60);
      return send(res, 200, { data: feedback.publicView(db, token) });
    }
    if (req.method === 'POST') {
      feedback.throttle(ip, 'submit', 12);
      const body = await readBody(req, 16 * 1024);
      return send(res, 201, { data: feedback.publicSubmit(db, token, body) });
    }
    throw new api.HttpError(405, 'Method not allowed');
  }

  if (path === '/logout' && req.method === 'POST') {
    forgetSession(sid);
    return send(res, 200, { ok: true });
  }

  const session = await resolveSession(cfg, sid);
  if (AESTHETIC) applyAestheticBranchScope(session, db);
  const scope = activeScope(db, session);
  if (path === '/me' && req.method === 'GET') {
    if (!hasAnyAccess(session)) throw new api.HttpError(403, 'No access to the Care portal');
    const names = db.prepare('SELECT id, name FROM branches WHERE active = 1 ORDER BY name').all();
    const branchNames = scope === null ? names : names.filter((b) => scope.includes(b.id));
    return send(res, 200, {
      data: {
        ...session,
        branches: scope,
        branch_names: branchNames,
        branch_picker: session.branch_picker || { all_option: scope === null, locked: scope !== null },
      },
    });
  }
  const voucherPath = path.startsWith('/vouchers') || path.startsWith('/voucher-categories');
  if (!hasAnyAccess(session) && !(voucherPath && (session.ops_voucher_view || session.ops_approver))) {
    throw new api.HttpError(403, 'No access to the Care portal');
  }

  let matched = false;
  for (const route of ROUTES) {
    const m = route.pattern.exec(path);
    if (!m) continue;
    matched = true;
    if (route.method !== req.method) continue;
    const need = (modules, level) => {
      const list = [].concat(modules);
      if (!list.some((mod) => hasLevel(session, mod, level))) {
        throw new api.HttpError(403, `You need ${level} access to ${list.join(' or ')}`);
      }
    };
    if (route.modules) need(route.modules, route.level);
    const params = Object.fromEntries(route.keys.map((key, i) => [key, m[i + 1]]));
    const bodyLimit = path.startsWith('/vouchers') ? 8 * 1024 * 1024 : 1024 * 1024;
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req, bodyLimit) : {};
    const ctx = {
      db,
      cfg,
      sid,
      q: Object.fromEntries(url.searchParams),
      body,
      params,
      user: session,
      need,
      can: (mod, level = 'view') => hasLevel(session, mod, level),
      scope,
    };
    enforceBranchScope(ctx, req.method, path, scope);
    const data = scopeResponse(req.method, path, await route.handler(ctx), scope);
    if (data && data.raw && Buffer.isBuffer(data.raw.body)) {
      res.writeHead(200, {
        'Content-Type': data.raw.type,
        'Content-Disposition': `inline; filename="${String(data.raw.filename).replace(/[^\w.\- ]/g, '_')}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(data.raw.body);
    }
    return send(res, req.method === 'POST' ? 201 : 200, { data });
  }
  throw new api.HttpError(matched ? 405 : 404, matched ? 'Method not allowed' : 'Not found');
}

/* The clinic console calendar reads treatment-plan sessions from this API. */
const CONSOLE_ORIGINS = new Set(['https://aesthetics.e-remedium.in', 'https://ops.e-remedium.in', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5182', 'http://localhost:5182']);

/* The public site's feedback page (remediumaesthetics.in/feedback/<token>) reads and answers its link here. */
const FEEDBACK_ORIGINS = new Set(['https://remediumaesthetics.in', 'http://127.0.0.1:5180', 'http://localhost:5180']);

function allowConsole(req, res) {
  if (!AESTHETIC) return false;
  const origin = String(req.headers.origin || '');
  if (FEEDBACK_ORIGINS.has(origin) && /^\/(care-api\/)?public\/feedback\//.test(String(req.url))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }
    return false;
  }
  if (!CONSOLE_ORIGINS.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Care-Sid');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  if (allowConsole(req, res)) return;
  handle(req, res).catch((err) => {
    const status = err instanceof api.HttpError ? err.status : 500;
    if (status === 500) console.error(new Date().toISOString(), req.method, req.url, err);
    send(res, status, { error: status === 500 ? 'Something went wrong on the server' : err.message });
  });
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`Remedium ${AESTHETIC ? 'Aesthetic sessions' : 'Care'} API on http://${cfg.host}:${cfg.port} (db ${cfg.dbFile})`);
});

/* Keep the lab test master and the care catalogue (diagnostics, physiotherapy, consultation) in step with the
   main ERP: once a day, and at start-up for any catalogue never imported. */
const DAY_MS = 24 * 60 * 60 * 1000;
const CATALOGS = AESTHETIC
  ? [{ key: 'aesthetic_catalog', label: 'aesthetic treatments', run: async () => api.applyAestheticCatalog(db, await fetchAestheticCatalog(cfg), 'auto-sync') }]
  : [
      { key: 'lab_catalog', label: 'lab catalogue', run: async () => api.applyLabCatalog(db, await fetchLabCatalog(cfg), 'auto-sync') },
      { key: 'care_catalog', label: 'care catalogue', run: async () => api.applyCareCatalog(db, await fetchCareCatalog(cfg), 'auto-sync') },
    ];
async function syncCatalog(c) {
  try {
    console.log(new Date().toISOString(), `${c.label} synced`, JSON.stringify(await c.run()));
  } catch (err) {
    console.error(new Date().toISOString(), `${c.label} sync failed:`, err.message);
  }
}
if (cfg.labSync) {
  for (const c of CATALOGS) {
    const last = db.prepare('SELECT value FROM settings WHERE key = ?').get(`${c.key}_synced_at`);
    if (!last) setTimeout(() => syncCatalog(c), 5000);
    setInterval(() => syncCatalog(c), DAY_MS).unref();
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
