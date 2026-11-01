import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, QcDashboard, QcEquipment } from '../../api';
import { deskAppUrl } from '../../config';
import './lab-tech-v2.css';
import './lab-qc-v2.css';

type SectionKey = 'record' | 'equipment' | 'iqc' | 'eqa';

type LjPoint = {
  run_date: string;
  result_value: number;
  outcome?: string;
  name?: string;
  lab_mean?: number | null;
  lab_sd?: number | null;
  z_score?: number | null;
};

type LjStats = { mean?: number; sd?: number; cv_percent?: number };

type DetailRow = [string, ReactNode];

type Detail = { title: string; rows: DetailRow[]; deskHref?: string } | null;

const OTHER_ANALYTE = '__other__';
const RANGE_OPTIONS = [7, 30, 90];

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

const ICON_MICROSCOPE = (
  <>
    <path d="M6 18h8M3 22h18M14 22a7 7 0 1 0 0-14h-1" />
    <path d="M9 14h2M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2zM12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
  </>
);
const ICON_FLASK = (
  <>
    <path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3" />
    <path d="M7 15h10" />
  </>
);
const ICON_SHIELD = (
  <>
    <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </>
);
const ICON_CHART = (
  <>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </>
);
const ICON_GEAR = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
);
const ICON_DOC = (
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </>
);
const ICON_CLIPBOARD = (
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6" />
  </>
);
const ICON_MONITOR = (
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>
);
const ICON_SEARCH = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);
const ICON_PLUS = <path d="M12 5v14M5 12h14" />;

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

function shortDate(raw?: string): string {
  if (!raw) return '';
  const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function fmtNum(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Math.round(n * 1000) / 1000);
}

function daysUntil(raw?: string): number | null {
  if (!raw) return null;
  const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function equipmentTone(status?: string): string {
  const s = (status || '').toLowerCase();
  if (!s) return 'tone-muted';
  if (s.includes('out') || s.includes('retired') || s.includes('broken') || s.includes('fault')) return 'tone-red';
  if (s.includes('maint') || s.includes('calib') || s.includes('repair') || s.includes('hold')) return 'tone-amber';
  if (s.includes('service') || s.includes('active') || s.includes('operational') || s.includes('use')) return 'tone-green';
  return 'tone-blue';
}

function iqcOutcome(outcome?: string): { label: string; tone: string } {
  const o = (outcome || '').toLowerCase();
  if (o === 'accept') return { label: 'Within range', tone: 'tone-green' };
  if (o === 'warning') return { label: 'Warning (±2SD)', tone: 'tone-amber' };
  if (o === 'reject') return { label: 'Out of range', tone: 'tone-red' };
  return { label: outcome || '—', tone: 'tone-muted' };
}

function eqaTone(outcome?: string): string {
  const o = (outcome || '').toLowerCase();
  if (!o) return 'tone-muted';
  if (o.includes('unsat') || o.includes('fail') || o.includes('reject')) return 'tone-red';
  if (o.includes('pending') || o.includes('border') || o.includes('question')) return 'tone-amber';
  if (o.includes('satis') || o.includes('pass') || o.includes('accept')) return 'tone-green';
  return 'tone-blue';
}

function deskLink(doctype: string, name?: string) {
  const slug = doctype.toLowerCase().replace(/ /g, '-');
  return `${deskAppUrl()}/app/${slug}${name ? `/${encodeURIComponent(name)}` : ''}`;
}

function latestLimits(points: LjPoint[]): { mean: number; sd: number } | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i];
    if (p.lab_mean != null && p.lab_sd != null && Number(p.lab_sd) > 0) {
      return { mean: Number(p.lab_mean), sd: Number(p.lab_sd) };
    }
  }
  return null;
}

function StatCard({
  tone,
  icon,
  value,
  label,
  sub,
  onClick,
}: {
  tone: string;
  icon: ReactNode;
  value: ReactNode;
  label: string;
  sub: string;
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
        <small>{sub}</small>
      </span>
      <span className="lt-stat-go" aria-hidden>
        ›
      </span>
    </button>
  );
}

