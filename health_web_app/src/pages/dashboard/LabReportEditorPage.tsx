import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { hasAnyRole, ROLES } from '../../auth/roles';
import {
  ABNORMAL_FLAGS,
  ABNORMAL_FLAG_LABELS,
  LabReportDetail,
  LabReportParam,
  LabReportParamEdit,
} from '../../types/labReport';

const LOCKED_STATUSES = ['Authorized', 'Printed'];

function rangeLabel(row: LabReportParam) {
  const lo = row.lower_range;
  const hi = row.upper_range;
  if (lo != null && hi != null) return `${lo} – ${hi}`;
  if (lo != null) return `≥ ${lo}`;
  if (hi != null) return `≤ ${hi}`;
  return '—';
}

export function LabReportEditorPage() {
  const { trfId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = useState<LabReportDetail | null>(null);
  const [rows, setRows] = useState<LabReportParam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const canAuthorize = hasAnyRole(user?.roles || [], [
    ROLES.PATHOLOGIST,
    ROLES.ADMIN,
    ROLES.SYSTEM_MANAGER,
  ]);

  const applyDetail = useCallback((d: LabReportDetail) => {
    setDetail(d);
    setRows(d.parameters);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    const res = await api.getLabReportDetail({ trf_id: trfId });
    applyDetail(res.data);
  }, [trfId, applyDetail]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report'));
  }, [load]);

  const locked = useMemo(
    () => (detail ? LOCKED_STATUSES.includes(detail.report_status) : false),
    [detail],
  );

  function updateRow(name: string, patch: Partial<LabReportParam>) {
    setRows((prev) => prev.map((r) => (r.name === name ? { ...r, ...patch } : r)));
    setDirty(true);
    setNotice(null);
  }

  function editPayload(): LabReportParamEdit[] {
    return rows.map((r) => ({
      name: r.name,
      result_value: r.result_value,
      unit: r.unit,
      method: r.method,
      abnormal_flag: r.abnormal_flag,
      interpretation: r.interpretation,
      include_in_report: r.include_in_report,
    }));
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!detail) return;
    await run('save', async () => {
      const res = await api.saveLabReportParameters(detail.lab_report, editPayload());
      applyDetail(res.data);
      setNotice('Results saved.');
    });
  }

  async function importMachine() {
    if (!detail) return;
    await run('import', async () => {
      const res = await api.importMachineResults(detail.lab_report);
      setNotice(`Imported ${res.data.imported} machine result(s).`);
      await load();
    });
  }

  async function recalc() {
    if (!detail) return;
    await run('recalc', async () => {
      await api.recalculateLabReport(detail.lab_report);
      setNotice('Calculated parameters updated.');
      await load();
    });
  }

  async function finalize() {
    if (!detail) return;
    if (dirty) {
      await save();
    }
    await run('finalize', async () => {
      const res = await api.finalizeLabReport(detail.lab_report);
      setNotice(
        res.data.complete
          ? 'Report finalized and sent for pathologist review.'
          : 'Report sent for review (some expected results still missing).',
      );
      await load();
    });
  }

  async function preview() {
    if (!detail) return;
    await run('preview', async () => {
      const html = await api.getLabReportPreviewHtml(detail.lab_report);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
      } else {
        setError('Popup blocked — allow popups to preview the report.');
      }
    });
  }

  async function authorize() {
    if (!detail?.care_journey) {
      setError('No linked care journey to authorize.');
      return;
    }
    const notes = window.prompt('Pathologist notes (optional):', '') ?? undefined;
    await run('authorize', async () => {
      await api.authorizeLabReport({ journey_id: detail.care_journey!, pathologist_notes: notes });
      setNotice('Report authorized.');
      await load();
    });
  }

  if (!detail && !error) return <p>Loading lab report…</p>;

  return (
    <>
      <section className="hero hero-compact">
        <h1>Lab report — {detail?.patient_name || trfId}</h1>
        <p className="muted">
          {detail ? (
            <>
              {detail.lab_report} · {detail.department} ·{' '}
              <span className="badge">{detail.report_status}</span> · TRF {detail.customer_trf}
            </>
          ) : null}
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      {locked ? (
        <div className="notice">This report is {detail?.report_status.toLowerCase()} — results are read-only.</div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0 20px' }}>
        <button type="button" className="btn" disabled={locked || busy === 'save'} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save results'}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={locked || busy === 'import'}
          onClick={() => void importMachine()}
        >
          {busy === 'import' ? 'Importing…' : 'Import machine results'}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={locked || busy === 'recalc'}
          onClick={() => void recalc()}
        >
          {busy === 'recalc' ? 'Working…' : 'Recalculate derived'}
        </button>
        <button type="button" className="btn secondary" disabled={busy === 'preview'} onClick={() => void preview()}>
          {busy === 'preview' ? 'Opening…' : 'Preview NABL PDF'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={locked || busy === 'finalize'}
          onClick={() => void finalize()}
        >
          {busy === 'finalize' ? 'Finalizing…' : 'Finalize & send for review'}
        </button>
        {canAuthorize && detail?.report_status === 'Verified' ? (
          <button type="button" className="btn" disabled={busy === 'authorize'} onClick={() => void authorize()}>
            {busy === 'authorize' ? 'Authorizing…' : 'Authorize report'}
          </button>
        ) : null}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Inc.</th>
              <th>Parameter</th>
              <th>Result</th>
              <th>Unit</th>
              <th>Reference</th>
              <th>Flag</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} style={row.is_calculated ? { background: 'rgba(59,130,246,0.06)' } : undefined}>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!!row.include_in_report}
                    disabled={locked}
                    onChange={(e) => updateRow(row.name, { include_in_report: e.target.checked ? 1 : 0 })}
                  />
                </td>
                <td>
                  <strong>{row.description}</strong>
                  {row.parameter_code ? <span className="muted"> · {row.parameter_code}</span> : null}
                  {row.is_calculated ? <span className="badge" style={{ marginLeft: 6 }}>calc</span> : null}
                  {row.test_name ? <div className="muted" style={{ fontSize: 12 }}>{row.test_name}</div> : null}
                </td>
                <td>
                  <input
                    style={{ width: 90 }}
                    value={row.result_value}
                    disabled={locked || !!row.is_calculated}
                    onChange={(e) => updateRow(row.name, { result_value: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    style={{ width: 70 }}
                    value={row.unit}
                    disabled={locked}
                    onChange={(e) => updateRow(row.name, { unit: e.target.value })}
                  />
                </td>
                <td className="muted">{rangeLabel(row)}</td>
                <td>
                  <select
                    value={row.abnormal_flag || ''}
                    disabled={locked}
                    onChange={(e) => updateRow(row.name, { abnormal_flag: e.target.value })}
                  >
                    {ABNORMAL_FLAGS.map((f) => (
                      <option key={f || 'none'} value={f}>
                        {ABNORMAL_FLAG_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    style={{ width: 120 }}
                    value={row.method}
                    disabled={locked}
                    onChange={(e) => updateRow(row.name, { method: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="muted">No parameters on this report yet.</p> : null}
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-sm secondary" onClick={() => navigate('/dashboard/lab-reports')}>
          ← Back to lab reports
        </button>
        {'  '}
        <Link to={`/bookings/${encodeURIComponent(trfId)}`}>View TRF</Link>
      </p>
    </>
  );
}
