import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';

type HealthCategory = { label: string; query: string; icon?: string };

export function ServicesPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [categories, setCategories] = useState<HealthCategory[]>([]);
  const [searchPlaceholder, setSearchPlaceholder] = useState(
    'Search tests & packages (e.g. CBC, thyroid, diabetes)',
  );
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getHomeContent();
      setCategories((res.data.health_categories as HealthCategory[]) || []);
      const headers = res.data.headers || {};
      if (headers.search_placeholder) {
        setSearchPlaceholder(headers.search_placeholder);
      }
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/diagnostics?q=${encodeURIComponent(q)}` : '/diagnostics');
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Services</h1>
        <p>Book diagnostics, doctor visits, and medicines — all synced from ERPNext.</p>
        <form className="home-search" onSubmit={onSearch}>
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search diagnostics and services"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </section>

      {!loading && categories.length > 0 && (
        <section className="home-section">
          <h2>Browse by health category</h2>
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

      <div className="grid grid-actions">
        <Link className="card card-action" to="/appointments/book">
          <h3>Doctor booking</h3>
          <p className="muted">Choose practitioner, date, and schedule slot.</p>
        </Link>
        <Link className="card card-action" to="/diagnostics">
          <h3>Diagnostics</h3>
          <p className="muted">Lab tests and health packages with home collection.</p>
        </Link>
        <Link className="card card-action" to="/pharmacy">
          <h3>Pharmacy</h3>
          <p className="muted">Chronic medicine packs and prescription quote requests.</p>
        </Link>
        <Link className="card card-action" to="/wellness">
          <h3>Wellness</h3>
          <p className="muted">Psychology, physio, ayurveda, aesthetics and more.</p>
        </Link>
        <Link className="card card-action" to="/insurance">
          <h3>Insurance</h3>
          <p className="muted">Mediclaim quote requests with GIC / LIC style plans.</p>
        </Link>
        {!isAuthenticated && (
          <Link className="card card-action" to="/login">
            <h3>Sign in</h3>
            <p className="muted">Required to book and track your care relationship.</p>
          </Link>
        )}
      </div>
    </>
  );
}

