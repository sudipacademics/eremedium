import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';
import { ExecutiveAnalyticsResponse } from '../../types/executiveAnalytics';

function money(value?: number | null) {
  if (value == null) return '₹0';
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const FUNNEL_LABELS: Record<string, string> = {
  trf_booked: 'TRF booked',
  trf_paid: 'Paid',
  sample_collected: 'Sample collected',
  in_lab: 'In lab',
  completed: 'Completed',
  report_authorized: 'Report authorized',
  cancelled: 'Cancelled',
};

export function ExecutiveAnalyticsPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<ExecutiveAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getExecutiveAnalytics({ period: p });
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const summary = data?.summary;
  const funnel = data?.funnel ?? {};
  const funnelMax = Math.max(1, ...Object.values(funnel));
  const periods = data?.periods ?? [
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' },
    { key: '90d', label: '90 days' },
    { key: '365d', label: '12 months' },
  ];

  return (
    <>
      <section className="hero hero-compact">
        <h1>Executive analytics</h1>
        <p>Cross-hub revenue, conversion funnel, CAC/LTV proxies & open critical alerts.</p>
      </section>

      <div className="pill-row" style={{ marginBottom: 16 }}>
        {periods.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`pill ${period === p.key ? 'pill-active' : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading analytics…</p>}
      {error && <p className="error">{error}</p>}

      {summary && (
        <>
          <div className="grid grid-stats">
            <div className="card">
              <p className="muted stat-label">Total revenue</p>
              <p className="stat-value">{money(summary.total_revenue)}</p>
            </div>
            <div className="card">
              <p className="muted stat-label">Lab · Pharmacy · Consult</p>
              <p className="stat-value" style={{ fontSize: '1rem' }}>
                {money(summary.lab_revenue)} · {money(summary.pharmacy_revenue)} ·{' '}
                {money(summary.appointment_revenue)}
              </p>
            </div>
            <div className="card">
              <p className="muted stat-label">LTV proxy (rev / active patient)</p>
              <p className="stat-value">{money(summary.avg_ltv_proxy)}</p>
            </div>
            <div className="card">
              <p className="muted stat-label">Est. CAC</p>
              <p className="stat-value">
                {summary.estimated_cac != null ? money(summary.estimated_cac) : 'Set marketing spend'}
              </p>
            </div>
            <div className="card">
              <p className="muted stat-label">New patients</p>
              <p className="stat-value">{summary.new_patients}</p>
            </div>
            <div className="card">
              <p className="muted stat-label">Open critical alerts</p>
              <p className="stat-value">{summary.critical_alerts_open}</p>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3>Lab conversion funnel</h3>
              {Object.entries(funnel).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span>{FUNNEL_LABELS[key] ?? key}</span>
                    <strong>{value}</strong>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.round((value / funnelMax) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3>Top franchise hubs</h3>
              {!data?.hub_breakdown?.length ? (
                <p className="muted">No hub data for this period.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Hub</th>
                        <th>Revenue</th>
                        <th>Conv.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.hub_breakdown.map((hub) => (
                        <tr key={hub.franchisee_id}>
                          <td>{hub.franchise_name}</td>
                          <td>{money(hub.revenue)}</td>
                          <td>{hub.conversion_rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
        {' · '}
        <Link to="/dashboard/critical-alerts">Critical alerts queue</Link>
      </p>
    </>
  );
}
