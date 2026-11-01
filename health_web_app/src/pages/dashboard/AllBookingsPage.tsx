import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import {
  AllBookingRow,
  AllBookingsQuery,
  AllBookingsResponse,
  BookingLifecycleDetail,
  LifecycleStage,
} from '../../types/bookingLifecycle';
import { formatPatientAge } from '../../utils/patientAge';
import './lab-tech-v2.css';
import './all-bookings-v2.css';

const PAGE_SIZES = [10, 25, 50];
const REFRESH_MS = 30_000;

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

const STATUS_OPTIONS = ['Active', ...STAGES, 'Rejected', 'Cancelled'];

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

const STATUS_HINT: Record<string, string> = {
  Booked: 'Awaiting collection',
  'Sample Collected': 'Drawn, not received',
  'In Lab': 'Received at lab',
  Processing: 'Results being entered',
  'Result Ready': 'Awaiting sign-off',
  Authorized: 'Signed by pathologist',
  Dispatched: 'Report sent',
  Delivered: 'Report printed / handed over',
  Rejected: 'Sample rejected',
  Cancelled: 'Booking cancelled',
};

const PAYMENT_TONE: Record<string, string> = {
  Paid: 'green',
  'Partially Paid': 'amber',
  Pending: 'amber',
  Failed: 'red',
  Refunded: 'muted',
};

const COLLECTION_TYPES = ['Home Collection', 'Centre Walk-in', 'Lab Walk-in', 'Courier / Outside Sample', 'Walk-in'];
const SOURCES = ['Partner Portal', 'Patient Web / App', 'Hub Bill', 'Mother Lab Bill', 'Lab / Staff Desk', 'Phlebotomist'];
const PAYMENTS = ['Paid', 'Partially Paid', 'Pending', 'Failed', 'Refunded'];

type SearchIn = 'all' | 'booking' | 'patient' | 'test';

type Filters = {
  text: string;
  searchIn: SearchIn;
  status: string;
  partner: string;
  collection: string;
  source: string;
  payment: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  text: '',
  searchIn: 'all',
  status: '',
  partner: '',
  collection: '',
  source: '',
  payment: '',
  from: '',
  to: '',
};

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const CALENDAR = (
  <>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>
);

