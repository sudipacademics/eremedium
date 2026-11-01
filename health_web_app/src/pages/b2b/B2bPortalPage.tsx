import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, B2bPortalPayload } from '../../api';
import { PartnersPageHeader } from '../../components/B2bLayout';

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
    return <div className="partners-alert error">{error}</div>;
  }

  if (!data) {
    return <p className="partners-page-lead">Loading partners portal…</p>;
  }

  const stats = data.stats;
  const ftype = data.franchisee?.franchisee_type || 'Pulse';

  return (
    <>
      <PartnersPageHeader
        title="Franchise B2B portal"
        lead={
          ftype === 'Vector' ? (
            <>
              Bill walk-in patients at unsashed <strong>MRP</strong>. Platform fee is Vector{' '}
              <strong>wholesale</strong>. Commission % is on wholesale. Billing stops past wallet + credit limit.
            </>
          ) : (
            <>
              Bill walk-in patients at <strong>FOCO</strong>. Platform fee is FOCO minus commission, prepaid from wallet.
            </>
          )
        }
      />

      <div className="partners-stats">
        <article className="partners-stat">
          <span>Orders today</span>
          <strong>{stats?.orders_today ?? 0}</strong>
        </article>
        <article className="partners-stat">
          <span>Retail collected today</span>
          <strong>₹{(stats?.retail_collected_today ?? 0).toFixed(0)}</strong>
        </article>
        <article className="partners-stat">
          <span>Your margin today</span>
          <strong>₹{(stats?.margin_today ?? 0).toFixed(0)}</strong>
        </article>
        <article className="partners-stat">
          <span>Pending platform charges</span>
          <strong>₹{(stats?.pending_platform_charges ?? 0).toFixed(0)}</strong>
        </article>
        <article className="partners-stat">
          <span>Profit From Centre</span>
          <strong>₹{(stats?.profit_from_centre ?? 0).toFixed(0)}</strong>
        </article>
        <article className="partners-stat">
          <span>Pending FOFO Earnings</span>
          <strong>₹{(stats?.pending_fofo_earnings ?? 0).toFixed(0)}</strong>
        </article>
      </div>

      <div className="partners-actions-row">
        <Link className="partners-btn partners-btn-primary" to="/b2b/order">
          New walk-in order
        </Link>
        <Link className="partners-btn partners-btn-outline" to="/b2b/bill-status">
          Bill Status
        </Link>
        <Link className="partners-btn partners-btn-outline" to="/b2b/download-report">
          Download Report
        </Link>
        <Link className="partners-btn partners-btn-outline" to="/b2b/catalog">
          View dual-price catalog
        </Link>
        <Link className="partners-btn partners-btn-outline" to="/b2b/centres">
          Centres
        </Link>
        <Link className="partners-btn partners-btn-outline" to="/b2b/fofo-commission">
          FOFO Commission
        </Link>
        <Link className="partners-btn partners-btn-outline" to="/b2b/statements">
          Statements
        </Link>
      </div>
    </>
  );
}
