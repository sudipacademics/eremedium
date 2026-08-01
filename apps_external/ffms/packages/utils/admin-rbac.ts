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
] as const;

export type AdminPage = typeof ADMIN_PAGES[number];

const LEGACY_ROLE_MAP: Record<string, string> = {
  franchise_manager: 'manager',
  franchise_officer: 'crm',
};

export function normalizeAdminRole(role: string) {
  return LEGACY_ROLE_MAP[role] ?? role;
}

const PAGE_PERMISSION: Record<AdminPage, string> = {
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

const PERMISSIONS: Record<string, string[]> = {
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
};

export function adminPagesForRole(role: string) {
  const normalized = normalizeAdminRole(role);
  return ADMIN_PAGES.filter((page) => PERMISSIONS[PAGE_PERMISSION[page]]?.includes(normalized));
}

export function adminCanManageCrm(role: string) {
  return ['super_admin', 'manager'].includes(normalizeAdminRole(role));
}

export function adminCanManageAppointments(role: string) {
  return ['super_admin', 'manager'].includes(normalizeAdminRole(role));
}

export function adminCanManageTerritory(role: string) {
  return ['super_admin', 'manager'].includes(normalizeAdminRole(role));
}

export function adminCanManageCoupons(role: string) {
  return ['super_admin', 'accountant'].includes(normalizeAdminRole(role));
}

export function adminCanManageSupportSettings(role: string) {
  return normalizeAdminRole(role) === 'super_admin';
}

export function adminCanManageFranchiseeDirectoryApi(role: string) {
  return normalizeAdminRole(role) === 'super_admin';
}
