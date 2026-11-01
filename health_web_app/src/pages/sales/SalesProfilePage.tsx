import { useEffect, useMemo, useState } from 'react';
import { api, SalesProfileDashboard } from '../../api';
import './sales-profile.css';

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function initials(name?: string) {
  const parts = String(name || 'R').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'R';
}

export function SalesProfilePage() {
  const [data, setData] = useState<SalesProfileDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getSalesProfileDashboard(true);
        if (!active) return;
        setData(res.data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load profile');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const salesMax = useMemo(() => {
    const series = data?.charts?.sales_earned || [];
    return Math.max(1, ...series.map((item) => Number(item.amount) || 0));
  }, [data]);

  if (loading) {
    return <p className="muted">Loading REACH profile…</p>;
  }
  if (error) {
    return <div className="reach-alert err">{error}</div>;
  }
  if (!data?.available) {
    return <div className="reach-alert err">Sales profile is not available for this account.</div>;
  }

  const employee = data.employee;
  const kpis = data.kpis;
  const compensation = data.compensation;
  const expenseShare = compensation.net_expense_to_company_mtd
    ? Math.round((compensation.expenses_claimed_mtd / compensation.net_expense_to_company_mtd) * 100)
    : 0;
  const ctcShare = Math.max(0, 100 - expenseShare);

  return (
    <div className="reach-profile">
      <section className="reach-profile-hero">
        <div className="reach-profile-identity">
          <div className="reach-profile-avatar" aria-hidden>
            {initials(employee.name)}
          </div>
          <div>
            <p className="reach-profile-kicker">REACH sales profile</p>
            <h1>{employee.name}</h1>
            <p>
              {employee.designation || data.rep?.designation} · {data.rep?.territory_region || employee.branch || 'Territory'}
            </p>
            <div className="reach-profile-chips">
              <span>Emp {employee.id || '—'}</span>
              <span>Code {data.rep?.rep_code || '—'}</span>
              <span>{data.period.label}</span>
              <span>{employee.status}</span>
            </div>
          </div>
        </div>
        <div className="reach-profile-hero-metrics">
          <article>
            <small>Monthly CTC</small>
            <b>{money(compensation.monthly_ctc)}</b>
          </article>
          <article>
            <small>Monthly target</small>
            <b>{money(compensation.monthly_target)}</b>
          </article>
          <article>
            <small>Achievement</small>
            <b>{kpis.achievement_pct}%</b>
          </article>
        </div>
      </section>

      <section className="reach-profile-kpi-grid">
        <article>
          <span>Leads uploaded</span>
          <strong>{kpis.leads_uploaded}</strong>
        </article>
        <article>
          <span>Visits logged</span>
          <strong>{kpis.visits_logged}</strong>
        </article>
        <article>
          <span>FOFO franchisees</span>
          <strong>{kpis.fofo_created}</strong>
          {kpis.used_seed_counts?.fofo ? <em>seeded</em> : null}
        </article>
        <article>
          <span>FOCO franchisees</span>
          <strong>{kpis.foco_created}</strong>
          {kpis.used_seed_counts?.foco ? <em>seeded</em> : null}
        </article>
        <article>
          <span>B2B centres</span>
          <strong>{kpis.b2b_created}</strong>
          {kpis.used_seed_counts?.b2b ? <em>seeded</em> : null}
        </article>
        <article className="accent">
          <span>Total sales generated</span>
          <strong>{money(kpis.total_sales_generated)}</strong>
        </article>
      </section>

      <section className="reach-profile-panel-grid">
        <div className="reach-profile-panel">
          <header>
            <div>
              <h2>Sales earned</h2>
              <p>Daily field revenue (franchise TRFs + B2B) for {data.period.label}</p>
            </div>
            <b>{money(data.charts.sales_earned_mtd)}</b>
          </header>
          <div className="reach-profile-bars" role="img" aria-label="Sales earned daily chart">
            {data.charts.sales_earned.map((item) => (
              <div key={item.day} className="reach-profile-bar-col" title={`${item.label}: ${money(item.amount)}`}>
                <div
                  className={`reach-profile-bar${item.seeded ? ' seeded' : ''}`}
                  style={{ height: `${Math.max(8, Math.round((Number(item.amount) / salesMax) * 100))}%` }}
                />
                <span>{item.day}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="reach-profile-panel reach-profile-expense">
          <header>
            <div>
              <h2>Net expense to company</h2>
              <p>(CTC prorated MTD + expenses claimed) ÷ {data.charts.net_expense.days_covered || data.period.days_covered} days covered</p>
            </div>
          </header>
          <div className="reach-profile-expense-main">
            <div className="reach-profile-expense-ring" style={{ background: `conic-gradient(#0b7d75 0 ${ctcShare}%, #f0b429 ${ctcShare}% 100%)` }}>
              <div>
                <small>Per day</small>
                <b>{money(compensation.net_expense_per_day)}</b>
              </div>
            </div>
            <ul>
              <li>
                <span>CTC prorated MTD</span>
                <b>{money(compensation.ctc_prorated_mtd)}</b>
              </li>
              <li>
                <span>Expenses claimed MTD</span>
                <b>{money(compensation.expenses_claimed_mtd)}</b>
              </li>
              <li>
                <span>Net expense MTD</span>
                <b>{money(compensation.net_expense_to_company_mtd)}</b>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="reach-profile-panel reach-profile-employee">
        <header>
          <div>
            <h2>Employee data (ERPNext)</h2>
            <p>Pulled from Employee master linked to this REACH user.</p>
          </div>
        </header>
        <div className="reach-profile-employee-grid">
          <div><small>Employee ID</small><b>{employee.id || '—'}</b></div>
          <div><small>Department</small><b>{employee.department || '—'}</b></div>
          <div><small>Designation</small><b>{employee.designation || '—'}</b></div>
          <div><small>Phone</small><b>{employee.phone || '—'}</b></div>
          <div><small>Email</small><b>{employee.email || '—'}</b></div>
          <div><small>Date of joining</small><b>{employee.date_of_joining || '—'}</b></div>
          <div><small>Company</small><b>{employee.company || '—'}</b></div>
          <div><small>Branch / territory</small><b>{employee.branch || data.rep?.territory_region || '—'}</b></div>
        </div>
        {data.seed?.seeded?.length ? (
          <p className="reach-profile-seed-note">
            Seeded for missing data: {data.seed.seeded.join(', ')}.
          </p>
        ) : null}
      </section>
    </div>
  );
}
