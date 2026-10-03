import { StaffRole } from '@prisma/client';

export const Permission = {
  DASHBOARD: 'dashboard.view',
  CONTENT: 'content.manage',
  CATALOG: 'catalog.manage',
  OPERATIONS: 'operations.manage',
  SUPPORT: 'support.manage',
  FINANCE: 'finance.view',
  PROVIDERS: 'providers.manage',
  JOIN_REQUESTS: 'joinRequests.manage',
  STAFF: 'staff.manage',
  AUDIT: 'audit.view',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);

export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  [StaffRole.SUPER_ADMIN]: ALL,
  [StaffRole.ADMIN]: ALL.filter((permission) => permission !== Permission.STAFF),
  [StaffRole.MANAGER]: [
    Permission.DASHBOARD,
    Permission.CONTENT,
    Permission.CATALOG,
    Permission.OPERATIONS,
    Permission.SUPPORT,
    Permission.PROVIDERS,
    Permission.JOIN_REQUESTS,
  ],
  [StaffRole.CONTENT_MANAGER]: [Permission.DASHBOARD, Permission.CONTENT],
  [StaffRole.FINANCE_MANAGER]: [Permission.DASHBOARD, Permission.FINANCE],
  [StaffRole.SUPPORT]: [Permission.DASHBOARD, Permission.SUPPORT, Permission.OPERATIONS],
};

export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  [StaffRole.SUPER_ADMIN]: 'Super Admin',
  [StaffRole.ADMIN]: 'Admin',
  [StaffRole.MANAGER]: 'Manager',
  [StaffRole.CONTENT_MANAGER]: 'Content Manager',
  [StaffRole.FINANCE_MANAGER]: 'Finance Manager',
  [StaffRole.SUPPORT]: 'Support Team',
};

export function permissionsFor(role: StaffRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasAnyPermission(role: StaffRole, required: readonly Permission[]): boolean {
  const granted = ROLE_PERMISSIONS[role];
  return required.some((permission) => granted.includes(permission));
}
