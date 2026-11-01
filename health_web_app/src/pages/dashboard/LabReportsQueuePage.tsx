import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { LabReportQueue, LabReportQueueRow } from '../../types/labReport';
import './lab-tech-v2.css';

type Chip = 'all' | 'awaiting' | 'in_lab' | 'collected' | 'verified' | 'draft' | 'no_report';

const PAGE_SIZES = [10, 25, 50];
const AWAITING_REPORT = new Set(['', 'Draft', 'In Progress']);
const VERIFIED_REPORT = new Set(['Verified', 'Authorized', 'Signed', 'Dispatched']);

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const FLASK = <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3M7.5 15h9" />;

function tone(value: string | null | undefined) {
  const v = (value || '').toLowerCase();
  if (!v) return 'muted';
  if (v.includes('critical') || v.includes('reject') || v.includes('cancel')) return 'red';
  if (v.includes('authoriz') || v.includes('verified') || v.includes('signed') || v.includes('dispatch') || v.includes('collected')) return 'green';
  if (v.includes('draft') || v.includes('pending')) return 'amber';
  if (v.includes('progress') || v.includes('lab')) return 'blue';
  return 'muted';
}

function Badge({ value, empty = '—' }: { value: string | null | undefined; empty?: string }) {
  return <span className={`lt-badge tone-${tone(value)}`}>{value || empty}</span>;
}

