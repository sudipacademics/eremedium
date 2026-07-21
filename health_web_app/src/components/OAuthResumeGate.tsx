import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getDefaultDashboardRoute } from '../auth/roles';

const OAUTH_PENDING_KEY = 'hec_oauth_pending';

function hasOAuthHandoff(search: string) {
  return (
    search.includes('login_token=') ||
    search.includes('oauth_error=') ||
    search.includes('sid=')
  );
}

export function markOAuthPending() {
  sessionStorage.setItem(OAUTH_PENDING_KEY, '1');
}

/** Recover Google sign-in when landing on / or /me without the SPA callback route. */
export function OAuthResumeGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, loading, completeOAuthLogin } = useAuth();
  const resumeRef = useRef(false);

  useEffect(() => {
    const { pathname, search } = location;

    if (pathname !== '/oauth/callback' && hasOAuthHandoff(search)) {
      navigate(`/oauth/callback${search}`, { replace: true });
      return;
    }

    if (isAuthenticated || resumeRef.current) {
      sessionStorage.removeItem(OAUTH_PENDING_KEY);
      return;
    }

    const pending = sessionStorage.getItem(OAUTH_PENDING_KEY);
    const shouldResume = pending || pathname === '/me';
    if (!shouldResume) {
      return;
    }

    if (loading) {
      return;
    }

    resumeRef.current = true;
    sessionStorage.removeItem(OAUTH_PENDING_KEY);

    if (pathname !== '/oauth/callback') {
      navigate(`/oauth/callback${search}`, { replace: true });
      return;
    }

    void (async () => {
      try {
        const params = new URLSearchParams(search);
        const user = await completeOAuthLogin(
          params.get('sid') || undefined,
          params.get('login_token') || undefined,
        );
        navigate(getDefaultDashboardRoute(user.roles), { replace: true });
      } catch {
        resumeRef.current = false;
      }
    })();
  }, [
    completeOAuthLogin,
    isAuthenticated,
    loading,
    location.pathname,
    location.search,
    navigate,
  ]);

  return null;
}
