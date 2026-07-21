import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { getDefaultDashboardRoute } from '../auth/roles';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { PasswordField } from '../components/PasswordField';
import { isPatientPortalHost, isStaffPortalHost } from '../config/portalHosts';

type LoginMode = 'password' | 'otp';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginWithOtp, isAuthenticated, user } = useAuth();
  const patientHost = isPatientPortalHost();
  const staffHost = isStaffPortalHost();
  const [mode, setMode] = useState<LoginMode>(staffHost ? 'password' : 'otp');
  const [usr, setUsr] = useState(staffHost ? '' : 'patient_demo@health.local');
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
      const res = await api.sendOtp(mobile);
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
      const sessionUser = await loginWithOtp(mobile, otp);
      const target = from || getDefaultDashboardRoute(sessionUser.roles);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
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
    <>
      <h1>Sign in</h1>
      {staffHost ? (
        <p className="muted">
          Staff portal — sign in with your ERPNext email and the password issued by your administrator.
        </p>
      ) : (
        <p className="muted">Patients can use mobile OTP or Google. Staff can sign in with email and password.</p>
      )}

      {patientHost && (
        <>
          <GoogleSignInButton nextPath={from} />
          <p className="auth-divider muted">or</p>

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
    </>
  );
}
