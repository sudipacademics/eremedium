import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';

/** Illustrative daily costs for the promo hero (not a live quote). */
const CIGARETTE_PER_DAY = 25;
const INSURANCE_PER_DAY = 18;

export function InsuranceLandingPage() {
  const { user, isAuthenticated } = useAuth();
  const [agentNote, setAgentNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    city: '',
    interest: 'Family health cover',
    message: '',
  });

  useEffect(() => {
    api
      .getInsuranceLanding()
      .then((res) => setAgentNote(res.data.agent_note || ''))
      .catch(() => {
        /* landing copy is static; ignore API failures for hero */
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      full_name: f.full_name || user.fullName || '',
      email: f.email || (user.user.includes('@') ? user.user : ''),
    }));
  }, [user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const notes = [
        form.interest ? `Interest: ${form.interest}` : '',
        form.city ? `City: ${form.city}` : '',
        form.message ? form.message : '',
      ]
        .filter(Boolean)
        .join('\n');
      await api.submitInsuranceQuoteRequest({
        customer_name: form.full_name,
        phone: form.phone,
        ...(form.email ? { email: form.email } : {}),
        ...(notes ? { notes } : {}),
      });
      setSuccess('Thanks — our insurance advisor will contact you within 24 hours.');
      setForm((f) => ({ ...f, message: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request');
    } finally {
      setBusy(false);
    }
  }

  const savings = CIGARETTE_PER_DAY - INSURANCE_PER_DAY;

  return (
    <div className="insurance-page">
      <section className="insurance-hero">
        <div className="insurance-hero-copy">
          <p className="brand-kicker">Health insurance</p>
          <h1>
            Protect your family for less than the cost of a cigarette
          </h1>
          <p className="hero-lead">
            A basic health cover can work out to about ₹{INSURANCE_PER_DAY}/day — roughly ₹{savings}{' '}
            less than one cigarette (~₹{CIGARETTE_PER_DAY}). Skip the smoke. Keep the safety net.
          </p>
          <div className="insurance-compare">
            <article className="insurance-compare-card is-smoke">
              <span className="insurance-compare-label">1 cigarette</span>
              <strong>≈ ₹{CIGARETTE_PER_DAY}</strong>
              <span>per day habit</span>
            </article>
            <div className="insurance-compare-vs" aria-hidden="true">
              vs
            </div>
            <article className="insurance-compare-card is-cover">
              <span className="insurance-compare-label">Health cover</span>
              <strong>≈ ₹{INSURANCE_PER_DAY}</strong>
              <span>per day (illustrative)</span>
            </article>
          </div>
          <p className="muted insurance-disclaimer">
            Figures are indicative for awareness — not a premium quote. Final cost depends on age,
            sum insured, and underwriting.
          </p>
          <a className="btn" href="#insurance-contact">
            Contact us for a quote
          </a>
        </div>
      </section>

      {agentNote ? (
        <p className="muted insurance-agent-note">{agentNote}</p>
      ) : (
        <p className="muted insurance-agent-note">
          We help you explore GIC / LIC health products as a licensed agent. No online policy
          checkout — an advisor will guide you.
        </p>
      )}

      <section id="insurance-contact" className="card card-wide insurance-contact-card">
        <h2>Contact us</h2>
        <p className="muted">
          Tell us how to reach you. We will call back with options that fit your family — not a
          shopping cart of policies.
        </p>

        {error ? <div className="error">{error}</div> : null}
        {success ? <div className="success">{success}</div> : null}

        {!isAuthenticated ? (
          <p className="muted">
            <Link to="/login" state={{ from: '/insurance' }}>
              Sign in
            </Link>{' '}
            to send your details securely, or leave a message after login.
          </p>
        ) : null}

        <form
          className="form insurance-contact-form"
          onSubmit={(e) => void onSubmit(e)}
        >
          <label>
            Full name *
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
              autoComplete="name"
            />
          </label>
          <label>
            Mobile *
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              autoComplete="email"
            />
          </label>
          <label>
            City
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              autoComplete="address-level2"
            />
          </label>
          <label>
            I am interested in
            <select
              value={form.interest}
              onChange={(e) => setForm({ ...form, interest: e.target.value })}
            >
              <option>Family health cover</option>
              <option>Individual cover</option>
              <option>Senior citizen plan</option>
              <option>Critical illness</option>
              <option>Top-up / super top-up</option>
              <option>Not sure — advise me</option>
            </select>
          </label>
          <label>
            Message
            <textarea
              rows={4}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Preferred call time, family size, or questions…"
            />
          </label>
          <button className="btn" type="submit" disabled={busy || !isAuthenticated}>
            {busy ? 'Sending…' : 'Send contact request'}
          </button>
          {!isAuthenticated ? (
            <p className="muted" style={{ margin: 0 }}>
              <Link to="/login" state={{ from: '/insurance' }}>
                Sign in
              </Link>{' '}
              required to submit.
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
