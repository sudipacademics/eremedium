import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PeopleHrmsDashboard } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import './people-hrms-home.css';

type Org = NonNullable<PeopleHrmsDashboard['org']>;

const DEPT_COLORS = [
  '#2563eb',
  '#8b5cf6',
  '#f59e0b',
  '#14b8a6',
  '#f472b6',
  '#10b981',
  '#0ea5e9',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#6366f1',
  '#84cc16',
];

const ATT_COLORS = {
  present: '#16a34a',
  absent: '#ef4444',
  leave: '#2563eb',
  halfDay: '#f59e0b',
};

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function percent(part: number, total: number) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function fmtPct(value: number) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function parseDate(raw?: string) {
  if (!raw) return null;
  const d = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : `${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDay(d: Date) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function niceStep(max: number) {
  const raw = Math.max(1, max) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) || 10;
  return Math.max(1, Math.ceil(unit * pow));
}

function Ring({ value, color }: { value: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const shown = value >= 10 ? Math.round(value) : value;
  return (
    <div
      className="hh-ring"
      style={{ background: `conic-gradient(${color} ${clamped * 3.6}deg, #eef2f6 0deg)` }}
      role="img"
      aria-label={fmtPct(value)}
    >
      <span style={{ color }}>{fmtPct(shown)}</span>
    </div>
  );
}

