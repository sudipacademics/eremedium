import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { AuthorizeReportDialog } from '../../components/AuthorizeReportDialog';
import { ReportDispatchActions } from '../../components/ReportDispatchActions';
import {
  ReportLifecycleJourney,
  ReportLifecycleQueue,
  ReportLifecycleVerified,
} from '../../types/reportLifecycle';
import './lab-tech-v2.css';
import './report-lifecycle-v2.css';

const PREVIEW_ROWS = 5;

type SectionKey = 'verified' | 'review' | 'authorized' | 'dispatched';

function RIcon({ children, size = 22 }: { children: ReactNode; size?: number }) {
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

const ICON_DOC = (
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
  </>
);
const ICON_CHECK = (
  <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>
);
const ICON_EYE = (
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
const ICON_LOCK = (
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>
);
const ICON_SEND = (
  <>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </>
);
const ICON_TRUCK = (
  <>
    <path d="M1 4h14v12H1zM15 9h4l3 3v4h-7" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
  </>
);
const ICON_REFRESH = (
  <>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </>
);
const ICON_DOWNLOAD = (
  <>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 19h16" />
  </>
);
const ICON_SEARCH = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);

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

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  if (!q) return true;
  return fields.some((f) => (f || '').toLowerCase().includes(q));
}

function SectionHead({
  icon,
  tone,
  title,
  count,
  canExpand,
  expanded,
  onToggle,
  extra,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  count: number;
  canExpand: boolean;
  expanded: boolean;
  onToggle: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="rl2-sec-head">
      <div className="rl2-sec-title">
        <span className={`rl2-sec-icon ${tone}`}>
          <RIcon size={18}>{icon}</RIcon>
        </span>
        <h3>{title}</h3>
        <span className={`rl2-count ${tone}`}>{count}</span>
      </div>
      <div className="rl2-sec-tools">
        {canExpand ? (
          <button type="button" className="rl2-viewall" onClick={onToggle}>
            {expanded ? 'Show less' : 'View all'}
          </button>
        ) : null}
        {extra}
      </div>
    </div>
  );
}

function RowMenu({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="lt-row-menu">
      <button
        type="button"
        className="lt-kebab"
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        ⋮
      </button>
      {open ? <div className="lt-row-menu-pop">{children}</div> : null}
    </div>
  );
}

function HeadCheck({ ids, selected, onToggleAll }: { ids: string[]; selected: string[]; onToggleAll: () => void }) {
  return (
    <th className="lt-col-check">
      <input
        type="checkbox"
        aria-label="Select all"
        checked={ids.length > 0 && ids.every((id) => selected.includes(id))}
        disabled={!ids.length}
        onChange={onToggleAll}
      />
    </th>
  );
}

function RowCheck({ id, checked, onToggle }: { id: string; checked: boolean; onToggle: () => void }) {
  return (
    <td className="lt-col-check">
      <input type="checkbox" aria-label={`Select ${id}`} checked={checked} onChange={onToggle} />
    </td>
  );
}

