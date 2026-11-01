import { getPortalKind } from '../config/portalHosts';

export const ROLES = {
  FRANCHISEE: 'Franchisee Operator',
  PHLEBOTOMIST: 'Phlebotomist',
  LAB_TECH: 'Lab Technician',
  LAB_MANAGER: 'Lab Manager',
  MATERIAL_REQUESTER: 'Material Requester',
  PATHOLOGIST: 'Pathologist',
  ADMIN: 'Health System Admin',
  SYSTEM_MANAGER: 'System Manager',
  SALES_REP: 'Sales Representative',
  SALES_MANAGER: 'Sales Manager',
  AGENCY_AGENT: 'Agency Agent',
  AGENCY_MANAGER: 'Agency Manager',
  PF_CUSTOMER: 'PF Customer',
  PF_LAB_AUTHORISER: 'PF Lab Authoriser',
  PATIENT: 'Patient',
  TELEPORTER_CENTER: 'Teleporter Center User',
  TELEPORTER_LAB: 'Teleporter Lab User',
  TELEPORTER_RUNNER: 'Teleporter Runner',
  TELEPORTER_MANAGER: 'Teleporter Manager',
  UBERDOC_PROVIDER: 'Clinical Provider',
  UBERDOC_CLINIC: 'Uber Doc Clinic User',
  UBERDOC_MANAGER: 'Uber Doc Manager',
} as const;

const TELEPORTER_ROLES = [ROLES.TELEPORTER_CENTER, ROLES.TELEPORTER_LAB, ROLES.TELEPORTER_RUNNER, ROLES.TELEPORTER_MANAGER];

const STAFF_ROLES = [
  ROLES.ADMIN,
  ROLES.SYSTEM_MANAGER,
  ROLES.LAB_TECH,
  ROLES.LAB_MANAGER,
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

export function isLabManager(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.LAB_MANAGER);
}

/** Company-unit staff with no lab / admin role: they only see "My Requests" in Inventory Management. */
export function isRequesterOnly(roles: string[] | undefined | null) {
  return (
    hasAnyRole(roles, [ROLES.MATERIAL_REQUESTER]) &&
    !hasAnyRole(roles, [ROLES.LAB_TECH, ROLES.LAB_MANAGER, ROLES.PATHOLOGIST, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator'])
  );
}

/** Roles that may run the central lab inventory (stock, approvals, dispatch). Matches backend MANAGE_ROLES. */
export function canManageInventory(roles: string[] | undefined | null) {
  return hasAnyRole(roles, [ROLES.LAB_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']);
}

export function isPathologist(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.PATHOLOGIST);
}

/** PhleboFirst customer (doctor / pharmacy / small lab); franchisees use PhleboFirst inside the partner portal. */
export function isPfCustomer(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.PF_CUSTOMER);
}

export function isPfLabAuthoriser(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.PF_LAB_AUTHORISER);
}

/** Roles that may open the PhleboFirst lab inbox. */
export function canUsePfInbox(roles: string[] | undefined | null) {
  return hasAnyRole(roles, [ROLES.LAB_TECH, ROLES.LAB_MANAGER, ROLES.PF_LAB_AUTHORISER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']);
}

/** Any Teleporter (teleports.in) role. */
export function isTeleporterUser(roles: string[] | undefined | null) {
  return hasAnyRole(roles, TELEPORTER_ROLES);
}

export function isTeleporterCenterUser(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.TELEPORTER_CENTER);
}

export function isTeleporterLabUser(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.TELEPORTER_LAB);
}

export function isTeleporterRunner(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.TELEPORTER_RUNNER);
}

