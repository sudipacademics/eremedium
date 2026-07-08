import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, CatalogItem } from '../api';
import { PriceTag } from '../components/PriceTag';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { stripHtml } from '../utils/text';

function matchesQuery(item: CatalogItem, q: string) {
  const hay = `${item.item_name} ${item.name} ${item.description || ''}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function LabPage() {
  const [searchParams] = useSearchParams();
  const query = (searchParams.get('q') || '').trim();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLabCatalog();
      setItems(res.data.items || []);
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
    if (!query) return items;
    return items.filter((item) => matchesQuery(item, query));
  }, [items, query]);

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Diagnostics</h1>
          <p className="muted">
            {query
              ? `Showing results for “${query}”`
              : 'Prices refresh from ERPNext — discounts shown where applicable.'}
          </p>
        </div>
        <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading catalog…</p>}
      {!loading && filtered.length === 0 && (
        <p className="muted">
          No tests match your search. <Link to="/diagnostics">Browse all diagnostics</Link>
        </p>
      )}

      <div className="grid">
        {filtered.map((item) => (
          <article key={item.name} className="card">
            <h3>
              <Link to={`/diagnostics/test/${encodeURIComponent(item.name)}`}>{item.item_name}</Link>
            </h3>
            <p className="muted lab-card-meta">
              {[item.sample_type, item.lab_category].filter(Boolean).join(' · ')}
            </p>
            <p>{stripHtml(item.description)}</p>
            <PriceTag item={item} />
            <div className="lab-card-actions">
              <Link className="btn secondary btn-sm" to={`/diagnostics/test/${encodeURIComponent(item.name)}`}>
                View details
              </Link>
              <Link className="btn btn-sm" to={`/diagnostics/book/${encodeURIComponent(item.name)}`}>
                Book test
              </Link>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
