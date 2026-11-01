import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type PublicHireJob } from '../../api';

const MAX_RESUME = 2 * 1024 * 1024;

async function toBase64(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export function JobApplyPage() {
  const { jobId = '' } = useParams();
  const jobName = decodeURIComponent(jobId);
  const [job, setJob] = useState<PublicHireJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [experience, setExperience] = useState('');
  const [qualification, setQualification] = useState('');
  const [expected, setExpected] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .listPublicHireJobs()
      .then((res) => {
        if (cancelled) return;
        const found = (res.data.jobs || []).find((j) => j.name === jobName);
        if (found) setJob(found);
        else setLoadError('This job is no longer accepting applications.');
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Could not load the job'));
    return () => {
      cancelled = true;
    };
  }, [jobName]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = mobile.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setError('Enter a valid 10-digit mobile number');
      return;
    }
    if (resume && resume.size > MAX_RESUME) {
      setError('Resume must be 2 MB or smaller');
      return;
    }
    setLoading(true);
    try {
      const res = await api.applyPublicHireJob(
        {
          job: jobName,
          full_name: fullName.trim(),
          mobile: digits,
          email: email.trim(),
          city: city.trim(),
          experience_years: experience,
          qualification: qualification.trim(),
          expected_ctc: expected,
          consent: consent ? 1 : 0,
          website,
        },
        resume ? { filename: resume.name, content_b64: await toBase64(resume) } : null,
      );
      setReference(res.data.reference);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the application');
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <div className="error">{loadError}</div>
        <Link to="/jobs">See other openings</Link>
      </div>
    );
  }

  if (reference) {
    return (
      <div className="careers-apply-success card card-wide">
        <h1>Application received</h1>
        <p>
          Thank you{fullName ? `, ${fullName.split(' ')[0]}` : ''}. Your reference is <code>{reference}</code>. Our HR
          team will call you on {mobile} if your profile matches.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn" to="/jobs">
            See other openings
          </Link>
          <Link className="btn secondary" to="/careers">
            Back to careers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="careers-apply-page">
      <div className="careers-apply-main">
        <h1>Apply</h1>
        {job ? (
          <div className="careers-job-summary">
            <strong>{job.title}</strong>
            <span>
              {job.location || 'Kolkata'} · {job.employment_type || 'Full Time'}
              {job.salary_text ? ` · ${job.salary_text}` : ''} · {job.experience_text}
            </span>
            {job.description ? <p className="muted">{job.description}</p> : null}
          </div>
        ) : (
          <p className="muted">Loading job…</p>
        )}

        <form className="form careers-apply-form" onSubmit={onSubmit}>
          <section>
            <div className="careers-grid-2">
              <label>
                Full name *
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={140} />
              </label>
              <label>
                Mobile number *
                <input value={mobile} onChange={(e) => setMobile(e.target.value)} required inputMode="tel" placeholder="10-digit mobile" />
              </label>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                City
                <input value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label>
                Experience (years)
                <input type="number" min={0} step="0.5" value={experience} onChange={(e) => setExperience(e.target.value)} />
              </label>
              <label>
                Highest qualification
                <input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. DMLT, B.Sc" />
              </label>
              <label>
                Expected salary (₹ / month)
                <input type="number" min={0} value={expected} onChange={(e) => setExpected(e.target.value)} />
              </label>
              <label>
                Resume (optional, PDF/Word/image, max 2 MB)
                <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setResume(e.target.files?.[0] || null)} />
              </label>
            </div>
            <label className="careers-honeypot" aria-hidden style={{ position: 'absolute', left: '-9999px' }}>
              Website
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </section>

          <label className="careers-check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
            I agree that Remedium HR may contact me by phone, SMS or WhatsApp about this job.
          </label>

          {error ? <div className="error">{error}</div> : null}

          <div className="careers-apply-actions">
            <Link className="btn secondary" to="/jobs">
              Cancel
            </Link>
            <button className="btn" type="submit" disabled={loading || !job}>
              {loading ? 'Submitting…' : 'Submit application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
