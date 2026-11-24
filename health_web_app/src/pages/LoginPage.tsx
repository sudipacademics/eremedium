import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { getDefaultDashboardRoute } from '../auth/roles';
import { saveSession } from '../auth/session';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { PasswordField } from '../components/PasswordField';
import {
  collectorHandoffUrl,
  labtechHandoffUrl,
  navigateWithHandoff,
  partnersHandoffUrl,
  patientHandoffUrl,
} from '../auth/portalHandoff';
import {
  COLLECT_CUTOVER,
  LABTECH_CUTOVER,
  PARTNERS_CUTOVER,
  PATIENT_CUTOVER,
  isB2bPortalHost,
  isCareersPortalHost,
  isCollectPortalHost,
  isLabtechPortalHost,
  isPatientCanonicalHost,
  isPatientPortalHost,
  isPeoplePortalHost,
  isSalesPortalHost,
  isStaffPortalHost,
} from '../config/portalHosts';
import { isFranchisee, isLabTechnician, isPatientPortal, isPhlebotomist } from '../auth/roles';
import { REMEDIUM_BRAND } from '../seo/brandSchema';
import './home-v2.css';
import './login-v2.css';
import './partner-login-v2.css';
import './staff-portal-login.css';

const PARTNER_REMEMBER_KEY = 'hec.partners.rememberUsr';

type LoginMode = 'password' | 'otp';

