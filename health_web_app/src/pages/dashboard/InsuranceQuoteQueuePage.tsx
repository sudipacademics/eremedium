import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

type InsuranceQuoteRequest = {
  name: string;
  customer_name: string;
  phone: string;
  email?: string;
  product?: string;
  product_name?: string;
  insurer?: string;
  sum_insured?: number;
  status: string;
  notes?: string;
  creation?: string;
};

const STATUSES = ['New', 'Contacted', 'Quote Sent', 'Policy Issued', 'Closed'] as const;

export function InsuranceQuoteQueuePage() {
  const [pending, setPending] = useState<InsuranceQuoteRequest[]>([]);
  const [recent, setRecent] = useState<InsuranceQuoteRequest[]>([]);
  const [active, setActive] = useState<InsuranceQuoteRequest | null>(null);
  const [status, setStatus] = useState<string>('Contacted');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.listInsuranceQuoteQueue(50);
    setPending(res.data.pending || []);
    setRecent(res.data.recent || []);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'));
  }, [load]);

  function openRequest(row: InsuranceQuoteRequest) {
    setActive(row);
    setStatus(row.status === 'New' ? 'Contacted' : row.status);
    setNotes(row.notes || '');
    setError(null);
  }

  async function saveUpdate() {
    if (!active) return;
    setBusy(active.name);
    setError(null);
    try {
      await api.updateInsuranceQuoteRequest({
        request_id: active.name,
        status,
        notes: notes.trim(),
      });
      setNotice(`Updated ${active.name} — status ${status}.`);
      setActive(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Insurance quote leads</h1>
        <p className="muted">
          Follow up on GIC / LIC health insurance quote requests from the public landing page.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <span className="badge">
          Open leads: <strong>{pending.length}</strong>
        </span>
      </div>

      <h2>Needs follow-up</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Sum insured</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>
                  {row.customer_name}
                  <br />
                  <span className="muted">{row.phone}</span>
                </td>
                <td>
                  {row.product_name || row.product}
                  <br />
                  <span className="muted">{row.insurer}</span>
                </td>
                <td>{row.sum_insured ? `₹${Number(row.sum_insured).toLocaleString('en-IN')}` : '—'}</td>
                <td>
                  <span className="badge">{row.status}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-sm" onClick={() => openRequest(row)}>
                    Update
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pending.length ? <p className="muted">No open insurance leads.</p> : null}
      </div>

      <h2 style={{ marginTop: 28 }}>Recently closed</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {recent.slice(0, 20).map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.customer_name}</td>
                <td>{row.product_name || row.product}</td>
                <td>
                  <span className="badge">{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!recent.length ? <p className="muted">No closed quotes yet.</p> : null}
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            zIndex: 1000,
            overflowY: 'auto',
          }}
        >
          <div className="card" style={{ maxWidth: 560, width: '94%', margin: '6vh auto' }}>
            <h2>{active.name}</h2>
            <p className="muted">
              {active.customer_name} · {active.phone}
              {active.email ? ` · ${active.email}` : ''}
            </p>
            <p>
              <strong>{active.product_name}</strong> ({active.insurer})
            </p>

            <label style={{ display: 'block', marginTop: 12 }}>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'block', marginTop: 12 }}>
              Advisor notes
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" disabled={busy === active.name} onClick={() => void saveUpdate()}>
                {busy === active.name ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn secondary" disabled={busy === active.name} onClick={() => setActive(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
