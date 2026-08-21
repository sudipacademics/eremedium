import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';

type Pack = {
  plan_code: string;
  title: string;
  description?: string;
  price: number;
  wellness_wing?: string;
  included_sessions: number;
  unlimited?: boolean;
};

type Card = {
  subscription_id: string;
  title?: string;
  wellness_wing?: string;
  sessions_total: number;
  sessions_remaining: number;
  sessions_used: number;
  unlimited?: boolean;
  last_session_on?: string | null;
};

const WING_LABEL: Record<string, string> = {
  physiotherapy: 'Physiotherapy',
  aesthetics: 'Aesthetic',
  yoga: 'Yoga',
};

export function SessionCardsPage() {
  const { isAuthenticated } = useAuth();
  const [params] = useSearchParams();
  const wingFilter = (params.get('wing') || '').toLowerCase();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    const packRes = await api.listWellnessSessionPacks(wingFilter || undefined);
    setPacks(packRes.data.packs || []);
    if (isAuthenticated) {
      const cardRes = await api.getMySessionCards(wingFilter || undefined);
      setCards(cardRes.data.cards || []);
    } else {
      setCards([]);
    }
  }

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : 'Unable to load session cards'));
  }, [wingFilter, isAuthenticated]);

  async function buy(planCode: string) {
    if (!isAuthenticated) {
      setError('Please sign in to activate a session card.');
      return;
    }
    setBusy(planCode);
    setError('');
    setNotice('');
    try {
      await api.purchaseSessionCard(planCode, 'Pay at Hub');
      setNotice('Session card activated. Book a session to punch one visit.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not activate card');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="session-cards-page">
      <header className="page-intro">
        <p className="muted">Wellness · Session cards</p>
        <h1>Physio & Aesthetic Cards</h1>
        <p>Buy a punch card, then each visit deducts one session automatically when you book.</p>
        <div className="session-wing-filters">
          <Link to="/wellness/sessions" className={!wingFilter ? 'active' : undefined}>
            All
          </Link>
          <Link to="/wellness/sessions?wing=physiotherapy" className={wingFilter === 'physiotherapy' ? 'active' : undefined}>
            Physiotherapy
          </Link>
          <Link to="/wellness/sessions?wing=aesthetics" className={wingFilter === 'aesthetics' ? 'active' : undefined}>
            Aesthetic
          </Link>
          <Link to="/yoga-memberships">Yoga memberships</Link>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      {isAuthenticated ? (
        <section className="session-section">
          <h2>My cards</h2>
          {cards.length === 0 ? (
            <p className="muted">No active cards yet. Choose a pack below.</p>
          ) : (
            <div className="session-card-grid">
              {cards.map((c) => (
                <article key={c.subscription_id} className="session-card-tile">
                  <p className="session-chip">{WING_LABEL[c.wellness_wing || ''] || c.wellness_wing || 'Wellness'}</p>
                  <h3>{c.title || c.subscription_id}</h3>
                  <p className="session-remaining">
                    {c.unlimited || c.sessions_total === 0
                      ? 'Unlimited sessions'
                      : `${c.sessions_remaining} of ${c.sessions_total} left`}
                  </p>
                  <div className="session-progress">
                    <span
                      style={{
                        width: c.unlimited || !c.sessions_total
                          ? '100%'
                          : `${Math.min(100, (c.sessions_used / c.sessions_total) * 100)}%`,
                      }}
                    />
                  </div>
                  {c.last_session_on ? (
                    <p className="muted">Last session: {String(c.last_session_on).slice(0, 16)}</p>
                  ) : null}
                  <Link
                    className="btn"
                    to={`/wellness/${c.wellness_wing || 'physiotherapy'}`}
                  >
                    Book a session
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <p className="muted">
          <Link to="/login">Sign in</Link> to view and activate your cards.
        </p>
      )}

      <section className="session-section">
        <h2>Available packs</h2>
        <div className="session-card-grid">
          {packs.map((p) => (
            <article key={p.plan_code} className="session-card-tile pack">
              <p className="session-chip">{WING_LABEL[p.wellness_wing || ''] || p.wellness_wing}</p>
              <h3>{p.title}</h3>
              <p>{p.description}</p>
              <p className="session-price">
                ₹{Number(p.price || 0).toLocaleString('en-IN')}
                <span>
                  {p.unlimited || p.included_sessions === 0
                    ? ' · Unlimited'
                    : ` · ${p.included_sessions} sessions`}
                </span>
              </p>
              <button
                type="button"
                className="btn"
                disabled={busy === p.plan_code}
                onClick={() => void buy(p.plan_code)}
              >
                {busy === p.plan_code ? 'Activating…' : 'Activate card'}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
