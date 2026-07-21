import { useEffect, useState } from 'react';
import { api, SalesFranchiseeStats } from '../../api';

export function SalesFranchiseesPage() {
  const [stats, setStats] = useState<SalesFranchiseeStats | null>(null);
  const [period, setPeriod] = useState<'all' | 'month'>('month');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    void api
      .getSalesFranchiseeStats(period === 'month' ? 'month' : undefined)
      .then((res) => setStats(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [period]);

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!stats) {
    return <p>Loading franchisee performance…</p>;
  }

  return (
    <>
      <h1>My franchisees</h1>
      <p className="muted">Sales and TRF volume for centres you onboarded.</p>

      <div className="toolbar">
        <button
          type="button"
          className={period === 'month' ? 'btn' : 'btn secondary'}
          onClick={() => setPeriod('month')}
        >
          This month
        </button>
        <button
          type="button"
          className={period === 'all' ? 'btn' : 'btn secondary'}
          onClick={() => setPeriod('all')}
        >
          All time
        </button>
      </div>

      <div className="grid grid-stats" style={{ marginTop: 16 }}>
        <article className="card stat-card">
          <span className="stat-label">Franchisees</span>
          <strong>{stats.franchisees.length}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">TRFs</span>
          <strong>{stats.total_trfs}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Paid revenue</span>
          <strong>₹{stats.total_revenue.toFixed(0)}</strong>
        </article>
      </div>

      <table className="data-table" style={{ marginTop: 24 }}>
        <thead>
          <tr>
            <th>Franchise</th>
            <th>Branch</th>
            <th>Status</th>
            <th>TRFs</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {stats.franchisees.map((f) => (
            <tr key={f.franchisee_id}>
              <td>{f.franchise_name}</td>
              <td>{f.branch_code}</td>
              <td>{f.active_status || '—'}</td>
              <td>{f.trf_count}</td>
              <td>₹{f.revenue.toFixed(0)}</td>
            </tr>
          ))}
          {!stats.franchisees.length ? (
            <tr>
              <td colSpan={5} className="muted">
                No franchisees yet — use Onboard to add your first centre.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
