import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your email…');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }

    let active = true;
    (async () => {
      try {
        const res = await api.verifyEmail(token);
        if (!active) return;
        setStatus('ok');
        setMessage(res.message || 'Email verified. You can sign in now.');
      } catch (err) {
        if (!active) return;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Verification failed');
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <>
      <h1>Email verification</h1>
      <p className={status === 'error' ? 'error' : status === 'ok' ? 'success' : 'muted'}>{message}</p>
      {status === 'ok' && (
        <p style={{ marginTop: 16 }}>
          <Link className="btn" to="/login">
            Sign in
          </Link>
        </p>
      )}
      {status === 'error' && (
        <p className="muted" style={{ marginTop: 16 }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      )}
    </>
  );
}
