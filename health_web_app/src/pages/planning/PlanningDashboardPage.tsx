import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import './planning-portal.css';

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

type PlanRow = {
  name: string;
  title: string;
  designation?: string;
  department?: string;
  status?: string;
  desired_ctc?: number;
  market_median_ctc?: number;
  job_opening?: string;
};

export function PlanningDashboardPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const [list, catalog] = await Promise.all([
          api.listStaffPlans(),
          api.getStaffPlanningCatalog().catch(() => null),
        ]);
        if (!active) return;
        setPlans(list.data.plans || []);
        if (catalog?.data?.disclaimer) setDisclaimer(catalog.data.disclaimer);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load plans');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="muted">Loading staff plans…</p>;

  return (
    <div>
      <section className="planning-hero">
        <h1>Staff planning</h1>
        <p>
          Create role / KPI / KRA based hiring plans, estimate market CTC, set desired CTC, and publish
          openings to Careers.
        </p>
      </section>

      {disclaimer ? <div className="planning-alert info">{disclaimer}</div> : null}
      {error ? <div className="planning-alert err">{error}</div> : null}

      <div className="planning-actions" style={{ marginBottom: 14 }}>
        <Link className="btn primary" to="/planning/new" style={{ background: '#3d2a1d', color: '#fff', padding: '10px 14px', borderRadius: 11, textDecoration: 'none', fontWeight: 650 }}>
          New staff plan
        </Link>
      </div>

      <section className="planning-card">
        <h2>Plans</h2>
        {!plans.length ? <p className="muted">No plans yet.</p> : null}
        <table className="planning-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Role</th>
              <th>Status</th>
              <th>Market</th>
              <th>Desired</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.name}>
                <td>{p.title}</td>
                <td>
                  {p.designation}
                  {p.department ? ` · ${p.department}` : ''}
                </td>
                <td>{p.status}</td>
                <td>{money(p.market_median_ctc)}</td>
                <td>{money(p.desired_ctc)}</td>
                <td>
                  <Link to={`/planning/${encodeURIComponent(p.name)}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
