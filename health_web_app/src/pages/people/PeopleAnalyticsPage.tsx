import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type PeopleAnalyticsBoard, type PeopleAnalyticsTab } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { downloadCsv, FilterDropdown } from './peopleTableKit';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-reports.css';
import './people-analytics.css';

const TABS: Array<{ id: PeopleAnalyticsTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'headcount', label: 'Headcount & Attrition' },
  { id: 'attendance', label: 'Attendance & Leave' },
  { id: 'recruitment', label: 'Recruitment' },
  { id: 'performance', label: 'Performance' },
  { id: 'training', label: 'Training' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'assets', label: 'Assets' },
  { id: 'diversity', label: 'Diversity & Inclusion' },
  { id: 'custom', label: 'Custom Analytics' },
];

const FOCUS: Array<{ id: string; tab: PeopleAnalyticsTab; label: string }> = [
  { id: '', tab: 'overview', label: 'All Metrics' },
  { id: 'Headcount', tab: 'headcount', label: 'Headcount' },
  { id: 'Attendance', tab: 'attendance', label: 'Attendance' },
  { id: 'Leave', tab: 'attendance', label: 'Leave' },
  { id: 'Recruitment', tab: 'recruitment', label: 'Recruitment' },
  { id: 'Performance', tab: 'performance', label: 'Performance' },
  { id: 'Training', tab: 'training', label: 'Training' },
  { id: 'Payroll', tab: 'payroll', label: 'Payroll' },
  { id: 'Assets', tab: 'assets', label: 'Assets' },
  { id: 'Diversity', tab: 'diversity', label: 'Diversity' },
];

