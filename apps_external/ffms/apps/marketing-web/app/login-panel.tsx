'use client';

import { FormEvent, useEffect, useId, useState } from 'react';
import {
  RFMS_ADMIN_ORIGIN,
  RFMS_API_BASE,
  RFMS_PORTAL_ORIGIN,
  appPath,
  buildOfficerAuthRedirect,
} from '@rfms/utils';
import { CompanyLogo, type CompanyProfile } from './company-profile';

type LoginKind = 'Officer' | 'Applicant';
const REMEMBER_KEY = 'rfms_marketing_login_email';
const OFFICER_REMEMBER_KEY = 'rfms_marketing_officer_login_id';
const API_BASE = RFMS_API_BASE;

function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    if (typeof window !== 'undefined') {
      const port = Number(window.location.port);
      if (port >= 4000 && port <= 4002) {
        return 'Unable to reach the RFMS API at http://localhost:9080. Keep the RFMS Isolated Services window open and try again.';
      }
    }
    return 'The local RFMS API is not running. Start the RFMS services and try again.';
  }
  return error instanceof Error ? error.message : fallback;
}

const BRAND_FEATURES = [
  {
    title: 'Trusted Diagnostics',
    copy: 'Accurate reports you can rely on.',
    icon: 'shield',
  },
  {
    title: 'Patient First',
    copy: 'Compassionate care at every step.',
    icon: 'people',
  },
  {
    title: 'Advanced Technology',
    copy: 'State-of-the-art labs for precise results.',
    icon: 'lab',
  },
] as const;

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5 6v6c0 4.4 2.9 8.5 7 9.8 4.1-1.3 7-5.4 7-9.8V6l-7-3Z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19c.8-3.2 3.1-5 6.5-5s5.7 1.8 6.5 5" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.5" width="13" height="10" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="3.5" width="10" height="17" rx="2.5" />
      <circle cx="12" cy="17.5" r="0.8" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14.5V11a8 8 0 0 1 16 0v3.5" />
      <rect x="3" y="13" width="4" height="7" rx="2" />
      <rect x="17" y="13" width="4" height="7" rx="2" />
      <path d="M7 20.5h2.5a2.5 2.5 0 0 0 2.5-2.5v-1" />
    </svg>
  );
}

function BrandFeatureIcon({ kind }: { kind: typeof BRAND_FEATURES[number]['icon'] }) {
  if (kind === 'people') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="9" r="2.6" />
        <circle cx="16.5" cy="10" r="2.1" />
        <path d="M4.5 18.5c.6-2.4 2.4-3.8 4.5-3.8s3.9 1.4 4.5 3.8" />
        <path d="M13.5 18.5c.4-1.7 1.6-2.8 3-2.8 1.1 0 2 .7 2.5 2.1" />
      </svg>
    );
  }
  if (kind === 'lab') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 3h4v5l5.5 9.5a2 2 0 0 1-1.7 3H6.2a2 2 0 0 1-1.7-3L10 8V3Z" />
        <path d="M9 11h6" />
      </svg>
    );
  }
  if (kind === 'shield') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 5 6v6c0 4.4 2.9 8.5 7 9.8 4.1-1.3 7-5.4 7-9.8V6l-7-3Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return null;
}

