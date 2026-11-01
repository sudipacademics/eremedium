import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

type Article = {
  name: string;
  article_code: string;
  title: string;
  specialty: string;
  summary: string;
  source_name?: string;
  external_url?: string;
  pmid?: string;
};

type PubMedHit = {
  pmid?: string | null;
  title: string;
  source?: string;
  pubdate?: string;
  authors?: string;
  external_url?: string;
  curated?: boolean;
};

export function ProviderKnowledgePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [hits, setHits] = useState<PubMedHit[]>([]);
  const [query, setQuery] = useState('type 2 diabetes lifestyle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.listKnowledgeArticles();
    setArticles(res.data.articles || []);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load knowledge'));
  }, [load]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.searchPubMed(query.trim());
      setHits(res.data.results || []);
      if (res.data.fallback) {
        setNotice('PubMed unavailable — showing curated matches.');
      } else if (res.data.cached) {
        setNotice('Cached PubMed results.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Clinical knowledge</h1>
        <p className="muted">Curated outpatient notes plus PubMed titles/links — no full-text PDFs.</p>
        <div className="toolbar">
          <Link className="btn secondary" to="/dashboard/provider">
            Back to practice
          </Link>
          <Link className="btn secondary" to="/research">
            Research hub
          </Link>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>PubMed search</h2>
        <form onSubmit={onSearch} className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search PubMed"
            style={{ minWidth: 240, flex: 1 }}
          />
          <button className="btn" type="submit" disabled={busy || query.trim().length < 3}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
        {!hits.length ? <p className="muted">Run a search to list titles and PubMed links.</p> : null}
        <ul>
          {hits.map((h, i) => (
            <li key={`${h.pmid || h.title}-${i}`}>
              {h.external_url ? (
                <a href={h.external_url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>
              ) : (
                h.title
              )}
              <span className="muted">
                {' '}
                · {h.source || '—'}
                {h.pubdate ? ` · ${h.pubdate}` : ''}
                {h.curated ? ' · curated' : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Curated articles</h2>
        {!articles.length ? <p className="muted">No approved articles yet.</p> : null}
        <ul>
          {articles.map((a) => (
            <li key={a.name} style={{ marginBottom: 12 }}>
              <strong>{a.title}</strong>
              <div className="muted">
                {a.specialty} · {a.source_name || 'Curated'}
                {a.external_url ? (
                  <>
                    {' '}
                    ·{' '}
                    <a href={a.external_url} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  </>
                ) : null}
              </div>
              <p style={{ margin: '4px 0 0' }}>{a.summary}</p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
