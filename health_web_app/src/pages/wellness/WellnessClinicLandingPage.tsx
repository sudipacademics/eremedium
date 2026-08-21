import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api, AlliedHealthService, AlliedHealthWing, WhatsappCta } from '../../api';
import { WellnessVideoSection } from './WellnessVideoSection';
import {
  getWellnessClinicConfig,
  serviceMatchesTab,
  type WellnessClinicConfig,
} from './wellnessClinicConfig';

function benefitLine(service: AlliedHealthService): string {
  const raw = (service.short_description || '').trim();
  if (raw && raw.length < 120) return raw;
  const bits = [service.duration, service.mode].filter(Boolean);
  if (bits.length) return bits.join(' · ');
  return 'Personalised session with transparent pricing.';
}

type Props = { wingId?: string };

export function WellnessClinicLandingPage({ wingId: wingIdProp }: Props) {
  const params = useParams();
  const wingId = (wingIdProp || params.wingId || '').toLowerCase();
  const config = getWellnessClinicConfig(wingId);

  const [wing, setWing] = useState<AlliedHealthWing | null>(null);
  const [services, setServices] = useState<AlliedHealthService[]>([]);
  const [practitioners, setPractitioners] = useState<
    Array<{ name: string; practitioner_name?: string; department?: string }>
  >([]);
  const [whatsapp, setWhatsapp] = useState<WhatsappCta | null>(null);
  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [concernQuery, setConcernQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!config) return;
    setTab(config.tabs[0]?.id || '');
  }, [config]);

  useEffect(() => {
    if (!config) return;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.getAlliedHealthWings(),
      api.getAlliedHealthServices(config.wingId),
      api.getPractitioners(config.departmentName).catch(() => ({ data: { practitioners: [] } })),
      api
        .getHomeContent()
        .catch(() => ({ data: { whatsapp_cta: undefined } as { whatsapp_cta?: WhatsappCta } })),
    ])
      .then(([wingsRes, servicesRes, pracRes, homeRes]) => {
        setWing((wingsRes.data.wings || []).find((w) => w.id === config.wingId) || null);
        setServices(servicesRes.data.services || []);
        setPractitioners(pracRes.data.practitioners || []);
        setWhatsapp((homeRes.data as { whatsapp_cta?: WhatsappCta }).whatsapp_cta || null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load clinic'))
      .finally(() => setLoading(false));
  }, [config]);

  const consultService = useMemo(() => {
    return (
      services.find((s) => /consult|assessment|initial/i.test(s.service_name)) ||
      services.slice().sort((a, b) => (a.rate || 0) - (b.rate || 0))[0] ||
      null
    );
  }, [services]);

  const rates = useMemo(() => services.map((s) => s.rate).filter((r) => r > 0), [services]);
  const startingRate = rates.length ? Math.min(...rates) : wing?.starting_rate || 0;

  const filtered = useMemo(() => {
    if (!config) return [];
    const q = (concernQuery || search).trim().toLowerCase();
    return services.filter((s) => {
      if (tab && !serviceMatchesTab(s, tab, config.tabs)) return false;
      if (!q) return true;
      const blob = `${s.service_name} ${s.short_description || ''} ${s.item_group || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [services, tab, search, concernQuery, config]);

  if (!config) {
    return <Navigate to="/wellness" replace />;
  }

  const clinic = config;

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setConcernQuery('');
  }

  function bookPath(serviceCode: string) {
    return `/wellness/${clinic.wingId}/book/${encodeURIComponent(serviceCode)}`;
  }

  return (
    <ClinicLandingView
      config={clinic}
      wing={wing}
      services={services}
      practitioners={practitioners}
      whatsapp={whatsapp}
      tab={tab}
      setTab={setTab}
      search={search}
      setSearch={setSearch}
      setConcernQuery={setConcernQuery}
      filtered={filtered}
      consultService={consultService}
      startingRate={startingRate}
      loading={loading}
      error={error}
      onSearch={onSearch}
      bookPath={bookPath}
    />
  );
}

function ClinicLandingView({
  config,
  wing,
  practitioners,
  whatsapp,
  tab,
  setTab,
  search,
  setSearch,
  setConcernQuery,
  filtered,
  consultService,
  startingRate,
  loading,
  error,
  onSearch,
  bookPath,
}: {
  config: WellnessClinicConfig;
  wing: AlliedHealthWing | null;
  services: AlliedHealthService[];
  practitioners: Array<{ name: string; practitioner_name?: string; department?: string }>;
  whatsapp: WhatsappCta | null;
  tab: string;
  setTab: (t: string) => void;
  search: string;
  setSearch: (s: string) => void;
  setConcernQuery: (q: string) => void;
  filtered: AlliedHealthService[];
  consultService: AlliedHealthService | null;
  startingRate: number;
  loading: boolean;
  error: string | null;
  onSearch: (e: FormEvent) => void;
  bookPath: (code: string) => string;
}) {
  const indic = config.theme === 'indic';
  const serviceCount = wing?.service_count ?? filtered.length;

  return (
    <div className={`aesthetics-page wellness-clinic-page${indic ? ' is-indic' : ''}`}>
      <Link to="/wellness" className="aesthetics-back muted">
        ← All wellness wings
      </Link>

      <section className="aesthetics-hero">
        <img
          className="aesthetics-hero-img"
          src={config.heroImage}
          alt=""
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = config.heroFallback;
          }}
        />
        <div className="aesthetics-hero-shade" />
        <div className="aesthetics-hero-copy">
          <p className="brand-kicker">{config.kicker}</p>
          <h1>{config.headline}</h1>
          <p className="hero-lead">{config.lead}</p>
          <div className="aesthetics-hero-actions">
            {consultService ? (
              <Link className="btn aesthetics-cta-primary" to={bookPath(consultService.service_code)}>
                Book a session
              </Link>
            ) : (
              <a className="btn aesthetics-cta-primary" href="#treatments">
                Book a session
              </a>
            )}
            <a className="btn secondary aesthetics-cta-ghost" href="#treatments">
              View sessions
            </a>
            {config.wingId === 'physiotherapy' || config.wingId === 'aesthetics' ? (
              <Link
                className="btn secondary aesthetics-cta-ghost"
                to={`/wellness/sessions?wing=${config.wingId}`}
              >
                Session cards
              </Link>
            ) : null}
            {config.wingId === 'yoga' ? (
              <Link className="btn secondary aesthetics-cta-ghost" to="/yoga-memberships">
                Memberships
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="aesthetics-trust">
        <h2>Why choose this wing</h2>
        <div className="aesthetics-trust-grid">
          {config.trust.map((item) => (
            <article key={item.title} className="aesthetics-trust-card">
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="aesthetics-stats" aria-label="Clinic highlights">
        <div>
          <strong>{serviceCount || '—'}</strong>
          <span>Sessions</span>
        </div>
        <div>
          <strong>{startingRate ? `₹${startingRate.toFixed(0)}` : '—'}</strong>
          <span>Starting from</span>
        </div>
        <div>
          <strong>{config.tabs.map((t) => t.label).slice(0, 3).join(' · ')}</strong>
          <span>Focus areas</span>
        </div>
        <div>
          <strong>Session-based</strong>
          <span>Book as you go</span>
        </div>
      </section>

      <section id="treatments" className="aesthetics-treatments">
        <div className="section-head">
          <div>
            <h2 className="section-title">Our sessions</h2>
            <p className="section-sub">Choose a focus area, then book the session that fits.</p>
          </div>
        </div>

        <div className="aesthetics-tabs" role="tablist" aria-label="Session categories">
          {config.tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'is-active' : ''}
              onClick={() => {
                setTab(t.id);
                setConcernQuery('');
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form className="labs-search-combo aesthetics-search" onSubmit={onSearch}>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setConcernQuery('');
            }}
            placeholder={`Search ${wing?.title || 'sessions'}…`}
            aria-label="Search sessions"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>

        {error ? <div className="error">{error}</div> : null}
        {loading ? <p className="muted">Loading sessions…</p> : null}

        <div className="aesthetics-treatment-grid">
          {filtered.map((service) => (
            <article key={service.service_code} className="aesthetics-treatment-card">
              <div className="aesthetics-treatment-head">
                <h3>{service.service_name}</h3>
                {service.rate > 0 ? <strong>₹{service.rate.toFixed(0)}</strong> : null}
              </div>
              <p className="muted">{benefitLine(service)}</p>
              <Link className="btn btn-sm" to={bookPath(service.service_code)}>
                Book session
              </Link>
            </article>
          ))}
        </div>
        {!loading && !filtered.length ? (
          <p className="muted">No sessions in this category yet. Try another tab or clear search.</p>
        ) : null}
      </section>

      <section className="aesthetics-specialists">
        <div className="section-head">
          <div>
            <h2 className="section-title">Practitioners</h2>
            <p className="section-sub">Available when you book a session.</p>
          </div>
        </div>
        {practitioners.length ? (
          <div className="aesthetics-specialist-grid">
            {practitioners.slice(0, 6).map((p) => (
              <article key={p.name} className="aesthetics-specialist-card">
                <div className="aesthetics-specialist-avatar" aria-hidden>
                  {(p.practitioner_name || p.name || 'P').slice(0, 1).toUpperCase()}
                </div>
                <strong>{p.practitioner_name || p.name}</strong>
                <span className="muted">{p.department || config.departmentName}</span>
                {consultService ? (
                  <Link className="btn btn-sm secondary" to={bookPath(consultService.service_code)}>
                    Book session
                  </Link>
                ) : (
                  <a className="btn btn-sm secondary" href="#treatments">
                    View sessions
                  </a>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted aesthetics-empty-specialists">
            Practitioners are shown at booking — pick a session to see available slots.
          </p>
        )}
      </section>

      <section className="aesthetics-concerns">
        <div className="section-head">
          <div>
            <h2 className="section-title">Common goals</h2>
            <p className="section-sub">Tap a goal to jump to matching sessions.</p>
          </div>
        </div>
        <div className="aesthetics-concern-grid">
          {config.concerns.map((c) => (
            <button
              key={`${c.tab}-${c.label}`}
              type="button"
              className="aesthetics-concern-card"
              onClick={() => {
                setTab(c.tab);
                setConcernQuery(c.query);
                setSearch('');
                document.getElementById('treatments')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <img src={c.image} alt="" loading="lazy" />
              <span>
                <strong>{c.label}</strong>
                <em>{c.tab}</em>
              </span>
            </button>
          ))}
        </div>
        <p className="muted aesthetics-disclaimer">
          Outcomes vary by health history and protocol. Your first session confirms suitability.
        </p>
      </section>

      <WellnessVideoSection wingId={config.wingId} wingTitle={wing?.title || config.headline} />

      <section className="aesthetics-quotes">
        <h2 className="section-title">Client confidence</h2>
        <div className="aesthetics-quote-grid">
          {config.quotes.map((q) => (
            <blockquote key={q.name} className="aesthetics-quote-card">
              <p>“{q.quote}”</p>
              <footer>
                <strong>{q.name}</strong>
                <span className="muted">{q.focus}</span>
              </footer>
            </blockquote>
          ))}
        </div>
        {consultService ? (
          <Link className="btn aesthetics-quotes-cta" to={bookPath(consultService.service_code)}>
            Book your session
          </Link>
        ) : (
          <a className="btn aesthetics-quotes-cta" href="#treatments">
            Explore sessions
          </a>
        )}
      </section>

      <div className="aesthetics-sticky-cta">
        <div>
          <strong>{config.stickyTitle}</strong>
          <span className="muted">{config.stickySub}</span>
        </div>
        <div className="aesthetics-sticky-actions">
          {consultService ? (
            <Link className="btn" to={bookPath(consultService.service_code)}>
              Book session
            </Link>
          ) : (
            <a className="btn" href="#treatments">
              View sessions
            </a>
          )}
          {whatsapp?.enabled && whatsapp.url ? (
            <a className="btn secondary" href={whatsapp.url} target="_blank" rel="noreferrer">
              {whatsapp.label || 'WhatsApp'}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** @deprecated use WellnessClinicLandingPage — kept for existing imports */
export function AestheticsLandingPage() {
  return <WellnessClinicLandingPage wingId="aesthetics" />;
}
