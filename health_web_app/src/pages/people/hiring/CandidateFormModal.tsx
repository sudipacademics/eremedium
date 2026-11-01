import { useState, type FormEvent } from 'react';
import { api, type HireCandidateDetail, type HireJob } from '../../../api';
import { MANUAL_SOURCES, errMsg, fileToBase64 } from './hiringUtils';

type Props = {
  jobs: HireJob[];
  defaultJob?: string;
  candidate?: HireCandidateDetail;
  onClose: () => void;
  onSaved: (name: string) => void;
};

export function CandidateFormModal({ jobs, defaultJob = '', candidate, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>(() => ({
    full_name: candidate?.full_name || '',
    mobile: candidate?.mobile || '',
    email: candidate?.email || '',
    job: candidate?.job || defaultJob,
    source: candidate?.source || 'Naukri',
    city: candidate?.city || '',
    experience_years: candidate?.experience_years != null ? String(candidate.experience_years) : '',
    qualification: candidate?.qualification || '',
    current_company: candidate?.current_company || '',
    current_ctc: candidate?.current_ctc ? String(candidate.current_ctc) : '',
    expected_ctc: candidate?.expected_ctc ? String(candidate.expected_ctc) : '',
    notice_period: candidate?.notice_period || '',
  }));
  const [resume, setResume] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.mobile.trim() && !form.email.trim()) {
      setError('Enter a mobile number or an email');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { ...form };
      if (candidate) {
        payload.name = candidate.name;
        delete payload.source;
      }
      const file = resume ? { filename: resume.name, content_b64: await fileToBase64(resume) } : null;
      const res = await api.saveHireCandidate(payload, file);
      onSaved(res.data.name);
    } catch (err) {
      setError(errMsg(err, 'Could not save the candidate'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hrms-modal-backdrop" role="dialog" aria-modal="true">
      <form className="hrms-modal hrms-employee-form" onSubmit={submit}>
        <div className="hrms-modal-head">
          <div>
            <p className="hrms-modal-kicker">{candidate ? candidate.name : 'Manual entry'}</p>
            <h2>{candidate ? 'Edit candidate' : 'Add a candidate'}</h2>
          </div>
          <button type="button" className="hrms-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {!candidate ? (
          <p className="muted hire-small">
            If the same mobile or email already exists for this job, the details are merged instead of creating a duplicate.
          </p>
        ) : null}
        <div className="hrms-form-grid">
          <label className="span-2">
            Full name *
            <input required value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </label>
          <label>
            Mobile
            <input inputMode="tel" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit mobile" />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label>
            Job
            <select value={form.job} onChange={(e) => set('job', e.target.value)}>
              <option value="">No job yet</option>
              {jobs.map((j) => (
                <option key={j.name} value={j.name}>
                  {j.title}
                </option>
              ))}
            </select>
          </label>
          {!candidate ? (
            <label>
              Source
              <select value={form.source} onChange={(e) => set('source', e.target.value)}>
                {MANUAL_SOURCES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              City
              <input value={form.city} onChange={(e) => set('city', e.target.value)} />
            </label>
          )}
          {!candidate ? (
            <label>
              City
              <input value={form.city} onChange={(e) => set('city', e.target.value)} />
            </label>
          ) : null}
          <label>
            Experience (years)
            <input type="number" min={0} step="0.5" value={form.experience_years} onChange={(e) => set('experience_years', e.target.value)} />
          </label>
          <label>
            Qualification
            <input value={form.qualification} onChange={(e) => set('qualification', e.target.value)} />
          </label>
          <label>
            Current company
            <input value={form.current_company} onChange={(e) => set('current_company', e.target.value)} />
          </label>
          <label>
            Current salary (₹ / month)
            <input type="number" min={0} value={form.current_ctc} onChange={(e) => set('current_ctc', e.target.value)} />
          </label>
          <label>
            Expected salary (₹ / month)
            <input type="number" min={0} value={form.expected_ctc} onChange={(e) => set('expected_ctc', e.target.value)} />
          </label>
          <label>
            Notice period
            <input value={form.notice_period} onChange={(e) => set('notice_period', e.target.value)} placeholder="e.g. 15 days" />
          </label>
          <label className="span-2">
            Resume (PDF, Word or image, max 2 MB)
            <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setResume(e.target.files?.[0] || null)} />
          </label>
        </div>
        {error ? <p className="hire-error">{error}</p> : null}
        <div className="hrms-modal-actions">
          <button type="button" className="hrms-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="hrms-btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save candidate'}
          </button>
        </div>
      </form>
    </div>
  );
}
