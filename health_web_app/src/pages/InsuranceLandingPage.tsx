import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, InsuranceProduct } from '../api';
import { useAuth } from '../auth/AuthContext';

export function InsuranceLandingPage() {
  const { isAuthenticated } = useAuth();
  const [products, setProducts] = useState<InsuranceProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    product_code: '',
    full_name: '',
    phone: '',
    city: '',
    sum_insured: '',
  });

  useEffect(() => {
    api
      .getInsuranceLanding()
      .then((res) => {
        setProducts(res.data.products || []);
        if (res.data.products?.[0]?.product_code) {
          setForm((f) => ({ ...f, product_code: res.data.products[0].product_code }));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load insurance products'))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isAuthenticated) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.submitInsuranceQuoteRequest({
        product_code: form.product_code,
        customer_name: form.full_name,
        phone: form.phone,
        ...(form.city ? { notes: `City: ${form.city}` } : {}),
        ...(form.sum_insured ? { sum_insured: Number(form.sum_insured) } : {}),
      });
      setSuccess('Quote request submitted. Our advisor will contact you shortly.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Health insurance</h1>
        <p>Compare GIC / LIC-style mediclaim plans and request a personalised quote.</p>
      </section>

      {loading ? <p className="muted">Loading plans…</p> : null}
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <div className="grid" style={{ gap: 16 }}>
        {products.map((p) => (
          <article key={p.product_code} className="card">
            <h3>{p.product_name}</h3>
            <p className="muted">
              {p.insurer} · {p.category}
            </p>
            <p>
              Cover ₹{(p.sum_insured_from || 0).toLocaleString()} – ₹
              {(p.sum_insured_to || 0).toLocaleString()}
            </p>
            {p.premium_from ? <p className="muted">From ₹{p.premium_from.toLocaleString()}/yr</p> : null}
            {p.highlights?.length ? (
              <ul>
                {p.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : null}
            <button
              className="btn secondary btn-sm"
              type="button"
              onClick={() => setForm((f) => ({ ...f, product_code: p.product_code }))}
            >
              Select plan
            </button>
          </article>
        ))}
      </div>

      <section className="card card-wide" style={{ marginTop: 24 }}>
        <h2>Request a quote</h2>
        {!isAuthenticated ? (
          <p className="muted">
            <Link to="/login">Sign in</Link> to submit an insurance quote request.
          </p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="form-grid">
            <label>
              Plan
              <select
                value={form.product_code}
                onChange={(e) => setForm({ ...form, product_code: e.target.value })}
                required
              >
                {products.map((p) => (
                  <option key={p.product_code} value={p.product_code}>
                    {p.product_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Full name
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </label>
            <label>
              Phone
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </label>
            <label>
              City
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </label>
            <label>
              Desired sum insured
              <input
                type="number"
                value={form.sum_insured}
                onChange={(e) => setForm({ ...form, sum_insured: e.target.value })}
              />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Submitting…' : 'Request quote'}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
