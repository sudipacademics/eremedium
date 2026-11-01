/** Host-based portal routing for e-remedium.in and remediumlabs.in. */

export type PortalKind =
  | 'patient'
  | 'b2b'
  | 'collect'
  | 'labtech'
  | 'sales'
  | 'erp'
  | 'careers'
  | 'people'
  | 'agents'
  | 'phlebofirst'
  | 'teleporter'
  | 'uberdoc'
  | 'vault'
  | 'aesthetics';

export const PATIENT_HOST = 'www.remediumlabs.in';
export const COLLECT_HOST = 'collect.remediumlabs.in';
export const PARTNERS_HOST = 'partners.remediumlabs.in';
export const LABTECH_HOST = 'labtech.e-remedium.in';
export const PHLEBOFIRST_HOST = 'phlebofirst.com';
export const TELEPORTER_HOST = 'teleports.in';
/** Uber Doc apex host. Domain not decided yet: set it here (or VITE_UBERDOC_HOST at build time); empty = preview only. */
export const UBERDOC_HOST: string = String(import.meta.env.VITE_UBERDOC_HOST || '').trim().toLowerCase();
/** Patient health vault apex host. Domain not decided yet: set it here (or VITE_VAULT_HOST at build time); empty = preview only. */
export const VAULT_HOST: string = String(import.meta.env.VITE_VAULT_HOST || '').trim().toLowerCase();

const PATIENT_LEGACY = 'www.e-remedium.in';
const COLLECT_LEGACY = 'collect.e-remedium.in';
const PARTNERS_LEGACY = 'partners.e-remedium.in';

export const COLLECT_CUTOVER = true;
export const PARTNERS_CUTOVER = true;
export const LABTECH_CUTOVER = true;
export const PATIENT_CUTOVER = true;

const HOST_PORTAL: Record<string, PortalKind> = {
  [PATIENT_HOST]: 'patient',
  'remediumlabs.in': 'patient',
  [PATIENT_LEGACY]: 'patient',
  'e-remedium.in': 'patient',
  [PARTNERS_HOST]: 'b2b',
  [PARTNERS_LEGACY]: 'b2b',
  [COLLECT_HOST]: 'collect',
  [COLLECT_LEGACY]: 'collect',
  [LABTECH_HOST]: 'labtech',
  'reach.e-remedium.in': 'sales',
  'career.e-remedium.in': 'careers',
  'career.smilecurelifestyle.in': 'careers',
  'people.e-remedium.in': 'people',
  'aesthetics.e-remedium.in': 'aesthetics',
  'erp.e-remedium.in': 'erp',
  [PHLEBOFIRST_HOST]: 'phlebofirst',
  'www.phlebofirst.com': 'phlebofirst',
  [TELEPORTER_HOST]: 'teleporter',
  'www.teleports.in': 'teleporter',
  ...(UBERDOC_HOST ? { [UBERDOC_HOST]: 'uberdoc' as const, [`www.${UBERDOC_HOST}`]: 'uberdoc' as const } : {}),
  ...(VAULT_HOST ? { [VAULT_HOST]: 'vault' as const, [`www.${VAULT_HOST}`]: 'vault' as const } : {}),
};

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '167.233.108.90']);

const LABTECH_PATHS = [
  '/dashboard/lab-reports',
  '/dashboard/lab-bill-entry',
  '/dashboard/lab-tech',
  '/dashboard/accession',
  '/dashboard/report-lifecycle',
  '/dashboard/critical-alerts',
  '/dashboard/qc',
  '/dashboard/qms',
  '/dashboard/all-bookings',
  '/dashboard/reagents',
  '/dashboard/inventory',
  '/dashboard/pathologist',
  '/dashboard/pf-inbox',
];

/** phlebofirst.com: public site plus the PhleboFirst app (`/login`, `/app/*`) for every PhleboFirst role. */
const PHLEBOFIRST_PATHS = ['/', '/converter-api', '/login'];
const PF_RIDER_JOBS_PATH = '/dashboard/phlebotomist/jobs';

/** teleports.in: public site, sign-in / sign-up and the Teleporter app under `/app`. */
const TELEPORTER_PATHS = ['/', '/login', '/signup'];

