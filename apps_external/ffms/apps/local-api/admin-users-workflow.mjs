import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const ADMIN_USER_ROLES = ['super_admin', 'manager', 'crm', 'business_consultant', 'advocate', 'accountant'];
export const ADMIN_USER_STATUSES = ['active', 'inactive'];

export const ADMIN_PAGES = [
  'Overview',
  'Leads',
  'Log Visit',
  'Appointments',
  'Applicants',
  'Territory',
  'Video KYC',
  'Agreements',
  'Payments',
  'Training',
  'Franchisee Webpage Index',
  'Franchisee Directory',
  'Support',
  'Content CMS',
  'User Management',
];

export const ADMIN_PERMISSIONS = {
  overview: ['super_admin', 'manager', 'crm', 'business_consultant', 'advocate', 'accountant'],
  leads: ['super_admin', 'manager', 'crm'],
  appointments: ['super_admin', 'manager', 'business_consultant'],
  applicants: ['super_admin', 'manager'],
  territory: ['super_admin', 'manager'],
  video_kyc: ['super_admin', 'manager'],
  agreements: ['super_admin', 'manager', 'advocate'],
  payments: ['super_admin', 'manager', 'accountant'],
  training: ['super_admin', 'manager'],
  franchise_webpages: ['super_admin', 'manager'],
  franchisee_directory: ['super_admin', 'manager'],
  franchisee_directory_api: ['super_admin'],
  support: ['super_admin', 'manager'],
  support_settings: ['super_admin'],
  content_cms: ['super_admin'],
  user_management: ['super_admin'],
  audit_log: ['super_admin'],
  crm_team: ['super_admin', 'manager'],
  appointment_team: ['super_admin', 'manager'],
};

export const PAGE_PERMISSION = {
  Overview: 'overview',
  Leads: 'leads',
  'Log Visit': 'leads',
  Appointments: 'appointments',
  Applicants: 'applicants',
  Territory: 'territory',
  'Video KYC': 'video_kyc',
  Agreements: 'agreements',
  Payments: 'payments',
  Training: 'training',
  'Franchisee Webpage Index': 'franchise_webpages',
  'Franchisee Directory': 'franchisee_directory',
  Support: 'support',
  'Content CMS': 'content_cms',
  'User Management': 'user_management',
};

const LEGACY_ROLE_MAP = {
  franchise_manager: 'manager',
  franchise_officer: 'crm',
};

export function normalizeRole(role) {
  const value = String(role ?? '').trim();
  return LEGACY_ROLE_MAP[value] ?? value;
}

export function roleHasPermission(role, permission) {
  const normalized = normalizeRole(role);
  const allowed = ADMIN_PERMISSIONS[permission];
  return Array.isArray(allowed) && allowed.includes(normalized);
}

export function pagesForRole(role) {
  return ADMIN_PAGES.filter((page) => roleHasPermission(normalizeRole(role), PAGE_PERMISSION[page]));
}

export function passwordDetails(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 8 || password.length > 128) return null;
  const salt = randomUUID().replace(/-/g, '');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

export function passwordMatches(record, value) {
  if (!record?.password_salt || !record?.password_hash || typeof value !== 'string') return false;
  const saved = Buffer.from(record.password_hash, 'hex');
  const candidate = scryptSync(value, record.password_salt, 64);
  return saved.length === candidate.length && timingSafeEqual(saved, candidate);
}

export function officerUserRecord(value, id = randomUUID()) {
  const source = value && typeof value === 'object' ? value : {};
  const role = normalizeRole(source.role);
  const status = ADMIN_USER_STATUSES.includes(source.status) ? source.status : 'active';
  return {
    id: String(source.id ?? id),
    employee_id: String(source.employee_id ?? '').trim(),
    name: String(source.name ?? '').trim(),
    email: String(source.email ?? '').trim().toLowerCase(),
    mobile: String(source.mobile ?? '').replace(/\D/g, '').slice(0, 15),
    role: ADMIN_USER_ROLES.includes(role) ? role : 'crm',
    password_salt: String(source.password_salt ?? ''),
    password_hash: String(source.password_hash ?? ''),
    status,
    created_at: String(source.created_at ?? new Date().toISOString()),
    updated_at: String(source.updated_at ?? source.created_at ?? new Date().toISOString()),
    last_login_at: String(source.last_login_at ?? ''),
  };
}

export function officerUserSummary(user) {
  return {
    id: user.id,
    employee_id: user.employee_id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_login_at: user.last_login_at,
  };
}

/** Company ID format: RFMS-0001, RFMS-0012, … */
export function isValidOfficerEmployeeId(value) {
  return /^RFMS-\d{4,}$/i.test(String(value ?? '').trim());
}

/** Next unused RFMS-NNNN from existing officers (starts at RFMS-0008 after seed range). */
export function nextOfficerEmployeeId(officers = []) {
  let highest = 0;
  for (const item of Array.isArray(officers) ? officers : []) {
    const match = String(item?.employee_id ?? '').trim().toUpperCase().match(/^RFMS-(\d+)$/);
    if (!match) continue;
    highest = Math.max(highest, Number(match[1]) || 0);
  }
  // Keep seed RFMS-0001…0007 free of accidental collision when allocating for staff.
  const next = Math.max(highest + 1, 8);
  return `RFMS-${String(next).padStart(4, '0')}`;
}

