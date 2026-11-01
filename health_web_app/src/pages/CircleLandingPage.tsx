import { ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, CircleLandingPayload, SubscriptionPlan } from '../api';
import { useAuth } from '../auth/AuthContext';
import './home-v2.css';
import './circle-v2.css';

const STEPS = [
  { title: 'Pick a plan', text: 'Choose 3 months, 12 months, or Family and subscribe.' },
  { title: 'Pay securely', text: 'Checkout activates membership. Test mode joins instantly.' },
  { title: 'Book at member price', text: 'Lab tests, packages and pharmacy show the Circle rate.' },
  { title: 'Home collection included', text: 'Phlebotomist visits are free for Circle members.' },
];

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  check: <path d="M6 12.5l3.5 3.5L18 8" />,
  flask: <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />,
  pill: (
    <>
      <rect x="4.5" y="9" width="15" height="6" rx="3" />
      <path d="M12 9v6" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 11L12 4l8.5 7" />
      <path d="M6 9.5V20h12V9.5" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5l1.4 5.1L18.5 10 13.4 11.4 12 16.5l-1.4-5.1L5.5 10l5.1-1.4z" />
    </>
  ),
};

const BENEFIT_ICON: Record<string, { icon: string; tone: string }> = {
  lab: { icon: 'flask', tone: 'teal' },
  pharmacy: { icon: 'pill', tone: 'violet' },
  home: { icon: 'home', tone: 'blue' },
  priority: { icon: 'spark', tone: 'amber' },
};

function benefitMeta(icon: string) {
  return BENEFIT_ICON[icon] || { icon: 'check', tone: 'teal' };
}

function isCirclePlan(plan: SubscriptionPlan) {
  const code = (plan.plan_code || '').toUpperCase();
  const title = (plan.title || '').toLowerCase();
  const category = (plan.plan_category || '').toLowerCase();
  return code.startsWith('CIRCLE_') || title.includes('health circle') || category === 'circle';
}

