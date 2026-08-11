import { getPortalKind } from '../config/portalHosts';

export const ROLES = {
  FRANCHISEE: 'Franchisee Operator',
  PHLEBOTOMIST: 'Phlebotomist',
  LAB_TECH: 'Lab Technician',
  PATHOLOGIST: 'Pathologist',
  ADMIN: 'Health System Admin',
  SYSTEM_MANAGER: 'System Manager',
  SALES_REP: 'Sales Representative',
  SALES_MANAGER: 'Sales Manager',
} as const;

const STAFF_ROLES = [
  ROLES.ADMIN,
  ROLES.SYSTEM_MANAGER,
  ROLES.LAB_TECH,
  ROLES.PATHOLOGIST,
  'Administrator',
];

export function hasAnyRole(roles: string[] | undefined | null, required: string[]) {
  if (!Array.isArray(roles) || !required?.length) return false;
  return required.some((role) => roles.includes(role));
}

export function isStaff(roles: string[] | undefined | null) {
  return hasAnyRole(roles, STAFF_ROLES);
}

export function isFranchisee(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.FRANCHISEE);
}

export function isPhlebotomist(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.PHLEBOTOMIST);
}

export function isLabTechnician(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.LAB_TECH);
}

/** Field staff + desk roles eligible for HR self-service (leave / expense). */
export function isHrStaff(roles: string[] = []) {
  return hasAnyRole(roles, [
    ROLES.PHLEBOTOMIST,
    ROLES.FRANCHISEE,
    ROLES.LAB_TECH,
    ROLES.PATHOLOGIST,
    ROLES.ADMIN,
    ROLES.SYSTEM_MANAGER,
    ROLES.SALES_REP,
    ROLES.SALES_MANAGER,
    'Administrator',
  ]);
}

export function isSalesStaff(roles: string[] = []) {
  return hasAnyRole(roles, [ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER]);
}

/** Non–field-sales people portal (back office, lab, ops, HR, finance). */
export function isPeopleHrmsStaff(roles: string[] = []) {
  return (
    isHrStaff(roles) ||
    hasAnyRole(roles, [
      'Administrator',
      'HR Manager',
      'HR User',
      'Employee',
      'Accounts User',
      'Accounts Manager',
    ])
  );
}

/** Org-level People / HRMS manager shell (matches backend PEOPLE_MANAGER_ROLES). */
export function isPeopleManager(roles: string[] | undefined | null) {
  return hasAnyRole(roles, [
    ROLES.ADMIN,
    ROLES.SYSTEM_MANAGER,
    'Administrator',
    'Health System Admin',
    'HR Manager',
    'HR User',
    'Accounts Manager',
  ]);
}

/** HR recruiters who manage career portal applications. */
export function isHrRecruiter(roles: string[] | undefined | null) {
  return hasAnyRole(roles, [
    ROLES.ADMIN,
    ROLES.SYSTEM_MANAGER,
    'HR Manager',
    'HR User',
  ]);
}

/** Hiring marketing dashboard (HR + sales leadership). */
export function isHiringMarketer(roles: string[] | undefined | null) {
  return (
    isHrRecruiter(roles) ||
    hasAnyRole(roles, [ROLES.SALES_MANAGER, ROLES.SALES_REP, ROLES.ADMIN, ROLES.SYSTEM_MANAGER])
  );
}

export function isProvider(roles: string[] = []) {
  return hasAnyRole(roles, ['Healthcare Provider', 'Doctor', ROLES.PATHOLOGIST]);
}

/** Patient portal users (non-staff consumer accounts). */
export function isPatientPortal(roles: string[] | undefined | null) {
  const list = Array.isArray(roles) ? roles : [];
  return !isStaff(list) && !isFranchisee(list) && !isPhlebotomist(list);
}

/** Default landing route after login or when visiting /dashboard */
export function getDefaultDashboardRoute(roles: string[] | undefined | null): string {
  const list = Array.isArray(roles) ? roles : [];
  if (getPortalKind() === 'careers' && isHrRecruiter(list)) {
    return '/hr/applications';
  }
  if (getPortalKind() === 'careers') {
    return '/my';
  }
  if (getPortalKind() === 'people') {
    return '/people';
  }
  if (isFranchisee(list)) return '/dashboard/franchisee';
  if (isPhlebotomist(list)) return '/dashboard/phlebotomist';
  if (isLabTechnician(list)) return '/dashboard/lab-reports';
  if (isStaff(list)) return '/dashboard/staff';
  return '/account';
}

export function dashboardLabel(roles: string[]): string {
  if (isFranchisee(roles)) return 'Franchisee';
  if (isPhlebotomist(roles)) return 'Phlebotomist';
  if (isLabTechnician(roles)) return 'Lab Technician';
  if (isStaff(roles)) return 'Operations';
  return 'Account';
}