/** Teleporter operations console (teleports.in `/app/ops`). */
export function canManageTeleporter(roles: string[] | undefined | null) {
  return hasAnyRole(roles, [ROLES.TELEPORTER_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']);
}

export function isUberDocProvider(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.UBERDOC_PROVIDER);
}

export function isUberDocClinicUser(roles: string[] | undefined | null) {
  return Array.isArray(roles) && roles.includes(ROLES.UBERDOC_CLINIC);
}

/** Uber Doc operations console (`/app/ops` on the Uber Doc host). */
export function canManageUberDoc(roles: string[] | undefined | null) {
  return hasAnyRole(roles, [ROLES.UBERDOC_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']);
}

/**
 * Uber Doc provider / clinic account with no other Remedium identity: once the Uber Doc domain exists, Remedium hosts
 * send these users to the Uber Doc app. Verified doctors also hold Physician and keep /dashboard/provider.
 */
export function isUberDocOnlyUser(roles: string[] | undefined | null) {
  const list = Array.isArray(roles) ? roles : [];
  const known = new Set<string>([ROLES.UBERDOC_PROVIDER, ROLES.UBERDOC_CLINIC, 'All', 'Guest', 'Desk User']);
  return (isUberDocProvider(list) || isUberDocClinicUser(list)) && list.every((r) => known.has(r));
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

/** Non-employee BA / MLM agency portal (layout access — includes admins who may inspect the portal). */
export function isAgencyStaff(roles: string[] = []) {
  return hasAnyRole(roles, [
    ROLES.AGENCY_AGENT,
    ROLES.AGENCY_MANAGER,
    ROLES.ADMIN,
    ROLES.SYSTEM_MANAGER,
    'Administrator',
  ]);
}

/** True agency identities only — used for post-login routing (never includes HR / ops admins). */
export function isAgencyPortalUser(roles: string[] = []) {
  return hasAnyRole(roles, [ROLES.AGENCY_AGENT, ROLES.AGENCY_MANAGER]);
}

export function isAgencyManager(roles: string[] = []) {
  return hasAnyRole(roles, [ROLES.AGENCY_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']);
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
  return hasAnyRole(roles, ['Healthcare Provider', 'Doctor', 'Physician', ROLES.PATHOLOGIST]);
}

/** Patient portal users (non-staff consumer accounts). */
export function isPatientPortal(roles: string[] | undefined | null) {
  const list = Array.isArray(roles) ? roles : [];
  return (
    !isStaff(list) &&
    !isFranchisee(list) &&
    !isPhlebotomist(list) &&
    !isRequesterOnly(list) &&
    !isTeleporterOnlyUser(list)
  );
}

/**
 * Teleporter account with no Remedium identity (patient, staff, partner, field or PhleboFirst role):
 * Remedium hosts send these users to teleports.in instead of the patient pages.
 */
export function isTeleporterOnlyUser(roles: string[] | undefined | null) {
  const list = Array.isArray(roles) ? roles : [];
  return (
    isTeleporterUser(list) &&
    !hasAnyRole(list, [ROLES.PATIENT, ROLES.FRANCHISEE, ROLES.PHLEBOTOMIST, ROLES.MATERIAL_REQUESTER, ROLES.PF_CUSTOMER, ROLES.PF_LAB_AUTHORISER]) &&
    !isStaff(list) &&
    !isProvider(list) &&
    !isSalesStaff(list) &&
    !isAgencyPortalUser(list) &&
    !isPeopleHrmsStaff(list)
  );
}

/** Default landing route after login or when visiting /dashboard */
export function getDefaultDashboardRoute(roles: string[] | undefined | null): string {
  const list = Array.isArray(roles) ? roles : [];
  if (getPortalKind() === 'careers' && isHrRecruiter(list)) {
    return '/people/recruitment';
  }
  if (getPortalKind() === 'careers') {
    return '/careers';
  }
  if (getPortalKind() === 'people') {
    return '/people';
  }
  if (getPortalKind() === 'aesthetics') {
    return '/';
  }
  // HR recruiters always land on the HR portal — never Agents.
  if (isHrRecruiter(list)) {
    return '/people/recruitment';
  }
  // People / accounts managers (without ops admin desk roles) → People HRMS.
  if (isPeopleManager(list) && !isStaff(list)) {
    return '/people';
  }
  // Only Agency Agent / Agency Manager default to Agents portal.
  if (isAgencyPortalUser(list)) {
    return '/agents';
  }
  if (isFranchisee(list)) return '/dashboard/franchisee';
  if (isPhlebotomist(list)) return '/dashboard/phlebotomist';
  if (isLabTechnician(list)) return '/dashboard/lab-reports';
  if (isLabManager(list)) return '/dashboard/inventory';
  if (isRequesterOnly(list)) return '/dashboard/inventory';
  if (isPathologist(list)) return '/dashboard/pathologist';
  if (isProvider(list)) return '/dashboard/provider';
  if (isStaff(list)) return '/dashboard/staff';
  if (isPfLabAuthoriser(list)) return '/dashboard/pf-inbox';
  if (isPfCustomer(list)) return '/pf';
  return '/account';
}

export function dashboardLabel(roles: string[]): string {
  if (isFranchisee(roles)) return 'Franchisee';
  if (isPhlebotomist(roles)) return 'Phlebotomist';
  if (isLabManager(roles)) return 'Lab Manager';
  if (isLabTechnician(roles)) return 'Lab Technician';
  if (isPathologist(roles)) return 'Pathologist';
  if (isRequesterOnly(roles)) return 'Material Requester';
  if (isProvider(roles)) return 'Provider';
  if (isStaff(roles)) return 'Operations';
  if (isPfLabAuthoriser(roles)) return 'Lab Authoriser';
  if (isPfCustomer(roles)) return 'PhleboFirst';
  return 'Account';
}
