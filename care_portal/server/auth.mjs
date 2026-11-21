import { LEVELS, MODULES } from './db.mjs';
import { HttpError } from './api.mjs';
import { erpRequest } from './erp.mjs';

const CACHE_MS = 60 * 1000;
const cache = new Map();

function allModules(level) {
  return Object.fromEntries(MODULES.map((m) => [m, level]));
}

/* Branch ids this login may use, from HRMS (Portal Access → Care Backend → Branches, else the employee's
   Unit / Centre). null = every branch (System Manager or "All branches"). */
function branchScope(perms) {
  if (perms.exempt) return null;
  const scope = perms.care_branches;
  if (!scope) return [];
  if (scope.all) return null;
  return [...new Set((scope.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

function idsOf(scope) {
  if (!scope) return [];
  if (scope.all) return null;
  return [...new Set((scope.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

function aesBranchScope(perms) {
  if (perms.exempt) return null;
  return idsOf(perms.aes_branches);
}

/* Settings access (or an Aesthetic Manager role when HRMS has no Aesthetic row) may see every branch. */
function isAestheticManager(perms, roles) {
  if (perms.exempt) return true;
  const own = perms.portal_modules && perms.portal_modules.aesthetics;
  if (own) {
    const level = own.Settings && own.Settings.level;
    return Boolean(level && level !== 'none');
  }
  return roles.includes('Aesthetic Manager');
}

/* Ops Approvals at Approve/Manage, or a Purchase / Operations manager, reviews clinic expense vouchers. */
function opsVoucherFlags(perms, roles) {
  if (perms.exempt) return { view: true, approve: true };
  const ops = perms.portal_modules && perms.portal_modules.ops;
  const level = (ops && ops.Approvals && ops.Approvals.level) || 'none';
  const rank = LEVELS.indexOf(level);
  const desk = roles.some((role) => /purchase manager|operations manager|system manager|administrator/i.test(String(role)));
  return {
    view: desk || rank >= LEVELS.indexOf('view'),
    approve: desk || rank >= LEVELS.indexOf('approve'),
  };
}

function roleLabel(perms, roles, flavor) {
  if (perms.exempt) return 'System Manager';
  if (flavor === 'aesthetic') return roles.includes('Aesthetic Manager') ? 'Aesthetic Manager' : 'Aesthetic Staff';
  if (roles.includes('Care Manager')) return 'Care Operations Manager';
  return 'Care Staff';
}

/* Smilecure CRM telecallers book Care / Aesthetic via the same APIs. If HR granted any CRM Backend
   module, allow Patients + Appointments create even when Care/Aesthetic rows are missing. */
function crmBookingGrant(perms) {
  if (perms.exempt) return true;
  const crm = perms.portal_modules && perms.portal_modules.crm;
  if (!crm || typeof crm !== 'object') return false;
  return Object.values(crm).some((mod) => {
    const level = mod && mod.level;
    return Boolean(level && level !== 'none' && LEVELS.includes(level));
  });
}

function bumpModule(modules, name, minLevel) {
  const have = modules[name] || 'none';
  if (have === 'none' || LEVELS.indexOf(have) < LEVELS.indexOf(minLevel)) modules[name] = minLevel;
}

/* The Aesthetic instance runs on Aesthetic Backend access: its modules stand in for the Care ones this engine checks. */
const AESTHETIC_MODULES = {
  Dashboard: 'Dashboard',
  Appointments: 'Services',
  Physiotherapy: 'Services',
  Patients: 'Services',
  /* Doctors & Cosmetologists sit under Services; Employees is not offered in Aesthetic Backend access. */
  Doctors: 'Services',
  'User & Access': 'Services',
  'Billing & Invoice': 'Invoices',
  'Branch Management': 'Branches',
  'Assets Management': 'Services',
  Settings: 'Settings',
};

/* Aesthetic-only modules checked under their own name (Ratings & Reviews lives under Bookings). */
const AESTHETIC_OWN = ['Bookings'];

function aestheticModules(perms, roles) {
  const own = perms.portal_modules && perms.portal_modules.aesthetics;
  return Object.fromEntries(
    [...MODULES, ...AESTHETIC_OWN].map((name) => {
      const source = AESTHETIC_MODULES[name] || (AESTHETIC_OWN.includes(name) ? name : null);
      if (!source) return [name, 'none'];
      if (own) {
        const level = own[source] && own[source].level;
        return [name, LEVELS.includes(level) ? level : 'none'];
      }
      if (roles.includes('Aesthetic Manager')) return [name, 'manage'];
      if (roles.includes('Aesthetic Staff')) return [name, ['Settings', 'Branch Management', 'User & Access'].includes(name) ? 'view' : 'edit'];
      return [name, 'none'];
    }),
  );
}

export async function resolveSession(cfg, sid) {
  if (cfg.devUser) {
    return { user: cfg.devUser, full_name: 'Local Developer', roles: ['System Manager'], exempt: true, role_label: 'System Manager', modules: { ...allModules('manage'), Bookings: 'manage' }, branches: null, branch_source: 'admin', unit: '', aes_manager: true };
  }
  if (!sid || !/^[A-Za-z0-9]{8,128}$/.test(sid)) throw new HttpError(401, 'Please sign in');
  const hit = cache.get(sid);
  if (hit && hit.until > Date.now()) return hit.value;

  let res;
  try {
    res = await erpRequest(cfg, 'clinical_people_access.get_my_portal_permissions', { form: { sid }, sid });
  } catch {
    throw new HttpError(502, 'Could not reach the staff login service');
  }
  const m = res.message;
  if (res.status === 401 || res.status === 403 || (m && m.status === 'error')) {
    cache.delete(sid);
    throw new HttpError(401, 'Your session has ended. Please sign in again.');
  }
  if (res.status >= 400 || !m) throw new HttpError(502, 'Staff login service returned an error');
  const perms = res.data;
  const roles = Array.isArray(perms.roles) ? perms.roles : [];

  const aesthetic = cfg.flavor === 'aesthetic';
  const crmGrant = crmBookingGrant(perms);
  let modules;
  if (perms.exempt) modules = aesthetic ? { ...allModules('manage'), ...Object.fromEntries(AESTHETIC_OWN.map((m) => [m, 'manage'])) } : allModules('manage');
  else if (aesthetic) modules = aestheticModules(perms, roles);
  else {
    const care = (perms.portal_modules && perms.portal_modules.care) || {};
    modules = Object.fromEntries(MODULES.map((name) => {
      const level = care[name] && care[name].level;
      return [name, LEVELS.includes(level) ? level : 'none'];
    }));
  }
  if (crmGrant) {
    bumpModule(modules, 'Patients', 'create');
    bumpModule(modules, 'Appointments', 'create');
    if (aesthetic) bumpModule(modules, 'Bookings', 'create');
  }
  const aes = perms.aes_branches;
  const care = perms.care_branches;
  const aesManager = aesthetic && isAestheticManager(perms, roles);
  const opsFlags = opsVoucherFlags(perms, roles);
  let branches = aesthetic ? aesBranchScope(perms) : branchScope(perms);
  let branchSource = perms.exempt ? 'admin' : ((aesthetic ? aes : care) && (aesthetic ? aes : care).source) || 'none';
  /* CRM telecallers often have no Care/Aesthetic branch row — let them book any active branch. */
  if (crmGrant && Array.isArray(branches) && branches.length === 0) {
    branches = null;
    branchSource = 'crm';
  }
  const value = {
    user: perms.user,
    full_name: perms.full_name || perms.user,
    roles,
    exempt: Boolean(perms.exempt),
    role_label: roleLabel(perms, roles, cfg.flavor),
    modules,
    branches,
    branch_source: branchSource,
    unit: ((aesthetic ? aes : care) && (aesthetic ? aes : care).unit) || '',
    aes_manager: aesManager,
    crm_booker: Boolean(crmGrant),
    ops_voucher_view: opsFlags.view,
    ops_approver: opsFlags.approve,
  };
  cache.set(sid, { until: Date.now() + CACHE_MS, value });
  if (cache.size > 2000) {
    for (const [key, entry] of cache) if (entry.until < Date.now()) cache.delete(key);
  }
  return value;
}

export function forgetSession(sid) {
  cache.delete(sid);
}

export function hasLevel(session, module, level = 'view') {
  const have = session.modules[module] || 'none';
  return LEVELS.indexOf(have) >= LEVELS.indexOf(level) && have !== 'none';
}

export function hasAnyAccess(session) {
  return Object.values(session.modules).some((level) => level !== 'none');
}

/* Edit bill: Care / Aesthetic managers with every branch (Portal Access “All branches”, or System Manager). */
export function canReviseBill(session) {
  if (session.branches != null) return false;
  if (session.exempt || session.aes_manager) return true;
  const roles = Array.isArray(session.roles) ? session.roles : [];
  if (roles.some((role) => /care manager|aesthetic manager|system manager|administrator/i.test(String(role)))) return true;
  return /manager/i.test(String(session.role_label || ''));
}

function matchUnitBranch(db, unit) {
  const text = String(unit || '').trim().toLowerCase();
  if (!text) return null;
  const rows = db.prepare('SELECT id, name FROM branches WHERE active = 1').all();
  const hit = rows.find((b) => {
    const name = String(b.name || '').trim().toLowerCase();
    if (!name) return false;
    return text === name || text.endsWith(` - ${name}`) || text.endsWith(` ${name}`) || name.endsWith(` ${text}`) || text.includes(name) || name.includes(text);
  });
  return hit ? hit.id : null;
}

/* Aesthetic console: Settings access sees every branch; everyone else is pinned to the HRMS
   assigned branch or the branch of their Unit / Centre. Future branches come from the live table. */
export function applyAestheticBranchScope(session, db) {
  session.flavor = 'aesthetic';
  const manager = Boolean(session.exempt || session.aes_manager);
  const crmAllBranches = Boolean(session.crm_booker) && session.branches === null;
  session.branch_picker = { all_option: manager || crmAllBranches, locked: !(manager || crmAllBranches) };
  session.aes_manager = manager;
  if (manager || session.branches === null) {
    session.branches = null;
    if (!session.branch_source || session.branch_source === 'none') {
      session.branch_source = session.exempt ? 'admin' : manager ? 'settings' : session.crm_booker ? 'crm' : 'settings';
    }
    return session;
  }
  let ids = Array.isArray(session.branches)
    ? session.branches.filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (!ids.length) {
    const unitId = matchUnitBranch(db, session.unit);
    if (unitId) {
      ids = [unitId];
      session.branch_source = 'unit';
    }
  }
  session.branches = ids;
  return session;
}