function planInterval(plan: SubscriptionPlan) {
  const interval = (plan.billing_interval || '').toLowerCase();
  if (interval === 'year') return 'year';
  if (plan.plan_code.includes('3M')) return '3 months';
  if (plan.plan_code.toLowerCase().includes('family')) return 'family';
  return 'plan';
}

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
  const featured = plan.plan_code.includes('12M');

  return (
    <article className={`hv-card cir-plan${featured ? ' is-featured' : ''}`}>
      {featured ? <span className="cir-ribbon">Best value</span> : null}
      <h3>{plan.title}</h3>
      <p className="cir-price">
        ₹{plan.monthly_price.toFixed(0)}
        <span> / {planInterval(plan)}</span>
      </p>
      <p className="hv-muted">{plan.description}</p>
      <ul className="cir-plan-list">
        {plan.free_home_collection ? (
          <li>
            <span className="cir-check tone-teal">
              <Icon size={12}>{ICONS.check}</Icon>
            </span>
            Free home sample collection
          </li>
        ) : null}
        {(plan.lab_discount_percent ?? 0) > 0 ? (
          <li>
            <span className="cir-check tone-teal">
              <Icon size={12}>{ICONS.check}</Icon>
            </span>
            {plan.lab_discount_percent}% off lab tests & packages
          </li>
        ) : null}
        {(plan.pharmacy_discount_percent ?? 0) > 0 ? (
          <li>
            <span className="cir-check tone-teal">
              <Icon size={12}>{ICONS.check}</Icon>
            </span>
            {plan.pharmacy_discount_percent}% off pharmacy
          </li>
        ) : null}
        <li>
          <span className="cir-check tone-teal">
            <Icon size={12}>{ICONS.check}</Icon>
          </span>
          Auto-applied at checkout
        </li>
      </ul>
      {user ? (
        active ? (
          <Link className="hv-btn hv-btn-ghost" to="/diagnostics">
            Book with member price
          </Link>
        ) : (
          <button
            className="hv-btn"
            type="button"
            disabled={busy === plan.plan_code}
            onClick={() => onSubscribe(plan.plan_code)}
          >
            {busy === plan.plan_code ? 'Joining…' : 'Join Health Circle'}
          </button>
        )
      ) : (
        <Link className="hv-btn" to="/login">
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

  const isMember = Boolean(data?.entitlements && (data.entitlements as { active?: boolean }).active);
  const circlePlans = (data?.plans || []).filter(isCirclePlan);
  const plans = circlePlans.length ? circlePlans : data?.plans || [];

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
      const plan = data?.plans?.find((p) => p.plan_code === planCode);
      if (plan && plan.monthly_price > 0) {
        const { paySubscription } = await import('../payments/razorpayCheckout');
        await paySubscription({ planCode, customerName: user?.fullName || user?.user, email: user?.user });
      } else {
        await api.subscribeHealthPlan(planCode);
      }
      setMessage('Welcome to Health Circle! Member prices apply at checkout.');
      const res = await api.getCircleLanding();
      setData(res.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not subscribe';
      if (msg !== 'Payment cancelled') setError(msg);
    } finally {
      setBusy('');
    }
  }

  if (!data && !error) {
    return <p className="hv-muted">Loading Health Circle…</p>;
  }

  return (
    <div className="home-v2 cir-v2">
      <section className="hv-card cir-hero">
        <div className="cir-hero-copy">
          <p className="cir-kicker">Premium membership</p>
          <h1>{data?.brand || 'Health Circle'}</h1>
          <p className="hv-muted">
            {data?.tagline || 'Save on labs and home collection with Remedium Health Circle membership.'}
          </p>
          {isMember ? <div className="cir-member-pill">You are a Health Circle member</div> : null}
          <ul className="cir-hero-list">
            {(data?.hero_points || []).map((point) => (
              <li key={point}>
                <span className="cir-check tone-teal">
                  <Icon size={12}>{ICONS.check}</Icon>
                </span>
                {point}
              </li>
            ))}
          </ul>
          <div className="cir-hero-actions">
            {isMember ? (
              <button className="hv-btn" type="button" onClick={() => navigate('/diagnostics')}>
                Book with member price
              </button>
            ) : (
              <a className="hv-btn" href="#circle-plans">
                View plans
              </a>
            )}
            <Link className="hv-btn hv-btn-ghost" to="/subscriptions">
              Manage membership
            </Link>
          </div>
        </div>
        <div className="cir-hero-visual" aria-hidden>
          <img src="/home/hero-care.jpg" alt="" />
        </div>
      </section>

      {message ? <div className="success hv-card">{message}</div> : null}
      {error ? <div className="error hv-card">{error}</div> : null}

      <div className="cir-benefits">
        {(data?.benefit_cards || []).map((card) => {
          const meta = benefitMeta(card.icon);
          return (
            <article key={card.title} className="hv-card cir-benefit">
              <span className={`cir-benefit-icon tone-${meta.tone}`}>
                <Icon size={16}>{ICONS[meta.icon]}</Icon>
              </span>
              <div>
                <strong>{card.title}</strong>
                <p className="hv-muted">{card.text}</p>
              </div>
            </article>
          );
        })}
      </div>

      <section id="circle-plans">
        <div className="cir-section-head">
          <div>
            <h2>Choose your plan</h2>
            <p className="hv-muted">Member discounts apply automatically — no coupon codes needed.</p>
          </div>
        </div>
        {!plans.length ? (
          <div className="hv-card cir-empty">
            <p className="hv-muted">Plans are being configured. Check back shortly.</p>
          </div>
        ) : (
          <div className="cir-plans">
            {plans.map((plan) => (
              <PlanCard key={plan.plan_code} plan={plan} active={isMember} busy={busy} onSubscribe={onSubscribe} />
            ))}
          </div>
        )}
      </section>

      <aside className="hv-card cir-compare">
        <h2>Member vs guest</h2>
        <table>
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
                <td>{row.circle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </aside>

      <section>
        <div className="cir-section-head">
          <h2>How it works</h2>
        </div>
        <div className="cir-steps">
          {STEPS.map((step, index) => (
            <article key={step.title} className="hv-card cir-step">
              <span className="cir-step-num tone-teal">{index + 1}</span>
              <strong>{step.title}</strong>
              <p className="hv-muted">{step.text}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
