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
];

export function hasAnyRole(roles: string[], required: string[]) {
  return required.some((role) => roles.includes(role));
}

export function isStaff(roles: string[]) {
  return hasAnyRole(roles, STAFF_ROLES);
}

export function isFranchisee(roles: string[]) {
  return roles.includes(ROLES.FRANCHISEE);
}

export function isPhlebotomist(roles: string[]) {
  return roles.includes(ROLES.PHLEBOTOMIST);
}

export function isLabTechnician(roles: string[]) {
  return roles.includes(ROLES.LAB_TECH);
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
  ]);
}

export function isSalesStaff(roles: string[] = []) {
  return hasAnyRole(roles, [ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER]);
}

export function isProvider(roles: string[] = []) {
  return hasAnyRole(roles, ['Healthcare Provider', 'Doctor', ROLES.PATHOLOGIST]);
}

/** Patient portal users (non-staff consumer accounts). */
export function isPatientPortal(roles: string[]) {
  return !isStaff(roles) && !isFranchisee(roles) && !isPhlebotomist(roles);
}

/** Default landing route after login or when visiting /dashboard */
export function getDefaultDashboardRoute(roles: string[]): string {
  if (isFranchisee(roles)) return '/dashboard/franchisee';
  if (isPhlebotomist(roles)) return '/dashboard/phlebotomist';
  if (isLabTechnician(roles)) return '/dashboard/lab-tech';
  if (isStaff(roles)) return '/dashboard/staff';
  return '/dashboard/patient';
}

export function dashboardLabel(roles: string[]): string {
  if (isFranchisee(roles)) return 'Franchisee';
  if (isPhlebotomist(roles)) return 'Phlebotomist';
  if (isLabTechnician(roles)) return 'Lab Technician';
  if (isStaff(roles)) return 'Operations';
  return 'My health';
}