/** Uber Doc host: public site, provider / clinic search, tutorial library, e-Rx verify, sign-in / sign-up and `/app`. */
const UBERDOC_PATHS = ['/', '/login', '/signup', '/find', '/programs'];
const UBERDOC_PREFIXES = ['/app', '/verify', '/providers', '/programs'];

/** Vault host (patients only): public landing, privacy, sign-in / registration, public card verify and `/app`. */
const VAULT_PATHS = ['/', '/login', '/register', '/privacy'];
const VAULT_PREFIXES = ['/app', '/card'];

/** Teleporter screens that used to live inside the Remedium portals, mapped to their teleports.in app path. */
const TELEPORTER_LEGACY_PATHS: Array<[string, string]> = [
  ['/b2b/teleporter', '/app/center'],
  ['/dashboard/teleporter-receiving', '/app/lab'],
  ['/dashboard/runner', '/app/runner'],
  ['/dashboard/teleporter', '/app/ops'],
];

export function currentHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export function isDevPortalHost(hostname = currentHostname()) {
  return DEV_HOSTS.has(hostname);
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

export function isPatientCanonicalHost(hostname = currentHostname()) {
  return hostname === PATIENT_HOST || hostname === 'remediumlabs.in';
}

export function isCareersPortalHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'careers';
}

export function isB2bPortalHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'b2b';
}

export function isCollectPortalHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'collect';
}

export function isLabtechPortalHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'labtech';
}

export function isPhleboFirstHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'phlebofirst';
}

export function isTeleporterHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'teleporter';
}

export function isUberDocHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'uberdoc';
}

export function isVaultHost(hostname = currentHostname()) {
  return getPortalKind(hostname) === 'vault';
}

function httpsOrigin(host: string) {
  return `https://${host}`;
}

export function collectPortalBaseUrl() {
  if (typeof window !== 'undefined' && DEV_HOSTS.has(currentHostname())) {
    return window.location.origin;
  }
  return httpsOrigin(COLLECT_HOST);
}

export function partnersPortalBaseUrl() {
  if (typeof window !== 'undefined' && DEV_HOSTS.has(currentHostname())) {
    return window.location.origin;
  }
  return httpsOrigin(PARTNERS_HOST);
}

export function labtechPortalBaseUrl() {
  if (typeof window !== 'undefined' && DEV_HOSTS.has(currentHostname())) {
    return window.location.origin;
  }
  return httpsOrigin(LABTECH_HOST);
}

export function patientPortalOrigin() {
  if (typeof window !== 'undefined' && DEV_HOSTS.has(currentHostname())) {
    return window.location.origin;
  }
  return httpsOrigin(PATIENT_CUTOVER ? PATIENT_HOST : PATIENT_LEGACY);
}

/** Collector SPA paths that belong on collect.remediumlabs.in. */
export function isCollectorAppPath(pathname: string) {
  return (
    pathname.startsWith('/dashboard/phlebotomist') ||
    pathname.startsWith('/dashboard/profile') ||
    pathname.startsWith('/people')
  );
}

export function isLabtechAppPath(pathname: string) {
  return (
    LABTECH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith('/dashboard/profile') ||
    pathname.startsWith('/people')
  );
}

/** PhleboFirst customer area (doctors / pharmacies / small labs) on the partners host. */
export function isPfCustomerPath(pathname: string) {
  return pathname === '/pf' || pathname.startsWith('/pf/');
}

export function isPartnerAppPath(pathname: string) {
  return pathname.startsWith('/b2b') || pathname.startsWith('/dashboard/franchisee') || isPfCustomerPath(pathname);
}

export function collectCanonicalUrl(pathAndSearch = '/') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${collectPortalBaseUrl()}${path}`;
}

export function partnersCanonicalUrl(pathAndSearch = '/') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${partnersPortalBaseUrl()}${path}`;
}

export function labtechCanonicalUrl(pathAndSearch = '/') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${labtechPortalBaseUrl()}${path}`;
}

export function patientCanonicalUrl(pathAndSearch = '/') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${patientPortalOrigin()}${path}`;
}

/** The localhost preview of phlebofirst.com is mounted under `/phlebofirst`. */
export function phleboFirstBaseUrl() {
  if (typeof window !== 'undefined' && DEV_HOSTS.has(currentHostname())) {
    return `${window.location.origin}/phlebofirst`;
  }
  return httpsOrigin(PHLEBOFIRST_HOST);
}

