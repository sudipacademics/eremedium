import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { AccessionTrfHit, api, LabCptDashboard } from '../../api';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { AllBookingRow, AllBookingsResponse, BookingLifecycleDetail, LifecycleStage } from '../../types/bookingLifecycle';
import { formatPatientAge } from '../../utils/patientAge';
import './lab-tech-v2.css';
import './barcode-bench-v2.css';

type LabResult = {
  analyte_test_name?: string;
  numeric_result_value?: number | string;
  result_value_text?: string;
  unit_of_measure?: string;
  reference_range?: string;
  abnormal_flag?: string;
  machine_reference?: string;
};

type QueueChip = 'Active' | 'Booked' | 'Sample Collected' | 'In Lab' | 'Processing';

type Preview = {
  detail: BookingLifecycleDetail;
  results: LabResult[];
  scanned: string;
};

const PAGE_SIZES = [10, 25, 50];
const STAGES: LifecycleStage[] = [
  'Booked',
  'Sample Collected',
  'In Lab',
  'Processing',
  'Result Ready',
  'Authorized',
  'Dispatched',
  'Delivered',
];
const STATUS_TONE: Record<string, string> = {
  Booked: 'muted',
  'Sample Collected': 'amber',
  'In Lab': 'blue',
  Processing: 'violet',
  'Result Ready': 'teal',
  Authorized: 'green',
  Dispatched: 'indigo',
  Delivered: 'green',
  Rejected: 'red',
  Cancelled: 'red',
};
const CHIPS: QueueChip[] = ['Active', 'Booked', 'Sample Collected', 'In Lab', 'Processing'];

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const BARCODE = <path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" />;

