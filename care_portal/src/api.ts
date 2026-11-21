import { AES, API_BASE } from './flavor';

const SESSION_KEY = 'care_session';
export const AES_SESSION_KEY = 'aes_session';
const ERP = '/api/method/health_ecosystem_core.health_ecosystem_core.';

export type StoredSession = { sid: string; user: string; full_name: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function savedSession(): StoredSession | null {
  if (AES) {
    /* Handed over by the Aesthetic console that frames these pages (see AestheticEmbed). */
    try {
      const s = JSON.parse(sessionStorage.getItem(AES_SESSION_KEY) || 'null') as StoredSession | null;
      return s && s.sid ? s : null;
    } catch {
      return null;
    }
  }
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return value && value.sid ? value : null;
  } catch {
    return null;
  }
}

export function storeSession(session: StoredSession | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = savedSession();
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { 'X-Care-Sid': session.sid } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new ApiError(res.status, json.error || `Request failed (${res.status})`);
    if (res.status === 401) window.dispatchEvent(new CustomEvent('care:unauthorized', { detail: error.message }));
    throw error;
  }
  return json.data as T;
}

async function erp<T>(method: string, data?: Record<string, string>): Promise<T> {
  const res = await fetch(`${ERP}${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-Frappe-Site-Name': 'health.localhost',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(data || {}),
  });
  const json = await res.json().catch(() => ({}));
  const m = json && typeof json.message === 'object' && json.message ? json.message : json;
  if (!res.ok || !m || m.status === 'error') {
    throw new ApiError(res.status, String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
  }
  return (m.data !== undefined ? m.data : m) as T;
}

export async function signIn(usr: string, pwd: string): Promise<StoredSession> {
  const data = await erp<{ sid: string; user: string; full_name: string }>('api.authenticate_user', { usr, pwd });
  const session = { sid: data.sid, user: data.user, full_name: data.full_name };
  storeSession(session);
  return session;
}

export async function signOut() {
  const session = savedSession();
  storeSession(null);
  if (!session) return;
  await Promise.allSettled([
    fetch(`${API_BASE}/logout`, { method: 'POST', headers: { 'X-Care-Sid': session.sid } }),
    fetch('/api/method/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: new URLSearchParams({ sid: session.sid }),
    }),
  ]);
}