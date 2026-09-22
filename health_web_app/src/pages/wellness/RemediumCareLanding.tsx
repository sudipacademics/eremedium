import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AlliedHealthService, AlliedHealthWing, WhatsappCta } from '../../api';
import { getWellnessClinicConfig } from './wellnessClinicConfig';

const JOURNEY = [
  { id: 'checkin', title: 'Check-in', text: 'Digital intake & reception settle-in' },
  { id: 'triage', title: 'Triage', text: 'Vitals, history, sensory screen' },
  { id: 'blueprint', title: 'Blueprint', text: 'Consult + Recovery Blueprint' },
  { id: 'zones', title: 'Zones', text: 'A · B · C treatment floors' },
  { id: 'progress', title: 'Progress', text: 'Monthly baseline vs current' },
] as const;

const PACKAGES = [
  {
    id: 'standard',
    title: 'Standard',
    lead: 'Assessment-led rehab with electrotherapy and guided active recovery.',
    points: ['Recovery Blueprint on day one', 'Zone A modalities', 'Session card tracking'],
  },
  {
    id: 'advanced',
    title: 'Advanced Tech-Led',
    lead: 'Shockwave, laser, hand robotics, and gait lab layered onto your blueprint.',
    points: ['Everything in Standard', 'Zone B advanced modalities', 'AI gait snapshot ready'],
  },
] as const;

const ZONES = [
  {
    id: 'A',
    title: 'Zone A — Electrotherapy & Traction',
    text: 'IFT, TENS, ultrasound, and traction for pain modulation and soft-tissue recovery.',
    image: '/wellness/care-zone-a.svg',
  },
  {
    id: 'B',
    title: 'Zone B — Shockwave, Laser & Hand Robotics',
    text: 'Focused shockwave, therapeutic laser, and hand robotics for stubborn and precision cases.',
    image: '/wellness/care-zone-b.svg',
  },
  {
    id: 'C',
    title: 'Zone C — Active Rehab & Gait Lab',
    text: 'Strength, mobility, and gait analysis so progress sticks outside the clinic.',
    image: '/wellness/care-zone-c.svg',
  },
] as const;

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function RemediumCareLanding() {
  const config = getWellnessClinicConfig('physiotherapy')!;
  const [wing, setWing] = useState<AlliedHealthWing | null>(null);
  const [services, setServices] = useState<AlliedHealthService[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsappCta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api.getAlliedHealthWings(),
      api.getAlliedHealthServices('physiotherapy'),
      api.getHomeContent().catch(() => ({ data: {} as { whatsapp_cta?: WhatsappCta } })),
    ])
      .then(([wingsRes, servicesRes, homeRes]) => {
        setWing((wingsRes.data.wings || []).find((w) => w.id === 'physiotherapy') || null);
        setServices(servicesRes.data.services || []);
        setWhatsapp((homeRes.data as { whatsapp_cta?: WhatsappCta }).whatsapp_cta || null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Care'))
      .finally(() => setLoading(false));
  }, []);

  const consultService = useMemo(() => {
    return (
      services.find((s) => /consult|assessment|initial/i.test(s.service_name)) ||
      services.slice().sort((a, b) => (a.rate || 0) - (b.rate || 0))[0] ||
      null
    );
  }, [services]);

  const rates = useMemo(() => services.map((s) => s.rate).filter((r) => r > 0), [services]);
  const startingRate = rates.length ? Math.min(...rates) : wing?.starting_rate || 0;

  function bookPath(code: string) {
    return `/wellness/care/book/${encodeURIComponent(code)}`;
  }

  function onSkip(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <div className="care-landing">
      <Link to="/wellness" className="care-back muted">
        ← All wellness wings
      </Link>

      <section className="care-hero" aria-label="Remedium Care">
        <img
          className="care-hero-img"
          src={config.heroImage}
          alt=""
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = '/wellness/care-hero.svg';
          }}
        />
        <div className="care-hero-shade" />
        <div className="care-hero-copy">
          <p className="care-brand">Remedium Care</p>
          <h1>Recover with a clear blueprint</h1>
          <p className="care-hero-lead">
            Ashoknagar Hub journey — check-in to progress — with Standard or Advanced Tech-Led packages.
          </p>
          <div className="care-hero-actions">
            {consultService ? (
              <Link className="btn care-cta" to={bookPath(consultService.service_code)}>
                Book assessment
              </Link>
            ) : (
              <a className="btn care-cta" href="#packages">
                Book assessment
              </a>
            )}
            <Link className="btn secondary care-cta-ghost" to="/wellness/sessions?wing=physiotherapy">
              Session packs
            </Link>
          </div>
        </div>
      </section>

      <section className="care-journey" aria-label="Care journey">
        <header>
          <h2>Your Care journey</h2>
          <p>One path from arrival to measurable progress.</p>
        </header>
        <ol className="care-journey-strip">
          {JOURNEY.map((step, i) => (
            <li key={step.id} style={{ animationDelay: `${0.08 * i}s` }}>
              <span className="care-journey-index">{i + 1}</span>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="care-packages" id="packages" aria-label="Packages">
        <header>
          <h2>Choose your package</h2>
          <p>Standard rehab or Advanced Tech-Led — blueprint first, then zones.</p>
        </header>
        <div className="care-package-grid">
          {PACKAGES.map((pkg) => (
            <article key={pkg.id} className={`care-package${pkg.id === 'advanced' ? ' is-advanced' : ''}`}>
              <h3>{pkg.title}</h3>
              <p>{pkg.lead}</p>
              <ul>
                {pkg.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {consultService ? (
                <Link className="btn" to={bookPath(consultService.service_code)}>
                  Start with assessment
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="care-zones" aria-label="Treatment zones">
        <header>
          <h2>Three clinical zones</h2>
          <p>Equipment narrative from the Ashoknagar Hub — matched to your blueprint.</p>
        </header>
        <div className="care-zone-panels">
          {ZONES.map((z, i) => (
            <article key={z.id} className="care-zone-panel" style={{ animationDelay: `${0.1 * i}s` }}>
              <img src={z.image} alt="" />
              <div>
                <h3>{z.title}</h3>
                <p>{z.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="care-trust" aria-label="Sessions">
        <header>
          <h2>Transparent sessions</h2>
          <p>
            {loading
              ? 'Loading rates…'
              : startingRate
                ? `From ${money(startingRate)} · ${wing?.service_count ?? services.length} sessions`
                : `${services.length} sessions listed`}
          </p>
        </header>
        {error ? <p className="error">{error}</p> : null}
        <div className="care-rate-grid">
          {services.slice(0, 6).map((s) => (
            <Link key={s.service_code} className="care-rate-card" to={bookPath(s.service_code)}>
              <strong>{s.service_name}</strong>
              <span>{money(s.rate)}</span>
            </Link>
          ))}
        </div>
        <div className="care-trust-actions">
          <Link className="btn secondary" to="/wellness/care/plan">
            My Care plan
          </Link>
          {whatsapp?.url ? (
            <a className="btn secondary" href={whatsapp.url} target="_blank" rel="noreferrer">
              WhatsApp Care desk
            </a>
          ) : null}
        </div>
      </section>

      <aside className="care-sticky">
        <div>
          <strong>Start your Care journey</strong>
          <span>Book an assessment — Recovery Blueprint on day one.</span>
        </div>
        {consultService ? (
          <Link className="btn care-cta" to={bookPath(consultService.service_code)}>
            Book now
          </Link>
        ) : (
          <a className="btn care-cta" href="#packages" onClick={onSkip}>
            Explore packages
          </a>
        )}
      </aside>
    </div>
  );
}