function DiagnosticCentreArt() {
  return (
    <svg className="login-brand-building" viewBox="0 0 320 130" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="loginBuildingSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eef8fb" />
          <stop offset="100%" stopColor="#d4e9f0" />
        </linearGradient>
        <linearGradient id="loginBuildingGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8fd9d5" />
          <stop offset="100%" stopColor="#0ba6a2" />
        </linearGradient>
      </defs>
      <rect width="320" height="130" fill="url(#loginBuildingSky)" />
      <ellipse cx="160" cy="122" rx="132" ry="12" fill="rgb(6 45 94 / 10%)" />
      <rect x="48" y="34" width="224" height="88" rx="8" fill="#f7fcfd" stroke="#b8d9df" strokeWidth="1.5" />
      <rect x="62" y="46" width="44" height="64" rx="5" fill="url(#loginBuildingGlass)" opacity="0.95" />
      <rect x="114" y="46" width="44" height="64" rx="5" fill="url(#loginBuildingGlass)" opacity="0.85" />
      <rect x="166" y="46" width="44" height="64" rx="5" fill="url(#loginBuildingGlass)" opacity="0.95" />
      <rect x="218" y="46" width="28" height="64" rx="5" fill="url(#loginBuildingGlass)" opacity="0.75" />
      <path d="M44 34h232l-16-18H60L44 34Z" fill="#0ba6a2" />
      <rect x="104" y="78" width="112" height="44" rx="6" fill="#fff" stroke="#9fd5d2" strokeWidth="1.5" />
      <text x="160" y="96" textAnchor="middle" fill="#062d5e" fontSize="11" fontWeight="700" fontFamily="Manrope, sans-serif">REMEDIUM LAB</text>
      <text x="160" y="110" textAnchor="middle" fill="#23864b" fontSize="8" fontWeight="700" fontFamily="DM Sans, sans-serif" letterSpacing="1">DIAGNOSTIC CENTRE</text>
      <rect x="132" y="116" width="56" height="6" rx="3" fill="#23864b" />
    </svg>
  );
}

