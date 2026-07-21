import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, AlliedHealthService, AlliedHealthWing } from '../../api';

export function WellnessWingPage() {
  const { wingId = '' } = useParams();
  const [wing, setWing] = useState<AlliedHealthWing | null>(null);
  const [services, setServices] = useState<AlliedHealthService[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void Promise.all([api.getAlliedHealthWings(), api.getAlliedHealthServices(wingId)])
      .then(([wingsRes, servicesRes]) => {
        const match = (wingsRes.data.wings || []).find((w) => w.id === wingId) || null;
        setWing(match);
        setServices(servicesRes.data.services || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load services'))
      .finally(() => setLoading(false));
  }, [wingId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) =>
        s.service_name.toLowerCase().includes(q) ||
        (s.short_description || '').toLowerCase().includes(q),
    );
  }, [search, services]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <>
      <Link to="/wellness" className="muted">
        ← All wellness wings
      </Link>

      {wing && (
        <section className="wellness-wing-hero" style={{ borderColor: wing.color }}>
          <img className="wellness-wing-hero-img" src={wing.image} alt="" />
          <div>
            <h1>
              <span aria-hidden>{wing.icon}</span> {wing.title}
            </h1>
            <p className="muted">{wing.subtitle}</p>
          </div>
        </section>
      )}

      <form className="home-search" onSubmit={onSearch} style={{ marginTop: 16 }}>
        <input
          type="search"
          placeholder={`Search ${wing?.title || 'services'}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search wellness services"
        />
        <button className="btn" type="submit">
          Search
        </button>
      </form>

      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading services…</p>}

      <div className="grid" style={{ marginTop: 20 }}>
        {filtered.map((service) => (
          <article key={service.service_code} className="card wellness-service-card">
            <div className="wellness-service-head">
              <h3>{service.service_name}</h3>
              {service.rate > 0 && <strong>₹{service.rate.toFixed(0)}</strong>}
            </div>
            <p className="muted wellness-service-meta">
              {[service.duration, service.mode].filter(Boolean).join(' · ')}
            </p>
            <p>{service.short_description || service.long_description}</p>
            <Link
              className="btn btn-sm"
              to={`/wellness/${wingId}/book/${encodeURIComponent(service.service_code)}`}
            >
              Book session
            </Link>
          </article>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <p className="muted">No services match your search.</p>
      )}
    </>
  );
}
