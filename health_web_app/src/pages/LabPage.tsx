import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, CatalogItem, LabPanel, itemDiscountPercent } from '../api';
import { PriceTag } from '../components/PriceTag';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { stripHtml } from '../utils/text';
import './home-v2.css';
import './labs-v2.css';

const LAB_CATEGORIES = [
  { label: 'Full body', query: 'full body', icon: 'body', tone: 'teal' },
  { label: 'Diabetes', query: 'diabetes', icon: 'drop', tone: 'blue' },
  { label: 'Thyroid', query: 'thyroid', icon: 'butterfly', tone: 'violet' },
  { label: 'Vitamins', query: 'vitamin', icon: 'sun', tone: 'amber' },
  { label: "Women's health", query: 'women', icon: 'user', tone: 'pink' },
  { label: 'Fever', query: 'fever', icon: 'thermo', tone: 'red' },
  { label: 'Heart', query: 'lipid', icon: 'heart', tone: 'red' },
  { label: 'Packages', query: 'package', icon: 'flask', tone: 'green' },
] as const;

const IMAGING = [
  { title: 'X-Ray', description: 'Chest, spine, joints', query: 'x-ray' },
  { title: 'Ultrasound', description: 'Abdomen, pelvis, pregnancy', query: 'ultrasound' },
  { title: 'MRI', description: 'Brain, spine, joints', query: 'mri' },
  { title: 'CT Scan', description: 'Head, chest, abdomen', query: 'ct scan' },
];

const TRUST = [
  { title: 'NABL Accredited', sub: 'Accurate reports, every time', icon: 'shield', tone: 'teal' },
  { title: 'Home collection', sub: 'Phlebotomist at your doorstep', icon: 'home', tone: 'blue' },
  { title: 'Digital reports', sub: 'PDF in My orders', icon: 'report', tone: 'sky' },
  { title: 'Fair price', sub: 'Transparent test rates', icon: 'rupee', tone: 'amber' },
];

const PKG_TONES = ['green', 'pink', 'violet', 'amber', 'teal', 'blue'] as const;

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  flask: <><path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" /><path d="M7.5 15h9" /></>,
  shield: <><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  home: <><path d="M3.5 11L12 4l8.5 7" /><path d="M6 9.5V20h12V9.5" /></>,
  report: <><path d="M7 3.5h7l3 3v14H7z" /><path d="M14 3.5V7h3M9.5 13l2 2 3.5-4" /></>,
  rupee: <path d="M7 5h10M7 9h10M7 5c4 0 6 1.5 6 4s-2 4-6 4l7 6" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  drop: <path d="M12 3.5s-6 6.5-6 10.5a6 6 0 0 0 12 0c0-4-6-10.5-6-10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-4 3.4-6 7-6s6.4 2 7 6" /></>,
  thermo: <><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" /><path d="M12 9v7" /></>,
  butterfly: <><path d="M12 7v12" /><path d="M12 9C9 4 4 4.5 4 8s3 5 8 4M12 9c3-5 8-4.5 8-1s-3 5-8 4" /></>,
  body: <><circle cx="12" cy="4.5" r="2" /><path d="M6 9l6-1 6 1M12 8v6M12 14l-3 7M12 14l3 7" /></>,
};

