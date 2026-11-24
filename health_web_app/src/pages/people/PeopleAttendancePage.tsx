import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  AttendanceStatus,
  PeopleAttendanceRegister,
  PeopleAttendanceRow,
  PeopleHrmsDashboard,
} from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { assetUrl, deskAppUrl } from '../../config';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-grades.css';
import './people-attendance.css';

function readGps(required = true): Promise<{ latitude?: number; longitude?: number; warn?: string }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      if (required) reject(new Error('Geolocation is not available in this browser'));
      else resolve({ warn: 'Geolocation is not available in this browser' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      (err) => {
        const msg = err && err.message ? String(err.message) : 'Unable to read GPS location';
        if (!required) {
          resolve({ warn: msg });
          return;
        }
        if (/permissions policy/i.test(msg)) {
          reject(
            new Error(
              'Location is blocked in this view. Open Attendance on people.e-remedium.in (not inside another portal iframe), allow location when prompted, then try again.',
            ),
          );
          return;
        }
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  });
}

function MyAttendancePanel({ data, onChanged }: { data: PeopleHrmsDashboard; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function punch(logType: 'IN' | 'OUT') {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const geoRequired = !!Number(data.attendance?.geofence_required || 0);
      const loc = await readGps(geoRequired);
      const coords =
        loc.latitude != null && loc.longitude != null
          ? { latitude: loc.latitude, longitude: loc.longitude }
          : undefined;
      const res = await api.submitEmployeeCheckin(logType, coords);
      const geo = res.data.checkin?.geofence;
      const base = geo?.override
        ? `${res.message || logType} · geofencing temporarily disabled by HR${geo.override_until ? ` until ${geo.override_until}` : ''}`
        : geo
          ? `${res.message || logType} · ${geo.distance_m}m from ${geo.label || 'site'} (limit ${geo.radius_m}m)`
          : res.message || `${logType} recorded`;
      setMessage(base + (coords ? ' · location saved' : loc.warn ? ' · location unavailable' : ''));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record attendance');
    } finally {
      setBusy(false);
    }
  }

  const att = data.attendance;

  return (
    <section className="people-panel">
      <header>
        <div>
          <h2>My attendance</h2>
          <p>
            Today: <strong>{att.today_status}</strong>
            {att.last_checkin ? ` · last ${att.last_checkin.log_type} at ${att.last_checkin.time}` : ''}
          </p>
        </div>
        <b>{att.present_days} days</b>
      </header>

      <p className="muted" style={{ marginTop: 0 }}>
        {Number(att.geofence_required || 0)
          ? 'Check-in uses your device GPS and must be inside your assigned work geofence.'
          : 'Geofencing is off for your profile. Check-in still captures your current location when the browser allows it.'}
      </p>

      {!att.checkin_available ? (
        <div className="people-alert err">
          Employee Checkin DocType is missing. Install/sync HRMS Attendance on ERPNext.
        </div>
      ) : (
        <div className="people-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void punch('IN')}>
            Check in
          </button>
          <button type="button" disabled={busy} onClick={() => void punch('OUT')}>
            Check out
          </button>
        </div>
      )}

      {message ? <div className="people-alert ok">{message}</div> : null}
      {error ? <div className="people-alert err">{error}</div> : null}

      <div className="people-kpi-grid" style={{ marginTop: 18 }}>
        <article>
          <span>Present days MTD</span>
          <strong>{att.present_days}</strong>
        </article>
        <article>
          <span>Check-ins MTD</span>
          <strong>{att.checkins_mtd}</strong>
        </article>
        <article>
          <span>Present %</span>
          <strong>{data.kpis.present_pct}%</strong>
        </article>
      </div>
    </section>
  );
}

type Tab = 'daily' | 'monthly' | 'leave' | 'insights' | 'mine';
type RangeKey = 'today' | 'week' | 'month' | 'custom';

const STATUS_TONE: Record<AttendanceStatus, string> = {
  Present: 'green',
  Absent: 'red',
  'On Leave': 'amber',
  'Half Day': 'blue',
  Holiday: 'muted',
};
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  Present: '#16a34a',
  Absent: '#ef4444',
  'On Leave': '#f59e0b',
  'Half Day': '#3b82f6',
  Holiday: '#94a3b8',
};
const AVATAR_TONES = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#16a34a', '#7c3aed', '#0891b2'];
const PER_PAGE_OPTIONS = [10, 25, 50, 100];

function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA');
}

