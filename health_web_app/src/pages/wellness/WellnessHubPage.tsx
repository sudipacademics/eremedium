import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AlliedHealthWing, PromoBanner } from '../../api';

function WellnessWingVisual({ wing }: { wing: AlliedHealthWing }) {
  return (
    <div className="wellness-wing-visual" style={{ backgroundColor: wing.color }} aria-hidden>
      <span className="wellness-wing-visual-icon">{wing.icon}</span>
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

  return (
    <>
      <section className="hero hero-compact">
        <h1>Wellness &amp; Allied Health</h1>
        <p className="hero-lead">
          Psychology, aesthetics, physiotherapy, chiropractic, and Ayurvedic care — book sessions,
          pay online, and track appointments in My orders.
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

      <div className="wellness-wing-grid">
        {wings.map((wing) => (
          <Link key={wing.id} className="wellness-wing-card" to={`/wellness/${wing.id}`}>
            <WellnessWingVisual wing={wing} />
            <div className="wellness-wing-body">
              <span className="wellness-wing-icon" aria-hidden>
                {wing.icon}
              </span>
              <h2>{wing.title}</h2>
              <p className="muted">{wing.subtitle}</p>
              <p className="wellness-wing-meta">
                {wing.service_count ?? 0} services
                {wing.starting_rate ? ` · from ₹${wing.starting_rate.toFixed(0)}` : ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
