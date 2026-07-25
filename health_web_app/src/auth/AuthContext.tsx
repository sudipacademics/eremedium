import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, clearSession, SessionUser } from '../api';
import { getDefaultDashboardRoute } from './roles';
import { clearStoredSession, loadSession, saveSession, StoredSession } from './session';

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (usr: string, pwd: string) => Promise<SessionUser>;
  loginWithOtp: (mobile: string, otp: string) => Promise<SessionUser>;
  /** Persist a session from an already-verified API response (OTP / OAuth). */
  applySession: (stored: StoredSession) => SessionUser;
  logout: () => void;
  refreshSession: () => Promise<SessionUser | null>;
  completeOAuthLogin: (sid?: string, loginToken?: string) => Promise<SessionUser>;
  defaultRoute: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => (typeof r === 'string' ? r : String((r as { role?: string })?.role || '')))
    .filter(Boolean);
}

function toSessionUser(stored: StoredSession): SessionUser {
  return {
    user: stored.user,
    fullName: stored.fullName,
    roles: normalizeRoles(stored.roles),
    franchisee: stored.franchisee ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    const stored = loadSession();
    return stored ? toSessionUser(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const stored = loadSession();
    if (!stored?.sid) {
      setUser(null);
      return null;
    }

    try {
      const res = await api.validateSession();
      const data = res.data;
      const next: StoredSession = {
        sid: stored.sid,
        user: data.user,
        fullName: data.full_name,
        roles: data.roles || [],
        franchisee: data.franchisee ?? null,
      };
      saveSession(next);
      const sessionUser = toSessionUser(next);
      setUser(sessionUser);
      return sessionUser;
    } catch {
      clearStoredSession();
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!loadSession()?.sid) {
        if (active) setLoading(false);
        return;
      }
      await refreshSession();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refreshSession]);

  const login = useCallback(async (usr: string, pwd: string) => {
    const res = await api.login(usr, pwd);
    const data = res.data;
    if (!data.sid) {
      throw new Error('Login succeeded but no session was returned');
    }
    const stored: StoredSession = {
      sid: data.sid,
      user: data.user,
      fullName: data.full_name,
      roles: normalizeRoles(data.roles),
      franchisee: data.franchisee ?? null,
    };
    saveSession(stored);
    const sessionUser = toSessionUser(stored);
    setUser(sessionUser);
    return sessionUser;
  }, []);

  const applySession = useCallback((stored: StoredSession) => {
    const next: StoredSession = {
      ...stored,
      roles: normalizeRoles(stored.roles),
    };
    saveSession(next);
    const sessionUser = toSessionUser(next);
    setUser(sessionUser);
    return sessionUser;
  }, []);

  const loginWithOtp = useCallback(
    async (mobile: string, otp: string) => {
      const res = await api.verifyOtpLogin(mobile, otp);
      const data = res.data || ({} as SessionUser);
      const sid = data.sid;
      if (!sid) {
        throw new Error('OTP verification succeeded but no session was returned');
      }
      return applySession({
        sid,
        user: data.user,
        fullName: data.full_name || data.fullName || data.user,
        roles: normalizeRoles(data.roles),
        franchisee: data.franchisee ?? null,
      });
    },
    [applySession],
  );

  const logout = useCallback(() => {
    clearStoredSession();
    clearSession();
    setUser(null);
  }, []);

  const completeOAuthLogin = useCallback(
    async (sid?: string, loginToken?: string) => {
      const res = await api.completeOAuthLogin(sid, loginToken);
      const data = res.data;
      const nextSid = data.sid || sid || loadSession()?.sid;
      if (!nextSid) {
        throw new Error('Google sign-in succeeded but no session was returned');
      }
      return applySession({
        sid: nextSid,
        user: data.user,
        fullName: data.fullName || data.full_name || data.user,
        roles: normalizeRoles(data.roles),
        franchisee: data.franchisee ?? null,
      });
    },
    [applySession],
  );

  const defaultRoute = useMemo(
    () => getDefaultDashboardRoute(user?.roles ?? []),
    [user?.roles],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login,
      loginWithOtp,
      applySession,
      logout,
      refreshSession,
      completeOAuthLogin,
      defaultRoute,
    }),
    [
      user,
      loading,
      login,
      loginWithOtp,
      applySession,
      logout,
      refreshSession,
      completeOAuthLogin,
      defaultRoute,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
