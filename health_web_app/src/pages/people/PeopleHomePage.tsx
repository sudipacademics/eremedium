import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PeopleHrmsDashboard } from '../../api';
import { isSalesStaff, isStaff } from '../../auth/roles';
import { useAuth } from '../../auth/AuthContext';
import { PeopleManagerDashboard } from './PeopleManagerDashboard';
import './people-portal.css';
import './people-hrms-shell.css';

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function initials(name?: string) {
  const parts = String(name || 'P').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'P';
}

function EmployeeDashboard({ data }: { data: PeopleHrmsDashboard }) {
  const { user } = useAuth();
  const emp = data.employee;
  const showReachTip =
    isSalesStaff(user?.roles) && !isStaff(user?.roles || []) && !data.is_manager;

  const deptMax = useMemo(() => {
    const rows = data?.org?.by_department || [];
    return Math.max(1, ...rows.map((r) => Number(r.headcount) || 0));
  }, [data]);

  const checkMax = useMemo(() => {
    const series = data?.attendance?.series || [];
    return Math.max(1, ...series.map((r) => Number(r.count) || 0));
  }, [data]);

  return (
    <div className="people-home">
      {showReachTip ? (
        <div className="people-banner">
          Field sales leads and visits stay on{' '}
          <a href="https://reach.e-remedium.in/sales">REACH</a>. This portal is for HR, attendance, and
          payroll.
        </div>
      ) : null}

      <section className="people-hero">
        <div className="people-hero-identity">
          <div className="people-avatar" aria-hidden>
            {initials(emp.name)}
          </div>
          <div>
            <p className="people-kicker">People HRMS</p>
            <h1>{emp.name}</h1>
            <p>
              {[emp.designation, emp.department].filter(Boolean).join(' · ') || 'Employee'}
            </p>
            <div className="people-chips">
              <span>Emp {emp.id || '—'}</span>
              <span>{data.period.label}</span>
              <span>{emp.status}</span>
              {emp.branch ? <span>{emp.branch}</span> : null}
            </div>
          </div>
        </div>
        <div className="people-hero-metrics">
          <article>
            <small>Monthly CTC</small>
            <b>{money(data.compensation.monthly_ctc)}</b>
          </article>
          <article>
            <small>Present %</small>
            <b>{data.kpis.present_pct}%</b>
          </article>
          <article>
            <small>Leave balance</small>
            <b>{data.kpis.leave_balance}</b>
          </article>
        </div>
      </section>

      <section className="people-kpi-grid">
        <article>
          <span>Days present (MTD)</span>
          <strong>{data.kpis.present_days}</strong>
        </article>
        <article>
          <span>Expenses claimed</span>
          <strong>{money(data.kpis.expenses_claimed_mtd)}</strong>
        </article>
        <article>
          <span>Pending expenses</span>
          <strong>{data.kpis.expenses_pending}</strong>
        </article>
        <article className="accent">
          <span>Latest net pay</span>
          <strong>{money(data.compensation.latest_net_pay)}</strong>
        </article>
      </section>

      <div className="people-actions">
        <Link className="primary" to="/people/attendance">
          Mark attendance
        </Link>
        <Link to="/people/leave">Apply leave</Link>
        <Link to="/people/expenses">Submit expense</Link>
        <Link to="/people/payslips">View payslips</Link>
      </div>

      <section className="people-panel-grid">
        <div className="people-panel">
          <header>
            <div>
              <h2>Attendance pulse</h2>
              <p>Daily check-ins this month · today: {data.attendance.today_status}</p>
            </div>
            <b>{data.kpis.checkins_mtd}</b>
          </header>
          <div className="people-bars" role="img" aria-label="Attendance check-ins chart">
            {(data.attendance.series || []).map((item) => (
              <div key={item.label} className="people-bar-col" title={`${item.label}: ${item.count}`}>
                <div
                  className="people-bar"
                  style={{ height: `${Math.max(6, Math.round((Number(item.count) / checkMax) * 100))}%` }}
                />
                <span>{item.day}</span>
              </div>
            ))}
          </div>
        </div>

        {data.org ? (
          <div className="people-panel">
            <header>
              <div>
                <h2>Organisation monitor</h2>
                <p>Active headcount · {data.org.period_label}</p>
              </div>
              <b>{data.org.headcount_active}</b>
            </header>
            <div className="people-dept-list" style={{ marginTop: 16 }}>
              {(data.org.by_department || []).map((row) => (
                <div key={row.department} className="people-dept-row">
                  <div>
                    <div style={{ fontWeight: 650, marginBottom: 4 }}>{row.department}</div>
                    <div className="people-dept-track">
                      <div
                        className="people-dept-fill"
                        style={{ width: `${Math.round((row.headcount / deptMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <strong>{row.headcount}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="people-panel">
            <header>
              <div>
                <h2>Leave balances</h2>
                <p>Allocated leave remaining this period</p>
              </div>
            </header>
            {(data.leave_balances || []).length ? (
              <table className="people-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Taken</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leave_balances.map((row) => (
                    <tr key={row.leave_type}>
                      <td>{row.leave_type}</td>
                      <td>{row.taken}</td>
                      <td>{row.balance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No leave allocations yet. Apply leave to open a balance.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function PeopleHomePage() {
  const [data, setData] = useState<PeopleHrmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (active) setData(res.data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load People HRMS');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="muted">Loading People dashboard…</p>;
  if (error) return <div className="people-alert err">{error}</div>;
  if (!data) return null;

  if (data.is_manager && data.org) {
    return <PeopleManagerDashboard data={data} />;
  }
  return <EmployeeDashboard data={data} />;
}