function upcomingEvents(today: Date) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const start = new Date(y, m, today.getDate());

  const monday = new Date(start);
  monday.setDate(start.getDate() + ((8 - start.getDay()) % 7));

  const lastWorkingDay = (year: number, month: number) => {
    const d = new Date(year, month + 1, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d;
  };
  let payroll = lastWorkingDay(y, m);
  if (payroll < start) payroll = lastWorkingDay(y, m + 1);

  let review = new Date(y, m, 25);
  if (review < start) review = new Date(y, m + 1, 25);

  const slips = new Date(y, m + 1, 1);

  return [
    { title: 'Team Meeting', sub: '11:00 AM – 12:00 PM', date: monday, tag: 'This week' },
    { title: 'Performance Review Window', sub: 'All Departments', date: review, tag: 'This month' },
    { title: 'Payroll Processing', sub: 'HR Team', date: payroll, tag: 'End of month' },
    { title: 'Salary Slips Release', sub: 'All Employees', date: slips, tag: 'Next month' },
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function TeamIllustration() {
  return (
    <svg className="hh-hero-art" viewBox="0 0 260 120" aria-hidden focusable="false">
      <rect x="150" y="18" width="90" height="62" rx="8" fill="#dbeafe" />
      <rect x="160" y="50" width="10" height="22" rx="2" fill="#93c5fd" />
      <rect x="176" y="40" width="10" height="32" rx="2" fill="#60a5fa" />
      <rect x="192" y="30" width="10" height="42" rx="2" fill="#3b82f6" />
      <rect x="208" y="44" width="10" height="28" rx="2" fill="#93c5fd" />
      <ellipse cx="130" cy="112" rx="120" ry="6" fill="#e2e8f0" />
      <path d="M22 112c0-18 8-30 20-30s20 12 20 30z" fill="#14b8a6" />
      <path d="M30 112c-2-14 3-24 6-26M50 112c2-14-2-22-6-26" stroke="#0f766e" strokeWidth="2" fill="none" />
      <rect x="84" y="86" width="120" height="6" rx="3" fill="#94a3b8" />
      <rect x="128" y="70" width="34" height="18" rx="3" fill="#334155" />
      <circle cx="98" cy="44" r="11" fill="#fcd9b6" />
      <path d="M86 42c0-10 6-15 12-15s12 5 12 13c-4-4-14-4-24 2z" fill="#1e293b" />
      <path d="M80 86c0-18 8-28 18-28s18 10 18 28z" fill="#2563eb" />
      <circle cx="146" cy="38" r="12" fill="#f5c9a0" />
      <path d="M133 37c0-11 6-16 13-16s13 5 13 14c-6-5-17-4-26 2z" fill="#3f2a1d" />
      <path d="M126 70c0-18 9-26 20-26s20 8 20 26z" fill="#0f766e" />
      <circle cx="196" cy="52" r="10" fill="#fcd9b6" />
      <path d="M185 52c0-12 5-16 11-16s12 4 12 14c-2 8-4 12-4 16h-16c0-4-3-8-3-14z" fill="#111827" />
      <path d="M180 86c0-14 7-22 16-22s16 8 16 22z" fill="#e0e7ff" />
    </svg>
  );
}

function WorkforceChart({ org }: { org: Org }) {
  const [range, setRange] = useState<'7' | '14' | 'month'>('7');
  const headcount = org.headcount_active || 0;

  const rows = useMemo(() => {
    const all = (org.attendance_series || []).map((r) => {
      const present = Number(r.present ?? r.count) || 0;
      const leave = Number(r.leave ?? 0) || 0;
      const absent = r.absent != null ? Number(r.absent) || 0 : Math.max(0, headcount - present - leave);
      return { label: r.label, present, absent, leave };
    });
    if (range === 'month') {
      const prefix = all[all.length - 1]?.label.slice(0, 7);
      return all.filter((r) => r.label.startsWith(prefix || ''));
    }
    return all.slice(-Number(range));
  }, [org.attendance_series, headcount, range]);

  const peak = Math.max(1, ...rows.flatMap((r) => [r.present, r.absent, r.leave]));
  const step = niceStep(peak);
  const top = step * Math.ceil(peak / step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => top - i * step);
  const h = (v: number) => `${Math.round((v / top) * 100)}%`;

  return (
    <section className="hh-card hh-workforce">
      <header className="hh-card-head">
        <span className="hh-card-icon">
          <HrmsIcon name="users" />
        </span>
        <div>
          <h2>Workforce Overview</h2>
          <p>Daily presence · {org.period_label}</p>
        </div>
        <select
          className="hh-select"
          value={range}
          onChange={(e) => setRange(e.target.value as typeof range)}
          aria-label="Chart range"
        >
          <option value="7">Last 7 Days</option>
          <option value="14">Last 14 Days</option>
          <option value="month">This Month</option>
        </select>
      </header>
      <div className="hh-legend">
        <span>
          <i style={{ background: ATT_COLORS.present }} />
          Present
        </span>
        <span>
          <i style={{ background: ATT_COLORS.absent }} />
          Absent
        </span>
        <span>
          <i style={{ background: ATT_COLORS.leave }} />
          Leave
        </span>
      </div>
      <div className="hh-chart" role="img" aria-label="Daily present, absent and leave counts">
        <div className="hh-chart-y">
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className="hh-chart-plot">
          <div className="hh-chart-grid">
            {ticks.map((t) => (
              <i key={t} />
            ))}
          </div>
          <div className="hh-chart-groups">
            {rows.map((r) => {
              const d = parseDate(r.label);
              const label = d ? `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}` : r.label;
              return (
                <div
                  key={r.label}
                  className="hh-chart-group"
                  title={`${label}: ${r.present} present, ${r.absent} absent, ${r.leave} on leave`}
                >
                  <div className="hh-chart-bars">
                    <i style={{ height: h(r.present), background: ATT_COLORS.present }} />
                    <i style={{ height: h(r.absent), background: ATT_COLORS.absent }} />
                    <i style={{ height: h(r.leave), background: ATT_COLORS.leave }} />
                  </div>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function AttendanceDonut({
  parts,
  total,
}: {
  parts: Array<{ label: string; value: number; color: string }>;
  total: number;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const sum = Math.max(1, parts.reduce((acc, p) => acc + p.value, 0));
  let offset = 0;
  return (
    <svg className="hh-donut" viewBox="0 0 140 140" role="img" aria-label="Attendance breakdown">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f6" strokeWidth="22" />
      {parts.map((p) => {
        const len = (p.value / sum) * c;
        const el = (
          <circle
            key={p.label}
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={p.color}
            strokeWidth="22"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
          />
        );
        offset += len;
        return el;
      })}
      <text x="70" y="68" textAnchor="middle" className="hh-donut-total">
        {total}
      </text>
      <text x="70" y="86" textAnchor="middle" className="hh-donut-label">
        Employees
      </text>
    </svg>
  );
}

const ACTIVITY_STYLE: Record<string, { icon: string; cls: string }> = {
  join: { icon: 'plus', cls: 'join' },
  leave: { icon: 'file', cls: 'leave' },
  expense: { icon: 'rupee', cls: 'expense' },
};

const QUICK_ACTIONS = [
  { to: '/people/employees?new=1', label: 'Add New Employee', icon: 'userPlus', tone: 'green' },
  { to: '/people/recruitment?tab=jobs', label: 'Create Job Opening', icon: 'briefcase', tone: 'blue' },
  { to: '/people/payslips', label: 'Run Payroll', icon: 'wallet', tone: 'amber' },
  { to: '/people/reports', label: 'Generate Report', icon: 'reports', tone: 'violet' },
  { to: '/planning/new', label: 'New Staff Plan', icon: 'calendar', tone: 'pink' },
];

const IMPORTANT_LINKS = [
  { to: '/people/employees', label: 'Employee Directory', icon: 'users', tone: 'violet' },
  { to: '/people/departments', label: 'Org Chart', icon: 'orgChart', tone: 'blue' },
  { to: '/people/payslips', label: 'Salary Structure', icon: 'wallet', tone: 'green' },
  { to: '/people/policies', label: 'Policy Handbook', icon: 'book', tone: 'navy' },
  { to: '/people/leave', label: 'Leave Policy', icon: 'file', tone: 'sky' },
  { to: '/people/documents', label: 'HR Forms', icon: 'file', tone: 'red' },
  { to: '/people/training', label: 'Training Calendar', icon: 'calendar', tone: 'indigo' },
  { to: '/people/announcements', label: 'Announcements', icon: 'megaphone', tone: 'amber' },
];

export function PeopleManagerDashboard({ data }: { data: PeopleHrmsDashboard }) {
  const org = data.org!;
  const headcount = org.headcount_active || 0;
  const breakdown = org.attendance_breakdown;
  const present = breakdown?.present ?? org.attendance_today ?? 0;
  const onLeave = breakdown?.leave ?? 0;
  const absent = breakdown?.absent ?? Math.max(0, headcount - present - onLeave);
  const halfDay = breakdown?.half_day ?? 0;
  const totalToday = breakdown?.total ?? headcount;

  const payroll = org.payroll_summary || {
    total_gross: org.payroll.total_gross || 0,
    total_net: org.payroll.total_net || 0,
    total_deduction: org.payroll.total_deduction || 0,
    salary_slips_mtd: org.payroll.salary_slips_mtd,
  };

  const prevNet = Number(org.payroll_summary?.prev_total_net || 0);
  const payrollTrend =
    prevNet > 0 && payroll.total_net > 0
      ? Math.round(((payroll.total_net - prevNet) / prevNet) * 1000) / 10
      : null;

  const depts = org.by_department || [];
  const deptMax = Math.max(1, ...depts.map((d) => Number(d.headcount) || 0));
  const events = useMemo(() => upcomingEvents(new Date()), []);
  const firstName = (data.employee.name || '').split(' ')[0];

  const attendanceParts = [
    { label: 'Present', value: present, color: ATT_COLORS.present },
    { label: 'Absent', value: absent, color: ATT_COLORS.absent },
    { label: 'Leave', value: onLeave, color: ATT_COLORS.leave },
    { label: 'Half Day', value: halfDay, color: ATT_COLORS.halfDay },
  ];

  return (
    <div className="hh-home">
      <section className="hh-hero">
        <div className="hh-hero-mark" aria-hidden>
          <HrmsIcon name="users" size={34} />
        </div>
        <div className="hh-hero-text">
          <h1>Welcome back{firstName ? `, ${firstName}` : ''}!</h1>
          <p>Here’s what’s happening with your organisation today · {org.period_label}</p>
        </div>
        <TeamIllustration />
        <blockquote className="hh-hero-quote">
          <p>“People are the strength behind every success.”</p>
          <cite>Manage. Support. Grow.</cite>
        </blockquote>
      </section>

      <section className="hh-kpis">
        <article className="hh-kpi">
          <span className="hh-kpi-icon blue">
            <HrmsIcon name="users" />
          </span>
          <div>
            <small>Total Employees</small>
            <strong>{headcount}</strong>
            <em className="up">
              <HrmsIcon name="trendUp" size={13} /> +{org.joined_mtd} joined this month
            </em>
          </div>
        </article>
        <article className="hh-kpi">
          <span className="hh-kpi-icon green">
            <HrmsIcon name="calendar" />
          </span>
          <div>
            <small>Present Today</small>
            <strong>{present}</strong>
            <em className="green">{fmtPct(percent(present, headcount))} of total employees</em>
          </div>
          <Ring value={percent(present, headcount)} color={ATT_COLORS.present} />
        </article>
        <article className="hh-kpi">
          <span className="hh-kpi-icon red">
            <HrmsIcon name="umbrella" />
          </span>
          <div>
            <small>On Leave Today</small>
            <strong>{onLeave}</strong>
            <em>{fmtPct(percent(onLeave, headcount))} of total employees</em>
          </div>
          <Ring value={percent(onLeave, headcount)} color={ATT_COLORS.absent} />
        </article>
        <article className="hh-kpi">
          <span className="hh-kpi-icon red">
            <HrmsIcon name="userX" />
          </span>
          <div>
            <small>Absent Today</small>
            <strong>{absent}</strong>
            <em>{fmtPct(percent(absent, headcount))} of total employees</em>
          </div>
          <Ring value={percent(absent, headcount)} color={ATT_COLORS.absent} />
        </article>
        <article className="hh-kpi">
          <span className="hh-kpi-icon navy">
            <HrmsIcon name="briefcase" />
          </span>
          <div>
            <small>Open Positions</small>
            <strong>{org.open_positions ?? 0}</strong>
            <em>{org.left_mtd ? `${org.left_mtd} left this month` : 'Recruitment in progress'}</em>
          </div>
        </article>
        <article className="hh-kpi">
          <span className="hh-kpi-icon green">
            <HrmsIcon name="wallet" />
          </span>
          <div>
            <small>This Month Payroll</small>
            <strong>{money(payroll.total_net)}</strong>
            {payrollTrend != null ? (
              <em className={payrollTrend >= 0 ? 'up' : 'down'}>
                <HrmsIcon name={payrollTrend >= 0 ? 'trendUp' : 'trendDown'} size={13} />
                {payrollTrend >= 0 ? '+' : ''}
                {fmtPct(payrollTrend)} from last month
              </em>
            ) : (
              <em>{payroll.salary_slips_mtd} salary slips this month</em>
            )}
          </div>
          <span className="hh-kpi-bars" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
        </article>
      </section>

      <div className="hh-row hh-row-3">
        <WorkforceChart org={org} />

        <section className="hh-card">
          <header className="hh-card-head">
            <span className="hh-card-icon">
              <HrmsIcon name="analytics" />
            </span>
            <div>
              <h2>Employee Distribution</h2>
              <p>By department</p>
            </div>
            <Link to="/people/departments">View Full Report</Link>
          </header>
          <ul className="hh-dist">
            {depts.slice(0, 10).map((row, i) => (
              <li key={row.department}>
                <span className="hh-dist-name">{row.department}</span>
                <span className="hh-dist-track">
                  <i
                    style={{
                      width: `${Math.max(4, Math.round((row.headcount / deptMax) * 100))}%`,
                      background: DEPT_COLORS[i % DEPT_COLORS.length],
                    }}
                  />
                </span>
                <b>{row.headcount}</b>
                <small>({fmtPct(Math.round(percent(row.headcount, headcount)))})</small>
              </li>
            ))}
            {!depts.length ? <li className="hh-empty">No active employees yet</li> : null}
          </ul>
        </section>

        <section className="hh-card">
          <header className="hh-card-head">
            <span className="hh-card-icon">
              <HrmsIcon name="calendar" />
            </span>
            <div>
              <h2>Upcoming Events</h2>
            </div>
            <Link to="/people/calendar">View Calendar</Link>
          </header>
          <ul className="hh-events">
            {events.map((ev) => (
              <li key={ev.title}>
                <Link to="/people/calendar">
                  <span className="hh-date-badge">
                    <small>{ev.date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</small>
                    <b>{String(ev.date.getDate()).padStart(2, '0')}</b>
                  </span>
                  <span className="hh-event-text">
                    <b>{ev.title}</b>
                    <small>{ev.sub}</small>
                  </span>
                  <span className="hh-event-tag">{ev.tag}</span>
                  <HrmsIcon name="chevronRight" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="hh-row hh-row-3">
        <section className="hh-card">
          <header className="hh-card-head">
            <span className="hh-card-icon">
              <HrmsIcon name="briefcase" />
            </span>
            <div>
              <h2>Recent Job Openings</h2>
              <p>From careers / Job Opening</p>
            </div>
            <Link to="/people/recruitment">View All</Link>
          </header>
          <div className="hh-table-wrap">
            <table className="hh-table">
              <thead>
                <tr>
                  <th>Job Title</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Applicants</th>
                  <th>Posted On</th>
                </tr>
              </thead>
              <tbody>
                {(org.recent_job_openings || []).slice(0, 5).map((job) => (
                  <tr key={job.name}>
                    <td>{job.job_title}</td>
                    <td>{job.department}</td>
                    <td>
                      <span className={`hh-pill${/clos/i.test(job.status) ? ' muted' : ''}`}>{job.status}</span>
                    </td>
                    <td>{job.applicants}</td>
                    <td>{job.posted}</td>
                  </tr>
                ))}
                {!(org.recent_job_openings || []).length ? (
                  <tr>
                    <td colSpan={5} className="hh-empty">
                      No job openings yet — create one from Recruitment.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="hh-card">
          <header className="hh-card-head">
            <span className="hh-card-icon">
              <HrmsIcon name="clock" />
            </span>
            <div>
              <h2>Recent Activities</h2>
              <p>Joins, leave, expenses</p>
            </div>
            <Link to="/people/reports">View All</Link>
          </header>
          <ul className="hh-activities">
            {(org.recent_activities || []).slice(0, 5).map((act, idx) => {
              const style = ACTIVITY_STYLE[act.type] || ACTIVITY_STYLE.leave;
              const split = act.type === 'leave' ? act.text.match(/^(.*?)\s*\(([^()]*)\)\s*$/) : null;
              const when = parseDate(act.when);
              return (
                <li key={`${act.when}-${idx}`}>
                  <span className={`hh-act-icon ${style.cls}`}>
                    <HrmsIcon name={style.icon} size={14} />
                  </span>
                  <span className="hh-act-text">
                    {split ? split[1] : act.text}
                    {split ? <small>({split[2]})</small> : null}
                  </span>
                  <span className="hh-act-when">
                    {when ? fmtDay(when) : act.when}
                    {when && act.when.includes(' ') ? <small>{fmtTime(when)}</small> : null}
                  </span>
                </li>
              );
            })}
            {!(org.recent_activities || []).length ? <li className="hh-empty">No recent activity</li> : null}
          </ul>
        </section>

        <section className="hh-card">
          <header className="hh-card-head">
            <span className="hh-card-icon">
              <HrmsIcon name="shield" />
            </span>
            <div>
              <h2>Attendance Summary</h2>
              <p>Today</p>
            </div>
          </header>
          <div className="hh-attendance">
            <AttendanceDonut parts={attendanceParts} total={totalToday} />
            <ul>
              {attendanceParts.map((p) => (
                <li key={p.label}>
                  <i style={{ background: p.color }} />
                  <span>{p.label}</span>
                  <b>{p.value}</b>
                  <small>{fmtPct(percent(p.value, totalToday))}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <div className="hh-row hh-row-2">
        <section className="hh-card">
          <header className="hh-card-head">
            <span className="hh-card-icon">
              <HrmsIcon name="wallet" />
            </span>
            <div>
              <h2>Payroll Summary</h2>
              <p>{org.period_label}</p>
            </div>
          </header>
          <div className="hh-payroll">
            <div className="hh-tile">
              <span className="hh-kpi-icon blue sm">
                <HrmsIcon name="user" size={16} />
              </span>
              <div>
                <small>Total Gross</small>
                <b>{money(payroll.total_gross)}</b>
              </div>
            </div>
            <div className="hh-tile">
              <span className="hh-kpi-icon red sm">
                <HrmsIcon name="receipt" size={16} />
              </span>
              <div>
                <small>Deductions</small>
                <b>{money(payroll.total_deduction)}</b>
              </div>
            </div>
            <div className="hh-tile">
              <span className="hh-kpi-icon green sm">
                <HrmsIcon name="wallet" size={16} />
              </span>
              <div>
                <small>Net Payroll</small>
                <b>{money(payroll.total_net)}</b>
              </div>
            </div>
            <div className="hh-tile">
              <span className="hh-kpi-icon violet sm">
                <HrmsIcon name="file" size={16} />
              </span>
              <div>
                <small>Salary Slips</small>
                <b>{payroll.salary_slips_mtd} Generated</b>
              </div>
            </div>
          </div>
        </section>

        <section className="hh-card">
          <header className="hh-card-head">
            <span className="hh-card-icon">
              <HrmsIcon name="settings" />
            </span>
            <div>
              <h2>Quick Actions</h2>
              <p>Common HR tasks</p>
            </div>
          </header>
          <div className="hh-actions">
            {QUICK_ACTIONS.map((a) => (
              <Link key={a.label} to={a.to}>
                <span className={`hh-kpi-icon ${a.tone} sm`}>
                  <HrmsIcon name={a.icon} size={16} />
                </span>
                {a.label}
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="hh-card hh-links-card">
        <header className="hh-card-head">
          <span className="hh-card-icon">
            <HrmsIcon name="book" />
          </span>
          <div>
            <h2>Important Links</h2>
            <p>Shortcuts to frequently used features</p>
          </div>
        </header>
        <div className="hh-links">
          {IMPORTANT_LINKS.map((l) => (
            <Link key={l.label} to={l.to}>
              <span className={`hh-kpi-icon ${l.tone} sm`}>
                <HrmsIcon name={l.icon} size={16} />
              </span>
              {l.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