export function LoginPanel({
  profile,
  kind,
  setKind,
  close,
}: {
  profile: CompanyProfile;
  kind: LoginKind;
  setKind: (value: LoginKind) => void;
  close: () => void;
}) {
  const titleId = useId();
  const [otp, setOtp] = useState(false);
  const [mobileMode, setMobileMode] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [mobile, setMobile] = useState('');
  const [otpValue, setOtpValue] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const storedOfficer = localStorage.getItem(OFFICER_REMEMBER_KEY);
    const storedEmail = localStorage.getItem(REMEMBER_KEY);
    if (storedOfficer) {
      setLoginId(storedOfficer);
      setRememberMe(true);
    } else if (storedEmail) {
      setEmail(storedEmail);
      setLoginId(storedEmail);
      setRememberMe(true);
    }
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close]);

  function resetFlow() {
    setOtp(false);
    setMobileMode(false);
    setChallengeId('');
    setOtpValue('');
    setMessage('');
    setError('');
  }

  async function handleCredentialSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (kind === 'Officer') {
        const identifier = loginId.trim();
        if (rememberMe && identifier) localStorage.setItem(OFFICER_REMEMBER_KEY, identifier);
        else localStorage.removeItem(OFFICER_REMEMBER_KEY);
        const response = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login_id: identifier, password, role_type: 'officer' }),
        });
        const payload = await response.json().catch(() => null) as {
          success?: boolean;
          data?: { token?: string; user?: { name?: string; role?: string; allowed_pages?: string[] } };
          error?: { message?: string };
        } | null;
        if (!response.ok || !payload?.success || !payload.data?.token || !payload.data.user?.name || !payload.data.user?.role) {
          throw new Error(payload?.error?.message ?? 'Unable to sign in.');
        }
        const allowedPages = Array.isArray(payload.data.user.allowed_pages) ? payload.data.user.allowed_pages : [];
        window.location.href = buildOfficerAuthRedirect(RFMS_ADMIN_ORIGIN, {
          token: payload.data.token,
          name: payload.data.user.name,
          role: payload.data.user.role,
          allowedPages,
        });
        return;
      }
      if (rememberMe && email.trim()) localStorage.setItem(REMEMBER_KEY, email.trim());
      else localStorage.removeItem(REMEMBER_KEY);
      const response = await fetch(`${API_BASE}/applicant/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email.trim() }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { challenge_id?: string; masked_mobile?: string; test_mode?: boolean }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.challenge_id) {
        throw new Error(payload?.error?.message ?? 'Unable to send OTP.');
      }
      setChallengeId(payload.data.challenge_id);
      setMessage(payload.data.test_mode
        ? `OTP sent to ${payload.data.masked_mobile ?? 'your registered mobile number'}. Test mode: use 123456.`
        : `OTP sent to ${payload.data.masked_mobile ?? 'your registered mobile number'} via SMS.`);
      setOtp(true);
    } catch (requestError) {
      setError(networkErrorMessage(requestError, kind === 'Officer' ? 'Unable to sign in.' : 'Unable to send OTP.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleMobileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind !== 'Applicant') {
      setError('Officer sign-in uses company ID and password.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_BASE}/applicant/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: mobile.trim() }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { challenge_id?: string; masked_mobile?: string; test_mode?: boolean }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.challenge_id) {
        throw new Error(payload?.error?.message ?? 'Unable to send OTP.');
      }
      setChallengeId(payload.data.challenge_id);
      setMessage(payload.data.test_mode
        ? `OTP sent to ${payload.data.masked_mobile ?? 'your registered mobile number'}. Test mode: use 123456.`
        : `OTP sent to ${payload.data.masked_mobile ?? 'your registered mobile number'} via SMS.`);
      setOtp(true);
    } catch (requestError) {
      setError(networkErrorMessage(requestError, 'Unable to send OTP.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) {
      setError('Request a fresh OTP before continuing.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (kind === 'Officer') {
        setError('Officer OTP login is disabled. Sign in with your company ID and password.');
        setOtp(false);
        return;
      }
      const response = await fetch(`${API_BASE}/applicant/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: challengeId, otp: otpValue }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { token?: string }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.token) {
        throw new Error(payload?.error?.message ?? 'Unable to verify OTP.');
      }
      const params = new URLSearchParams({ rfms_applicant_token: payload.data.token, view: 'profile' });
      window.location.href = `${RFMS_PORTAL_ORIGIN}/?${params.toString()}`;
    } catch (requestError) {
      setError(networkErrorMessage(requestError, 'Unable to verify OTP.'));
    } finally {
      setBusy(false);
    }
  }

  function switchKind(next: LoginKind) {
    setKind(next);
    resetFlow();
  }

  return (
    <div className="login-overlay" onClick={close}>
      <section
        className="login-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="login-brand" aria-label={`${profile.company_name} branding`}>
          <div className="login-brand-pattern" aria-hidden="true" />
          <div className="login-brand-content">
            <header className="login-brand-header">
              <CompanyLogo profile={profile} className="login-brand-logo" />
              <p className="login-brand-unit">{profile.legal_name.toUpperCase()}</p>
              <p className="login-brand-promise">Transparency, Accuracy &amp; Speed – Our promise To you</p>
            </header>

            <div className="login-brand-message">
              <h2>
                Building a <em>Healthier</em> Tomorrow Together
              </h2>
              <div className="login-brand-accent" aria-hidden="true" />
              <p>Empowering diagnostic excellence with trust, technology and transparency.</p>
            </div>

            <ul className="login-brand-features">
              {BRAND_FEATURES.map((feature) => (
                <li key={feature.title}>
                  <span className="login-brand-feature-icon">
                    <BrandFeatureIcon kind={feature.icon} />
                  </span>
                  <span>
                    <strong>{feature.title}</strong>
                    <small>{feature.copy}</small>
                  </span>
                </li>
              ))}
            </ul>

            <div className="login-brand-visual">
              <DiagnosticCentreArt />
              <div className="login-brand-waves" aria-hidden="true" />
            </div>
          </div>
        </aside>

        <div className="login-form-panel">
          <button type="button" className="login-close" onClick={close} aria-label="Close login dialog">
            ×
          </button>

          <header className="login-form-header">
            <h2 id={titleId}>Welcome back!</h2>
            <p>Login to continue to {profile.company_name}.</p>
          </header>

          <div className="login-role-tabs" role="tablist" aria-label="Login role">
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'Officer'}
              className={kind === 'Officer' ? 'is-active' : ''}
              onClick={() => switchKind('Officer')}
            >
              <ShieldIcon />
              Officer Login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'Applicant'}
              className={kind === 'Applicant' ? 'is-active' : ''}
              onClick={() => switchKind('Applicant')}
            >
              <UserIcon />
              Applicant Login
            </button>
          </div>

          {error ? <p className="login-alert" role="alert">{error}</p> : null}
          {message ? <p className="login-message">{message}</p> : null}

          {otp ? (
            <form className="login-form" onSubmit={handleOtpSubmit}>
              <label className="login-field">
                <span>OTP</span>
                <div className="login-input-wrap">
                  <LockIcon />
                  <input
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="Enter 6-digit OTP"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={otpValue}
                    onChange={(event) => setOtpValue(event.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <small>A one-time password has been sent for verification.</small>
              </label>
              <button type="button" className="login-text-action" onClick={() => setOtp(false)}>
                Back to {mobileMode ? 'mobile login' : 'email login'}
              </button>
              <button type="submit" className="login-primary" disabled={busy}>
                <LockIcon />
                {busy ? 'Verifying...' : 'Verify and continue'}
              </button>
            </form>
          ) : mobileMode && kind === 'Applicant' ? (
            <form className="login-form" onSubmit={handleMobileSubmit}>
              <label className="login-field">
                <span>Mobile number</span>
                <div className="login-input-wrap">
                  <PhoneIcon />
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="Enter your mobile number"
                    value={mobile}
                    onChange={(event) => setMobile(event.target.value)}
                  />
                </div>
              </label>
              <button type="submit" className="login-primary" disabled={busy}>
                <LockIcon />
                {busy ? 'Sending OTP...' : 'Login & Send OTP'}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleCredentialSubmit}>
              {kind === 'Officer' ? (
                <label className="login-field">
                  <span>Company ID</span>
                  <div className="login-input-wrap">
                    <UserIcon />
                    <input
                      required
                      type="text"
                      autoComplete="username"
                      placeholder="e.g. RFMS-0001"
                      value={loginId}
                      onChange={(event) => setLoginId(event.target.value)}
                    />
                  </div>
                  <small>Use the company ID issued by Remedium Lab. No OTP is required.</small>
                </label>
              ) : (
                <label className="login-field">
                  <span>Email ID</span>
                  <div className="login-input-wrap">
                    <MailIcon />
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      placeholder="Enter your email ID"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                </label>
              )}

              <label className="login-field">
                <span className="login-label-row">
                  Password
                  <a className="login-forgot" href={appPath('/contact-us')}>
                    Forgot Password?
                  </a>
                </span>
                <div className="login-input-wrap">
                  <LockIcon />
                  <input required type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </div>
              </label>

              <label className="login-remember">
                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                Remember me
              </label>

              <button type="submit" className="login-primary" disabled={busy}>
                <LockIcon />
                {kind === 'Officer'
                  ? (busy ? 'Signing in...' : 'Sign in')
                  : (busy ? 'Sending OTP...' : 'Login & Send OTP')}
              </button>
            </form>
          )}

          {!otp && kind === 'Applicant' ? (
            <>
              <div className="login-divider" role="presentation">
                <span>or</span>
              </div>
              <button
                type="button"
                className="login-secondary"
                onClick={() => {
                  setMobileMode((current) => !current);
                  setOtp(false);
                }}
              >
                <PhoneIcon />
                {mobileMode ? 'Login with Email ID' : 'Login with Mobile Number'}
              </button>
            </>
          ) : null}

          <footer className="login-footer">
            <div className="login-footer-card">
              <HeadsetIcon />
              {kind === 'Applicant' ? (
                <p>
                  New user? <a href={RFMS_PORTAL_ORIGIN}>Create account</a>
                  <span className="login-footer-sep"> · </span>
                  Need access? <a href={appPath('/contact-us')}>Contact Administrator</a>
                </p>
              ) : (
                <p>
                  Need access? <a href={appPath('/contact-us')}>Contact Administrator</a>
                </p>
              )}
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}
