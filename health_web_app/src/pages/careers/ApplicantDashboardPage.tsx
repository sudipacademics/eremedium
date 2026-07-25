import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, JobApplicationSummary } from '../../api';

export function ApplicantDashboardPage() {
  const [apps, setApps] = useState<JobApplicationSummary[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyCareerHub();
        if (cancelled) return;
        setApps(res.data.applications || []);
        setName(String(res.data.profile?.full_name || ''));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load hub');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = apps.filter((a) => (a.pipeline_stage || '') !== 'Rejected').length;

  return (
    <div className="careers-hr-page">
      <header className="careers-section-head">
        <div>
          <p className="brand-kicker">MY APPLICATION</p>
          <h1>Welcome{name ? `, ${name}` : ''}</h1>
          <p className="muted">Track applications and keep your profile ready for recruiters.</p>
        </div>
        <Link className="btn" to="/jobs">
          Browse openings
        </Link>
      </header>
      {error ? <div className="error">{error}</div> : null}
      <div className="careers-detail-grid">
        <article className="card">
          <h2>{apps.length}</h2>
          <p className="muted">Total applications</p>
        </article>
        <article className="card">
          <h2>{active}</h2>
          <p className="muted">In pipeline</p>
        </article>
        <article className="card">
          <h2>{apps.filter((a) => a.pipeline_stage === 'Offer').length}</h2>
          <p className="muted">Offers</p>
        </article>
      </div>
      <section style={{ marginTop: 20 }}>
        <div className="careers-section-head">
          <h2>Recent applications</h2>
          <Link to="/my/applications">View all</Link>
        </div>
        {apps.slice(0, 5).map((a) => (
          <div key={a.name} className="card" style={{ marginBottom: 10 }}>
            <strong>{a.job_opening || a.name}</strong>
            <p className="muted">
              {a.pipeline_stage || 'Received'} · Applied {a.applied_on || '—'}
            </p>
            <Link to={`/my/applications/${encodeURIComponent(a.name)}`}>Open</Link>
          </div>
        ))}
        {!error && apps.length === 0 ? <p className="muted">No applications yet. Apply from Job Openings.</p> : null}
      </section>
    </div>
  );
}
