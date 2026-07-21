/** Host-based portal routing for e-remedium.in subdomains. */

export type PortalKind = 'patient' | 'b2b' | 'collect' | 'sales' | 'erp';

const PATIENT_WWW = 'www.e-remedium.in';

const HOST_PORTAL: Record<string, PortalKind> = {
  [PATIENT_WWW]: 'patient',
  'e-remedium.in': 'patient',
  'partners.e-remedium.in': 'b2b',
  'collect.e-remedium.in': 'collect',
  'reach.e-remedium.in': 'sales',
  'erp.e-remedium.in': 'erp',
};

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '167.233.108.90']);

export function currentHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export function getPortalKind(hostname = currentHostname()): PortalKind {
  const host = hostname.toLowerCase();
  if (HOST_PORTAL[host]) return HOST_PORTAL[host];
  if (DEV_HOSTS.has(host)) return 'patient';
  return 'patient';
}

export function isPatientPortalHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'patient';
}

export function isStaffPortalHost(hostname = currentHostname()) {
  const kind = getPortalKind(hostname);
  return kind === 'b2b' || kind === 'collect' || kind === 'sales';
}

export function patientPortalBaseUrl() {
  if (typeof window !== 'undefined') {
    const { protocol } = window.location;
    return `${protocol}//${PATIENT_WWW}`;
  }
  return 'https://www.e-remedium.in';
}

export function erpDeskBaseUrl() {
  if (typeof window !== 'undefined') {
    const { protocol } = window.location;
    return `${protocol}//erp.e-remedium.in`;
  }
  return 'https://erp.e-remedium.in';
}

/** Default path when visiting `/` on a branded subdomain. */
export function portalHomePath(kind = getPortalKind()): string {
  switch (kind) {
    case 'b2b':
      return '/b2b';
    case 'collect':
      return '/dashboard/phlebotomist';
    case 'sales':
      return '/sales';
    case 'erp':
      return '/app';
    default:
      return '/';
  }
}

/** Paths allowed on each staff portal (prefix match). */
export function isPathAllowedOnPortal(pathname: string, kind = getPortalKind()): boolean {
  if (kind === 'patient') return true;

  const always = ['/login', '/oauth/callback', '/forgot-password'];
  if (always.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;

  if (kind === 'b2b') {
    return (
      pathname === '/' ||
      pathname.startsWith('/b2b') ||
      pathname.startsWith('/dashboard/franchisee')
    );
  }
  if (kind === 'collect') {
    return pathname === '/' || pathname.startsWith('/dashboard/phlebotomist');
  }
  if (kind === 'sales') {
    return pathname === '/' || pathname.startsWith('/sales');
  }
  if (kind === 'erp') {
    return pathname === '/' || pathname.startsWith('/app');
  }
  return false;
}
