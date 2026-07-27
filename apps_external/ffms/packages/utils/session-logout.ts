import { RFMS_ADMIN_ORIGIN, RFMS_API_BASE, RFMS_MARKETING_ORIGIN, RFMS_PORTAL_ORIGIN } from './index';

const OFFICER_SESSION_KEYS = ['rfms_auth_token', 'rfms_user_name', 'rfms_user_role', 'rfms_allowed_pages'] as const;
const APPLICANT_SESSION_KEYS = ['rfms_applicant_auth_token', 'rfms_public_application_id'] as const;

export async function logoutOfficer(token: string) {
  try {
    await fetch(`${RFMS_API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* Continue local cleanup even if the API is unavailable. */
  }
  OFFICER_SESSION_KEYS.forEach((key) => sessionStorage.removeItem(key));
  window.location.replace(RFMS_MARKETING_ORIGIN);
}

export async function logoutApplicant(token: string) {
  try {
    if (token) {
      await fetch(`${RFMS_API_BASE}/applicant/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    /* Continue local cleanup even if the API is unavailable. */
  }
  APPLICANT_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
  window.location.replace(RFMS_MARKETING_ORIGIN);
}

export function clearOfficerSessionStorage() {
  OFFICER_SESSION_KEYS.forEach((key) => sessionStorage.removeItem(key));
}

export function clearApplicantSessionStorage() {
  APPLICANT_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
}

export type AdminNavigationTarget = { page: string; entityId?: string };
export type PortalNavigationTarget = { section: string };

export function parseAdminNotificationHref(href: string): AdminNavigationTarget | null {
  const value = href.trim();
  if (!value.startsWith('admin:')) return null;
  const [, page, entityId] = value.split(':');
  if (!page) return null;
  return { page, entityId };
}

export function parsePortalNotificationHref(href: string): PortalNavigationTarget | null {
  const value = href.trim();
  if (!value.startsWith('portal:')) return null;
  const section = value.slice('portal:'.length);
  if (!section) return null;
  return { section };
}

export function peekNotificationEntity() {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('rfms_notification_entity') ?? '';
}

export function clearNotificationEntity() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('rfms_notification_entity');
}

export function consumeNotificationEntity() {
  const value = peekNotificationEntity();
  if (value) clearNotificationEntity();
  return value;
}

export { RFMS_ADMIN_ORIGIN, RFMS_PORTAL_ORIGIN, RFMS_MARKETING_ORIGIN };
