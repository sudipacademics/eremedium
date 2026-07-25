import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AlliedHealthWing, PromoBanner } from '../../api';
import { getWellnessClinicConfig } from './wellnessClinicConfig';

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
        backgroundSize: 'cover',
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

  return (
    <>
      <section className="hero hero-compact">
        <h1>Wellness &amp; Allied Health</h1>
        <p className="hero-lead">
          Session-based clinics for aesthetics, mind, movement, Ayurveda, and yoga — book and track in
          My orders.
        </p>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading wings…</p>}

      {promoBanners.length > 0 && (
        <div className="wellness-promo-row">
          {promoBanners.map((banner) => (
            <WellnessPromoBanner key={banner.title} banner={banner} />
          ))}
        </div>
      )}

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
                    {wing.starting_rate ? ` · from ₹${wing.starting_rate.toFixed(0)}` : ''}
                  </p>
                  <span className="btn btn-sm">Explore clinic</span>
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
                {wing.starting_rate ? ` · from ₹${wing.starting_rate.toFixed(0)}` : ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
