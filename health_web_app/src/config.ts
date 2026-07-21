function resolveApiBaseUrl() {
  const env = import.meta.env.VITE_API_BASE_URL;
  if (env !== undefined && env.trim().length > 0) {
    return env.replace(/\/$/, '');
  }
  if (import.meta.env.DEV) {
    return '';
  }
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return '';
}

export const API_MODULES = {
  main: 'health_ecosystem_core.health_ecosystem_core.api',
  journey: 'health_ecosystem_core.health_ecosystem_core.clinical_journey',
  prescriptions: 'health_ecosystem_core.health_ecosystem_core.clinical_prescriptions',
  appointments: 'health_ecosystem_core.health_ecosystem_core.appointments',
  otp: 'health_ecosystem_core.health_ecosystem_core.otp_auth',
  email: 'health_ecosystem_core.health_ecosystem_core.email_auth',
  oauth: 'health_ecosystem_core.health_ecosystem_core.clinical_phase18b',
  diagnostics: 'health_ecosystem_core.health_ecosystem_core.clinical_diagnostics',
  pharmacyQuote: 'health_ecosystem_core.health_ecosystem_core.clinical_phase32_pharmacy_quote',
  insurance: 'health_ecosystem_core.health_ecosystem_core.clinical_phase44_insurance',
  telephony: 'health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony',
} as const;

export type ApiModule = keyof typeof API_MODULES;

export const config = {
  apiBaseUrl: resolveApiBaseUrl(),
  siteName: import.meta.env.VITE_SITE_NAME || 'health.localhost',
  apiModule: API_MODULES.main,
};

export function apiUrl(method: string, module: ApiModule = 'main') {
  return `${config.apiBaseUrl}/api/method/${API_MODULES[module]}.${method}`;
}

export function assetUrl(path?: string | null) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const base = config.apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
