import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, JobOpeningSummary } from '../../api';

export function CareersLandingPage() {
  const [openings, setOpenings] = useState<JobOpeningSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listPublishedJobOpenings({ limit: 4 });
        if (!cancelled) setOpenings(res.data.openings || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load openings');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="careers-landing">
      <section className="careers-hero">
        <div className="careers-hero-copy">
          <p className="brand-kicker">CAREERS</p>
          <h1>
            Build Your Career with <span>Remedium</span>
          </h1>
          <p className="hero-lead">Join a growing team that is committed to better health, better lives.</p>
          <div className="careers-hero-actions">
            <Link className="btn" to="/jobs">
              View Openings
            </Link>
            <a className="btn secondary" href="#why-remedium">
              Why Remedium?
            </a>
          </div>
        </div>
        <div className="careers-hero-visual" aria-hidden>
          <div className="careers-hero-panel" />
        </div>
      </section>

      <section className="careers-benefits" id="why-remedium">
        <article>
          <h3>Make an Impact</h3>
          <p>Contribute to better healthcare for all.</p>
        </article>
        <article>
          <h3>Grow with Us</h3>
          <p>Learning, training &amp; career advancement.</p>
        </article>
        <article>
          <h3>Great Culture</h3>
          <p>Teamwork, respect &amp; a positive environment.</p>
        </article>
        <article>
          <h3>Job Security</h3>
          <p>Be a part of a stable and growing company.</p>
        </article>
      </section>

      <section className="careers-openings-preview">
        <div className="careers-section-head">
          <h2>Open Positions</h2>
          <Link to="/jobs">View all openings</Link>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div className="careers-job-grid">
          {openings.map((job) => (
            <article key={job.name} className="careers-job-card">
              <h3>{job.job_title}</h3>
              <p>{job.description || 'Join the Remedium team.'}</p>
              <p className="muted">
                {job.location || 'India'} · {job.employment_type || 'Full Time'}
              </p>
              <Link className="btn btn-sm" to={`/jobs/${encodeURIComponent(job.name)}/apply`}>
                Apply Now
              </Link>
            </article>
          ))}
          {!error && openings.length === 0 ? <p className="muted">No published openings yet.</p> : null}
        </div>
      </section>

      <section className="careers-resume-cta">
        <div>
          <h2>Don&apos;t see the right role?</h2>
          <p>Submit your resume for a published opening and our HR team will review it.</p>
        </div>
        <Link className="btn secondary" to="/jobs">
          Browse openings
        </Link>
      </section>
    </div>
  );
}
