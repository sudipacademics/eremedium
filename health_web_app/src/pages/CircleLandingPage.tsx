import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, CircleLandingPayload, SubscriptionPlan } from '../api';
import { useAuth } from '../auth/AuthContext';

function PlanCard({
  plan,
  active,
  busy,
  onSubscribe,
}: {
  plan: SubscriptionPlan;
  active: boolean;
  busy: string;
  onSubscribe: (code: string) => void;
}) {
  const { user } = useAuth();
  const isAnnual = (plan.billing_interval || '').toLowerCase() === 'year';

  return (
    <article className={`card circle-plan-card${plan.plan_code.includes('12M') ? ' featured' : ''}`}>
      {plan.plan_code.includes('12M') ? <span className="circle-ribbon">Best value</span> : null}
      <h3>{plan.title}</h3>
      <p className="circle-plan-price">
        ₹{plan.monthly_price.toFixed(0)}
        <span className="muted"> / {isAnnual ? 'year' : 'plan'}</span>
      </p>
      <p className="muted">{plan.description}</p>
      <ul className="benefit-list">
        {plan.free_home_collection ? <li>Free home sample collection</li> : null}
        {(plan.lab_discount_percent ?? 0) > 0 ? (
          <li>{plan.lab_discount_percent}% off lab tests & packages</li>
        ) : null}
        {(plan.pharmacy_discount_percent ?? 0) > 0 ? (
          <li>{plan.pharmacy_discount_percent}% off pharmacy</li>
        ) : null}
        <li>Auto-applied at checkout</li>
      </ul>
      {user ? (
        active ? (
          <button className="btn secondary" type="button" disabled>
            You&apos;re a member
          </button>
        ) : (
          <button
            className="btn circle-cta"
            type="button"
            disabled={busy === plan.plan_code}
            onClick={() => onSubscribe(plan.plan_code)}
          >
            {busy === plan.plan_code ? 'Joining…' : 'Join Health Circle'}
          </button>
        )
      ) : (
        <Link className="btn circle-cta" to="/login">
          Log in to join
        </Link>
      )}
    </article>
  );
}

export function CircleLandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<CircleLandingPayload | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMember = Boolean(
    data?.entitlements && (data.entitlements as { active?: boolean }).active,
  );

  useEffect(() => {
    void api
      .getCircleLanding()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [user]);

  async function onSubscribe(planCode: string) {
    setBusy(planCode);
    setError(null);
    setMessage(null);
    try {
      await api.subscribeHealthPlan(planCode);
      setMessage('Welcome to Health Circle! Member prices apply at checkout.');
      const res = await api.getCircleLanding();
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not subscribe');
    } finally {
      setBusy('');
    }
  }

  if (!data && !error) {
    return <p className="page-center muted">Loading Health Circle…</p>;
  }

  return (
    <div className="circle-landing">
      <section className="circle-hero">
        <div className="circle-hero-copy">
          <p className="circle-eyebrow">Premium membership</p>
          <h1>{data?.brand || 'Health Circle'}</h1>
          <p className="circle-tagline">
            {data?.tagline ||
              'Save on labs and home collection with Remedium Health Circle membership.'}
          </p>
          <ul className="circle-hero-list">
            {(data?.hero_points || []).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="toolbar">
            {isMember ? (
              <button className="btn circle-cta" type="button" onClick={() => navigate('/diagnostics')}>
                Book with member price
              </button>
            ) : (
              <a className="btn circle-cta" href="#circle-plans">
                View plans
              </a>
            )}
            <Link className="btn secondary" to="/subscriptions">
              Manage membership
            </Link>
          </div>
        </div>
        <div className="circle-hero-card card">
          <h2>Member vs guest</h2>
          <table className="circle-compare-table">
            <thead>
              <tr>
                <th>Benefit</th>
                <th>Guest</th>
                <th>Circle</th>
              </tr>
            </thead>
            <tbody>
              {(data?.comparison || []).map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td>{row.guest}</td>
                  <td>
                    <strong>{row.circle}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {message ? <div className="success card">{message}</div> : null}
      {error ? <div className="error card">{error}</div> : null}

      <section className="circle-benefits">
        <h2>Why join Health Circle?</h2>
        <div className="circle-benefit-grid">
          {(data?.benefit_cards || []).map((card) => (
            <article key={card.title} className="card circle-benefit-card">
              <span className={`circle-icon circle-icon-${card.icon}`} />
              <h3>{card.title}</h3>
              <p className="muted">{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="circle-plans" id="circle-plans">
        <h2>Choose your plan</h2>
        <p className="muted">Member discounts apply automatically — no coupon codes needed.</p>
        <div className="plan-grid circle-plan-grid">
          {(data?.plans || []).map((plan) => (
            <PlanCard
              key={plan.plan_code}
              plan={plan}
              active={isMember}
              busy={busy}
              onSubscribe={onSubscribe}
            />
          ))}
        </div>
        {!data?.plans?.length ? (
          <p className="muted">Plans are being configured. Check back shortly.</p>
        ) : null}
      </section>

      <section className="card circle-faq">
        <h2>How it works</h2>
        <ol className="circle-steps">
          <li>Pick a Health Circle plan and subscribe (test mode activates instantly).</li>
          <li>Book lab tests, packages, or pharmacy — your member price shows at checkout.</li>
          <li>Stack a promo coupon on top of your Circle discount when available.</li>
          <li>Enjoy free home collection on lab bookings as a Circle member.</li>
        </ol>
      </section>
    </div>
  );
}
