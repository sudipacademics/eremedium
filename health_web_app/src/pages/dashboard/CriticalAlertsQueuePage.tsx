import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../../api';
import { CriticalAlertCounts, CriticalAlertRow } from '../../types/executiveAnalytics';
import './lab-tech-v2.css';
import './critical-alerts-v2.css';

type StatusTab = 'Open' | 'Acknowledged' | 'All';
type AlertKind = 'critical_high' | 'critical_low' | 'critical' | 'high' | 'low';
type BulkKind = 'ack' | 'review' | 'notify';

const PAGE_SIZES = [10, 25, 50];

const KIND_LABEL: Record<AlertKind, string> = {
  critical_high: 'Critical (High)',
  critical_low: 'Critical (Low)',
  critical: 'Critical',
  high: 'Abnormal (High)',
  low: 'Abnormal (Low)',
};

function CIcon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICON_WARN = (
  <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>
);
const ICON_DOWN = (
  <>
    <path d="M4 4h16l-8 16z" />
    <path d="M12 9v3M12 15h.01" />
  </>
);
const ICON_INFO = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </>
);
const ICON_GEAR = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
);
const ICON_SEARCH = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);
const ICON_CAL = (
  <>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>
);
const ICON_EXPORT = (
  <>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </>
);
const ICON_REFRESH = (
  <>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </>
);
const ICON_CHECK = <path d="m5 12 4 4 10-10" />;
const ICON_EYE = (
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
const ICON_MAIL = (
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </>
);

function parseRange(range?: string): { lo?: number; hi?: number } {
  const text = (range || '').replace(/,/g, '');
  const both = text.match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  if (both) return { lo: Number(both[1]), hi: Number(both[2]) };
  const gt = text.match(/>\s*=?\s*(-?\d+(?:\.\d+)?)/);
  if (gt) return { lo: Number(gt[1]) };
  const lt = text.match(/<\s*=?\s*(-?\d+(?:\.\d+)?)/);
  if (lt) return { hi: Number(lt[1]) };
  return {};
}

function alertKind(row: CriticalAlertRow): AlertKind {
  const flag = (row.abnormal_flag || '').toUpperCase();
  if (flag === 'H' || flag === 'HIGH') return 'high';
  if (flag === 'L' || flag === 'LOW') return 'low';
  const value = Number(String(row.result_value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0]);
  const { lo, hi } = parseRange(row.reference_range);
  if (!Number.isNaN(value)) {
    if (hi != null && value > hi) return 'critical_high';
    if (lo != null && value < lo) return 'critical_low';
  }
  return 'critical';
}

function kindTone(kind: AlertKind): string {
  return kind.startsWith('critical') ? 'is-critical' : 'is-abnormal';
}

function kindMatches(kind: AlertKind, filter: string): boolean {
  if (!filter) return true;
  if (filter === 'critical') return kind.startsWith('critical');
  return kind === filter;
}

function formatWhen(raw?: string): string {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function statusTone(status: string): string {
  if (status === 'Open') return 'tone-red';
  if (status === 'Acknowledged') return 'tone-amber';
  if (status === 'Closed') return 'tone-green';
  return 'tone-muted';
}

function statusLabel(status: string): string {
  return status === 'Closed' ? 'Reviewed' : status;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function CriticalAlertsQueuePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusTab>('Open');
  const [rows, setRows] = useState<CriticalAlertRow[]>([]);
  const [counts, setCounts] = useState<CriticalAlertCounts | null>(null);
  const [policy, setPolicy] = useState<{ enabled: boolean; level: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [draftSearch, setDraftSearch] = useState('');
  const [draftKind, setDraftKind] = useState('');
  const [draftDept, setDraftDept] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [applied, setApplied] = useState({ search: '', kind: '', dept: '', from: '', to: '' });

  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bulk, setBulk] = useState<{ kind: BulkKind; ids: string[] } | null>(null);
  const [bulkNote, setBulkNote] = useState('');

  const load = useCallback(async (s: StatusTab) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCriticalAlertsQueue({ status: s, limit: 500 });
      setRows(res.data.alerts || []);
      if (res.data.counts) setCounts(res.data.counts);
      if (res.data.policy) setPolicy(res.data.policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected([]);
    setPage(1);
    void load(status);
  }, [load, status]);

  useEffect(() => {
    if (!menuFor && !showSettings) return;
    const close = () => {
      setMenuFor(null);
      setShowSettings(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor, showSettings]);

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = applied.search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = [r.patient_name, r.customer_trf, r.lab_report, r.parameter, r.patient_phone]
          .map((v) => (v || '').toLowerCase())
          .join(' ');
        if (!hay.includes(q)) return false;
      }
      if (!kindMatches(alertKind(r), applied.kind)) return false;
      if (applied.dept && r.department !== applied.dept) return false;
      const day = (r.creation || '').slice(0, 10);
      if (applied.from && day < applied.from) return false;
      if (applied.to && day > applied.to) return false;
      return true;
    });
  }, [rows, applied]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const showingFrom = filtered.length ? (safePage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(safePage * pageSize, filtered.length);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(safePage - 2, pageCount - 4));
    return Array.from({ length: Math.min(5, pageCount) }, (_, i) => start + i);
  }, [safePage, pageCount]);

  const pageIds = pageRows.map((r) => r.name);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  function onSearch(e?: FormEvent) {
    e?.preventDefault();
    setApplied({ search: draftSearch, kind: draftKind, dept: draftDept, from: draftFrom, to: draftTo });
    setPage(1);
  }

  function onClear() {
    setDraftSearch('');
    setDraftKind('');
    setDraftDept('');
    setDraftFrom('');
    setDraftTo('');
    setApplied({ search: '', kind: '', dept: '', from: '', to: '' });
    setPage(1);
  }

  function quickKind(kind: string) {
    setDraftKind(kind);
    setApplied((cur) => ({ ...cur, kind }));
    setPage(1);
    if (status !== 'Open') setStatus('Open');
  }

  function toggleOne(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleAllOnPage() {
    setSelected((cur) =>
      allOnPage ? cur.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...cur, ...pageIds])),
    );
  }

  function openBulk(kind: BulkKind, ids: string[]) {
    if (!ids.length) return;
    setBulkNote('');
    setBulk({ kind, ids });
  }

  async function runBulk() {
    if (!bulk) return;
    const { kind, ids } = bulk;
    setBulk(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (kind === 'notify') {
        const res = await api.resendCriticalAlertNotifications(ids);
        const failed = res.data.failed?.length || 0;
        setNotice(`Notification sent for ${res.data.sent?.length || 0} alert(s).`);
        if (failed) setError(`${failed} alert(s) could not be notified — check the error log.`);
      } else {
        const target = kind === 'ack' ? 'Acknowledged' : 'Closed';
        const res = await api.updateCriticalAlertsStatus(ids, target, bulkNote.trim() || undefined);
        setNotice(`${res.data.updated?.length || 0} alert(s) ${kind === 'ack' ? 'acknowledged' : 'marked as reviewed'}.`);
      }
      setSelected([]);
      await load(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const header = ['Alert time', 'Patient', 'Mobile', 'TRF', 'Lab report', 'Test', 'Category', 'Result', 'Unit', 'Reference range', 'Alert type', 'Status'];
    const lines = filtered.map((r) => [
      r.creation,
      r.patient_name,
      r.patient_phone,
      r.customer_trf,
      r.lab_report,
      r.parameter,
      r.department,
      r.result_value,
      r.unit,
      r.reference_range,
      KIND_LABEL[alertKind(r)],
      statusLabel(r.alert_status),
    ]);
    const text = [header, ...lines].map((l) => l.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `critical-alerts-${status.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openReport(row: CriticalAlertRow) {
    if (row.customer_trf) navigate(`/dashboard/lab-reports/${encodeURIComponent(row.customer_trf)}`);
  }

  const tabs: Array<{ id: StatusTab; label: string; count?: number }> = [
    { id: 'Open', label: 'Open', count: counts?.open },
    { id: 'Acknowledged', label: 'Acknowledged', count: counts?.acknowledged },
    { id: 'All', label: 'All', count: counts?.all },
  ];

  const bulkTitle: Record<BulkKind, string> = {
    ack: 'Acknowledge alerts',
    review: 'Mark alerts as reviewed',
    notify: 'Send notification',
  };

  return (
    <div className="lt-page ca2-page">
      <section className="ca2-hero">
        <div className="ca2-hero-main">
          <span className="ca2-hero-icon">
            <CIcon size={30}>{ICON_WARN}</CIcon>
          </span>
          <div>
            <h2>Critical &amp; abnormal lab alerts</h2>
            <p>H/L/Critical flags trigger SMS, WhatsApp &amp; email when reports are authorized.</p>
          </div>
        </div>
        <div className="ca2-settings">
          <button
            type="button"
            className="ca2-settings-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowSettings((v) => !v);
            }}
          >
            <CIcon size={17}>{ICON_GEAR}</CIcon> Alert Settings
          </button>
          {showSettings ? (
            <div className="ca2-settings-pop" onClick={(e) => e.stopPropagation()}>
              <b>Current alert policy</b>
              <dl>
                <dt>Alerts</dt>
                <dd>{policy ? (policy.enabled ? 'Enabled' : 'Disabled') : '—'}</dd>
                <dt>Alert level</dt>
                <dd>{policy?.level || '—'}</dd>
              </dl>
              <p>
                Admins change this in ERPNext → Health Ecosystem Settings (Enable critical value alerts / Critical
                alert level).
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="lt-stats">
        <button type="button" className="lt-stat tone-red" onClick={() => quickKind('critical')}>
          <span className="lt-stat-icon">
            <CIcon size={26}>{ICON_WARN}</CIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.open_critical ?? 0}</strong>
            <b>Critical</b>
            <small>Requires immediate attention</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className="lt-stat tone-orange" onClick={() => quickKind('high')}>
          <span className="lt-stat-icon">
            <CIcon size={26}>{ICON_WARN}</CIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.open_high ?? 0}</strong>
            <b>Abnormal (High)</b>
            <small>Above normal range</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className="lt-stat tone-amber" onClick={() => quickKind('low')}>
          <span className="lt-stat-icon">
            <CIcon size={26}>{ICON_DOWN}</CIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.open_low ?? 0}</strong>
            <b>Abnormal (Low)</b>
            <small>Below normal range</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className="lt-stat tone-blue" onClick={() => quickKind('')}>
          <span className="lt-stat-icon">
            <CIcon size={26}>{ICON_INFO}</CIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.open ?? 0}</strong>
            <b>Total Alerts</b>
            <small>All open alerts</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
      </div>

      <section className="ca2-filter-card">
        <div className="ca2-filter-top">
          <div className="ca2-tabs" role="tablist" aria-label="Alert status">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={status === t.id}
                className={status === t.id ? 'is-active' : undefined}
                onClick={() => setStatus(t.id)}
              >
                {t.label} ({t.count ?? '—'})
              </button>
            ))}
          </div>
          <div className="ca2-top-actions">
            <button type="button" className="ca2-outline" onClick={exportCsv} disabled={!filtered.length}>
              <CIcon size={16}>{ICON_EXPORT}</CIcon> Export
            </button>
            <button type="button" className="ca2-outline is-teal" onClick={() => void load(status)} disabled={loading}>
              <CIcon size={16}>{ICON_REFRESH}</CIcon> {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        <form className="lt-filters" onSubmit={onSearch}>
          <label className="lt-search">
            <CIcon size={18}>{ICON_SEARCH}</CIcon>
            <input
              type="search"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Search by patient name, TRF, test name or mobile number…"
              aria-label="Search alerts"
            />
          </label>
          <label className="lt-field">
            <span>Alert Type</span>
            <select value={draftKind} onChange={(e) => setDraftKind(e.target.value)}>
              <option value="">All</option>
              <option value="critical">Critical (all)</option>
              <option value="critical_high">Critical (High)</option>
              <option value="critical_low">Critical (Low)</option>
              <option value="high">Abnormal (High)</option>
              <option value="low">Abnormal (Low)</option>
            </select>
          </label>
          <label className="lt-field">
            <span>Test Category</span>
            <select value={draftDept} onChange={(e) => setDraftDept(e.target.value)}>
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <div className="lt-dates" aria-label="Date range">
            <CIcon size={18}>{ICON_CAL}</CIcon>
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
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table ca2-table">
            <thead>
              <tr>
                <th className="lt-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={allOnPage}
                    disabled={!pageIds.length}
                    onChange={toggleAllOnPage}
                  />
                </th>
                <th>Alert Time</th>
                <th>Patient</th>
                <th>TRF No</th>
                <th>Test Name</th>
                <th>Result</th>
                <th>Reference Range</th>
                <th>Alert Type</th>
                <th>Status</th>
                <th>Action</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <tr>
                  <td colSpan={11} className="lt-empty">
                    Loading alerts…
                  </td>
                </tr>
              ) : !pageRows.length ? (
                <tr>
                  <td colSpan={11} className="lt-empty">
                    {rows.length ? 'No alerts match these filters.' : 'No alerts in this queue.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => {
                  const kind = alertKind(row);
                  const isOpen = row.alert_status === 'Open';
                  const isClosed = row.alert_status === 'Closed';
                  return (
                    <tr key={row.name}>
                      <td className="lt-col-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.name}`}
                          checked={selected.includes(row.name)}
                          onChange={() => toggleOne(row.name)}
                        />
                      </td>
                      <td className="ca2-time">{formatWhen(row.creation)}</td>
                      <td>
                        <strong className="ca2-patient">{row.patient_name || '—'}</strong>
                      </td>
                      <td>{row.customer_trf || row.lab_report || '—'}</td>
                      <td>{row.parameter}</td>
                      <td>
                        <span className={`ca2-result ${kindTone(kind)}`}>
                          {row.result_value} {row.unit || ''}
                        </span>
                      </td>
                      <td className="muted">{row.reference_range || '—'}</td>
                      <td>
                        <span className={`ca2-kind ${kindTone(kind)}`}>
                          <CIcon size={13}>{ICON_WARN}</CIcon>
                          {KIND_LABEL[kind]}
                        </span>
                      </td>
                      <td>
                        <span className={`lt-badge ${statusTone(row.alert_status)}`}>
                          {statusLabel(row.alert_status)}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="lt-action is-ghost"
                          disabled={!row.customer_trf}
                          onClick={() => openReport(row)}
                        >
                          View
                        </button>
                      </td>
                      <td>
                        <div className="lt-row-menu">
                          <button
                            type="button"
                            className="lt-kebab"
                            aria-label="More actions"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuFor(menuFor === row.name ? null : row.name);
                            }}
                          >
                            ⋮
                          </button>
                          {menuFor === row.name ? (
                            <div className="lt-row-menu-pop">
                              <button type="button" disabled={!isOpen || busy} onClick={() => openBulk('ack', [row.name])}>
                                Acknowledge
                              </button>
                              <button
                                type="button"
                                disabled={isClosed || busy}
                                onClick={() => openBulk('review', [row.name])}
                              >
                                Mark as reviewed
                              </button>
                              <button type="button" disabled={busy} onClick={() => openBulk('notify', [row.name])}>
                                Send notification
                              </button>
                              <button type="button" disabled={!row.customer_trf} onClick={() => openReport(row)}>
                                Open result entry
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="lt-table-foot ca2-foot">
          <div className="ca2-bulk">
            <span>{selected.length} selected</span>
            <button type="button" disabled={!selected.length || busy} onClick={() => openBulk('ack', selected)}>
              <CIcon size={15}>{ICON_CHECK}</CIcon> Acknowledge
            </button>
            <button type="button" disabled={!selected.length || busy} onClick={() => openBulk('review', selected)}>
              <CIcon size={15}>{ICON_EYE}</CIcon> Mark as reviewed
            </button>
            <button type="button" disabled={!selected.length || busy} onClick={() => openBulk('notify', selected)}>
              <CIcon size={15}>{ICON_MAIL}</CIcon> Send notification
            </button>
          </div>
          <div className="lt-foot-right">
            <span className="ca2-showing">
              Showing {showingFrom} to {showingTo} of {filtered.length} entries
            </span>
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

      {bulk ? (
        <div className="ca2-modal-backdrop" role="presentation" onClick={() => setBulk(null)}>
          <div className="ca2-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{bulkTitle[bulk.kind]}</h3>
            <p className="muted">
              {bulk.ids.length} alert{bulk.ids.length === 1 ? '' : 's'} selected.
              {bulk.kind === 'notify'
                ? ' This re-sends the critical value SMS / WhatsApp / email to the patient and lab staff.'
                : null}
            </p>
            {bulk.kind !== 'notify' ? (
              <label>
                Note (optional)
                <textarea
                  rows={3}
                  value={bulkNote}
                  onChange={(e) => setBulkNote(e.target.value)}
                  placeholder="e.g. Doctor informed by phone"
                />
              </label>
            ) : null}
            <div className="ca2-modal-actions">
              <button type="button" className="ca2-outline" onClick={() => setBulk(null)}>
                Cancel
              </button>
              <button type="button" className="lt-btn-search" onClick={() => void runBulk()}>
                {bulk.kind === 'notify' ? 'Send' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
