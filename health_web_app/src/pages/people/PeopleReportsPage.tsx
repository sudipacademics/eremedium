import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type PeopleReportsBoard, type PeopleReportTab } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { Avatar, downloadCsv, FilterDropdown } from './peopleTableKit';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-reports.css';

type Tab = PeopleReportTab | 'overview';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'employee', label: 'Employee Reports' },
  { id: 'attendance', label: 'Attendance & Leave' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'recruitment', label: 'Recruitment' },
  { id: 'performance', label: 'Performance' },
  { id: 'training', label: 'Training' },
  { id: 'assets', label: 'Assets' },
  { id: 'compliance', label: 'Compliance' },
];

const CATALOG: Array<{
  id: string;
  title: string;
  blurb: string;
  tab: Tab;
  type: string;
  icon: string;
  tone: string;
  custom?: boolean;
}> = [
  { id: 'employee_directory', title: 'Employee Directory', blurb: 'Complete list of employees with contact and job details.', tab: 'employee', type: 'Employee', icon: 'users', tone: 'blue' },
  { id: 'attendance', title: 'Attendance Report', blurb: 'Daily, monthly and custom attendance reports.', tab: 'attendance', type: 'Attendance', icon: 'calendar', tone: 'green' },
  { id: 'leave', title: 'Leave Report', blurb: 'Leave balance, usage and absence reports.', tab: 'attendance', type: 'Leave', icon: 'clock', tone: 'amber' },
  { id: 'payroll', title: 'Payroll Report', blurb: 'Salary, allowances, deductions and payroll summary.', tab: 'payroll', type: 'Payroll', icon: 'wallet', tone: 'violet' },
  { id: 'recruitment', title: 'Recruitment Report', blurb: 'Open positions, applications and hiring status.', tab: 'recruitment', type: 'Recruitment', icon: 'briefcase', tone: 'pink' },
  { id: 'onboarding', title: 'Onboarding Report', blurb: 'Candidate to employee conversion and onboarding status.', tab: 'recruitment', type: 'Onboarding', icon: 'userPlus', tone: 'rose' },
  { id: 'performance', title: 'Performance Report', blurb: 'Appraisal cycles, ratings and performance analytics.', tab: 'performance', type: 'Performance', icon: 'award', tone: 'blue' },
  { id: 'training', title: 'Training Report', blurb: 'Training participation and completion status.', tab: 'training', type: 'Training', icon: 'training', tone: 'green' },
  { id: 'assets', title: 'Asset Report', blurb: 'IT and office asset allocation and return status.', tab: 'assets', type: 'Assets', icon: 'laptop', tone: 'violet' },
  { id: 'compliance', title: 'Compliance Report', blurb: 'Policy acknowledgement, certifications and mandatory training status.', tab: 'compliance', type: 'Compliance', icon: 'shield', tone: 'rose' },
  { id: 'turnover', title: 'Turnover Report', blurb: 'Resignations, exits and turnover analytics.', tab: 'compliance', type: 'Turnover', icon: 'refresh', tone: 'orange' },
  { id: 'custom', title: 'Custom Report', blurb: 'Create and download customized reports.', tab: 'overview', type: 'Custom', icon: 'plus', tone: 'cyan', custom: true },
];

