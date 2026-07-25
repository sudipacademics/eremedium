import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, JobOpeningSummary } from '../../api';

export function JobOpeningsPage() {
  const [openings, setOpenings] = useState<JobOpeningSummary[]>([]);
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextSearch = search, nextLocation = location) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPublishedJobOpenings({
        search: nextSearch.trim() || undefined,
        location: nextLocation.trim() || undefined,
        limit: 50,
      });
      setOpenings(res.data.openings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load jobs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const o of openings) {
      if (o.location) set.add(o.location);
    }
    return Array.from(set).sort();
  }, [openings]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    void load();
  }

  return (
    <div className="careers-jobs-page">
      <header className="careers-section-head">
        <div>
          <p className="brand-kicker">CAREERS</p>
          <h1>Job Openings</h1>
          <p className="muted">Find a role that fits your skills and ambition.</p>
        </div>
      </header>

      <form className="careers-job-filters" onSubmit={onFilter}>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job title or keyword"
          />
        </label>
        <label>
          Location
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">All Locations</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error ? <div className="error">{error}</div> : null}

      <div className="careers-job-grid">
        {openings.map((job) => (
          <article key={job.name} className="careers-job-card">
            <h3>{job.job_title}</h3>
            <p>{job.description || 'Join the Remedium team.'}</p>
            <p className="muted">
              {job.location || 'India'} · {job.employment_type || 'Full Time'}
              {job.department ? ` · ${job.department}` : ''}
            </p>
            {job.posted_on ? <p className="muted">Posted {job.posted_on}</p> : null}
            <Link className="btn" to={`/jobs/${encodeURIComponent(job.name)}/apply`}>
              Apply Now
            </Link>
          </article>
        ))}
      </div>
      {!loading && !error && openings.length === 0 ? <p className="muted">No openings match your filters.</p> : null}
    </div>
  );
}
