import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isHrRecruiter } from '../auth/roles';
import { PasswordField } from '../components/PasswordField';
import './hr-login.css';

/**
 * Dedicated HR staff login — separate from Agents (/agents) and patient OTP login.
 * Always routes successful HR identities to /people/recruitment.
 */
export function HrLoginPage() {
  const navigate = useNavigate();
  const { login, isAuthenticated, user, logout } = useAuth();
  const [usr, setUsr] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated && user) {
    if (isHrRecruiter(user.roles)) {
      return <Navigate to="/people/recruitment" replace />;
    }
    return (
      <div className="hr-login-page">
        <div className="hr-login-card">
          <p className="hr-login-kicker">HR portal</p>
          <h1>HR login required</h1>
          <p className="muted">
            You are signed in as <b>{user.fullName || user.user}</b>, but this account is not an HR Manager /
            HR User. Sign out and use your HR credentials, or open the Agents portal if you are an agency
            partner.
          </p>
          <div className="hr-login-actions">
            <button type="button" className="btn" onClick={() => logout()}>
              Sign out
            </button>
            <Link className="btn secondary" to="/agents">
              Go to Agents portal
            </Link>
          </div>
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const sessionUser = await login(usr.trim(), pwd);
      if (!isHrRecruiter(sessionUser.roles)) {
        setError(
          'This account is not an HR login. Use Agency Agent credentials on /agents, or ask admin to assign HR Manager.',
        );
        logout();
        return;
      }
      navigate('/people/recruitment', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'HR login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="hr-login-page">
      <div className="hr-login-card">
        <p className="hr-login-kicker">Remedium · Human Resources</p>
        <h1>HR staff login</h1>
        <p className="muted">
          Separate from the Agency Agents portal. Sign in with your HR email and password to open recruitment
          and people workflows.
        </p>
        <form className="hr-login-form" onSubmit={(event) => void onSubmit(event)}>
          <label>
            HR email / User ID
            <input
              autoComplete="username"
              required
              value={usr}
              onChange={(event) => setUsr(event.target.value)}
              placeholder="hr_manager@…"
            />
          </label>
          <PasswordField
            label="Password"
            required
            autoComplete="current-password"
            value={pwd}
            onChange={(event) => setPwd(event.target.value)}
          />
          {error ? (
            <p className="hr-login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in to HR'}
          </button>
        </form>
        <p className="hr-login-foot muted">
          Agency partners use <Link to="/agents">Agents portal</Link> · Employees use{' '}
          <Link to="/people">People HRMS</Link> · Patients use <Link to="/login">main login</Link>
        </p>
      </div>
    </div>
  );
}
