import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AlliedHealthWing, PromoBanner } from '../../api';
import { getWellnessClinicConfig } from './wellnessClinicConfig';

function money(n?: number) {
  if (!n) return '';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function WellnessWingVisual({ wing }: { wing: AlliedHealthWing }) {
  const cfg = getWellnessClinicConfig(wing.id);
  const img = cfg?.heroImage || wing.image;
  return (
    <div
      className={`wellness-wing-visual${cfg ? ' wellness-wing-visual-photo' : ''}${
        cfg?.theme === 'indic' ? ' is-indic' : ''
      }`}
      style={cfg ? undefined : { backgroundColor: wing.color }}
      aria-hidden
    >
      {cfg ? (
        <img
          src={img}
          alt=""
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = cfg.heroFallback;
          }}
        />
      ) : (
        <span className="wellness-wing-visual-icon">{wing.icon}</span>
      )}
    </div>
  );
}

function WellnessPromoBanner({ banner }: { banner: PromoBanner }) {
  const style = banner.image_url
    ? {
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.35)), url(${banner.image_url})`,
        backgroundSize: 'cover' as const,
        backgroundPosition: 'center',
      }
    : { background: banner.color };

  return (
    <div className="wellness-promo-banner" style={style}>
      <h3>{banner.title}</h3>
      {banner.subtitle && <p>{banner.subtitle}</p>}
    </div>
  );
}

export function WellnessHubPage() {
  const [wings, setWings] = useState<AlliedHealthWing[]>([]);
  const [promoBanners, setPromoBanners] = useState<PromoBanner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .getAlliedHealthWings()
      .then((res) => {
        setWings(res.data.wings || []);
        setPromoBanners(res.data.promo_banners || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load wellness wings'))
      .finally(() => setLoading(false));
  }, []);

  const featuredIds = ['aesthetics', 'yoga', 'ayurvedic'];
  const featured = featuredIds
    .map((id) => wings.find((w) => w.id === id))
    .filter(Boolean) as AlliedHealthWing[];
  const otherWings = wings.filter((w) => !featuredIds.includes(w.id));
  const catalogFrom = useMemo(() => {
    const rates = wings.map((w) => w.starting_rate || 0).filter((r) => r > 0);
    return rates.length ? Math.min(...rates) : 0;
  }, [wings]);

  return (
    <div className="wellness-hub">
      <section className="wellness-hub-hero">
        <div className="wellness-hub-hero-copy">
          <p className="brand-kicker">Remedium Wellness</p>
          <h1>Clinics for skin, mind, movement &amp; Indic care</h1>
          <p className="wellness-hub-lead">
            Session rates from the live wellness rate chart — choose a clinic, pick a treatment, and
            book in four clear steps.
          </p>
          <div className="wellness-hub-hero-meta">
            {catalogFrom ? <span>From {money(catalogFrom)}</span> : null}
            <span>{wings.reduce((n, w) => n + (w.service_count || 0), 0)} sessions</span>
            <span>Pay online or at centre</span>
          </div>
          <div className="wellness-hub-cta-row">
            <a className="btn" href="#wellness-clinics">
              Browse clinics
            </a>
            <Link className="btn secondary" to="/wellness/sessions">
              Session cards
            </Link>
            <Link className="btn secondary" to="/yoga-memberships">
              Yoga memberships
            </Link>
          </div>
        </div>
        <ol className="wellness-hub-path" aria-label="How booking works">
          <li>
            <strong>1. Clinic</strong>
            <span>Aesthetics, psychology, physio, Ayurveda, yoga</span>
          </li>
          <li>
            <strong>2. Treatment</strong>
            <span>Transparent single-session rates</span>
          </li>
          <li>
            <strong>3. Schedule</strong>
            <span>Pick date, clinician, and slot</span>
          </li>
          <li>
            <strong>4. Confirm</strong>
            <span>Pay securely and track under My orders</span>
          </li>
        </ol>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading clinics…</p>}

      {promoBanners.length > 0 && (
        <div className="wellness-promo-row">
          {promoBanners.map((banner) => (
            <WellnessPromoBanner key={banner.title} banner={banner} />
          ))}
        </div>
      )}

      <div id="wellness-clinics">
        {featured.length > 0 ? (
          <div className="wellness-featured-grid">
            {featured.map((wing) => {
              const cfg = getWellnessClinicConfig(wing.id);
              return (
                <Link
                  key={wing.id}
                  className={`wellness-aesthetics-feature${cfg?.theme === 'indic' ? ' is-indic' : ''}`}
                  to={`/wellness/${wing.id}`}
                >
                  <div className="wellness-aesthetics-feature-copy">
                    <span className="home-chronic-badge">
                      {cfg?.theme === 'indic' ? 'Indic · Sessions' : 'Clinic · Sessions'}
                    </span>
                    <h2>{wing.title}</h2>
                    <p>{cfg?.hubTeaser || wing.subtitle}</p>
                    <p className="wellness-wing-meta">
                      {wing.service_count ?? 0} sessions
                      {wing.starting_rate ? ` · from ${money(wing.starting_rate)}` : ''}
                    </p>
                    <span className="btn btn-sm">Explore &amp; book</span>
                  </div>
                  <div className="wellness-aesthetics-feature-visual" aria-hidden>
                    <img
                      src={cfg?.heroImage || wing.image}
                      alt=""
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src =
                          cfg?.heroFallback || wing.image || '';
                      }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : null}

        <div className="wellness-wing-grid">
          {otherWings.map((wing) => (
            <Link key={wing.id} className="wellness-wing-card" to={`/wellness/${wing.id}`}>
              <WellnessWingVisual wing={wing} />
              <div className="wellness-wing-body">
                <span className="wellness-wing-icon" aria-hidden>
                  {wing.icon}
                </span>
                <h2>{wing.title}</h2>
                <p className="muted">{getWellnessClinicConfig(wing.id)?.hubTeaser || wing.subtitle}</p>
                <p className="wellness-wing-meta">
                  {wing.service_count ?? 0} sessions
                  {wing.starting_rate ? ` · from ${money(wing.starting_rate)}` : ''}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