function JourneyTable({
  rows,
  selected,
  onToggleOne,
  onToggleAll,
  badgeTone,
  dateLabel,
  emptyText,
  renderActions,
  renderMenu,
}: {
  rows: ReportLifecycleJourney[];
  selected: string[];
  onToggleOne: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  badgeTone: string;
  dateLabel: string;
  emptyText: string;
  renderActions: (row: ReportLifecycleJourney) => ReactNode;
  renderMenu: (row: ReportLifecycleJourney) => ReactNode;
}) {
  const ids = rows.map((r) => r.journey_id);
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <HeadCheck ids={ids} selected={selected} onToggleAll={() => onToggleAll(ids)} />
            <th>Journey ID</th>
            <th>Patient</th>
            <th>TRF</th>
            <th>Tests</th>
            <th>Status</th>
            <th>{dateLabel}</th>
            <th>Action</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.journey_id}>
                <RowCheck
                  id={row.journey_id}
                  checked={selected.includes(row.journey_id)}
                  onToggle={() => onToggleOne(row.journey_id)}
                />
                <td className="lt-trf">{row.journey_id}</td>
                <td>{row.patient_name || '—'}</td>
                <td>{row.customer_trf || '—'}</td>
                <td className="lt-tests">{row.tests || '—'}</td>
                <td>
                  <span className={`lt-badge ${badgeTone}`}>{row.status}</span>
                </td>
                <td className="muted" title={formatWhen(row.modified)}>
                  {row.ago || '—'}
                </td>
                <td>{renderActions(row)}</td>
                <td>{renderMenu(row)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={9} className="lt-empty">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ReportLifecyclePage() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<ReportLifecycleQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [authorizeTarget, setAuthorizeTarget] = useState<ReportLifecycleJourney | null>(null);
  const [sectionSearch, setSectionSearch] = useState<Record<SectionKey, string>>({
    verified: '',
    review: '',
    authorized: '',
    dispatched: '',
  });
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    verified: false,
    review: false,
    authorized: false,
    dispatched: false,
  });
  const [selected, setSelected] = useState<Record<SectionKey, string[]>>({
    verified: [],
    review: [],
    authorized: [],
    dispatched: [],
  });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sectionRefs = useRef<Record<SectionKey, HTMLElement | null>>({
    verified: null,
    review: null,
    authorized: null,
    dispatched: null,
  });

  const load = useCallback(async () => {
    const res = await api.getReportLifecycleQueue(50);
    setQueue(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'));
  }, [load]);

  useEffect(() => {
    if (!menuFor && !exportOpen) return;
    const close = () => {
      setMenuFor(null);
      setExportOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor, exportOpen]);

  function sectionQuery(key: SectionKey) {
    return sectionSearch[key].trim().toLowerCase();
  }

  function setSectionQuery(key: SectionKey, value: string) {
    setSectionSearch((cur) => ({ ...cur, [key]: value }));
    if (value.trim()) setExpanded((cur) => ({ ...cur, [key]: true }));
  }

  const verified = useMemo(
    () =>
      (queue?.verified_reports || []).filter((r) =>
        matches(sectionQuery('verified'), r.patient_name, r.trf_id, r.lab_report, r.tests, r.journey_id),
      ),
    [queue, sectionSearch.verified],
  );
  const review = useMemo(
    () =>
      (queue?.pending_review || []).filter((r) =>
        matches(sectionQuery('review'), r.patient_name, r.customer_trf, r.journey_id, r.tests),
      ),
    [queue, sectionSearch.review],
  );
  const authorized = useMemo(
    () =>
      (queue?.authorized || []).filter((r) =>
        matches(sectionQuery('authorized'), r.patient_name, r.customer_trf, r.journey_id, r.tests),
      ),
    [queue, sectionSearch.authorized],
  );
  const dispatched = useMemo(
    () =>
      (queue?.dispatched || []).filter((r) =>
        matches(sectionQuery('dispatched'), r.patient_name, r.customer_trf, r.journey_id, r.tests),
      ),
    [queue, sectionSearch.dispatched],
  );

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await load();
      setNotice('Queue refreshed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function runAction(id: string, label: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      setNotice(`${label} completed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function confirmAuthorize(notes: string) {
    if (!authorizeTarget) return;
    const journeyId = authorizeTarget.journey_id;
    setBusy(journeyId);
    setError(null);
    try {
      await api.authorizeLabReport({ journey_id: journeyId, pathologist_notes: notes || undefined });
      setAuthorizeTarget(null);
      setNotice('Report authorized — use Send to WhatsApp or Download Report.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
    } finally {
      setBusy(null);
    }
  }

  if (!queue && !error) return <p>Loading report lifecycle…</p>;

  const counts = queue?.counts;
  const canAuthorize = !!queue?.can_authorize;

  function scrollTo(key: SectionKey) {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleOne(key: SectionKey, id: string) {
    setSelected((cur) => ({
      ...cur,
      [key]: cur[key].includes(id) ? cur[key].filter((x) => x !== id) : [...cur[key], id],
    }));
  }

  function toggleAll(key: SectionKey, ids: string[]) {
    setSelected((cur) => ({
      ...cur,
      [key]: ids.length && ids.every((id) => cur[key].includes(id)) ? [] : ids,
    }));
  }

  function toggleExpanded(key: SectionKey) {
    setExpanded((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  function menuProps(id: string) {
    return { open: menuFor === id, onToggle: () => setMenuFor(menuFor === id ? null : id) };
  }

  function exportSection(key: SectionKey | 'all') {
    const stamp = new Date().toISOString().slice(0, 10);
    const header = ['Section', 'ID', 'Patient', 'TRF', 'Tests', 'Status', 'Updated'];
    const rows: unknown[][] = [];
    const pushJourneys = (label: string, list: ReportLifecycleJourney[]) =>
      list.forEach((r) =>
        rows.push([label, r.journey_id, r.patient_name, r.customer_trf, r.tests, r.status, r.modified]),
      );
    if (key === 'all' || key === 'verified')
      verified.forEach((r) =>
        rows.push(['Verified', r.lab_report, r.patient_name, r.trf_id, r.tests, r.report_status, r.modified]),
      );
    if (key === 'all' || key === 'review') pushJourneys('Report review', review);
    if (key === 'all' || key === 'authorized') pushJourneys('Authorized', authorized);
    if (key === 'all' || key === 'dispatched') pushJourneys('Dispatched', dispatched);
    downloadCsv(`report-lifecycle-${key}-${stamp}.csv`, header, rows);
  }

  function openTrf(trfId?: string | null) {
    if (trfId) navigate(`/dashboard/lab-reports/${encodeURIComponent(trfId)}`);
  }

  function authorizeVerified(row: ReportLifecycleVerified) {
    if (!row.journey_id) return;
    setAuthorizeTarget({
      journey_id: row.journey_id,
      patient_name: row.patient_name,
      status: 'Report Review',
      customer_trf: row.trf_id,
    });
  }

  function dispatch(row: ReportLifecycleJourney) {
    void runAction(row.journey_id, 'Dispatch', async () => {
      await api.dispatchJourneyReport(row.journey_id);
    });
  }

  const preview = <T,>(key: SectionKey, rows: T[]) =>
    sectionSearch[key].trim() || expanded[key] ? rows : rows.slice(0, PREVIEW_ROWS);
  const verifiedRows = preview('verified', verified);
  const verifiedIds = verifiedRows.map((r) => r.lab_report);
  const searchEmpty = 'No rows match your search.';

  function tableSearch(key: SectionKey) {
    return (
      <label className="rl2-search">
        <RIcon size={16}>{ICON_SEARCH}</RIcon>
        <input
          value={sectionSearch[key]}
          onChange={(e) => setSectionQuery(key, e.target.value)}
          placeholder="Search this table…"
          aria-label="Search this table"
        />
      </label>
    );
  }

  const journeyMenu = (prefix: string, row: ReportLifecycleJourney, withAuthorize: boolean) => (
    <RowMenu {...menuProps(`${prefix}-${row.journey_id}`)}>
      {row.customer_trf ? (
        <button type="button" onClick={() => openTrf(row.customer_trf)}>
          Open report
        </button>
      ) : null}
      {withAuthorize && canAuthorize ? (
        <button type="button" onClick={() => setAuthorizeTarget(row)}>
          Authorize…
        </button>
      ) : null}
      <button type="button" onClick={() => void navigator.clipboard?.writeText(row.journey_id)}>
        Copy journey ID
      </button>
    </RowMenu>
  );

  return (
    <div className="lt-page rl2-page">
      <section className="rl2-hero">
        <div className="rl2-hero-main">
          <span className="rl2-hero-icon">
            <RIcon size={30}>{ICON_DOC}</RIcon>
          </span>
          <div>
            <h2>Report Lifecycle</h2>
            <p>Track sample reports from verification to dispatch. Monitor status and take quick action.</p>
            <div className="rl2-hero-chips">
              <button type="button" onClick={() => scrollTo('review')}>
                <RIcon size={15}>{ICON_DOC}</RIcon> Report review
              </button>
              <button type="button" onClick={() => scrollTo('verified')}>
                <RIcon size={15}>{ICON_CHECK}</RIcon> Verified (pending sign-off)
              </button>
              <button type="button" onClick={() => scrollTo('authorized')}>
                <RIcon size={15}>{ICON_LOCK}</RIcon> Authorized
              </button>
              <Link to="/dashboard/lab-reports" className="is-accent">
                <RIcon size={15}>{ICON_DOC}</RIcon> Result entry
              </Link>
            </div>
          </div>
        </div>
        <div className="rl2-quick">
          <b>Quick Actions</b>
          <div className="rl2-quick-row">
            <button type="button" className="rl2-quick-btn" disabled={refreshing} onClick={() => void refresh()}>
              <RIcon size={16}>{ICON_REFRESH}</RIcon> {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <div className="rl2-export">
              <button
                type="button"
                className="rl2-quick-btn is-solid"
                onClick={(e) => {
                  e.stopPropagation();
                  setExportOpen((v) => !v);
                }}
              >
                <RIcon size={16}>{ICON_DOWNLOAD}</RIcon> Export ▾
              </button>
              {exportOpen ? (
                <div className="lt-row-menu-pop rl2-export-pop">
                  <button type="button" onClick={() => exportSection('all')}>
                    All sections (CSV)
                  </button>
                  <button type="button" onClick={() => exportSection('verified')}>
                    Verified reports
                  </button>
                  <button type="button" onClick={() => exportSection('review')}>
                    Report review
                  </button>
                  <button type="button" onClick={() => exportSection('authorized')}>
                    Authorized
                  </button>
                  <button type="button" onClick={() => exportSection('dispatched')}>
                    Recently dispatched
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="lt-stats">
        <button type="button" className="lt-stat tone-green" onClick={() => scrollTo('verified')}>
          <span className="lt-stat-icon">
            <RIcon size={26}>{ICON_DOC}</RIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.verified_reports ?? 0}</strong>
            <b>Verified Reports</b>
            <small>Pending pathologist sign-off</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className="lt-stat tone-blue" onClick={() => scrollTo('review')}>
          <span className="lt-stat-icon">
            <RIcon size={26}>{ICON_EYE}</RIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.pending_review ?? 0}</strong>
            <b>Under Review</b>
            <small>Care journey reports</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className="lt-stat tone-amber" onClick={() => scrollTo('authorized')}>
          <span className="lt-stat-icon">
            <RIcon size={26}>{ICON_SEND}</RIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.authorized ?? 0}</strong>
            <b>Authorized</b>
            <small>Ready to dispatch</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
        <button type="button" className="lt-stat tone-purple" onClick={() => scrollTo('dispatched')}>
          <span className="lt-stat-icon">
            <RIcon size={26}>{ICON_TRUCK}</RIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{counts?.dispatched_7d ?? counts?.dispatched_recent ?? 0}</strong>
            <b>Recently Dispatched</b>
            <small>{counts?.dispatched_7d != null ? 'Last 7 days' : 'Most recent'}</small>
          </span>
          <span className="lt-stat-go" aria-hidden>
            ›
          </span>
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <section
        className="lt-table-card rl2-sec"
        ref={(el) => {
          sectionRefs.current.verified = el;
        }}
      >
        <SectionHead
          icon={ICON_CHECK}
          tone="tone-green"
          title="Verified reports — pathologist sign-off"
          count={verified.length}
          canExpand={verified.length > PREVIEW_ROWS}
          expanded={expanded.verified}
          onToggle={() => toggleExpanded('verified')}
          extra={tableSearch('verified')}
        />
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <HeadCheck
                  ids={verifiedIds}
                  selected={selected.verified}
                  onToggleAll={() => toggleAll('verified', verifiedIds)}
                />
                <th>Report No</th>
                <th>Patient</th>
                <th>TRF</th>
                <th>Tests</th>
                <th>Status</th>
                <th>Received On</th>
                <th>Action</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {verifiedRows.length ? (
                verifiedRows.map((row) => (
                  <tr key={row.lab_report}>
                    <RowCheck
                      id={row.lab_report}
                      checked={selected.verified.includes(row.lab_report)}
                      onToggle={() => toggleOne('verified', row.lab_report)}
                    />
                    <td className="lt-trf">{row.lab_report}</td>
                    <td>{row.patient_name || '—'}</td>
                    <td>{row.trf_id}</td>
                    <td className="lt-tests">{row.tests || '—'}</td>
                    <td>
                      <span className="lt-badge tone-green">{row.report_status}</span>
                    </td>
                    <td>{formatWhen(row.modified)}</td>
                    <td>
                      <div className="rl2-actions">
                        <button type="button" className="lt-action is-ghost" onClick={() => openTrf(row.trf_id)}>
                          Review
                        </button>
                        {canAuthorize && row.journey_id ? (
                          <button
                            type="button"
                            className="lt-action"
                            disabled={busy === row.journey_id}
                            onClick={() => authorizeVerified(row)}
                          >
                            {busy === row.journey_id ? 'Working…' : 'Authorize'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <RowMenu {...menuProps(`v-${row.lab_report}`)}>
                        <button type="button" onClick={() => openTrf(row.trf_id)}>
                          Open result entry
                        </button>
                        {canAuthorize && row.journey_id ? (
                          <button type="button" onClick={() => authorizeVerified(row)}>
                            Authorize…
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(row.trf_id)}>
                          Copy TRF ID
                        </button>
                      </RowMenu>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="lt-empty">
                    {sectionQuery('verified') ? searchEmpty : 'No verified reports awaiting sign-off.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="lt-table-card rl2-sec"
        ref={(el) => {
          sectionRefs.current.review = el;
        }}
      >
        <SectionHead
          icon={ICON_EYE}
          tone="tone-blue"
          title="Care journeys — report review"
          count={review.length}
          canExpand={review.length > PREVIEW_ROWS}
          expanded={expanded.review}
          onToggle={() => toggleExpanded('review')}
          extra={tableSearch('review')}
        />
        <JourneyTable
          rows={preview('review', review)}
          selected={selected.review}
          onToggleOne={(id) => toggleOne('review', id)}
          onToggleAll={(ids) => toggleAll('review', ids)}
          badgeTone="tone-blue"
          dateLabel="Updated On"
          emptyText={sectionQuery('review') ? searchEmpty : 'Nothing in report review.'}
          renderActions={(row) => (
            <div className="rl2-actions">
              {row.customer_trf ? (
                <button type="button" className="lt-action is-ghost" onClick={() => openTrf(row.customer_trf)}>
                  Open report
                </button>
              ) : null}
              {canAuthorize ? (
                <button
                  type="button"
                  className="lt-action"
                  disabled={busy === row.journey_id}
                  onClick={() => setAuthorizeTarget(row)}
                >
                  Authorize
                </button>
              ) : null}
            </div>
          )}
          renderMenu={(row) => journeyMenu('r', row, true)}
        />
      </section>

      <section
        className="lt-table-card rl2-sec"
        ref={(el) => {
          sectionRefs.current.authorized = el;
        }}
      >
        <SectionHead
          icon={ICON_LOCK}
          tone="tone-violet"
          title="Authorized — dispatch to patient"
          count={authorized.length}
          canExpand={authorized.length > PREVIEW_ROWS}
          expanded={expanded.authorized}
          onToggle={() => toggleExpanded('authorized')}
          extra={tableSearch('authorized')}
        />
        <JourneyTable
          rows={preview('authorized', authorized)}
          selected={selected.authorized}
          onToggleOne={(id) => toggleOne('authorized', id)}
          onToggleAll={(ids) => toggleAll('authorized', ids)}
          badgeTone="tone-violet"
          dateLabel="Updated On"
          emptyText={sectionQuery('authorized') ? searchEmpty : 'No authorized reports waiting for dispatch.'}
          renderActions={(row) => (
            <div className="rl2-actions">
              <ReportDispatchActions journeyId={row.journey_id} trfId={row.customer_trf} compact />
              <button
                type="button"
                className="lt-action is-ghost"
                disabled={busy === row.journey_id}
                onClick={() => dispatch(row)}
              >
                {busy === row.journey_id ? 'Dispatching…' : 'Dispatch'}
              </button>
            </div>
          )}
          renderMenu={(row) => journeyMenu('a', row, false)}
        />
      </section>

      <section
        className="lt-table-card rl2-sec"
        ref={(el) => {
          sectionRefs.current.dispatched = el;
        }}
      >
        <SectionHead
          icon={ICON_TRUCK}
          tone="tone-magenta"
          title="Recently dispatched"
          count={dispatched.length}
          canExpand={dispatched.length > PREVIEW_ROWS}
          expanded={expanded.dispatched}
          onToggle={() => toggleExpanded('dispatched')}
          extra={tableSearch('dispatched')}
        />
        <JourneyTable
          rows={preview('dispatched', dispatched)}
          selected={selected.dispatched}
          onToggleOne={(id) => toggleOne('dispatched', id)}
          onToggleAll={(ids) => toggleAll('dispatched', ids)}
          badgeTone="tone-green"
          dateLabel="Dispatched On"
          emptyText={sectionQuery('dispatched') ? searchEmpty : 'No reports dispatched recently.'}
          renderActions={(row) => (
            <div className="rl2-actions">
              <ReportDispatchActions journeyId={row.journey_id} trfId={row.customer_trf} compact />
            </div>
          )}
          renderMenu={(row) => journeyMenu('d', row, false)}
        />
      </section>

      <AuthorizeReportDialog
        open={!!authorizeTarget}
        subtitle={
          authorizeTarget
            ? `${authorizeTarget.patient_name || authorizeTarget.journey_id} · TRF ${authorizeTarget.customer_trf || '—'}`
            : undefined
        }
        busy={busy === authorizeTarget?.journey_id}
        onCancel={() => setAuthorizeTarget(null)}
        onConfirm={(notes) => void confirmAuthorize(notes)}
      />
    </div>
  );
}
