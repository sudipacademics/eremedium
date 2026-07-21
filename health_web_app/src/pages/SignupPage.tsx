import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { PasswordField } from '../components/PasswordField';

export function SignupPage() {
  const { isAuthenticated, user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      });
      setSuccess(res.message || 'Check your email to verify your account before signing in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1>Create account</h1>
      <p className="muted">Sign up with your email. We will send a verification link before you can sign in.</p>

      <form className="form" onSubmit={onSubmit} style={{ marginTop: 16 }}>
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
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Sign up'}
        </button>
      </form>

      <p className="muted" style={{ marginTop: 24 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </>
  );
}
