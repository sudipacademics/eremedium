import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  CatalogItem,
  HomeHeaders,
  HomeRadiologyService,
  LabPanel,
  WhatsappCta,
} from '../api';
import { AiPhysicianEntry } from '../components/AiPhysicianEntry';
import { PriceTag } from '../components/PriceTag';
import { useAuth } from '../auth/AuthContext';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { stripHtml } from '../utils/text';

type TrustBadge = { title: string; subtitle: string };
type HealthCategory = { label: string; query: string; icon?: string };
type CollectionStep = { step: number; title: string; description: string };

const FALLBACK_CATEGORIES: HealthCategory[] = [
  { label: 'Full body', query: 'full body' },
  { label: 'Fever', query: 'fever' },
  { label: 'Diabetes', query: 'diabetes' },
  { label: 'Thyroid', query: 'thyroid' },
  { label: 'Vitamins', query: 'vitamin' },
  { label: 'Heart', query: 'lipid' },
  { label: "Women's health", query: 'women' },
  { label: 'Senior care', query: 'senior' },
];

const HERO_SLIDES = [
  {
    id: 'lab',
    image: '/home/hero-lab.jpg',
    title: 'Your Health, Our Priority',
    subtitle: 'Quality care, trusted by thousands every day.',
    ctaLabel: 'Book a Test',
    ctaTo: '/diagnostics',
  },
  {
    id: 'care',
    image: '/home/hero-care.jpg',
    title: 'Home sample collection',
    subtitle: 'Book labs online — phlebotomist at your doorstep.',
    ctaLabel: 'Find centres',
    ctaTo: '/centres',
  },
  {
    id: 'doctor',
    image: '/home/hero-lab.jpg',
    title: 'Doctors & wellness',
    subtitle: 'Consult specialists and explore allied care packages.',
    ctaLabel: 'Book doctor',
    ctaTo: '/appointments/book',
  },
];

const QUICK_ACTIONS: Array<{
  to: string;
  title: string;
  icon: string;
  auth?: boolean;
}> = [
  { to: '/diagnostics', title: 'Book Lab Test', icon: '/home/icon-lab.svg' },
  { to: '/appointments/book', title: 'Doctor Appointment', icon: '/home/icon-doctor.svg' },
  { to: '/centres', title: 'Sample Collection', icon: '/home/icon-sample.svg' },
  { to: '/bookings', title: 'View Reports', icon: '/home/icon-reports.svg', auth: true },
];

const PKG_ICONS = ['🧪', '❤️', '🦋', '💪', '🩺', '🧬'];

function packageOffPercent(pkg: LabPanel): number | null {
  const mrp = Number(pkg.mrp || 0);
  const rate = Number(pkg.rate || 0);
  if (mrp > rate && rate > 0) {
    return Math.round(((mrp - rate) / mrp) * 100);
  }
  return null;
}

