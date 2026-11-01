import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, InsuranceProduct } from '../api';
import { useAuth } from '../auth/AuthContext';
import './home-v2.css';
import './insurance-v2.css';

const CIGARETTE_PER_DAY = 25;
const INSURANCE_PER_DAY = 18;
const CITY_KEY = 'remedium_city';

const TRUST = [
  { title: 'Licensed advisor', sub: 'GIC and LIC health products', icon: 'shield', tone: 'teal' },
  { title: 'Callback in 24 hrs', sub: 'An advisor explains options', icon: 'phone', tone: 'blue' },
  { title: 'No online checkout', sub: 'We do not sell policies here', icon: 'doc', tone: 'violet' },
  { title: 'Underwritten by insurer', sub: 'Final terms after review', icon: 'check', tone: 'amber' },
];

const FALLBACK_INTERESTS = [
  'Family health cover',
  'Individual cover',
  'Senior citizen plan',
  'Critical illness',
  'Top-up / super top-up',
  'Not sure — advise me',
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
  shield: (
    <>
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  phone: (
    <>
      <path d="M7 3.5h4l1.5 3.5-2 1.5a12 12 0 0 0 5 5l1.5-2 3.5 1.5v4A2 2 0 0 1 18.5 19 14.5 14.5 0 0 1 5 5.5 2 2 0 0 1 7 3.5z" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7l3 3v14H7z" />
      <path d="M14 3.5V7h3" />
    </>
  ),
};

function formatInr(value?: number) {
  if (value == null || !Number.isFinite(value) || value <= 0) return '';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function sumInsuredLabel(product: InsuranceProduct) {
  const from = formatInr(product.sum_insured_from);
  const to = formatInr(product.sum_insured_to);
  if (from && to) return `${from} – ${to} cover`;
  if (from) return `From ${from} cover`;
  return '';
}

function loadCity() {
  try {
    return localStorage.getItem(CITY_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function InsuranceLandingPage() {
  const { user, isAuthenticated } = useAuth();
  const [products, setProducts] = useState<InsuranceProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [agentNote, setAgentNote] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedCode, setSelectedCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    city: loadCity(),
    interest: 'Family health cover',
    message: '',
  });

  useEffect(() => {
    api
      .getInsuranceLanding()
      .then((res) => {
        setProducts(res.data.products || []);
        setCategories(res.data.categories || []);
        setAgentNote(res.data.agent_note || '');
      })
      .catch(() => {
        /* landing copy is static; ignore API failures for hero */
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      full_name: f.full_name || user.fullName || '',
      email: f.email || (user.user.includes('@') ? user.user : ''),
    }));
  }, [user]);

  const visible = useMemo(() => {
    if (category === 'all') return products;
    return products.filter((p) => (p.category || '').toLowerCase() === category.toLowerCase());
  }, [products, category]);

  const interests = categories.length
    ? [...categories.map((c) => `${c} cover`), 'Not sure — advise me']
    : FALLBACK_INTERESTS;

  function askAbout(product: InsuranceProduct) {
    setSelectedCode(product.product_code);
    setForm((f) => ({
      ...f,
      interest: product.category ? `${product.category} cover` : f.interest,
      message: f.message || `Please advise on ${product.product_name} (${product.insurer}).`,
    }));
    document.getElementById('insurance-contact')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const notes = [
        form.interest ? `Interest: ${form.interest}` : '',
        form.city ? `City: ${form.city}` : '',
        selectedCode ? `Product: ${selectedCode}` : '',
        form.message ? form.message : '',
      ]
        .filter(Boolean)
        .join('\n');
      await api.submitInsuranceQuoteRequest({
        customer_name: form.full_name,
        phone: form.phone,
        ...(form.email ? { email: form.email } : {}),
        ...(selectedCode ? { product_code: selectedCode } : {}),
        ...(notes ? { notes } : {}),
      });
      setSuccess('Thanks — our insurance advisor will contact you within 24 hours.');
      setForm((f) => ({ ...f, message: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request');
    } finally {
      setBusy(false);
    }
  }

  const savings = CIGARETTE_PER_DAY - INSURANCE_PER_DAY;

  return (
    <div className="home-v2 ins-v2">
      <section className="hv-card ins-hero">
        <div className="ins-hero-copy">
          <p className="ins-kicker">Health insurance</p>
          <h1>Protect your family for less than the cost of a cigarette</h1>
          <p className="hv-muted">
            A basic health cover can work out to about ₹{INSURANCE_PER_DAY}/day — roughly ₹{savings}{' '}
            less than one cigarette (~₹{CIGARETTE_PER_DAY}). Skip the smoke. Keep the safety net.
          </p>
          <div className="ins-compare">
            <article className="hv-card ins-compare-card">
              <span>1 cigarette</span>
              <strong>≈ ₹{CIGARETTE_PER_DAY}</strong>
              <em>per day habit</em>
            </article>
            <div className="ins-vs">vs</div>
            <article className="hv-card ins-compare-card is-cover">
              <span>Health cover</span>
              <strong>≈ ₹{INSURANCE_PER_DAY}</strong>
              <em>per day (illustrative)</em>
            </article>
          </div>
          <p className="hv-muted">
            Figures are indicative for awareness — not a premium quote. Final cost depends on age,
            sum insured, and underwriting.
          </p>
          <div className="ins-hero-actions">
            <a className="hv-btn" href="#insurance-contact">
              Contact us for a quote
            </a>
            {products.length ? (
              <a className="hv-btn hv-btn-ghost" href="#insurance-products">
                View products
              </a>
            ) : null}
          </div>
        </div>
        <div className="ins-hero-visual" aria-hidden>
          <img src="/home/hero-care.jpg" alt="" />
        </div>
      </section>

      <ul className="ins-trust">
        {TRUST.map((item) => (
          <li key={item.title} className="hv-card">
            <span className={`ins-trust-icon tone-${item.tone}`}>
              <Icon size={16}>{ICONS[item.icon]}</Icon>
            </span>
            <div>
              <strong>{item.title}</strong>
              <span>{item.sub}</span>
            </div>
          </li>
        ))}
      </ul>

      <p className="hv-muted">
        {agentNote ||
          'We help you explore GIC / LIC health products as a licensed agent. No online policy checkout — an advisor will guide you.'}
      </p>

      <section id="insurance-products">
        <div className="ins-section-head">
          <div>
            <h2>Explore GIC & LIC health covers</h2>
            <p className="hv-muted">Starting premiums are indicative. An advisor confirms eligibility.</p>
          </div>
        </div>
        {categories.length ? (
          <div className="ins-cats">
            <button
              type="button"
              className={`hv-chip${category === 'all' ? ' hv-chip-soft' : ''}`}
              onClick={() => setCategory('all')}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`hv-chip${category === cat ? ' hv-chip-soft' : ''}`}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        ) : null}
        {!products.length ? (
          <div className="hv-card ins-empty">
            <p className="hv-muted">
              Product cards will appear when the advisor catalogue is published. You can still request a
              callback below.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="hv-card ins-empty">
            <p className="hv-muted">No products in this category yet.</p>
          </div>
        ) : (
          <div className="ins-grid">
            {visible.map((product) => (
              <article key={product.product_code} className="hv-card ins-card">
                <div className="ins-card-top">
                  <span className="ins-insurer">{product.insurer}</span>
                  {product.category ? <span className="hv-muted">{product.category}</span> : null}
                </div>
                <h3>{product.product_name}</h3>
                {product.premium_from ? (
                  <p className="ins-price">
                    {formatInr(product.premium_from)}
                    <span> / year from</span>
                  </p>
                ) : null}
                {sumInsuredLabel(product) ? <p className="hv-muted">{sumInsuredLabel(product)}</p> : null}
                {product.description ? <p className="hv-muted">{product.description}</p> : null}
                {(product.highlights || []).length ? (
                  <ul className="ins-card-list">
                    {product.highlights!.slice(0, 3).map((item) => (
                      <li key={item}>
                        <span className="ins-check tone-teal">
                          <Icon size={11}>{ICONS.check}</Icon>
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button className="hv-btn hv-btn-sm" type="button" onClick={() => askAbout(product)}>
                  Ask about this plan
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="insurance-contact" className="hv-card ins-contact">
        <div className="ins-contact-copy">
          <p className="ins-kicker">Get a callback</p>
          <h2>Contact us for a quote</h2>
          <p className="hv-muted">
            Tell us how to reach you. We will call back with options that fit your family — not a
            shopping cart of policies.
          </p>
          {selectedCode ? (
            <p className="hv-muted">
              Selected plan: <strong>{products.find((p) => p.product_code === selectedCode)?.product_name || selectedCode}</strong>
            </p>
          ) : null}
        </div>
        <form className="ins-contact-form" onSubmit={(e) => void onSubmit(e)}>
          {error ? (
            <div className="error wide" style={{ gridColumn: '1 / -1' }}>
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="success wide" style={{ gridColumn: '1 / -1' }}>
              {success}
            </div>
          ) : null}
          <label>
            Full name *
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
              autoComplete="name"
            />
          </label>
          <label>
            Mobile *
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              autoComplete="email"
            />
          </label>
          <label>
            City
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              autoComplete="address-level2"
            />
          </label>
          <label className="wide">
            I am interested in
            <select value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })}>
              {interests.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="wide">
            Message
            <textarea
              rows={4}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Preferred call time, family size, or questions…"
            />
          </label>
          <div className="ins-form-actions">
            <button className="hv-btn" type="submit" disabled={busy || !isAuthenticated}>
              {busy ? 'Sending…' : 'Send contact request'}
            </button>
            {!isAuthenticated ? (
              <p className="hv-muted">
                <Link className="hv-link" to="/login" state={{ from: '/insurance' }}>
                  Sign in
                </Link>{' '}
                required to submit.
              </p>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
