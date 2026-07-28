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
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: loginId.trim(), password, role_type: 'officer' }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to sign in.');
      const allowedPages = Array.isArray(payload.data.user?.allowed_pages) ? payload.data.user.allowed_pages as string[] : [];
      const session: AdminSession = { token: payload.data.token, name: payload.data.user.name, role: payload.data.user.role, allowedPages };
      sessionStorage.setItem('rfms_auth_token', session.token);
      sessionStorage.setItem('rfms_user_name', session.name);
      sessionStorage.setItem('rfms_user_role', session.role);
      sessionStorage.setItem('rfms_allowed_pages', JSON.stringify(allowedPages));
      onAuthenticated({ token: session.token, name: session.name, role: session.role, allowedPages: allowedPages as AdminPage[] });
    } catch (requestError) {
      setMessage(displayError(requestError, 'Unable to sign in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <div className="admin-login-brand">
          <span>R</span>
          <div>
            <b>Remedium Lab</b>
            <small>Franchise Management System</small>
          </div>
        </div>
        <h1>Officer sign in</h1>
        <p>Use the company ID and password issued by Remedium Lab. No OTP is required.</p>
        <form onSubmit={signIn}>
          <label>
            Company ID
            <input
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              autoComplete="username"
              placeholder="e.g. RFMS-0001"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
        {message ? <small className="login-message">{message}</small> : null}
      </section>
    </main>
  );
}