export function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [labQuery, setLabQuery] = useState('');
  const [popular, setPopular] = useState<CatalogItem[]>([]);
  const [packages, setPackages] = useState<LabPanel[]>([]);
  const [radiology, setRadiology] = useState<HomeRadiologyService[]>([]);
  const [trustBadges, setTrustBadges] = useState<TrustBadge[]>([]);
  const [categories, setCategories] = useState<HealthCategory[]>([]);
  const [steps, setSteps] = useState<CollectionStep[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsappCta | null>(null);
  const [headers, setHeaders] = useState<HomeHeaders>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  const slides = useMemo(() => {
    const title = headers.home_title || HERO_SLIDES[0].title;
    const subtitle = headers.home_subtitle || HERO_SLIDES[0].subtitle;
    return HERO_SLIDES.map((s, i) =>
      i === 0 ? { ...s, title, subtitle } : s,
    );
  }, [headers.home_subtitle, headers.home_title]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHomeContent();
      setPopular(res.data.popular_tests || []);
      setPackages(res.data.health_packages || []);
      setRadiology(res.data.radiology_services || []);
      setTrustBadges((res.data.trust_badges as TrustBadge[]) || []);
      const cats = (res.data.health_categories as HealthCategory[]) || [];
      setCategories(cats.length ? cats : FALLBACK_CATEGORIES);
      setSteps((res.data.collection_steps as CollectionStep[]) || []);
      setWhatsapp(res.data.whatsapp_cta || null);
      setHeaders(res.data.headers || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load home');
      setCategories(FALLBACK_CATEGORIES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setSlide((s) => (s + 1) % slides.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, [paused, slides.length]);

  const searchPlaceholder =
    headers.search_placeholder || 'Describe symptoms or search tests…';

  function onLabSearch(e: FormEvent) {
    e.preventDefault();
    const q = labQuery.trim();
    navigate(q ? `/diagnostics?q=${encodeURIComponent(q)}` : '/diagnostics');
  }

  function goSlide(dir: -1 | 1) {
    setSlide((s) => (s + dir + slides.length) % slides.length);
  }

  return (
    <div className="home-mock">
      <section
        className="home-hero-carousel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        aria-roledescription="carousel"
        aria-label="Featured promotions"
      >
        {slides.map((s, i) => (
          <article
            key={s.id}
            className={`home-hero-slide${i === slide ? ' is-active' : ''}`}
            aria-hidden={i !== slide}
          >
            <img className="home-hero-img" src={s.image} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
            <div className="home-hero-shade" />
            <div className="home-hero-copy">
              <p className="brand-kicker">Remedium</p>
              <h1>{s.title}</h1>
              <p className="hero-lead">{s.subtitle}</p>
              <div className="home-hero-actions">
                <Link className="btn home-hero-cta" to={s.ctaTo}>
                  <span className="home-play-dot" aria-hidden="true" />
                  {s.ctaLabel}
                </Link>
                <Link className="btn secondary home-hero-cta-ghost" to="/diagnostics">
                  Explore packages
                </Link>
              </div>
            </div>
          </article>
        ))}
        <button
          type="button"
          className="home-hero-nav home-hero-prev"
          aria-label="Previous slide"
          onClick={() => goSlide(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="home-hero-nav home-hero-next"
          aria-label="Next slide"
          onClick={() => goSlide(1)}
        >
          ›
        </button>
        <div className="home-hero-dots" role="tablist" aria-label="Slides">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === slide}
              className={i === slide ? 'is-active' : ''}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setSlide(i)}
            />
          ))}
        </div>
      </section>

      <section className="home-section home-ai-wrap">
        <AiPhysicianEntry placeholder={searchPlaceholder} />
        <form className="labs-search-combo home-search-bar" onSubmit={onLabSearch}>
          <input
            type="search"
            value={labQuery}
            onChange={(e) => setLabQuery(e.target.value)}
            placeholder="Search tests or full body checkups"
            aria-label="Search lab tests"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </section>

      <section className="home-section">
        <div className="home-qa-row">
          {QUICK_ACTIONS.map((qa) => {
            const to = qa.auth && !isAuthenticated ? '/login' : qa.to;
            return (
              <Link key={qa.title} className="home-qa" to={to}>
                <span className="home-qa-icon">
                  <img src={qa.icon} alt="" width={56} height={56} />
                </span>
                <strong>{qa.title}</strong>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="home-promo-nabl">
        <img className="home-promo-nabl-bg" src="/home/nabl-facility.jpg" alt="" />
        <div className="home-promo-nabl-shade" />
        <div className="home-promo-nabl-copy">
          <span className="home-nabl-badge">✓ NABL Accredited</span>
          <h2>Accurate Reports, Trusted Care</h2>
          <p>
            {trustBadges[0]?.subtitle ||
              'Advanced technology & expert care for your peace of mind.'}
          </p>
          <Link className="btn" to="/diagnostics">
            Book a Test
          </Link>
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <div>
            <h2 className="section-title">{headers.section_packages_title || 'Health Packages'}</h2>
            <p className="section-sub">Curated panels with transparent pricing.</p>
          </div>
          <Link className="text-link" to="/diagnostics">
            View All ›
          </Link>
        </div>
        {packages.length > 0 ? (
          <div className="package-scroll home-pkg-scroll">
            {packages.map((pkg, idx) => {
              const off = packageOffPercent(pkg);
              return (
                <article key={pkg.panel_id} className="pkg-card pkg-card-mock">
                  {off ? <span className="pkg-off-badge">{off}% OFF</span> : null}
                  <div className="pkg-card-icon" aria-hidden="true">
                    {PKG_ICONS[idx % PKG_ICONS.length]}
                  </div>
                  <h3>{pkg.panel_name}</h3>
                  <p className="muted package-desc">
                    {pkg.tests?.length
                      ? `${pkg.tests.length} tests included`
                      : stripHtml(pkg.description)}
                  </p>
                  <PriceTag
                    item={{
                      name: pkg.panel_id,
                      item_name: pkg.panel_name,
                      standard_rate: Number(pkg.rate),
                      rate: Number(pkg.rate),
                      mrp: pkg.mrp ? Number(pkg.mrp) : undefined,
                      discount_percent: off || pkg.discount_percent,
                      price_basis: pkg.price_basis || (off ? 'ten_percent' : undefined),
                      wallet_earn_amount: pkg.wallet_earn_amount,
                      wallet_earn_percent: pkg.wallet_earn_percent,
                      member_tag: pkg.member_tag,
                      coupon_label: pkg.coupon_label,
                    }}
                    size="sm"
                  />
                  <Link
                    className="btn btn-sm"
                    to={`/diagnostics/panel/${encodeURIComponent(pkg.panel_id)}`}
                  >
                    Book package
                  </Link>
                </article>
              );
            })}
          </div>
        ) : loading ? (
          <p className="muted">Loading packages…</p>
        ) : (
          <div className="package-scroll home-pkg-scroll">
            {[
              { name: 'Full Body Checkup', rate: 999, mrp: 1999, q: 'full body' },
              { name: 'Diabetes Care', rate: 599, mrp: 1199, q: 'diabetes' },
              { name: 'Thyroid Profile', rate: 399, mrp: 799, q: 'thyroid' },
            ].map((p, idx) => (
              <article key={p.name} className="pkg-card pkg-card-mock">
                <span className="pkg-off-badge">50% OFF</span>
                <div className="pkg-card-icon" aria-hidden="true">
                  {PKG_ICONS[idx]}
                </div>
                <h3>{p.name}</h3>
                <p className="muted package-desc">Popular starter panel</p>
                <p className="pkg-card-meta">
                  <span className="price-sale">₹{p.rate}</span>
                  <span className="price-mrp">₹{p.mrp}</span>
                </p>
                <Link className="btn btn-sm" to={`/diagnostics?q=${encodeURIComponent(p.q)}`}>
                  Explore
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="home-centres-banner">
        <div className="home-centres-copy">
          <span className="home-centres-pin" aria-hidden="true">
            📍
          </span>
          <h2>Nearby Remedium Centres</h2>
          <p className="muted">Find Remedium labs &amp; centres near you.</p>
          <Link className="btn" to="/centres">
            Find Nearby
          </Link>
        </div>
        <div className="home-centres-visual">
          <img src="/home/centres-map.jpg" alt="Remedium centre" />
        </div>
      </section>

      <section className="home-chronic-banner">
        <div className="home-chronic-copy">
          <span className="home-chronic-badge">Monthly packs</span>
          <h2>Chronic medicine subscription</h2>
          <p>
            Upload your prescription once and get wholesale-rate monthly medicine packs delivered —
            diabetes, BP, thyroid, and long-term care.
          </p>
          <ul className="home-chronic-perks">
            <li>Up to 60–70% savings vs retail</li>
            <li>1–12 month pack duration</li>
            <li>Pharmacist-reviewed quotation</li>
          </ul>
          <div className="home-chronic-actions">
            <Link className="btn" to="/pharmacy">
              Start subscription quote
            </Link>
            <Link className="btn secondary" to={isAuthenticated ? '/bookings' : '/login'}>
              Track orders
            </Link>
          </div>
        </div>
        <div className="home-chronic-visual" aria-hidden="true">
          <div className="home-chronic-pill">Rx</div>
          <p>Refill without the pharmacy run</p>
        </div>
      </section>

      <section className="home-promo-pair">
        <Link className="home-promo-mini home-promo-offers" to="/diagnostics">
          <img src="/home/icon-gift.svg" alt="" width={56} height={56} />
          <div>
            <strong>Exclusive Offers</strong>
            <span>Save more on health checkups</span>
          </div>
        </Link>
        <Link
          className="home-promo-mini home-promo-refer"
          to={isAuthenticated ? '/account/refer' : '/login'}
        >
          <img src="/home/icon-refer.svg" alt="" width={56} height={56} />
          <div>
            <strong>Refer &amp; Earn</strong>
            <span>Refer a friend &amp; earn rewards</span>
          </div>
        </Link>
      </section>

      {whatsapp?.enabled && whatsapp.url ? (
        <section className="whatsapp-cta card card-wide">
          <div>
            <strong>Prefer WhatsApp?</strong>
            <p className="muted">Chat with us to book tests, packages, or home collection.</p>
          </div>
          <a className="btn whatsapp-btn" href={whatsapp.url} target="_blank" rel="noreferrer">
            {whatsapp.label || 'Book on WhatsApp'}
          </a>
        </section>
      ) : null}

      <section className="home-section home-section-soft">
        <h2 className="section-title">Browse by concern</h2>
        <div className="category-tile-grid category-tile-grid--sm">
          {categories.map((cat) => (
            <Link
              key={cat.label}
              className="category-tile"
              to={`/diagnostics?q=${encodeURIComponent(cat.query)}`}
            >
              <span className="category-tile-label">{cat.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {radiology.length > 0 ? (
        <section className="home-section home-section-soft">
          <div className="section-head">
            <h2 className="section-title">
              {headers.section_radiology_title || 'Radiology & imaging'}
            </h2>
            <Link className="text-link" to="/services">
              View all ›
            </Link>
          </div>
          <div className="radiology-grid">
            {radiology.map((svc) => (
              <article key={svc.title || svc.query} className="card">
                <h3>{svc.title}</h3>
                <p className="muted">{svc.description}</p>
                <Link
                  className="btn btn-sm secondary"
                  to={`/diagnostics?q=${encodeURIComponent(svc.query || svc.title)}`}
                >
                  Explore
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="home-section home-section-soft">
        <div className="section-head">
          <h2 className="section-title">
            {headers.section_popular_title || 'Popular diagnostics'}
          </h2>
          <button
            className="btn secondary btn-sm"
            type="button"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
        {error ? <div className="error">{error}</div> : null}
        {loading && !popular.length ? <p className="muted">Loading…</p> : null}
        <div className="catalog-grid">
          {popular.map((item) => (
            <article key={item.name} className="card">
              <h3>{item.item_name}</h3>
              <p className="muted">{stripHtml(item.description)}</p>
              <PriceTag item={item} />
              <Link className="btn btn-sm" to={`/diagnostics/book/${encodeURIComponent(item.name)}`}>
                Book
              </Link>
            </article>
          ))}
        </div>
      </section>

      {steps.length > 0 ? (
        <section className="home-section home-section-soft">
          <h2 className="section-title">How home sample collection works</h2>
          <ol className="collection-steps">
            {steps.map((s) => (
              <li key={s.step}>
                <strong>
                  {s.step}. {s.title}
                </strong>
                <p className="muted">{s.description}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
