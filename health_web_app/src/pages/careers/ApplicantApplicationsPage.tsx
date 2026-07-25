import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, JobApplicationSummary } from '../../api';

export function ApplicantApplicationsPage() {
  const [rows, setRows] = useState<JobApplicationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listMyApplications();
        if (!cancelled) setRows(res.data.applications || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load applications');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="careers-hr-page">
      <header className="careers-section-head">
        <div>
          <h1>Applied Jobs</h1>
          <p className="muted">Your applications from the careers portal</p>
        </div>
      </header>
      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="muted">Loading…</p> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Stage</th>
              <th>Applied</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.job_opening || r.name}</td>
                <td>
                  <span className="careers-stage-pill">{r.pipeline_stage || 'Received'}</span>
                </td>
                <td>{r.applied_on || '—'}</td>
                <td>
                  <Link to={`/my/applications/${encodeURIComponent(r.name)}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 ? <p className="muted">No applications yet.</p> : null}
    </div>
  );
}
