import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';

type HealthCategory = { label: string; query: string; icon?: string };

export function ServicesPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [categories, setCategories] = useState<HealthCategory[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getHomeContent();
      setCategories((res.data.health_categories as HealthCategory[]) || []);
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
      <section className="page-intro">
        <h1>Doctors &amp; care services</h1>
        <p className="section-sub">
          Book a physician consult, or jump to labs, wellness, and centres near you.
        </p>
        <form className="labs-search-combo labs-search-combo--page" onSubmit={onSearch}>
          <input
            type="search"
            placeholder="Search lab tests to pair with a consult"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search diagnostics"
          />
          <button className="btn" type="submit">
            Search labs
          </button>
        </form>
      </section>

      <div className="doctors-cta-grid">
        <Link className="quick-tile quick-tile-doctors" to="/appointments/book">
          <strong>Book a doctor</strong>
          <span>Specialty → practitioner → slot</span>
        </Link>
        <Link className="quick-tile quick-tile-labs" to="/diagnostics">
          <strong>Lab tests</strong>
          <span>Packages &amp; home collection</span>
        </Link>
        <Link className="quick-tile quick-tile-centres" to="/centres">
          <strong>Centres near me</strong>
          <span>Find a collection hub</span>
        </Link>
        <Link className="quick-tile quick-tile-wellness" to="/wellness">
          <strong>Wellness</strong>
          <span>Physio, aesthetics &amp; more</span>
        </Link>
        {!isAuthenticated ? (
          <Link className="quick-tile" to="/login">
            <strong>Sign in</strong>
            <span>Required to book appointments</span>
          </Link>
        ) : null}
      </div>

      {!loading && categories.length > 0 ? (
        <section className="home-section">
          <h2 className="section-title">Browse lab categories</h2>
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
      ) : null}
    </>
  );
}