const DEPT_COLOR = ['#22d3ee', '#fb923c', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#94a3b8'];
const DESIG_COLOR = ['#38bdf8', '#4ade80', '#22d3ee', '#c084fc', '#f9a8d4', '#fb7185'];

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
function pad(n: number) {
  return String(n).padStart(2, '0');
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtRange(a?: string | null, b?: string | null) {
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function PeopleReportsPage({ preview }: { preview?: PeopleReportsBoard }) {
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
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load reports');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading reports…</p>;
  return <ReportsDesk preview={preview} manager={Boolean(isManager)} />;
}

function ReportsDesk({ preview, manager }: { preview?: PeopleReportsBoard; manager: boolean }) {
  const monthStart = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const monthEnd = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  const [board, setBoard] = useState<PeopleReportsBoard | null>(preview || null);
  const [from, setFrom] = useState(preview?.from_date || monthStart);
  const [to, setTo] = useState(preview?.to_date || monthEnd);
  const [dept, setDept] = useState('');
  const [emp, setEmp] = useState('');
  const [mgr, setMgr] = useState('');
  const [rtype, setRtype] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customType, setCustomType] = useState('Employee');
  const [menuId, setMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleReports({ from_date: from, to_date: to, department: dept });
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load reports'));
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
    { label: 'Average Attendance', value: k?.attendance_pct ?? 0, delta: k?.attendance_delta, icon: 'calendar', tone: 'violet', suffix: '%' },
    { label: 'Total Leave Taken', value: k?.leave_taken ?? 0, delta: k?.leave_delta, icon: 'clock', tone: 'amber' },
  ];

  const cards = useMemo(() => {
    return CATALOG.filter((c) => {
      if (tab !== 'overview' && c.tab !== tab) return false;
      if (rtype && c.type !== rtype) return false;
      return true;
    });
  }, [tab, rtype]);

  const recent = useMemo(() => {
    return (board?.recent || []).filter((r) => {
      if (rtype && r.report_type !== rtype) return false;
      if (dept && r.department && r.department !== 'All Departments' && r.department !== dept) return false;
      if (mgr && !(r.generated_by || '').toLowerCase().includes(mgr.toLowerCase())) return false;
      if (emp && !(r.title || '').toLowerCase().includes(emp.toLowerCase())) return false;
      if (tab !== 'overview') {
        const ids = CATALOG.filter((c) => c.tab === tab).map((c) => c.type);
        if (!ids.includes(r.report_type)) return false;
      }
      return true;
    });
  }, [board, rtype, dept, mgr, emp, tab]);

  const depts = board?.departments?.length ? board.departments : ['Sales', 'Marketing', 'Operations', 'HR', 'IT', 'Finance'];
  const emps = (board?.employees || []).map((e) => e.name);
  const mgrs = (board?.managers || []).map((m) => m.name);
  const typeOpts = [...new Set(CATALOG.map((c) => c.type))];

  async function pull(report: string) {
    if (preview) {
      const card = CATALOG.find((c) => c.id === report);
      downloadCsv(`${card?.title || report}.csv`, ['Field', 'Value'], [
        ['Report', card?.title || report],
        ['From', from],
        ['To', to],
        ['Department', dept || 'All Departments'],
      ]);
      setNotice('Report downloaded');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.exportPeopleReport(report, { from_date: from, to_date: to, department: dept });
      downloadCsv(`${res.data.title}.csv`, res.data.header, res.data.rows);
      setNotice('Report downloaded');
      await load();
    } catch (e) {
      setError(errMsg(e, 'Unable to export report'));
    } finally {
      setBusy(false);
    }
  }

  function exportDash() {
    downloadCsv(
      'HR-Dashboard.csv',
      ['Metric', 'Value'],
      kpis.map((kp) => [kp.label, `${kp.value}${kp.suffix || ''}`]),
    );
    setNotice('Dashboard exported');
  }

  const trend = board?.headcount_trend?.length
    ? board.headcount_trend
    : ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label, i) => ({
        label,
        value: 220 + i * 55,
      }));
  const tMax = Math.max(1000, ...trend.map((t) => t.value));
  const pts = trend
    .map((t, i) => {
      const x = trend.length === 1 ? 50 : (i / (trend.length - 1)) * 100;
      const y = 96 - (t.value / tMax) * 80;
      return `${x},${y}`;
    })
    .join(' ');
  const deptRows = board?.by_department?.length ? board.by_department : [];
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
  const desigRows = board?.by_designation?.length ? board.by_designation : [];
  const dMax = Math.max(1, ...desigRows.map((d) => d.count));

  return (
    <div className="hrms-list-page emp-page dep-page lv-page rp-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="reports" size={28} />
          </span>
          <div>
            <h1>Reports</h1>
            <p>Access and download comprehensive HR reports. Filter by date, department, employee, manager and more.</p>
          </div>
        </div>
        {manager ? (
          <div className="dep-head-actions">
            <button type="button" className="emp-btn primary lg" onClick={exportDash} disabled={busy}>
              <HrmsIcon name="download" size={17} />
              Export Dashboard
            </button>
          </div>
        ) : null}
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="att-kpis rp-kpis">
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
                {(kp.delta || 0) >= 0 ? '↑' : '↓'} {Math.abs(kp.delta || 0)}% vs last month
              </small>
            </div>
          </div>
        ))}
      </div>

      <section className="emp-card att-main">
        <div className="att-filters rp-filters">
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
            <span>Report Type</span>
            <FilterDropdown value={rtype} allLabel="All Report Types" options={typeOpts} onChange={setRtype} label="Report Type" />
          </div>
          <button type="button" className="emp-btn primary" onClick={() => void load()}>
            <HrmsIcon name="filter" size={16} /> Apply Filters
          </button>
          <button
            type="button"
            className="emp-btn"
            onClick={() => {
              setFrom(preview?.from_date || monthStart);
              setTo(preview?.to_date || monthEnd);
              setDept('');
              setEmp('');
              setMgr('');
              setRtype('');
            }}
          >
            <HrmsIcon name="reset" size={16} /> Reset
          </button>
        </div>

        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'overview' ? (
          <div className="rp-charts">
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
                    {trend.map((t, i) => {
                      const x = trend.length === 1 ? 50 : (i / (trend.length - 1)) * 100;
                      const y = 96 - (t.value / tMax) * 80;
                      return <circle key={t.label} cx={x} cy={y} r="1.4" fill="#38bdf8" />;
                    })}
                  </svg>
                  <div className="rp-x">
                    {trend.map((t) => (
                      <span key={t.label}>{t.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            </section>
            <section className="rp-chart">
              <header>Department-wise Headcount</header>
              <div className="rp-source">
                <div className="rp-donut" style={{ background: `conic-gradient(${donut})` }}>
                  <span>
                    <strong>{(k?.employees || deptTotal).toLocaleString()}</strong>
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
            <section className="rp-chart">
              <header>
                Employee Distribution
                <span>By Designation</span>
              </header>
              <div className="rp-bars">
                {desigRows.map((d, i) => (
                  <div key={d.name}>
                    <i style={{ height: `${Math.max(8, Math.round((d.count / dMax) * 100))}%`, background: DESIG_COLOR[i % DESIG_COLOR.length] }} />
                    <small>{d.count}</small>
                    <em>{d.name}</em>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        <div className="rp-catalog-head">Available Reports</div>
        <div className="rp-catalog">
          {cards.map((c) => (
            <article key={c.id} className="rp-card">
              <span className={`rp-ico ${c.tone}`}>
                <HrmsIcon name={c.icon} size={18} />
              </span>
              <div>
                <b>{c.title}</b>
                <p>{c.blurb}</p>
                <div className="rp-card-acts">
                  {c.custom ? (
                    <button type="button" className="rp-link" onClick={() => setCustomOpen(true)}>
                      Create Report
                    </button>
                  ) : (
                    <>
                      <button type="button" className="rp-link" onClick={() => void pull(c.id)} disabled={busy || !manager}>
                        View
                      </button>
                      <button type="button" className="rp-link" onClick={() => void pull(c.id)} disabled={busy || !manager}>
                        Download
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="rp-recent-head">
          Recent Reports
          <button type="button" className="rp-link" onClick={() => setTab('overview')}>
            View All
          </button>
        </div>
        <div className="emp-table-wrap">
          <table className="emp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Report Name</th>
                <th>Type</th>
                <th>Date Range</th>
                <th>Department</th>
                <th>Generated By</th>
                <th>Generated On</th>
                <th>Status</th>
                <th className="emp-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td className="emp-empty" colSpan={9}>
                    No reports generated in this view.
                  </td>
                </tr>
              ) : (
                recent.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>
                      <b>{r.title}</b>
                    </td>
                    <td>{r.report_type}</td>
                    <td>{fmtRange(r.date_from, r.date_to)}</td>
                    <td>{r.department}</td>
                    <td>
                      <div className="emp-person lv-person">
                        <Avatar id={r.generated_by || 'hr'} name={r.generated_by || 'HR Manager'} />
                        <b>{r.generated_by || 'HR Manager'}</b>
                      </div>
                    </td>
                    <td>{r.generated_on}</td>
                    <td>
                      <span className={`emp-pill ${r.status === 'Completed' ? 'green' : 'rose'}`}>{r.status || 'Completed'}</span>
                    </td>
                    <td className="emp-col-actions">
                      <div className="emp-actions">
                        <button type="button" aria-label="View" disabled={!manager} onClick={() => void pull(r.report_type.toLowerCase())}>
                          <HrmsIcon name="eye" size={15} />
                        </button>
                        <button type="button" aria-label="Download" disabled={!manager} onClick={() => void pull(r.report_type.toLowerCase())}>
                          <HrmsIcon name="download" size={15} />
                        </button>
                        <div className="emp-filter-wrap">
                          <button type="button" aria-label="More" onClick={() => setMenuId(menuId === r.id ? null : r.id)}>
                            <HrmsIcon name="moreV" size={15} />
                          </button>
                          {menuId === r.id ? (
                            <div className="emp-popover emp-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuId(null);
                                  void pull(r.report_type.toLowerCase());
                                }}
                              >
                                Download again
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {customOpen ? (
        <div className="rp-modal-bg" onClick={() => setCustomOpen(false)} role="presentation">
          <div className="emp-card rp-modal" role="dialog" aria-labelledby="rp-custom-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="rp-custom-title">Custom Report</h2>
            <label>
              Report type
              <select value={customType} onChange={(e) => setCustomType(e.target.value)}>
                {typeOpts.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <footer>
              <button type="button" className="emp-btn" onClick={() => setCustomOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="emp-btn primary"
                disabled={busy || !manager}
                onClick={() => {
                  setCustomOpen(false);
                  void pull(customType.toLowerCase());
                }}
              >
                Create Report
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