function matchesQuery(item: CatalogItem, q: string) {
  const hay = `${item.item_name} ${item.name} ${item.description || ''}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function packageOffPercent(pkg: LabPanel): number | null {
  const mrp = Number(pkg.mrp || 0);
  const rate = Number(pkg.rate || 0);
  if (mrp > rate && rate > 0) return Math.round(((mrp - rate) / mrp) * 100);
  return null;
}

function useRail() {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(560, Math.max(220, el.clientWidth * 0.8)), behavior: 'smooth' });
  }, []);
  return { ref, scroll };
}

export function LabPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = (searchParams.get('q') || '').trim();
  const hub = (searchParams.get('hub') || '').trim();
  const [draft, setDraft] = useState(query);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [packages, setPackages] = useState<LabPanel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pkgRail = useRail();

  useEffect(() => {
    setDraft(query);
  }, [query]);

  function clearSearchUrl() {
    const params = new URLSearchParams();
    if (hub) params.set('hub', hub);
    navigate(params.toString() ? `/diagnostics?${params}` : '/diagnostics', { replace: true });
  }

  function onDraftChange(value: string) {
    setDraft(value);
    if (!value.trim() && query) {
      clearSearchUrl();
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalog, panels] = await Promise.all([api.getLabCatalog(), api.getLabPanels()]);
      setItems(catalog.data.items || []);
      setPackages(panels.data.panels || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 48);
    return items.filter((item) => matchesQuery(item, query));
  }, [items, query]);

  const filteredPackages = useMemo(() => {
    if (!query) return packages.slice(0, 16);
    const q = query.toLowerCase();
    return packages.filter(
      (p) => p.panel_name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q),
    );
  }, [packages, query]);

  function hrefFor(q: string) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (hub) params.set('hub', hub);
    return params.toString() ? `/diagnostics?${params}` : '/diagnostics';
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!next) {
      setDraft('');
      clearSearchUrl();
      return;
    }
    navigate(hrefFor(next));
  }

  function bookHref(code: string) {
    return `/diagnostics/book/${encodeURIComponent(code)}${hub ? `?hub=${encodeURIComponent(hub)}` : ''}`;
  }

  return (
    <div className="home-v2 labs-v2">
      <section className="hv-card labs-hero">
        <div className="labs-hero-copy">
          <span className="hv-badge">NABL Accredited Labs</span>
          <h1>Book lab tests online</h1>
          <p className="hv-muted">
            Search tests and health packages, or book home collection.
            {hub ? ' A nearby centre is pre-selected from Centres near me.' : ''}
          </p>
          <form className="labs-search" onSubmit={onSearch}>
            <Link to="/centres">Near me</Link>
            <input
              type="search"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="Search CBC, thyroid, full body…"
              aria-label="Search lab tests"
              autoComplete="off"
            />
            <button className="hv-btn hv-btn-sm" type="submit">
              Search
            </button>
          </form>
        </div>
        <div className="labs-hero-visual" aria-hidden>
          <img src="/home/hero-scientist.jpg" alt="" />
        </div>
      </section>

      <ul className="labs-trust">
        {TRUST.map((item) => (
          <li key={item.title} className="hv-card">
            <span className={`labs-trust-icon tone-${item.tone}`}>
              <Icon>{ICONS[item.icon]}</Icon>
            </span>
            <div>
              <strong>{item.title}</strong>
              <span>{item.sub}</span>
            </div>
          </li>
        ))}
      </ul>

      {query ? (
        <div className="labs-query">
          <h2>Results for “{query}”</h2>
          <Link className="hv-link" to={hrefFor('')}>
            Clear search
          </Link>
        </div>
      ) : (
        <>
          <section className="hv-card hv-concerns">
            <div className="hv-head">
              <h2>Browse by concern</h2>
            </div>
            <div className="hv-concern-grid">
              {LAB_CATEGORIES.map((cat) => (
                <Link key={cat.label} className="hv-concern" to={hrefFor(cat.query)}>
                  <span className={`hv-concern-icon tone-${cat.tone}`}>
                    <Icon size={16}>{ICONS[cat.icon]}</Icon>
                  </span>
                  {cat.label}
                </Link>
              ))}
            </div>
          </section>
          <section className="hv-card hv-radiology">
            <div className="hv-head">
              <h2>Radiology &amp; imaging</h2>
            </div>
            <div className="hv-radiology-grid">
              {IMAGING.map((svc) => (
                <article key={svc.title} className="hv-radiology-card">
                  <strong>{svc.title}</strong>
                  <p className="hv-muted">{svc.description}</p>
                  <Link className="hv-btn hv-btn-soft hv-btn-sm" to={hrefFor(svc.query)}>
                    Explore
                  </Link>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="hv-muted">Loading catalog…</p> : null}

      {filteredPackages.length > 0 ? (
        <section className="hv-section">
          <div className="hv-head">
            <div>
              <h2>{query ? 'Matching packages' : 'Health packages'}</h2>
              <p>Curated panels with transparent pricing.</p>
            </div>
          </div>
          <div className="hv-rail-wrap">
            <button type="button" className="hv-rail-arrow hv-rail-prev" onClick={() => pkgRail.scroll(-1)} aria-label="Scroll packages left">
              ‹
            </button>
            <button type="button" className="hv-rail-arrow hv-rail-next" onClick={() => pkgRail.scroll(1)} aria-label="Scroll packages right">
              ›
            </button>
            <div className="hv-rail" ref={pkgRail.ref}>
              {filteredPackages.map((pkg, idx) => {
                const off = packageOffPercent(pkg);
                const to = `/diagnostics/panel/${encodeURIComponent(pkg.panel_id)}`;
                return (
                  <article key={pkg.panel_id} className="hv-pkg">
                    {off ? <span className="hv-off">{off}% OFF</span> : null}
                    <span className={`hv-pkg-icon tone-${PKG_TONES[idx % PKG_TONES.length]}`}>
                      <Icon size={22}>{ICONS.flask}</Icon>
                    </span>
                    <h3>{pkg.panel_name}</h3>
                    <p className="hv-muted">{pkg.tests.length} tests included</p>
                    <PriceTag
                      compact
                      size="sm"
                      item={{
                        name: pkg.panel_id,
                        item_name: pkg.panel_name,
                        standard_rate: pkg.rate,
                        rate: pkg.rate,
                        mrp: pkg.mrp ?? undefined,
                        discount_percent: pkg.discount_percent,
                        price_basis: pkg.price_basis,
                        wallet_earn_amount: pkg.wallet_earn_amount,
                        wallet_earn_percent: pkg.wallet_earn_percent,
                        member_tag: pkg.member_tag,
                        coupon_label: pkg.coupon_label,
                      }}
                    />
                    <div className="hv-pkg-actions">
                      <Link className="hv-btn hv-btn-soft hv-btn-sm" to={to}>
                        Details
                      </Link>
                      <Link className="hv-btn hv-btn-sm" to={to}>
                        Book
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <section className="hv-section">
        <div className="hv-head">
          <div>
            <h2>{query ? 'Matching tests' : 'Popular & all tests'}</h2>
            <p>{loading ? 'Loading…' : `${filtered.length} tests`}</p>
          </div>
        </div>
        {!loading && filtered.length === 0 ? (
          <p className="hv-muted">
            No tests match your search. <Link className="hv-link" to="/diagnostics">Browse all diagnostics</Link>
          </p>
        ) : (
          <div className="labs-grid">
            {filtered.map((item) => {
              const off = itemDiscountPercent(item);
              const blurb = stripHtml(item.description || '');
              return (
                <article key={item.name} className="hv-test">
                  {off > 0 ? <span className="hv-off">{off}% OFF</span> : null}
                  <h3 title={item.item_name}>
                    <Link to={`/diagnostics/test/${encodeURIComponent(item.name)}`}>{item.item_name}</Link>
                  </h3>
                  <p className="hv-muted">
                    {[item.sample_type, item.lab_category].filter(Boolean).join(' · ') ||
                      (blurb && blurb.toLowerCase() !== item.item_name.toLowerCase() ? blurb : 'Lab test profile')}
                  </p>
                  <PriceTag item={item} size="sm" />
                  <div className="hv-pkg-actions">
                    <Link className="hv-btn hv-btn-soft hv-btn-sm" to={`/diagnostics/test/${encodeURIComponent(item.name)}`}>
                      Details
                    </Link>
                    <Link className="hv-btn hv-btn-sm" to={bookHref(item.name)}>
                      Book
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
