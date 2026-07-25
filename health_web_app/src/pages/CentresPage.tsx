import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AiPhysicianCenter } from '../api';
import { CentresNearMeMap } from '../components/CentresNearMeMap';
import { getBrowserPosition } from '../utils/geo';

const DEFAULT_RADIUS = 40;

export function CentresPage() {
  const [centers, setCenters] = useState<AiPhysicianCenter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNearby = useCallback(async (lat: number, lng: number, radius: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.findNearbyCollectionCenters({
        latitude: lat,
        longitude: lng,
        radius_km: radius,
        limit: 20,
      });
      const list = res.data.centers || [];
      setCenters(list);
      setSelectedId(list[0]?.franchisee_id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not find centres near you');
      setCenters([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const locate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const coords = await getBrowserPosition();
      setUserLat(coords.latitude);
      setUserLng(coords.longitude);
      await loadNearby(coords.latitude, coords.longitude, radiusKm);
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : 'Location unavailable');
    }
  }, [loadNearby, radiusKm]);

  useEffect(() => {
    void locate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- locate once on mount

  useEffect(() => {
    if (userLat == null || userLng == null) return;
    void loadNearby(userLat, userLng, radiusKm);
  }, [radiusKm]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <section className="page-intro">
        <h1>Centres near me</h1>
        <p className="section-sub">
          Find active Remedium collection hubs near your location for home sample booking or
          centre visits.
        </p>
        <div className="centres-toolbar">
          <label className="centres-radius">
            Radius
            <select
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              aria-label="Search radius in kilometres"
            >
              <option value={15}>15 km</option>
              <option value={25}>25 km</option>
              <option value={40}>40 km</option>
              <option value={80}>80 km</option>
            </select>
          </label>
          <button className="btn secondary btn-sm" type="button" onClick={() => void locate()}>
            Use my location
          </button>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {loading ? <p className="muted">Finding centres near you…</p> : null}

      {!loading && !error && centers.length === 0 && userLat != null ? (
        <p className="muted">
          No hubs with map coordinates in this radius. Try widening the radius, or book lab tests
          for home collection from <Link to="/diagnostics">Lab Tests</Link>.
        </p>
      ) : null}

      <div className="centres-layout">
        <div className="centres-list" role="list">
          {centers.map((c) => (
            <article
              key={c.franchisee_id}
              role="listitem"
              className={`centre-card${selectedId === c.franchisee_id ? ' is-selected' : ''}`}
              onClick={() => setSelectedId(c.franchisee_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelectedId(c.franchisee_id);
              }}
              tabIndex={0}
            >
              <div className="centre-card-head">
                <strong>{c.franchise_name}</strong>
                {c.distance_km != null ? (
                  <span className="distance-chip">{c.distance_km} km</span>
                ) : null}
              </div>
              {c.address || c.territory_region ? (
                <p className="muted">{c.address || c.territory_region}</p>
              ) : null}
              {c.contact_phone ? (
                <a className="centre-phone" href={`tel:${c.contact_phone}`} onClick={(e) => e.stopPropagation()}>
                  {c.contact_phone}
                </a>
              ) : null}
              <div className="centre-card-actions">
                <Link
                  className="btn btn-sm"
                  to={c.book_lab_path || `/diagnostics?hub=${encodeURIComponent(c.franchisee_id)}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  Book lab
                </Link>
                <Link
                  className="btn secondary btn-sm"
                  to={c.book_doctor_path || '/appointments/book'}
                  onClick={(e) => e.stopPropagation()}
                >
                  Book doctor
                </Link>
              </div>
            </article>
          ))}
        </div>
        <CentresNearMeMap
          centers={centers}
          userLat={userLat}
          userLng={userLng}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </>
  );
}