function rowDate(row: LabReportQueueRow) {
  const raw = row.modified || row.collection_slot || '';
  const d = raw ? new Date(raw.replace(' ', 'T')) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function matchesChip(row: LabReportQueueRow, chip: Chip) {
  const report = row.report_status || '';
  switch (chip) {
    case 'awaiting':
      return Boolean(row.lab_report) && AWAITING_REPORT.has(report);
    case 'in_lab':
      return row.order_status === 'In Lab';
    case 'collected':
      return row.order_status === 'Sample Collected';
    case 'verified':
      return VERIFIED_REPORT.has(report);
    case 'draft':
      return report === 'Draft';
    case 'no_report':
      return !row.lab_report;
    default:
      return true;
  }
}

function RowMenu({ row, onOpen }: { row: LabReportQueueRow; onOpen: () => void }) {
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
          <button type="button" role="menuitem" onClick={onOpen}>
            {row.lab_report ? 'Enter results' : 'Open report'}
          </button>
          <Link role="menuitem" to="/dashboard/report-lifecycle">
            Report lifecycle
          </Link>
          <Link role="menuitem" to="/dashboard/accession">
            Accession
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function LabReportsQueuePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<LabReportQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [criticalCount, setCriticalCount] = useState(0);

  const [draftSearch, setDraftSearch] = useState('');
  const [draftTrf, setDraftTrf] = useState('');
  const [draftReport, setDraftReport] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [filters, setFilters] = useState({ search: '', trf: '', report: '', from: '', to: '' });
  const [chip, setChip] = useState<Chip>('all');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await api.getLabReportQueue(200);
    setData(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'));
    api
      .getCriticalAlertsQueue({ status: 'Open', limit: 50 })
      .then((res) => setCriticalCount(res.data?.count ?? res.data?.alerts?.length ?? 0))
      .catch(() => undefined);
  }, [load]);

  const queue = useMemo(() => data?.queue || [], [data]);

  const trfStatuses = useMemo(
    () => Array.from(new Set(queue.map((r) => r.order_status).filter(Boolean))).sort(),
    [queue],
  );
  const reportStatuses = useMemo(
    () => Array.from(new Set(queue.map((r) => r.report_status || 'No report'))).sort(),
    [queue],
  );

  const baseFiltered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
    const to = filters.to ? new Date(`${filters.to}T23:59:59`) : null;
    return queue.filter((row) => {
      if (q) {
        const hay = `${row.trf_id} ${row.patient_name || ''} ${row.test_required || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.trf && row.order_status !== filters.trf) return false;
      if (filters.report && (row.report_status || 'No report') !== filters.report) return false;
      if (from || to) {
        const d = rowDate(row);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      return true;
    });
  }, [filters, queue]);

  const chipCounts = useMemo(() => {
    const keys: Chip[] = ['all', 'awaiting', 'in_lab', 'collected', 'verified', 'draft', 'no_report'];
    return Object.fromEntries(keys.map((k) => [k, baseFiltered.filter((r) => matchesChip(r, k)).length])) as Record<Chip, number>;
  }, [baseFiltered]);

  const rows = useMemo(() => baseFiltered.filter((r) => matchesChip(r, chip)), [baseFiltered, chip]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [filters, chip, pageSize]);

  const inLabCount = useMemo(() => queue.filter((r) => r.order_status === 'In Lab').length, [queue]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setFilters({ search: draftSearch, trf: draftTrf, report: draftReport, from: draftFrom, to: draftTo });
  }

  function onClear() {
    setDraftSearch('');
    setDraftTrf('');
    setDraftReport('');
    setDraftFrom('');
    setDraftTo('');
    setFilters({ search: '', trf: '', report: '', from: '', to: '' });
    setChip('all');
  }

  function openRow(row: LabReportQueueRow) {
    navigate(`/dashboard/lab-reports/${encodeURIComponent(row.trf_id)}`);
  }

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.trf_id));
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.trf_id));
      else pageRows.forEach((r) => next.add(r.trf_id));
      return next;
    });
  }
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pageNumbers = useMemo(() => {
    const span = 5;
    let start = Math.max(1, safePage - 2);
    const end = Math.min(pageCount, start + span - 1);
    start = Math.max(1, end - span + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [pageCount, safePage]);

  if (!data && !error) return <p>Loading lab report queue…</p>;

  const chips: Array<{ id: Chip; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'awaiting', label: 'Awaiting Entry' },
    { id: 'in_lab', label: 'In Lab' },
    { id: 'collected', label: 'Sample Collected' },
    { id: 'verified', label: 'Verified' },
    { id: 'draft', label: 'Draft' },
    { id: 'no_report', label: 'No Report' },
  ];

  const showingFrom = rows.length ? (safePage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(safePage * pageSize, rows.length);

  return (
    <div className="lt-page">
      <div className="lt-stats">
        <button type="button" className="lt-stat tone-green" onClick={() => setChip('awaiting')}>
          <span className="lt-stat-icon">
            <Icon size={26}>{FLASK}</Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{data?.queue_count ?? 0}</strong>
            <b>Awaiting Entry</b>
            <small>Samples pending result entry</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <Link className="lt-stat tone-blue" to="/dashboard/report-lifecycle">
          <span className="lt-stat-icon">
            <Icon size={26}>
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l2.7 2.7L16.5 9.5" />
            </Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{data?.review_count ?? 0}</strong>
            <b>Verified (Sign-off)</b>
            <small>Ready for dispatch</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </Link>
        <button type="button" className="lt-stat tone-amber" onClick={() => setChip('in_lab')}>
          <span className="lt-stat-icon">
            <Icon size={26}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{inLabCount}</strong>
            <b>In Progress</b>
            <small>Samples under testing</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <Link className="lt-stat tone-red" to="/dashboard/critical-alerts">
          <span className="lt-stat-icon">
            <Icon size={26}>
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 1.5M9 3h6" />
            </Icon>
          </span>
          <span className="lt-stat-copy">
            <strong>{criticalCount}</strong>
            <b>Critical Alerts</b>
            <small>Requires attention</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </Link>
      </div>

      <section className="lt-hero">
        <span className="lt-hero-icon">
          <Icon size={30}>{FLASK}</Icon>
        </span>
        <div>
          <h2>Lab result entry</h2>
          <p>
            Enter results for samples in the lab, then finalize for pathologist review. Sign-off and dispatch are on the
            report lifecycle page.
          </p>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <form className="lt-filters" onSubmit={onSearch}>
        <label className="lt-search">
          <Icon size={18}>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </Icon>
          <input
            type="search"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            placeholder="Search by TRF No, patient name, test name…"
            aria-label="Search queue"
          />
        </label>
        <label className="lt-field">
          <span>TRF Status</span>
          <select value={draftTrf} onChange={(e) => setDraftTrf(e.target.value)}>
            <option value="">All</option>
            {trfStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          <span>Report Status</span>
          <select value={draftReport} onChange={(e) => setDraftReport(e.target.value)}>
            <option value="">All</option>
            {reportStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="lt-dates" aria-label="Date range">
          <Icon size={18}>
            <rect x="3.5" y="5" width="17" height="15" rx="2" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </Icon>
          <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} aria-label="From date" />
          <span>–</span>
          <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} aria-label="To date" />
        </div>
        <button type="button" className="lt-btn-clear" onClick={onClear}>
          Clear
        </button>
        <button type="submit" className="lt-btn-search">
          Search
        </button>
      </form>

      <div className="lt-chips" role="tablist" aria-label="Queue filter">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={chip === c.id}
            className={`lt-chip${chip === c.id ? ' is-active' : ''}`}
            onClick={() => setChip(c.id)}
          >
            {c.label} ({chipCounts[c.id]})
          </button>
        ))}
      </div>

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th className="lt-col-check">
                  <input type="checkbox" checked={allOnPageSelected} onChange={togglePage} aria-label="Select all on page" />
                </th>
                <th>TRF</th>
                <th>Patient</th>
                <th>Tests</th>
                <th>TRF Status</th>
                <th>Report Status</th>
                <th>Action</th>
                <th aria-label="More" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.trf_id}>
                  <td className="lt-col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(row.trf_id)}
                      onChange={() => toggleRow(row.trf_id)}
                      aria-label={`Select ${row.trf_id}`}
                    />
                  </td>
                  <td className="lt-trf">{row.trf_id}</td>
                  <td>{row.patient_name || '—'}</td>
                  <td className="lt-tests">{row.test_required || '—'}</td>
                  <td>
                    <Badge value={row.order_status} />
                  </td>
                  <td>
                    <Badge value={row.report_status} empty="No report" />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`lt-action${row.lab_report ? '' : ' is-ghost'}`}
                      onClick={() => openRow(row)}
                    >
                      {row.lab_report ? 'Enter results' : 'Open report'}
                    </button>
                  </td>
                  <td>
                    <RowMenu row={row} onOpen={() => openRow(row)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pageRows.length ? <p className="lt-empty">No samples match these filters.</p> : null}
        </div>

        <div className="lt-table-foot">
          <span>
            Showing {showingFrom} to {showingTo} of {rows.length} entries
          </span>
          <div className="lt-foot-right">
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">
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
    </div>
  );
}
