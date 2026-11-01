import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type HireCandidateDetail, type HireJob, type HireStage } from '../../../api';
import {
  STAGE_TONE,
  errMsg,
  fileToBase64,
  fmtDate,
  fmtDateTime,
  inr,
  localDateTimeToServer,
  todayIso,
} from './hiringUtils';
import { CandidateFormModal } from './CandidateFormModal';

type Props = {
  name: string;
  jobs: HireJob[];
  onClose: () => void;
  onChanged: () => void;
};

const STAGE_ACTION: Record<HireStage, string> = {
  New: 'Back to New',
  Screening: 'Move to Screening',
  Interview: 'Schedule interview',
  Offer: 'Make offer',
  Hired: 'Hire',
  Rejected: 'Reject',
  Withdrawn: 'Candidate withdrew',
};

export function CandidateDrawer({ name, jobs, onClose, onChanged }: Props) {
  const [c, setC] = useState<HireCandidateDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState<HireStage | null>(null);
  const [note, setNote] = useState('');
  const [noteKind, setNoteKind] = useState<'Note' | 'Call'>('Note');
  const [editing, setEditing] = useState(false);
  const [hiring, setHiring] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.getHireCandidate(name);
      setC(res.data);
    } catch (e) {
      setError(errMsg(e, 'Could not load the candidate'));
    }
  }, [name]);

  useEffect(() => {
    setC(null);
    setMoveTo(null);
    void load();
  }, [load]);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.addHireNote(name, note.trim(), noteKind);
      setC(res.data);
      setNote('');
      onChanged();
    } catch (err) {
      setError(errMsg(err, 'Could not add the note'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadResume(file: File) {
    setBusy(true);
    setError('');
    try {
      await api.saveHireCandidate({ name }, { filename: file.name, content_b64: await fileToBase64(file) });
      await load();
    } catch (err) {
      setError(errMsg(err, 'Could not upload the resume'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadResume() {
    setError('');
    try {
      await api.downloadHireResume(name, `${c?.full_name || name}-resume`);
    } catch (err) {
      setError(errMsg(err, 'Could not download the resume'));
    }
  }

  return (
    <div className="hire-drawer-backdrop" onClick={onClose}>
      <aside className="hire-drawer" onClick={(e) => e.stopPropagation()} aria-label="Candidate details">
        <div className="hrms-modal-head">
          <div>
            <p className="hrms-modal-kicker">{name}</p>
            <h2>{c?.full_name || 'Candidate'}</h2>
            {c ? (
              <p className="muted hire-small">
                {c.job_title || 'No job'} · {c.source} · added {fmtDate(c.created)}
              </p>
            ) : null}
          </div>
          <button type="button" className="hrms-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!c ? (
          error ? <p className="hire-error">{error}</p> : <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="hire-stage-bar">
              <span className={`hire-stage tone-${STAGE_TONE[c.stage]}`}>{c.stage}</span>
              {c.employee ? <span className="hrms-tag ok">Employee {c.employee}</span> : null}
            </div>

            {c.stage !== 'Hired' ? (
              <div className="hire-actions">
                {c.allowed_stages.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`hrms-btn ${s === 'Rejected' || s === 'Withdrawn' ? 'secondary danger' : s === 'Screening' || s === 'New' ? 'secondary' : ''}`}
                    onClick={() => setMoveTo(s)}
                  >
                    {STAGE_ACTION[s]}
                  </button>
                ))}
                {c.can_hire ? (
                  <button type="button" className="hrms-btn hire-btn-hire" onClick={() => setHiring(true)}>
                    Hire → create employee
                  </button>
                ) : null}
              </div>
            ) : null}

            {moveTo ? (
              <StageForm
                candidate={c}
                to={moveTo}
                onCancel={() => setMoveTo(null)}
                onDone={(next) => {
                  setC(next);
                  setMoveTo(null);
                  onChanged();
                }}
              />
            ) : null}

            <dl className="hire-facts">
              <div>
                <dt>Mobile</dt>
                <dd>{c.mobile ? <a href={`tel:+91${c.mobile}`}>{c.mobile}</a> : '—'}</dd>
              </div>
              <div>
                <dt>WhatsApp</dt>
                <dd>
                  {c.mobile ? (
                    <a href={`https://wa.me/91${c.mobile}`} target="_blank" rel="noreferrer">
                      Chat
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</dd>
              </div>
              <div>
                <dt>City</dt>
                <dd>{c.city || '—'}</dd>
              </div>
              <div>
                <dt>Experience</dt>
                <dd>{c.experience_years != null ? `${c.experience_years} years` : '—'}</dd>
              </div>
              <div>
                <dt>Qualification</dt>
                <dd>{c.qualification || '—'}</dd>
              </div>
              <div>
                <dt>Current company</dt>
                <dd>{c.current_company || '—'}</dd>
              </div>
              <div>
                <dt>Notice period</dt>
                <dd>{c.notice_period || '—'}</dd>
              </div>
              <div>
                <dt>Current / expected</dt>
                <dd>
                  {inr(c.current_ctc)} / {inr(c.expected_ctc)}
                </dd>
              </div>
              {c.interview_at ? (
                <div>
                  <dt>Interview</dt>
                  <dd>
                    {fmtDateTime(c.interview_at)} ({c.interview_mode || 'In person'})
                  </dd>
                </div>
              ) : null}
              {c.offered_ctc ? (
                <div>
                  <dt>Offer</dt>
                  <dd>
                    {inr(c.offered_ctc)}/month, joining {fmtDate(c.joining_date)}
                  </dd>
                </div>
              ) : null}
              {c.reject_reason && (c.stage === 'Rejected' || c.stage === 'Withdrawn') ? (
                <div>
                  <dt>Reason</dt>
                  <dd>{c.reject_reason}</dd>
                </div>
              ) : null}
            </dl>

            <div className="hire-resume">
              {c.has_resume ? (
                <button type="button" className="hrms-btn secondary" onClick={() => void downloadResume()}>
                  Download resume
                </button>
              ) : (
                <span className="muted">No resume on file</span>
              )}
              {c.resume_url ? (
                <a href={c.resume_url} target="_blank" rel="noreferrer" className="hrms-btn secondary">
                  Portal profile
                </a>
              ) : null}
              <label className="hrms-btn secondary hire-file-btn">
                {c.has_resume ? 'Replace resume' : 'Upload resume'}
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void uploadResume(file);
                  }}
                />
              </label>
              <button type="button" className="hrms-btn secondary" onClick={() => setEditing(true)}>
                Edit details
              </button>
            </div>

            <form className="hire-note-form" onSubmit={addNote}>
              <select value={noteKind} onChange={(e) => setNoteKind(e.target.value as 'Note' | 'Call')} aria-label="Note type">
                <option value="Note">Note</option>
                <option value="Call">Call log</option>
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note or call outcome…" />
              <button type="submit" className="hrms-btn" disabled={busy || !note.trim()}>
                Add
              </button>
            </form>

            {error ? <p className="hire-error">{error}</p> : null}

            <h3 className="hire-h3">Timeline</h3>
            <ul className="hire-timeline">
              {c.activities.map((a, i) => (
                <li key={i} className={`kind-${a.kind.toLowerCase()}`}>
                  <div>
                    <b>{a.kind === 'Stage' && a.to_stage ? `${a.from_stage || 'New'} → ${a.to_stage}` : a.kind}</b>
                    {a.body ? <p>{a.body}</p> : null}
                  </div>
                  <small className="muted">
                    {fmtDateTime(a.at)}
                    {a.actor ? ` · ${a.actor.split('@')[0]}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {editing && c ? (
        <CandidateFormModal
          jobs={jobs}
          candidate={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
            onChanged();
          }}
        />
      ) : null}

      {hiring && c ? (
        <HireModal
          candidate={c}
          jobs={jobs}
          onClose={() => setHiring(false)}
          onDone={() => {
            void load();
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function StageForm({
  candidate,
  to,
  onCancel,
  onDone,
}: {
  candidate: HireCandidateDetail;
  to: HireStage;
  onCancel: () => void;
  onDone: (c: HireCandidateDetail) => void;
}) {
  const [interviewAt, setInterviewAt] = useState('');
  const [mode, setMode] = useState(candidate.interview_mode || 'In person');
  const [offered, setOffered] = useState(candidate.offered_ctc ? String(candidate.offered_ctc) : candidate.expected_ctc ? String(candidate.expected_ctc) : '');
  const [joining, setJoining] = useState(candidate.joining_date || '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.moveHireCandidate({
        candidate: candidate.name,
        to_stage: to,
        note: note.trim(),
        interview_at: to === 'Interview' ? localDateTimeToServer(interviewAt) : undefined,
        interview_mode: to === 'Interview' ? mode : undefined,
        offered_ctc: to === 'Offer' ? Number(offered) : undefined,
        joining_date: to === 'Offer' ? joining : undefined,
        reason: to === 'Rejected' || to === 'Withdrawn' ? reason.trim() : undefined,
      });
      onDone(res.data);
    } catch (err) {
      setError(errMsg(err, 'Could not move the candidate'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="hire-stage-form hrms-employee-form" onSubmit={submit}>
      <h3>{STAGE_ACTION[to]}</h3>
      <div className="hrms-form-grid">
        {to === 'Interview' ? (
          <>
            <label>
              Date & time *
              <input type="datetime-local" required value={interviewAt} onChange={(e) => setInterviewAt(e.target.value)} />
            </label>
            <label>
              Mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option>In person</option>
                <option>Phone</option>
                <option>Video</option>
              </select>
            </label>
          </>
        ) : null}
        {to === 'Offer' ? (
          <>
            <label>
              Offered salary (₹ / month) *
              <input type="number" min={1} required value={offered} onChange={(e) => setOffered(e.target.value)} />
            </label>
            <label>
              Joining date *
              <input type="date" min={todayIso()} required value={joining} onChange={(e) => setJoining(e.target.value)} />
            </label>
          </>
        ) : null}
        {to === 'Rejected' || to === 'Withdrawn' ? (
          <label className="span-2">
            Reason *
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={to === 'Rejected' ? 'e.g. Not enough experience' : 'e.g. Took another offer'}
            />
          </label>
        ) : null}
        <label className="span-2">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {error ? <p className="hire-error">{error}</p> : null}
      <div className="hrms-modal-actions">
        <button type="button" className="hrms-btn secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="hrms-btn" disabled={busy}>
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </form>
  );
}

function HireModal({
  candidate,
  jobs,
  onClose,
  onDone,
}: {
  candidate: HireCandidateDetail;
  jobs: HireJob[];
  onClose: () => void;
  onDone: () => void;
}) {
  const job = jobs.find((j) => j.name === candidate.job);
  const [workEmail, setWorkEmail] = useState(candidate.email || '');
  const [department, setDepartment] = useState(job?.department || '');
  const [designation, setDesignation] = useState(job?.title || '');
  const [joining, setJoining] = useState(candidate.joining_date || todayIso());
  const [salary, setSalary] = useState(candidate.offered_ctc ? String(candidate.offered_ctc) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ employee: string; user?: string; temporary_password?: string; job_closed: boolean } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.hireCandidate({
        candidate: candidate.name,
        work_email: workEmail.trim(),
        department: department.trim(),
        designation: designation.trim(),
        joining_date: joining,
        monthly_salary: Number(salary) || undefined,
      });
      setResult(res.data);
      onDone();
    } catch (err) {
      setError(errMsg(err, 'Could not hire the candidate'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hrms-modal-backdrop" role="dialog" aria-modal="true">
      <form className="hrms-modal hrms-employee-form" onSubmit={submit}>
        <div className="hrms-modal-head">
          <div>
            <p className="hrms-modal-kicker">Hire {candidate.full_name}</p>
            <h2>{result ? 'Employee created' : 'Create employee'}</h2>
          </div>
          <button type="button" className="hrms-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {result ? (
          <div className="hire-stack">
            <p className="hire-ok">
              {candidate.full_name} is now employee <b>{result.employee}</b>.
              {result.job_closed ? ' All openings for this job are filled, so the job and its portal postings were closed.' : ''}
            </p>
            {result.user ? (
              <p>
                Login: <b>{result.user}</b>
                {result.temporary_password ? (
                  <>
                    {' '}
                    · Temporary password: <code>{result.temporary_password}</code> (share it privately; they should change it on
                    first login)
                  </>
                ) : null}
              </p>
            ) : null}
            <p className="muted hire-small">A salary structure was assigned from the monthly salary. Check their geofence in People → Geofencing.</p>
            <div className="hrms-modal-actions">
              <button type="button" className="hrms-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="hrms-form-grid">
              <label className="span-2">
                Work email (used as login) *
                <input type="email" required value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} />
              </label>
              <label>
                Department
                <input value={department} onChange={(e) => setDepartment(e.target.value)} />
              </label>
              <label>
                Designation
                <input value={designation} onChange={(e) => setDesignation(e.target.value)} />
              </label>
              <label>
                Joining date *
                <input type="date" required value={joining} onChange={(e) => setJoining(e.target.value)} />
              </label>
              <label>
                Monthly salary (₹) *
                <input type="number" min={1} required value={salary} onChange={(e) => setSalary(e.target.value)} />
              </label>
            </div>
            {error ? <p className="hire-error">{error}</p> : null}
            <div className="hrms-modal-actions">
              <button type="button" className="hrms-btn secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="hrms-btn" disabled={busy}>
                {busy ? 'Creating…' : 'Create employee'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
