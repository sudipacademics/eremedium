import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PublicHireJob } from '../../api';

const CAREERS_EMAIL = 'careers@remediumhealth.co.in';
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=80';

const BENEFITS = [
  {
    title: 'Make an Impact',
    text: 'Contribute to better healthcare for all.',
    icon: 'impact',
  },
  {
    title: 'Grow with Us',
    text: 'Learning, training & career advancement.',
    icon: 'grow',
  },
  {
    title: 'Great Culture',
    text: 'Teamwork, respect & a positive environment.',
    icon: 'culture',
  },
  {
    title: 'Job Security',
    text: 'Be a part of a stable and growing company.',
    icon: 'security',
  },
] as const;

function jobIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes('phlebo') || t.includes('nurse') || t.includes('medical')) return 'phlebo';
  if (t.includes('reception') || t.includes('front') || t.includes('admin')) return 'reception';
  if (t.includes('lab') || t.includes('technician') || t.includes('patholog')) return 'lab';
  if (t.includes('market') || t.includes('sales') || t.includes('business')) return 'marketing';
  return 'generic';
}

function BenefitIcon({ kind }: { kind: (typeof BENEFITS)[number]['icon'] }) {
  const props = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true as const };
  if (kind === 'impact') {
    return (
      <svg {...props}>
        <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
      </svg>
    );
  }
  if (kind === 'grow') {
    return (
      <svg {...props}>
        <path d="M22 10V6H18" />
        <path d="M22 6 12 16l-4-4-6 6" />
      </svg>
    );
  }
  if (kind === 'culture') {
    return (
      <svg {...props}>
        <circle cx="9" cy="8" r="3" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3 19c1.5-3 4-4.5 6-4.5S13.5 16 15 19" />
        <path d="M14 14.5c1.2-.4 2.6-.4 4 0 1.2.4 2.2 1.3 3 2.5" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function JobCardIcon({ kind }: { kind: string }) {
  const props = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true as const };
  if (kind === 'phlebo') {
    return (
      <svg {...props}>
        <path d="M12 3v10" />
        <path d="M9 6h6" />
        <path d="M8 13a4 4 0 0 0 8 0" />
        <path d="M10 21h4" />
      </svg>
    );
  }
  if (kind === 'reception') {
    return (
      <svg {...props}>
        <rect x="3" y="8" width="18" height="10" rx="2" />
        <path d="M7 8V6a5 5 0 0 1 10 0v2" />
        <path d="M8 13h3M13 13h3" />
      </svg>
    );
  }
  if (kind === 'lab') {
    return (
      <svg {...props}>
        <path d="M9 3h6" />
        <path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
      </svg>
    );
  }
  if (kind === 'marketing') {
    return (
      <svg {...props}>
        <path d="M4 12v-2a2 2 0 0 1 2-2h5l7-4v16l-7-4H6a2 2 0 0 1-2-2v-2z" />
        <path d="M18 9.5a4 4 0 0 1 0 5" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

export function CareersLandingPage() {
  const [openings, setOpenings] = useState<PublicHireJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listPublicHireJobs();
        if (!cancelled) setOpenings(res.data.jobs || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load openings');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pages = useMemo(() => {
    const size = 4;
    const chunks: PublicHireJob[][] = [];
    for (let i = 0; i < openings.length; i += size) chunks.push(openings.slice(i, i + size));
    return chunks.length ? chunks : [[]];
  }, [openings]);

  useEffect(() => {
    setSlide(0);
  }, [openings.length]);

  const visible = pages[Math.min(slide, pages.length - 1)] || [];

  return (
    <div className="careers-landing">
      <section className="careers-hero">
        <div className="careers-hero-copy">
          <p className="brand-kicker">CAREERS</p>
          <h1>
            Build Your Career with <span>Remedium</span>
          </h1>
          <p className="hero-lead">
            Join a purpose-driven team that is committed to better health, better lives.
          </p>
          <div className="careers-hero-actions">
            <Link className="careers-btn-solid careers-btn-lg" to="/jobs">
              View Openings
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
            <a className="careers-btn-outline careers-btn-lg" href="#why-remedium">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M8 6.5v11l9-5.5-9-5.5z" />
              </svg>
              Why Remedium?
            </a>
          </div>
        </div>

        <div className="careers-hero-visual">
          <div className="careers-hero-blob careers-hero-blob-a" aria-hidden />
          <div className="careers-hero-blob careers-hero-blob-b" aria-hidden />
          <div className="careers-hero-dots" aria-hidden />
          <figure className="careers-hero-photo">
            <img
              src={HERO_IMAGE}
              alt="Remedium clinical team collaborating"
              loading="eager"
              width={720}
              height={520}
            />
          </figure>
          <aside className="careers-hero-float" aria-label="Be a Part of Change">
            <span className="careers-hero-float-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="9" cy="8" r="3" />
                <circle cx="16" cy="9" r="2.5" />
                <path d="M3 19c1.5-3 4-4.5 6-4.5S13.5 16 15 19" />
                <path d="M14 14.5c1.2-.4 2.6-.4 4 0 1.2.4 2.2 1.3 3 2.5" />
              </svg>
            </span>
            <div>
              <strong>Be a Part of Change</strong>
              <p>Make an impact in millions of lives.</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="careers-benefits" id="why-remedium">
        {BENEFITS.map((item) => (
          <article key={item.title}>
            <span className="careers-benefit-icon" aria-hidden>
              <BenefitIcon kind={item.icon} />
            </span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </section>

      <section className="careers-openings-preview" id="life-at-remedium">
        <div className="careers-section-head">
          <h2>Open Positions</h2>
          <Link className="careers-section-link" to="/jobs">
            View all openings
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div className="careers-job-grid">
          {visible.map((job) => (
            <article key={job.name} className="careers-job-card">
              <span className="careers-job-icon" aria-hidden>
                <JobCardIcon kind={jobIcon(job.job_title)} />
              </span>
              <h3>{job.job_title}</h3>
              <p>{job.description || 'Join the Remedium team and grow with a purpose-driven healthcare network.'}</p>
              <div className="careers-job-meta">
                <span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </svg>
                  {job.location || 'Multiple Locations'}
                </span>
                <span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3 10h18" />
                  </svg>
                  {job.employment_type || 'Full Time'}
                </span>
              </div>
              <Link className="careers-job-apply" to={`/jobs/${encodeURIComponent(job.name)}/apply`}>
                Apply Now
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </article>
          ))}
          {!error && openings.length === 0 ? <p className="muted careers-empty">No published openings yet. Drop your resume below.</p> : null}
        </div>
        {pages.length > 1 ? (
          <div className="careers-job-dots" role="tablist" aria-label="Open positions pages">
            {pages.map((_, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={index === slide}
                className={index === slide ? 'is-active' : undefined}
                onClick={() => setSlide(index)}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="careers-resume-cta" id="contact">
        <div className="careers-resume-art" aria-hidden>
          <div className="careers-resume-chair" />
          <div className="careers-resume-plant" />
        </div>
        <div className="careers-resume-copy">
          <h2>Don&apos;t see the right role?</h2>
          <p>We are always looking for passionate people. Share your profile with us.</p>
        </div>
        <div className="careers-resume-actions">
          <Link className="careers-btn-ghost" to="/jobs">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M12 16V4M8 8l4-4 4 4" />
              <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
            </svg>
            Drop your resume
          </Link>
          <a className="careers-resume-email" href={`mailto:${CAREERS_EMAIL}`}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m4 7 8 6 8-6" />
            </svg>
            Or email us at {CAREERS_EMAIL}
          </a>
        </div>
      </section>
    </div>
  );
}
