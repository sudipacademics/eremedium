import { useState, type FormEvent } from 'react';
import { signIn } from '../api';
import { LOGO_URL } from '../invoicePrint';

export function Brand({ light }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <img src={LOGO_URL} alt="Remedium Care — Integrated Care for Total Pain Relief" />
    </div>
  );
}

export function LoginScreen({ message, onSignedIn }: { message?: string; onSignedIn: () => void }) {
  const [usr, setUsr] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(message || '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(usr.trim(), pwd);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <Brand />
        <h1>Backend Portal</h1>
        <p className="muted">Sign in with your Smilecure staff login.</p>
        <form onSubmit={submit} className="gate-form">
          <label className="field">
            <span>Email or username</span>
            <input value={usr} onChange={(e) => setUsr(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="gate-foot">
          Access is managed by HR in People HRMS → Portal Access → <strong>Care Backend</strong>.
        </p>
      </div>
    </div>
  );
}

export function GateMessage({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <Brand />
        <h1>{title}</h1>
        <p className="muted">{text}</p>
        <button type="button" className="btn btn-primary block" onClick={onAction}>
          {action}
        </button>
      </div>
    </div>
  );
}
