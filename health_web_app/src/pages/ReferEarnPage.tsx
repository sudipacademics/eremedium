import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

type Txn = {
  name: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  remarks?: string;
  posting_date?: string;
  creation?: string;
};

type WalletPayload = {
  referral_code: string;
  wallet_balance: number;
  referred_count: number;
  signup_credit: number;
  first_order_bonus: number;
  min_topup?: number;
  share_text: string;
  share_url: string;
  transactions: Txn[];
};

const QUICK_AMOUNTS = [100, 200, 500, 1000];

async function payPatientWalletTopup(input: { amount: number }) {
  const { payPatientWalletTopup: pay } = await import('../payments/razorpayCheckout');
  return pay(input);
}

export function ReferEarnPage() {
  const [data, setData] = useState<WalletPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topupError, setTopupError] = useState<string | null>(null);
  const [topupSuccess, setTopupSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('100');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPatientWallet();
      const payload = res.data as WalletPayload;
      setData(payload);
      const min = Number(payload.min_topup || 100);
      setAmount((prev) => {
        const n = Number(prev);
        return !n || n < min ? String(min) : prev;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load wallet');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyCode() {
    if (!data?.referral_code) return;
    try {
      await navigator.clipboard.writeText(data.referral_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    if (!data) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Remedium Refer & Earn', text: data.share_text, url: data.share_url });
        return;
      } catch {
        /* fall through */
      }
    }
    await copyCode();
  }

  async function onTopup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTopupError(null);
    setTopupSuccess(null);
    try {
      const amt = Number(amount);
      const min = Number(data?.min_topup || 100);
      if (!Number.isFinite(amt) || amt < min) {
        throw new Error(`Minimum top-up is ₹${min}`);
      }
      const result = await payPatientWalletTopup({ amount: amt });
      setTopupSuccess(
        `Wallet credited ₹${result.amount.toFixed(0)}. New balance ₹${result.wallet_balance.toFixed(0)}`,
      );
      await load();
    } catch (err) {
      setTopupError(err instanceof Error ? err.message : 'Top-up failed');
    } finally {
      setBusy(false);
    }
  }

  const minTopup = Number(data?.min_topup || 100);

  return (
    <div className="profile-page">
      <header className="profile-page-header">
        <Link className="text-link" to="/account">
          ← Back
        </Link>
        <h1>Refer &amp; Earn</h1>
      </header>

      {loading ? <p className="muted">Loading wallet…</p> : null}
      {error ? <div className="error">{error}</div> : null}

      {data ? (
        <>
          <div className="card card-wide account-hub-card">
            <p className="muted">Wallet balance</p>
            <h2 style={{ margin: 0 }}>₹{Number(data.wallet_balance || 0).toFixed(0)}</h2>
            <p className="muted">{data.referred_count || 0} friends joined with your code</p>
          </div>

          <section className="card card-wide">
            <h2 className="section-title">Top up wallet</h2>
            <p className="muted">Add money with UPI / card / netbanking. Minimum ₹{minTopup}.</p>
            <form className="form-stack" onSubmit={(e) => void onTopup(e)}>
              <div className="refer-quick-amounts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {QUICK_AMOUNTS.filter((q) => q >= minTopup).map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={`btn secondary btn-sm${Number(amount) === q ? ' active' : ''}`}
                    onClick={() => setAmount(String(q))}
                    disabled={busy}
                  >
                    ₹{q}
                  </button>
                ))}
              </div>
              <label>
                Amount (₹)
                <input
                  type="number"
                  min={minTopup}
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              {topupError ? <div className="error">{topupError}</div> : null}
              {topupSuccess ? <div className="success">{topupSuccess}</div> : null}
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Processing…' : 'Pay with Razorpay'}
              </button>
            </form>
          </section>

          <div className="refer-code-box">
            <div>
              <p className="muted" style={{ margin: 0 }}>
                Your referral code
              </p>
              <code>{data.referral_code}</code>
            </div>
            <button className="btn secondary btn-sm" type="button" onClick={() => void copyCode()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => void share()}>
              Share
            </button>
          </div>

          <section className="card card-wide">
            <h2 className="section-title">How it works</h2>
            <ol className="collection-steps">
              <li>
                <strong>Share your code</strong>
                <p className="muted">Friend signs up with {data.referral_code}</p>
              </li>
              <li>
                <strong>You both get ₹{Number(data.signup_credit).toFixed(0)}</strong>
                <p className="muted">Credited to Remedium wallets on successful registration</p>
              </li>
              <li>
                <strong>Earn ₹{Number(data.first_order_bonus).toFixed(0)} more</strong>
                <p className="muted">When they complete their first paid lab or doctor order</p>
              </li>
            </ol>
          </section>

          <section className="card card-wide">
            <h2 className="section-title">Recent activity</h2>
            {!data.transactions?.length ? (
              <p className="muted">No wallet transactions yet — share your code to start earning.</p>
            ) : (
              <ul className="refer-txn-list">
                {data.transactions.map((t) => (
                  <li key={t.name}>
                    <div>
                      <strong>
                        {t.transaction_type} ₹{Number(t.amount).toFixed(0)}
                      </strong>
                      <p className="muted" style={{ margin: 0 }}>
                        {t.remarks || t.posting_date || t.creation}
                      </p>
                    </div>
                    <span className="muted">₹{Number(t.balance_after).toFixed(0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
