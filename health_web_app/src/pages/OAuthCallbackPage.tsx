import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getDefaultDashboardRoute } from '../auth/roles';
import type { SessionUser } from '../api';

export function OAuthCallbackPage() {
  const [params] = useSearchParams();
  const { completeOAuthLogin } = useAuth();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('Completing Google sign-in…');
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const startedRef = useRef(false);

  const nextPath = params.get('next') || undefined;
  const sid = params.get('sid') || undefined;
  const loginToken = params.get('login_token') || undefined;
  const oauthError = params.get('oauth_error') || undefined;

  useEffect(() => {
    if (oauthError) {
      setStatus('error');
      setMessage(oauthError);
      return;
    }

    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    let active = true;
    void (async () => {
      try {
        const user = await completeOAuthLogin(sid, loginToken);
        if (!active) return;
        setSessionUser(user);
        setStatus('ok');
        setMessage(`Welcome${user.fullName ? `, ${user.fullName}` : ''}.`);
      } catch (err) {
        if (!active) return;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Google sign-in failed');
      }
    })();
    return () => {
      active = false;
    };
  }, [completeOAuthLogin, sid, loginToken, oauthError]);

  if (status === 'ok' && sessionUser) {
    const target = nextPath?.startsWith('/') ? nextPath : getDefaultDashboardRoute(sessionUser.roles);
    return <Navigate to={target} replace />;
  }

  return (
    <>
      <h1>Google sign-in</h1>
      <p className={status === 'error' ? 'error' : status === 'ok' ? 'success' : 'muted'}>{message}</p>
      {status === 'error' && (
        <p style={{ marginTop: 16 }}>
          <Link className="btn" to="/login">
            Back to sign in
          </Link>
        </p>
      )}
    </>
  );
}
