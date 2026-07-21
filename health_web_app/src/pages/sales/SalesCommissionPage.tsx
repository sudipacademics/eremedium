import { useEffect, useState } from 'react';
import { api, SalesCommissionPayload } from '../../api';

function formatMoney(value?: number) {
  return `₹${Number(value || 0).toFixed(0)}`;
}

export function SalesCommissionPage() {
  const [data, setData] = useState<SalesCommissionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getSalesCommissions()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load commissions'));
  }, []);

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data) {
    return <p>Loading commission ledger…</p>;
  }

  const summary = data.summary;

  return (
    <>
      <h1>Commission ledger</h1>
      <p className="muted">Accrued earnings from franchise onboardings and paid TRF revenue share.</p>

      <div className="grid grid-stats" style={{ marginTop: 20 }}>
        <article className="card stat-card">
          <span className="stat-label">Accrued (unpaid)</span>
          <strong>{formatMoney(summary.accrued_total)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Paid out</span>
          <strong>{formatMoney(summary.paid_total)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">This month</span>
          <strong>{formatMoney(summary.month_accrued)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Entries</span>
          <strong>{summary.entry_count ?? 0}</strong>
        </article>
      </div>

      <section style={{ marginTop: 28 }}>
        <h2>Ledger entries</h2>
        {data.entries.length === 0 ? (
          <p className="muted">No commission entries yet. Onboard a franchisee or wait for paid TRFs.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Franchisee</th>
                <th>Gross</th>
                <th>Rate</th>
                <th>Commission</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((row) => (
                <tr key={row.name}>
                  <td>{row.posting_date}</td>
                  <td>{row.entry_type}</td>
                  <td>{row.franchise_name || row.franchisee || '—'}</td>
                  <td>{row.gross_amount != null ? formatMoney(row.gross_amount) : '—'}</td>
                  <td>{row.commission_rate != null ? `${row.commission_rate}%` : '—'}</td>
                  <td>{formatMoney(row.commission_amount)}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