function CardHead({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="lq2-card-head">
      <div className="lq2-card-title">
        <span className="lq2-card-icon">
          <QIcon size={22}>{icon}</QIcon>
        </span>
        <div>
          <h3>{title}</h3>
          <p>{sub}</p>
        </div>
      </div>
      {children ? <div className="lq2-card-tools">{children}</div> : null}
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

function LjChart({ points, mean, sd }: { points: LjPoint[]; mean: number | null; sd: number | null }) {
  if (!points.length) return <p className="lt-empty">No IQC points in this range yet.</p>;
  const W = 560;
  const H = 230;
  const padL = 40;
  const padR = 48;
  const padT = 14;
  const padB = 30;
  const values = points.map((p) => Number(p.result_value));
  const hasSd = mean != null && sd != null && sd > 0;
  let lo = hasSd ? mean - 3.5 * sd : Math.min(...values);
  let hi = hasSd ? mean + 3.5 * sd : Math.max(...values);
  lo = Math.min(lo, ...values);
  hi = Math.max(hi, ...values);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const n = points.length;
  const x = (i: number) => (n === 1 ? (padL + W - padR) / 2 : padL + (i / (n - 1)) * (W - padL - padR));
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const labelStep = Math.max(1, Math.ceil(n / 7));
  const limitLines =
    hasSd && mean != null && sd != null
      ? [
          { v: mean + 3 * sd, label: '+3SD', cls: 'is-3sd' },
          { v: mean + 2 * sd, label: '+2SD', cls: 'is-2sd' },
          { v: mean, label: 'Mean', cls: 'is-mean' },
          { v: mean - 2 * sd, label: '-2SD', cls: 'is-2sd' },
          { v: mean - 3 * sd, label: '-3SD', cls: 'is-3sd' },
        ]
      : mean != null
        ? [{ v: mean, label: 'Mean', cls: 'is-mean' }]
        : [];
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(p.result_value)).toFixed(1)}`).join(' ');
  return (
    <svg className="lq2-lj-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Levey–Jennings chart">
      {ticks.map((t) => (
        <g key={`t-${t}`}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="lq2-lj-grid" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="lq2-lj-axis">
            {fmtNum(Math.round(t * 10) / 10)}
          </text>
        </g>
      ))}
      {limitLines.map((l) => (
        <g key={l.label}>
          <line x1={padL} x2={W - padR} y1={y(l.v)} y2={y(l.v)} className={`lq2-lj-limit ${l.cls}`} />
          <text x={W - padR + 4} y={y(l.v) + 3} className={`lq2-lj-limit-label ${l.cls}`}>
            {l.label}
          </text>
        </g>
      ))}
      <path d={path} className="lq2-lj-line" />
      {points.map((p, i) => {
        const o = (p.outcome || '').toLowerCase();
        const cls = o === 'reject' ? 'is-reject' : o === 'warning' ? 'is-warning' : '';
        return (
          <circle key={p.name || i} cx={x(i)} cy={y(Number(p.result_value))} r={4} className={`lq2-lj-dot ${cls}`}>
            <title>{`${shortDate(p.run_date)} · ${fmtNum(p.result_value)}${p.z_score != null ? ` (z=${fmtNum(p.z_score)})` : ''}${p.outcome ? ` · ${p.outcome}` : ''}`}</title>
          </circle>
        );
      })}
      {points.map((p, i) =>
        i % labelStep === 0 || i === n - 1 ? (
          <text key={`x-${p.name || i}`} x={x(i)} y={H - 10} textAnchor="middle" className="lq2-lj-axis">
            {shortDate(p.run_date)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function DetailModal({ detail, onClose }: { detail: NonNullable<Detail>; onClose: () => void }) {
  return (
    <div className="lq2-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="lq2-modal" role="dialog" aria-modal="true" aria-label={detail.title} onClick={(e) => e.stopPropagation()}>
        <div className="lq2-modal-head">
          <h3>{detail.title}</h3>
          <button type="button" className="lt-kebab" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <dl className="lq2-detail">
          {detail.rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v ?? '—'}</dd>
            </div>
          ))}
        </dl>
        <div className="lq2-modal-foot">
          {detail.deskHref ? (
            <a className="lt-action is-ghost" href={detail.deskHref} target="_blank" rel="noreferrer">
              Open in desk
            </a>
          ) : null}
          <button type="button" className="lt-action" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function QcDashboardPage() {
  const [data, setData] = useState<QcDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analyte, setAnalyte] = useState('GLU');
  const [level, setLevel] = useState('1');
  const [result, setResult] = useState('100');
  const [mean, setMean] = useState('100');
  const [sd, setSd] = useState('3');
  const [customAnalyte, setCustomAnalyte] = useState(false);
  const [editLimits, setEditLimits] = useState(false);
  const [limitsFromHistory, setLimitsFromHistory] = useState(false);
  const [rangeDays, setRangeDays] = useState(7);
  const [ljPoints, setLjPoints] = useState<LjPoint[]>([]);
  const [ljStats, setLjStats] = useState<LjStats>({});
  const [eqSearch, setEqSearch] = useState('');
  const [eqStatus, setEqStatus] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const sectionRefs = useRef<Record<SectionKey, HTMLElement | null>>({
    record: null,
    equipment: null,
    iqc: null,
    eqa: null,
  });

  async function load() {
    const res = await api.getQcDashboard();
    setData(res.data);
  }

  async function loadLj() {
    try {
      const res = await api.getIqcLjChart({ analyte_code: analyte, qc_level: level, days: rangeDays, limit: 500 });
      const pts = res.data.points || [];
      setLjPoints(pts);
      setLjStats(res.data.stats || {});
      if (!editLimits) {
        const lim = latestLimits(pts);
        if (lim) {
          setMean(String(lim.mean));
          setSd(String(lim.sd));
          setLimitsFromHistory(true);
        } else {
          setLimitsFromHistory(false);
        }
      }
    } catch {
      setLjPoints([]);
      setLjStats({});
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load QC'));
  }, []);

  useEffect(() => {
    void loadLj();
  }, [analyte, level, rangeDays, data?.iqc_today?.length]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  const bioEquip = useMemo(
    () => data?.equipment?.find((e) => e.asset_tag === 'BIO-001')?.name || data?.equipment?.[0]?.name,
    [data],
  );

  const analyteOptions = useMemo(() => {
    const map = new Map<string, string | undefined>();
    (data?.iqc_analytes || []).forEach((a) => {
      if (!map.has(a.analyte_code) || (!map.get(a.analyte_code) && a.analyte_name)) map.set(a.analyte_code, a.analyte_name);
    });
    (data?.iqc_today || []).forEach((r) => {
      if (!map.has(r.analyte_code)) map.set(r.analyte_code, r.analyte_name);
    });
    if (analyte && !map.has(analyte)) map.set(analyte, analyte === 'GLU' ? 'Glucose' : undefined);
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [data, analyte]);

  const levelOptions = useMemo(() => {
    const set = new Set(['1', '2', '3']);
    (data?.iqc_analytes || []).filter((a) => a.analyte_code === analyte).forEach((a) => set.add(String(a.qc_level)));
    return Array.from(set).sort();
  }, [data, analyte]);

  const analyteName = analyteOptions.find((a) => a.code === analyte)?.name;

  const statusOptions = useMemo(
    () => Array.from(new Set((data?.equipment || []).map((e) => e.status).filter(Boolean) as string[])).sort(),
    [data],
  );

  const overdueByName = useMemo(() => {
    const m = new Map<string, string>();
    (data?.overdue || []).forEach((o) => {
      if (o.name) m.set(o.name, m.has(o.name) ? `${m.get(o.name)}; ${o.reason || ''}` : o.reason || 'Overdue');
    });
    return m;
  }, [data]);

  const eqQuery = eqSearch.trim().toLowerCase();
  const equipment = useMemo(
    () =>
      (data?.equipment || []).filter((e) => {
        if (eqStatus && e.status !== eqStatus) return false;
        if (!eqQuery) return true;
        return [e.equipment_name, e.model, e.machine_name_alias, e.item, e.asset_tag, e.equipment_type, e.location].some((f) =>
          (f || '').toLowerCase().includes(eqQuery),
        );
      }),
    [data, eqQuery, eqStatus],
  );

  const calDueSoon = useMemo(
    () =>
      (data?.equipment || []).filter((e) => {
        const d = daysUntil(e.next_calibration_due);
        return d != null && d >= 0 && d <= 30;
      }).length,
    [data],
  );

  const chartLimits = useMemo(() => {
    const lim = latestLimits(ljPoints);
    if (lim) return lim;
    if (ljStats.mean != null) return { mean: Number(ljStats.mean), sd: Number(ljStats.sd || 0) };
    return null;
  }, [ljPoints, ljStats]);

  async function onSubmitIqc(e: FormEvent) {
    e.preventDefault();
    setBusy('iqc');
    setError(null);
    try {
      const res = await api.submitIqcRun({
        analyte_code: analyte,
        analyte_name: analyteName || (analyte === 'GLU' ? 'Glucose' : analyte),
        qc_level: level,
        result_value: result,
        lab_mean: mean,
        lab_sd: sd,
        equipment: bioEquip,
      });
      setNotice(`IQC ${res.data.iqc_run} → ${res.data.outcome}${res.data.z_score != null ? ` (z=${res.data.z_score})` : ''}`);
      setEditLimits(false);
      await load();
      await loadLj();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IQC submit failed');
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) return <p>Loading QC dashboard…</p>;

  const counts = data?.counts;
  const latestEqa = data?.eqa?.[0];
  const pmOverdue = data?.pm_overdue?.length ?? 0;
  const limitsLocked = limitsFromHistory && !editLimits;

  function scrollTo(key: SectionKey) {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function menuProps(id: string) {
    return { open: menuFor === id, onToggle: () => setMenuFor(menuFor === id ? null : id) };
  }

  function chooseAnalyte(code: string) {
    if (code === OTHER_ANALYTE) {
      setCustomAnalyte(true);
      return;
    }
    setCustomAnalyte(false);
    setEditLimits(false);
    setAnalyte(code);
  }

  function viewEquipment(eq: QcEquipment) {
    setDetail({
      title: eq.equipment_name,
      deskHref: deskLink('Lab Equipment', eq.name),
      rows: [
        ['Asset tag', eq.asset_tag || '—'],
        ['Model', eq.machine_name_alias || eq.model || '—'],
        ['Item', eq.item || '—'],
        ['Type', eq.equipment_type || '—'],
        ['NABL product group', eq.nabl_product_group || '—'],
        ['Location', eq.location || '—'],
        ['ERP asset', eq.erp_asset || '—'],
        ['Status', <span className={`lt-badge ${equipmentTone(eq.status)}`}>{eq.status || '—'}</span>],
        ['Safety label', eq.safety_label || '—'],
        ['Next calibration', eq.next_calibration_due || '—'],
        ['Next PM', eq.next_maintenance_due || '—'],
        ['Alerts', overdueByName.get(eq.name) || 'None'],
      ],
    });
  }

  function viewIqc(r: QcDashboard['iqc_today'][number]) {
    const o = iqcOutcome(r.outcome);
    setDetail({
      title: `IQC ${r.name}`,
      deskHref: deskLink('IQC Run', r.name),
      rows: [
        ['Analyte', `${r.analyte_code}${r.analyte_name ? ` (${r.analyte_name})` : ''}`],
        ['Level', `L${r.qc_level}`],
        ['Result', fmtNum(r.result_value)],
        ['Lab mean', fmtNum(r.lab_mean)],
        ['Lab SD', fmtNum(r.lab_sd)],
        ['Z-score', fmtNum(r.z_score)],
        ['Outcome', <span className={`lt-badge ${o.tone}`}>{o.label}</span>],
        ['Equipment', data?.equipment?.find((e) => e.name === r.equipment)?.equipment_name || r.equipment || '—'],
        ['Recorded', formatWhen(r.creation)],
      ],
    });
  }

  function viewEqa(r: QcDashboard['eqa'][number]) {
    setDetail({
      title: r.scheme_name,
      deskHref: deskLink('EQA Participation', r.name),
      rows: [
        ['Discipline', r.discipline || '—'],
        ['Cycle', r.cycle || '—'],
        ['Participation date', r.participation_date || '—'],
        ['Score', r.score || '—'],
        ['Outcome', <span className={`lt-badge ${eqaTone(r.outcome)}`}>{r.outcome || '—'}</span>],
      ],
    });
  }

  return (
    <div className="lt-page lq2-page">
      <section className="lt-hero">
        <span className="lt-hero-icon">
          <QIcon size={32}>{ICON_MICROSCOPE}</QIcon>
        </span>
        <div>
          <h2>Lab QC &amp; equipment</h2>
          <p>Monitor lab quality control, equipment status and EQA performance. Set limits, view charts and track schedules.</p>
        </div>
      </section>

      <div className="lt-stats lq2-stats">
        <StatCard
          tone="tone-blue"
          icon={ICON_FLASK}
          value={counts?.equipment ?? 0}
          label="Equipment"
          sub="Total instruments"
          onClick={() => scrollTo('equipment')}
        />
        <StatCard
          tone="tone-green"
          icon={ICON_SHIELD}
          value={counts?.iqc_tests ?? analyteOptions.length}
          label="IQC Tests"
          sub={`Under monitoring · ${counts?.iqc ?? 0} runs`}
          onClick={() => scrollTo('record')}
        />
        <StatCard
          tone="tone-orange"
          icon={ICON_CHART}
          value={counts?.eqa ?? 0}
          label="EQA Cycles"
          sub={latestEqa?.cycle ? `Latest cycle ${latestEqa.cycle}` : 'Participation records'}
          onClick={() => scrollTo('eqa')}
        />
        <StatCard
          tone="tone-purple"
          icon={ICON_GEAR}
          value={counts?.calibrations ?? 0}
          label="Calibrations"
          sub={calDueSoon ? `${calDueSoon} due in 30 days` : 'Calibration records'}
          onClick={() => scrollTo('equipment')}
        />
        <StatCard
          tone="tone-red"
          icon={ICON_DOC}
          value={counts?.maintenance ?? 0}
          label="PM Logs"
          sub={pmOverdue ? `${pmOverdue} PM overdue` : 'Maintenance records'}
          onClick={() => scrollTo('equipment')}
        />
      </div>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      {data?.overdue?.length ? (
        <div className="lq2-alert" role="alert">
          <strong>Calibration / PM / OOS:</strong> {data.overdue.map((o) => `${o.equipment_name} (${o.reason})`).join(' · ')}
        </div>
      ) : null}

      <div
        className="lq2-record-row"
        ref={(el) => {
          sectionRefs.current.record = el;
        }}
      >
        <form className="lq2-card" onSubmit={onSubmitIqc}>
          <CardHead icon={ICON_CLIPBOARD} title="Record IQC" sub="Enter control results and track daily QC performance." />
          <div className="lq2-form-grid">
            <label className="lt-field">
              <span>
                Analyte / Test <em>*</em>
              </span>
              {customAnalyte ? (
                <span className="lq2-inline">
                  <input
                    className="lq2-input"
                    value={analyte}
                    onChange={(e) => {
                      setEditLimits(false);
                      setAnalyte(e.target.value.toUpperCase());
                    }}
                    placeholder="Analyte code"
                    required
                  />
                  <button type="button" className="lq2-link" onClick={() => setCustomAnalyte(false)}>
                    List
                  </button>
                </span>
              ) : (
                <select value={analyte} onChange={(e) => chooseAnalyte(e.target.value)} required>
                  {analyteOptions.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.name && a.name !== a.code ? `${a.code} (${a.name})` : a.code}
                    </option>
                  ))}
                  <option value={OTHER_ANALYTE}>Other analyte…</option>
                </select>
              )}
            </label>
            <label className="lt-field">
              <span>
                Level <em>*</em>
              </span>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                {levelOptions.map((l) => (
                  <option key={l} value={l}>
                    L{l}
                  </option>
                ))}
              </select>
            </label>
            <label className="lt-field">
              <span>
                Result <em>*</em>
              </span>
              <input className="lq2-input" value={result} onChange={(e) => setResult(e.target.value)} inputMode="decimal" required />
            </label>
            <label className="lt-field">
              <span>Lab Mean</span>
              <input
                className="lq2-input"
                value={mean}
                onChange={(e) => setMean(e.target.value)}
                readOnly={limitsLocked}
                inputMode="decimal"
              />
            </label>
            <label className="lt-field">
              <span>Lab SD</span>
              <input
                className="lq2-input"
                value={sd}
                onChange={(e) => setSd(e.target.value)}
                readOnly={limitsLocked}
                inputMode="decimal"
              />
            </label>
          </div>
          <div className="lq2-form-foot">
            <button className="lt-action lq2-submit" type="submit" disabled={busy === 'iqc'}>
              {busy === 'iqc' ? 'Saving…' : 'Submit IQC'}
            </button>
            <span className="lq2-hint">
              {limitsLocked ? (
                <>
                  Limits from the latest run.{' '}
                  <button type="button" className="lq2-link" onClick={() => setEditLimits(true)}>
                    Set limits
                  </button>
                </>
              ) : limitsFromHistory ? (
                <>
                  Editing limits for this run.{' '}
                  <button
                    type="button"
                    className="lq2-link"
                    onClick={() => {
                      setEditLimits(false);
                      void loadLj();
                    }}
                  >
                    Reset
                  </button>
                </>
              ) : (
                'No established limits for this analyte/level yet — enter lab mean and SD.'
              )}
            </span>
          </div>
        </form>

        <section className="lq2-card lq2-lj">
          <div className="lq2-lj-head">
            <h3>
              Levey–Jennings Chart — {analyte} L{level}
            </h3>
            <select className="lq2-range" value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))}>
              {RANGE_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          </div>
          <LjChart points={ljPoints} mean={chartLimits?.mean ?? null} sd={chartLimits?.sd ?? null} />
          {ljPoints.length ? (
            <p className="lq2-lj-meta">
              {ljPoints.length} point{ljPoints.length === 1 ? '' : 's'}
              {ljStats.mean != null ? ` · observed mean ${fmtNum(ljStats.mean)}` : ''}
              {ljStats.sd != null ? ` · SD ${fmtNum(ljStats.sd)}` : ''}
              {ljStats.cv_percent != null ? ` · CV ${fmtNum(ljStats.cv_percent)}%` : ''}
            </p>
          ) : null}
        </section>
      </div>

      <section
        className="lt-table-card lq2-card lq2-table-card"
        ref={(el) => {
          sectionRefs.current.equipment = el;
        }}
      >
        <CardHead icon={ICON_MONITOR} title="Equipment" sub="View instrument details, service schedule and status.">
          <label className="lt-search lq2-search">
            <QIcon size={16}>{ICON_SEARCH}</QIcon>
            <input value={eqSearch} onChange={(e) => setEqSearch(e.target.value)} placeholder="Search equipment name or model…" />
          </label>
          <label className="lt-field lq2-status">
            <select value={eqStatus} onChange={(e) => setEqStatus(e.target.value)} aria-label="Status filter">
              <option value="">All Status</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <a className="lt-action lq2-add" href={deskLink('Lab Equipment', 'new')} target="_blank" rel="noreferrer">
            <QIcon size={16}>{ICON_PLUS}</QIcon> Add Equipment
          </a>
        </CardHead>
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Model</th>
                <th>Item</th>
                <th>Tag</th>
                <th>Next Cal</th>
                <th>Next PM</th>
                <th>Status</th>
                <th>Action</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {equipment.length ? (
                equipment.map((eq) => {
                  const calDays = daysUntil(eq.next_calibration_due);
                  const pmDays = daysUntil(eq.next_maintenance_due);
                  return (
                    <tr key={eq.name}>
                      <td className="lt-trf">{eq.equipment_name}</td>
                      <td>{eq.machine_name_alias || eq.model || '—'}</td>
                      <td className="muted">{eq.item || '—'}</td>
                      <td>{eq.asset_tag || '—'}</td>
                      <td className={calDays != null && calDays < 0 ? 'lq2-overdue' : ''}>{eq.next_calibration_due || '—'}</td>
                      <td className={pmDays != null && pmDays < 0 ? 'lq2-overdue' : ''}>{eq.next_maintenance_due || '—'}</td>
                      <td>
                        <span className={`lt-badge ${equipmentTone(eq.status)}`}>{eq.status || '—'}</span>
                      </td>
                      <td>
                        <button type="button" className="lt-action is-ghost lq2-view" onClick={() => viewEquipment(eq)}>
                          View
                        </button>
                      </td>
                      <td>
                        <RowMenu {...menuProps(`eq-${eq.name}`)}>
                          <button type="button" onClick={() => viewEquipment(eq)}>
                            View details
                          </button>
                          <a href={deskLink('Lab Equipment', eq.name)} target="_blank" rel="noreferrer">
                            Open in desk
                          </a>
                          {eq.asset_tag ? (
                            <button type="button" onClick={() => void navigator.clipboard?.writeText(eq.asset_tag || '')}>
                              Copy asset tag
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
                    {eqQuery || eqStatus ? 'No equipment matches your filters.' : 'No equipment registered yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="lq2-bottom-row">
        <section
          className="lt-table-card lq2-card lq2-table-card"
          ref={(el) => {
            sectionRefs.current.iqc = el;
          }}
        >
          <CardHead icon={ICON_CLIPBOARD} title="Today's IQC" sub="Latest control results entered today." />
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Analyte</th>
                  <th>Level</th>
                  <th>Result</th>
                  <th>Outcome</th>
                  <th>Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(data?.iqc_today || []).length ? (
                  (data?.iqc_today || []).map((r) => {
                    const o = iqcOutcome(r.outcome);
                    return (
                      <tr key={r.name}>
                        <td>
                          {r.analyte_code} {r.analyte_name && r.analyte_name !== r.analyte_code ? `(${r.analyte_name})` : ''}
                        </td>
                        <td>L{r.qc_level}</td>
                        <td>{fmtNum(r.result_value)}</td>
                        <td>
                          <span className={`lt-badge ${o.tone}`}>{o.label}</span>
                        </td>
                        <td className="lq2-nowrap">{formatWhen(r.creation)}</td>
                        <td>
                          <button type="button" className="lt-action is-ghost lq2-view" onClick={() => viewIqc(r)}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="lt-empty">
                      No IQC today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="lt-table-card lq2-card lq2-table-card"
          ref={(el) => {
            sectionRefs.current.eqa = el;
          }}
        >
          <CardHead icon={ICON_SHIELD} title="EQA" sub="External Quality Assessment performance." />
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Scheme</th>
                  <th>Discipline</th>
                  <th>Cycle</th>
                  <th>Score</th>
                  <th>Outcome</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(data?.eqa || []).length ? (
                  (data?.eqa || []).map((r) => (
                    <tr key={r.name}>
                      <td>{r.scheme_name}</td>
                      <td>{r.discipline || '—'}</td>
                      <td>{r.cycle || '—'}</td>
                      <td>{r.score || '—'}</td>
                      <td>
                        <span className={`lt-badge ${eqaTone(r.outcome)}`}>{r.outcome || '—'}</span>
                      </td>
                      <td>
                        <button type="button" className="lt-action is-ghost lq2-view" onClick={() => viewEqa(r)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="lt-empty">
                      No EQA participation recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <p className="lq2-back">
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>

      {detail ? <DetailModal detail={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
