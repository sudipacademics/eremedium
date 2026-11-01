import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { PasswordField } from '../components/PasswordField';
import './home-v2.css';
import './login-v2.css';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function SignupPage() {
  const { isAuthenticated, user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get('ref') || params.get('referral_code') || '').trim().toUpperCase();
    if (ref) setReferralCode(ref);
  }, []);

  if (isAuthenticated && user) {
    return <Navigate to="/account" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await api.registerPatient({
        email,
        password,
        full_name: fullName,
        ...(mobile ? { mobile } : {}),
        ...(dob ? { dob } : {}),
        ...(gender ? { gender } : {}),
        ...(city ? { city } : {}),
        ...(referralCode.trim() ? { referral_code: referralCode.trim().toUpperCase() } : {}),
      });
      setSuccess(res.message || 'Check your email to verify your account before signing in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="home-v2 auth-v2">
      <section className="hv-card auth-shell auth-shell-signup">
        <div className="auth-visual" aria-hidden>
          <img src="/home/hero-care.jpg" alt="" />
          <div className="auth-visual-copy">
            <strong>Create your Remedium account in a minute.</strong>
            <p>Book tests, track home collection and unlock Health Circle member prices.</p>
          </div>
        </div>
        <div className="auth-panel">
          <p className="auth-kicker">Patient portal</p>
          <h1>Create account</h1>
          <p className="hv-muted">Sign up with your email. We will send a verification link before you can sign in.</p>

          <form className="auth-form" onSubmit={onSubmit}>
            <label>
              Full name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <div className="auth-form-grid">
              <label>
                Mobile (optional)
                <input
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="10-digit mobile"
                  inputMode="numeric"
                  autoComplete="tel"
                />
              </label>
              <label>
                City (optional)
                <input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
              </label>
              <label>
                Date of birth (optional)
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </label>
              <label>
                Gender (optional)
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            </div>
            <label>
              Referral code (optional)
              <input
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder="e.g. REMABC123"
                autoComplete="off"
              />
            </label>
            <PasswordField
              label="Password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <PasswordField
              label="Confirm password"
              name="confirm-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            {error ? <div className="error">{error}</div> : null}
            {success ? <div className="success">{success}</div> : null}
            <button className="hv-btn" type="submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Sign up'}
            </button>
            <div className="auth-links">
              <span className="hv-muted">Already have an account?</span>
              <Link className="hv-link" to="/login">
                Sign in
              </Link>
            </div>
          </form>
        </div>
      </section>

      <ul className="auth-trust">
        <li className="hv-card">
          <span className="auth-trust-icon tone-teal">
            <Icon>
              <rect x="4" y="6" width="16" height="12" rx="2" />
              <path d="M4 9l8 5 8-5" />
            </Icon>
          </span>
          <div>
            <strong>Email verification</strong>
            <span>Activate before you sign in</span>
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
            <strong>Secure account</strong>
            <span>Your details stay private</span>
          </div>
        </li>
        <li className="hv-card">
          <span className="auth-trust-icon tone-amber">
            <Icon>
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
            </Icon>
          </span>
          <div>
            <strong>Member prices</strong>
            <span>Join Health Circle after signup</span>
          </div>
        </li>
      </ul>
    </div>
  );
}
