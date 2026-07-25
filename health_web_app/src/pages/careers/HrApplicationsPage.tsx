import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, JobApplicationSummary } from '../../api';

export function HrApplicationsPage() {
  const [rows, setRows] = useState<JobApplicationSummary[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(nextStage = stage) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listJobApplications({
        stage: nextStage || undefined,
        limit: 100,
      });
      setRows(res.data.applications || []);
      setStages(res.data.stages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load applications');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="careers-hr-page">
      <header className="careers-section-head">
        <div>
          <h1>Applications</h1>
          <p className="muted">Recruitment inbox from career.e-remedium.in</p>
        </div>
        <label>
          Stage
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              void load(e.target.value);
            }}
          >
            <option value="">All stages</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Role</th>
              <th>Source</th>
              <th>Stage</th>
              <th>Applied</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <strong>{r.applicant_name || r.name}</strong>
                  <div className="muted">{r.email_id}</div>
                </td>
                <td>{r.job_opening}</td>
                <td>{r.source || '—'}</td>
                <td>
                  <span className="careers-stage-pill">{r.pipeline_stage || 'Received'}</span>
                </td>
                <td>{r.applied_on || '—'}</td>
                <td>
                  <Link to={`/hr/applications/${encodeURIComponent(r.name)}`}>Open</Link>
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
