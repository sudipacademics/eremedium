import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  CatalogItem,
  HomeHeaders,
  HomeQuickAction,
  HomeRadiologyService,
  LabPanel,
  WhatsappCta,
} from '../api';
import { AiPhysicianEntry } from '../components/AiPhysicianEntry';
import { PriceTag } from '../components/PriceTag';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { stripHtml } from '../utils/text';

type TrustBadge = { title: string; subtitle: string };
type HealthCategory = { label: string; query: string; icon?: string };
type CollectionStep = { step: number; title: string; description: string };

const ROUTE_MAP: Record<string, string> = {
  lab: '/diagnostics',
  pharmacy: '/pharmacy',
  appointments: '/appointments/book',
  orders: '/bookings',
};

function quickLinkHref(action: HomeQuickAction) {
  if (action.route === 'custom' && action.url) return action.url;
  return ROUTE_MAP[action.route] || '/services';
}

function isExternalHref(href: string) {
  return href.startsWith('http://') || href.startsWith('https://');
}

export function HomePage() {
  const [popular, setPopular] = useState<CatalogItem[]>([]);
  const [packages, setPackages] = useState<LabPanel[]>([]);
  const [radiology, setRadiology] = useState<HomeRadiologyService[]>([]);
  const [banners, setBanners] = useState<Array<{ title: string; subtitle: string; color: string }>>([]);
  const [trustBadges, setTrustBadges] = useState<TrustBadge[]>([]);
  const [categories, setCategories] = useState<HealthCategory[]>([]);
  const [steps, setSteps] = useState<CollectionStep[]>([]);
  const [quickActions, setQuickActions] = useState<HomeQuickAction[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsappCta | null>(null);
  const [headers, setHeaders] = useState<HomeHeaders>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHomeContent();
      setPopular(res.data.popular_tests || []);
      setPackages(res.data.health_packages || []);
      setRadiology(res.data.radiology_services || []);
      setBanners((res.data.banners as Array<{ title: string; subtitle: string; color: string }>) || []);
      setTrustBadges((res.data.trust_badges as TrustBadge[]) || []);
      setCategories((res.data.health_categories as HealthCategory[]) || []);
      setSteps((res.data.collection_steps as CollectionStep[]) || []);
      setQuickActions((res.data.quick_actions as HomeQuickAction[]) || []);
      setWhatsapp(res.data.whatsapp_cta || null);
      setHeaders(res.data.headers || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load home');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load);

  const homeTitle = headers.home_title || 'Book lab tests online';
  const homeSubtitle =
    headers.home_subtitle ||
    'Trusted diagnostics, doctor visits, and pharmacy — with home sample collection.';
  const searchPlaceholder =
    headers.search_placeholder || 'Search tests & packages (e.g. CBC, thyroid, diabetes)';

  return (
    <>
      <section className="hero hero-home">
        <h1>{homeTitle}</h1>
        <p className="hero-lead">{homeSubtitle}</p>
        <AiPhysicianEntry placeholder={searchPlaceholder} />
        <div className="home-quick-links">
          {quickActions.map((action) => {
            const href = quickLinkHref(action);
            const external = isExternalHref(href);
            const className = 'btn secondary btn-sm';
            return external ? (
              <a key={action.title} className={className} href={href} target="_blank" rel="noreferrer">
                {action.title}
              </a>
            ) : (
              <Link key={action.title} className={className} to={href}>
                {action.title}
              </Link>
            );
          })}
          <Link className="btn secondary btn-sm" to="/wellness">
            Wellness
          </Link>
          <Link className="btn secondary btn-sm" to="/insurance">
            Insurance
          </Link>
        </div>
      </section>

      {whatsapp?.enabled && whatsapp.url && (
        <section className="whatsapp-cta card card-wide">
          <div>
            <strong>Prefer WhatsApp?</strong>
            <p className="muted">Chat with us to book tests, packages, or home collection.</p>
          </div>
          <a className="btn whatsapp-btn" href={whatsapp.url} target="_blank" rel="noreferrer">
            {whatsapp.label || 'Book on WhatsApp'}
          </a>
        </section>
      )}

      {categories.length > 0 && (
        <section className="home-section">
          <h2>Tests for your health needs</h2>
          <div className="category-scroll">
            {categories.map((cat) => (
              <Link
                key={cat.label}
                className="category-chip"
                to={`/diagnostics?q=${encodeURIComponent(cat.query)}`}
              >
                <span className="category-icon" aria-hidden>
                  {cat.icon}
                </span>
                <span>{cat.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {trustBadges.length > 0 && (
        <section className="trust-grid">
          {trustBadges.map((badge) => (
            <article key={badge.title} className="card trust-card">
              <strong>{badge.title}</strong>
              <p className="muted">{badge.subtitle}</p>
            </article>
          ))}
        </section>
      )}

      {packages.length > 0 && (
        <section className="home-section">
          <h2>{headers.section_packages_title || 'Health packages'}</h2>
          <div className="package-scroll">
            {packages.map((pkg) => (
              <article key={pkg.panel_id} className="card package-card">
                <h3>{pkg.panel_name}</h3>
                <p className="muted package-desc">{stripHtml(pkg.description)}</p>
                <p className="package-meta">
                  <strong>₹{pkg.rate.toFixed(0)}</strong>
                  <span className="muted"> · {pkg.tests.length} tests</span>
                </p>
                <Link className="btn btn-sm" to={`/diagnostics/panel/${encodeURIComponent(pkg.panel_id)}`}>
                  Book package
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {radiology.length > 0 && (
        <section className="home-section">
          <h2>{headers.section_radiology_title || 'Radiology & imaging'}</h2>
          <div className="radiology-grid">
            {radiology.map((svc) => (
              <Link
                key={svc.title}
                className="card radiology-card"
                to={`/diagnostics?q=${encodeURIComponent(svc.query)}`}
              >
                <span className="category-icon" aria-hidden>
                  {svc.icon}
                </span>
                <strong>{svc.title}</strong>
                <p className="muted">{svc.description}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {banners.length > 0 && (
        <div className="banner-row">
          {banners.map((banner) => (
            <div key={banner.title} className="banner" style={{ background: banner.color }}>
              <h3>{banner.title}</h3>
              <p>{banner.subtitle}</p>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <h2>{headers.section_popular_title || 'Popular diagnostics'}</h2>
        <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      <div className="grid">
        {popular.map((item) => (
          <article key={item.name} className="card">
            <h3>{item.item_name}</h3>
            <p>{stripHtml(item.description)}</p>
            <PriceTag item={item} />
            <div className="lab-card-actions">
              <Link className="btn secondary btn-sm" to={`/diagnostics/test/${encodeURIComponent(item.name)}`}>
                View details
              </Link>
              <Link className="btn btn-sm" to={`/diagnostics/book/${encodeURIComponent(item.name)}`}>
                Book now
              </Link>
            </div>
          </article>
        ))}
      </div>

      {steps.length > 0 && (
        <section className="home-section card card-wide collection-steps">
          <h2>How home sample collection works</h2>
          <ol className="steps-list">
            {steps.map((s) => (
              <li key={s.step}>
                <span className="step-num">{s.step}</span>
                <div>
                  <strong>{s.title}</strong>
                  <p className="muted">{s.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
