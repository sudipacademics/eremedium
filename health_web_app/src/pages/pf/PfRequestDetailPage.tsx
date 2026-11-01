import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import type { PfRequestDetail, PfRequestStatus } from '../../types/phlebofirst';
import { PfStatusChip } from './PfStatusChip';
import { PfTimeline } from './PfTimeline';
import './pf.css';

const POLL_MS = 30_000;
const TERMINAL: PfRequestStatus[] = ['Received At Lab', 'Rejected', 'Cancelled', 'Expired'];
const BAD: PfRequestStatus[] = ['Rejected', 'Cancelled', 'Expired'];

function money(n?: number | null) {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function when(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function windowLabel(start?: string | null, end?: string | null) {
  if (!start && !end) return 'Any time';
  return [start ? when(start) : '', end ? when(end) : ''].filter(Boolean).join(' – ');
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

export function PfRequestDetailPage({ basePath }: { basePath: string }) {
  const { name = '' } = useParams<{ name: string }>();
  const [detail, setDetail] = useState<PfRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);

  const load = useCallback(
    async (silent = false) => {
      if (!name) return;
      if (!silent) setLoading(true);
      try {
        const res = await api.pfRequestDetail(name);
        setDetail(res.data);
        setError(null);
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : 'Could not load the request');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [name],
  );

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  const loaded = detail != null;
  const terminal = detail ? TERMINAL.includes(detail.status) : false;

  useEffect(() => {
    if (!loaded || terminal) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [loaded, terminal, load]);

  useEffect(
    () => () => {
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrls.current = [];
    },
    [],
  );

  async function viewFile() {
    if (!detail) return;
    setFileBusy(true);
    setFileError(null);
    // Open synchronously so the popup is not blocked after the await.
    const win = window.open('', '_blank');
    try {
      const blob = await api.fetchPfRequestFile(detail.name);
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
      }
    } catch (e) {
      win?.close();
      setFileError(e instanceof Error ? e.message : 'Could not open the file');
    } finally {
      setFileBusy(false);
    }
  }

  async function confirmCancel() {
    if (!detail) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const res = await api.pfCancelRequest(detail.name, cancelReason.trim());
      setDetail(res.data);
      setCancelOpen(false);
      setCancelReason('');
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Could not cancel the request');
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading && !detail) {
    return (
      <div className="pf-page">
        <Link className="pf-back" to={basePath}>
          ‹ My requests
        </Link>
        <p className="pf-empty">Loading request…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="pf-page">
        <Link className="pf-back" to={basePath}>
          ‹ My requests
        </Link>
        <div className="pf-alert is-err">{error || 'Request not found.'}</div>
        <button type="button" className="partners-btn partners-btn-outline" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  const q = detail.quotation;
  const job = detail.job;
  const rider = detail.rider;
  const hasCoords = detail.pickup_lat != null && detail.pickup_lng != null;

  return (
    <div className="pf-page">
      <Link className="pf-back" to={basePath}>
        ‹ My requests
      </Link>

      <div className="pf-head">
        <div>
          <h1 className="partners-page-title pf-title-row">
            {detail.name} <PfStatusChip status={detail.status} />
          </h1>
          <p className="partners-page-lead">
            Submitted {when(detail.submitted_on)}
            {detail.lab_name || detail.assigned_lab ? ` · Lab: ${detail.lab_name || detail.assigned_lab}` : ''}
          </p>
        </div>
        <div className="pf-head-actions">
          <button type="button" className="partners-btn partners-btn-outline pf-btn-sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          {detail.can_cancel && !cancelOpen ? (
            <button type="button" className="partners-btn pf-btn-danger pf-btn-sm" onClick={() => setCancelOpen(true)}>
              Cancel request
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="pf-alert is-err">{error}</div> : null}

      {cancelOpen ? (
        <div className="pf-card pf-confirm">
          <h2>Cancel this request?</h2>
          <p className="pf-hint">The lab and any assigned rider are notified. This cannot be undone.</p>
          <label className="pf-field">
            <span>Reason (optional)</span>
            <textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} />
          </label>
          {cancelError ? <div className="pf-alert is-err">{cancelError}</div> : null}
          <div className="pf-actions">
            <button type="button" className="partners-btn partners-btn-outline" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
              Keep request
            </button>
            <button type="button" className="partners-btn pf-btn-danger" onClick={() => void confirmCancel()} disabled={cancelBusy}>
              {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
            </button>
          </div>
        </div>
      ) : null}

      {BAD.includes(detail.status) ? (
        <div className="pf-banner is-bad" role="status">
          <b>Request {detail.status.toLowerCase()}</b>
          {detail.status_reason ? <span>{detail.status_reason}</span> : null}
        </div>
      ) : null}

      <section className="pf-card">
        <PfTimeline steps={detail.timeline} />
      </section>

      <div className="pf-cards">
        <section className="pf-card">
          <h2>Patient</h2>
          <dl className="pf-dl">
            <Row label="Name">{detail.patient_name}</Row>
            <Row label="Age / gender">
              {[detail.patient_age != null ? `${detail.patient_age} y` : '', detail.patient_gender || ''].filter(Boolean).join(' / ')}
            </Row>
            <Row label="Mobile">{detail.patient_phone}</Row>
            <Row label="Universal Patient ID">{detail.universal_patient_id}</Row>
          </dl>
        </section>

        <section className="pf-card">
          <h2>Pickup</h2>
          <dl className="pf-dl">
            <Row label="Address">{detail.pickup_address}</Row>
            <Row label="Area / landmark">{detail.pickup_area}</Row>
            <Row label="Preferred window">{windowLabel(detail.preferred_window_start, detail.preferred_window_end)}</Row>
          </dl>
          {hasCoords ? (
            <a
              className="pf-link"
              href={`https://www.google.com/maps?q=${detail.pickup_lat},${detail.pickup_lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Maps
            </a>
          ) : null}
        </section>

        <section className="pf-card">
          <h2>Uploaded prescription / TRF</h2>
          {detail.has_file ? (
            <>
              <p className="pf-file-name">{detail.file_name || 'Attachment'}</p>
              <button type="button" className="partners-btn partners-btn-outline pf-btn-sm" onClick={() => void viewFile()} disabled={fileBusy}>
                {fileBusy ? 'Opening…' : 'View file'}
              </button>
              {fileError ? <p className="pf-field-error">{fileError}</p> : null}
            </>
          ) : (
            <p className="pf-hint">No file attached.</p>
          )}
          {detail.suggested_tests ? (
            <p className="pf-note">
              <b>Suggested tests:</b> {detail.suggested_tests}
            </p>
          ) : null}
          {detail.notes ? (
            <p className="pf-note">
              <b>Notes:</b> {detail.notes}
            </p>
          ) : null}
        </section>
      </div>

      {q ? (
        <section className="pf-card">
          <div className="pf-card-head">
            <h2>Quotation</h2>
            <span className="pf-muted">
              {q.lab_name || q.lab} · {q.name}
            </span>
          </div>
          <div className="pf-table-scroll">
            <table className="pf-quote-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th className="num">MRP</th>
                  <th className="num">Rate</th>
                  <th className="num">Qty</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {q.items.map((it) => (
                  <tr key={it.item_code}>
                    <td>
                      {it.item_name || it.item_code}
                      {it.item_name ? <small className="pf-sub">{it.item_code}</small> : null}
                    </td>
                    <td className="num">{money(it.mrp)}</td>
                    <td className="num">{money(it.rate)}</td>
                    <td className="num">{it.qty}</td>
                    <td className="num">{money(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="pf-totals">
            <div>
              <dt>Test total</dt>
              <dd>{money(q.test_total)}</dd>
            </div>
            <div>
              <dt>Home collection fee</dt>
              <dd>{money(q.collection_fee)}</dd>
            </div>
            {q.discount ? (
              <div>
                <dt>Discount</dt>
                <dd>− {money(q.discount)}</dd>
              </div>
            ) : null}
            <div className="is-grand">
              <dt>Grand total</dt>
              <dd>{money(q.grand_total)}</dd>
            </div>
          </dl>
          <p className="pf-muted">
            {q.valid_until ? `Valid until ${when(q.valid_until)} · ` : ''}Payment: {detail.payment_status || 'Pending'}
            {detail.payment_status !== 'Paid' ? ' — online payment is not available yet.' : ''}
          </p>
          {q.notes ? <p className="pf-note">{q.notes}</p> : null}
        </section>
      ) : null}

      {rider || job ? (
        <div className="pf-cards">
          {rider ? (
            <section className="pf-card">
              <h2>Rider</h2>
              <dl className="pf-dl">
                <Row label="Name">{rider.name}</Row>
                <Row label="Phone">{rider.phone || rider.phone_masked}</Row>
                <Row label="Vehicle">{rider.vehicle_type}</Row>
                {rider.eta_minutes != null ? <Row label="ETA">{`${Math.round(rider.eta_minutes)} min`}</Row> : null}
                {rider.distance_km != null ? <Row label="Distance">{`${rider.distance_km.toFixed(1)} km`}</Row> : null}
                {rider.location_at ? <Row label="Location updated">{when(rider.location_at)}</Row> : null}
                {job?.collected_on ? <Row label="Collected">{when(job.collected_on)}</Row> : null}
              </dl>
            </section>
          ) : null}
          {job ? (
            <section className="pf-card">
              <h2>Collection job</h2>
              <dl className="pf-dl">
                <Row label="Job">{job.name}</Row>
                <Row label="Status">{job.status}</Row>
                <Row label="Tubes">{job.tube_count ? String(job.tube_count) : '—'}</Row>
                {job.accepted_on ? <Row label="Accepted">{when(job.accepted_on)}</Row> : null}
                {job.collected_on ? <Row label="Collected">{when(job.collected_on)}</Row> : null}
                {job.dropped_hub ? <Row label="Dropped at hub">{job.dropped_hub}</Row> : null}
                {job.dropped_on ? <Row label="Dropped on">{when(job.dropped_on)}</Row> : null}
              </dl>
            </section>
          ) : null}
        </div>
      ) : null}

      {!terminal ? <p className="pf-hint pf-center">This page refreshes automatically every 30 seconds.</p> : null}
    </div>
  );
}
