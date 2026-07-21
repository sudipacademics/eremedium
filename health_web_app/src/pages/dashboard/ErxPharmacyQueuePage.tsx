import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PharmacyOrder } from '../../api';
import { assetUrl } from '../../config';

const STATUS_FLOW = ['Pending', 'Confirmed', 'Packed', 'Out for Delivery', 'Delivered', 'Cancelled'];

export function ErxPharmacyQueuePage() {
  const [pending, setPending] = useState<PharmacyOrder[]>([]);
  const [recent, setRecent] = useState<PharmacyOrder[]>([]);
  const [summary, setSummary] = useState({ pending_count: 0, awaiting_payment: 0 });
  const [active, setActive] = useState<PharmacyOrder | null>(null);
  const [status, setStatus] = useState('Confirmed');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getErxPharmacyQueue(50);
    setPending(res.data.pending || []);
    setRecent(res.data.recent || []);
    setSummary(res.data.summary || { pending_count: 0, awaiting_payment: 0 });
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'));
  }, [load]);

  function openOrder(order: PharmacyOrder) {
    setActive(order);
    setStatus(order.delivery_status === 'Pending' ? 'Confirmed' : order.delivery_status || 'Confirmed');
    setNotes(order.pharmacist_notes || '');
    setError(null);
  }

  async function saveUpdate() {
    if (!active) return;
    setBusy(active.name);
    setError(null);
    try {
      await api.updateErxPharmacyOrder({
        order_id: active.name,
        delivery_status: status,
        pharmacist_notes: notes.trim(),
      });
      setActive(null);
      setNotice(`Order ${active.name} updated — patient notified.`);
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
        <h1>E-Rx pharmacy queue</h1>
        <p className="muted">
          Medicine orders from doctor e-prescriptions — pack, dispatch, and notify patients.
          {summary.pending_count ? ` · ${summary.pending_count} active` : ''}
          {summary.awaiting_payment ? ` · ${summary.awaiting_payment} awaiting payment` : ''}
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <h2>Active orders</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Patient</th>
              <th>Rx</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((order) => (
              <tr key={order.name}>
                <td>{order.name}</td>
                <td>
                  {order.customer_name}
                  {order.customer_phone ? <div className="muted">{order.customer_phone}</div> : null}
                </td>
                <td>{order.clinical_prescription || '—'}</td>
                <td>₹{order.order_total ?? 0}</td>
                <td>{order.razorpay_payment_status || '—'}</td>
                <td>
                  <span className="badge">{order.delivery_status}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-sm" onClick={() => openOrder(order)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pending.length ? <p className="muted">No active e-Rx pharmacy orders.</p> : null}
      </div>

      <h2 style={{ marginTop: 24 }}>Recently completed</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Patient</th>
              <th>Rx</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((order) => (
              <tr key={order.name}>
                <td>{order.name}</td>
                <td>{order.customer_name}</td>
                <td>{order.clinical_prescription || '—'}</td>
                <td>
                  <span className="badge">{order.delivery_status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <div className="card" style={{ maxWidth: 640, width: '94%', margin: '6vh auto' }}>
            <h2>{active.name}</h2>
            <p className="muted">
              {active.customer_name} · Rx {active.clinical_prescription || '—'}
            </p>
            <p>{active.delivery_address}</p>

            <h3>Medicines</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Dosage</th>
                    <th>Freq</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {(active.items || []).map((item, i) => (
                    <tr key={i}>
                      <td>{item.item_name || item.item_code}</td>
                      <td>{item.dosage || '—'}</td>
                      <td>{item.frequency || '—'}</td>
                      <td>{item.duration || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {active.uploaded_prescription_url ? (
              <p style={{ marginTop: 8 }}>
                <a href={assetUrl(active.uploaded_prescription_url)} target="_blank" rel="noopener noreferrer">
                  View prescription
                </a>
              </p>
            ) : null}

            <label style={{ display: 'block', marginTop: 16 }}>
              Delivery status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_FLOW.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginTop: 12 }}>
              Pharmacist notes (sent to patient)
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" disabled={busy === active.name} onClick={() => void saveUpdate()}>
                {busy === active.name ? 'Saving…' : 'Update & notify patient'}
              </button>
              <button type="button" className="btn secondary" onClick={() => setActive(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/pharmacy-quotes">Chronic pack quotes</Link>
        {' · '}
        <Link to="/dashboard">Staff dashboard</Link>
      </p>
    </>
  );
}
