import { useEffect, useState } from 'react';
import { api, AgencyCommissionPayload } from '../../api';
import './agents-portal.css';

function money(n?: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function AgentsCommissionsPage() {
  const [data, setData] = useState<AgencyCommissionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getAgencyCommissions()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load commissions'));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p>Loading commissions…</p>;

  const s = data.summary;
  return (
    <>
      <h1>Commission ledger</h1>
      <p className="muted">Conversion, monthly revenue share, and upline overrides.</p>

      <div className="agents-grid">
        <article className="agents-stat">
          <span>Accrued</span>
          <strong>{money(s.accrued_total)}</strong>
        </article>
        <article className="agents-stat">
          <span>Paid</span>
          <strong>{money(s.paid_total)}</strong>
        </article>
        <article className="agents-stat">
          <span>This month</span>
          <strong>{money(s.month_accrued)}</strong>
        </article>
        <article className="agents-stat">
          <span>Entries</span>
          <strong>{s.entry_count}</strong>
        </article>
      </div>

      <section className="agents-panel">
        {data.entries.length === 0 ? (
          <p className="muted">No commission entries yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Agent</th>
                <th>Type</th>
                <th>Franchisee</th>
                <th>Period</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((row) => (
                <tr key={row.name}>
                  <td>{row.posting_date || '—'}</td>
                  <td>{row.agent_name || row.agent}</td>
                  <td>{row.entry_type}</td>
                  <td>{row.franchise_name || row.franchisee || '—'}</td>
                  <td>{row.period || '—'}</td>
                  <td>{row.commission_rate != null ? `${row.commission_rate}%` : '—'}</td>
                  <td>{money(row.commission_amount)}</td>
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
