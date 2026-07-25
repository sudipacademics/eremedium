import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, JobOpeningSummary } from '../../api';
import { useAuth } from '../../auth/AuthContext';

type EduRow = {
  qualification: string;
  university: string;
  year: string;
  specialization: string;
  percentage: string;
};

type ExpState = {
  total_experience: string;
  company: string;
  designation: string;
  from_date: string;
  to_date: string;
  currently_working: boolean;
  responsibilities: string;
};

type FilePayload = { filename: string; content_b64: string } | null;

async function fileToPayload(file: File | null): Promise<FilePayload> {
  if (!file) return null;
  if (file.size > 2 * 1024 * 1024) {
    throw new Error(`${file.name}: max size is 2MB`);
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return { filename: file.name, content_b64: btoa(binary) };
}

const emptyEdu = (): EduRow => ({
  qualification: '',
  university: '',
  year: '',
  specialization: '',
  percentage: '',
});

export function JobApplyPage() {
  const { jobId = '' } = useParams();
  const { isAuthenticated, user } = useAuth();
  const [job, setJob] = useState<JobOpeningSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [altMobile, setAltMobile] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pin, setPin] = useState('');

  const [education, setEducation] = useState<EduRow[]>([emptyEdu()]);
  const [experience, setExperience] = useState<ExpState>({
    total_experience: '',
    company: '',
    designation: '',
    from_date: '',
    to_date: '',
    currently_working: false,
    responsibilities: '',
  });

  const [resume, setResume] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [aadhaar, setAadhaar] = useState<File | null>(null);
  const [otherDoc, setOtherDoc] = useState<File | null>(null);
  const [declaration, setDeclaration] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getPublishedJobOpening(decodeURIComponent(jobId));
        if (!cancelled) setJob(res.data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Job not found');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyCareerHub();
        if (cancelled) return;
        const p = res.data.profile || {};
        if (p.full_name) setFullName(String(p.full_name));
        else if (user?.fullName) setFullName(user.fullName);
        const contact = String(p.contact_email || p.email || '');
        if (contact && !contact.endsWith('@otp.health.local')) setEmail(contact);
        if (p.mobile) setMobile(String(p.mobile));
        if (p.city) setCity(String(p.city));
        if (p.address) setAddress(String(p.address));
        if (p.dob) setDob(String(p.dob));
        if (p.gender) setGender(String(p.gender));
      } catch {
        if (user?.fullName) setFullName(user.fullName);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  const progress = useMemo(() => {
    let done = 0;
    const checks = [
      Boolean(fullName && mobile && email),
      education.some((e) => e.qualification && e.university),
      Boolean(experience.total_experience || experience.company),
      Boolean(resume),
      declaration,
    ];
    for (const c of checks) if (c) done += 1;
    return Math.round((done / checks.length) * 100);
  }, [fullName, mobile, email, education, experience, resume, declaration]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resumePayload = await fileToPayload(resume);
      if (!resumePayload) throw new Error('Resume / CV is required');
      const photoPayload = await fileToPayload(photo);
      const aadhaarPayload = await fileToPayload(aadhaar);
      const otherPayload = await fileToPayload(otherDoc);

      const application_json = JSON.stringify({
        personal: {
          dob,
          gender,
          alternate_mobile: altMobile,
          address,
          city,
          state: stateName,
          pin,
        },
        education,
        experience,
      });

      const res = await api.submitJobApplication({
        job_opening: decodeURIComponent(jobId),
        full_name: fullName.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        application_json,
        declaration_accepted: declaration ? 1 : 0,
        resume: JSON.stringify(resumePayload),
        ...(photoPayload ? { photo: JSON.stringify(photoPayload) } : {}),
        ...(aadhaarPayload ? { aadhaar: JSON.stringify(aadhaarPayload) } : {}),
        ...(otherPayload ? { other_document: JSON.stringify(otherPayload) } : {}),
      });
      setSuccessId(res.data.application_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <div className="error">{loadError}</div>
        <Link to="/jobs">Back to openings</Link>
      </div>
    );
  }

  if (successId) {
    return (
      <div className="careers-apply-success card card-wide">
        <h1>Application submitted</h1>
        <p>
          Thank you. Your application ID is <code>{successId}</code>. Our HR team will contact you.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn" to="/my/applications">
            My applications
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
        <h1>Job Application</h1>
        {job ? (
          <div className="careers-job-summary">
            <strong>{job.job_title}</strong>
            <span>
              {job.department || '—'} · {job.location || '—'} · {job.employment_type || 'Full Time'}
            </span>
          </div>
        ) : (
          <p className="muted">Loading job…</p>
        )}

        <form className="form careers-apply-form" onSubmit={onSubmit}>
          <section>
            <h2>1. Personal Information</h2>
            <div className="careers-grid-2">
              <label>
                Full Name *
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
              <label>
                Date of Birth
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </label>
              <label>
                Gender
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">Select</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Mobile Number *
                <input value={mobile} onChange={(e) => setMobile(e.target.value)} required inputMode="tel" />
              </label>
              <label>
                Email Address *
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label>
                Alternate Number
                <input value={altMobile} onChange={(e) => setAltMobile(e.target.value)} />
              </label>
            </div>
            <label>
              Current Address
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
            </label>
            <div className="careers-grid-3">
              <label>
                City
                <input value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label>
                State
                <input value={stateName} onChange={(e) => setStateName(e.target.value)} />
              </label>
              <label>
                PIN Code
                <input value={pin} onChange={(e) => setPin(e.target.value)} />
              </label>
            </div>
          </section>

          <section>
            <h2>2. Education Information</h2>
            {education.map((row, idx) => (
              <div key={idx} className="careers-grid-2 careers-edu-block">
                <label>
                  Highest Qualification
                  <input
                    value={row.qualification}
                    onChange={(e) => {
                      const next = [...education];
                      next[idx] = { ...row, qualification: e.target.value };
                      setEducation(next);
                    }}
                  />
                </label>
                <label>
                  University / Board
                  <input
                    value={row.university}
                    onChange={(e) => {
                      const next = [...education];
                      next[idx] = { ...row, university: e.target.value };
                      setEducation(next);
                    }}
                  />
                </label>
                <label>
                  Year of Passing
                  <input
                    value={row.year}
                    onChange={(e) => {
                      const next = [...education];
                      next[idx] = { ...row, year: e.target.value };
                      setEducation(next);
                    }}
                  />
                </label>
                <label>
                  Specialization
                  <input
                    value={row.specialization}
                    onChange={(e) => {
                      const next = [...education];
                      next[idx] = { ...row, specialization: e.target.value };
                      setEducation(next);
                    }}
                  />
                </label>
                <label>
                  Percentage / CGPA
                  <input
                    value={row.percentage}
                    onChange={(e) => {
                      const next = [...education];
                      next[idx] = { ...row, percentage: e.target.value };
                      setEducation(next);
                    }}
                  />
                </label>
              </div>
            ))}
            <button type="button" className="btn-link" onClick={() => setEducation((e) => [...e, emptyEdu()])}>
              + Add Another Qualification
            </button>
          </section>

          <section>
            <h2>3. Work Experience</h2>
            <div className="careers-grid-2">
              <label>
                Total Experience
                <input
                  value={experience.total_experience}
                  onChange={(e) => setExperience({ ...experience, total_experience: e.target.value })}
                  placeholder="e.g. 2 Years"
                />
              </label>
              <label>
                Current / Last Company
                <input
                  value={experience.company}
                  onChange={(e) => setExperience({ ...experience, company: e.target.value })}
                />
              </label>
              <label>
                Designation
                <input
                  value={experience.designation}
                  onChange={(e) => setExperience({ ...experience, designation: e.target.value })}
                />
              </label>
              <label>
                From
                <input
                  type="date"
                  value={experience.from_date}
                  onChange={(e) => setExperience({ ...experience, from_date: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={experience.to_date}
                  onChange={(e) => setExperience({ ...experience, to_date: e.target.value })}
                  disabled={experience.currently_working}
                />
              </label>
              <label className="careers-check">
                <input
                  type="checkbox"
                  checked={experience.currently_working}
                  onChange={(e) => setExperience({ ...experience, currently_working: e.target.checked })}
                />
                Currently Working Here
              </label>
            </div>
            <label>
              Key Responsibilities
              <textarea
                rows={3}
                value={experience.responsibilities}
                onChange={(e) => setExperience({ ...experience, responsibilities: e.target.value })}
              />
            </label>
          </section>

          <section>
            <h2>4. Upload Documents</h2>
            <p className="muted">PDF, JPG, PNG — max 2MB each. Resume is required.</p>
            <div className="careers-upload-grid">
              <label>
                Resume / CV *
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setResume(e.target.files?.[0] || null)} />
              </label>
              <label>
                Passport Size Photo
                <input type="file" accept=".jpg,.jpeg,.png" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
              </label>
              <label>
                Aadhaar Card
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setAadhaar(e.target.files?.[0] || null)} />
              </label>
              <label>
                Other Document
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setOtherDoc(e.target.files?.[0] || null)} />
              </label>
            </div>
          </section>

          <label className="careers-check">
            <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} required />
            I hereby declare that all the information provided above is true and correct to the best of my knowledge.
          </label>

          {error ? <div className="error">{error}</div> : null}

          <div className="careers-apply-actions">
            <Link className="btn secondary" to="/jobs">
              Cancel
            </Link>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Submitting…' : 'Review & Submit'}
            </button>
          </div>
        </form>
      </div>

      <aside className="careers-apply-rail">
        <div className="careers-progress-card">
          <div className="careers-progress-ring" style={{ ['--p' as string]: `${progress}%` }}>
            <span>{progress}%</span>
          </div>
          <p>Application Progress</p>
          <ol className="careers-stepper">
            <li className={fullName && email && mobile ? 'done' : 'active'}>Personal Information</li>
            <li className={education.some((e) => e.qualification) ? 'done' : ''}>Education Information</li>
            <li className={experience.company || experience.total_experience ? 'done' : ''}>Work Experience</li>
            <li className={resume ? 'done' : ''}>Documents</li>
            <li className={declaration ? 'done' : ''}>Review &amp; Submit</li>
          </ol>
        </div>
        <div className="careers-tips">
          <strong>Tips</strong>
          <ul>
            <li>Use a clear PDF resume under 2MB.</li>
            <li>Double-check mobile and email.</li>
            <li>List your latest qualification first.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
