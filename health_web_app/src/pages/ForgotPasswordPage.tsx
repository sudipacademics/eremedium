import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.forgotPassword(email);
      setSuccess(
        res.message ||
          'If an account exists for this email, you will receive password reset instructions shortly.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1>Reset password</h1>
      <p className="muted">Enter your email and we will send a secure reset link from ERPNext.</p>

      <form className="form" onSubmit={onSubmit} style={{ marginTop: 16 }}>
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
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="muted" style={{ marginTop: 24 }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </>
  );
}
