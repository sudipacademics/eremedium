import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { PatientAuthorizedReport } from '../types/reportLifecycle';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import './PatientReportsPage.css';

function formatWhen(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function PatientReportsPage() {
  const [reports, setReports] = useState<PatientAuthorizedReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyAuthorizedReports();
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

  useLiveRefresh(load, 20000);

  async function download(row: PatientAuthorizedReport) {
    setDownloading(row.journey_id);
    setError(null);
    setNotice(null);
    try {
      await api.downloadAuthorizedReport(
        row.journey_id,
        'nabl',
        `Lab_Report_${row.trf_id || row.journey_id}.pdf`,
      );
      setNotice('Report downloaded.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="pr-page">
      <section className="pr-hero">
        <div>
          <h1>Reports</h1>
          <p>Authorized lab reports for this mobile number. Sign-in is required — reports are never shared as public files.</p>
        </div>
        <div className="pr-hero-actions">
          <Link className="btn secondary" to="/bookings">
            My orders
          </Link>
          <button className="btn secondary" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      {loading && !reports.length ? <p className="muted">Loading your reports…</p> : null}
      {!loading && reports.length === 0 ? (
        <div className="pr-empty">
          <h2>No authorized reports yet</h2>
          <p>When your lab report is authorized, it appears here automatically. You can also check My orders for booking status.</p>
          <Link className="btn" to="/bookings">
            View orders
          </Link>
        </div>
      ) : null}

      <div className="pr-list">
        {reports.map((row) => (
          <article key={row.journey_id} className="pr-card">
            <div className="pr-card-main">
              <h2>{row.patient_name || 'Lab report'}</h2>
              <p>
                {row.trf_id ? `TRF ${row.trf_id}` : row.journey_id}
                {row.tests ? ` · ${row.tests}` : ''}
              </p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{row.report_status || row.status}</dd>
                </div>
                <div>
                  <dt>Authorized</dt>
                  <dd>{formatWhen(row.authorized_on || row.modified)}</dd>
                </div>
              </dl>
            </div>
            <div className="pr-card-actions">
              {row.trf_id ? (
                <Link className="btn secondary" to={`/bookings/${encodeURIComponent(row.trf_id)}`}>
                  Booking
                </Link>
              ) : null}
              <button
                className="btn"
                type="button"
                disabled={downloading === row.journey_id}
                onClick={() => void download(row)}
              >
                {downloading === row.journey_id ? 'Generating…' : 'Download PDF'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
