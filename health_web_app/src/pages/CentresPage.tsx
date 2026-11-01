import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, AiPhysicianCenter } from '../api';
import { CentresNearMeMap } from '../components/CentresNearMeMap';
import { getBrowserPosition } from '../utils/geo';
import './home-v2.css';
import './centres-v2.css';

const CITY_KEY = 'remedium_city';
const CITIES = ['Kolkata', 'Howrah', 'Siliguri', 'Durgapur', 'Asansol', 'Kharagpur'];
const DEFAULT_RADIUS = 40;

type Mode = 'all' | 'home' | 'lab' | 'doctor';

const MODES: Array<{ id: Mode; title: string; sub: string; icon: keyof typeof ICONS; tone: string }> = [
  { id: 'all', title: 'All Centres', sub: 'Find nearby hubs', icon: 'pin', tone: 'teal' },
  { id: 'home', title: 'Home Collection', sub: 'Book at your doorstep', icon: 'van', tone: 'blue' },
  { id: 'lab', title: 'Lab Test Centre', sub: 'Visit for sample collection', icon: 'flask', tone: 'green' },
  { id: 'doctor', title: 'Doctor Consultation', sub: 'Available at selected centres', icon: 'doctor', tone: 'violet' },
];

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS = {
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  van: (
    <>
      <path d="M2.5 16V7.5h11V16M13.5 10h4l3 3.5V16h-2" />
      <circle cx="7" cy="17" r="1.8" />
      <circle cx="17" cy="17" r="1.8" />
    </>
  ),
  flask: <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />,
  doctor: (
    <>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21c.6-4 3.4-6 7-6s6.4 2 7 6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  rupee: <path d="M7 5h10M7 9h10M7 5c4 0 6 1.5 6 4s-2 4-6 4l7 6" />,
  report: (
    <>
      <path d="M7 3.5h7l3 3v14H7z" />
      <path d="M14 3.5V7h3" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="10" r="2.3" />
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
    </>
  ),
};

function loadCity() {
  try {
    const saved = localStorage.getItem(CITY_KEY)?.trim();
    if (saved && CITIES.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return 'Kolkata';
}

function centreDirectionsUrl(centre: AiPhysicianCenter) {
  const direct = (centre.directions_url || centre.google_map_location_url || '').trim();
  if (direct) return direct;
  const lat = Number(centre.latitude);
  const lng = Number(centre.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  return '';
}

function centreChips(c: AiPhysicianCenter) {
  const chips = ['Lab Tests', 'Home Collection'];
  if (c.book_doctor_path) chips.push('Doctor Consultation');
  return chips;
}

function matchesMode(c: AiPhysicianCenter, mode: Mode) {
  if (mode === 'all' || mode === 'home' || mode === 'lab') return true;
  if (mode === 'doctor') return Boolean(c.book_doctor_path);
  return true;
}

export function CentresPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get('q') || '').trim();
  const [city, setCity] = useState(loadCity);
  const [draft, setDraft] = useState(query);
  const [mode, setMode] = useState<Mode>('all');
  const [sort, setSort] = useState<'nearest' | 'name'>('nearest');
  const [allCenters, setCenters] = useState<AiPhysicianCenter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS);
  const [filterByRadius, setFilterByRadius] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(query);
    if (CITIES.includes(query)) setCity(query);
  }, [query]);

  const loadCentres = useCallback(
    async (lat: number | null, lng: number | null, radius: number, nearbyOnly: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.listPublicCentres({
          latitude: lat,
          longitude: lng,
          radius_km: nearbyOnly && lat != null && lng != null ? radius : null,
        });
        const list = res.data.centers || res.data.centres || [];
        setCenters(list);
        setSelectedId((current) => current || list[0]?.franchisee_id || null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load franchise centres');
        setCenters([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const locate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const coords = await getBrowserPosition();
      setUserLat(coords.latitude);
      setUserLng(coords.longitude);
      setFilterByRadius(true);
      await loadCentres(coords.latitude, coords.longitude, radiusKm, true);
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : 'Location unavailable');
    }
  }, [loadCentres, radiusKm]);

  useEffect(() => {
    void loadCentres(null, null, radiusKm, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!filterByRadius || userLat == null || userLng == null) return;
    void loadCentres(userLat, userLng, radiusKm, true);
  }, [radiusKm]); // eslint-disable-line react-hooks/exhaustive-deps

  const centers = useMemo(() => {
    const q = query.toLowerCase();
    let list = allCenters.filter((c) => matchesMode(c, mode));
    if (q) {
      list = list.filter((c) =>
        [c.franchise_name, c.address, c.territory_region, c.branch_code]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => {
      if (sort === 'name') return (a.franchise_name || '').localeCompare(b.franchise_name || '');
      const da = a.distance_km ?? Number.POSITIVE_INFINITY;
      const db = b.distance_km ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return (a.franchise_name || '').localeCompare(b.franchise_name || '');
    });
  }, [allCenters, mode, query, sort]);

  const selected = centers.find((c) => c.franchisee_id === selectedId) || centers[0] || null;

  function applySearch(nextQ: string, nextCity = city) {
    const params = new URLSearchParams();
    const q = nextQ.trim();
    if (q) params.set('q', q);
    setSearchParams(params, { replace: true });
    try {
      localStorage.setItem(CITY_KEY, nextCity);
    } catch {
      /* ignore */
    }
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    applySearch(draft || city, city);
  }

  function onCity(next: string) {
    setCity(next);
    try {
      localStorage.setItem(CITY_KEY, next);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="home-v2 cen-v2">
      <section className="hv-card cen-hero">
        <div className="cen-hero-copy">
          <p className="cen-kicker">Our centres</p>
          <h1>Centres Near You</h1>
          <p className="hv-muted">
            Find active Remedium collection hubs from successfully onboarded franchise centres. Book lab
            tests, home collection or visit the centre.
          </p>
          <form className="cen-search" onSubmit={onSearch}>
            <select value={city} onChange={(e) => onCity(e.target.value)} aria-label="City">
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search by area, pincode or centre name"
              aria-label="Search centres"
            />
            <button className="hv-btn hv-btn-sm" type="submit">
              Search
            </button>
          </form>
          <div className="cen-filters">
            <label>
              Radius
              <select
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                aria-label="Search radius in kilometres"
              >
                <option value={10}>10 km</option>
                <option value={15}>15 km</option>
                <option value={25}>25 km</option>
                <option value={40}>40 km</option>
                <option value={80}>80 km</option>
              </select>
            </label>
            <button className="hv-btn hv-btn-ghost hv-btn-sm" type="button" onClick={() => void locate()}>
              Use my location
            </button>
            {filterByRadius ? (
              <button
                className="hv-link"
                type="button"
                onClick={() => {
                  setFilterByRadius(false);
                  void loadCentres(userLat, userLng, radiusKm, false);
                }}
              >
                Show all centres
              </button>
            ) : null}
          </div>
        </div>
        <div className="cen-hero-visual" aria-hidden>
          <img src="/home/centre-reception.jpg" alt="" />
          <ul className="cen-hero-points">
            <li>
              <span className="cen-point-icon tone-teal">
                <Icon size={14}>{ICONS.shield}</Icon>
              </span>
              <div>
                <strong>NABL Accredited</strong>
                <span>Trusted quality</span>
              </div>
            </li>
            <li>
              <span className="cen-point-icon tone-amber">
                <Icon size={14}>{ICONS.rupee}</Icon>
              </span>
              <div>
                <strong>Fair Price</strong>
                <span>Affordable for all</span>
              </div>
            </li>
            <li>
              <span className="cen-point-icon tone-blue">
                <Icon size={14}>{ICONS.van}</Icon>
              </span>
              <div>
                <strong>Home Collection</strong>
                <span>Book from your location</span>
              </div>
            </li>
            <li>
              <span className="cen-point-icon tone-sky">
                <Icon size={14}>{ICONS.report}</Icon>
              </span>
              <div>
                <strong>Digital Reports</strong>
                <span>Access anytime</span>
              </div>
            </li>
            <li>
              <span className="cen-point-icon tone-indigo">
                <Icon size={14}>{ICONS.network}</Icon>
              </span>
              <div>
                <strong>Wide Network</strong>
                <span>Franchise hubs across West Bengal</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <div className="cen-modes">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`hv-card cen-mode${mode === item.id ? ' is-active' : ''}`}
            onClick={() => setMode(item.id)}
          >
            <span className={`cen-mode-icon tone-${item.tone}`}>
              <Icon size={16}>{ICONS[item.icon]}</Icon>
            </span>
            <div>
              <strong>{item.title}</strong>
              <span className="hv-muted">{item.sub}</span>
            </div>
          </button>
        ))}
      </div>

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="hv-muted">Loading franchise centres…</p> : null}

      <div className="cen-split">
        <div>
          <div className="cen-list-head">
            <h2>Nearby Centres ({centers.length})</h2>
            <select value={sort} onChange={(e) => setSort(e.target.value as 'nearest' | 'name')} aria-label="Sort centres">
              <option value="nearest">Sort by nearest</option>
              <option value="name">Sort by name</option>
            </select>
          </div>
          {!loading && allCenters.length === 0 ? (
            <div className="hv-card cen-empty">
              <p className="hv-muted">
                No onboarded franchise centres are available yet. You can still book home collection from{' '}
                <Link className="hv-link" to="/diagnostics">
                  Lab Tests
                </Link>
                .
              </p>
            </div>
          ) : null}
          {!loading && allCenters.length > 0 && centers.length === 0 ? (
            <div className="hv-card cen-empty">
              <p className="hv-muted">No centres match this search.</p>
              <button type="button" className="hv-btn hv-btn-sm" onClick={() => applySearch('')}>
                Show all
              </button>
            </div>
          ) : null}
          <div className="cen-list" role="list">
            {centers.map((c) => {
              const chips = centreChips(c);
              return (
                <article
                  key={c.franchisee_id}
                  role="listitem"
                  className={`hv-card cen-card${selectedId === c.franchisee_id ? ' is-selected' : ''}`}
                  onClick={() => setSelectedId(c.franchisee_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedId(c.franchisee_id);
                  }}
                  tabIndex={0}
                >
                  <img className="cen-card-photo" src="/home/centre-reception.jpg" alt="" />
                  <div className="cen-card-body">
                    <div className="cen-card-title">
                      <strong>{c.franchise_name}</strong>
                      <span className="cen-active">Active</span>
                    </div>
                    <p className="cen-meta">
                      {c.address || c.territory_region || 'Address on request'}
                      {c.distance_km != null ? ` · ${c.distance_km} km` : ''}
                    </p>
                    <div className="cen-chips">
                      {chips.map((chip) => (
                        <span key={chip} className="cen-chip">
                          {chip}
                        </span>
                      ))}
                    </div>
                    <div className="cen-card-actions">
                      {centreDirectionsUrl(c) ? (
                        <a
                          className="hv-btn hv-btn-soft hv-btn-sm"
                          href={centreDirectionsUrl(c)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View Details
                        </a>
                      ) : (
                        <span className="hv-btn hv-btn-soft hv-btn-sm" aria-disabled>
                          View Details
                        </span>
                      )}
                      <Link
                        className="hv-btn hv-btn-sm"
                        to={c.book_lab_path || `/diagnostics?hub=${encodeURIComponent(c.franchisee_id)}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Book a Test
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="hv-card cen-map-wrap">
          <CentresNearMeMap
            centers={centers}
            userLat={userLat}
            userLng={userLng}
            selectedId={selected?.franchisee_id || selectedId}
            onSelect={setSelectedId}
            height={560}
          />
          {selected ? (
            <aside className="hv-card cen-map-card">
              <div className="cen-card-title">
                <strong>{selected.franchise_name}</strong>
                <span className="cen-active">Active</span>
              </div>
              <p className="cen-meta">
                {selected.address || selected.territory_region || ''}
                {selected.distance_km != null ? ` · ${selected.distance_km} km` : ''}
              </p>
              <div className="cen-chips">
                {centreChips(selected).map((chip) => (
                  <span key={chip} className="cen-chip">
                    {chip}
                  </span>
                ))}
              </div>
              <div className="cen-card-actions">
                {centreDirectionsUrl(selected) ? (
                  <a className="hv-btn hv-btn-soft hv-btn-sm" href={centreDirectionsUrl(selected)} target="_blank" rel="noreferrer">
                    View Details
                  </a>
                ) : null}
                <Link
                  className="hv-btn hv-btn-sm"
                  to={selected.book_lab_path || `/diagnostics?hub=${encodeURIComponent(selected.franchisee_id)}`}
                >
                  Book a Test
                </Link>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
