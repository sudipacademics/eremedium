import { useEffect, useState } from 'react';
import { api, SalesTeamMapData } from '../../api';
import { SalesTeamMap } from '../../components/SalesTeamMap';
import { useSalesGps } from '../../hooks/useSalesGps';

export function SalesTeamMapPage() {
  const [data, setData] = useState<SalesTeamMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onDuty, setOnDuty] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  useSalesGps(onDuty, setGpsStatus);

  async function load() {
    try {
      const res = await api.getSalesTeamMap();
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load map');
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 90_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <h1>Team map & GPS</h1>
      <p className="muted">
        Live rep locations, HQ geofence (5 km), and open leads. Managers see their full team hierarchy.
      </p>

      <label className="toggle-row" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={onDuty} onChange={(e) => setOnDuty(e.target.checked)} />
        <span>Share my location with team</span>
      </label>
      {gpsStatus ? <p className="muted">{gpsStatus}</p> : null}

      {error ? <div className="error">{error}</div> : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SalesTeamMap data={data} height={480} />
      </div>

      {data ? (
        <ul className="plain-list" style={{ marginTop: 16 }}>
          {data.reps.map((r) => (
            <li key={r.rep_id}>
              <strong>{r.full_name}</strong> ({r.rep_code}) —{' '}
              {r.on_duty ? 'on duty' : 'off duty'}
              {r.updated ? ` · updated ${r.updated.slice(0, 19)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
