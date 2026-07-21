import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, B2bPortalPayload } from '../../api';

export function B2bPortalPage() {
  const [data, setData] = useState<B2bPortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getB2bPortal()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load B2B portal'));
  }, []);

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data) {
    return <p>Loading B2B portal…</p>;
  }

  const stats = data.stats;

  return (
    <>
      <h1>Franchise B2B portal</h1>
      <p className="muted">
        Bill walk-in patients at <strong>MRP</strong>. Platform charges you the{' '}
        <strong>wholesale</strong> rate — your margin is the difference.
      </p>

      <div className="grid grid-stats">
        <article className="card stat-card">
          <span className="stat-label">Orders today</span>
          <strong>{stats?.orders_today ?? 0}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Retail collected today</span>
          <strong>₹{(stats?.retail_collected_today ?? 0).toFixed(0)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Your margin today</span>
          <strong>₹{(stats?.margin_today ?? 0).toFixed(0)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Pending platform charges</span>
          <strong>₹{(stats?.pending_platform_charges ?? 0).toFixed(0)}</strong>
        </article>
      </div>

      <div className="toolbar" style={{ marginTop: 24 }}>
        <Link className="btn" to="/b2b/order">
          New walk-in order
        </Link>
        <Link className="btn secondary" to="/b2b/catalog">
          View dual-price catalog
        </Link>
        <Link className="btn secondary" to="/b2b/statements">
          Statements
        </Link>
      </div>
    </>
  );
}
