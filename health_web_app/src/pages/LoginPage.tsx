import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { getDefaultDashboardRoute } from '../auth/roles';
import { saveSession } from '../auth/session';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { PasswordField } from '../components/PasswordField';
import { isCareersPortalHost, isPatientPortalHost, isStaffPortalHost } from '../config/portalHosts';

type LoginMode = 'password' | 'otp';

function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => (typeof r === 'string' ? r : String((r as { role?: string })?.role || '')))
    .filter(Boolean);
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { login, isAuthenticated, user } = auth;
  const patientHost = isPatientPortalHost();
  const staffHost = isStaffPortalHost();
  const careersHost = isCareersPortalHost();
  // Careers: applicants use OTP by default; HR uses email/password.
  const passwordFirst = staffHost;
  const [mode, setMode] = useState<LoginMode>(passwordFirst ? 'password' : 'otp');
  const [usr, setUsr] = useState(passwordFirst ? '' : careersHost ? '' : 'patient_demo@health.local');
  const [pwd, setPwd] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;

  if (isAuthenticated && user) {
    const target = from || getDefaultDashboardRoute(user.roles);
    return <Navigate to={target} replace />;
  }

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.sendOtp(mobile.trim());
      setOtpSent(true);
      setOtpHint(res.data.hint || (res.data.test_mode ? 'Test mode: OTP is 123456' : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP');
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Call API directly — do not depend on loginWithOtp (stale PWA bundles omitted it).
      const res = await api.verifyOtpLogin(mobile.trim(), otp.trim());
      const data = res.data;
      if (!data?.sid || !data?.user) {
        throw new Error('OTP verification succeeded but no session was returned');
      }
      const roles = normalizeRoles(data.roles);
      const stored = {
        sid: data.sid,
        user: data.user,
        fullName: data.full_name || data.fullName || data.user,
        roles,
        franchisee: data.franchisee ?? null,
      };
      if (typeof auth.applySession === 'function') {
        auth.applySession(stored);
      } else {
        saveSession(stored);
      }
      const target = from || getDefaultDashboardRoute(roles);
      // Hard navigation avoids router/context races after OTP login.
      window.location.assign(target);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'OTP verification failed';
      setError(
        /is not a function/i.test(raw)
          ? 'App update required — clear site data for e-remedium.in (or hard-refresh), then try OTP again.'
          : raw,
      );
    } finally {
      setLoading(false);
    }
  }

  async function onPasswordLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const sessionUser = await login(usr, pwd);
      const target = from || getDefaultDashboardRoute(sessionUser.roles);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Sign in</h1>
      {careersHost ? (
        <p className="muted">
          Applicants: mobile OTP. HR staff: email and password.
        </p>
      ) : staffHost ? (
        <p className="muted">
          Staff portal — sign in with your ERPNext email and the password issued by your administrator.
        </p>
      ) : (
        <p className="muted">
          Patients: mobile OTP (MSG91) or Google. Staff: email and password.
        </p>
      )}

      {(patientHost || careersHost) && !staffHost && (
        <>
          {patientHost ? <GoogleSignInButton nextPath={from} /> : null}
          {patientHost ? <p className="auth-divider muted">or</p> : null}

          <div className="login-mode-toggle">
            <button
              type="button"
              className={mode === 'otp' ? 'btn btn-sm' : 'btn secondary btn-sm'}
              onClick={() => setMode('otp')}
            >
              Mobile OTP
            </button>
            <button
              type="button"
              className={mode === 'password' ? 'btn btn-sm' : 'btn secondary btn-sm'}
              onClick={() => setMode('password')}
            >
              Email & password
            </button>
          </div>
        </>
      )}

      {staffHost || mode === 'password' ? (
        <form className="form" onSubmit={onPasswordLogin} style={{ marginTop: 16 }}>
          <label>
            Email or username
            <input value={usr} onChange={(e) => setUsr(e.target.value)} required autoComplete="username" />
          </label>
          <PasswordField
            label="Password"
            name="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && <div className="error">{error}</div>}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted" style={{ marginTop: 12 }}>
            <Link to="/forgot-password">Forgot password?</Link>
            {patientHost && (
              <>
                {' · '}
                <Link to="/signup">Create account</Link>
              </>
            )}
          </p>
        </form>
      ) : (
        <form className="form" onSubmit={otpSent ? onVerifyOtp : onSendOtp} style={{ marginTop: 16 }}>
          <label>
            Mobile number
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="10-digit mobile"
              required
              inputMode="numeric"
              autoComplete="tel"
            />
          </label>
          {otpSent && (
            <label>
              OTP
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit code"
                required
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
              />
            </label>
          )}
          {otpHint && <p className="muted">{otpHint}</p>}
          {error && <div className="error">{error}</div>}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : otpSent ? 'Verify & sign in' : 'Send OTP'}
          </button>
        </form>
      )}

      {patientHost && !staffHost && (
        <p className="muted" style={{ marginTop: 24 }}>
          Staff demo: <code>system_admin@health.local</code> / <code>AdminChangeMe@123</code>
        </p>
      )}
    </div>
  );
}
