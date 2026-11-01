import { api } from '../api';
import { loadSession, type StoredSession } from './session';
import {
  collectCanonicalUrl,
  labtechCanonicalUrl,
  partnersCanonicalUrl,
  patientCanonicalUrl,
  phleboFirstCanonicalUrl,
} from '../config/portalHosts';

/** Legacy fragment carrying the whole session (incl. sid). Still accepted on arrival, never emitted. */
export const HANDOFF_PREFIX = '#hec_handoff=';
/** One-time code (60 s, single use) redeemed for a fresh session on the target host. */
export const HANDOFF_CODE_PREFIX = '#hec_code=';

export type HandoffMode = 'assign' | 'replace';

export function collectorHandoffUrl(pathAndSearch: string) {
  return collectCanonicalUrl(pathAndSearch || '/dashboard/phlebotomist');
}

export function partnersHandoffUrl(pathAndSearch: string) {
  return partnersCanonicalUrl(pathAndSearch || '/b2b/hub');
}

export function labtechHandoffUrl(pathAndSearch: string) {
  return labtechCanonicalUrl(pathAndSearch || '/dashboard/lab-reports');
}

export function patientHandoffUrl(pathAndSearch: string) {
  return patientCanonicalUrl(pathAndSearch || '/');
}

export function phleboFirstHandoffUrl(pathAndSearch: string) {
  return phleboFirstCanonicalUrl(pathAndSearch || '/app');
}

let navigating = false;

/** Navigate to another portal host, carrying the login as a one-time code instead of the session itself. */
export async function navigateWithHandoff(dest: string, mode: HandoffMode = 'assign') {
  if (navigating) return;
  navigating = true;
  let url = dest;
  try {
    const target = new URL(dest, window.location.href);
    if (target.origin !== window.location.origin && loadSession()?.sid) {
      const res = await api.issueHandoffCode(target.hostname);
      if (res.data?.code) {
        target.hash = `${HANDOFF_CODE_PREFIX.slice(1)}${encodeURIComponent(res.data.code)}`;
        url = target.toString();
      }
    }
  } catch {
    // Without a code the target host simply asks the user to sign in again.
    url = dest;
  }
  if (mode === 'replace') window.location.replace(url);
  else window.location.assign(url);
}

function stripHash() {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
}

export function parseHandoff(hash: string): StoredSession | null {
  if (!hash.startsWith(HANDOFF_PREFIX)) return null;
  try {
    const raw = decodeURIComponent(hash.slice(HANDOFF_PREFIX.length));
    const parsed = JSON.parse(atob(raw)) as StoredSession;
    if (!parsed?.sid || !parsed?.user) return null;
    parsed.roles = Array.isArray(parsed.roles) ? parsed.roles : [];
    return parsed;
  } catch {
    return null;
  }
}

let pendingRedeem: Promise<StoredSession | null> | null = null;

/**
 * Reads `#hec_code=` (or the legacy `#hec_handoff=`) from the current URL, removes the fragment immediately and
 * returns the session to store. Safe to call more than once (StrictMode): the code is redeemed a single time.
 */
export function consumeHandoffFromUrl(): Promise<StoredSession | null> {
  if (pendingRedeem) return pendingRedeem;
  if (typeof window === 'undefined') return Promise.resolve(null);
  const hash = window.location.hash || '';
  if (hash.startsWith(HANDOFF_PREFIX)) {
    const legacy = parseHandoff(hash);
    stripHash();
    pendingRedeem = Promise.resolve(legacy);
    return pendingRedeem;
  }
  if (!hash.startsWith(HANDOFF_CODE_PREFIX)) return Promise.resolve(null);
  const code = decodeURIComponent(hash.slice(HANDOFF_CODE_PREFIX.length));
  stripHash();
  pendingRedeem = api
    .redeemHandoffCode(code)
    .then((res) => {
      const data = res.data;
      if (!data?.sid || !data?.user) return null;
      return {
        sid: data.sid,
        user: data.user,
        fullName: data.full_name || data.user,
        roles: Array.isArray(data.roles) ? data.roles : [],
        franchisee: data.franchisee ?? null,
      } satisfies StoredSession;
    })
    .catch(() => null);
  return pendingRedeem;
}
