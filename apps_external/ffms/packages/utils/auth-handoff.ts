export type OfficerAuthHandoff = {
  token: string;
  name: string;
  role: string;
  allowedPages: string[];
};

const HANDOFF_KEYS = ['rfms_token', 'rfms_name', 'rfms_role', 'rfms_pages'] as const;

export function buildOfficerAuthRedirect(origin: string, session: OfficerAuthHandoff) {
  const params = new URLSearchParams({
    rfms_token: session.token,
    rfms_name: session.name,
    rfms_role: session.role,
    rfms_pages: JSON.stringify(session.allowedPages),
  });
  return `${origin.replace(/\/+$/, '')}/?${params.toString()}`;
}

export function readOfficerAuthHandoff(): OfficerAuthHandoff | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('rfms_token');
  if (!token) return null;
  const name = params.get('rfms_name') ?? '';
  const role = params.get('rfms_role') ?? '';
  const pagesRaw = params.get('rfms_pages');
  let allowedPages: string[] = [];
  if (pagesRaw) {
    try {
      allowedPages = JSON.parse(pagesRaw) as string[];
    } catch {
      allowedPages = [];
    }
  }
  return { token, name, role, allowedPages };
}

export function persistOfficerSession(session: OfficerAuthHandoff) {
  sessionStorage.setItem('rfms_auth_token', session.token);
  sessionStorage.setItem('rfms_user_name', session.name);
  sessionStorage.setItem('rfms_user_role', session.role);
  sessionStorage.setItem('rfms_allowed_pages', JSON.stringify(session.allowedPages));
}

export function clearOfficerAuthHandoffFromUrl() {
  const url = new URL(window.location.href);
  HANDOFF_KEYS.forEach((key) => url.searchParams.delete(key));
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', next || '/');
}
