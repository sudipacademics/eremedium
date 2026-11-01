import { useEffect, useState } from 'react';
import { api, type HireImportResult, type HireJob } from '../../../api';
import type { HiringNav } from '../PeopleRecruitmentPage';
import { MANUAL_SOURCES, errMsg, fileToBase64 } from './hiringUtils';

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Name',
  mobile: 'Mobile',
  email: 'Email',
  city: 'City',
  experience_years: 'Experience',
  qualification: 'Qualification',
  current_company: 'Company',
  current_ctc: 'Current salary',
  expected_ctc: 'Expected salary',
  notice_period: 'Notice period',
  resume_url: 'Resume link',
};

export function HiringImportTab({ go, initialJob }: { go: HiringNav; initialJob: string }) {
  const [jobs, setJobs] = useState<HireJob[]>([]);
  const [job, setJob] = useState(initialJob);
  const [source, setSource] = useState<string>('Naukri');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<HireImportResult | null>(null);
  const [done, setDone] = useState<HireImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listHireJobs()
      .then((res) => setJobs(res.data.jobs.filter((j) => j.status !== 'Closed' || j.name === initialJob)))
      .catch((e) => setError(errMsg(e, 'Could not load jobs')));
  }, [initialJob]);

  function reset() {
    setPreview(null);
    setDone(null);
    setError('');
  }

  async function run(dryRun: boolean) {
    if (!file) {
      setError('Choose the file exported from the portal');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.importHireCandidates({
        job,
        source,
        filename: file.name,
        content_b64: await fileToBase64(file),
        dry_run: dryRun,
      });
      if (dryRun) setPreview(res.data);
      else {
        setDone(res.data);
        setPreview(null);
      }
    } catch (e) {
      setError(errMsg(e, 'Import failed'));
    } finally {
      setBusy(false);
    }
  }

  const result = done || preview;
  const previewCols = result?.preview.length
    ? Object.keys(FIELD_LABELS).filter((k) => result.preview.some((r) => r[k] !== undefined))
    : [];

  return (
    <div className="hire-stack">
      <section className="hrms-panel">
        <header>
          <h2>Import applicants from a portal</h2>
          <span>Excel (.xlsx) or CSV, up to 2,000 rows</span>
        </header>

        <ol className="hire-steps">
          <li>
            <b>Naukri:</b> open the job's responses (or a Resdex search), select candidates and choose <i>Download / Export to
            Excel</i>.
          </li>
          <li>
            <b>WorkIndia:</b> open the job's applied candidates and use <i>Download</i> to get the Excel sheet.
          </li>
          <li>Pick the job and source below, choose the file, and check the preview before importing.</li>
        </ol>

        <div className="hire-filters">
          <select value={job} onChange={(e) => { setJob(e.target.value); reset(); }} aria-label="Job">
            <option value="">No job (general pool)</option>
            {jobs.map((j) => (
              <option key={j.name} value={j.name}>
                {j.title} {j.status !== 'Open' ? `(${j.status})` : ''}
              </option>
            ))}
          </select>
          <select value={source} onChange={(e) => { setSource(e.target.value); reset(); }} aria-label="Source">
            {MANUAL_SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              reset();
            }}
          />
          <button type="button" className="hrms-btn" disabled={busy || !file} onClick={() => void run(true)}>
            {busy && !preview ? 'Reading…' : 'Preview'}
          </button>
        </div>
        {error ? <p className="hire-error">{error}</p> : null}
      </section>

      {result ? (
        <section className="hrms-panel">
          <header>
            <h2>{done ? 'Import finished' : 'Preview — nothing saved yet'}</h2>
            <span>{result.total_rows} rows in file</span>
          </header>

          <div className="hire-import-counts">
            <div className="ok">
              <strong>{result.created}</strong>
              <span>{done ? 'added' : 'will be added'}</span>
            </div>
            <div>
              <strong>{result.merged}</strong>
              <span>{done ? 'merged into existing' : 'already exist (will merge)'}</span>
            </div>
            <div className={result.skipped ? 'warn' : ''}>
              <strong>{result.skipped}</strong>
              <span>skipped</span>
            </div>
          </div>

          <p className="muted hire-small">
            Columns found:{' '}
            {Object.entries(result.columns)
              .map(([field, header]) => `${FIELD_LABELS[field] || field} ← "${header}"`)
              .join(' · ')}
          </p>

          {!done && result.preview.length ? (
            <div className="hrms-table-wrap">
              <table className="hrms-table">
                <thead>
                  <tr>
                    {previewCols.map((k) => (
                      <th key={k}>{FIELD_LABELS[k]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((row, i) => (
                    <tr key={i}>
                      {previewCols.map((k) => (
                        <td key={k}>{row[k] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted hire-small">Showing the first {result.preview.length} valid rows.</p>
            </div>
          ) : null}

          {result.errors.length ? (
            <details className="hire-errors">
              <summary>{result.errors.length} row(s) with problems</summary>
              <ul>
                {result.errors.map((err, i) => (
                  <li key={i}>
                    Row {err.row}
                    {err.name ? ` (${err.name})` : ''}: {err.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="hrms-modal-actions">
            {done ? (
              <button type="button" className="hrms-btn" onClick={() => go('candidates', { job, stage: 'New' })}>
                Review new candidates
              </button>
            ) : (
              <>
                <button type="button" className="hrms-btn secondary" onClick={reset}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="hrms-btn"
                  disabled={busy || result.created + result.merged === 0}
                  onClick={() => void run(false)}
                >
                  {busy ? 'Importing…' : `Import ${result.created + result.merged} candidate(s)`}
                </button>
              </>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
