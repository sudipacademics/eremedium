import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { assetUrl } from '../../config';

type DocRow = { application: string; job_opening?: string; label: string; url: string };

export function ApplicantDocumentsPage() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listMyCareerDocuments();
        if (!cancelled) setDocs(res.data.documents || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load documents');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="careers-hr-page">
      <h1>Documents</h1>
      <p className="muted">Files uploaded with your applications.</p>
      {error ? <div className="error">{error}</div> : null}
      <ul className="careers-doc-list card">
        {docs.map((d, i) => (
          <li key={`${d.application}-${d.label}-${i}`}>
            <span>
              <strong>{d.label}</strong>
              <span className="muted"> · {d.job_opening || d.application}</span>
            </span>
            <a href={assetUrl(d.url)} target="_blank" rel="noreferrer">
              Download
            </a>
          </li>
        ))}
      </ul>
      {docs.length === 0 && !error ? (
        <p className="muted">
          No documents yet. <Link to="/jobs">Apply for a role</Link> to upload your resume.
        </p>
      ) : null}
    </div>
  );
}
