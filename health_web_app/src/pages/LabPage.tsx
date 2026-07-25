import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, CatalogItem, LabPanel } from '../api';
import { PriceTag } from '../components/PriceTag';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { stripHtml } from '../utils/text';

const LAB_CATEGORIES: Array<{ label: string; query: string; large?: boolean }> = [
  { label: 'Full Body Packages', query: 'full body', large: true },
  { label: 'X-Rays, Scans & More', query: 'x-ray', large: true },
  { label: 'Fever Tests', query: 'fever' },
  { label: 'Diabetes Tests', query: 'diabetes' },
  { label: 'Vitamins Tests', query: 'vitamin' },
  { label: 'Thyroid', query: 'thyroid' },
  { label: 'Heart', query: 'lipid' },
  { label: "Women's health", query: 'women' },
];

function matchesQuery(item: CatalogItem, q: string) {
  const hay = `${item.item_name} ${item.name} ${item.description || ''}`.toLowerCase();
  return hay.includes(q.toLowerCase());
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

  useEffect(() => {
    setDraft(query);
  }, [query]);

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
    if (!query) return packages.slice(0, 12);
    const q = query.toLowerCase();
    return packages.filter(
      (p) =>
        p.panel_name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q),
    );
  }, [packages, query]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (hub) params.set('hub', hub);
    navigate(params.toString() ? `/diagnostics?${params}` : '/diagnostics');
  }

  return (
    <>
      <section className="page-intro">
        <h1>Book lab tests online</h1>
        <p className="section-sub">
          Trusted and certified labs — search tests, browse packages, or book home collection.
          {hub ? ' A nearby centre was pre-selected from Centres near me.' : ''}
        </p>
        <form className="labs-search-combo labs-search-combo--page" onSubmit={onSearch}>
          <Link className="location-chip" to="/centres">
            Near me
          </Link>
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search tests or full body checkups"
            aria-label="Search lab tests"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </section>

      {!query ? (
        <section className="home-section">
          <h2 className="section-title">Find tests &amp; packages for your needs</h2>
          <div className="category-tile-grid">
            {LAB_CATEGORIES.filter((c) => c.large).map((cat) => (
              <Link
                key={cat.label}
                className="category-tile category-tile--lg"
                to={`/diagnostics?q=${encodeURIComponent(cat.query)}${hub ? `&hub=${encodeURIComponent(hub)}` : ''}`}
              >
                <span className="category-tile-label">{cat.label}</span>
              </Link>
            ))}
          </div>
          <div className="category-tile-grid category-tile-grid--sm">
            {LAB_CATEGORIES.filter((c) => !c.large).map((cat) => (
              <Link
                key={cat.label}
                className="category-tile"
                to={`/diagnostics?q=${encodeURIComponent(cat.query)}${hub ? `&hub=${encodeURIComponent(hub)}` : ''}`}
              >
                <span className="category-tile-label">{cat.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="trust-strip" aria-label="Lab trust">
        <article className="trust-strip-item">
          <strong>NABL-aligned quality</strong>
          <span className="muted">Accurate reporting from partner labs</span>
        </article>
        <article className="trust-strip-item">
          <strong>Home sample collection</strong>
          <span className="muted">Phlebotomist at your doorstep</span>
        </article>
        <article className="trust-strip-item">
          <strong>Fast digital reports</strong>
          <span className="muted">Track status in My orders</span>
        </article>
        <article className="trust-strip-item">
          <strong>Centres near you</strong>
          <span className="muted">
            <Link to="/centres">Find a hub</Link>
          </span>
        </article>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="muted">Loading catalog…</p> : null}

      {filteredPackages.length > 0 ? (
        <section className="home-section">
          <h2 className="section-title">{query ? 'Matching packages' : 'Health packages'}</h2>
          <div className="package-scroll">
            {filteredPackages.map((pkg) => (
              <article key={pkg.panel_id} className="pkg-card">
                <h3>{pkg.panel_name}</h3>
                <p className="muted package-desc">{stripHtml(pkg.description)}</p>
                <PriceTag
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
                  size="sm"
                />
                <p className="pkg-card-meta">
                  <span className="muted">{pkg.tests.length} tests</span>
                </p>
                <Link className="btn btn-sm" to={`/diagnostics/panel/${encodeURIComponent(pkg.panel_id)}`}>
                  Book package
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">{query ? `Results for “${query}”` : 'Popular & all tests'}</h2>
          <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
        {!loading && filtered.length === 0 ? (
          <p className="muted">
            No tests match your search. <Link to="/diagnostics">Browse all diagnostics</Link>
          </p>
        ) : null}
        <div className="pkg-card-grid">
          {filtered.map((item) => (
            <article key={item.name} className="pkg-card">
              <h3>
                <Link to={`/diagnostics/test/${encodeURIComponent(item.name)}`}>{item.item_name}</Link>
              </h3>
              <p className="muted lab-card-meta">
                {[item.sample_type, item.lab_category].filter(Boolean).join(' · ')}
              </p>
              <p className="muted">{stripHtml(item.description)}</p>
              <PriceTag item={item} />
              <div className="lab-card-actions">
                <Link className="btn secondary btn-sm" to={`/diagnostics/test/${encodeURIComponent(item.name)}`}>
                  Details
                </Link>
                <Link className="btn btn-sm" to={`/diagnostics/book/${encodeURIComponent(item.name)}${hub ? `?hub=${encodeURIComponent(hub)}` : ''}`}>
                  Book test
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
