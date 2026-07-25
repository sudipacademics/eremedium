import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApplicationPipelineBundle, JobApplicationDetail } from '../../api';
import { assetUrl } from '../../config';

type Tab = 'details' | 'documents' | 'interview' | 'notes' | 'offer';

export function HrApplicationDetailPage() {
  const { applicationId = '' } = useParams();
  const [detail, setDetail] = useState<JobApplicationDetail | null>(null);
  const [pipeline, setPipeline] = useState<ApplicationPipelineBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('details');

  const [interviewAt, setInterviewAt] = useState('');
  const [interviewType, setInterviewType] = useState('Screening');
  const [meetingLink, setMeetingLink] = useState('');
  const [noteText, setNoteText] = useState('');
  const [offerDesignation, setOfferDesignation] = useState('');
  const [offerSalary, setOfferSalary] = useState('');
  const [joiningDate, setJoiningDate] = useState('');

  async function load() {
    setError(null);
    const id = decodeURIComponent(applicationId);
    try {
      const [appRes, pipeRes] = await Promise.all([
        api.getJobApplication(id),
        api.getApplicationPipeline(id).catch(() => null),
      ]);
      setDetail(appRes.data);
      if (pipeRes) setPipeline(pipeRes.data);
      if (!offerDesignation && appRes.data.opening?.job_title) {
        setOfferDesignation(appRes.data.opening.job_title);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load application');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  async function moveStage(opts?: { stage?: string; reject?: boolean }) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateApplicationStage({
        application: detail.name,
        ...(opts?.stage ? { stage: opts.stage } : {}),
        ...(opts?.reject ? { reject: 1 } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update stage');
    } finally {
      setBusy(false);
    }
  }

  async function onScheduleInterview(e: FormEvent) {
    e.preventDefault();
    if (!detail || !interviewAt) return;
    setBusy(true);
    setError(null);
    try {
      await api.scheduleInterview({
        application: detail.name,
        scheduled_on: interviewAt.replace('T', ' ') + ':00',
        interview_type: interviewType,
        meeting_link: meetingLink || undefined,
      });
      setMeetingLink('');
      await load();
      setTab('interview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule interview');
    } finally {
      setBusy(false);
    }
  }

  async function onAddNote(e: FormEvent) {
    e.preventDefault();
    if (!detail || !noteText.trim()) return;
    setBusy(true);
    try {
      await api.addApplicationNote(detail.name, noteText.trim());
      setNoteText('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add note');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateOffer(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    try {
      await api.createJobOffer({
        application: detail.name,
        designation: offerDesignation || undefined,
        joining_date: joiningDate || undefined,
        salary_offered: offerSalary ? Number(offerSalary) : undefined,
        send: 1,
      });
      await load();
      setTab('offer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create offer');
    } finally {
      setBusy(false);
    }
  }

  async function onStartOnboarding() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.startApplicantOnboarding(detail.name);
      await load();
      setTab('offer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start onboarding');
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className="page">
        <div className="error">{error}</div>
        <Link to="/hr/applications">Back</Link>
      </div>
    );
  }

  if (!detail) return <p className="muted">Loading…</p>;

  const stages = (detail.stages || []).filter((s) => s !== 'Rejected');
  const current = detail.pipeline_stage || 'Received';
  const app = (detail.application || {}) as {
    personal?: Record<string, string>;
    education?: Array<Record<string, string>>;
    experience?: Record<string, string | boolean>;
  };

  return (
    <div className="careers-hr-detail">
      <Link to="/hr/applications" className="muted">
        ← Applications
      </Link>

      <header className="careers-hr-detail-head">
        <div>
          <p className="brand-kicker">{detail.source || 'Career Website'}</p>
          <h1>{detail.applicant_name}</h1>
          <p className="muted">
            {detail.opening?.job_title || detail.job_opening} · {detail.phone_number} · {detail.email_id}
          </p>
          <p className="muted">
            Applied {detail.applied_on || '—'} · ID {detail.name}
          </p>
        </div>
        <div className="careers-hr-detail-actions">
          <select value={current} disabled={busy} onChange={(e) => void moveStage({ stage: e.target.value })}>
            {(detail.stages || []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn" type="button" disabled={busy} onClick={() => void moveStage()}>
            Move to Next Stage
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => setTab('interview')}>
            Schedule Interview
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => void moveStage({ reject: true })}>
            Reject
          </button>
        </div>
      </header>

      <ol className="careers-pipeline">
        {stages.map((s) => (
          <li key={s} className={s === current ? 'active' : stages.indexOf(s) < stages.indexOf(current) ? 'done' : ''}>
            {s}
          </li>
        ))}
      </ol>

      {error ? <div className="error">{error}</div> : null}

      <div className="careers-tabs">
        {(
          [
            ['details', 'Application Details'],
            ['documents', 'Resume & Documents'],
            ['interview', 'Interviews'],
            ['notes', 'Notes & Activity'],
            ['offer', 'Offer & Onboarding'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        <div className="careers-detail-grid">
          <section className="card">
            <h2>Personal</h2>
            <dl className="careers-dl">
              <div>
                <dt>DOB</dt>
                <dd>{app.personal?.dob || '—'}</dd>
              </div>
              <div>
                <dt>Gender</dt>
                <dd>{app.personal?.gender || '—'}</dd>
              </div>
              <div>
                <dt>City</dt>
                <dd>{app.personal?.city || '—'}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{app.personal?.address || '—'}</dd>
              </div>
            </dl>
          </section>
          <section className="card">
            <h2>Education</h2>
            {(app.education || []).length === 0 ? <p className="muted">None provided</p> : null}
            <ul>
              {(app.education || []).map((e, i) => (
                <li key={i}>
                  <strong>{e.qualification || 'Qualification'}</strong> — {e.university || '—'} ({e.year || '—'}){' '}
                  {e.percentage ? `· ${e.percentage}` : ''}
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>Experience</h2>
            <p>
              <strong>{String(app.experience?.total_experience || '—')}</strong>
            </p>
            <p>
              {String(app.experience?.company || '—')} · {String(app.experience?.designation || '—')}
            </p>
            <p className="muted">{String(app.experience?.responsibilities || '')}</p>
          </section>
        </div>
      ) : null}

      {tab === 'documents' ? (
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
      ) : null}

      {tab === 'interview' ? (
        <div className="careers-detail-grid">
          <section className="card">
            <h2>Schedule interview</h2>
            <form className="form" onSubmit={onScheduleInterview}>
              <label>
                Date &amp; time
                <input
                  type="datetime-local"
                  value={interviewAt}
                  onChange={(e) => setInterviewAt(e.target.value)}
                  required
                />
              </label>
              <label>
                Type
                <select value={interviewType} onChange={(e) => setInterviewType(e.target.value)}>
                  <option>Screening</option>
                  <option>Technical</option>
                  <option>HR</option>
                  <option>Final</option>
                  <option>Assessment</option>
                </select>
              </label>
              <label>
                Meeting link
                <input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://" />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Schedule & move to Interview'}
              </button>
            </form>
          </section>
          <section className="card">
            <h2>Upcoming / past</h2>
            {(pipeline?.interviews || []).length === 0 ? <p className="muted">No interviews yet.</p> : null}
            <ul className="pipe-list">
              {(pipeline?.interviews || []).map((iv) => (
                <li key={iv.name}>
                  <strong>
                    {iv.interview_type} · {iv.scheduled_on}
                  </strong>
                  <span className="careers-stage-pill">{iv.status}</span>
                  {iv.meeting_link ? (
                    <a href={iv.meeting_link} target="_blank" rel="noreferrer">
                      Join
                    </a>
                  ) : null}
                  {iv.status === 'Scheduled' ? (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      onClick={() => void api.updateInterviewStatus(iv.name, 'Completed').then(load)}
                    >
                      Mark completed
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === 'notes' ? (
        <div className="careers-detail-grid">
          <section className="card">
            <h2>Add note</h2>
            <form className="form" onSubmit={onAddNote}>
              <label>
                Note
                <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} required />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Save note
              </button>
            </form>
          </section>
          <section className="card">
            <h2>Activity timeline</h2>
            <ul className="pipe-timeline">
              {(pipeline?.notes || []).map((n) => (
                <li key={n.name}>
                  <span className="muted">{n.created_on || '—'}</span>
                  <strong>{n.note_type}</strong>
                  <p>{n.content}</p>
                  <span className="muted">{n.created_by_user}</span>
                </li>
              ))}
            </ul>
            {!pipeline?.notes?.length ? <p className="muted">No activity yet.</p> : null}
          </section>
        </div>
      ) : null}

      {tab === 'offer' ? (
        <div className="careers-detail-grid">
          <section className="card">
            <h2>Create offer</h2>
            <form className="form" onSubmit={onCreateOffer}>
              <label>
                Designation
                <input value={offerDesignation} onChange={(e) => setOfferDesignation(e.target.value)} />
              </label>
              <label>
                Joining date
                <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
              </label>
              <label>
                Salary offered
                <input
                  type="number"
                  value={offerSalary}
                  onChange={(e) => setOfferSalary(e.target.value)}
                  placeholder="Monthly CTC"
                />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Create &amp; send offer
              </button>
            </form>
            <ul className="pipe-list" style={{ marginTop: 16 }}>
              {(pipeline?.offers || []).map((o) => (
                <li key={o.name}>
                  <strong>
                    {o.name} · {o.designation}
                  </strong>
                  <span className="careers-stage-pill">{o.status}</span>
                  <span className="muted">
                    {o.offer_date} · ₹{Number(o.salary_offered || 0).toLocaleString('en-IN')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>Onboarding</h2>
            <p className="muted">Moves pipeline to Onboarding and creates checklist ToDos for HR.</p>
            <button className="btn" type="button" disabled={busy} onClick={() => void onStartOnboarding()}>
              Start onboarding checklist
            </button>
            <ul className="pipe-list" style={{ marginTop: 16 }}>
              {(pipeline?.onboarding_todos || []).map((t) => (
                <li key={t.name}>
                  <span>{t.description}</span>
                  <span className="careers-stage-pill">{t.status}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
