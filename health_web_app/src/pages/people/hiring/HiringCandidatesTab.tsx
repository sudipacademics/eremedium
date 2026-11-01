import { useCallback, useEffect, useState } from 'react';
import { api, type HireCandidateRow, type HireJob } from '../../../api';
import { HIRE_SOURCES, HIRE_STAGES, STAGE_TONE, errMsg, fmtAgo, fmtDateTime, inr } from './hiringUtils';
import { CandidateDrawer } from './CandidateDrawer';
import { CandidateFormModal } from './CandidateFormModal';

export function HiringCandidatesTab({
  initialJob,
  initialStage,
  focusCandidate,
}: {
  initialJob: string;
  initialStage: string;
  focusCandidate: string;
}) {
  const [jobs, setJobs] = useState<HireJob[]>([]);
  const [job, setJob] = useState(initialJob);
  const [stage, setStage] = useState(initialStage === 'All' ? '' : initialStage);
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<HireCandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(focusCandidate);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api
      .listHireJobs()
      .then((res) => setJobs(res.data.jobs))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listHireCandidates({ job, stage, source, q: query, limit: 300 });
      setRows(res.data.candidates);
      setTotal(res.data.total);
    } catch (e) {
      setError(errMsg(e, 'Could not load candidates'));
    } finally {
      setLoading(false);
    }
  }, [job, stage, source, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="hire-stack">
      <section className="hrms-panel">
        <header>
          <h2>
            Candidates <span className="muted hire-small">{total} found</span>
          </h2>
          <button type="button" className="hrms-btn" onClick={() => setAdding(true)}>
            + Add candidate
          </button>
        </header>

        <div className="hire-filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, email, city" />
          <select value={job} onChange={(e) => setJob(e.target.value)} aria-label="Job">
            <option value="">All jobs</option>
            {jobs.map((j) => (
              <option key={j.name} value={j.name}>
                {j.title} {j.status !== 'Open' ? `(${j.status})` : ''}
              </option>
            ))}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
            <option value="Active">Active (not closed)</option>
            <option value="">All stages</option>
            {HIRE_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            {HIRE_SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>

        {error ? <p className="hire-error">{error}</p> : null}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length ? (
          <div className="hrms-table-wrap">
            <table className="hrms-table hire-click-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>Stage</th>
                  <th>Source</th>
                  <th>Exp.</th>
                  <th>Expected</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.name} onClick={() => setOpen(c.name)} className={open === c.name ? 'selected' : ''}>
                    <td>
                      <b>{c.full_name}</b>
                      <div className="muted hire-small">{[c.mobile, c.city].filter(Boolean).join(' · ') || c.email}</div>
                    </td>
                    <td>{c.job_title || <span className="muted">—</span>}</td>
                    <td>
                      <span className={`hire-stage tone-${STAGE_TONE[c.stage]}`}>{c.stage}</span>
                      {c.stage === 'Interview' && c.interview_at ? (
                        <div className="muted hire-small">{fmtDateTime(c.interview_at)}</div>
                      ) : null}
                    </td>
                    <td>{c.source}</td>
                    <td>{c.experience_years != null ? `${c.experience_years} yr` : '—'}</td>
                    <td>{inr(c.expected_ctc)}</td>
                    <td className="muted hire-nowrap">{fmtAgo(c.last_activity || c.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="hire-empty">
            <p>No candidates match these filters.</p>
          </div>
        )}
      </section>

      {open ? <CandidateDrawer name={open} jobs={jobs} onClose={() => setOpen('')} onChanged={() => void load()} /> : null}

      {adding ? (
        <CandidateFormModal
          jobs={jobs}
          defaultJob={job}
          onClose={() => setAdding(false)}
          onSaved={(name) => {
            setAdding(false);
            void load();
            setOpen(name);
          }}
        />
      ) : null}
    </div>
  );
}
