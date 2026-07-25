import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, JobApplicationDetail } from '../../api';
import { assetUrl } from '../../config';

export function ApplicantApplicationDetailPage() {
  const { applicationId = '' } = useParams();
  const [detail, setDetail] = useState<JobApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyApplication(decodeURIComponent(applicationId));
        if (!cancelled) setDetail(res.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load application');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (error && !detail) {
    return (
      <div className="page">
        <div className="error">{error}</div>
        <Link to="/my/applications">Back</Link>
      </div>
    );
  }
  if (!detail) return <p className="muted">Loading…</p>;

  const stages = (detail.stages || []).filter((s) => s !== 'Rejected');
  const current = detail.pipeline_stage || 'Received';

  return (
    <div className="careers-hr-detail">
      <Link to="/my/applications" className="muted">
        ← Applied jobs
      </Link>
      <header className="careers-hr-detail-head">
        <div>
          <h1>{detail.opening?.job_title || detail.job_opening}</h1>
          <p className="muted">
            {detail.applicant_name} · ID {detail.name} · Applied {detail.applied_on || '—'}
          </p>
        </div>
        <span className="careers-stage-pill">{current}</span>
      </header>
      <ol className="careers-pipeline">
        {stages.map((s) => (
          <li key={s} className={s === current ? 'active' : stages.indexOf(s) < stages.indexOf(current) ? 'done' : ''}>
            {s}
          </li>
        ))}
      </ol>
      <section className="card">
        <h2>Documents</h2>
        <ul className="careers-doc-list">
          {(['resume', 'photo', 'aadhaar', 'other'] as const).map((key) => {
            const url = detail.documents?.[key];
            return (
              <li key={key}>
                <strong>{key}</strong>
                {url ? (
                  <a href={assetUrl(url)} target="_blank" rel="noreferrer">
                    Download
                  </a>
                ) : (
                  <span className="muted">Not uploaded</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