function rangeFor(key: Exclude<RangeKey, 'custom'>) {
  const now = new Date();
  if (key === 'today') return { from: isoDate(now), to: isoDate(now) };
  if (key === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return { from: isoDate(start), to: isoDate(now) };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: isoDate(first), to: isoDate(last) };
}

function fmtDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMins(m?: number) {
  if (!m) return '—';
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function pct(n: number, total: number) {
  if (!total || !n) return 0;
  return Math.max(1, Math.round((n / total) * 100));
}

function initialsOf(name?: string) {
  return (
    String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

function toneOf(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function Avatar({ row }: { row: PeopleAttendanceRow }) {
  const [broken, setBroken] = useState(false);
  if (row.photo && !broken) {
    return <img className="emp-avatar" src={assetUrl(row.photo)} alt="" onError={() => setBroken(true)} />;
  }
  const tone = toneOf(row.id);
  return (
    <span className="emp-avatar" style={{ background: `${tone}1f`, color: tone }}>
      {initialsOf(row.name)}
    </span>
  );
}

function attendancePct(r: PeopleAttendanceRow) {
  const c = r.counts;
  const working = c.present + c.absent + c.leave + c.half_day;
  return working ? Math.round(((c.present + c.half_day * 0.5) / working) * 100) : 0;
}

function pageList(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

function csvCell(value: unknown) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(name: string, header: string[], lines: unknown[][]) {
  const text = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function FilterDropdown({
  value,
  allLabel,
  options,
  onChange,
  label,
}: {
  value: string;
  allLabel: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className={`dsg-select${value ? ' active' : ''}`}>
      <span>{value || allLabel}</span>
      <HrmsIcon name="chevronDown" size={16} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function AttendanceManager({ dashboard, reloadDashboard }: { dashboard: PeopleHrmsDashboard; reloadDashboard: () => Promise<void> }) {
  const initial = rangeFor('month');
  const [tab, setTab] = useState<Tab>('daily');
  const [rangeKey, setRangeKey] = useState<RangeKey>('month');
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [reg, setReg] = useState<PeopleAttendanceRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState('');
  const [desigFilter, setDesigFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [onlyWithLeave, setOnlyWithLeave] = useState(true);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [exportOpen, setExportOpen] = useState(false);
  const [viewRow, setViewRow] = useState<PeopleAttendanceRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fromRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPeopleAttendanceRegister({ fromDate: from, toDate: to });
      setReg(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load attendance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fromDate && toDate) void load(fromDate, toDate);
  }, [load, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
  }, [deptFilter, desigFilter, statusFilter, query, perPage, tab, fromDate, toDate, onlyWithLeave]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!menuFor && !exportOpen) return;
    const close = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest('.emp-popover, .emp-popover-trigger')) return;
      setMenuFor(null);
      setExportOpen(false);
    };
    const closeMenu = () => setMenuFor(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [menuFor, exportOpen]);

  const pickRange = (key: RangeKey) => {
    setRangeKey(key);
    if (key === 'custom') {
      fromRef.current?.focus();
      fromRef.current?.showPicker?.();
      return;
    }
    const r = rangeFor(key);
    setFromDate(r.from);
    setToDate(r.to);
  };

  const rows = useMemo(() => reg?.employees || [], [reg]);
  const k = reg?.kpis;

  const options = useMemo(() => {
    const uniq = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
    return {
      departments: uniq(rows.map((r) => r.department)),
      designations: uniq(rows.map((r) => r.designation)),
      statuses: uniq(rows.map((r) => r.status)),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!deptFilter || r.department === deptFilter) &&
        (!desigFilter || r.designation === desigFilter) &&
        (!statusFilter || r.status === statusFilter) &&
        (!q || [r.name, r.id, r.department, r.designation].some((v) => (v || '').toLowerCase().includes(q))) &&
        (tab !== 'leave' || !onlyWithLeave || Object.keys(r.leave_period).length > 0),
    );
  }, [rows, deptFilter, desigFilter, statusFilter, query, tab, onlyWithLeave]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = filtered.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, filtered.length);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const filtersActive = Boolean(deptFilter || desigFilter || statusFilter || query);
  const total = k?.total_employees || 0;
  const rangeLabel = reg ? `${fmtDate(reg.from_date)} – ${fmtDate(reg.to_date)}` : '';
  const refLabel = reg ? fmtDate(reg.ref_day) : '';
  const isSingleDay = reg ? reg.from_date === reg.to_date : false;

  const workTrend =
    k && k.prev_avg_working_minutes && k.avg_working_minutes
      ? Math.round(((k.avg_working_minutes - k.prev_avg_working_minutes) / k.prev_avg_working_minutes) * 100)
      : null;
  const leaveTrend =
    k && k.leave_days_last_ytd ? Math.round(((k.leave_days_ytd - k.leave_days_last_ytd) / k.leave_days_last_ytd) * 100) : null;

  const resetFilters = () => {
    setDeptFilter('');
    setDesigFilter('');
    setStatusFilter('');
    setQuery('');
    setSelected(new Set());
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const openRowMenu = (id: string, anchor: HTMLElement) => {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 150;
    const top = rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.max(8, rect.right - 210) });
    setMenuFor(id);
  };

  const exportRows = selected.size ? rows.filter((r) => selected.has(r.id)) : filtered;
  const stamp = reg ? `${reg.from_date}_to_${reg.to_date}` : 'attendance';

  const exportDaily = () =>
    downloadCsv(
      `attendance-daily-${reg?.ref_day}.csv`,
      ['Employee ID', 'Name', 'Department', 'Designation', `Status (${reg?.ref_day})`, 'Check In', 'Check Out', 'Worked (period)', 'Avg daily (month)'],
      exportRows.map((r) => [r.id, r.name, r.department, r.designation, r.status, r.check_in, r.check_out, fmtMins(r.period_minutes), fmtMins(r.avg_month_minutes)]),
    );
  const exportMonthly = () =>
    downloadCsv(
      `attendance-summary-${stamp}.csv`,
      ['Employee ID', 'Name', 'Department', 'Present', 'Half Day', 'On Leave', 'Absent', 'Holiday', 'Worked', 'Attendance %'],
      exportRows.map((r) => [r.id, r.name, r.department, r.counts.present, r.counts.half_day, r.counts.leave, r.counts.absent, r.counts.holiday, fmtMins(r.period_minutes), attendancePct(r)]),
    );
  const exportLeave = () =>
    downloadCsv(
      `leave-summary-${stamp}.csv`,
      ['Employee ID', 'Name', 'Department', ...(reg?.leave_types || []), 'Total days'],
      exportRows.map((r) => [
        r.id,
        r.name,
        r.department,
        ...(reg?.leave_types || []).map((t) => r.leave_period[t] || 0),
        Object.values(r.leave_period).reduce((s, v) => s + v, 0),
      ]),
    );
  const exportLog = (list: PeopleAttendanceRow[], name: string) =>
    downloadCsv(
      name,
      ['Employee ID', 'Name', 'Date', 'Status', 'Check In', 'Check Out', 'Worked'],
      list.flatMap((r) => r.log.map((l) => [r.id, r.name, l.date, l.status || '', l.check_in || '', l.check_out || '', fmtMins(l.minutes)])),
    );

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setNotice('Employee ID copied');
    setMenuFor(null);
  };

  const distribution: Array<{ label: AttendanceStatus; value: number }> = k
    ? [
        { label: 'Present', value: k.present },
        { label: 'Absent', value: k.absent },
        { label: 'On Leave', value: k.on_leave },
        { label: 'Half Day', value: k.half_day },
        ...(k.holiday ? [{ label: 'Holiday' as AttendanceStatus, value: k.holiday }] : []),
      ]
    : [];
  const distTotal = distribution.reduce((s, d) => s + d.value, 0);
  const donut = (() => {
    if (!distTotal) return '#eef2f6';
    let acc = 0;
    return `conic-gradient(${distribution
      .filter((d) => d.value)
      .map((d) => {
        const from = (acc / distTotal) * 360;
        acc += d.value;
        return `${STATUS_COLOR[d.label]} ${from}deg ${(acc / distTotal) * 360}deg`;
      })
      .join(', ')})`;
  })();

  const deptRates = useMemo(() => {
    const map = new Map<string, { worked: number; possible: number; people: number }>();
    rows.forEach((r) => {
      const key = r.department || 'Unassigned';
      const cur = map.get(key) || { worked: 0, possible: 0, people: 0 };
      cur.worked += r.counts.present + r.counts.half_day * 0.5;
      cur.possible += r.counts.present + r.counts.absent + r.counts.leave + r.counts.half_day;
      cur.people += 1;
      map.set(key, cur);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, rate: v.possible ? Math.round((v.worked / v.possible) * 100) : 0, people: v.people }))
      .sort((a, b) => b.rate - a.rate || b.people - a.people);
  }, [rows]);

  const seriesMax = Math.max(1, ...(reg?.series || []).map((s) => s.present + s.half_day + s.leave + s.absent));

  const kpis = [
    {
      icon: 'users',
      tone: 'teal',
      label: 'Total Employees',
      value: total,
      sub: k?.joined_this_month ? `+${k.joined_this_month} this month` : 'Active workforce',
      up: Boolean(k?.joined_this_month),
    },
    { icon: 'userCheck', tone: 'blue', label: isSingleDay ? 'Present' : 'Present Today', value: k?.present ?? 0, sub: `${pct(k?.present || 0, total)}% of total` },
    { icon: 'userX', tone: 'rose', label: isSingleDay ? 'Absent' : 'Absent Today', value: k?.absent ?? 0, sub: `${pct(k?.absent || 0, total)}% of total` },
    {
      icon: 'clock',
      tone: 'amber',
      label: 'Avg. Working Hours',
      hint: '(Selected Period)',
      value: fmtMins(k?.avg_working_minutes),
      sub: workTrend == null ? 'per day worked' : `${workTrend >= 0 ? '+' : ''}${workTrend}% vs last period`,
      up: workTrend != null && workTrend >= 0,
      down: workTrend != null && workTrend < 0,
    },
    {
      icon: 'calendar',
      tone: 'violet',
      label: 'Approved Leave',
      hint: '(This Period)',
      value: k?.approved_leave_period ?? 0,
      sub: k?.open_leave_period ? `${k.open_leave_period} pending approval` : `${pct(k?.employees_on_leave_period || 0, total)}% of employees`,
    },
    {
      icon: 'umbrella',
      tone: 'cyan',
      label: 'Total Leave Count YTD',
      value: k?.leave_days_ytd ?? 0,
      sub: leaveTrend == null ? 'leave days this year' : `${leaveTrend >= 0 ? '+' : ''}${leaveTrend}% vs last year`,
      up: leaveTrend != null && leaveTrend >= 0,
    },
  ];

  const tableTab = tab === 'daily' || tab === 'monthly' || tab === 'leave';

  return (
    <div className="hrms-list-page emp-page dep-page att-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon att-title-icon">
            <HrmsIcon name="calendar" size={28} />
          </span>
          <div>
            <h1>Attendance</h1>
            <p>Track employee attendance, working hours and leave summary</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <Link className="emp-btn outline lg" to="/people/settings/geofencing">
            <HrmsIcon name="settings" size={17} />
            Attendance Settings
          </Link>
          <div className="emp-filter-wrap">
            <button
              className="emp-btn primary lg emp-popover-trigger"
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              aria-expanded={exportOpen}
              disabled={!rows.length}
            >
              <HrmsIcon name="download" size={17} />
              Export Report
              <HrmsIcon name="chevronDown" size={16} />
            </button>
            {exportOpen ? (
              <div className="emp-popover emp-menu att-export-menu">
                <button type="button" onClick={() => { exportDaily(); setExportOpen(false); }}>
                  <HrmsIcon name="file" size={15} /> Daily register ({refLabel})
                </button>
                <button type="button" onClick={() => { exportMonthly(); setExportOpen(false); }}>
                  <HrmsIcon name="file" size={15} /> Period summary
                </button>
                <button type="button" onClick={() => { exportLeave(); setExportOpen(false); }}>
                  <HrmsIcon name="file" size={15} /> Leave summary
                </button>
                <button type="button" onClick={() => { exportLog(exportRows, `attendance-log-${stamp}.csv`); setExportOpen(false); }}>
                  <HrmsIcon name="file" size={15} /> Day-wise log
                </button>
                <p>{selected.size ? `${selected.size} selected employees` : `${filtered.length} employees in view`}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}

      <div className="att-kpis">
        {kpis.map((kp) => (
          <div key={kp.label} className="emp-card att-kpi">
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>
                {kp.label}
                {kp.hint ? <i>{kp.hint}</i> : null}
              </b>
              <strong>{loading && !reg ? '…' : kp.value}</strong>
              <small className={kp.up ? 'up' : kp.down ? 'down' : ''}>
                {kp.up ? '↑ ' : kp.down ? '↓ ' : ''}
                {kp.sub}
              </small>
            </div>
          </div>
        ))}
      </div>

      <section className="emp-card att-main">
        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {(
              [
                ['daily', 'Daily Attendance'],
                ['monthly', 'Monthly Attendance'],
                ['leave', 'Leave Summary'],
                ['insights', 'Attendance Insights'],
                ['mine', 'My Check-in'],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </nav>
          {tab !== 'mine' ? (
            <div className="att-ranges">
              {(
                [
                  ['today', 'Today'],
                  ['week', 'This Week'],
                  ['month', 'This Month'],
                  ['custom', 'Custom Range'],
                ] as Array<[RangeKey, string]>
              ).map(([key, label]) => (
                <button key={key} type="button" className={rangeKey === key ? 'on' : ''} onClick={() => pickRange(key)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {tab === 'mine' ? (
          <div className="att-mine">
            <MyAttendancePanel data={dashboard} onChanged={reloadDashboard} />
          </div>
        ) : (
          <>
            <div className="att-filters">
              <label className="att-date">
                <span>From Date</span>
                <div>
                  <HrmsIcon name="calendar" size={16} />
                  <input
                    ref={fromRef}
                    type="date"
                    value={fromDate}
                    max={toDate || undefined}
                    onChange={(e) => {
                      setRangeKey('custom');
                      if (e.target.value) setFromDate(e.target.value);
                    }}
                  />
                </div>
              </label>
              <span className="att-arrow">→</span>
              <label className="att-date">
                <span>To Date</span>
                <div>
                  <HrmsIcon name="calendar" size={16} />
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate || undefined}
                    onChange={(e) => {
                      setRangeKey('custom');
                      if (e.target.value) setToDate(e.target.value);
                    }}
                  />
                </div>
              </label>
              <FilterDropdown label="Department" value={deptFilter} allLabel="All Departments" options={options.departments} onChange={setDeptFilter} />
              <FilterDropdown label="Designation" value={desigFilter} allLabel="All Designations" options={options.designations} onChange={setDesigFilter} />
              <FilterDropdown label="Status" value={statusFilter} allLabel="All Status" options={options.statuses} onChange={setStatusFilter} />
              <label className="emp-search att-search">
                <HrmsIcon name="search" size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search employee by name, ID or department..."
                  aria-label="Search attendance"
                />
              </label>
              <button className="emp-btn outline dsg-reset" type="button" onClick={resetFilters} disabled={!filtersActive && !selected.size}>
                <HrmsIcon name="reset" size={16} />
                Reset
              </button>
            </div>

            {tab === 'daily' ? (
              <div className="att-summary">
                {distribution.slice(0, 4).map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    className={`att-stat ${STATUS_TONE[d.label]}${statusFilter === d.label ? ' on' : ''}`}
                    onClick={() => setStatusFilter(statusFilter === d.label ? '' : d.label)}
                  >
                    <strong>{d.value}</strong>
                    <span>{d.label}</span>
                    <small>{pct(d.value, total)}% of total</small>
                  </button>
                ))}
                <div className="att-dist">
                  <div>
                    <b>Attendance Distribution</b>
                    <small>as of {refLabel}</small>
                  </div>
                  <div className="att-donut" style={{ background: donut }}>
                    <span>
                      <strong>{distTotal}</strong>
                      <small>Employees</small>
                    </span>
                  </div>
                  <ul>
                    {distribution.map((d) => (
                      <li key={d.label}>
                        <i style={{ background: STATUS_COLOR[d.label] }} />
                        <span>{d.label}</span>
                        <b>{d.value}</b>
                        <em>{pct(d.value, distTotal)}%</em>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {tab === 'leave' ? (
              <div className="att-leave-bar">
                <span>
                  Leave in {rangeLabel}: <b>{k?.approved_leave_period ?? 0}</b> approved · <b>{k?.open_leave_period ?? 0}</b> pending ·{' '}
                  <b>{k?.employees_on_leave_period ?? 0}</b> employees
                </span>
                <label className="emp-check-label">
                  <input type="checkbox" checked={onlyWithLeave} onChange={(e) => setOnlyWithLeave(e.target.checked)} />
                  Only employees with leave
                </label>
                <Link to="/people/leave" className="att-link">
                  Open leave management →
                </Link>
              </div>
            ) : null}

            {tab === 'insights' ? (
              <div className="att-insights">
                <div className="att-chart-card">
                  <header>
                    <b>Daily attendance</b>
                    <small>{rangeLabel}</small>
                  </header>
                  <div className="att-chart">
                    {(reg?.series || []).map((s) => {
                      const parts: Array<[AttendanceStatus, number]> = [
                        ['Present', s.present],
                        ['Half Day', s.half_day],
                        ['On Leave', s.leave],
                        ['Absent', s.absent],
                      ];
                      const sum = parts.reduce((a, [, v]) => a + v, 0);
                      return (
                        <div
                          key={s.date}
                          className="att-col"
                          title={`${fmtDate(s.date)} · ${parts.map(([l, v]) => `${l} ${v}`).join(' · ')}${s.holiday ? ` · Holiday ${s.holiday}` : ''}`}
                        >
                          <div className="att-stack" style={{ height: `${(sum / seriesMax) * 100}%` }}>
                            {parts.map(([l, v]) =>
                              v ? <span key={l} style={{ flexGrow: v, background: STATUS_COLOR[l] }} /> : null,
                            )}
                          </div>
                          <em>{Number(s.date.slice(8))}</em>
                        </div>
                      );
                    })}
                  </div>
                  <div className="att-legend">
                    {(['Present', 'Half Day', 'On Leave', 'Absent'] as AttendanceStatus[]).map((l) => (
                      <span key={l}>
                        <i style={{ background: STATUS_COLOR[l] }} /> {l}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="att-chart-card">
                  <header>
                    <b>Attendance rate by department</b>
                    <small>Present + ½ half days over working days</small>
                  </header>
                  <div className="dep-bars">
                    {deptRates.map((d) => (
                      <div key={d.name} className="dep-bar-row">
                        <span className="dep-bar-label" title={d.name}>
                          {d.name}
                        </span>
                        <span className="dep-bar-track">
                          <span className="dep-bar-fill" style={{ width: `${d.rate}%`, background: d.rate >= 75 ? '#16a34a' : d.rate >= 40 ? '#f59e0b' : '#ef4444' }} />
                        </span>
                        <span className="dep-bar-value">
                          <b>{d.rate}%</b> ({d.people})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {notice ? (
              <div className="dsg-selbar">
                <span className="emp-notice">{notice}</span>
              </div>
            ) : null}

            {tableTab ? (
              <>
                <div className="emp-table-wrap">
                  <table className="emp-table att-table">
                    <thead>
                      <tr>
                        <th className="emp-col-check">
                          <input type="checkbox" checked={allOnPageSelected} onChange={togglePage} disabled={!pageRows.length} aria-label="Select all on this page" />
                        </th>
                        <th className="dep-col-num">#</th>
                        <th>Employee</th>
                        <th>ID</th>
                        <th>Department</th>
                        {tab === 'daily' ? (
                          <>
                            <th>Designation</th>
                            <th>Check In</th>
                            <th>Check Out</th>
                            <th className="att-th-2">
                              Working Hours<small>(Selected Period)</small>
                            </th>
                            <th className="att-th-2">
                              Avg. Monthly<small>Working Hours</small>
                            </th>
                            <th>Status</th>
                          </>
                        ) : null}
                        {tab === 'monthly' ? (
                          <>
                            <th>Present</th>
                            <th>Half Day</th>
                            <th>On Leave</th>
                            <th>Absent</th>
                            <th>Holiday</th>
                            <th>Worked</th>
                            <th>Attendance</th>
                          </>
                        ) : null}
                        {tab === 'leave' ? (
                          <>
                            {(reg?.leave_types || []).map((t) => (
                              <th key={t}>{t}</th>
                            ))}
                            <th>Total Days</th>
                            <th>Days On Leave</th>
                          </>
                        ) : null}
                        <th className="emp-col-actions">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && !reg ? (
                        <tr>
                          <td colSpan={14} className="emp-empty">
                            Loading attendance…
                          </td>
                        </tr>
                      ) : null}
                      {pageRows.map((row, i) => {
                        const leaveTotal = Object.values(row.leave_period).reduce((s, v) => s + v, 0);
                        const rate = attendancePct(row);
                        return (
                          <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                            <td className="emp-col-check">
                              <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} aria-label={`Select ${row.name}`} />
                            </td>
                            <td className="dep-col-num">{(currentPage - 1) * perPage + i + 1}</td>
                            <td>
                              <div className="emp-person att-person">
                                <Avatar row={row} />
                                <b>{row.name}</b>
                              </div>
                            </td>
                            <td className="emp-mono">{row.id}</td>
                            <td>{row.department || '—'}</td>
                            {tab === 'daily' ? (
                              <>
                                <td className="att-desig" title={row.designation || undefined}>
                                  {row.designation || '—'}
                                </td>
                                <td className="emp-mono">{row.check_in || '—'}</td>
                                <td className="emp-mono">{row.check_out || '—'}</td>
                                <td className="emp-mono">
                                  <b>{fmtMins(row.period_minutes)}</b>
                                </td>
                                <td className="emp-mono">{fmtMins(row.avg_month_minutes)}</td>
                                <td>
                                  {row.status ? <span className={`emp-pill ${STATUS_TONE[row.status]}`}>{row.status}</span> : <span className="emp-pill muted">—</span>}
                                </td>
                              </>
                            ) : null}
                            {tab === 'monthly' ? (
                              <>
                                <td className="att-num green">{row.counts.present}</td>
                                <td className="att-num blue">{row.counts.half_day}</td>
                                <td className="att-num amber">{row.counts.leave}</td>
                                <td className="att-num red">{row.counts.absent}</td>
                                <td className="att-num">{row.counts.holiday}</td>
                                <td className="emp-mono">{fmtMins(row.period_minutes)}</td>
                                <td>
                                  <div className="att-rate">
                                    <span className="dep-emp-track">
                                      <span style={{ width: `${rate}%`, background: rate >= 75 ? '#16a34a' : rate >= 40 ? '#f59e0b' : '#ef4444' }} />
                                    </span>
                                    <em>{rate}%</em>
                                  </div>
                                </td>
                              </>
                            ) : null}
                            {tab === 'leave' ? (
                              <>
                                {(reg?.leave_types || []).map((t) => (
                                  <td key={t} className="att-num">
                                    {row.leave_period[t] || '—'}
                                  </td>
                                ))}
                                <td className="att-num">
                                  <b>{leaveTotal || '—'}</b>
                                </td>
                                <td className="att-num amber">{row.counts.leave + row.counts.half_day * 0.5 || '—'}</td>
                              </>
                            ) : null}
                            <td className="emp-col-actions">
                              <div className="emp-actions">
                                <button type="button" title="View attendance" aria-label={`View ${row.name}`} onClick={() => setViewRow(row)}>
                                  <HrmsIcon name="eye" size={17} />
                                </button>
                                <button type="button" title="Attendance calendar" aria-label={`Calendar for ${row.name}`} onClick={() => setViewRow(row)}>
                                  <HrmsIcon name="calendar" size={16} />
                                </button>
                                <button
                                  type="button"
                                  title="Download day-wise log"
                                  aria-label={`Download log for ${row.name}`}
                                  onClick={() => exportLog([row], `attendance-${row.id}-${stamp}.csv`)}
                                >
                                  <HrmsIcon name="download" size={16} />
                                </button>
                                <div className="emp-filter-wrap">
                                  <button
                                    type="button"
                                    className="emp-popover-trigger"
                                    title="More"
                                    aria-label={`More actions for ${row.name}`}
                                    aria-expanded={menuFor === row.id}
                                    onClick={(e) => openRowMenu(row.id, e.currentTarget)}
                                  >
                                    <HrmsIcon name="moreV" size={18} strokeWidth={3} />
                                  </button>
                                  {menuFor === row.id ? (
                                    <div className="emp-popover emp-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 210 }}>
                                      <Link to={`/people/employees?q=${encodeURIComponent(row.id)}`} onClick={() => setMenuFor(null)}>
                                        <HrmsIcon name="user" size={15} /> Employee profile
                                      </Link>
                                      <a
                                        href={`${deskAppUrl()}/app/employee-checkin?employee=${encodeURIComponent(row.id)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={() => setMenuFor(null)}
                                      >
                                        <HrmsIcon name="clock" size={15} /> Check-in records (ERP)
                                      </a>
                                      <button type="button" onClick={() => copyText(row.id)}>
                                        <HrmsIcon name="copy" size={15} /> Copy employee ID
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!loading && !pageRows.length ? (
                        <tr>
                          <td colSpan={14} className="emp-empty">
                            {tab === 'leave' && onlyWithLeave ? 'No leave in this period for the selected employees.' : 'No employees match these filters.'}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <footer className="emp-pager">
                  <span>
                    Showing {firstShown} to {lastShown} of {filtered.length} employees
                    {selected.size ? ` · ${selected.size} selected` : ''}
                    {loading && reg ? ' · refreshing…' : ''}
                  </span>
                  <div className="emp-pager-right">
                    <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} aria-label="Rows per page">
                      {PER_PAGE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n} per page
                        </option>
                      ))}
                    </select>
                    <nav className="emp-pages" aria-label="Pagination">
                      <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
                        <HrmsIcon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} />
                      </button>
                      {pageList(currentPage, pages).map((p, idx) =>
                        p === '…' ? (
                          <span key={`gap-${idx}`} className="emp-gap">
                            …
                          </span>
                        ) : (
                          <button
                            key={p}
                            type="button"
                            className={p === currentPage ? 'on' : ''}
                            aria-current={p === currentPage ? 'page' : undefined}
                            onClick={() => setPage(p)}
                          >
                            {p}
                          </button>
                        ),
                      )}
                      <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
                        <HrmsIcon name="chevronRight" size={16} />
                      </button>
                    </nav>
                  </div>
                </footer>
              </>
            ) : null}
          </>
        )}
      </section>

      {reg && !reg.checkin_available ? (
        <p className="dep-hint">Employee Checkin is not installed, so working hours and presence cannot be computed.</p>
      ) : null}

      {viewRow && reg ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setViewRow(null)}>
          <aside className="emp-drawer att-drawer" role="dialog" aria-modal="true" aria-label={`${viewRow.name} attendance`} onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div className="emp-person lg">
                <Avatar row={viewRow} />
                <div>
                  <b>{viewRow.name}</b>
                  <small>
                    {viewRow.id} · {viewRow.designation || 'Employee'}
                  </small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewRow(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <p className="att-drawer-range">{rangeLabel}</p>
            <div className="att-drawer-stats">
              {(
                [
                  ['Present', viewRow.counts.present],
                  ['Half Day', viewRow.counts.half_day],
                  ['On Leave', viewRow.counts.leave],
                  ['Absent', viewRow.counts.absent],
                ] as Array<[AttendanceStatus, number]>
              ).map(([l, v]) => (
                <div key={l} className={`att-stat ${STATUS_TONE[l]}`}>
                  <strong>{v}</strong>
                  <span>{l}</span>
                </div>
              ))}
            </div>
            <dl>
              <dt>Worked (period)</dt>
              <dd>{fmtMins(viewRow.period_minutes)}</dd>
              <dt>Avg per day (month)</dt>
              <dd>{fmtMins(viewRow.avg_month_minutes)}</dd>
              <dt>Attendance rate</dt>
              <dd>{attendancePct(viewRow)}%</dd>
              <dt>Leave (period)</dt>
              <dd>
                {Object.keys(viewRow.leave_period).length
                  ? Object.entries(viewRow.leave_period)
                      .map(([t, n]) => `${t}: ${n}`)
                      .join(' · ')
                  : '—'}
              </dd>
            </dl>
            <div className="att-cal">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <b key={`${d}${i}`}>{d}</b>
              ))}
              {(() => {
                const first = new Date(`${reg.from_date}T00:00:00`);
                const pad = (first.getDay() + 6) % 7;
                const byDate = new Map(viewRow.log.map((l) => [l.date, l]));
                return [
                  ...Array.from({ length: pad }, (_, i) => <span key={`pad-${i}`} />),
                  ...reg.series.map((s) => {
                    const l = byDate.get(s.date);
                    const st = l?.status || null;
                    return (
                      <span
                        key={s.date}
                        className={`att-day ${st ? STATUS_TONE[st] : 'none'}`}
                        title={`${fmtDate(s.date)} · ${st || 'No record'}${l?.check_in ? ` · ${l.check_in}–${l.check_out || '…'}` : ''}`}
                      >
                        {Number(s.date.slice(8))}
                      </span>
                    );
                  }),
                ];
              })()}
            </div>
            <div className="grd-emp-list">
              <p>Check-in log</p>
              <ul>
                {viewRow.log.filter((l) => l.check_in || l.check_out || (l.status && l.status !== 'Absent')).length ? (
                  viewRow.log
                    .filter((l) => l.check_in || l.check_out || (l.status && l.status !== 'Absent'))
                    .slice()
                    .reverse()
                    .map((l) => (
                      <li key={l.date}>
                        <b>{fmtDate(l.date)}</b>
                        <span>
                          {l.status || '—'}
                          {l.check_in ? ` · ${l.check_in} – ${l.check_out || '…'}` : ''}
                          {l.minutes ? ` · ${fmtMins(l.minutes)}` : ''}
                        </span>
                      </li>
                    ))
                ) : (
                  <li>
                    <span>No check-ins or leave in this period.</span>
                  </li>
                )}
              </ul>
            </div>
            <div className="emp-drawer-actions">
              <button type="button" className="emp-btn primary" onClick={() => exportLog([viewRow], `attendance-${viewRow.id}-${stamp}.csv`)}>
                <HrmsIcon name="download" size={15} /> Download log
              </button>
              <a className="emp-btn outline" href={`${deskAppUrl()}/app/employee/${encodeURIComponent(viewRow.id)}`} target="_blank" rel="noreferrer">
                <HrmsIcon name="pencil" size={15} /> Open in ERP
              </a>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export function PeopleAttendancePage() {
  const [data, setData] = useState<PeopleHrmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPeopleHrmsDashboard();
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load attendance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <p className="muted">Loading attendance…</p>;
  if (error && !data) return <div className="people-alert err">{error}</div>;
  if (!data) return null;

  if (data.is_manager) return <AttendanceManager dashboard={data} reloadDashboard={load} />;
  return <MyAttendancePanel data={data} onChanged={load} />;
}