function formatInr(n?: number | null) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDateTime(raw: string | null | undefined) {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${d
    .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    .toUpperCase()}`;
}

function nextOrderStatus(orderStatus: string | null | undefined) {
  if (orderStatus === 'Booked') return 'Sample Collected';
  if (orderStatus === 'Sample Collected') return 'In Lab';
  return null;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || 'Booked';
  return <span className={`lt-badge tone-${STATUS_TONE[s] || 'muted'}`}>{s}</span>;
}

function StageDots({ stageIndex, terminal }: { stageIndex: number; terminal: boolean }) {
  return (
    <span className={`bb2-dots${terminal ? ' is-terminal' : ''}`} aria-hidden>
      {STAGES.map((s, i) => (
        <span key={s} className={i < stageIndex ? 'is-done' : i === stageIndex ? 'is-current' : undefined} />
      ))}
    </span>
  );
}

function RowMenu({ row }: { row: AllBookingRow }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="lt-row-menu" ref={ref}>
      <button type="button" className="lt-kebab" aria-label={`More actions for ${row.trf_id}`} onClick={() => setOpen((v) => !v)}>
        <Icon size={18}>
          <circle cx="12" cy="5" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="12" cy="19" r="1.2" />
        </Icon>
      </button>
      {open ? (
        <div className="lt-row-menu-pop" role="menu">
          <Link role="menuitem" to={`/dashboard/all-bookings?trf=${encodeURIComponent(row.trf_id)}`}>
            View lifecycle
          </Link>
          <Link role="menuitem" to={`/dashboard/lab-reports/${encodeURIComponent(row.trf_id)}`}>
            Result entry
          </Link>
          <Link role="menuitem" to="/dashboard/accession">
            Accession
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function QueueAction({
  row,
  acting,
  onAdvance,
}: {
  row: AllBookingRow;
  acting: string | null;
  onAdvance: (trfId: string, next: string) => void;
}) {
  const next = nextOrderStatus(row.order_status);
  if (next) {
    return (
      <button
        type="button"
        className="lt-action is-ghost"
        disabled={acting === row.trf_id}
        onClick={() => onAdvance(row.trf_id, next)}
      >
        {acting === row.trf_id ? 'Updating…' : next === 'In Lab' ? 'Mark In Lab' : 'Mark collected'}
      </button>
    );
  }
  return (
    <Link className="lt-action" to={`/dashboard/lab-reports/${encodeURIComponent(row.trf_id)}`}>
      Enter results
    </Link>
  );
}

function PreviewCard({
  preview,
  acting,
  onAdvance,
  onClose,
}: {
  preview: Preview;
  acting: string | null;
  onAdvance: (trfId: string, next: string) => void;
  onClose: () => void;
}) {
  const b = preview.detail.booking;
  const next = nextOrderStatus(b.order_status);
  const scannedTube = preview.detail.tubes.find(
    (t) => t.tube_code && preview.scanned.toUpperCase().endsWith(`-${t.tube_code.toUpperCase()}`),
  );
  return (
    <section className="bb2-preview">
      <header className="bb2-preview-head">
        <div>
          <span className="bb2-kicker">Scanned sample</span>
          <h3>{b.patient_name || '—'}</h3>
          <p>
            {b.trf_id}
            {b.barcode ? (
              <>
                {' · '}
                <code>{b.barcode}</code>
              </>
            ) : null}
            {scannedTube ? ` · Tube ${scannedTube.tube_code} (${scannedTube.status})` : ''}
          </p>
        </div>
        <div className="bb2-preview-status">
          <StatusBadge status={b.lifecycle_status} />
          <StageDots stageIndex={b.stage_index} terminal={b.is_terminal} />
          <button type="button" className="bb2-close" onClick={onClose} aria-label="Close preview">
            <Icon size={18}>
              <path d="M6 6l12 12M18 6L6 18" />
            </Icon>
          </button>
        </div>
      </header>

      <dl className="bb2-facts">
        <div>
          <dt>Patient</dt>
          <dd>{[formatPatientAge(b), b.gender || '', b.patient_phone || ''].filter(Boolean).join(' · ') || '—'}</dd>
        </div>
        <div>
          <dt>Tests</dt>
          <dd>{b.test_labels.join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>Partner / centre</dt>
          <dd>
            {b.partner_name || '—'} <small>({b.booking_source})</small>
          </dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>
            {b.payment_status}
            {b.payment_method ? <small> · {b.payment_method}</small> : null}
          </dd>
        </div>
        <div>
          <dt>Tubes</dt>
          <dd>
            {b.tubes_total ? `${b.tubes_received}/${b.tubes_total} received` : 'No draw plan'}
            {b.tubes_rejected ? <small className="bb2-red"> · {b.tubes_rejected} rejected</small> : null}
          </dd>
        </div>
        <div>
          <dt>Report</dt>
          <dd>{b.report_status || 'Not started'}</dd>
        </div>
      </dl>

      {b.terminal_reason ? <p className="bb2-alert">Rejected: {b.terminal_reason}</p> : null}

      {preview.results.length ? (
        <div className="lt-table-wrap bb2-results">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Analyte</th>
                <th>Value</th>
                <th>Unit</th>
                <th>Reference</th>
                <th>Machine</th>
              </tr>
            </thead>
            <tbody>
              {preview.results.map((r, i) => (
                <tr key={`${r.analyte_test_name}-${i}`}>
                  <td>{r.analyte_test_name}</td>
                  <td className={r.abnormal_flag && r.abnormal_flag !== 'Normal' ? 'bb2-red' : undefined}>
                    {r.numeric_result_value ?? r.result_value_text ?? '—'}
                  </td>
                  <td>{r.unit_of_measure || '—'}</td>
                  <td>{r.reference_range || '—'}</td>
                  <td className="bb2-muted">{r.machine_reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="bb2-muted bb2-pad">No LIS / machine results posted yet for this sample.</p>
      )}

      <footer className="bb2-preview-foot">
        <Link className="lt-action" to={`/dashboard/lab-reports/${encodeURIComponent(b.trf_id)}`}>
          Enter / edit results
        </Link>
        <Link className="lt-action is-ghost" to={`/dashboard/all-bookings?trf=${encodeURIComponent(b.trf_id)}`}>
          View lifecycle
        </Link>
        <Link className="lt-action is-ghost" to="/dashboard/accession">
          Accession
        </Link>
        {next && !b.is_terminal ? (
          <button
            type="button"
            className="lt-action is-ghost"
            disabled={acting === b.trf_id}
            onClick={() => onAdvance(b.trf_id, next)}
          >
            {acting === b.trf_id ? 'Updating…' : `Mark ${next}`}
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function CptPanel() {
  const [open, setOpen] = useState(false);
  const [cpt, setCpt] = useState<LabCptDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || cpt) return;
    api
      .getLabCptDashboard(40)
      .then((res) => setCpt(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load CPT'));
  }, [open, cpt]);

  return (
    <details className="bb2-cpt" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span>
          <b>Cost per test (CPT)</b>
          <small>Reagent + fixed GL share + logistics — recalculated from purchase rates and mapped expenses</small>
        </span>
        <Link to="/dashboard/reagents" className="bb2-link" onClick={(e) => e.stopPropagation()}>
          Reagent stock
        </Link>
      </summary>
      {error ? <div className="error">{error}</div> : null}
      {open && !cpt && !error ? <p className="bb2-muted bb2-pad">Loading CPT…</p> : null}
      {cpt ? (
        <>
          <div className="bb2-cpt-kpis">
            <span>
              Overhead <b>{cpt.settings?.overhead_coefficient ?? '—'}</b>
            </span>
            <span>
              Lookback <b>{cpt.settings?.lookback_days ?? cpt.period?.lookback_days ?? '—'}d</b>
            </span>
            <span>
              Fixed GL <b>{formatInr(cpt.totals?.fixed_expenses)}</b>
            </span>
            <span>
              Logistics GL <b>{formatInr(cpt.totals?.logistics_expenses)}</b>
            </span>
            <span>
              Test sales <b>{formatInr(cpt.totals?.total_test_sales_revenue)}</b>
            </span>
          </div>
          {cpt.period?.revenue_is_synthetic ? (
            <p className="bb2-muted bb2-pad">Sales revenue uses a seed floor until paid TRFs exist in the lookback window.</p>
          ) : null}
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Reagent</th>
                  <th>Fixed</th>
                  <th>Logistics</th>
                  <th>CPT</th>
                  <th>Price</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {(cpt.tests || []).map((row) => (
                  <tr key={row.diagnostic_test || row.item}>
                    <td>
                      <b>{row.test_name || row.item}</b>
                      {row.department ? <small className="bb2-sub">{row.department}</small> : null}
                    </td>
                    <td>{formatInr(row.cpt_reagent)}</td>
                    <td>{formatInr(row.cpt_fixed)}</td>
                    <td>{formatInr(row.cpt_logistics)}</td>
                    <td>
                      <b>{formatInr(row.cpt_total)}</b>
                    </td>
                    <td>{formatInr(row.selling_price)}</td>
                    <td>{formatInr(row.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cpt.tests?.length ? <p className="lt-empty">No CPT rows yet — map reagents and expense accounts, then refresh.</p> : null}
          </div>
        </>
      ) : null}
    </details>
  );
}

export function LabTechDashboard() {
  const scanRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [hits, setHits] = useState<AccessionTrfHit[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const [queue, setQueue] = useState<AllBookingsResponse | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chip, setChip] = useState<QueueChip>('Active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [acting, setActing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { openScanner, scannerProps } = useBarcodeScanner(
    useCallback((scanned: string) => {
      setCode(scanned);
      scanRef.current?.focus();
    }, []),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getAllBookings({ status: chip, page, page_size: pageSize });
      setQueue(res.data);
      setQueueError(null);
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Failed to load sample queue');
    } finally {
      setLoading(false);
    }
  }, [chip, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load, 30000);

  const openTrf = useCallback(async (trfId: string, scanned: string) => {
    const [detailRes, trfRes] = await Promise.all([api.getBookingLifecycleDetail(trfId), api.getTrfDetail(trfId)]);
    setPreview({ detail: detailRes.data, results: (trfRes.data.results as LabResult[]) || [], scanned });
    setHits([]);
  }, []);

  async function lookup(e?: FormEvent) {
    e?.preventDefault();
    const value = code.trim();
    if (!value) return;
    setLookupBusy(true);
    setLookupError(null);
    setHits([]);
    setPreview(null);
    try {
      let found: AccessionTrfHit[] = [];
      try {
        found = (await api.findTrfForAccession(value)).data.trfs || [];
      } catch {
        const res = await api.getTrfDetail({ barcode: value });
        if (res.data.trf?.trf_id) found = [{ trf_id: res.data.trf.trf_id }];
      }
      if (!found.length) throw new Error('No sample matches this barcode, tube label, TRF ID, mobile or name.');
      if (found.length === 1) {
        await openTrf(found[0].trf_id, value);
      } else {
        setHits(found);
      }
      setCode('');
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLookupBusy(false);
      scanRef.current?.focus();
    }
  }

  async function advance(trfId: string, next: string) {
    setActing(trfId);
    setQueueError(null);
    setNotice(null);
    try {
      await api.updateOrderStatus(trfId, next);
      setNotice(`${trfId} marked ${next}`);
      await load();
      if (preview?.detail.booking.trf_id === trfId) await openTrf(trfId, preview.scanned);
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Could not update status');
    } finally {
      setActing(null);
    }
  }

  const counts = queue?.counts || {};
  const rows = queue?.bookings || [];
  const total = queue?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const showingFrom = total ? (safePage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(safePage * pageSize, total);

  const pageNumbers = useMemo(() => {
    const span = 5;
    let start = Math.max(1, safePage - 2);
    const end = Math.min(pageCount, start + span - 1);
    start = Math.max(1, end - span + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [pageCount, safePage]);

  function pickChip(next: QueueChip) {
    setChip(next);
    setPage(1);
  }

  return (
    <div className="lt-page bb2-page">
      <section className="lt-hero bb2-hero">
        <span className="lt-hero-icon">
          <Icon size={30}>{BARCODE}</Icon>
        </span>
        <div className="bb2-hero-copy">
          <h2>Barcode bench</h2>
          <p>Scan a TRF barcode or tube label to see the sample, its live lifecycle status and posted machine results.</p>
          <form className="bb2-scan" onSubmit={(e) => void lookup(e)}>
            <label className="bb2-scan-field">
              <Icon size={20}>{BARCODE}</Icon>
              <input
                ref={scanRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Scan or type barcode, tube label (…-SST), TRF ID or mobile"
                autoComplete="off"
                autoFocus
                aria-label="Sample barcode"
              />
            </label>
            <button type="submit" className="bb2-scan-btn" disabled={lookupBusy || !code.trim()}>
              {lookupBusy ? 'Looking up…' : 'Lookup'}
            </button>
            <button type="button" className="bb2-scan-btn" onClick={openScanner}>
              Scan with camera
            </button>
          </form>
          <BarcodeScanner {...scannerProps} title="Scan sample barcode" formats={['code_128', 'qr_code', 'code_39']} />
        </div>
        <div className="bb2-hero-links">
          <Link to="/dashboard/lab-reports">Result entry</Link>
          <Link to="/dashboard/accession">Accession</Link>
          <Link to="/dashboard/all-bookings">All bookings</Link>
        </div>
      </section>

      {lookupError ? <div className="error">{lookupError}</div> : null}

      {hits.length ? (
        <section className="lt-table-card">
          <p className="bb2-pick-title">{hits.length} samples match — pick one</p>
          <div className="lt-table-wrap">
            <table className="lt-table">
              <tbody>
                {hits.map((h) => (
                  <tr key={h.trf_id}>
                    <td className="lt-trf">{h.trf_id}</td>
                    <td>{h.patient_name || '—'}</td>
                    <td className="bb2-muted">{h.patient_phone || ''}</td>
                    <td>
                      <code>{h.barcode || ''}</code>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="lt-action is-ghost"
                        onClick={() => void openTrf(h.trf_id, h.trf_id).catch((e) => setLookupError(e instanceof Error ? e.message : 'Lookup failed'))}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {preview ? (
        <PreviewCard
          preview={preview}
          acting={acting}
          onAdvance={(id, next) => void advance(id, next)}
          onClose={() => setPreview(null)}
        />
      ) : null}

      <div className="lt-stats bb2-stats">
        <button type="button" className={`lt-stat tone-blue${chip === 'Booked' ? ' bb2-on' : ''}`} onClick={() => pickChip('Booked')}>
          <span className="lt-stat-icon">
            <Icon size={26}>
              <rect x="3.5" y="5" width="17" height="15" rx="2" />
              <path d="M3.5 10h17M8 3v4M16 3v4" />
            </Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts.Booked ?? 0}</strong>
            <b>Awaiting collection</b>
            <small>Booked, not yet drawn</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className={`lt-stat tone-amber${chip === 'Sample Collected' ? ' bb2-on' : ''}`} onClick={() => pickChip('Sample Collected')}>
          <span className="lt-stat-icon">
            <Icon size={26}>
              <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />
            </Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts['Sample Collected'] ?? 0}</strong>
            <b>Sample collected</b>
            <small>In transit to the lab</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className={`lt-stat tone-green${chip === 'In Lab' ? ' bb2-on' : ''}`} onClick={() => pickChip('In Lab')}>
          <span className="lt-stat-icon">
            <Icon size={26}>{BARCODE}</Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts['In Lab'] ?? 0}</strong>
            <b>In lab</b>
            <small>Received, awaiting results</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className={`lt-stat tone-violet${chip === 'Processing' ? ' bb2-on' : ''}`} onClick={() => pickChip('Processing')}>
          <span className="lt-stat-icon">
            <Icon size={26}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts.Processing ?? 0}</strong>
            <b>Processing</b>
            <small>Results being entered</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
      </div>

      {notice ? <p className="bb2-notice">{notice}</p> : null}
      {queueError ? <div className="error">{queueError}</div> : null}

      <div className="bb2-queue-head">
        <h3>Active samples</h3>
        <div className="lt-chips" role="tablist" aria-label="Queue filter">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={chip === c}
              className={`lt-chip${chip === c ? ' is-active' : ''}`}
              onClick={() => pickChip(c)}
            >
              {c === 'Active' ? 'All active' : c} ({counts[c] ?? 0})
            </button>
          ))}
        </div>
        <button type="button" className="lt-btn-clear bb2-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Booking / barcode</th>
                <th>Patient</th>
                <th>Tests</th>
                <th>Partner / centre</th>
                <th>Booked</th>
                <th>Status</th>
                <th>Action</th>
                <th aria-label="More" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.trf_id}>
                  <td>
                    <span className="lt-trf">{row.trf_id}</span>
                    {row.barcode ? <small className="bb2-sub bb2-mono">{row.barcode}</small> : null}
                  </td>
                  <td>
                    <b className="bb2-name">{row.patient_name || '—'}</b>
                    <small className="bb2-sub">{[formatPatientAge(row), row.gender || ''].filter(Boolean).join(' / ')}</small>
                  </td>
                  <td className="lt-tests">{row.test_labels.join(', ') || '—'}</td>
                  <td>
                    {row.partner_name || '—'}
                    <small className="bb2-sub">{row.collection_type}</small>
                  </td>
                  <td className="bb2-nowrap">{fmtDateTime(row.booking_date)}</td>
                  <td>
                    <StatusBadge status={row.lifecycle_status} />
                    <StageDots stageIndex={row.stage_index} terminal={row.is_terminal} />
                  </td>
                  <td>
                    <QueueAction row={row} acting={acting} onAdvance={(id, next) => void advance(id, next)} />
                  </td>
                  <td>
                    <RowMenu row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? (
            <p className="lt-empty">{loading ? 'Loading queue…' : 'No samples in this stage. Scan a barcode or wait for new bookings.'}</p>
          ) : null}
        </div>
        <div className="lt-table-foot">
          <span>
            Showing {showingFrom} to {showingTo} of {total} samples
          </span>
          <div className="lt-foot-right">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
            <nav className="lt-pager" aria-label="Pagination">
              <button type="button" onClick={() => setPage(1)} disabled={safePage === 1} aria-label="First page">
                «
              </button>
              <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 1} aria-label="Previous page">
                ‹
              </button>
              {pageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n === safePage ? 'is-active' : undefined}
                  aria-current={n === safePage ? 'page' : undefined}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}
              <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage === pageCount} aria-label="Next page">
                ›
              </button>
              <button type="button" onClick={() => setPage(pageCount)} disabled={safePage === pageCount} aria-label="Last page">
                »
              </button>
            </nav>
          </div>
        </div>
      </div>

      <CptPanel />
    </div>
  );
}
