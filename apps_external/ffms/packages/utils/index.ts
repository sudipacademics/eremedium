export const formatINR = (value: number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);

function usesIsolatedPorts() {
  if (typeof window === 'undefined') return false;
  const port = Number(window.location.port);
  return port >= 4000 && port <= 4002;
}

export const RFMS_API_BASE = usesIsolatedPorts()
  ? 'http://localhost:9080/api/v1'
  : (process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1');

export const RFMS_MARKETING_ORIGIN = usesIsolatedPorts()
  ? 'http://localhost:4000'
  : (process.env.NEXT_PUBLIC_RFMS_MARKETING_URL ?? 'http://localhost:3000');

export const RFMS_PORTAL_ORIGIN = usesIsolatedPorts()
  ? 'http://localhost:4001'
  : (process.env.NEXT_PUBLIC_RFMS_PORTAL_URL ?? 'http://localhost:3001');

export const RFMS_ADMIN_ORIGIN = usesIsolatedPorts()
  ? 'http://localhost:4002'
  : (process.env.NEXT_PUBLIC_RFMS_ADMIN_URL ?? 'http://localhost:3002');

/** Next.js basePath for apps served under /franchise, /onboard, /ffms, etc. */
export const RFMS_APP_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/** Prefix relative app paths with the configured basePath; leave absolute/external URLs alone. */
export function appPath(href: string) {
  const value = String(href ?? '').trim();
  if (!value) return value;
  if (/^(https?:|data:|mailto:|tel:)/i.test(value)) return value;
  // Uploads are served from the public origin root, not under /franchise|/onboard|/ffms.
  if (value === '/uploads' || value.startsWith('/uploads/')) return value;
  if (!RFMS_APP_BASE_PATH) return value.startsWith('/') ? value : `/${value}`;
  if (value === RFMS_APP_BASE_PATH || value.startsWith(`${RFMS_APP_BASE_PATH}/`) || value.startsWith(`${RFMS_APP_BASE_PATH}#`) || value.startsWith(`${RFMS_APP_BASE_PATH}?`)) {
    return value;
  }
  if (value.startsWith('#')) return `${RFMS_APP_BASE_PATH}/${value}`;
  if (value.startsWith('/')) return `${RFMS_APP_BASE_PATH}${value}`;
  return `${RFMS_APP_BASE_PATH}/${value}`;
}

export * from './admin-rbac';
export * from './auth-handoff';
export * from './hero-limits';
export * from './session-logout';
