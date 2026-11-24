import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  PeoplePerformanceBand,
  PeoplePerformanceBoard,
  PeoplePerformanceComponent,
  PeoplePerformanceRow,
} from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { deskAppUrl } from '../../config';
import { Avatar, downloadCsv, FilterDropdown, Pager } from './peopleTableKit';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-payroll.css';
import './people-performance.css';

type Tab = 'overview' | 'leaderboard' | 'departments' | 'individual' | 'feedback';
type Draft = { rating: number; remarks: string; recommendation: string };
const RECOMMENDATIONS = ['Promote', 'Retain', 'Develop further', 'Needs improvement', 'Transfer', 'Not recommended'];

const BANDS: PeoplePerformanceBand[] = ['Top Performer', 'High Performer', 'Good Performer', 'Average', 'Needs Improvement', 'No Data'];
const BAND_TONE: Record<PeoplePerformanceBand, string> = {
  'Top Performer': 'green',
  'High Performer': 'cyan',
  'Good Performer': 'blue',
  Average: 'amber',
  'Needs Improvement': 'rose',
  'No Data': 'grey',
};
const COMPONENTS: Array<{ key: PeoplePerformanceComponent; label: string; color: string }> = [
  { key: 'hours', label: 'Working Hours', color: '#2563eb' },
  { key: 'attendance', label: 'Attendance', color: '#22c55e' },
  { key: 'feedback', label: 'Manager Feedback', color: '#f59e0b' },
];
const BAR_COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#64748b', '#ec4899'];
const MEDAL = ['#f5b301', '#94a3b8', '#d97706'];

function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA');
}

function monthRange(value: string) {
  const [y, m] = value.split('-').map(Number);
  return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) };
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMonth(iso?: string | null) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fmtScore(n?: number | null) {
  return n == null ? '—' : n.toFixed(1);
}

function avgOf(values: number[]) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function RankBadge({ rank }: { rank: number | null }) {
  if (!rank) return <span className="pf-rank none">—</span>;
  if (rank <= 3) {
    return (
      <span className="pf-rank medal" style={{ color: MEDAL[rank - 1] }} title={`Rank ${rank}`}>
        <HrmsIcon name="award" size={17} />
        <b>{rank}</b>
      </span>
    );
  }
  return <span className="pf-rank">{rank}</span>;
}

function Stars({ value, onChange, size = 20 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className={`pf-stars${onChange ? ' edit' : ''}`} style={{ fontSize: size }} role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" className={n <= value ? 'on' : ''} onClick={() => onChange(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`} aria-checked={n === value} role="radio">
            ★
          </button>
        ) : (
          <i key={n} className={n <= Math.round(value) ? 'on' : ''}>
            ★
          </i>
        ),
      )}
    </span>
  );
}

