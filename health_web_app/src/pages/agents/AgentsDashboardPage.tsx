import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AgencyDashboard } from '../../api';
import './agents-portal.css';

function money(n?: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function AgentsDashboardPage() {
  const [data, setData] = useState<AgencyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getAgencyDashboard()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dashboard'));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p>Loading agency dashboard…</p>;

  const s = data.stats;
  return (
    <>
      <h1>Agency Manager dashboard</h1>
      <p className="muted">
        Recruit → Activate → Coach → Produce → Multiply. Track team depth and franchise economics.
      </p>

      <div className="agents-grid">
        <article className="agents-stat">
          <span>Recruitment</span>
          <strong>{s.recruitment}</strong>
        </article>
        <article className="agents-stat">
          <span>Activation</span>
          <strong>{s.activation}</strong>
        </article>
        <article className="agents-stat">
          <span>Productivity</span>
          <strong>{s.productivity}</strong>
        </article>
        <article className="agents-stat">
          <span>Leadership</span>
          <strong>{s.leadership}</strong>
        </article>
        <article className="agents-stat">
          <span>Economics</span>
          <strong>{money(s.economics)}</strong>
        </article>
        <article className="agents-stat">
          <span>Team size</span>
          <strong>{s.team_size}</strong>
        </article>
      </div>

      <section className="agents-panel">
        <h2>Pyramid levels (seeded)</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Code</th>
              <th>Title</th>
              <th>Conversion %</th>
              <th>Monthly %</th>
              <th>Override %</th>
            </tr>
          </thead>
          <tbody>
            {data.levels.map((level) => (
              <tr key={level.name}>
                <td>{level.rank}</td>
                <td>{level.code}</td>
                <td>{level.title}</td>
                <td>{level.conversion_pct}%</td>
                <td>{level.monthly_revenue_pct}%</td>
                <td>{level.override_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 10 }}>
          Conversion base seed: {money(data.conversion_base_inr)}. Edit rates on{' '}
          <Link to="/agents/levels">Levels</Link>.
        </p>
      </section>

      <section className="agents-panel">
        <h2>Quick links</h2>
        <p>
          <Link to="/agents/me">My profile</Link> · <Link to="/agents/franchisees">Franchisees</Link> ·{' '}
          <Link to="/agents/team">Team tree</Link> · <Link to="/agents/commissions">Commissions</Link> ·{' '}
          <Link to="/agents">Public onboard form</Link>
        </p>
      </section>
    </>
  );
}
