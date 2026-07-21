import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { FranchiseeKpiResponse } from '../../types/franchiseeKpi';
import { AppointmentsTable } from './AppointmentsTable';
import { BookingsTable } from './BookingsTable';

const PIPELINE_ORDER = ['Booked', 'Sample Collected', 'In Lab', 'Completed', 'Cancelled'];

function money(value?: number) {
  if (value == null) return '₹0';
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function FranchiseeDashboard() {
  const { user } = useAuth();
  const franchisee = user?.franchisee;

  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<FranchiseeKpiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getFranchiseeKpis({ period: p });
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load KPIs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const kpis = data?.kpis;
  const pipeline = data?.pipeline ?? {};
  const pipelineMax = Math.max(1, ...Object.values(pipeline));
  const periods = data?.periods ?? [
    { key: 'today', label: 'Today' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: '90d', label: 'Last 90 days' },
  ];

  return (
    <>
      <section className="hero hero-compact">
        <h1>{franchisee?.franchise_name || data?.franchisee.franchise_name || 'Franchise hub'}</h1>
        <p>
          {franchisee?.branch_code ? `Branch ${franchisee.branch_code}` : 'Franchisee operations'}
          {franchisee?.territory_region ? ` · ${franchisee.territory_region}` : ''}
        </p>
      </section>

      <div className="toolbar" style={{ marginTop: 16, alignItems: 'center', gap: 8 }}>
        <span className="stat-label" style={{ marginRight: 4 }}>
          Period
        </span>
        {periods.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`btn ${period === p.key ? '' : 'secondary'}`}
            onClick={() => setPeriod(p.key)}
            disabled={loading && period === p.key}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="alert error" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      <div className="grid grid-stats" style={{ marginTop: 16 }}>
        <article className="card stat-card">
          <span className="stat-label">Revenue (paid)</span>
          <strong>{money(kpis?.revenue_paid)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Pending revenue</span>
          <strong>{money(kpis?.revenue_pending)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Commission earned</span>
          <strong>{money(kpis?.commission_earned)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Bookings</span>
          <strong>{kpis?.total_bookings ?? '—'}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Completed</span>
          <strong>{kpis?.completed ?? '—'}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Avg order value</span>
          <strong>{money(kpis?.avg_order_value)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Paid conversion</span>
          <strong>{kpis?.conversion_rate != null ? `${kpis.conversion_rate}%` : '—'}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Commission rate</span>
          <strong>
            {(franchisee?.commission_percentage_rate ?? data?.franchisee.commission_rate) != null
              ? `${franchisee?.commission_percentage_rate ?? data?.franchisee.commission_rate}%`
              : '—'}
          </strong>
        </article>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 20 }}>
        <article className="card">
          <h3 style={{ marginTop: 0 }}>Order pipeline</h3>
          {Object.keys(pipeline).length === 0 ? (
            <p className="muted">No bookings in this period.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {PIPELINE_ORDER.filter((s) => s in pipeline).map((stage) => (
                <div key={stage}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{stage}</span>
                    <strong>{pipeline[stage]}</strong>
                  </div>
                  <div style={{ background: 'var(--surface-2, #eef1f5)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${(pipeline[stage] / pipelineMax) * 100}%`,
                        background: stage === 'Cancelled' ? '#d9534f' : 'var(--brand, #2a7de1)',
                        height: '100%',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <h3 style={{ marginTop: 0 }}>Top tests</h3>
          {!data || data.top_tests.length === 0 ? (
            <p className="muted">No test data in this period.</p>
          ) : (
            <table className="data-table" style={{ width: '100%' }}>
              <tbody>
                {data.top_tests.map((t) => (
                  <tr key={t.test}>
                    <td>{t.test}</td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{t.count}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      </div>

      <div className="toolbar" style={{ marginTop: 20 }}>
        <a className="btn" href="/b2b">
          B2B portal (MRP / wholesale)
        </a>
        <a className="btn secondary" href="/dashboard/hr">
          HR — leave &amp; expenses
        </a>
        <a className="btn secondary" href="/dashboard/pharmacy-quotes">
          Pharmacy quotes
        </a>
      </div>

      <BookingsTable title="TRFs at your hub" />
      <AppointmentsTable title="Doctor appointments (offline payments)" />
    </>
  );
}