export function phleboFirstCanonicalUrl(pathAndSearch = '/app') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${phleboFirstBaseUrl()}${path}`;
}

/** Old PhleboFirst screens on the partners / collect hosts that now live in the phlebofirst.com app. */
export function phleboFirstAppPathFor(pathname: string, kind = getPortalKind()): string | null {
  if (kind === 'b2b' && isPfCustomerPath(pathname)) return `/app/requests${pathname.slice('/pf'.length)}`;
  if (kind === 'collect' && (pathname === PF_RIDER_JOBS_PATH || pathname.startsWith(`${PF_RIDER_JOBS_PATH}/`))) {
    return `/app/jobs${pathname.slice(PF_RIDER_JOBS_PATH.length)}`;
  }
  return null;
}

/** The localhost preview of teleports.in is mounted under `/teleporter`. */
export function teleporterBaseUrl() {
  if (typeof window !== 'undefined' && DEV_HOSTS.has(currentHostname())) {
    return `${window.location.origin}/teleporter`;
  }
  return httpsOrigin(TELEPORTER_HOST);
}

export function teleporterCanonicalUrl(pathAndSearch = '/app') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${teleporterBaseUrl()}${path}`;
}

/** The localhost preview of the Uber Doc app is mounted under `/uberdoc` (also the fallback until a domain exists). */
export function uberDocBaseUrl() {
  if (typeof window !== 'undefined' && (DEV_HOSTS.has(currentHostname()) || !UBERDOC_HOST)) {
    return `${window.location.origin}/uberdoc`;
  }
  return httpsOrigin(UBERDOC_HOST);
}

export function uberDocCanonicalUrl(pathAndSearch = '/app') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${uberDocBaseUrl()}${path}`;
}

/** The localhost preview of the patient vault is mounted under `/vault` (also the fallback until a domain exists). */
export function vaultBaseUrl() {
  if (typeof window !== 'undefined' && (DEV_HOSTS.has(currentHostname()) || !VAULT_HOST)) {
    return `${window.location.origin}/vault`;
  }
  return httpsOrigin(VAULT_HOST);
}

export function vaultCanonicalUrl(pathAndSearch = '/app') {
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${vaultBaseUrl()}${path}`;
}

/** Old Teleporter screens on the Remedium hosts; they now live in the teleports.in app. */
export function teleporterAppPathFor(pathname: string): string | null {
  const hit = TELEPORTER_LEGACY_PATHS.find(([old]) => pathname === old || pathname.startsWith(`${old}/`));
  return hit ? hit[1] : null;
}

export function isStaffPortalHost(hostname = currentHostname()) {
  const kind = getPortalKind(hostname);
  return (
    kind === 'b2b' ||
    kind === 'collect' ||
    kind === 'labtech' ||
    kind === 'sales' ||
    kind === 'people' ||
    kind === 'aesthetics' ||
    kind === 'agents' ||
    kind === 'erp'
  );
}

export function patientPortalBaseUrl() {
  if (typeof window !== 'undefined' && DEV_HOSTS.has(currentHostname())) {
    return window.location.origin;
  }
  return patientPortalOrigin();
}

export function careersPortalBaseUrl() {
  if (typeof window !== 'undefined') {
    const { protocol, host } = window.location;
    if (host && !host.startsWith('career.')) {
      return `${protocol}//${host}/careers`;
    }
    return `${protocol}//${PATIENT_LEGACY}/careers`;
  }
  return `https://${PATIENT_LEGACY}/careers`;
}

/** Path-mounted on www until people.e-remedium.in DNS exists. */
export function peoplePortalBaseUrl() {
  if (typeof window !== 'undefined') {
    const { protocol, host } = window.location;
    if (host && !host.startsWith('people.')) {
      return `${protocol}//${host}/people`;
    }
    return `${protocol}//${PATIENT_LEGACY}/people`;
  }
  return `https://${PATIENT_LEGACY}/people`;
}

/** Path-mounted BA / MLM agents portal on www (agents.e-remedium.in later). */
export function agentsPortalBaseUrl() {
  if (typeof window !== 'undefined') {
    const { protocol, host } = window.location;
    if (host && !host.startsWith('agents.')) {
      return `${protocol}//${host}/agents`;
    }
    return `${protocol}//${PATIENT_LEGACY}/agents`;
  }
  return `https://${PATIENT_LEGACY}/agents`;
}

