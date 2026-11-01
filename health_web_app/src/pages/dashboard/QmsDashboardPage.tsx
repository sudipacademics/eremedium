import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, QmsDashboard } from '../../api';
import './lab-tech-v2.css';
import './qms-v2.css';

const PREVIEW_ROWS = 6;

type SectionKey = 'qi' | 'capa' | 'form' | 'complaints' | 'audits' | 'risks' | 'lis';
type Capa = QmsDashboard['capas'][number];
type Complaint = QmsDashboard['complaints'][number];
type StatusFilter = 'open' | 'all' | 'closed';

const CAPA_CLOSED = ['Closed', 'Cancelled'];
const COMPLAINT_CLOSED = ['Closed', 'Rejected'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];

function QIcon({ children, size = 22 }: { children: ReactNode; size?: number }) {
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

const ICON_SHIELD = (
  <>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>
);
const ICON_WRENCH = (
  <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
);
const ICON_CHAT = (
  <>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
    <path d="M9 10h6M9 14h4" />
  </>
);
const ICON_GAUGE = (
  <>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="m12 14 4-5" />
    <circle cx="12" cy="14" r="1.2" />
  </>
);
const ICON_CLIPBOARD = (
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
  </>
);
const ICON_ALERT = (
  <>
    <path d="M12 3 2 20h20z" />
    <path d="M12 10v4M12 17h.01" />
  </>
);
const ICON_MONITOR = (
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4m-3-9 2 2 4-4" />
  </>
);
const ICON_PLUS = <path d="M12 5v14M5 12h14" />;
const ICON_FLASK = (
  <>
    <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" />
    <path d="M7 15h10" />
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

function formatDate(raw?: string): string {
  if (!raw) return '—';
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function capaStatusTone(status?: string): string {
  switch (status) {
    case 'Open':
      return 'tone-red';
    case 'Investigation':
    case 'Action':
      return 'tone-amber';
    case 'Effectiveness Check':
      return 'tone-blue';
    case 'Closed':
      return 'tone-green';
    default:
      return 'tone-muted';
  }
}

function complaintStatusTone(status?: string): string {
  switch (status) {
    case 'Open':
      return 'tone-red';
    case 'Acknowledged':
    case 'Under Investigation':
      return 'tone-amber';
    case 'CAPA Linked':
    case 'Replied':
      return 'tone-blue';
    case 'Closed':
      return 'tone-green';
    default:
      return 'tone-muted';
  }
}

function severityTone(level?: string): string {
  switch (level) {
    case 'Critical':
    case 'Urgent':
      return 'tone-red';
    case 'High':
      return 'tone-amber';
    case 'Medium':
    case 'Normal':
      return 'tone-blue';
    default:
      return 'tone-muted';
  }
}

function auditStatusTone(status?: string): string {
  switch (status) {
    case 'Planned':
      return 'tone-blue';
    case 'In Progress':
      return 'tone-amber';
    case 'Completed':
    case 'Closed':
      return 'tone-green';
    default:
      return 'tone-muted';
  }
}

function riskStatusTone(status?: string): string {
  switch (status) {
    case 'Open':
      return 'tone-red';
    case 'Mitigating':
      return 'tone-amber';
    case 'Accepted':
      return 'tone-blue';
    case 'Closed':
      return 'tone-green';
    default:
      return 'tone-muted';
  }
}

function riskScoreTone(score?: number): string {
  if (score == null) return 'tone-muted';
  if (score >= 15) return 'tone-red';
  if (score >= 8) return 'tone-amber';
  return 'tone-green';
}

function lisStatusTone(status?: string): string {
  switch (status) {
    case 'Pass':
      return 'tone-green';
    case 'Fail':
      return 'tone-red';
    case 'Partial':
      return 'tone-amber';
    default:
      return 'tone-muted';
  }
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
  count?: number;
  canExpand?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="qm2-sec-head">
      <div className="qm2-sec-title">
        <span className={`qm2-sec-icon ${tone}`}>
          <QIcon size={18}>{icon}</QIcon>
        </span>
        <h3>{title}</h3>
        {count != null ? <span className={`qm2-count ${tone}`}>{count}</span> : null}
      </div>
      <div className="qm2-sec-tools">
        {extra}
        {canExpand && onToggle ? (
          <button type="button" className="qm2-viewall" onClick={onToggle}>
            {expanded ? 'Show less' : 'View all'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="qm2-search">
      <QIcon size={16}>{ICON_SEARCH}</QIcon>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function FilterTabs({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  const opts: Array<[StatusFilter, string]> = [
    ['open', 'Open'],
    ['closed', 'Closed'],
    ['all', 'All'],
  ];
  return (
    <div className="qm2-tabs" role="tablist">
      {opts.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={value === key ? 'is-active' : ''}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RowMenu({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
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

function StatCard({
  tone,
  icon,
  value,
  label,
  hint,
  onClick,
}: {
  tone: string;
  icon: ReactNode;
  value: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`lt-stat ${tone}`} onClick={onClick}>
      <span className="lt-stat-icon">
        <QIcon size={26}>{icon}</QIcon>
      </span>
      <span className="lt-stat-copy">
        <strong>{value}</strong>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <span className="lt-stat-go" aria-hidden>
        ›
      </span>
    </button>
  );
}

export function QmsDashboardPage() {
  const [data, setData] = useState<QmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capaTitle, setCapaTitle] = useState('');
  const [capaDesc, setCapaDesc] = useState('');
  const [linkComplaint, setLinkComplaint] = useState('');
  const [capaSeverity, setCapaSeverity] = useState('Medium');
  const [capaDue, setCapaDue] = useState('');
  const [capaQ, setCapaQ] = useState('');
  const [capaFilter, setCapaFilter] = useState<StatusFilter>('all');
  const [cmpQ, setCmpQ] = useState('');
  const [cmpFilter, setCmpFilter] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<Partial<Record<SectionKey, boolean>>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLElement | null>>>({});
  const titleRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await api.getQmsDashboard();
    setData(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load QMS'));
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

  async function onCreateCapa(e: FormEvent) {
    e.preventDefault();
    setBusy('capa');
    setError(null);
    try {
      const res = await api.createCapa({
        title: capaTitle,
        nonconformity_description: capaDesc,
        source: linkComplaint ? 'Complaint' : 'Internal',
        severity: capaSeverity,
        due_date: capaDue || undefined,
        linked_complaint: linkComplaint || undefined,
      });
      setNotice(`CAPA created: ${res.data.capa}`);
      setCapaTitle('');
      setCapaDesc('');
      setLinkComplaint('');
      setCapaSeverity('Medium');
      setCapaDue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CAPA create failed');
    } finally {
      setBusy(null);
    }
  }

  async function closeComplaint(name: string) {
    setBusy(name);
    try {
      await api.updateComplaintStatus({
        complaint: name,
        status: 'Closed',
        reply_summary: 'Closed from QMS hub',
      });
      setNotice(`Complaint ${name} closed`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function markInvestigating(name: string) {
    setBusy(name);
    setError(null);
    try {
      await api.updateComplaintStatus({ complaint: name, status: 'Under Investigation' });
      setNotice(`Complaint ${name} marked under investigation`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await load();
      setNotice('QMS data refreshed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  const today = todayIso();

  const latestQi = useMemo(() => {
    const map = new Map<string, QmsDashboard['qi_values'][number]>();
    (data?.quality_indicators || []).forEach((q) => {
      const val = (data?.qi_values || []).find(
        (v) => v.indicator === q.name || v.indicator === q.indicator_code || String(v.indicator).endsWith(q.indicator_code),
      );
      if (val) map.set(q.name, val);
    });
    return map;
  }, [data]);

  const capaQuery = capaQ.trim().toLowerCase();
  const capas = useMemo(
    () =>
      (data?.capas || []).filter((c) => {
        const closed = CAPA_CLOSED.includes(c.status);
        if (capaFilter === 'open' && closed) return false;
        if (capaFilter === 'closed' && !closed) return false;
        return matches(capaQuery, c.name, c.title, c.source, c.severity, c.status, c.linked_complaint);
      }),
    [data, capaFilter, capaQuery],
  );

  const cmpQuery = cmpQ.trim().toLowerCase();
  const complaints = useMemo(
    () =>
      (data?.complaints || []).filter((c) => {
        const closed = COMPLAINT_CLOSED.includes(c.status);
        if (cmpFilter === 'open' && closed) return false;
        if (cmpFilter === 'closed' && !closed) return false;
        return matches(cmpQuery, c.ack_id, c.name, c.subject, c.source, c.status, c.contact_name, c.linked_capa);
      }),
    [data, cmpFilter, cmpQuery],
  );

  if (!data && !error) return <p>Loading quality management…</p>;

  const counts = data?.counts;
  const indicators = data?.quality_indicators || [];
  const audits = data?.audits || [];
  const risks = data?.risks || [];
  const lis = data?.lis_checklists || [];
  const qiWithValues = indicators.filter((q) => latestQi.has(q.name));
  const qiOnTarget = qiWithValues.filter((q) => latestQi.get(q.name)?.meets_target).length;
  const auditNcs = audits.reduce((sum, a) => sum + (Number(a.nonconformities_count) || 0), 0);
  const topRisk = risks.reduce<number | null>(
    (max, r) => (r.risk_score != null && (max == null || r.risk_score > max) ? r.risk_score : max),
    null,
  );
  const overdueCapa = (data?.capas || []).filter(
    (c) => !CAPA_CLOSED.includes(c.status) && c.due_date && c.due_date < today,
  ).length;

  function scrollTo(key: SectionKey) {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setRef(key: SectionKey) {
    return (el: HTMLElement | null) => {
      sectionRefs.current[key] = el;
    };
  }

  function toggleExpanded(key: SectionKey) {
    setExpanded((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  function preview<T>(key: SectionKey, rows: T[]): T[] {
    return expanded[key] ? rows : rows.slice(0, PREVIEW_ROWS);
  }

  function menuProps(id: string) {
    return { open: menuFor === id, onToggle: () => setMenuFor(menuFor === id ? null : id) };
  }

  function raiseCapaFor(c: Complaint) {
    setLinkComplaint(c.name);
    if (!capaTitle) setCapaTitle(`Complaint ${c.ack_id || c.name}: ${c.subject}`);
    scrollTo('form');
    window.setTimeout(() => titleRef.current?.focus(), 350);
  }

  function copy(text?: string) {
    if (text) void navigator.clipboard?.writeText(text);
  }

  function exportCsv(key: 'all' | 'capa' | 'complaints' | 'audits' | 'risks' | 'qi') {
    const stamp = today;
    if (key === 'capa' || key === 'all') {
      downloadCsv(
        `qms-capa-${stamp}.csv`,
        ['ID', 'Title', 'Source', 'Severity', 'Status', 'Opened', 'Due', 'Linked complaint'],
        (data?.capas || []).map((c) => [c.name, c.title, c.source, c.severity, c.status, c.opened_on, c.due_date, c.linked_complaint]),
      );
    }
    if (key === 'complaints' || key === 'all') {
      downloadCsv(
        `qms-complaints-${stamp}.csv`,
        ['Ack ID', 'Complaint', 'Subject', 'Contact', 'Source', 'Priority', 'Status', 'Date', 'Linked CAPA'],
        (data?.complaints || []).map((c) => [
          c.ack_id,
          c.name,
          c.subject,
          c.contact_name,
          c.source,
          c.priority,
          c.status,
          c.complaint_date,
          c.linked_capa,
        ]),
      );
    }
    if (key === 'audits' || key === 'all') {
      downloadCsv(
        `qms-audits-${stamp}.csv`,
        ['Title', 'Type', 'Date', 'Area', 'Status', 'NCs'],
        audits.map((a) => [a.audit_title, a.audit_type, a.audit_date, a.area, a.status, a.nonconformities_count]),
      );
    }
    if (key === 'risks' || key === 'all') {
      downloadCsv(
        `qms-risks-${stamp}.csv`,
        ['Risk', 'Process area', 'Likelihood', 'Impact', 'Score', 'Status'],
        risks.map((r) => [r.risk_title, r.process_area, r.likelihood, r.impact, r.risk_score, r.status]),
      );
    }
    if (key === 'qi' || key === 'all') {
      downloadCsv(
        `qms-quality-indicators-${stamp}.csv`,
        ['Code', 'Indicator', 'Unit', 'Target', 'Direction', 'Latest value', 'Meets target', 'Period end'],
        indicators.map((q) => {
          const v = latestQi.get(q.name);
          return [
            q.indicator_code,
            q.indicator_name,
            q.unit,
            q.target_value,
            q.direction,
            v?.value,
            v ? (v.meets_target ? 'Yes' : 'No') : '',
            v?.period_end,
          ];
        }),
      );
    }
  }

  const capaRows = preview('capa', capas);
  const cmpRows = preview('complaints', complaints);
  const auditRows = preview('audits', audits);
  const riskRows = preview('risks', risks);

  return (
    <div className="lt-page qm2-page">
      <section className="qm2-hero">
        <div className="qm2-hero-main">
          <span className="qm2-hero-icon">
            <QIcon size={30}>{ICON_SHIELD}</QIcon>
          </span>
          <div>
            <h2>Quality management</h2>
            <p>
              NABL 112A quality system — CAPA board, complaint handling, quality indicators, internal audits, risk register
              and LIS verification in one place.
            </p>
            <div className="qm2-hero-chips">
              <button type="button" onClick={() => scrollTo('form')}>
                <QIcon size={15}>{ICON_PLUS}</QIcon> New CAPA
              </button>
              <button type="button" onClick={() => scrollTo('complaints')}>
                <QIcon size={15}>{ICON_CHAT}</QIcon> Complaint queue
              </button>
              <Link to="/dashboard/qc">
                <QIcon size={15}>{ICON_FLASK}</QIcon> IQC / NABL QC
              </Link>
              <Link to="/dashboard/critical-alerts">
                <QIcon size={15}>{ICON_ALERT}</QIcon> Critical alerts
              </Link>
              <Link to="/complaint" className="is-accent">
                <QIcon size={15}>{ICON_CHAT}</QIcon> Public complaint form
              </Link>
            </div>
          </div>
        </div>
        <div className="qm2-quick">
          <b>Quick Actions</b>
          <div className="qm2-quick-row">
            <button type="button" className="qm2-quick-btn" disabled={refreshing} onClick={() => void refresh()}>
              <QIcon size={16}>{ICON_REFRESH}</QIcon> {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <div className="qm2-export">
              <button
                type="button"
                className="qm2-quick-btn is-solid"
                onClick={(e) => {
                  e.stopPropagation();
                  setExportOpen((v) => !v);
                }}
              >
                <QIcon size={16}>{ICON_DOWNLOAD}</QIcon> Export ▾
              </button>
              {exportOpen ? (
                <div className="lt-row-menu-pop qm2-export-pop">
                  <button type="button" onClick={() => exportCsv('all')}>
                    All sections (CSV files)
                  </button>
                  <button type="button" onClick={() => exportCsv('capa')}>
                    CAPA board
                  </button>
                  <button type="button" onClick={() => exportCsv('complaints')}>
                    Complaints
                  </button>
                  <button type="button" onClick={() => exportCsv('qi')}>
                    Quality indicators
                  </button>
                  <button type="button" onClick={() => exportCsv('audits')}>
                    Internal audits
                  </button>
                  <button type="button" onClick={() => exportCsv('risks')}>
                    Risk register
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="lt-stats qm2-stats">
        <StatCard
          tone="tone-red"
          icon={ICON_WRENCH}
          value={counts?.capa_open ?? 0}
          label="Open CAPA"
          hint={overdueCapa ? `${overdueCapa} overdue · ${counts?.capa ?? 0} total` : `${counts?.capa ?? 0} total`}
          onClick={() => {
            setCapaFilter('open');
            scrollTo('capa');
          }}
        />
        <StatCard
          tone="tone-amber"
          icon={ICON_CHAT}
          value={counts?.complaints_open ?? 0}
          label="Open complaints"
          hint={`${counts?.complaints ?? 0} total received`}
          onClick={() => {
            setCmpFilter('open');
            scrollTo('complaints');
          }}
        />
        <StatCard
          tone="tone-green"
          icon={ICON_GAUGE}
          value={qiWithValues.length ? `${qiOnTarget}/${qiWithValues.length}` : '—'}
          label="Indicators on target"
          hint={`${indicators.length} active indicators`}
          onClick={() => scrollTo('qi')}
        />
        <StatCard
          tone="tone-blue"
          icon={ICON_CLIPBOARD}
          value={counts?.audits ?? 0}
          label="Internal audits"
          hint={`${auditNcs} nonconformities recorded`}
          onClick={() => scrollTo('audits')}
        />
        <StatCard
          tone="tone-purple"
          icon={ICON_ALERT}
          value={counts?.risks ?? 0}
          label="Risk register"
          hint={topRisk != null ? `Highest score ${topRisk}` : 'No scored risks'}
          onClick={() => scrollTo('risks')}
        />
      </div>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <section className="lt-table-card qm2-sec" ref={setRef('qi')}>
        <SectionHead icon={ICON_GAUGE} tone="tone-green" title="Quality indicators" count={indicators.length} />
        {indicators.length ? (
          <div className="qm2-qi-grid">
            {indicators.map((q) => {
              const v = latestQi.get(q.name);
              const unit = q.unit && q.unit !== 'count' ? q.unit : '';
              return (
                <div className="qm2-qi" key={q.name}>
                  <div className="qm2-qi-top">
                    <span className="qm2-qi-code">{q.indicator_code}</span>
                    <span className={`lt-badge ${v ? (v.meets_target ? 'tone-green' : 'tone-red') : 'tone-muted'}`}>
                      {v ? (v.meets_target ? 'On target' : 'Off target') : 'No value'}
                    </span>
                  </div>
                  <b className="qm2-qi-name">{q.indicator_name}</b>
                  <strong className="qm2-qi-value">
                    {v?.value != null ? v.value : '—'}
                    {v?.value != null && unit ? <small>{unit}</small> : null}
                  </strong>
                  <span className="qm2-qi-meta">
                    Target {q.target_value ?? '—'}
                    {unit && q.target_value != null ? unit : ''}
                    {q.direction ? ` · ${q.direction}` : ''}
                  </span>
                  {v ? (
                    <span className="qm2-qi-meta">
                      {v.numerator != null && v.denominator ? `${v.numerator}/${v.denominator} · ` : ''}
                      {v.period_end ? `Period to ${formatDate(v.period_end)}` : ''}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="lt-empty">No active quality indicators configured.</p>
        )}
        {data?.retention ? (
          <div className="qm2-retention">
            <span>Record retention (years)</span>
            <span className="lt-badge tone-muted">Reports {data.retention.reports}</span>
            <span className="lt-badge tone-muted">Raw data {data.retention.raw_data}</span>
            <span className="lt-badge tone-muted">QC {data.retention.qc}</span>
            <span className="lt-badge tone-muted">Complaints {data.retention.complaints}</span>
          </div>
        ) : null}
      </section>

      <form className="lt-table-card qm2-sec qm2-form" ref={setRef('form')} onSubmit={onCreateCapa}>
        <SectionHead icon={ICON_PLUS} tone="tone-teal" title="Raise new CAPA" />
        <div className="qm2-form-grid">
          <label className="qm2-field qm2-span-2">
            <span>Title *</span>
            <input
              ref={titleRef}
              value={capaTitle}
              onChange={(e) => setCapaTitle(e.target.value)}
              placeholder="Short summary of the nonconformity"
              required
            />
          </label>
          <label className="qm2-field">
            <span>Severity</span>
            <select value={capaSeverity} onChange={(e) => setCapaSeverity(e.target.value)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="qm2-field">
            <span>Due date</span>
            <input type="date" value={capaDue} min={today} onChange={(e) => setCapaDue(e.target.value)} />
          </label>
          <label className="qm2-field qm2-span-4">
            <span>Nonconformity description *</span>
            <textarea
              value={capaDesc}
              onChange={(e) => setCapaDesc(e.target.value)}
              required
              rows={3}
              placeholder="What happened, where, and the impact on results or patients"
            />
          </label>
          <label className="qm2-field qm2-span-2">
            <span>Link complaint (optional)</span>
            <select value={linkComplaint} onChange={(e) => setLinkComplaint(e.target.value)}>
              <option value="">—</option>
              {(data?.complaints || []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.ack_id || c.name} — {c.subject}
                </option>
              ))}
            </select>
          </label>
          <div className="qm2-form-foot qm2-span-2">
            <small>Source: {linkComplaint ? 'Complaint' : 'Internal'}</small>
            <button className="qm2-primary" type="submit" disabled={busy === 'capa'}>
              {busy === 'capa' ? 'Saving…' : 'Create CAPA'}
            </button>
          </div>
        </div>
      </form>

      <section className="lt-table-card qm2-sec" ref={setRef('capa')}>
        <SectionHead
          icon={ICON_WRENCH}
          tone="tone-red"
          title="CAPA board"
          count={capas.length}
          canExpand={capas.length > PREVIEW_ROWS}
          expanded={!!expanded.capa}
          onToggle={() => toggleExpanded('capa')}
          extra={
            <>
              <FilterTabs value={capaFilter} onChange={setCapaFilter} />
              <SearchBox value={capaQ} onChange={setCapaQ} placeholder="Search CAPA ID, title, source…" />
            </>
          }
        />
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Source</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Due</th>
                <th>Complaint</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {capaRows.length ? (
                capaRows.map((c: Capa) => {
                  const overdue = !CAPA_CLOSED.includes(c.status) && !!c.due_date && c.due_date < today;
                  return (
                    <tr key={c.name}>
                      <td className="lt-trf">{c.name}</td>
                      <td className="qm2-strong">{c.title}</td>
                      <td>{c.source || '—'}</td>
                      <td>
                        {c.severity ? <span className={`lt-badge ${severityTone(c.severity)}`}>{c.severity}</span> : '—'}
                      </td>
                      <td>
                        <span className={`lt-badge ${capaStatusTone(c.status)}`}>{c.status}</span>
                      </td>
                      <td>{formatDate(c.opened_on)}</td>
                      <td>
                        {c.due_date ? (
                          <span className={overdue ? 'qm2-overdue' : ''}>
                            {formatDate(c.due_date)}
                            {overdue ? ' · overdue' : ''}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{c.linked_complaint || '—'}</td>
                      <td>
                        <RowMenu {...menuProps(`capa-${c.name}`)}>
                          <button type="button" onClick={() => copy(c.name)}>
                            Copy CAPA ID
                          </button>
                          {c.linked_complaint ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCmpFilter('all');
                                setCmpQ(c.linked_complaint || '');
                                scrollTo('complaints');
                              }}
                            >
                              Show linked complaint
                            </button>
                          ) : null}
                        </RowMenu>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="lt-empty">
                    {capaQuery || capaFilter !== 'all' ? 'No CAPA records match the current filter.' : 'No CAPA records.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lt-table-card qm2-sec" ref={setRef('complaints')}>
        <SectionHead
          icon={ICON_CHAT}
          tone="tone-amber"
          title="Complaint queue"
          count={complaints.length}
          canExpand={complaints.length > PREVIEW_ROWS}
          expanded={!!expanded.complaints}
          onToggle={() => toggleExpanded('complaints')}
          extra={
            <>
              <FilterTabs value={cmpFilter} onChange={setCmpFilter} />
              <SearchBox value={cmpQ} onChange={setCmpQ} placeholder="Search ack ID, subject, contact…" />
            </>
          }
        />
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Ack</th>
                <th>Subject</th>
                <th>Contact</th>
                <th>Source</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Date</th>
                <th>CAPA</th>
                <th>Action</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cmpRows.length ? (
                cmpRows.map((c: Complaint) => {
                  const open = !COMPLAINT_CLOSED.includes(c.status);
                  return (
                    <tr key={c.name}>
                      <td className="lt-trf">{c.ack_id || c.name}</td>
                      <td className="qm2-strong">{c.subject}</td>
                      <td>{c.contact_name || '—'}</td>
                      <td>{c.source || '—'}</td>
                      <td>
                        {c.priority ? <span className={`lt-badge ${severityTone(c.priority)}`}>{c.priority}</span> : '—'}
                      </td>
                      <td>
                        <span className={`lt-badge ${complaintStatusTone(c.status)}`}>{c.status}</span>
                      </td>
                      <td>{formatDate(c.complaint_date)}</td>
                      <td>{c.linked_capa || '—'}</td>
                      <td>
                        {open ? (
                          <button
                            className="lt-action is-ghost qm2-action-sm"
                            type="button"
                            disabled={busy === c.name}
                            onClick={() => void closeComplaint(c.name)}
                          >
                            {busy === c.name ? 'Working…' : 'Close'}
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <RowMenu {...menuProps(`cmp-${c.name}`)}>
                          {open && c.status !== 'Under Investigation' ? (
                            <button type="button" disabled={busy === c.name} onClick={() => void markInvestigating(c.name)}>
                              Mark under investigation
                            </button>
                          ) : null}
                          {open && !c.linked_capa ? (
                            <button type="button" onClick={() => raiseCapaFor(c)}>
                              Raise CAPA…
                            </button>
                          ) : null}
                          {c.linked_capa ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCapaFilter('all');
                                setCapaQ(c.linked_capa || '');
                                scrollTo('capa');
                              }}
                            >
                              Show linked CAPA
                            </button>
                          ) : null}
                          {open ? (
                            <button type="button" disabled={busy === c.name} onClick={() => void closeComplaint(c.name)}>
                              Close complaint
                            </button>
                          ) : null}
                          <button type="button" onClick={() => copy(c.ack_id || c.name)}>
                            Copy ack ID
                          </button>
                        </RowMenu>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="lt-empty">
                    {cmpQuery || cmpFilter !== 'all' ? 'No complaints match the current filter.' : 'No complaints received.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="qm2-two-col">
        <section className="lt-table-card qm2-sec" ref={setRef('audits')}>
          <SectionHead
            icon={ICON_CLIPBOARD}
            tone="tone-blue"
            title="Internal audits"
            count={audits.length}
            canExpand={audits.length > PREVIEW_ROWS}
            expanded={!!expanded.audits}
            onToggle={() => toggleExpanded('audits')}
          />
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Audit</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Area</th>
                  <th>NCs</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.length ? (
                  auditRows.map((a) => (
                    <tr key={a.name}>
                      <td className="qm2-strong">{a.audit_title}</td>
                      <td>{a.audit_type || '—'}</td>
                      <td>{formatDate(a.audit_date)}</td>
                      <td>{a.area || '—'}</td>
                      <td>
                        <span className={`lt-badge ${Number(a.nonconformities_count) > 0 ? 'tone-red' : 'tone-muted'}`}>
                          {a.nonconformities_count ?? 0}
                        </span>
                      </td>
                      <td>
                        {a.status ? <span className={`lt-badge ${auditStatusTone(a.status)}`}>{a.status}</span> : '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="lt-empty">
                      No internal audits recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lt-table-card qm2-sec" ref={setRef('risks')}>
          <SectionHead
            icon={ICON_ALERT}
            tone="tone-purple"
            title="Risk register"
            count={risks.length}
            canExpand={risks.length > PREVIEW_ROWS}
            expanded={!!expanded.risks}
            onToggle={() => toggleExpanded('risks')}
          />
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>Area</th>
                  <th>L × I</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {riskRows.length ? (
                  riskRows.map((r) => (
                    <tr key={r.name}>
                      <td className="qm2-strong">{r.risk_title}</td>
                      <td>{r.process_area || '—'}</td>
                      <td>
                        {r.likelihood ?? '—'} × {r.impact ?? '—'}
                      </td>
                      <td>
                        <span className={`lt-badge ${riskScoreTone(r.risk_score)}`}>{r.risk_score ?? '—'}</span>
                      </td>
                      <td>
                        {r.status ? <span className={`lt-badge ${riskStatusTone(r.status)}`}>{r.status}</span> : '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="lt-empty">
                      No risks in the register.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="lt-table-card qm2-sec" ref={setRef('lis')}>
        <SectionHead icon={ICON_MONITOR} tone="tone-teal" title="LIS verification" count={lis.length} />
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Checklist</th>
                <th>Verification date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lis.length ? (
                lis.map((l) => (
                  <tr key={l.name}>
                    <td className="qm2-strong">{l.checklist_title}</td>
                    <td>{formatDate(l.verification_date)}</td>
                    <td>
                      <span className={`lt-badge ${lisStatusTone(l.status)}`}>{l.status || 'Draft'}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="lt-empty">
                    No LIS checklists.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
