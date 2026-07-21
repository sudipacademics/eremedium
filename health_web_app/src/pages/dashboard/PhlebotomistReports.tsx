import { useCallback, useEffect, useState } from 'react';
import { api, PhlebotomistReport } from '../../api';
import { ReportDownloadButton } from '../../components/ReportDownloadButton';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useViewMode } from '../../hooks/useViewMode';

function ReportCard({ report }: { report: PhlebotomistReport }) {
  return (
    <article className="card collection-card">
      <div className="collection-card-head">
        <strong>{report.patient_name}</strong>
        <span className="badge">{report.status}</span>
      </div>
      <p className="muted">TRF {report.trf_id}</p>
      <p className="collection-test">{report.test_name || report.test_labels?.join(', ') || 'Diagnostics'}</p>
      {report.authorized_on && (
        <p className="muted">Authorized {String(report.authorized_on).replace('T', ' ').slice(0, 16)}</p>
      )}
      {report.report_pdf ? (
        <ReportDownloadButton
          journeyId={report.journey_id}
          fileName={`NABL_Report_${report.trf_id}.pdf`}
          label="Download NABL report (PDF)"
        />
      ) : (
        <p className="muted">PDF not attached yet</p>
      )}
    </article>
  );
}

export function PhlebotomistReports() {
  const [reports, setReports] = useState<PhlebotomistReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useViewMode('phlebo-view-mode');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPhlebotomistReports();
      setReports(res.data.reports || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load, 30000);

  return (
    <>
      <section className="hero hero-compact">
        <h1>Lab reports</h1>
        <p>NABL-formatted PDFs appear here after the lab authorizes results for your collected samples.</p>
      </section>

      <div className="toolbar">
        <h2>Ready to download</h2>
        <div className="toolbar-actions">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading reports…</p>}

      {!loading && reports.length === 0 && (
        <p className="muted">No authorized reports yet. They will show up once processing and sign-off are complete.</p>
      )}

      {viewMode === 'cards' ? (
        <div className="collection-grid">
          {reports.map((r) => (
            <ReportCard key={r.journey_id} report={r} />
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table collection-list-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>TRF</th>
                <th>Test</th>
                <th>Authorized</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.journey_id}>
                  <td>{r.patient_name}</td>
                  <td>{r.trf_id}</td>
                  <td>{r.test_name || r.test_labels?.join(', ') || 'Diagnostics'}</td>
                  <td>{r.authorized_on ? String(r.authorized_on).replace('T', ' ').slice(0, 16) : '—'}</td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td>
                    {r.report_pdf ? (
                      <ReportDownloadButton
                        journeyId={r.journey_id}
                        fileName={`NABL_Report_${r.trf_id}.pdf`}
                        label="Download PDF"
                        className="btn btn-sm"
                      />
                    ) : (
                      <span className="muted">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
