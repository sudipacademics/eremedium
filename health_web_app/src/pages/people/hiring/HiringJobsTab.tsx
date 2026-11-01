import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type HireJob, type HireJobAds, type HirePortal, type HirePortalSlot } from '../../../api';
import { HrmsIcon } from '../../../components/HrmsIcons';
import type { HiringNav } from '../PeopleRecruitmentPage';
import { copyText, errMsg, fmtDate, inr } from './hiringUtils';
import { SlotCards } from './SlotCards';

const EMPTY_JOB: Partial<HireJob> = {
  title: '',
  status: 'Open',
  department: '',
  location: 'Kolkata',
  employment_type: 'Full Time',
  openings: 1,
  qualification: '',
  skills: '',
  description: '',
  is_public: 1,
};

export function HiringJobsTab({
  go,
  focusJob,
  startCreate,
}: {
  go: HiringNav;
  focusJob: string;
  startCreate?: boolean;
}) {
  const [jobs, setJobs] = useState<HireJob[]>([]);
  const [slots, setSlots] = useState<HirePortalSlot[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<HireJob> | null>(startCreate ? { ...EMPTY_JOB } : null);
  const [adsFor, setAdsFor] = useState(focusJob);

  useEffect(() => {
    if (startCreate) setEditing({ ...EMPTY_JOB });
  }, [startCreate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listHireJobs(status);
      setJobs(res.data.jobs);
      setSlots(res.data.slots);
    } catch (e) {
      setError(errMsg(e, 'Could not load jobs'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="hire-stack">
      <SlotCards slots={slots} />

      <section className="hrms-panel">
        <header>
          <h2>Jobs</h2>
          <div className="hire-toolbar">
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              <option>Open</option>
              <option>Paused</option>
              <option>Draft</option>
              <option>Closed</option>
            </select>
            <button type="button" className="emp-btn primary" onClick={() => setEditing({ ...EMPTY_JOB })}>
              + New job
            </button>
          </div>
        </header>
        {error ? <p className="hire-error">{error}</p> : null}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : jobs.length ? (
          <div className="emp-table-wrap">
            <table className="emp-table lv-table rc-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Job Title</th>
                  <th>Department</th>
                  <th>Location</th>
                  <th>Type</th>
                  <th>Openings</th>
                  <th>Applicants</th>
                  <th>Status</th>
                  <th>Live on</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j, i) => (
                  <tr key={j.name}>
                    <td>{i + 1}</td>
                    <td>
                      <b>{j.title}</b>
                      <div className="hire-small">
                        {j.salary_min || j.salary_max
                          ? `${inr(j.salary_min || j.salary_max)}${j.salary_max && j.salary_min ? ` – ${inr(j.salary_max)}` : ''}`
                          : 'Salary not set'}
                      </div>
                    </td>
                    <td>{j.department || '—'}</td>
                    <td>{j.location || '—'}</td>
                    <td>{j.employment_type || '—'}</td>
                    <td>{j.openings}</td>
                    <td>
                      <button type="button" className="att-link" onClick={() => go('candidates', { job: j.name, stage: 'Active' })}>
                        {j.candidates ?? 0}
                      </button>
                      <div className="hire-small">{j.active_candidates ?? 0} active</div>
                    </td>
                    <td>
                      <span className={`emp-pill ${j.status === 'Open' ? 'green' : j.status === 'Paused' ? 'amber' : j.status === 'Closed' ? 'rose' : 'grey'}`}>
                        {j.status === 'Paused' ? 'On Hold' : j.status}
                      </span>
                    </td>
                    <td>
                      {j.active_portals?.length ? j.active_portals.join(', ') : '—'}
                    </td>
                    <td>
                      <div className="emp-actions">
                        <button type="button" title="View ads" onClick={() => setAdsFor(j.name)}>
                          <HrmsIcon name="eye" size={17} />
                        </button>
                        <button type="button" title="Edit" onClick={() => setEditing(j)}>
                          <HrmsIcon name="pencil" size={16} />
                        </button>
                        <button type="button" title="Candidates" onClick={() => go('candidates', { job: j.name, stage: 'Active' })}>
                          <HrmsIcon name="users" size={16} />
                        </button>
                        <button type="button" title="Import applicants" onClick={() => go('import', { job: j.name })}>
                          <HrmsIcon name="download" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="hire-empty">
            <p>No jobs yet.</p>
            <button type="button" className="hrms-btn" onClick={() => setEditing({ ...EMPTY_JOB })}>
              Create the first job
            </button>
          </div>
        )}
      </section>

      {editing ? (
        <JobFormModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            void load();
            if (saved.status === 'Open' && !editing.name) setAdsFor(saved.name);
          }}
        />
      ) : null}

      {adsFor ? (
        <JobAdsModal
          job={adsFor}
          onClose={() => setAdsFor('')}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}

function JobFormModal({
  job,
  onClose,
  onSaved,
}: {
  job: Partial<HireJob>;
  onClose: () => void;
  onSaved: (job: HireJob) => void;
}) {
  const [form, setForm] = useState<Partial<HireJob>>(job);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof HireJob>(key: K, value: HireJob[K]) => setForm((f) => ({ ...f, [key]: value }));
  const num = (v: string) => (v === '' ? undefined : Number(v));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.saveHireJob(form);
      onSaved(res.data);
    } catch (err) {
      setError(errMsg(err, 'Could not save the job'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hrms-modal-backdrop" role="dialog" aria-modal="true">
      <form className="hrms-modal hrms-employee-form" onSubmit={submit}>
        <div className="hrms-modal-head">
          <div>
            <p className="hrms-modal-kicker">{job.name ? job.name : 'New job'}</p>
            <h2>{job.name ? 'Edit job' : 'Create a job'}</h2>
          </div>
          <button type="button" className="hrms-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="hrms-form-grid">
          <label className="span-2">
            Job title *
            <input required value={form.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Phlebotomist" />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => set('status', e.target.value as HireJob['status'])}>
              <option value="Open">Open (accepting applicants)</option>
              <option value="Draft">Draft</option>
              <option value="Paused">Paused</option>
              <option value="Closed">Closed</option>
            </select>
          </label>
          <label>
            Employment type
            <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
              <option>Full Time</option>
              <option>Part Time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </label>
          <label>
            Location
            <input value={form.location || ''} onChange={(e) => set('location', e.target.value)} />
          </label>
          <label>
            Department
            <input value={form.department || ''} onChange={(e) => set('department', e.target.value)} placeholder="e.g. Laboratory" />
          </label>
          <label>
            Openings
            <input type="number" min={1} value={form.openings ?? 1} onChange={(e) => set('openings', Number(e.target.value) || 1)} />
          </label>
          <label>
            Qualification
            <input value={form.qualification || ''} onChange={(e) => set('qualification', e.target.value)} placeholder="e.g. DMLT" />
          </label>
          <label>
            Salary from (₹ / month)
            <input type="number" min={0} value={form.salary_min || ''} onChange={(e) => set('salary_min', num(e.target.value))} />
          </label>
          <label>
            Salary to (₹ / month)
            <input type="number" min={0} value={form.salary_max || ''} onChange={(e) => set('salary_max', num(e.target.value))} />
          </label>
          <label>
            Experience from (years)
            <input type="number" min={0} step="0.5" value={form.experience_min || ''} onChange={(e) => set('experience_min', num(e.target.value))} />
          </label>
          <label>
            Experience to (years)
            <input type="number" min={0} step="0.5" value={form.experience_max || ''} onChange={(e) => set('experience_max', num(e.target.value))} />
          </label>
          <label className="span-2">
            Key skills (comma separated)
            <input value={form.skills || ''} onChange={(e) => set('skills', e.target.value)} placeholder="Venipuncture, Sample labelling" />
          </label>
          <label className="span-2">
            Job description
            <textarea rows={5} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label>
            Closes on (optional)
            <input type="date" value={form.closes_on || ''} onChange={(e) => set('closes_on', e.target.value || null)} />
          </label>
          <label className="hire-check">
            <input type="checkbox" checked={!!form.is_public} onChange={(e) => set('is_public', e.target.checked ? 1 : 0)} />
            Show on the public careers page
          </label>
        </div>
        {error ? <p className="hire-error">{error}</p> : null}
        <div className="hrms-modal-actions">
          <button type="button" className="hrms-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="hrms-btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save job'}
          </button>
        </div>
      </form>
    </div>
  );
}

function JobAdsModal({ job, onClose, onChanged }: { job: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<HireJobAds | null>(null);
  const [portal, setPortal] = useState<HirePortal>('Naukri');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [externalRef, setExternalRef] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.getHireJobAds(job);
      setData(res.data);
    } catch (e) {
      setError(errMsg(e, 'Could not load the job ads'));
    }
  }, [job]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(label: string, text: string) {
    const ok = await copyText(text);
    setNotice(ok ? `${label} copied` : 'Copy failed — select the text and copy manually');
    window.setTimeout(() => setNotice(''), 2500);
  }

  async function record() {
    setBusy(true);
    setError('');
    try {
      await api.recordHirePosting({ job, portal, external_url: externalUrl.trim(), external_ref: externalRef.trim() });
      setExternalUrl('');
      setExternalRef('');
      setNotice(`${portal} posting recorded`);
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e, 'Could not record the posting'));
    } finally {
      setBusy(false);
    }
  }

  async function closePosting(name: string) {
    if (!window.confirm('Mark this posting as closed? Do the same on the portal so it stops receiving applicants.')) return;
    setBusy(true);
    setError('');
    try {
      await api.closeHirePosting(name, 'Closed by HR');
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e, 'Could not close the posting'));
    } finally {
      setBusy(false);
    }
  }

  const ad = data?.ads[portal];
  const slot = data?.slots.find((s) => s.portal === portal);
  const activeHere = data?.postings.find((p) => p.portal === portal && p.status === 'Active');
  const slotFull = !!slot && slot.limit !== null && slot.used >= slot.limit;

  return (
    <div className="hrms-modal-backdrop" role="dialog" aria-modal="true">
      <div className="hrms-modal hire-modal-wide">
        <div className="hrms-modal-head">
          <div>
            <p className="hrms-modal-kicker">{job}</p>
            <h2>{data?.job.title || 'Job ads'}</h2>
          </div>
          <button type="button" className="hrms-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!data ? (
          error ? <p className="hire-error">{error}</p> : <p className="muted">Loading…</p>
        ) : (
          <>
            {data.job.status !== 'Open' ? (
              <p className="hire-warn">This job is {data.job.status}. Set it to Open before posting it on a portal.</p>
            ) : null}

            <div className="hrms-mode-tabs">
              {(['Naukri', 'WorkIndia'] as HirePortal[]).map((p) => (
                <button key={p} type="button" className={p === portal ? 'active' : ''} onClick={() => setPortal(p)}>
                  {p}
                </button>
              ))}
            </div>

            <ol className="hire-steps">
              <li>
                Copy the ad below.{' '}
                <a href={ad?.employer_url} target="_blank" rel="noreferrer">
                  Open the {portal} employer login
                </a>{' '}
                and paste it into a new job.
              </li>
              <li>After it goes live, paste the job link (optional) and click <b>Mark as posted</b>.</li>
              <li>When applicants arrive, download them from {portal} and use <b>Import applicants</b>.</li>
            </ol>

            {ad ? (
              <div className="hire-ad">
                <div className="hire-ad-row">
                  <b>Title</b>
                  <span>{ad.title}</span>
                  <button type="button" className="hrms-btn secondary" onClick={() => void copy('Title', ad.title)}>
                    Copy
                  </button>
                </div>
                {ad.key_skills.length ? (
                  <div className="hire-ad-row">
                    <b>Skills</b>
                    <span>{ad.key_skills.join(', ')}</span>
                    <button type="button" className="hrms-btn secondary" onClick={() => void copy('Skills', ad.key_skills.join(', '))}>
                      Copy
                    </button>
                  </div>
                ) : null}
                <pre className="hire-ad-body">{ad.body}</pre>
                <button type="button" className="hrms-btn" onClick={() => void copy('Ad text', ad.body)}>
                  Copy full ad
                </button>
              </div>
            ) : null}

            <div className="hire-post-box">
              <h3>
                {portal} posting{' '}
                <span className="muted hire-small">
                  {slot ? (slot.limit === null ? `${slot.used} live (unlimited)` : `${slot.used}/${slot.limit} slots used`) : ''}
                </span>
              </h3>
              {activeHere ? (
                <p className="hire-ok">
                  Live since {fmtDate(activeHere.posted_on)}, expires {fmtDate(activeHere.expires_on)}.
                </p>
              ) : slotFull ? (
                <p className="hire-warn">All {portal} slots are in use. Close an older posting below or on another job first.</p>
              ) : (
                <div className="hire-post-form">
                  <input
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder={`${portal} job link (optional)`}
                  />
                  <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="Portal job ID (optional)" />
                  <button
                    type="button"
                    className="hrms-btn"
                    disabled={busy || data.job.status !== 'Open'}
                    onClick={() => void record()}
                  >
                    Mark as posted
                  </button>
                </div>
              )}
            </div>

            <div className="hire-ad-row">
              <b>Careers page</b>
              <span className="hire-small">{data.ads.Careers.apply_url}</span>
              <button type="button" className="hrms-btn secondary" onClick={() => void copy('Apply link', data.ads.Careers.apply_url)}>
                Copy link
              </button>
            </div>

            {data.postings.length ? (
              <div className="hrms-table-wrap">
                <table className="hrms-table">
                  <thead>
                    <tr>
                      <th>Portal</th>
                      <th>Status</th>
                      <th>Posted</th>
                      <th>Expires</th>
                      <th>Link</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.postings.map((p) => (
                      <tr key={p.name}>
                        <td>{p.portal}</td>
                        <td>
                          <span className={`hrms-tag ${p.status === 'Active' ? 'ok' : ''}`}>{p.status}</span>
                        </td>
                        <td>{fmtDate(p.posted_on)}</td>
                        <td>{fmtDate(p.expires_on)}</td>
                        <td>
                          {p.external_url ? (
                            <a href={p.external_url} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : (
                            p.external_ref || '—'
                          )}
                        </td>
                        <td>
                          {p.status === 'Active' ? (
                            <button type="button" className="hrms-link-btn" disabled={busy} onClick={() => void closePosting(p.name)}>
                              Close
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {error ? <p className="hire-error">{error}</p> : null}
            {notice ? <p className="hire-toast">{notice}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
