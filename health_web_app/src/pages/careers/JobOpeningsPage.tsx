import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PublicHireJob } from '../../api';

export function JobOpeningsPage() {
  const [jobs, setJobs] = useState<PublicHireJob[]>([]);
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listPublicHireJobs()
      .then((res) => !cancelled && setJobs(res.data.jobs || []))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load jobs'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const locations = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.location).filter(Boolean) as string[])).sort(),
    [jobs],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter(
      (j) =>
        (!location || j.location === location) &&
        (!q || [j.title, j.department, j.skills, j.description].some((v) => (v || '').toLowerCase().includes(q))),
    );
  }, [jobs, search, location]);

  return (
    <div className="careers-jobs-page">
      <header className="careers-section-head">
        <div>
          <p className="brand-kicker">CAREERS</p>
          <h1>Job Openings</h1>
          <p className="muted">Find a role that fits your skills. Applying takes about two minutes.</p>
        </div>
      </header>

      <div className="careers-job-filters">
        <label>
          Search
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Job title or skill" />
        </label>
        <label>
          Location
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="muted">Loading openings…</p> : null}

      <div className="careers-job-grid">
        {visible.map((job) => (
          <article key={job.name} className="careers-job-card">
            <h3>{job.title}</h3>
            <p className="muted">
              {job.location || 'Kolkata'} · {job.employment_type || 'Full Time'}
              {job.department ? ` · ${job.department}` : ''}
            </p>
            <p>
              {job.salary_text ? (
                <>
                  <b>{job.salary_text}</b> ·{' '}
                </>
              ) : null}
              {job.experience_text}
            </p>
            {job.description ? <p>{job.description.length > 220 ? `${job.description.slice(0, 220)}…` : job.description}</p> : null}
            <Link className="btn" to={`/jobs/${encodeURIComponent(job.name)}/apply`}>
              Apply Now
            </Link>
          </article>
        ))}
      </div>
      {!loading && !error && visible.length === 0 ? (
        <p className="muted">No openings right now. Please check back soon.</p>
      ) : null}
    </div>
  );
}