export function erpDeskBaseUrl() {
  if (typeof window !== 'undefined') {
    const { protocol } = window.location;
    return `${protocol}//erp.e-remedium.in`;
  }
  return 'https://erp.e-remedium.in';
}

export function planningPortalBaseUrl() {
  if (typeof window !== 'undefined') {
    const { protocol } = window.location;
    return `${protocol}//${PATIENT_LEGACY}/planning`;
  }
  return `https://${PATIENT_LEGACY}/planning`;
}

/** Default path when visiting `/` on a branded subdomain. */
export function portalHomePath(kind = getPortalKind()): string {
  switch (kind) {
    case 'b2b':
      return '/b2b/hub';
    case 'collect':
      return '/dashboard/phlebotomist';
    case 'labtech':
      return '/dashboard/lab-reports';
    case 'sales':
      return '/sales';
    case 'careers':
      return '/careers';
    case 'people':
      return '/people';
    case 'aesthetics':
      return '/';
    case 'agents':
      return '/agents';
    case 'erp':
      return '/app';
    default:
      return '/';
  }
}

function isAlwaysAllowed(pathname: string) {
  const always = ['/login', '/oauth/callback', '/forgot-password'];
  return always.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Paths allowed on each staff portal (prefix match). */
export function isPathAllowedOnPortal(pathname: string, kind = getPortalKind()): boolean {
  if (kind === 'patient') {
    const host = currentHostname();
    const isolatedPatient = host === PATIENT_HOST || host === 'remediumlabs.in';
    if (isolatedPatient) {
      if (pathname.startsWith('/dashboard/phlebotomist') || isPartnerAppPath(pathname)) return false;
      if (LABTECH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
    }
    return true;
  }

  if (kind === 'phlebofirst') {
    return PHLEBOFIRST_PATHS.includes(pathname) || pathname === '/app' || pathname.startsWith('/app/');
  }

  if (kind === 'teleporter') {
    return TELEPORTER_PATHS.includes(pathname) || pathname === '/app' || pathname.startsWith('/app/');
  }

  if (kind === 'uberdoc') {
    return UBERDOC_PATHS.includes(pathname) || UBERDOC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }

  if (kind === 'vault') {
    return VAULT_PATHS.includes(pathname) || VAULT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }

  if (isAlwaysAllowed(pathname)) return true;

  if (kind === 'b2b') {
    return pathname === '/' || isPartnerAppPath(pathname);
  }
  if (kind === 'collect') {
    return pathname === '/' || isCollectorAppPath(pathname);
  }
  if (kind === 'labtech') {
    return pathname === '/' || isLabtechAppPath(pathname);
  }
  if (kind === 'sales') {
    return pathname === '/' || pathname.startsWith('/sales');
  }
  if (kind === 'careers') {
    return (
      pathname === '/' ||
      pathname.startsWith('/careers') ||
      pathname.startsWith('/jobs') ||
      pathname.startsWith('/hr') ||
      pathname.startsWith('/people') ||
      pathname.startsWith('/my')
    );
  }
  if (kind === 'people') {
    return pathname === '/' || pathname.startsWith('/people');
  }
  if (kind === 'aesthetics') {
    const sections = ['/bookings', '/services', '/products', '/machines', '/invoices', '/branches', '/employees', '/settings'];
    return pathname === '/' || sections.some((section) => pathname === section || pathname.startsWith(`${section}/`));
  }
  if (kind === 'agents') {
    return pathname === '/' || pathname.startsWith('/agents');
  }
  if (kind === 'erp') {
    return pathname === '/' || pathname.startsWith('/app') || pathname.startsWith('/planning');
  }
  return false;
}

/** Old host that should 301/JS-bounce to the current canonical host for this portal. */
export function legacyPortalRedirect(hostname = currentHostname()): string | null {
  const host = hostname.toLowerCase();
  if (host === COLLECT_LEGACY) return httpsOrigin(COLLECT_HOST);
  if (host === PARTNERS_LEGACY) return httpsOrigin(PARTNERS_HOST);
  return null;
}
