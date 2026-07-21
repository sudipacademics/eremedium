import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, HealthSubscription, SubscriptionPlan } from '../api';
import { useAuth } from '../auth/AuthContext';

export function SubscriptionsPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [current, setCurrent] = useState<HealthSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const plansRes = await api.getHealthSubscriptionPlans();
        if (!cancelled) {
          setPlans(plansRes.data.plans || []);
        }
        if (user) {
          const mine = await api.getMyHealthSubscription();
          if (!cancelled) {
            setCurrent(mine.data.subscription);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load plans');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function onSubscribe(planCode: string) {
    if (!user) return;
    setBusy(planCode);
    setError(null);
    setMessage(null);
    try {
      const res = await api.subscribeHealthPlan(planCode);
      setCurrent(res.data.subscription);
      setMessage(res.message || 'Subscription activated');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not subscribe');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <h1>Health subscriptions</h1>
      <p className="muted">
        Family plans with free home collection and discounts on labs and pharmacy.
      </p>

      {loading ? <p>Loading plans…</p> : null}
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      {current?.status === 'Active' && current.plan ? (
        <div className="card card-wide" style={{ marginBottom: 24 }}>
          <h2>Your plan</h2>
          <p>
            <strong>{current.plan.title}</strong> — active until{' '}
            {current.end_date || 'renewal'}
          </p>
          <ul className="benefit-list">
            {current.plan.free_home_collection ? <li>Free home collection</li> : null}
            {(current.plan.lab_discount_percent ?? 0) > 0 ? (
              <li>{current.plan.lab_discount_percent}% off lab tests</li>
            ) : null}
            {(current.plan.pharmacy_discount_percent ?? 0) > 0 ? (
              <li>{current.plan.pharmacy_discount_percent}% off pharmacy</li>
            ) : null}
          </ul>
          <Link className="btn secondary" to="/account">
            Back to account
          </Link>
        </div>
      ) : null}

      <div className="plan-grid">
        {plans.map((plan) => (
          <div key={plan.plan_code} className="card plan-card">
            <h3>{plan.title}</h3>
            <p className="plan-price">
              ₹{plan.monthly_price.toFixed(0)}
              <span className="muted"> / {plan.billing_interval?.toLowerCase() || 'month'}</span>
            </p>
            <p>{plan.description}</p>
            <ul className="benefit-list">
              {plan.free_home_collection ? <li>Free home collection</li> : null}
              {(plan.lab_discount_percent ?? 0) > 0 ? (
                <li>{plan.lab_discount_percent}% off lab tests</li>
              ) : null}
              {(plan.pharmacy_discount_percent ?? 0) > 0 ? (
                <li>{plan.pharmacy_discount_percent}% off pharmacy</li>
              ) : null}
            </ul>
            {user ? (
              current?.status === 'Active' ? (
                <button className="btn secondary" type="button" disabled>
                  Already subscribed
                </button>
              ) : (
                <button
                  className="btn"
                  type="button"
                  disabled={busy === plan.plan_code}
                  onClick={() => void onSubscribe(plan.plan_code)}
                >
                  {busy === plan.plan_code ? 'Subscribing…' : 'Subscribe'}
                </button>
              )
            ) : (
              <Link className="btn" to="/login">
                Log in to subscribe
              </Link>
            )}
          </div>
        ))}
      </div>

      {!loading && plans.length === 0 ? (
        <p className="muted">No subscription plans available yet.</p>
      ) : null}
    </>
  );
}