function parseDate(raw: string | null | undefined) {
  if (!raw) return null;
  const d = new Date(raw.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(raw: string | null | undefined) {
  const d = parseDate(raw);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function fmtTime(raw: string | null | undefined) {
  const d = parseDate(raw);
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '';
}

function fmtDateTime(raw: string | null | undefined) {
  const d = parseDate(raw);
  return d ? `${fmtDate(raw)}, ${fmtTime(raw)}` : '—';
}

function ageGender(row: Pick<AllBookingRow, 'age' | 'age_months' | 'age_days' | 'gender'>) {
  const parts = [
    formatPatientAge(row),
    row.gender ? row.gender.charAt(0).toUpperCase() : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function filtersToQuery(f: Filters, page: number, pageSize: number): AllBookingsQuery {
  const text = f.text.trim();
  return {
    status: f.status || undefined,
    franchisee_id: f.partner || undefined,
    collection_type_filter: f.collection || undefined,
    source: f.source || undefined,
    payment: f.payment || undefined,
    from_date: f.from || undefined,
    to_date: f.to || undefined,
    q: text && f.searchIn === 'all' ? text : undefined,
    booking: text && f.searchIn === 'booking' ? text : undefined,
    patient: text && f.searchIn === 'patient' ? text : undefined,
    test: text && f.searchIn === 'test' ? text : undefined,
    page,
    page_size: pageSize,
  };
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || 'Booked';
  return <span className={`lt-badge tone-${STATUS_TONE[s] || 'muted'}`}>{s}</span>;
}

function PaymentBadge({ status }: { status: string }) {
  return <span className={`lt-badge tone-${PAYMENT_TONE[status] || 'muted'}`}>{status}</span>;
}

function StageDots({ row }: { row: Pick<AllBookingRow, 'stage_index' | 'is_terminal' | 'progress_stage'> }) {
  return (
    <span
      className={`ab2-dots${row.is_terminal ? ' is-terminal' : ''}`}
      title={`Stage ${row.stage_index + 1} of ${STAGES.length}: ${row.progress_stage}`}
      aria-hidden
    >
      {STAGES.map((s, i) => (
        <span key={s} className={i < row.stage_index ? 'is-done' : i === row.stage_index ? 'is-current' : undefined} />
      ))}
    </span>
  );
}

function primaryAction(row: AllBookingRow): { label: string; to: string } {
  if (row.is_terminal) return { label: 'Accession', to: '/dashboard/accession' };
  if (row.stage_index <= 1) return { label: 'Accession', to: '/dashboard/accession' };
  if (row.stage_index <= 3) return { label: 'Result entry', to: `/dashboard/lab-reports/${encodeURIComponent(row.trf_id)}` };
  return { label: 'Lifecycle', to: '/dashboard/report-lifecycle' };
}

function RowMenu({ row, onView }: { row: AllBookingRow; onView: () => void }) {
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
    <div className="lt-row-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="lt-kebab" aria-label={`More actions for ${row.trf_id}`} onClick={() => setOpen((v) => !v)}>
        <Icon size={18}>
          <circle cx="12" cy="5" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="12" cy="19" r="1.2" />
        </Icon>
      </button>
      {open ? (
        <div className="lt-row-menu-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onView();
            }}
          >
            View lifecycle
          </button>
          <Link role="menuitem" to="/dashboard/accession">
            Open in Accession
          </Link>
          <Link role="menuitem" to={`/dashboard/lab-reports/${encodeURIComponent(row.trf_id)}`}>
            Result entry
          </Link>
          <Link role="menuitem" to="/dashboard/report-lifecycle">
            Report lifecycle
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigator.clipboard?.writeText(row.trf_id);
            }}
          >
            Copy booking ID
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  hint,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  count: number;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ab2-stat tone-${tone}${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <strong>{count}</strong>
      <b>{label}</b>
      <small>{hint}</small>
    </button>
  );
}

function Timeline({ booking }: { booking: AllBookingRow }) {
  return (
    <ol className="ab2-timeline">
      {booking.timeline.map((step) => {
        const terminal = step.stage === 'Rejected' || step.stage === 'Cancelled';
        const cls = terminal ? 'is-terminal' : step.current ? 'is-current' : step.reached ? 'is-done' : 'is-pending';
        return (
          <li key={step.stage} className={cls}>
            <span className="ab2-tl-dot" aria-hidden />
            <div className="ab2-tl-body">
              <div className="ab2-tl-head">
                <b>{step.stage}</b>
                {step.current ? <span className="ab2-tl-now">Current</span> : null}
              </div>
              <span className="ab2-tl-meta">
                {step.reached ? (step.at ? fmtDateTime(step.at) : 'Reached — time not recorded') : 'Pending'}
                {step.reached && step.source ? ` · ${step.source}` : ''}
              </span>
              {step.reason ? <span className="ab2-tl-reason">{step.reason}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function BookingDrawer({
  trfId,
  row,
  refreshKey,
  onClose,
}: {
  trfId: string;
  row: AllBookingRow | undefined;
  refreshKey: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BookingLifecycleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getBookingLifecycleDetail(trfId)
      .then((res) => {
        if (!cancelled) setDetail(res.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load booking');
      });
    return () => {
      cancelled = true;
    };
  }, [trfId, refreshKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const b = detail?.booking.trf_id === trfId ? detail.booking : row;

  return (
    <div className="ab2-drawer-backdrop" onClick={onClose}>
      <aside className="ab2-drawer" role="dialog" aria-modal="true" aria-label={`Booking ${trfId}`} onClick={(e) => e.stopPropagation()}>
        <header className="ab2-drawer-head">
          <div>
            <span className="ab2-drawer-kicker">Booking</span>
            <h3>{trfId}</h3>
            {b?.barcode ? <code>{b.barcode}</code> : null}
          </div>
          <button type="button" className="ab2-drawer-close" onClick={onClose} aria-label="Close">
            <Icon size={20}>
              <path d="M6 6l12 12M18 6L6 18" />
            </Icon>
          </button>
        </header>

        {error ? <div className="error">{error}</div> : null}
        {!b ? <p className="lt-empty">Loading booking…</p> : null}

        {b ? (
          <div className="ab2-drawer-body">
            <div className="ab2-drawer-status">
              <StatusBadge status={b.lifecycle_status} />
              <StageDots row={b} />
              <span className="ab2-muted">TRF status: {b.order_status || '—'}</span>
            </div>

            <dl className="ab2-facts">
              <div>
                <dt>Patient</dt>
                <dd>
                  {b.patient_name || '—'}
                  <small>{[ageGender(b), b.patient_phone].filter(Boolean).join(' · ')}</small>
                </dd>
              </div>
              <div>
                <dt>Partner / centre</dt>
                <dd>
                  {b.partner_name || '—'}
                  <small>{b.booking_source}</small>
                </dd>
              </div>
              <div>
                <dt>Booked on</dt>
                <dd>{fmtDateTime(b.booking_date)}</dd>
              </div>
              <div>
                <dt>Collection</dt>
                <dd>
                  {b.collection_type}
                  <small>{b.collection_slot ? fmtDateTime(b.collection_slot) : b.intake_channel || ''}</small>
                </dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>
                  <PaymentBadge status={b.payment_status} />
                  <small>
                    {[b.payment_method, b.amount != null ? `₹${Number(b.amount).toLocaleString('en-IN')}` : ''].filter(Boolean).join(' · ')}
                  </small>
                </dd>
              </div>
              <div>
                <dt>Report</dt>
                <dd>
                  {b.report_status || 'No report yet'}
                  <small>{b.journey_status ? `Journey: ${b.journey_status}` : ''}</small>
                </dd>
              </div>
            </dl>

            <section>
              <h4>Tests / package</h4>
              <ul className="ab2-test-list">
                {b.test_labels.length ? b.test_labels.map((t, i) => <li key={`${t}-${i}`}>{t}</li>) : <li>—</li>}
              </ul>
            </section>

            <section>
              <h4>Lifecycle</h4>
              <Timeline booking={b} />
            </section>

            {detail?.tubes.length ? (
              <section>
                <h4>Collection tubes</h4>
                <table className="ab2-mini-table">
                  <tbody>
                    {detail.tubes.map((t, i) => (
                      <tr key={`${t.tube_code}-${i}`}>
                        <td>{t.tube_code || 'Tube'}</td>
                        <td>
                          <span className={`lt-badge tone-${t.status === 'Received' ? 'green' : t.status === 'Rejected' ? 'red' : t.status === 'Drawn' ? 'amber' : 'muted'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="ab2-muted">
                          {t.received_at ? `Recv ${fmtDateTime(t.received_at)}` : t.drawn_at ? `Drawn ${fmtDateTime(t.drawn_at)}` : t.rejected_reason || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {detail?.reports.length ? (
              <section>
                <h4>Lab reports</h4>
                <table className="ab2-mini-table">
                  <tbody>
                    {detail.reports.map((r) => (
                      <tr key={r.name}>
                        <td>{r.department || r.name}</td>
                        <td>
                          <StatusBadge status={r.report_status === 'Verified' ? 'Result Ready' : r.report_status === 'Printed' ? 'Delivered' : r.report_status === 'Authorized' ? 'Authorized' : 'Processing'} />
                        </td>
                        <td className="ab2-muted">{r.report_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {detail?.rejections.length ? (
              <section>
                <h4>Sample rejections</h4>
                <ul className="ab2-log">
                  {detail.rejections.map((r) => (
                    <li key={r.name}>
                      <b>{r.reason || 'Rejected'}</b>
                      <span>{fmtDateTime(r.rejected_on)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {detail?.critical_alerts.length ? (
              <section>
                <h4>Critical values</h4>
                <ul className="ab2-log">
                  {detail.critical_alerts.map((a) => (
                    <li key={a.name}>
                      <b>
                        {a.parameter}: {a.result_value} {a.unit || ''}
                      </b>
                      <span>
                        {a.alert_status} · {fmtDateTime(a.creation)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {detail?.journey_log.length ? (
              <section>
                <h4>Activity log</h4>
                <ul className="ab2-log">
                  {detail.journey_log.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                      <b>{e.message}</b>
                      <span>{fmtDateTime(e.at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        <footer className="ab2-drawer-foot">
          <Link className="lt-action is-ghost" to="/dashboard/accession">
            Accession
          </Link>
          <Link className="lt-action is-ghost" to={`/dashboard/lab-reports/${encodeURIComponent(trfId)}`}>
            Result entry
          </Link>
          <Link className="lt-action" to="/dashboard/report-lifecycle">
            Report lifecycle
          </Link>
        </footer>
      </aside>
    </div>
  );
}

function initialFilters(params: URLSearchParams): Filters {
  return {
    ...EMPTY_FILTERS,
    text: params.get('q') || '',
    status: params.get('status') || '',
    partner: params.get('partner') || '',
  };
}

export function AllBookingsPage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Filters>(() => initialFilters(params));
  const [filters, setFilters] = useState<Filters>(() => initialFilters(params));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<AllBookingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const openTrf = params.get('trf');
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await api.getAllBookings(filtersToQuery(filters, page, pageSize));
      if (seq !== requestSeq.current) return;
      setData(res.data);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      if (seq === requestSeq.current) setError(e instanceof Error ? e.message : 'Failed to load bookings');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
    setRefreshKey((k) => k + 1);
  }, [load]);

  useLiveRefresh(refresh, REFRESH_MS);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const counts = data?.counts || {};
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const rows = useMemo(() => data?.bookings || [], [data]);

  const pageNumbers = useMemo(() => {
    const span = 5;
    let start = Math.max(1, safePage - 2);
    const end = Math.min(pageCount, start + span - 1);
    start = Math.max(1, end - span + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [pageCount, safePage]);

  function applyFilters(next: Filters) {
    setFilters(next);
    setPage(1);
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    applyFilters(draft);
  }

  function onClear() {
    setDraft(EMPTY_FILTERS);
    applyFilters(EMPTY_FILTERS);
    if (params.get('q') || params.get('status') || params.get('partner')) {
      const next = new URLSearchParams(params);
      next.delete('q');
      next.delete('status');
      next.delete('partner');
      setParams(next, { replace: true });
    }
  }

  function pickStatus(status: string) {
    const value = filters.status === status ? '' : status;
    setDraft((d) => ({ ...d, status: value }));
    applyFilters({ ...filters, status: value });
  }

  function openDrawer(trfId: string) {
    const next = new URLSearchParams(params);
    next.set('trf', trfId);
    setParams(next, { replace: true });
  }

  const closeDrawer = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('trf');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const showingFrom = total ? (safePage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(safePage * pageSize, total);
  const partners = data?.partners || [];

  const statCards: Array<{ key: string; label: string; hint: string; tone: string; count: number }> = [
    { key: '', label: 'All bookings', hint: `${counts['Partner Portal'] ?? 0} via Partner Portal`, tone: 'slate', count: counts.All ?? 0 },
    ...STAGES.map((s) => ({ key: s, label: s, hint: STATUS_HINT[s], tone: STATUS_TONE[s], count: counts[s] ?? 0 })),
    {
      key: 'Rejected',
      label: 'Rejected',
      hint: `${counts.Cancelled ?? 0} cancelled`,
      tone: 'red',
      count: (counts.Rejected ?? 0),
    },
  ];

  return (
    <div className="lt-page ab2-page">
      <section className="lt-hero ab2-hero">
        <span className="lt-hero-icon">
          <Icon size={30}>{CALENDAR}</Icon>
        </span>
        <div className="ab2-hero-copy">
          <h2>All bookings</h2>
          <p>
            Every booking from the Partner Portal, patient app and lab bill desks — with its live lifecycle status derived from
            accession, result entry, report sign-off and dispatch records.
          </p>
        </div>
        <div className="ab2-hero-side">
          <span className="ab2-live">
            <span className="ab2-live-dot" aria-hidden />
            {updatedAt ? `Live · updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Connecting…'}
          </span>
          <button type="button" className="ab2-hero-btn" onClick={refresh} disabled={loading}>
            <Icon size={16}>
              <path d="M20 12a8 8 0 1 1-2.3-5.6" />
              <path d="M20 4v5h-5" />
            </Icon>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      <div className="ab2-stats" role="group" aria-label="Lifecycle status filters">
        {statCards.map((c) => (
          <StatCard
            key={c.key || 'all'}
            label={c.label}
            hint={c.hint}
            count={c.count}
            tone={c.tone}
            active={filters.status === c.key}
            onClick={() => pickStatus(c.key)}
          />
        ))}
      </div>

      <form className="ab2-filters" onSubmit={onSearch}>
        <div className="ab2-search-group">
          <label className="lt-search">
            <Icon size={18}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </Icon>
            <input
              type="search"
              value={draft.text}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              placeholder="Search booking ID, barcode, patient, phone or test…"
              aria-label="Search bookings"
            />
          </label>
          <label className="lt-field ab2-search-in">
            <span>Search in</span>
            <select value={draft.searchIn} onChange={(e) => setDraft((d) => ({ ...d, searchIn: e.target.value as SearchIn }))}>
              <option value="all">All fields</option>
              <option value="booking">Booking ID / barcode</option>
              <option value="patient">Patient name / phone</option>
              <option value="test">Test / package</option>
            </select>
          </label>
        </div>
        <label className="lt-field">
          <span>Status</span>
          <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'Active' ? 'Active (Booked → Processing)' : s}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          <span>Partner / centre</span>
          <select value={draft.partner} onChange={(e) => setDraft((d) => ({ ...d, partner: e.target.value }))}>
            <option value="">All partners</option>
            {partners.map((p) => (
              <option key={p.franchisee_id} value={p.franchisee_id}>
                {p.name} ({p.count})
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          <span>Collection type</span>
          <select value={draft.collection} onChange={(e) => setDraft((d) => ({ ...d, collection: e.target.value }))}>
            <option value="">All types</option>
            {COLLECTION_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          <span>Booked via</span>
          <select value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}>
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          <span>Payment</span>
          <select value={draft.payment} onChange={(e) => setDraft((d) => ({ ...d, payment: e.target.value }))}>
            <option value="">All</option>
            {PAYMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="lt-field">
          <span>Booking date</span>
          <div className="lt-dates" aria-label="Booking date range">
            <Icon size={18}>{CALENDAR}</Icon>
            <input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} aria-label="From date" />
            <span>–</span>
            <input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} aria-label="To date" />
          </div>
        </div>
        <div className="ab2-filter-actions">
          <button type="button" className="lt-btn-clear" onClick={onClear}>
            Clear
          </button>
          <button type="submit" className="lt-btn-search">
            Search
          </button>
        </div>
      </form>

      {error ? <div className="error">{error}</div> : null}
      {data?.truncated ? (
        <p className="ab2-note">Showing the latest 3,000 matching bookings — narrow the date range to see older ones.</p>
      ) : null}

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table ab2-table">
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Patient</th>
                <th>Test / Package</th>
                <th>Booking date</th>
                <th>Partner / Centre</th>
                <th>Collection</th>
                <th>Payment</th>
                <th>Current status</th>
                <th>Action</th>
                <th aria-label="More" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const action = primaryAction(row);
                return (
                  <tr key={row.trf_id} className="ab2-row" onClick={() => openDrawer(row.trf_id)}>
                    <td>
                      <span className="lt-trf">{row.trf_id}</span>
                      {row.barcode ? <small className="ab2-sub ab2-mono">{row.barcode}</small> : null}
                    </td>
                    <td>
                      <span className="ab2-strong">{row.patient_name || '—'}</span>
                      <small className="ab2-sub">{[ageGender(row), row.patient_phone].filter(Boolean).join(' · ') || '—'}</small>
                    </td>
                    <td className="lt-tests">
                      {row.test_labels.slice(0, 2).join(', ') || '—'}
                      {row.test_labels.length > 2 ? <small className="ab2-more">+{row.test_labels.length - 2} more</small> : null}
                    </td>
                    <td className="ab2-nowrap">
                      {fmtDate(row.booking_date)}
                      <small className="ab2-sub">{fmtTime(row.booking_date)}</small>
                    </td>
                    <td>
                      <span className="ab2-strong">{row.partner_name || '—'}</span>
                      <small className={`ab2-sub${row.booking_source === 'Partner Portal' ? ' ab2-partner' : ''}`}>{row.booking_source}</small>
                    </td>
                    <td className="ab2-nowrap">{row.collection_type}</td>
                    <td>
                      <PaymentBadge status={row.payment_status} />
                      {row.payment_method ? <small className="ab2-sub">{row.payment_method}</small> : null}
                    </td>
                    <td>
                      <StatusBadge status={row.lifecycle_status} />
                      <StageDots row={row} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="ab2-actions">
                        <button type="button" className="lt-action is-ghost ab2-view" onClick={() => openDrawer(row.trf_id)}>
                          View
                        </button>
                        <Link className="lt-action" to={action.to}>
                          {action.label}
                        </Link>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <RowMenu row={row} onView={() => openDrawer(row.trf_id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? (
            <p className="lt-empty">{loading ? 'Loading bookings…' : 'No bookings match these filters.'}</p>
          ) : null}
        </div>

        <div className="lt-table-foot">
          <span>
            Showing {showingFrom} to {showingTo} of {total} bookings
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

      {openTrf ? (
        <BookingDrawer
          trfId={openTrf}
          row={rows.find((r) => r.trf_id === openTrf)}
          refreshKey={refreshKey}
          onClose={closeDrawer}
        />
      ) : null}
    </div>
  );
}
