import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PharmacyOrder } from '../../api';
import { assetUrl } from '../../config';

type QuoteLine = { item_name: string; qty: string; rate: string };

function emptyLine(): QuoteLine {
  return { item_name: '', qty: '1', rate: '' };
}

function linesTotal(lines: QuoteLine[]) {
  return lines.reduce((sum, row) => {
    const qty = parseFloat(row.qty) || 0;
    const rate = parseFloat(row.rate) || 0;
    return sum + qty * rate;
  }, 0);
}

export function PharmacyQuoteQueuePage() {
  const [pending, setPending] = useState<PharmacyOrder[]>([]);
  const [sent, setSent] = useState<PharmacyOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState<PharmacyOrder | null>(null);
  const [lines, setLines] = useState<QuoteLine[]>([emptyLine(), emptyLine()]);
  const [notes, setNotes] = useState('');
  const [manualTotal, setManualTotal] = useState('');

  const load = useCallback(async () => {
    const res = await api.getPharmacyQuoteQueue(50);
    setPending(res.data.pending || []);
    setSent(res.data.sent_recent || []);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'));
  }, [load]);

  const computedTotal = useMemo(() => linesTotal(lines), [lines]);
  const quoteTotal = manualTotal.trim() ? parseFloat(manualTotal) || 0 : computedTotal;

  function openQuote(order: PharmacyOrder) {
    setActive(order);
    setLines([emptyLine(), emptyLine(), emptyLine()]);
    setNotes('');
    setManualTotal('');
    setError(null);
  }

  function updateLine(index: number, patch: Partial<QuoteLine>) {
    setLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submitQuote() {
    if (!active) return;
    const payload = lines
      .filter((row) => row.item_name.trim())
      .map((row) => ({
        item_name: row.item_name.trim(),
        qty: parseFloat(row.qty) || 1,
        rate: parseFloat(row.rate) || 0,
        amount: (parseFloat(row.qty) || 1) * (parseFloat(row.rate) || 0),
      }));
    if (!payload.length) {
      setError('Add at least one medicine line.');
      return;
    }
    if (quoteTotal <= 0) {
      setError('Enter a quote total greater than zero.');
      return;
    }

    setBusy(active.name);
    setError(null);
    try {
      await api.sendPharmacyQuote({
        order_id: active.name,
        order_total: quoteTotal,
        items_json: JSON.stringify(payload),
        ...(notes.trim() ? { pharmacist_notes: notes.trim() } : {}),
      });
      setActive(null);
      setNotice(`Quote sent for ${active.name} — patient notified (SMS/WhatsApp when configured).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send quote');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Pharmacy quotes</h1>
        <p className="muted">
          Price chronic medicine pack requests from patients, then send the quote for online payment.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <span className="badge">
          Awaiting quote: <strong>{pending.length}</strong>
        </span>
        <span className="badge">
          Recently sent: <strong>{sent.length}</strong>
        </span>
      </div>

      <h2>Quotation pending</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Patient</th>
              <th>Pack</th>
              <th>Phone</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((order) => (
              <tr key={order.name}>
                <td>{order.name}</td>
                <td>{order.customer_name || '—'}</td>
                <td className="muted">
                  {order.duration_months ? `${order.duration_months} mo` : 'Chronic pack'}
                  {order.desired_discount_slab ? ` · ${order.desired_discount_slab}` : ''}
                </td>
                <td>{order.customer_phone || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-sm" onClick={() => openQuote(order)}>
                    Send quote
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pending.length ? <p className="muted">No quote requests waiting.</p> : null}
      </div>

      <h2 style={{ marginTop: 28 }}>Recently sent</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Patient</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sent.map((order) => (
              <tr key={order.name}>
                <td>{order.name}</td>
                <td>{order.customer_name || '—'}</td>
                <td>₹{Number(order.order_total || 0).toFixed(0)}</td>
                <td>
                  <span className="badge">{order.delivery_status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sent.length ? <p className="muted">No quotes sent recently.</p> : null}
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
          <div className="card" style={{ maxWidth: 720, width: '94%', margin: '6vh auto' }}>
            <h2>Send quote — {active.name}</h2>
            <p className="muted">
              {active.customer_name} · {active.customer_phone || 'no phone'} ·{' '}
              {active.delivery_address || 'no address'}
            </p>
            {active.uploaded_prescription_url ? (
              <p>
                <a
                  href={assetUrl(active.uploaded_prescription_url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View uploaded prescription
                </a>
              </p>
            ) : null}

            <h3>Medicine lines</h3>
            {lines.map((row, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <input
                  placeholder="Medicine name"
                  value={row.item_name}
                  onChange={(e) => updateLine(index, { item_name: e.target.value })}
                />
                <input
                  placeholder="Qty"
                  value={row.qty}
                  onChange={(e) => updateLine(index, { qty: e.target.value })}
                />
                <input
                  placeholder="Rate ₹"
                  value={row.rate}
                  onChange={(e) => updateLine(index, { rate: e.target.value })}
                />
              </div>
            ))}
            <button type="button" className="btn btn-sm secondary" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              + Add line
            </button>

            <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
              <label>
                Quote total (₹) — auto {computedTotal.toFixed(0)} unless overridden
                <input value={manualTotal} onChange={(e) => setManualTotal(e.target.value)} placeholder={String(computedTotal.toFixed(0))} />
              </label>
              <label>
                Pharmacist notes (optional)
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" disabled={busy === active.name} onClick={() => void submitQuote()}>
                {busy === active.name ? 'Sending…' : `Send quote · ₹${quoteTotal.toFixed(0)}`}
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