export function createOfficerUser(input, officers = []) {
  const now = new Date().toISOString();
  const role = normalizeRole(input.role);
  if (!ADMIN_USER_ROLES.includes(role)) throw new Error('Choose a valid user role.');
  const email = String(input.email ?? '').trim().toLowerCase();
  const requestedId = String(input.employee_id ?? '').trim().toUpperCase();
  const employeeId = requestedId || nextOfficerEmployeeId(officers);
  const name = String(input.name ?? '').trim();
  const mobile = String(input.mobile ?? '').replace(/\D/g, '').slice(0, 15);
  if (!name || !email || !mobile) throw new Error('Enter name, email and mobile number.');
  if (!isValidOfficerEmployeeId(employeeId)) throw new Error('Company ID must look like RFMS-0008.');
  if (officers.some((item) => item.email === email)) throw new Error('An admin user with this email already exists.');
  if (officers.some((item) => item.employee_id.toLowerCase() === employeeId.toLowerCase())) throw new Error('An admin user with this company ID already exists.');
  const password = passwordDetails(input.password);
  if (!password) throw new Error('Choose a password between 8 and 128 characters.');
  return officerUserRecord({
    employee_id: employeeId,
    name,
    email,
    mobile,
    role,
    status: ADMIN_USER_STATUSES.includes(input.status) ? input.status : 'active',
    password_salt: password.salt,
    password_hash: password.hash,
    created_at: now,
    updated_at: now,
  });
}

export function updateOfficerUser(user, input, officers = []) {
  const next = { ...user };
  if (input.name !== undefined) next.name = String(input.name ?? '').trim();
  if (input.email !== undefined) next.email = String(input.email ?? '').trim().toLowerCase();
  if (input.mobile !== undefined) next.mobile = String(input.mobile ?? '').replace(/\D/g, '').slice(0, 15);
  if (input.employee_id !== undefined) {
    const requested = String(input.employee_id ?? '').trim().toUpperCase();
    if (requested && requested !== String(user.employee_id ?? '').trim().toUpperCase()) {
      throw new Error('Company ID is permanent after issue and cannot be changed.');
    }
  }
  if (input.role !== undefined) {
    const role = normalizeRole(input.role);
    if (!ADMIN_USER_ROLES.includes(role)) throw new Error('Choose a valid user role.');
    next.role = role;
  }
  if (input.status !== undefined) {
    if (!ADMIN_USER_STATUSES.includes(input.status)) throw new Error('Choose a valid account status.');
    next.status = input.status;
  }
  if (!next.name || !next.email || !next.mobile || !next.employee_id) throw new Error('Name, email, mobile number and company ID are required.');
  if (officers.some((item) => item.id !== user.id && item.email === next.email)) throw new Error('Another admin user already uses this email.');
  if (officers.some((item) => item.id !== user.id && item.employee_id.toLowerCase() === next.employee_id.toLowerCase())) throw new Error('Another admin user already uses this company ID.');
  next.updated_at = new Date().toISOString();
  return next;
}

export function resetOfficerPassword(user, password) {
  const details = passwordDetails(password);
  if (!details) throw new Error('Choose a password between 8 and 128 characters.');
  return {
    ...user,
    password_salt: details.salt,
    password_hash: details.hash,
    updated_at: new Date().toISOString(),
  };
}

export function appendAdminAuditLog(logs, entry) {
  const record = {
    id: randomUUID(),
    action: String(entry.action ?? 'admin_action').trim(),
    actor_name: String(entry.actor_name ?? 'System').trim() || 'System',
    actor_role: normalizeRole(entry.actor_role ?? 'system'),
    target_user_id: String(entry.target_user_id ?? '').trim(),
    target_user_name: String(entry.target_user_name ?? '').trim(),
    details: String(entry.details ?? '').trim(),
    created_at: String(entry.created_at ?? new Date().toISOString()),
  };
  const next = [record, ...(Array.isArray(logs) ? logs : [])];
  return next.slice(0, 5000);
}

export function seedLegacyOfficerAccounts(accounts, hashPassword) {
  const now = new Date().toISOString();
  return accounts.map((account, index) => {
    const mappedRole = account.role === 'super_admin'
      ? 'super_admin'
      : account.role === 'franchise_manager'
        ? 'manager'
        : account.role === 'franchise_officer'
          ? 'crm'
          : normalizeRole(account.role);
    const role = ADMIN_USER_ROLES.includes(mappedRole) ? mappedRole : 'crm';
    const password = hashPassword(account.password);
    return officerUserRecord({
      id: randomUUID(),
      employee_id: String(account.employee_id ?? `RFMS-${String(index + 1).padStart(4, '0')}`).trim(),
      name: account.name,
      email: account.email,
      mobile: account.mobile,
      role,
      password_salt: password.salt,
      password_hash: password.hash,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  });
}

export function roleLabel(role) {
  const labels = {
    super_admin: 'Admin',
    manager: 'Manager',
    crm: 'CRM',
    business_consultant: 'Business Consultant',
    advocate: 'Advocate',
    accountant: 'Accountant',
  };
  return labels[normalizeRole(role)] ?? normalizeRole(role);
}

export const ASSIGNABLE_TEAM_ROLES = {
  leads: ['super_admin', 'manager', 'crm'],
  appointments: ['business_consultant'],
  support: ['super_admin', 'manager', 'crm', 'business_consultant', 'advocate', 'accountant'],
};

export function assignableTeamMembers(officers, context) {
  const roles = ASSIGNABLE_TEAM_ROLES[context] ?? [];
  return (Array.isArray(officers) ? officers : [])
    .filter((item) => item.status === 'active' && roles.includes(normalizeRole(item.role)))
    .map((item) => ({
      id: item.id,
      name: item.name,
      role: normalizeRole(item.role),
      employee_id: item.employee_id,
      role_label: roleLabel(item.role),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.role_label.localeCompare(right.role_label));
}

export function assignableOfficerNames(officers, context) {
  return new Set(assignableTeamMembers(officers, context).map((item) => item.name));
}
