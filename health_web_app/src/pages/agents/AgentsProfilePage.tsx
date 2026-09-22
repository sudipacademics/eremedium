import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AgencyProfilePayload } from '../../api';
import './agents-portal.css';

function money(n?: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function AgentsProfilePage() {
  const [data, setData] = useState<AgencyProfilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getAgencyProfile()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load profile'));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p>Loading agent profile…</p>;

  const a = data.agent;
  const summary = data.commissions?.summary;

  return (
    <>
      <h1>{a.full_name}</h1>
      <p className="muted">
        <span className="agents-level-chip">{a.level_title || a.level}</span>
        {a.sponsor_name ? <> · Sponsor: {a.sponsor_name}</> : null}
        {a.is_agency_manager ? <> · Agency Manager</> : null}
      </p>

      <div className="agents-grid">
        <article className="agents-stat">
          <span>Downline</span>
          <strong>{data.downline_count}</strong>
        </article>
        <article className="agents-stat">
          <span>Franchisees</span>
          <strong>{data.franchisees.length}</strong>
        </article>
        <article className="agents-stat">
          <span>Accrued</span>
          <strong>{money(summary?.accrued_total)}</strong>
        </article>
        <article className="agents-stat">
          <span>This month</span>
          <strong>{money(summary?.month_accrued)}</strong>
        </article>
      </div>

      <section className="agents-panel">
        <h2>Contact</h2>
        <p>
          {a.email || '—'}
          <br />
          {a.mobile || '—'}
          <br />
          Status: {a.status} · Joined {a.joined_on || '—'}
        </p>
      </section>

      <section className="agents-panel">
        <h2>Direct downline</h2>
        {data.downline.length === 0 ? (
          <p className="muted">No direct recruits yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Level</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.downline.map((row) => (
                <tr key={row.name}>
                  <td>{row.full_name}</td>
                  <td>{row.level}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="agents-panel">
        <h2>Attributed franchisees</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Request onboard and track commissions on <Link to="/agents/franchisees">Franchisees</Link>.
        </p>
        {data.franchisees.length === 0 ? (
          <p className="muted">No franchise conversions attributed yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Franchisee</th>
                <th>Deal value</th>
                <th>Date</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody>
              {data.franchisees.map((row) => (
                <tr key={row.name}>
                  <td>{row.franchise_name || row.franchisee}</td>
                  <td>{money(row.deal_value)}</td>
                  <td>{row.attributed_on || '—'}</td>
                  <td>{row.level_at_conversion || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
