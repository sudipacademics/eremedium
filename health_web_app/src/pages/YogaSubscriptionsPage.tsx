import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AlliedHealthWing, HealthSubscription, SubscriptionPlan } from '../api';
import { useAuth } from '../auth/AuthContext';
import { payWithRazorpay } from '../payments/razorpayCheckout';

function sessionLabel(plan: SubscriptionPlan) {
  if (plan.unlimited_sessions || plan.included_sessions_per_month === 0) {
    return 'Unlimited group classes';
  }
  return `${plan.included_sessions_per_month} live classes / month`;
}

export function YogaSubscriptionsPage() {
  const { user } = useAuth();
  const [wing, setWing] = useState<AlliedHealthWing | null>(null);
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
        const plansRes = await api.getYogaSubscriptionPlans();
        if (!cancelled) {
          setPlans(plansRes.data.plans || []);
          setWing(plansRes.data.wing || null);
        }
        if (user) {
          const mine = await api.getMyYogaSubscription();
          if (!cancelled) {
            setCurrent(mine.data.subscription);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load yoga plans');
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
      const checkout = await api.createSubscriptionCheckout(planCode);
      const sub = checkout.data.subscription;
      await payWithRazorpay({
        referenceDoctype: 'Health Subscription',
        referenceName: checkout.data.reference_name,
        amount: checkout.data.amount,
        customerName: user.fullName || user.user,
        email: user.user,
      });
      setCurrent({ ...sub, status: 'Active' });
      setMessage('Yoga membership activated — book your first class from Wellness.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete checkout');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>{wing?.title || 'Yoga memberships'}</h1>
        <p className="muted">
          {wing?.subtitle ||
            'Live group classes, breathwork, and guided meditation — subscribe and book sessions online.'}
        </p>
      </section>

      {loading ? <p>Loading plans…</p> : null}
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      {current?.status === 'Active' && current.plan ? (
        <div className="card card-wide" style={{ marginBottom: 24 }}>
          <h2>Your membership</h2>
          <p>
            <strong>{current.plan.title}</strong> — active until {current.end_date || 'renewal'}
          </p>
          <ul className="benefit-list">
            <li>{sessionLabel(current.plan)}</li>
            {current.plan.online_access ? <li>On-demand meditation library</li> : null}
          </ul>
          <div className="toolbar">
            <Link className="btn" to="/wellness/yoga">
              Book a yoga session
            </Link>
            <Link className="btn secondary" to="/account">
              Account
            </Link>
          </div>
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
              <li>{sessionLabel(plan)}</li>
              {plan.online_access ? <li>Online class &amp; meditation library</li> : null}
              {plan.plan_code === 'YOGA_UNLIMITED' ? <li>2 private sessions / month</li> : null}
              {plan.plan_code === 'YOGA_ANNUAL' ? <li>Quarterly instructor check-in</li> : null}
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
                  {busy === plan.plan_code ? 'Opening checkout…' : 'Subscribe now'}
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

      {!loading && !plans.length ? (
        <p className="muted">Yoga membership plans are being configured — check back soon.</p>
      ) : null}

      <p className="muted" style={{ marginTop: 20 }}>
        Prefer pay-per-session?{' '}
        <Link to="/wellness/yoga">Browse individual yoga services →</Link>
        {' · '}
        <Link to="/services">All services</Link>
      </p>
    </>
  );
}
