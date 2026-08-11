import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api, Booking } from '../../api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

type LabResult = {
  analyte_test_name?: string;
  numeric_result_value?: number | string;
  unit_of_measure?: string;
  machine_reference?: string;
};

const ACTIVE_STATUSES = new Set(['Booked', 'Sample Collected', 'In Lab']);

function SampleCard({
  order,
  acting,
  onAdvance,
}: {
  order: Booking;
  acting: string | null;
  onAdvance: (trfId: string, next: string) => void;
}) {
  const next =
    order.order_status === 'Booked'
      ? 'Sample Collected'
      : order.order_status === 'Sample Collected'
        ? 'In Lab'
        : null;

  return (
    <article className="card collection-card">
      <div className="collection-card-head">
        <strong>{order.patient_name}</strong>
        <span className="badge">{order.order_status}</span>
      </div>
      <p className="collection-test">{order.test_name || order.test_labels?.join(', ') || order.test_required}</p>
      <div className="barcode-block">
        <span className="muted">Barcode</span>
        <code className="barcode-value">{order.barcode || order.trf_id}</code>
      </div>
      <p className="muted">Payment: {order.razorpay_payment_status || 'Pending'}</p>
      <div className="toolbar-actions" style={{ marginTop: 12, gap: 8, display: 'flex', flexWrap: 'wrap' }}>
        <Link className="btn btn-sm" to={`/dashboard/lab-reports/${encodeURIComponent(order.trf_id)}`}>
          Enter results
        </Link>
        <Link className="btn secondary btn-sm" to={`/bookings/${encodeURIComponent(order.trf_id)}`}>
          Open sample
        </Link>
        {next ? (
          <button
            className="btn secondary btn-sm"
            type="button"
            disabled={acting === order.trf_id}
            onClick={() => onAdvance(order.trf_id, next)}
          >
            {acting === order.trf_id ? 'Updating…' : `Mark ${next}`}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function LabTechDashboard() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [barcode, setBarcode] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [preview, setPreview] = useState<{ trf: Booking; results: LabResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyBookings(80);
      setBookings(res.data.bookings || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sample queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load, 30000);

  const active = useMemo(
    () =>
      bookings
        .filter((b) => ACTIVE_STATUSES.has(b.order_status || ''))
        .slice(0, 24),
    [bookings],
  );

  const inLabCount = active.filter((b) => b.order_status === 'In Lab').length;
  const collectedCount = active.filter((b) => b.order_status === 'Sample Collected').length;

  async function lookupBarcode(e?: FormEvent) {
    e?.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    setLookupBusy(true);
    setLookupError(null);
    setPreview(null);
    try {
      const res = await api.getTrfDetail({ barcode: code });
      const trf = res.data.trf;
      if (!trf?.trf_id) {
        throw new Error('Sample not found for this barcode');
      }
      setPreview({ trf, results: (res.data.results as LabResult[]) || [] });
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLookupBusy(false);
    }
  }

  async function advanceStatus(trfId: string, next: string) {
    setActing(trfId);
    setError(null);
    try {
      await api.updateOrderStatus(trfId, next);
      await load();
      if (preview?.trf.trf_id === trfId) {
        const res = await api.getTrfDetail(trfId);
        setPreview({ trf: res.data.trf, results: (res.data.results as LabResult[]) || [] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status');
    } finally {
      setActing(null);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Lab technician</h1>
        <p>
          Primary work is result entry on the Lab Report grid. Use this bench for barcode lookup
          and status advances; open In Lab samples in Result entry to import LIS and finalize.
        </p>
        <div className="toolbar-actions" style={{ marginTop: 12, gap: 8, display: 'flex', flexWrap: 'wrap' }}>
          <Link className="btn" to="/dashboard/lab-reports">
            Open result entry
          </Link>
          <Link className="btn secondary" to="/dashboard/report-lifecycle">
            Report lifecycle
          </Link>
        </div>
      </section>

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <span className="muted">Active samples</span>
          <strong>{active.length}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">Sample collected</span>
          <strong>{collectedCount}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">In lab</span>
          <strong>{inLabCount}</strong>
        </div>
      </div>

      <form className="card card-wide barcode-lookup" onSubmit={(e) => void lookupBarcode(e)}>
        <h2>Barcode lookup</h2>
        <p className="muted">Use the scanner wedge or type the barcode from the TRF label.</p>
        <div className="toolbar" style={{ gap: 8, alignItems: 'stretch' }}>
          <input
            className="input"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="e.g. HUB001-ABC123"
            autoComplete="off"
            autoFocus
            aria-label="Sample barcode"
          />
          <button className="btn" type="submit" disabled={lookupBusy || !barcode.trim()}>
            {lookupBusy ? 'Looking up…' : 'Lookup sample'}
          </button>
        </div>
        {lookupError ? <div className="error" style={{ marginTop: 12 }}>{lookupError}</div> : null}
      </form>

      {preview ? (
        <section className="card card-wide" style={{ marginTop: 16 }}>
          <div className="collection-card-head">
            <h2 style={{ margin: 0 }}>{preview.trf.patient_name}</h2>
            <span className="badge">{preview.trf.order_status}</span>
          </div>
          <p className="muted">
            {preview.trf.trf_id} · <code className="barcode-value">{preview.trf.barcode}</code>
          </p>
          <p className="collection-test">
            {preview.trf.test_name || preview.trf.test_required}
          </p>
          <p className="muted">Payment: {preview.trf.razorpay_payment_status || 'Pending'}</p>

          {preview.results.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Analyte</th>
                    <th>Value</th>
                    <th>Unit</th>
                    <th>Machine</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.results.map((r, i) => (
                    <tr key={`${r.analyte_test_name}-${i}`}>
                      <td>{r.analyte_test_name}</td>
                      <td>{r.numeric_result_value}</td>
                      <td>{r.unit_of_measure || '—'}</td>
                      <td className="muted">{r.machine_reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              No LIS results posted yet for this barcode.
            </p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <button
              className="btn"
              type="button"
              onClick={() => navigate(`/dashboard/lab-reports/${encodeURIComponent(preview.trf.trf_id)}`)}
            >
              Enter / edit results
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => navigate(`/bookings/${encodeURIComponent(preview.trf.trf_id)}`)}
            >
              Open full TRF
            </button>
            {preview.trf.order_status === 'Booked' ? (
              <button
                className="btn secondary"
                type="button"
                disabled={acting === preview.trf.trf_id}
                onClick={() => void advanceStatus(preview.trf.trf_id, 'Sample Collected')}
              >
                Mark Sample Collected
              </button>
            ) : null}
            {preview.trf.order_status === 'Sample Collected' ? (
              <button
                className="btn secondary"
                type="button"
                disabled={acting === preview.trf.trf_id}
                onClick={() => void advanceStatus(preview.trf.trf_id, 'In Lab')}
              >
                Mark In Lab
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="toolbar" style={{ marginTop: 24 }}>
        <h2>Active samples</h2>
        <div className="toolbar-actions">
          <Link className="btn btn-sm" to="/dashboard/lab-reports">
            Result entry
          </Link>
          <Link className="btn secondary btn-sm" to="/dashboard/reagents">
            Reagents
          </Link>
          <Link className="btn secondary btn-sm" to="/bookings">
            All bookings
          </Link>
          <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {loading && !active.length ? <p className="muted">Loading queue…</p> : null}

      {!loading && !active.length ? (
        <p className="muted">No active samples. Lookup a barcode or wait for collected orders.</p>
      ) : (
        <div className="collection-grid">
          {active.map((order) => (
            <SampleCard
              key={order.trf_id}
              order={order}
              acting={acting}
              onAdvance={(id, next) => void advanceStatus(id, next)}
            />
          ))}
        </div>
      )}
    </>
  );
}