function PerformanceDetail({
  row,
  board,
  deptAvg,
  orgAvg,
  onRate,
  onDownloadReport,
  downloading,
}: {
  row: PeoplePerformanceRow;
  board: PeoplePerformanceBoard;
  deptAvg: Record<PeoplePerformanceComponent | 'score', number | null>;
  orgAvg: Record<PeoplePerformanceComponent | 'score', number | null>;
  onRate: () => void;
  onDownloadReport?: () => void;
  downloading?: boolean;
}) {
  const history = board.reviews[row.id] || [];
  const change = row.score != null && row.prev_score != null ? row.score - row.prev_score : null;
  const parts: Array<{ key: PeoplePerformanceComponent; label: string; value: string; score: number | null; color: string }> = [
    { key: 'hours', label: 'Working hours', value: `${Math.round(row.hours)}h of ${row.expected_hours}h expected`, score: row.hours_score, color: COMPONENTS[0].color },
    {
      key: 'attendance',
      label: 'Attendance',
      value: row.working_days ? `${row.present_days} of ${row.working_days} working days` : 'No working days in range',
      score: row.attendance_score,
      color: COMPONENTS[1].color,
    },
    {
      key: 'feedback',
      label: 'Manager feedback',
      value: row.rating != null ? `${row.rating.toFixed(1)} / 5 average rating` : 'Not rated in this period',
      score: row.feedback_score,
      color: COMPONENTS[2].color,
    },
  ];
  return (
    <div className="pf-detail">
      <div className="pf-detail-score">
        <div>
          <strong>{fmtScore(row.score)}</strong>
          <small>/ 100</small>
        </div>
        <div>
          <span className={`emp-pill ${BAND_TONE[row.band]}`}>{row.band}</span>
          <small>
            {row.rank ? `Rank ${row.rank} of ${board.kpis.scored}` : 'Not ranked'}
            {change != null ? (
              <em className={change >= 0 ? 'up' : 'down'}>
                {' '}
                · {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)} vs previous period
              </em>
            ) : null}
          </small>
        </div>
      </div>
      <ul className="pf-parts">
        {parts.map((p) => (
          <li key={p.key}>
            <div>
              <b>
                {p.label} <i>({board.weights[p.key]}%)</i>
              </b>
              <span>{p.score == null ? '—' : `${p.score.toFixed(0)}%`}</span>
            </div>
            <span className="lv-bar">
              <span style={{ width: `${p.score ?? 0}%`, background: p.color }} />
            </span>
            <small>
              {p.value} · dept avg {deptAvg[p.key] == null ? '—' : `${deptAvg[p.key]!.toFixed(0)}%`} · org avg{' '}
              {orgAvg[p.key] == null ? '—' : `${orgAvg[p.key]!.toFixed(0)}%`}
            </small>
          </li>
        ))}
      </ul>
      <div className="pf-history">
        <p>Manager feedback history</p>
        <ul>
          {history.length ? (
            history.map((h) => (
              <li key={h.name}>
                <b>
                  {fmtMonth(h.period)} · <Stars value={h.rating} size={13} /> {h.rating.toFixed(1)}
                </b>
                <span>{[h.recommendation, h.remarks].filter(Boolean).join(' · ') || 'No remarks'}</span>
              </li>
            ))
          ) : (
            <li>
              <span>{board.feedback_available ? 'No ratings recorded yet.' : 'Manager ratings are not available on this site.'}</span>
            </li>
          )}
        </ul>
      </div>
      <div className="pf-detail-actions">
        {onDownloadReport ? (
          <button type="button" className="emp-btn outline pf-rate-btn" onClick={onDownloadReport} disabled={downloading}>
            <HrmsIcon name="download" size={15} /> {downloading ? 'Preparing PDF…' : 'Download Performance Report'}
          </button>
        ) : null}
        {board.feedback_available ? (
          <button type="button" className="emp-btn primary pf-rate-btn" onClick={onRate}>
            <HrmsIcon name="career" size={15} /> Rate for {fmtMonth(board.review_period)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PerformanceManager() {
  const initial = monthRange(isoDate(new Date()).slice(0, 7));
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [board, setBoard] = useState<PeoplePerformanceBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [deptFilter, setDeptFilter] = useState('');
  const [desigFilter, setDesigFilter] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [exportOpen, setExportOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [individualId, setIndividualId] = useState('');
  const [rateFor, setRateFor] = useState<PeoplePerformanceRow | null>(null);
  const [rateDraft, setRateDraft] = useState<Draft>({ rating: 0, remarks: '', recommendation: '' });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const downloadReport = async (employeeId: string) => {
    setDownloadingReport(true);
    setSaveError(null);
    try {
      const res = await api.downloadPeoplePerformanceReport({ employee: employeeId, period: fromDate });
      const raw = res.data.data;
      const bin = atob(raw);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.file_name || `performance-report-${employeeId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNotice('Performance Report downloaded');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not download the Performance Report');
    } finally {
      setDownloadingReport(false);
    }
  };

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPeoplePerformance({ fromDate: from, toDate: to });
      setBoard(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load performance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fromDate && toDate) void load(fromDate, toDate);
  }, [load, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
  }, [deptFilter, desigFilter, bandFilter, query, perPage, fromDate, toDate, tab]);

  useEffect(() => {
    setDrafts({});
  }, [board?.review_period]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
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

  const rows = useMemo(() => board?.rows || [], [board]);
  const k = board?.kpis;
  const ranked = useMemo(() => rows.filter((r) => r.rank).sort((a, b) => (a.rank || 0) - (b.rank || 0)), [rows]);
  const spanDays = Math.round((new Date(`${toDate}T00:00:00`).getTime() - new Date(`${fromDate}T00:00:00`).getTime()) / 86400000) + 1;
  const monthFactor = spanDays > 31 ? spanDays / 30.44 : 1;
  const monthValue = (() => {
    const r = monthRange(fromDate.slice(0, 7));
    return r.from === fromDate && r.to === toDate ? fromDate.slice(0, 7) : '';
  })();
  const rangeLabel = monthValue ? fmtMonth(fromDate) : `${fmtDate(fromDate)} – ${fmtDate(toDate)}`;

  const options = useMemo(() => {
    const uniq = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
    return { departments: uniq(rows.map((r) => r.department)), designations: uniq(rows.map((r) => r.designation)) };
  }, [rows]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (!deptFilter || r.department === deptFilter) &&
            (!desigFilter || r.designation === desigFilter) &&
            (!bandFilter || r.band === bandFilter) &&
            (!q || [r.name, r.id, r.department, r.designation].some((v) => (v || '').toLowerCase().includes(q))),
        )
        .sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9) || a.name.localeCompare(b.name)),
    [rows, deptFilter, desigFilter, bandFilter, q],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = filtered.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, filtered.length);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const filtersActive = Boolean(deptFilter || desigFilter || bandFilter || query);

  const componentAvg = useCallback(
    (list: PeoplePerformanceRow[]) => ({
      hours: avgOf(list.filter((r) => r.hours_score != null).map((r) => r.hours_score as number)),
      attendance: avgOf(list.filter((r) => r.attendance_score != null).map((r) => r.attendance_score as number)),
      feedback: avgOf(list.filter((r) => r.feedback_score != null).map((r) => r.feedback_score as number)),
      score: avgOf(list.filter((r) => r.score != null).map((r) => r.score as number)),
    }),
    [],
  );
  const orgAvg = useMemo(() => componentAvg(rows), [rows, componentAvg]);

  const departments = useMemo(() => {
    const map = new Map<string, PeoplePerformanceRow[]>();
    rows.forEach((r) => {
      const key = r.department || 'Unassigned';
      map.set(key, [...(map.get(key) || []), r]);
    });
    return Array.from(map.entries())
      .map(([name, list]) => {
        const scored = list.filter((r) => r.score != null);
        const top = scored.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        return {
          name,
          employees: list.length,
          avg: avgOf(scored.map((r) => r.score as number)),
          hours: avgOf(list.map((r) => r.hours)),
          attendance: avgOf(list.filter((r) => r.attendance_pct != null).map((r) => r.attendance_pct as number)),
          rating: avgOf(list.filter((r) => r.rating != null).map((r) => r.rating as number)),
          above: scored.filter((r) => (r.score || 0) >= (board?.target || 80)).length,
          top,
        };
      })
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.name.localeCompare(b.name));
  }, [rows, board]);
  const deptComponentAvg = (dept?: string | null) => componentAvg(rows.filter((r) => (r.department || 'Unassigned') === (dept || 'Unassigned')));

  const resetFilters = () => {
    setDeptFilter('');
    setDesigFilter('');
    setBandFilter('');
    setQuery('');
    setSelected(new Set());
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });

  const openRowMenu = (id: string, anchor: HTMLElement) => {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 170;
    const top = rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.max(8, rect.right - 230) });
    setMenuFor(id);
  };

  const pickMonth = (value: string) => {
    if (!value) return;
    const r = monthRange(value);
    setFromDate(r.from);
    setToDate(r.to);
  };

  const currentReview = (id: string) => board?.reviews[id]?.find((r) => r.period === board.review_period) || null;

  const openRate = (row: PeoplePerformanceRow) => {
    setMenuFor(null);
    const cur = currentReview(row.id);
    setRateDraft({ rating: cur?.rating ? Math.round(cur.rating) : 0, remarks: cur?.remarks || '', recommendation: cur?.recommendation || '' });
    setSaveError(null);
    setRateFor(row);
  };

  const saveRating = async () => {
    if (!rateFor || !board) return;
    if (!rateDraft.rating) {
      setSaveError('Pick a rating from 1 to 5 stars.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.savePeoplePerformanceReview({
        employee: rateFor.id,
        period: board.review_period,
        rating: rateDraft.rating,
        remarks: rateDraft.remarks.trim(),
        recommendation: rateDraft.recommendation,
      });
      setNotice(`Rating saved for ${rateFor.name}`);
      setRateFor(null);
      await load(fromDate, toDate);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save rating');
    } finally {
      setSaving(false);
    }
  };

  const dirtyIds = Object.keys(drafts).filter((id) => {
    const cur = currentReview(id);
    const d = drafts[id];
    return (
      d.rating > 0 &&
      (d.rating !== Math.round(cur?.rating || 0) ||
        d.remarks.trim() !== (cur?.remarks || '') ||
        d.recommendation !== (cur?.recommendation || ''))
    );
  });

  const saveDrafts = async (ids: string[]) => {
    if (!board || !ids.length) return;
    setSaving(true);
    setSaveError(null);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await api.savePeoplePerformanceReview({
          employee: id,
          period: board.review_period,
          rating: drafts[id].rating,
          remarks: drafts[id].remarks.trim(),
          recommendation: drafts[id].recommendation,
        });
      } catch (err) {
        failed.push(`${rows.find((r) => r.id === id)?.name || id}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    setSaving(false);
    const ok = ids.length - failed.length;
    if (failed.length) setSaveError(failed.join('\n'));
    if (ok) {
      setNotice(`${ok} rating${ok === 1 ? '' : 's'} saved`);
      setDrafts((prev) => {
        const next = { ...prev };
        ids.filter((id) => !failed.some((f) => f.startsWith(rows.find((r) => r.id === id)?.name || id))).forEach((id) => delete next[id]);
        return next;
      });
      await load(fromDate, toDate);
    }
  };

  const draftOf = (row: PeoplePerformanceRow): Draft => {
    if (drafts[row.id]) return drafts[row.id];
    const cur = currentReview(row.id);
    return { rating: cur?.rating ? Math.round(cur.rating) : 0, remarks: cur?.remarks || '', recommendation: cur?.recommendation || '' };
  };
  const setDraft = (row: PeoplePerformanceRow, patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [row.id]: { ...draftOf(row), ...patch } }));

  const stamp = `${fromDate}_to_${toDate}`;
  const exportRegister = (list: PeoplePerformanceRow[]) =>
    downloadCsv(
      `performance-${stamp}.csv`,
      ['Rank', 'Employee ID', 'Employee', 'Department', 'Designation', 'Working Hours', 'Expected Hours', 'Working Days', 'Present Days', 'Attendance %', 'Manager Rating', 'Hours Score', 'Attendance Score', 'Feedback Score', 'Performance Score', 'Previous Score', 'Status'],
      list.map((r) => [r.rank, r.id, r.name, r.department, r.designation, r.hours, r.expected_hours, r.working_days, r.present_days, r.attendance_pct, r.rating, r.hours_score, r.attendance_score, r.feedback_score, r.score, r.prev_score, r.band]),
    );
  const exportDepartments = () =>
    downloadCsv(
      `performance-departments-${stamp}.csv`,
      ['Department', 'Employees', 'Average Score', 'Average Hours', 'Average Attendance %', 'Average Rating', 'Above Target', 'Top Performer'],
      departments.map((d) => [d.name, d.employees, d.avg?.toFixed(1), d.hours?.toFixed(1), d.attendance?.toFixed(1), d.rating?.toFixed(2), d.above, d.top?.name]),
    );
  const exportFeedback = () =>
    downloadCsv(
      `manager-feedback-${board?.review_period?.slice(0, 7)}.csv`,
      ['Employee ID', 'Employee', 'Department', 'Month', 'Rating', 'Recommendation', 'Remarks', 'Reviewer', 'Updated'],
      rows.flatMap((r) => (board?.reviews[r.id] || []).map((h) => [r.id, r.name, r.department, h.period.slice(0, 7), h.rating, h.recommendation, h.remarks, h.reviewer, h.modified])),
    );

  const headDelta = k && k.prev_employees ? Math.round(((k.employees - k.prev_employees) / k.prev_employees) * 100) : null;
  const scoreDelta = k && k.avg_score != null && k.prev_avg_score ? Math.round(((k.avg_score - k.prev_avg_score) / k.prev_avg_score) * 100) : null;
  const target = board?.target ?? 80;

  const kpis: Array<{ icon: string; tone: string; label: string; value: string; sub: string; up?: boolean; down?: boolean }> = [
    {
      icon: 'users',
      tone: 'teal',
      label: 'Total Employees',
      value: String(k?.employees ?? 0),
      sub: headDelta == null ? 'Active employees' : `${Math.abs(headDelta)}% vs last month`,
      up: headDelta != null && headDelta > 0,
      down: headDelta != null && headDelta < 0,
    },
    {
      icon: 'trophy',
      tone: 'amber',
      label: 'Average Performance Score',
      value: k?.avg_score != null ? `${k.avg_score.toFixed(1)} / 100` : '—',
      sub: scoreDelta == null ? 'No previous period data' : `${Math.abs(scoreDelta)}% vs previous period`,
      up: scoreDelta != null && scoreDelta >= 0,
      down: scoreDelta != null && scoreDelta < 0,
    },
    {
      icon: 'career',
      tone: 'orange',
      label: 'Top Performer',
      value: k?.top?.name || '—',
      sub: k?.top ? `${k.top.designation || 'Employee'} · ${k.top.score.toFixed(1)}` : 'No scores yet',
    },
    {
      icon: 'target',
      tone: 'blue',
      label: 'Employees Above Target',
      value: String(k?.above_target ?? 0),
      sub: `${k?.employees ? Math.round(((k.above_target || 0) / k.employees) * 100) : 0}% of employees (score ≥ ${target})`,
    },
  ];

  const breakdownTotal = COMPONENTS.reduce((s, c) => s + (board?.breakdown[c.key] || 0), 0);
  const donut = (() => {
    if (!breakdownTotal) return '#eef2f6';
    let acc = 0;
    return `conic-gradient(${COMPONENTS.map((c) => {
      const from = (acc / breakdownTotal) * 360;
      acc += board?.breakdown[c.key] || 0;
      return `${c.color} ${from}deg ${(acc / breakdownTotal) * 360}deg`;
    }).join(', ')})`;
  })();

  const viewRow = viewId ? rows.find((r) => r.id === viewId) || null : null;
  const individual = rows.find((r) => r.id === individualId) || ranked[0] || rows[0] || null;
  const reviewMonth = fmtMonth(board?.review_period);

  const filtersBar = (
    <div className="att-filters pf-filters">
      <label className="att-date">
        <span>From Date</span>
        <div>
          <HrmsIcon name="calendar" size={16} />
          <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => e.target.value && setFromDate(e.target.value)} />
        </div>
      </label>
      <span className="att-arrow">→</span>
      <label className="att-date">
        <span>To Date</span>
        <div>
          <HrmsIcon name="calendar" size={16} />
          <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => e.target.value && setToDate(e.target.value)} />
        </div>
      </label>
      <FilterDropdown label="Department" value={deptFilter} allLabel="All Departments" options={options.departments} onChange={setDeptFilter} />
      <FilterDropdown label="Designation" value={desigFilter} allLabel="All Designations" options={options.designations} onChange={setDesigFilter} />
      <FilterDropdown label="Status" value={bandFilter} allLabel="All Status" options={BANDS} onChange={setBandFilter} />
      <label className="emp-search att-search">
        <HrmsIcon name="search" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by employee name, ID or department..." aria-label="Search performance" />
      </label>
      <button className="emp-btn outline dsg-reset" type="button" onClick={resetFilters} disabled={!filtersActive && !selected.size}>
        <HrmsIcon name="reset" size={16} />
        Reset
      </button>
    </div>
  );

  const personCell = (row: PeoplePerformanceRow) => (
    <td>
      <div className="emp-person lv-person">
        <Avatar id={row.id} name={row.name} photo={row.photo} />
        <div>
          <b>{row.name}</b>
          <small>{row.id}</small>
        </div>
      </div>
    </td>
  );

  const pager = (
    <Pager
      page={currentPage}
      pages={pages}
      perPage={perPage}
      onPage={setPage}
      onPerPage={setPerPage}
      summary={`Showing ${firstShown} to ${lastShown} of ${filtered.length} employees${loading && board ? ' · refreshing…' : ''}`}
    />
  );

  const emptyRow = (cols: number) => (
    <tr>
      <td colSpan={cols} className="emp-empty">
        {loading && !board ? 'Loading performance…' : filtersActive ? 'No employees match these filters.' : 'No active employees.'}
      </td>
    </tr>
  );

  const rowActions = (row: PeoplePerformanceRow) => (
    <div className="emp-actions">
      <button type="button" title="View performance" aria-label={`View ${row.name}`} onClick={() => setViewId(row.id)}>
        <HrmsIcon name="eye" size={17} />
      </button>
      <button
        type="button"
        title="Individual performance"
        aria-label={`Individual performance for ${row.name}`}
        onClick={() => {
          setIndividualId(row.id);
          setTab('individual');
        }}
      >
        <HrmsIcon name="barChart" size={16} />
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
          <div className="emp-popover emp-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 230 }}>
            {board?.feedback_available ? (
              <button type="button" onClick={() => openRate(row)}>
                <HrmsIcon name="career" size={15} /> Rate for {reviewMonth}
              </button>
            ) : null}
            <Link to="/people/attendance" onClick={() => setMenuFor(null)}>
              <HrmsIcon name="calendar" size={15} /> Attendance register
            </Link>
            <a href={`${deskAppUrl()}/app/employee/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer" onClick={() => setMenuFor(null)}>
              <HrmsIcon name="user" size={15} /> Open employee in ERP
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(row.id);
                setNotice('Employee ID copied');
                setMenuFor(null);
              }}
            >
              <HrmsIcon name="copy" size={15} /> Copy employee ID
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const mainTable = (
    <>
      {selected.size ? (
        <div className="dsg-selbar lv-selbar">
          <span className="dsg-count">{selected.size} selected</span>
          <button type="button" className="emp-btn outline" onClick={() => exportRegister(rows.filter((r) => selected.has(r.id)))}>
            <HrmsIcon name="download" size={15} /> Export
          </button>
          <button type="button" className="att-link" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}
      <div className="emp-table-wrap">
        <table className="emp-table lv-table pf-table">
          <thead>
            <tr>
              <th className="emp-col-check">
                <input type="checkbox" checked={allOnPageSelected} onChange={togglePage} disabled={!pageRows.length} aria-label="Select all on this page" />
              </th>
              <th className="dep-col-num">#</th>
              <th>Employee</th>
              <th>Department</th>
              <th>Designation</th>
              <th className="lv-num">
                Working Hours<small>{monthFactor > 1 ? '(Avg. Monthly)' : '(In Period)'}</small>
              </th>
              <th className="lv-num">
                Attendance<small>(Present %)</small>
              </th>
              <th className="lv-num">
                Manager Feedback<small>(Avg. Rating)</small>
              </th>
              <th className="lv-num">
                Performance<small>Score</small>
              </th>
              <th className="lv-num">Rank</th>
              <th>Status</th>
              <th className="emp-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                <td className="emp-col-check">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} aria-label={`Select ${row.name}`} />
                </td>
                <td className="dep-col-num">{(currentPage - 1) * perPage + i + 1}</td>
                {personCell(row)}
                <td className="lv-dept">{row.department || '—'}</td>
                <td className="pf-desig">{row.designation || '—'}</td>
                <td className="lv-num">{Math.round(row.hours / monthFactor)}h</td>
                <td className="lv-num">{row.attendance_pct == null ? '—' : `${Math.round(row.attendance_pct)}%`}</td>
                <td className="lv-num">{row.rating == null ? <span className="lv-muted">Not rated</span> : row.rating.toFixed(1)}</td>
                <td className="lv-num">
                  <b>{fmtScore(row.score)}</b>
                </td>
                <td className="lv-num">
                  <RankBadge rank={row.rank} />
                </td>
                <td>
                  <span className={`emp-pill ${BAND_TONE[row.band]}`}>{row.band}</span>
                </td>
                <td className="emp-col-actions">{rowActions(row)}</td>
              </tr>
            ))}
            {!pageRows.length ? emptyRow(12) : null}
          </tbody>
        </table>
      </div>
      {pager}
    </>
  );

  return (
    <div className="hrms-list-page emp-page dep-page lv-page pf-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="barChart" size={28} />
          </span>
          <div>
            <h1>Performance</h1>
            <p>Employee performance based on working hours, attendance and manager feedback</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <label className="att-date pay-month pf-month">
            <div>
              <HrmsIcon name="calendar" size={16} />
              <select value={monthValue} onChange={(e) => pickMonth(e.target.value)} aria-label="Performance month">
                {!monthValue ? <option value="">Custom range</option> : null}
                {(board?.months || []).map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <div className="emp-filter-wrap">
            <button className="emp-btn primary lg emp-popover-trigger" type="button" onClick={() => setExportOpen((v) => !v)} disabled={!board} aria-expanded={exportOpen}>
              <HrmsIcon name="download" size={17} />
              Export Report
              <HrmsIcon name="chevronDown" size={15} />
            </button>
            {exportOpen ? (
              <div className="emp-popover emp-menu att-export-menu">
                <button
                  type="button"
                  onClick={() => {
                    exportRegister(filtered);
                    setExportOpen(false);
                  }}
                >
                  <HrmsIcon name="clipboard" size={15} /> Performance register ({filtered.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportDepartments();
                    setExportOpen(false);
                  }}
                >
                  <HrmsIcon name="building" size={15} /> Department summary
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportFeedback();
                    setExportOpen(false);
                  }}
                  disabled={!board?.feedback_available}
                >
                  <HrmsIcon name="career" size={15} /> Manager feedback history
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}

      <div className="att-kpis pf-kpis">
        {kpis.map((kp) => (
          <div key={kp.label} className="emp-card att-kpi">
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !board ? '…' : kp.value}</strong>
              <small className={kp.up ? 'up' : kp.down ? 'down' : ''}>
                {kp.up ? '↑ ' : kp.down ? '↓ ' : ''}
                {kp.sub}
              </small>
            </div>
          </div>
        ))}
      </div>

      <section className="emp-card att-main pf-main">
        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {(
              [
                ['overview', 'Overview'],
                ['leaderboard', 'Leaderboard'],
                ['departments', 'Department Performance'],
                ['individual', 'Individual Performance'],
                ['feedback', 'Manager Feedback'],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </nav>
        </div>

        {notice ? (
          <div className="dsg-selbar">
            <span className="emp-notice">{notice}</span>
          </div>
        ) : null}

        {tab === 'overview' ? (
          <>
            <div className="pf-cards">
              <div className="pf-card">
                <header>
                  <b>Top Performers ({monthValue ? 'This Month' : 'This Period'})</b>
                  <button type="button" className="att-link" onClick={() => setTab('leaderboard')}>
                    View All
                  </button>
                </header>
                <ul className="pf-top">
                  {ranked.slice(0, 5).map((r, i) => (
                    <li key={r.id}>
                      <span className={`pf-medal${i < 3 ? ' m' : ''}`} style={i < 3 ? { background: MEDAL[i] } : undefined}>
                        {i < 3 ? <HrmsIcon name="award" size={14} /> : i + 1}
                      </span>
                      <Avatar id={r.id} name={r.name} photo={r.photo} />
                      <div className="pf-top-name">
                        <b>{r.name}</b>
                        <small>{r.designation || r.department || 'Employee'}</small>
                      </div>
                      <span className="lv-bar">
                        <span style={{ width: `${r.score ?? 0}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                      </span>
                      <strong>{fmtScore(r.score)}</strong>
                    </li>
                  ))}
                  {!ranked.length ? <li className="lv-muted">No scores for this period yet.</li> : null}
                </ul>
              </div>

              <div className="pf-card">
                <header>
                  <b>Performance Score Breakdown</b>
                </header>
                <div className="pf-breakdown">
                  <div className="pf-donut" style={{ background: donut }} aria-hidden>
                    <span>
                      <strong>{fmtScore(k?.avg_score)}</strong>
                      <small>Avg. Score</small>
                    </span>
                  </div>
                  <ul>
                    {COMPONENTS.map((c) => (
                      <li key={c.key}>
                        <i style={{ background: c.color }} />
                        <span>
                          {c.label} ({board?.weights[c.key] ?? 0}%)
                        </span>
                        <b>{(board?.breakdown[c.key] || 0).toFixed(1)}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="pf-card">
                <header>
                  <b>Department Performance</b>
                  <button type="button" className="att-link" onClick={() => setTab('departments')}>
                    View All
                  </button>
                </header>
                <ul className="pf-dept-bars">
                  {departments.slice(0, 8).map((d, i) => (
                    <li key={d.name}>
                      <button
                        type="button"
                        title={`Show ${d.name}`}
                        onClick={() => {
                          setDeptFilter(d.name === 'Unassigned' ? '' : d.name);
                        }}
                      >
                        {d.name}
                      </button>
                      <span className="lv-bar">
                        <span style={{ width: `${d.avg ?? 0}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                      </span>
                      <b>{fmtScore(d.avg)}</b>
                    </li>
                  ))}
                  {!departments.length ? <li className="lv-muted">No departments yet.</li> : null}
                </ul>
              </div>
            </div>
            {filtersBar}
            {mainTable}
          </>
        ) : null}

        {tab === 'leaderboard' ? (
          <>
            {filtersBar}
            <div className="pf-podium">
              {filtered
                .filter((r) => r.rank)
                .slice(0, 3)
                .map((r, i) => (
                  <button key={r.id} type="button" className={`pf-podium-card p${i + 1}`} onClick={() => setViewId(r.id)}>
                    <span className="pf-podium-medal" style={{ background: MEDAL[i] }}>
                      <HrmsIcon name="award" size={18} />
                    </span>
                    <Avatar id={r.id} name={r.name} photo={r.photo} />
                    <b>{r.name}</b>
                    <small>{r.designation || r.department || 'Employee'}</small>
                    <strong>{fmtScore(r.score)}</strong>
                    <span className={`emp-pill ${BAND_TONE[r.band]}`}>{r.band}</span>
                  </button>
                ))}
            </div>
            <div className="emp-table-wrap">
              <table className="emp-table lv-table pf-table">
                <thead>
                  <tr>
                    <th className="lv-num">Rank</th>
                    <th>Employee</th>
                    <th>Department</th>
                    <th className="pf-score-col">Performance Score</th>
                    <th className="lv-num">Change</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const change = r.score != null && r.prev_score != null ? r.score - r.prev_score : null;
                    return (
                      <tr key={r.id} className="pf-click" onClick={() => setViewId(r.id)}>
                        <td className="lv-num">
                          <RankBadge rank={r.rank} />
                        </td>
                        {personCell(r)}
                        <td className="lv-dept">{r.department || '—'}</td>
                        <td className="pf-score-col">
                          <span className="pf-scorebar">
                            <span className="lv-bar">
                              <span style={{ width: `${r.score ?? 0}%`, background: r.score != null && r.score >= target ? '#16a34a' : '#1d6b78' }} />
                            </span>
                            <b>{fmtScore(r.score)}</b>
                          </span>
                        </td>
                        <td className={`lv-num pf-change ${change == null ? '' : change >= 0 ? 'up' : 'down'}`}>
                          {change == null ? '—' : `${change >= 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(1)}`}
                        </td>
                        <td>
                          <span className={`emp-pill ${BAND_TONE[r.band]}`}>{r.band}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {!pageRows.length ? emptyRow(6) : null}
                </tbody>
              </table>
            </div>
            {pager}
          </>
        ) : null}

        {tab === 'departments' ? (
          <>
            <div className="lv-stagebar">
              <span>
                Department averages for <b>{rangeLabel}</b>. Target score is <b>{target}</b>.
              </span>
              <button type="button" className="att-link" onClick={exportDepartments} disabled={!departments.length}>
                Export CSV
              </button>
            </div>
            <div className="emp-table-wrap">
              <table className="emp-table lv-table pf-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="lv-num">Employees</th>
                    <th className="pf-score-col">Average Score</th>
                    <th className="lv-num">Avg. Hours</th>
                    <th className="lv-num">Avg. Attendance</th>
                    <th className="lv-num">Avg. Rating</th>
                    <th className="lv-num">Above Target</th>
                    <th>Top Performer</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d, i) => (
                    <tr
                      key={d.name}
                      className="pf-click"
                      onClick={() => {
                        setDeptFilter(d.name === 'Unassigned' ? '' : d.name);
                        setTab('overview');
                      }}
                    >
                      <td>
                        <b>{d.name}</b>
                      </td>
                      <td className="lv-num">{d.employees}</td>
                      <td className="pf-score-col">
                        <span className="pf-scorebar">
                          <span className="lv-bar">
                            <span style={{ width: `${d.avg ?? 0}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                          </span>
                          <b>{fmtScore(d.avg)}</b>
                        </span>
                      </td>
                      <td className="lv-num">{d.hours == null ? '—' : `${Math.round(d.hours / monthFactor)}h`}</td>
                      <td className="lv-num">{d.attendance == null ? '—' : `${Math.round(d.attendance)}%`}</td>
                      <td className="lv-num">{d.rating == null ? <span className="lv-muted">—</span> : d.rating.toFixed(1)}</td>
                      <td className="lv-num att-num green">{d.above}</td>
                      <td>{d.top ? `${d.top.name} (${fmtScore(d.top.score)})` : '—'}</td>
                    </tr>
                  ))}
                  {!departments.length ? (
                    <tr>
                      <td colSpan={8} className="emp-empty">
                        No departments yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'individual' ? (
          <div className="pf-individual">
            <div className="pf-individual-pick">
              <label className="att-date">
                <span>Employee</span>
                <div>
                  <HrmsIcon name="user" size={16} />
                  <select value={individual?.id || ''} onChange={(e) => setIndividualId(e.target.value)} aria-label="Employee">
                    {rows
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.id})
                        </option>
                      ))}
                  </select>
                </div>
              </label>
              <span className="lv-side-sub">Period: {rangeLabel}</span>
            </div>
            {individual && board ? (
              <div className="pf-individual-body">
                <div className="emp-person lg">
                  <Avatar id={individual.id} name={individual.name} photo={individual.photo} />
                  <div>
                    <b>{individual.name}</b>
                    <small>
                      {individual.id} · {individual.designation || 'Employee'} · {individual.department || 'No department'}
                    </small>
                  </div>
                </div>
                <PerformanceDetail
                  row={individual}
                  board={board}
                  deptAvg={deptComponentAvg(individual.department)}
                  orgAvg={orgAvg}
                  onRate={() => openRate(individual)}
                  onDownloadReport={() => void downloadReport(individual.id)}
                  downloading={downloadingReport}
                />
              </div>
            ) : (
              <p className="emp-empty">{loading ? 'Loading…' : 'No employees.'}</p>
            )}
          </div>
        ) : null}

        {tab === 'feedback' ? (
          <>
            {board && !board.feedback_available ? (
              <div className="people-alert err">Manager ratings could not be enabled on this site. Ask an administrator to check the error log.</div>
            ) : null}
            <div className="lv-stagebar">
              <span>
                Rate each employee for <b>{reviewMonth}</b> (1 = poor, 5 = excellent). Ratings make up {board?.weights.feedback ?? 40}% of the performance score.{' '}
                {k ? `${k.rated} of ${k.employees} rated in this period.` : ''}
              </span>
              <button type="button" className="emp-btn primary" onClick={() => void saveDrafts(dirtyIds)} disabled={!dirtyIds.length || saving}>
                <HrmsIcon name="check" size={15} /> {saving ? 'Saving…' : `Save ${dirtyIds.length || ''} change${dirtyIds.length === 1 ? '' : 's'}`}
              </button>
            </div>
            {saveError && !rateFor ? <div className="people-alert err lv-pre pf-alert">{saveError}</div> : null}
            {filtersBar}
            <div className="emp-table-wrap">
              <table className="emp-table lv-table pf-table pf-feedback-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Rating ({reviewMonth})</th>
                    <th>Recommendation</th>
                    <th>Remarks</th>
                    <th>Last Updated</th>
                    <th className="emp-col-actions">Save</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const d = draftOf(r);
                    const cur = currentReview(r.id);
                    const dirty = dirtyIds.includes(r.id);
                    return (
                      <tr key={r.id} className={dirty ? 'selected' : ''}>
                        {personCell(r)}
                        <td className="lv-dept">{r.department || '—'}</td>
                        <td>
                          <Stars value={d.rating} onChange={board?.feedback_available ? (v) => setDraft(r, { rating: v }) : undefined} />
                        </td>
                        <td>
                          <select
                            className="pf-remark"
                            value={d.recommendation}
                            onChange={(e) => setDraft(r, { recommendation: e.target.value })}
                            aria-label={`Recommendation for ${r.name}`}
                            disabled={!board?.feedback_available}
                          >
                            <option value="">Choose…</option>
                            {RECOMMENDATIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="pf-remark"
                            value={d.remarks}
                            onChange={(e) => setDraft(r, { remarks: e.target.value })}
                            placeholder="Optional remark"
                            aria-label={`Remark for ${r.name}`}
                            disabled={!board?.feedback_available}
                          />
                        </td>
                        <td className="lv-date">{cur ? fmtDate(cur.modified) : <span className="lv-muted">Not rated</span>}</td>
                        <td className="emp-col-actions">
                          <div className="emp-actions">
                            <button type="button" className="lv-act ok" title="Save rating" aria-label={`Save rating for ${r.name}`} disabled={!dirty || saving} onClick={() => void saveDrafts([r.id])}>
                              <HrmsIcon name="check" size={17} strokeWidth={2.6} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!pageRows.length ? emptyRow(7) : null}
                </tbody>
              </table>
            </div>
            {pager}
          </>
        ) : null}
      </section>

      {viewRow && board ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setViewId(null)}>
          <aside className="emp-drawer lv-drawer pf-drawer" role="dialog" aria-modal="true" aria-label={`${viewRow.name} performance`} onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div className="emp-person lg">
                <Avatar id={viewRow.id} name={viewRow.name} photo={viewRow.photo} />
                <div>
                  <b>{viewRow.name}</b>
                  <small>
                    {viewRow.id} · {viewRow.designation || viewRow.department || 'Employee'}
                  </small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewId(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <p className="lv-side-sub pf-drawer-period">{rangeLabel}</p>
            <PerformanceDetail
              row={viewRow}
              board={board}
              deptAvg={deptComponentAvg(viewRow.department)}
              orgAvg={orgAvg}
              onRate={() => openRate(viewRow)}
              onDownloadReport={() => void downloadReport(viewRow.id)}
              downloading={downloadingReport}
            />
          </aside>
        </div>
      ) : null}

      {rateFor ? (
        <div className="emp-drawer-backdrop lv-modal-backdrop" role="presentation" onMouseDown={() => !saving && setRateFor(null)}>
          <div className="emp-card lv-modal" role="dialog" aria-modal="true" aria-label="Rate employee" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Rate {rateFor.name}</h3>
            <p>
              Manager feedback for <b>{reviewMonth}</b> · {rateFor.designation || rateFor.department || rateFor.id}
            </p>
            <Stars value={rateDraft.rating} onChange={(v) => setRateDraft((d) => ({ ...d, rating: v }))} size={30} />
            <label>
              <span>Recommendation</span>
              <select value={rateDraft.recommendation} onChange={(e) => setRateDraft((d) => ({ ...d, recommendation: e.target.value }))}>
                <option value="">Choose…</option>
                {RECOMMENDATIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Remarks (optional)</span>
              <textarea rows={3} value={rateDraft.remarks} onChange={(e) => setRateDraft((d) => ({ ...d, remarks: e.target.value }))} />
            </label>
            {saveError ? <div className="people-alert err lv-pre">{saveError}</div> : null}
            <div className="lv-modal-actions">
              <button type="button" className="emp-btn outline" onClick={() => setRateFor(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="emp-btn primary" onClick={() => void saveRating()} disabled={saving}>
                {saving ? 'Saving…' : 'Save rating'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PeoplePerformancePage() {
  const [isManager, setIsManager] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Unable to load performance');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="muted">Loading performance…</p>;
  if (!isManager) {
    return (
      <section className="people-panel">
        <header>
          <div>
            <h2>Performance</h2>
            <p>Your appraisal and training scorecards are in the staff performance module.</p>
          </div>
        </header>
        <Link to="/dashboard/performance">Open my performance</Link>
      </section>
    );
  }
  return <PerformanceManager />;
}
