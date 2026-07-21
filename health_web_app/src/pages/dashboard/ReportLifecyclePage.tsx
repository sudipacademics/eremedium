import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { AuthorizeReportDialog } from '../../components/AuthorizeReportDialog';
import { ReportDownloadButton } from '../../components/ReportDownloadButton';
import {
  ReportLifecycleJourney,
  ReportLifecycleQueue,
  ReportLifecycleVerified,
} from '../../types/reportLifecycle';

export function ReportLifecyclePage() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<ReportLifecycleQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [authorizeTarget, setAuthorizeTarget] = useState<ReportLifecycleJourney | null>(null);

  const load = useCallback(async () => {
    const res = await api.getReportLifecycleQueue(50);
    setQueue(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'));
  }, [load]);

  async function runAction(id: string, label: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      setNotice(`${label} completed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function confirmAuthorize(notes: string) {
    if (!authorizeTarget) return;
    const journeyId = authorizeTarget.journey_id;
    setBusy(journeyId);
    setError(null);
    try {
      await api.authorizeLabReport({ journey_id: journeyId, pathologist_notes: notes || undefined });
      setAuthorizeTarget(null);
      setNotice('Report authorized — patient notified (SMS/email/WhatsApp when configured).');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
    } finally {
      setBusy(null);
    }
  }

  if (!queue && !error) return <p>Loading report lifecycle…</p>;

  const counts = queue?.counts;

  return (
    <>
      <section className="hero hero-compact">
        <h1>Report lifecycle</h1>
        <p className="muted">
          Pathologist sign-off → patient notification → dispatch. Completes the NABL report pipeline
          after lab result entry.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <span className="badge">
          Report review: <strong>{counts?.pending_review ?? 0}</strong>
        </span>
        <span className="badge">
          Verified (awaiting sign-off): <strong>{counts?.verified_reports ?? 0}</strong>
        </span>
        <span className="badge">
          Authorized: <strong>{counts?.authorized ?? 0}</strong>
        </span>
        <Link className="btn btn-sm secondary" to="/dashboard/lab-reports">
          ← Result entry
        </Link>
      </div>

      <h2>Verified reports — pathologist sign-off</h2>
      <LifecycleVerifiedTable
        rows={queue?.verified_reports || []}
        canAuthorize={queue?.can_authorize}
        busy={busy}
        onReview={(trfId) => navigate(`/dashboard/lab-reports/${encodeURIComponent(trfId)}`)}
        onAuthorize={(row) => {
          if (row.journey_id) {
            setAuthorizeTarget({
              journey_id: row.journey_id,
              patient_name: row.patient_name,
              status: 'Report Review',
              customer_trf: row.trf_id,
            });
          }
        }}
      />

      <h2 style={{ marginTop: 28 }}>Care journeys — report review</h2>
      <LifecycleJourneyTable
        rows={queue?.pending_review || []}
        canAuthorize={queue?.can_authorize}
        busy={busy}
        onReview={(row) =>
          row.customer_trf
            ? navigate(`/dashboard/lab-reports/${encodeURIComponent(row.customer_trf)}`)
            : undefined
        }
        onAuthorize={(row) => setAuthorizeTarget(row)}
      />

      <h2 style={{ marginTop: 28 }}>Authorized — dispatch to patient</h2>
      <LifecycleJourneyTable
        rows={queue?.authorized || []}
        showDispatch
        busy={busy}
        onDispatch={(row) =>
          void runAction(row.journey_id, 'Dispatch', async () => {
            await api.dispatchJourneyReport(row.journey_id);
          })
        }
        onDownload={(row) => row.journey_id}
      />

      <h2 style={{ marginTop: 28 }}>Recently dispatched</h2>
      <LifecycleJourneyTable rows={queue?.dispatched || []} readonly onDownload={(row) => row.journey_id} />

      <AuthorizeReportDialog
        open={!!authorizeTarget}
        subtitle={
          authorizeTarget
            ? `${authorizeTarget.patient_name || authorizeTarget.journey_id} · TRF ${authorizeTarget.customer_trf || '—'}`
            : undefined
        }
        busy={busy === authorizeTarget?.journey_id}
        onCancel={() => setAuthorizeTarget(null)}
        onConfirm={(notes) => void confirmAuthorize(notes)}
      />

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}

function LifecycleVerifiedTable({
  rows,
  canAuthorize,
  busy,
  onReview,
  onAuthorize,
}: {
  rows: ReportLifecycleVerified[];
  canAuthorize?: boolean;
  busy: string | null;
  onReview: (trfId: string) => void;
  onAuthorize: (row: ReportLifecycleVerified) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Report</th>
            <th>Patient</th>
            <th>TRF</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lab_report}>
              <td>{row.lab_report}</td>
              <td>{row.patient_name || '—'}</td>
              <td>{row.trf_id}</td>
              <td>
                <span className="badge">{row.report_status}</span>
              </td>
              <td style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm secondary" onClick={() => onReview(row.trf_id)}>
                  Review
                </button>
                {canAuthorize && row.journey_id ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy === row.journey_id}
                    onClick={() => onAuthorize(row)}
                  >
                    {busy === row.journey_id ? 'Working…' : 'Authorize'}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="muted">No verified reports awaiting sign-off.</p> : null}
    </div>
  );
}

function LifecycleJourneyTable({
  rows,
  canAuthorize,
  showDispatch,
  readonly,
  busy,
  onReview,
  onAuthorize,
  onDispatch,
  onDownload,
}: {
  rows: ReportLifecycleJourney[];
  canAuthorize?: boolean;
  showDispatch?: boolean;
  readonly?: boolean;
  busy?: string | null;
  onReview?: (row: ReportLifecycleJourney) => void;
  onAuthorize?: (row: ReportLifecycleJourney) => void;
  onDispatch?: (row: ReportLifecycleJourney) => void;
  onDownload?: (row: ReportLifecycleJourney) => string | undefined;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Journey</th>
            <th>Patient</th>
            <th>TRF</th>
            <th>Status</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.journey_id}>
              <td>{row.journey_id}</td>
              <td>{row.patient_name || '—'}</td>
              <td>{row.customer_trf || '—'}</td>
              <td>
                <span className="badge">{row.status}</span>
              </td>
              <td className="muted">{row.ago || '—'}</td>
              <td style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {!readonly && onReview && row.customer_trf ? (
                  <button type="button" className="btn btn-sm secondary" onClick={() => onReview(row)}>
                    Open report
                  </button>
                ) : null}
                {!readonly && canAuthorize && onAuthorize ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy === row.journey_id}
                    onClick={() => onAuthorize(row)}
                  >
                    Authorize
                  </button>
                ) : null}
                {showDispatch && onDispatch ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy === row.journey_id}
                    onClick={() => onDispatch(row)}
                  >
                    {busy === row.journey_id ? 'Dispatching…' : 'Dispatch'}
                  </button>
                ) : null}
                {onDownload && row.report_pdf ? (
                  <ReportDownloadButton
                    journeyId={row.journey_id}
                    label="PDF"
                    className="btn btn-sm secondary"
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="muted">Nothing in this queue.</p> : null}
    </div>
  );
}
