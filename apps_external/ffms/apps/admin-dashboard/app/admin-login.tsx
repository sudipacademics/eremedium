'use client';

import { FormEvent, useState } from 'react';
import { RFMS_API_BASE, type AdminPage } from '@rfms/utils';

type AdminSession = { token: string; name: string; role: string; allowedPages: string[] };
const API_BASE = RFMS_API_BASE;

function displayError(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    if (typeof window !== 'undefined') {
      const port = Number(window.location.port);
      if (port >= 4000 && port <= 4002) return 'Unable to reach the RFMS API at http://localhost:9080. Keep the RFMS Isolated Services window open and hard-refresh this page.';
    }
    return 'The local RFMS API is not running. Close this window and start run-admin.cmd again.';
  }
  return error instanceof Error ? error.message : fallback;
}

export function AdminLogin({ onAuthenticated }: { onAuthenticated: (session: { token: string; name: string; role: string; allowedPages: AdminPage[] }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/auth/otp/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, role_type: 'officer' }) });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to send OTP.');
      setChallengeId(payload.data.challenge_id);
      setMessage('OTP sent to the registered mobile number.');
    } catch (requestError) {
      setMessage(displayError(requestError, 'Unable to send OTP.'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/auth/otp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: challengeId, otp }) });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to verify OTP.');
      const allowedPages = Array.isArray(payload.data.user?.allowed_pages) ? payload.data.user.allowed_pages as string[] : [];
      const session: AdminSession = { token: payload.data.token, name: payload.data.user.name, role: payload.data.user.role, allowedPages };
      sessionStorage.setItem('rfms_auth_token', session.token);
      sessionStorage.setItem('rfms_user_name', session.name);
      sessionStorage.setItem('rfms_user_role', session.role);
      sessionStorage.setItem('rfms_allowed_pages', JSON.stringify(allowedPages));
      onAuthenticated({ token: session.token, name: session.name, role: session.role, allowedPages: allowedPages as AdminPage[] });
    } catch (requestError) {
      setMessage(displayError(requestError, 'Unable to verify OTP.'));
    } finally {
      setBusy(false);
    }
  }

  return <main className="admin-login-page"><section className="admin-login-card"><div className="admin-login-brand"><span>R</span><div><b>Remedium Lab</b><small>Franchise Management System</small></div></div><h1>Officer sign in</h1><p>Use your registered email, password and mobile OTP to access RFMS operations.</p>{challengeId ? <form onSubmit={verifyOtp}><label>One-time password<input value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" placeholder="6-digit OTP" required /></label><button disabled={busy}>{busy ? 'Verifying...' : 'Verify and continue'}</button><button className="login-link" type="button" onClick={() => { setChallengeId(''); setOtp(''); setMessage(''); }}>Use another account</button></form> : <form onSubmit={requestOtp}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button disabled={busy}>{busy ? 'Sending OTP...' : 'Continue with OTP'}</button></form>}{message ? <small className="login-message">{message}</small> : null}</section></main>;
}
