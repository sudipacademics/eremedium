const STORAGE_KEY = 'hec_web_session';

export type FranchiseeProfile = {
  name: string;
  branch_code?: string;
  franchise_name?: string;
  territory_region?: string;
  commission_percentage_rate?: number;
};

export type StoredSession = {
  sid: string;
  user: string;
  fullName?: string;
  roles: string[];
  franchisee?: FranchiseeProfile | null;
};

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.sid || !parsed?.user) return null;
    parsed.roles = Array.isArray(parsed.roles) ? parsed.roles : [];
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getSid(): string | null {
  return loadSession()?.sid ?? null;
}