const DEPT_COLOR = ['#22d3ee', '#fb923c', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#94a3b8'];
const MIX_COLOR = ['#22d3ee', '#fb923c', '#f472b6', '#a78bfa'];
const LEAVE_KEYS = ['Casual', 'Sick', 'Earned', 'Other'] as const;
const LEAVE_COLOR = { Casual: '#22d3ee', Sick: '#a78bfa', Earned: '#4ade80', Other: '#fb7185' };
const TENURE_COLOR = ['#22d3ee', '#4ade80', '#2dd4bf', '#c084fc', '#fb7185'];
const EXPORTS = [
  { id: 'overview', label: 'Overview KPIs' },
  { id: 'headcount', label: 'Headcount trend' },
  { id: 'attendance', label: 'Attendance mix' },
  { id: 'funnel', label: 'Recruitment funnel' },
  { id: 'insights', label: 'Insights' },
];

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}
function yearEnd() {
  return `${new Date().getFullYear()}-12-31`;
}
function show(tab: PeopleAnalyticsTab, ids: PeopleAnalyticsTab[]) {
  return tab === 'overview' || ids.includes(tab);
}
function Stars({ n }: { n: number }) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span className="ax-stars" aria-label={`${n} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < full ? 'on' : ''} />
      ))}
    </span>
  );
}

export function PeopleAnalyticsPage({ preview }: { preview?: PeopleAnalyticsBoard }) {
  const [isManager, setIsManager] = useState<boolean | null>(preview ? true : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load analytics');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading analytics…</p>;
  return <AnalyticsDesk preview={preview} manager={Boolean(isManager)} />;
}

function AnalyticsDesk({ preview, manager }: { preview?: PeopleAnalyticsBoard; manager: boolean }) {
  const [board, setBoard] = useState<PeopleAnalyticsBoard | null>(preview || null);
  const [from, setFrom] = useState(preview?.from_date || yearStart());
  const [to, setTo] = useState(preview?.to_date || yearEnd());
  const [dept, setDept] = useState('');
  const [emp, setEmp] = useState('');
  const [mgr, setMgr] = useState('');
  const [focus, setFocus] = useState('');
  const [tab, setTab] = useState<PeopleAnalyticsTab>('overview');
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [donutDept, setDonutDept] = useState('');
  const [customPick, setCustomPick] = useState<string[]>(['headcount', 'attendance', 'funnel']);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleAnalytics({ from_date: from, to_date: to, department: dept });
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load analytics'));
    } finally {
      setLoading(false);
    }
  }, [preview, from, to, dept]);

  useEffect(() => {
    void load();
  }, [load]);

  const k = board?.kpis;
  const kpis = [
    { label: 'Total Employees', value: k?.employees ?? 0, delta: k?.employees_delta, icon: 'users', tone: 'blue' },
    { label: 'New Joiners', value: k?.joiners ?? 0, delta: k?.joiners_delta, icon: 'userPlus', tone: 'green' },
    { label: 'Exits', value: k?.exits ?? 0, delta: k?.exits_delta, icon: 'userMinus', tone: 'rose' },
    { label: 'Avg. Attendance', value: k?.attendance_pct ?? 0, delta: k?.attendance_delta, icon: 'calendar', tone: 'violet', suffix: '%' },
    { label: 'Avg. Leave Taken', value: k?.leave_avg ?? 0, delta: k?.leave_delta, icon: 'clock', tone: 'amber', suffix: ' Days' },
    { label: 'Avg. Performance', value: k?.performance_avg ?? 0, delta: k?.performance_delta, icon: 'award', tone: 'green', suffix: ' / 5' },
  ];

  const depts = board?.departments?.length ? board.departments : ['Sales', 'Marketing', 'Operations', 'HR', 'IT', 'Finance'];
  const emps = (board?.employees || []).map((e) => e.name);
  const mgrs = (board?.managers || []).map((m) => m.name);

  async function pull(kind: string) {
    if (preview) {
      downloadCsv(`Analytics-${kind}.csv`, ['Metric', 'Value'], kpis.map((kp) => [kp.label, `${kp.value}${kp.suffix || ''}`]));
      setNotice('Analytics exported');
      setExportOpen(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.exportPeopleAnalytics(kind, { from_date: from, to_date: to, department: dept });
      downloadCsv(`${res.data.title}.csv`, res.data.header, res.data.rows);
      setNotice('Analytics exported');
    } catch (e) {
      setError(errMsg(e, 'Unable to export analytics'));
    } finally {
      setBusy(false);
      setExportOpen(false);
    }
  }

  const trend = board?.headcount_trend?.length ? board.headcount_trend : [];
  const tMax = Math.max(1000, ...trend.map((t) => t.value));
  const pts = trend
    .map((t, i) => {
      const x = trend.length === 1 ? 50 : (i / (trend.length - 1)) * 100;
      const y = 96 - (t.value / tMax) * 80;
      return `${x},${y}`;
    })
    .join(' ');
  const deptRows = useMemo(() => {
    const rows = board?.by_department || [];
    if (!donutDept) return rows;
    return rows.filter((r) => r.name === donutDept);
  }, [board, donutDept]);
  const deptTotal = deptRows.reduce((s, r) => s + r.count, 0) || 1;
  let acc = 0;
  const donut = deptRows.length
    ? deptRows
        .map((r, i) => {
          const pct = (r.count / deptTotal) * 100;
          const part = `${DEPT_COLOR[i % DEPT_COLOR.length]} ${acc}% ${acc + pct}%`;
          acc += pct;
          return part;
        })
        .join(', ')
    : '#e2e8f0 0% 100%';
  const mix = board?.attendance_mix || [];
  let mixAcc = 0;
  const mixDonut = mix.length
    ? mix
        .map((r, i) => {
          const part = `${MIX_COLOR[i % MIX_COLOR.length]} ${mixAcc}% ${mixAcc + r.pct}%`;
          mixAcc += r.pct;
          return part;
        })
        .join(', ')
    : '#e2e8f0 0% 100%';
  const attCenter = mix.find((m) => m.name === 'Present')?.pct ?? k?.attendance_pct ?? 0;
  const jx = board?.joiners_exits || [];
  const jxMax = Math.max(40, ...jx.map((r) => Math.max(r.joiners, r.exits)));
  const leave = board?.leave_trend || [];
  const leaveMax = Math.max(200, ...leave.map((r) => LEAVE_KEYS.reduce((s, key) => s + (r[key] || 0), 0)));
  const tenure = board?.tenure || [];
  const tenMax = Math.max(1, ...tenure.map((t) => t.count));
  const tenTotal = tenure.reduce((s, t) => s + t.count, 0) || 1;
  const funnel = board?.funnel || [];
  const funnelMax = Math.max(1, funnel[0]?.value || 1);
  const insights = board?.insights || [];

  return (
    <div className="hrms-list-page emp-page dep-page lv-page rp-page ax-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="analytics" size={28} />
          </span>
          <div>
            <h1>Analytics</h1>
            <p>Workforce insights and trends to help you make data-driven decisions.</p>
          </div>
        </div>
        {manager ? (
          <div className="dep-head-actions">
            <div className="emp-filter-wrap">
              <button type="button" className="emp-btn primary lg emp-popover-trigger" onClick={() => setExportOpen((v) => !v)} disabled={busy} aria-expanded={exportOpen}>
                <HrmsIcon name="download" size={17} />
                Export Analytics
                <HrmsIcon name="chevronDown" size={15} />
              </button>
              {exportOpen ? (
                <div className="emp-popover emp-menu att-export-menu">
                  {EXPORTS.map((x) => (
                    <button key={x.id} type="button" onClick={() => void pull(x.id)}>
                      {x.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <section className="emp-card att-main">
        <div className="att-filters rp-filters ax-filters">
          <label className="rp-dates">
            Date Range
            <span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <i>–</i>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </span>
          </label>
          <div className="rp-fld">
            <span>Department</span>
            <FilterDropdown value={dept} allLabel="All Departments" options={depts} onChange={setDept} label="Department" />
          </div>
          <div className="rp-fld">
            <span>Employee</span>
            <FilterDropdown value={emp} allLabel="All Employees" options={emps.length ? emps : ['All Employees']} onChange={setEmp} label="Employee" />
          </div>
          <div className="rp-fld">
            <span>Manager</span>
            <FilterDropdown value={mgr} allLabel="All Managers" options={mgrs.length ? mgrs : ['HR Manager']} onChange={setMgr} label="Manager" />
          </div>
          <div className="rp-fld">
            <span>Report Focus</span>
            <FilterDropdown value={focus} allLabel="All Metrics" options={FOCUS.filter((f) => f.id).map((f) => f.id)} onChange={setFocus} label="Report Focus" />
          </div>
          <button
            type="button"
            className="emp-btn primary"
            onClick={() => {
              const hit = FOCUS.find((f) => f.id === focus);
              if (hit) setTab(hit.tab);
              void load();
            }}
          >
            <HrmsIcon name="filter" size={16} /> Apply Filters
          </button>
          <button
            type="button"
            className="emp-btn"
            onClick={() => {
              setFrom(preview?.from_date || yearStart());
              setTo(preview?.to_date || yearEnd());
              setDept('');
              setEmp('');
              setMgr('');
              setFocus('');
              setTab('overview');
              setDonutDept('');
            }}
          >
            <HrmsIcon name="reset" size={16} /> Reset
          </button>
        </div>
      </section>

      <div className="att-kpis ax-kpis">
        {kpis.map((kp) => (
          <div key={kp.label} className="emp-card att-kpi">
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>
                {loading && !board ? '…' : kp.value.toLocaleString()}
                {kp.suffix || ''}
              </strong>
              <small className={(kp.delta || 0) >= 0 ? 'up' : 'down'}>
                {(kp.delta || 0) >= 0 ? '↑' : '↓'} {Math.abs(kp.delta || 0)}% vs last year
              </small>
            </div>
          </div>
        ))}
      </div>

      <section className="emp-card att-main">
        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'custom' ? (
          <div className="ax-custom">
            <h3>Custom Analytics</h3>
            <p>Pick the slices you want, then export a CSV for the selected date range.</p>
            <div className="ax-checks">
              {EXPORTS.map((x) => (
                <label key={x.id}>
                  <input
                    type="checkbox"
                    checked={customPick.includes(x.id)}
                    onChange={() => setCustomPick((cur) => (cur.includes(x.id) ? cur.filter((i) => i !== x.id) : [...cur, x.id]))}
                  />
                  {x.label}
                </label>
              ))}
            </div>
            <button type="button" className="emp-btn primary" disabled={!manager || busy || !customPick.length} onClick={() => void pull(customPick[0] || 'overview')}>
              Export selected
            </button>
          </div>
        ) : (
          <>
            <div className="ax-grid">
              {show(tab, ['headcount']) ? (
                <section className="rp-chart">
                  <header>
                    Headcount Trend
                    <span>Monthly</span>
                  </header>
                  <div className="rp-line-wrap">
                    <div className="rp-y" aria-hidden>
                      <span>1,000</span>
                      <span>800</span>
                      <span>600</span>
                      <span>400</span>
                      <span>200</span>
                      <span>0</span>
                    </div>
                    <div>
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="rp-line" aria-hidden>
                        <line x1="0" y1="16" x2="100" y2="16" />
                        <line x1="0" y1="32" x2="100" y2="32" />
                        <line x1="0" y1="48" x2="100" y2="48" />
                        <line x1="0" y1="64" x2="100" y2="64" />
                        <line x1="0" y1="80" x2="100" y2="80" />
                        <line x1="0" y1="96" x2="100" y2="96" />
                        <polyline fill="none" stroke="#38bdf8" strokeWidth="1.8" points={pts} />
                      </svg>
                      <div className="rp-x">
                        {trend.map((t) => (
                          <span key={t.label}>{t.label}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {show(tab, ['headcount']) ? (
                <section className="rp-chart">
                  <header>
                    Department-wise Headcount
                    <label className="ax-mini">
                      <select value={donutDept} onChange={(e) => setDonutDept(e.target.value)} aria-label="Department filter">
                        <option value="">All Departments</option>
                        {depts.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                  </header>
                  <div className="rp-source">
                    <div className="rp-donut ax-donut-lg" style={{ background: `conic-gradient(${donut})` }}>
                      <span>
                        <strong>{(donutDept ? deptTotal : k?.employees || deptTotal).toLocaleString()}</strong>
                        <small>Employees</small>
                      </span>
                    </div>
                    <ul>
                      {deptRows.map((r, i) => (
                        <li key={r.name}>
                          <i className="rp-dot" style={{ background: DEPT_COLOR[i % DEPT_COLOR.length] }} />
                          {r.name}
                          <span>
                            {r.count} ({Math.round((r.count / deptTotal) * 100)}%)
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ) : null}

              {show(tab, ['headcount']) ? (
                <section className="rp-chart">
                  <header>
                    Joiners vs Exits
                    <span className="ax-legend">
                      <i className="rp-dot" style={{ background: '#4ade80' }} /> Joiners
                      <i className="rp-dot" style={{ background: '#fb7185' }} /> Exits
                      <em>Monthly</em>
                    </span>
                  </header>
                  <div className="ax-group">
                    {jx.map((r) => (
                      <div key={r.label}>
                        <b>
                          <i style={{ height: `${Math.max(6, Math.round((r.joiners / jxMax) * 100))}%`, background: '#4ade80' }} />
                          <i style={{ height: `${Math.max(6, Math.round((r.exits / jxMax) * 100))}%`, background: '#fb7185' }} />
                        </b>
                        <em>{r.label}</em>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {show(tab, ['attendance']) ? (
                <section className="rp-chart">
                  <header>
                    Attendance Rate
                    <span>This Year</span>
                  </header>
                  <div className="rp-source">
                    <div className="rp-donut ax-donut-lg" style={{ background: `conic-gradient(${mixDonut})` }}>
                      <span>
                        <strong>{attCenter}%</strong>
                        <small>Avg Attendance</small>
                      </span>
                    </div>
                    <ul>
                      {mix.map((r, i) => (
                        <li key={r.name}>
                          <i className="rp-dot" style={{ background: MIX_COLOR[i % MIX_COLOR.length] }} />
                          {r.name}
                          <span>{r.pct}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ) : null}

              {show(tab, ['attendance']) ? (
                <section className="rp-chart">
                  <header>
                    Leave Trend
                    <span className="ax-legend">
                      {LEAVE_KEYS.map((key) => (
                        <span key={key}>
                          <i className="rp-dot" style={{ background: LEAVE_COLOR[key] }} /> {key}
                        </span>
                      ))}
                      <em>Monthly</em>
                    </span>
                  </header>
                  <div className="ax-stack">
                    {leave.map((r) => {
                      const tot = LEAVE_KEYS.reduce((s, key) => s + (r[key] || 0), 0) || 1;
                      return (
                        <div key={r.label}>
                          <b style={{ height: `${Math.max(12, Math.round((tot / leaveMax) * 100))}%` }}>
                            {LEAVE_KEYS.map((key) => (
                              <i key={key} style={{ height: `${Math.max(4, Math.round(((r[key] || 0) / tot) * 100))}%`, background: LEAVE_COLOR[key] }} />
                            ))}
                          </b>
                          <em>{r.label}</em>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {show(tab, ['headcount']) ? (
                <section className="rp-chart">
                  <header>Employees by Tenure</header>
                  <ul className="ax-tenure">
                    {tenure.map((t, i) => (
                      <li key={t.name}>
                        <span>{t.name}</span>
                        <i style={{ width: `${Math.max(8, Math.round((t.count / tenMax) * 100))}%`, background: TENURE_COLOR[i % TENURE_COLOR.length] }} />
                        <em>
                          {t.count} ({Math.round((t.count / tenTotal) * 100)}%)
                        </em>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {show(tab, ['performance']) ? (
                <section className="rp-chart">
                  <header>Top Performing Departments</header>
                  <table className="ax-table">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Avg. Rating</th>
                        <th>Employees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(board?.top_departments || []).map((d, i) => (
                        <tr key={d.name}>
                          <td>
                            <i className="rp-dot" style={{ background: DEPT_COLOR[i % DEPT_COLOR.length] }} /> {d.name}
                          </td>
                          <td>
                            <Stars n={d.rating} /> {d.rating.toFixed(1)}
                          </td>
                          <td>{d.employees}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}

              {show(tab, ['recruitment']) ? (
                <section className="rp-chart">
                  <header>Recruitment Funnel</header>
                  <div className="ax-funnel-wrap">
                    <div className="ax-funnel">
                      {funnel.map((f) => (
                        <b key={f.name} style={{ width: `${Math.max(28, Math.round((f.value / funnelMax) * 100))}%`, background: f.color }}>
                          {f.value.toLocaleString()}
                        </b>
                      ))}
                    </div>
                    <ul>
                      {funnel.map((f) => (
                        <li key={f.name}>
                          <i className="rp-dot" style={{ background: f.color }} />
                          {f.name}
                          <span>{f.value.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ) : null}

              {show(tab, ['performance']) ? (
                <section className="rp-chart">
                  <header>
                    Recent Trends & Insights
                    <span>This Year</span>
                  </header>
                  <ul className="ax-insights">
                    {insights.map((n) => (
                      <li key={n.text}>
                        <span className={`ax-ico ${n.tone}`}>
                          <HrmsIcon name={n.icon} size={15} />
                        </span>
                        {n.text}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {tab === 'training' ? (
                <section className="rp-chart">
                  <header>Training status</header>
                  <ul className="ax-tenure">
                    {(board?.training || []).length ? (
                      (board?.training || []).map((t, i) => (
                        <li key={t.name}>
                          <span>{t.name}</span>
                          <i style={{ width: `${Math.max(8, t.count)}%`, background: TENURE_COLOR[i % TENURE_COLOR.length] }} />
                          <em>{t.count}</em>
                        </li>
                      ))
                    ) : (
                      <li>No training assignments in this range.</li>
                    )}
                  </ul>
                </section>
              ) : null}

              {tab === 'payroll' ? (
                <section className="rp-chart">
                  <header>Payroll snapshot</header>
                  <p className="ax-plain">
                    {board?.payroll.slips || 0} salary slips · net {Number(board?.payroll.net || 0).toLocaleString()}
                  </p>
                </section>
              ) : null}

              {tab === 'assets' ? (
                <section className="rp-chart">
                  <header>Asset allocation</header>
                  <p className="ax-plain">
                    {board?.assets.assigned || 0} assigned of {board?.assets.total || 0} assets
                  </p>
                </section>
              ) : null}

              {tab === 'diversity' ? (
                <section className="rp-chart">
                  <header>Workforce diversity</header>
                  <ul className="ax-tenure">
                    {(board?.diversity || []).length ? (
                      (board?.diversity || []).map((d, i) => (
                        <li key={d.name}>
                          <span>{d.name}</span>
                          <i style={{ width: `${Math.max(8, d.count)}%`, background: DEPT_COLOR[i % DEPT_COLOR.length] }} />
                          <em>{d.count}</em>
                        </li>
                      ))
                    ) : (
                      <li>Gender is not recorded on employee records yet.</li>
                    )}
                  </ul>
                </section>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
