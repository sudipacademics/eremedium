import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesPortalPayload } from '../../api';
import { useSalesGps } from '../../hooks/useSalesGps';

export function SalesPortalPage() {
  const [data, setData] = useState<SalesPortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onDuty, setOnDuty] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  useSalesGps(onDuty, setGpsStatus);

  useEffect(() => {
    void api
      .getSalesPortal()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load portal'));
  }, []);

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data) {
    return <p>Loading field sales portal…</p>;
  }

  if (!data.available) {
    return <div className="error">Sales access not available for this account.</div>;
  }

  const rep = data.rep;
  const stats = data.stats;

  return (
    <>
      <h1>Field sales portal</h1>
      <p className="muted">
        {rep?.designation} · {rep?.territory_region || 'Territory'} · Code {rep?.rep_code}
      </p>

      <label className="toggle-row" style={{ margin: '12px 0' }}>
        <input type="checkbox" checked={onDuty} onChange={(e) => setOnDuty(e.target.checked)} />
        <span>GPS tracking on duty</span>
      </label>
      {gpsStatus ? <p className="muted">{gpsStatus}</p> : null}

      <div className="grid grid-stats">
        <article className="card stat-card">
          <span className="stat-label">Visits today</span>
          <strong>{stats?.visits_today ?? 0}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Open leads</span>
          <strong>{stats?.open_leads ?? 0}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">My franchisees</span>
          <strong>{stats?.franchisees_count ?? 0}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Month revenue (franchisees)</span>
          <strong>₹{(stats?.month_revenue ?? 0).toFixed(0)}</strong>
        </article>
      </div>

      {data.is_manager && rep?.team && rep.team.length > 0 ? (
        <section className="card" style={{ marginTop: 20 }}>
          <h2>My team</h2>
          <ul className="plain-list">
            {rep.team.map((m) => (
              <li key={m.name}>
                <strong>{m.full_name}</strong> · {m.rep_code} · {m.designation}
              </li>
            ))}
          </ul>
        </section>
      ) : rep?.manager ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Reports to: {rep.manager.full_name} ({rep.manager.rep_code})
        </p>
      ) : null}

      <div className="toolbar" style={{ marginTop: 24 }}>
        <Link className="btn" to="/sales/profile">
          My profile
        </Link>
        <Link className="btn secondary" to="/sales/leads">
          New lead
        </Link>
        <Link className="btn secondary" to="/sales/visit">
          Log visit
        </Link>
        <Link className="btn secondary" to="/sales/onboard">
          Onboard franchisee
        </Link>
        <Link className="btn secondary" to="/sales/catalog">
          Pitch deck
        </Link>
        <Link className="btn secondary" to="/sales/map">
          Team map
        </Link>
      </div>
    </>
  );
}
