import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { LabReportQueue } from '../../types/labReport';

function statusBadge(status: string | null) {
  if (!status) return <span className="badge" style={{ opacity: 0.5 }}>No report</span>;
  return <span className="badge">{status}</span>;
}

export function LabReportsQueuePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<LabReportQueue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getLabReportQueue(200);
    setData(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'));
  }, [load]);

  if (!data && !error) return <p>Loading lab report queue…</p>;

  const queue = data?.queue || [];

  return (
    <>
      <section className="hero hero-compact">
        <h1>Lab result entry</h1>
        <p className="muted">
          Enter results for samples in the lab, then finalize for pathologist review. Sign-off and
          dispatch are on the report lifecycle page.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <span className="badge">
          Awaiting entry: <strong>{data?.queue_count || 0}</strong>
        </span>
        <span className="badge">
          Verified (sign-off): <strong>{data?.review_count || 0}</strong>
        </span>
        <Link className="btn btn-sm" to="/dashboard/report-lifecycle">
          Report lifecycle →
        </Link>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>TRF</th>
              <th>Patient</th>
              <th>Tests</th>
              <th>TRF status</th>
              <th>Report</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => (
              <tr key={row.trf_id}>
                <td>{row.trf_id}</td>
                <td>{row.patient_name || '—'}</td>
                <td className="muted">{row.test_required || '—'}</td>
                <td>
                  <span className="badge">{row.order_status}</span>
                </td>
                <td>{statusBadge(row.report_status)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => navigate(`/dashboard/lab-reports/${encodeURIComponent(row.trf_id)}`)}
                  >
                    {row.lab_report ? 'Enter results' : 'Open report'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!queue.length ? <p className="muted">No samples awaiting result entry.</p> : null}
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