function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => (typeof r === 'string' ? r : String((r as { role?: string })?.role || '')))
    .filter(Boolean);
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { login, isAuthenticated, user } = auth;
  const patientHost = isPatientPortalHost();
  const staffHost = isStaffPortalHost();
  const careersHost = isCareersPortalHost();
  const partnerHost = isB2bPortalHost();
  const collectHost = isCollectPortalHost();
  const labtechHost = isLabtechPortalHost();
  const peopleHost = isPeoplePortalHost();
  const salesHost = isSalesPortalHost();
  const aestheticsHost =
    typeof window !== 'undefined' && window.location.hostname === 'aesthetics.e-remedium.in';
  const passwordFirst = staffHost || aestheticsHost;
  const dedicatedStaffLogin = peopleHost || salesHost || labtechHost;
  const [mode, setMode] = useState<LoginMode>(passwordFirst ? 'password' : 'otp');
  const [usr, setUsr] = useState('');
  const [pwd, setPwd] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  useEffect(() => {
    if (!partnerHost) return;
    try {
      const saved = localStorage.getItem(PARTNER_REMEMBER_KEY) || '';
      if (saved) {
        setUsr(saved);
        setRemember(true);
      }
    } catch {
      /* ignore */
    }
  }, [partnerHost]);

  const from = (location.state as { from?: string } | null)?.from;

  if (isAuthenticated && user) {
    const target = aestheticsHost ? '/' : from || getDefaultDashboardRoute(user.roles);
    return <Navigate to={target} replace />;
  }

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.sendOtp(mobile.trim());
      setOtpSent(true);
      setOtpHint('OTP sent. Check your SMS.');
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
      const target = aestheticsHost ? '/' : from || getDefaultDashboardRoute(roles);
      if (aestheticsHost) {
        window.location.assign(target);
        return;
      }
      if (isPhlebotomist(roles) && !collectHost && COLLECT_CUTOVER) {
        await navigateWithHandoff(collectorHandoffUrl(target));
        return;
      }
      if (isFranchisee(roles) && !partnerHost && PARTNERS_CUTOVER) {
        await navigateWithHandoff(partnersHandoffUrl(target.startsWith('/b2b') ? target : '/b2b/hub'));
        return;
      }
      if (isLabTechnician(roles) && !labtechHost && LABTECH_CUTOVER) {
        await navigateWithHandoff(labtechHandoffUrl(target));
        return;
      }
      if (isPatientPortal(roles) && PATIENT_CUTOVER && !isPatientCanonicalHost()) {
        await navigateWithHandoff(patientHandoffUrl(target));
        return;
      }
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
      try {
        if (remember) localStorage.setItem(PARTNER_REMEMBER_KEY, usr.trim());
        else localStorage.removeItem(PARTNER_REMEMBER_KEY);
      } catch {
        /* ignore */
      }
      const target = aestheticsHost ? '/' : from || getDefaultDashboardRoute(sessionUser.roles);
      if (aestheticsHost) {
        navigate(target, { replace: true });
        return;
      }
      if (isPhlebotomist(sessionUser.roles) && !collectHost && COLLECT_CUTOVER) {
        await navigateWithHandoff(collectorHandoffUrl(target));
        return;
      }
      if (isFranchisee(sessionUser.roles) && !partnerHost && PARTNERS_CUTOVER) {
        await navigateWithHandoff(partnersHandoffUrl(target.startsWith('/b2b') ? target : '/b2b/hub'));
        return;
      }
      if (isLabTechnician(sessionUser.roles) && !labtechHost && LABTECH_CUTOVER) {
        await navigateWithHandoff(labtechHandoffUrl(target));
        return;
      }
      if (isPatientPortal(sessionUser.roles) && PATIENT_CUTOVER && !isPatientCanonicalHost()) {
        await navigateWithHandoff(patientHandoffUrl(target));
        return;
      }
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  const partnerFeatures = [
    { label: 'View Reports', icon: 'chart' },
    { label: 'Manage Operations', icon: 'grid' },
    { label: 'Access Marketing Materials', icon: 'doc' },
    { label: 'Place Test Requests', icon: 'box' },
    { label: 'View Payments', icon: 'rupee' },
    { label: 'Get Support', icon: 'headset' },
  ];

  if (partnerHost) {
    return (
      <div className="pl2-page" data-partner-login="v2">
        <div className="pl2-lang" aria-label="Language">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
          </svg>
          English
        </div>
        <section className="pl2-brand">
          <div className="pl2-logo">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 3c2.2 3.2 3.4 5.4 3.4 7.6A3.4 3.4 0 1 1 8.6 10.6C8.6 8.4 9.8 6.2 12 3z" fill="#0f766e" />
              <path d="M8 14.5c1.6 1.2 2.8 3 4 6.5 1.2-3.5 2.4-5.3 4-6.5" stroke="#0f766e" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>
              Remedium
              <small>Labs</small>
            </span>
          </div>
          <p className="pl2-tagline">{REMEDIUM_BRAND.tagline}</p>
          <div className="pl2-photo">
            <img src="/home/hero-scientist.jpg" alt="" />
          </div>
          <div className="pl2-copy">
            <h1>Partner Portal</h1>
            <p>Secure access for our franchise partners to manage operations, reports and growth.</p>
          </div>
          <ul className="pl2-features">
            {partnerFeatures.map((f) => (
              <li key={f.label}>
                <span>
                  <Icon>
                    {f.icon === 'chart' ? <path d="M4 19V9M10 19V5M16 19v-7M20 19H3" /> : null}
                    {f.icon === 'grid' ? (
                      <>
                        <rect x="4" y="4" width="7" height="7" rx="1" />
                        <rect x="13" y="4" width="7" height="7" rx="1" />
                        <rect x="4" y="13" width="7" height="7" rx="1" />
                        <rect x="13" y="13" width="7" height="7" rx="1" />
                      </>
                    ) : null}
                    {f.icon === 'doc' ? (
                      <>
                        <path d="M7 3h7l5 5v13H7z" />
                        <path d="M14 3v5h5M9 13h6M9 17h6" />
                      </>
                    ) : null}
                    {f.icon === 'box' ? <path d="M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8M12 13v8" /> : null}
                    {f.icon === 'rupee' ? <path d="M7 5h10M7 10h10M7 5c4 0 6 2.5 6 5s-2 5-6 5H7l6 6" /> : null}
                    {f.icon === 'headset' ? (
                      <>
                        <path d="M4 13a8 8 0 0 1 16 0" />
                        <rect x="3" y="13" width="4" height="6" rx="1" />
                        <rect x="17" y="13" width="4" height="6" rx="1" />
                      </>
                    ) : null}
                  </Icon>
                </span>
                {f.label}
              </li>
            ))}
          </ul>
          <div className="pl2-india">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.2" />
            </svg>
            <div>
              <b>{REMEDIUM_BRAND.seoTagline}</b>
              <small>NABL Accredited · Affordable · Trusted</small>
            </div>
          </div>
        </section>
        <aside className="pl2-card-wrap">
          <div className="pl2-card">
            <div className="pl2-card-head">
              <span>
                <Icon>
                  <circle cx="12" cy="8" r="3.2" />
                  <path d="M5 19a7 7 0 0 1 14 0" />
                </Icon>
              </span>
              <h2>Remedium Labs Partner Portal</h2>
              <p>Franchise operator login required.</p>
            </div>
            {mode === 'password' ? (
              <form className="pl2-form" onSubmit={onPasswordLogin}>
                <label>
                  Mobile Number / Partner ID
                  <span className="pl2-field">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                      <circle cx="12" cy="8" r="3.2" />
                      <path d="M5 19a7 7 0 0 1 14 0" />
                    </svg>
                    <input
                      value={usr}
                      onChange={(e) => setUsr(e.target.value)}
                      placeholder="Enter mobile number or partner ID"
                      required
                      autoComplete="username"
                    />
                  </span>
                </label>
                <label>
                  Password
                  <span className="pl2-field">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                    <input
                      type={showPwd ? 'text' : 'password'}
                      name="password"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      placeholder="Enter password"
                      required
                      autoComplete="current-password"
                    />
                    <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? 'Hide password' : 'Show password'}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </span>
                </label>
                <div className="pl2-row">
                  <label>
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    Remember me
                  </label>
                  <Link to="/forgot-password">Forgot password?</Link>
                </div>
                {error ? <div className="error">{error}</div> : null}
                <button className="pl2-submit" type="submit" disabled={loading}>
                  {loading ? 'Signing in…' : 'Login to Partner Portal'}
                  <span aria-hidden>→</span>
                </button>
                <div className="pl2-or">OR</div>
                <button
                  type="button"
                  className="pl2-otp"
                  onClick={() => {
                    setMode('otp');
                    setError(null);
                    const digits = usr.replace(/\D/g, '');
                    if (digits.length >= 10) setMobile(digits.slice(-10));
                  }}
                >
                  Login with OTP
                </button>
                <p className="pl2-hint">Receive OTP on your registered mobile number.</p>
              </form>
            ) : (
              <form className="pl2-form" onSubmit={otpSent ? onVerifyOtp : onSendOtp}>
                <label>
                  Registered mobile number
                  <span className="pl2-field">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                      <rect x="7" y="2" width="10" height="20" rx="2" />
                      <path d="M11 18h2" />
                    </svg>
                    <input
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="10-digit mobile"
                      required
                      inputMode="numeric"
                      autoComplete="tel"
                    />
                  </span>
                </label>
                {otpSent ? (
                  <label>
                    OTP
                    <span className="pl2-field">
                      <input
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        placeholder="6-digit code"
                        required
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="one-time-code"
                      />
                    </span>
                  </label>
                ) : null}
                {otpHint ? <p className="pl2-hint">{otpHint}</p> : null}
                {error ? <div className="error">{error}</div> : null}
                <button className="pl2-submit" type="submit" disabled={loading}>
                  {loading ? 'Please wait…' : otpSent ? 'Verify & sign in' : 'Send OTP'}
                </button>
                <button
                  type="button"
                  className="pl2-otp"
                  onClick={() => {
                    setMode('password');
                    setError(null);
                    setOtpHint(null);
                  }}
                >
                  Back to password login
                </button>
              </form>
            )}
            <p className="pl2-secure">Secure · Encrypted · For authorized partners only</p>
          </div>
        </aside>
      </div>
    );
  }

  if (dedicatedStaffLogin) {
    const brand = peopleHost
      ? { mark: 'PH', title: 'People Management - SLPL', kicker: 'People Management - SLPL', portal: 'people' as const }
      : labtechHost
        ? { mark: 'LT', title: 'Lab Tech - Smilecure', kicker: 'Lab Tech - Smilecure', portal: 'labtech' as const }
        : { mark: 'RP', title: 'Reach Portal', kicker: 'Reach Portal', portal: 'reach' as const };
    const dedicatedSubtitle = peopleHost
      ? 'Employee portal — sign in with your work email and the password issued by HR.'
      : labtechHost
        ? 'Sign in with your lab email and the password issued by your administrator.'
        : 'Field sales — sign in with your Reach email and the password issued by your administrator.';
    const foot = peopleHost
      ? 'Access is managed by HR in People HRMS → Portal Access.'
      : labtechHost
        ? 'Access is managed by HR in People HRMS → Portal Access → Lab Technician.'
        : 'Access is managed by HR in People HRMS → Portal Access → Reach / Sales.';
    return (
      <div className="spl-page" data-portal={brand.portal}>
        <div className="spl-card">
          {peopleHost || labtechHost ? (
            <div className="spl-brand spl-brand-logo">
              <div className="spl-logo-wrap">
                <img
                  className="spl-logo"
                  src={peopleHost ? '/brand/smilecure-lifestyle.png?v=5' : '/brand/labtech-smilecure-logo.png?v=1'}
                  alt="Smilecure"
                />
              </div>
              <p className="spl-brand-sub">{peopleHost ? 'People Management - SLPL' : 'Lab Tech - Smilecure'}</p>
            </div>
          ) : (
            <div className="spl-brand">
              <div className="spl-brand-mark" aria-hidden>
                {brand.mark}
              </div>
              <span>
                <strong>{brand.title}</strong>
                <small>A unit of Smilecure Lifestyle Pvt. Ltd.</small>
              </span>
            </div>
          )}
          {peopleHost || labtechHost ? null : <p className="spl-kicker">{brand.kicker}</p>}
          <h1>Sign in</h1>
          <p className="spl-muted">{dedicatedSubtitle}</p>
          <form className="spl-form" onSubmit={onPasswordLogin}>
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
            {error ? (
              <p className="spl-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="spl-links">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>
          </form>
          <p className="spl-foot">{foot}</p>
        </div>
      </div>
    );
  }

  const subtitle = collectHost
    ? 'Collector portal — sign in with your collector email and the password issued by your administrator.'
    : labtechHost
    ? 'Lab Technician portal — sign in with your lab email and the password issued by your administrator.'
    : careersHost
    ? 'Applicants: mobile OTP. HR staff: email and password.'
    : staffHost
      ? 'Staff portal — sign in with your ERPNext email and the password issued by your administrator.'
      : 'Patients: mobile OTP or Google. Staff can use email and password.';

  return (
    <div className="home-v2 auth-v2">
      <section className="hv-card auth-shell">
        <div className="auth-visual" aria-hidden>
          <img src="/home/hero-care.jpg" alt="" />
          <div className="auth-visual-copy">
            <strong>Your reports, bookings and member prices in one place.</strong>
            <p>Sign in to book tests, track home collection and join Health Circle.</p>
          </div>
        </div>
        <div className="auth-panel">
          <p className="auth-kicker">{collectHost ? 'Collector portal' : labtechHost ? 'Lab Technician portal' : staffHost ? 'Staff portal' : 'Patient portal'}</p>
          <h1>Sign in</h1>
          <p className="hv-muted">{subtitle}</p>

          {(patientHost || careersHost) && !staffHost ? (
            <>
              {patientHost ? <GoogleSignInButton nextPath={from} /> : null}
              {patientHost ? <p className="auth-divider">or</p> : null}
              <div className="auth-modes">
                <button type="button" className={`auth-mode${mode === 'otp' ? ' is-active' : ''}`} onClick={() => setMode('otp')}>
                  Mobile OTP
                </button>
                <button
                  type="button"
                  className={`auth-mode${mode === 'password' ? ' is-active' : ''}`}
                  onClick={() => setMode('password')}
                >
                  Email & password
                </button>
              </div>
            </>
          ) : null}

          {staffHost || mode === 'password' ? (
            <form className="auth-form" onSubmit={onPasswordLogin}>
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
              {error ? <div className="error">{error}</div> : null}
              <button className="hv-btn" type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              <div className="auth-links">
                <Link className="hv-link" to="/forgot-password">
                  Forgot password?
                </Link>
                {patientHost ? (
                  <Link className="hv-link" to="/signup">
                    Create account
                  </Link>
                ) : null}
              </div>
            </form>
          ) : (
            <form className="auth-form" onSubmit={otpSent ? onVerifyOtp : onSendOtp}>
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
              {otpSent ? (
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
              ) : null}
              {otpHint ? <p className="hv-muted">{otpHint}</p> : null}
              {error ? <div className="error">{error}</div> : null}
              <button className="hv-btn" type="submit" disabled={loading}>
                {loading ? 'Please wait…' : otpSent ? 'Verify & sign in' : 'Send OTP'}
              </button>
              {patientHost ? (
                <div className="auth-links">
                  <span className="hv-muted">New to Remedium?</span>
                  <Link className="hv-link" to="/signup">
                    Create account
                  </Link>
                </div>
              ) : null}
            </form>
          )}
        </div>
      </section>

      {patientHost && !staffHost ? (
        <ul className="auth-trust">
          <li className="hv-card">
            <span className="auth-trust-icon tone-teal">
              <Icon>
                <path d="M7 3.5h4l1.5 3.5-2 1.5a12 12 0 0 0 5 5l1.5-2 3.5 1.5v4A2 2 0 0 1 18.5 19 14.5 14.5 0 0 1 5 5.5 2 2 0 0 1 7 3.5z" />
              </Icon>
            </span>
            <div>
              <strong>Mobile OTP</strong>
              <span>Sign in with your phone</span>
            </div>
          </li>
          <li className="hv-card">
            <span className="auth-trust-icon tone-blue">
              <Icon>
                <circle cx="12" cy="12" r="8" />
                <path d="M8 12h8" />
              </Icon>
            </span>
            <div>
              <strong>Google</strong>
              <span>One tap if you prefer</span>
            </div>
          </li>
          <li className="hv-card">
            <span className="auth-trust-icon tone-violet">
              <Icon>
                <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </Icon>
            </span>
            <div>
              <strong>Secure session</strong>
              <span>Member prices at checkout</span>
            </div>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
