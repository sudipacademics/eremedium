import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, B2bWalletPayload } from '../../api';

async function payB2bWalletRecharge(input: { amount: number }) {
  // Inline to avoid stale module graph; full Razorpay helper lives in payments/razorpayCheckout.
  const { payB2bWalletRecharge: pay } = await import('../../payments/razorpayCheckout');
  return pay(input);
}

export function B2bWalletPage() {
  const [wallet, setWallet] = useState<B2bWalletPayload | null>(null);
  const [amount, setAmount] = useState('5000');
  const [paymentReference, setPaymentReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadWallet() {
    const res = await api.getB2bWallet();
    setWallet(res.data);
  }

  useEffect(() => {
    void loadWallet().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load wallet'),
    );
  }, []);

  async function onPayOnline(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const amt = Number(amount);
      const result = await payB2bWalletRecharge({ amount: amt });
      setSuccess(
        `Wallet credited ₹${result.amount.toFixed(0)}. New balance ₹${result.wallet_balance.toFixed(0)}`,
      );
      await loadWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Razorpay recharge failed');
    } finally {
      setBusy(false);
    }
  }

  async function onOfflineRecharge(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.rechargeB2bWallet({
        amount,
        payment_reference: paymentReference || undefined,
      });
      setSuccess(
        `Wallet credited ₹${res.data.amount.toFixed(0)}. New balance ₹${res.data.wallet_balance.toFixed(0)}`,
      );
      setPaymentReference('');
      await loadWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recharge failed');
    } finally {
      setBusy(false);
    }
  }

  const minRecharge = wallet?.min_recharge ?? 500;
  const balance = wallet?.wallet_balance ?? 0;

  return (
    <>
      <h1>Platform wallet</h1>
      <p className="muted">
        Recharge here to cover platform fees (wholesale). Each walk-in booking debits the wholesale
        amount automatically. Bookings are blocked if balance is too low.
      </p>

      <div className="grid grid-stats">
        <article className="card stat-card">
          <span className="stat-label">Available balance</span>
          <strong>₹{balance.toFixed(0)}</strong>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Minimum recharge</span>
          <strong>₹{minRecharge.toFixed(0)}</strong>
        </article>
      </div>

      <form className="card card-wide form-stack" style={{ marginTop: 24 }} onSubmit={onPayOnline}>
        <h2>Pay with Razorpay</h2>
        <p className="muted">Card / UPI / netbanking. Credits your wallet immediately after payment.</p>
        <label>
          Amount (₹)
          <input
            type="number"
            min={minRecharge}
            step="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        {error ? <div className="error">{error}</div> : null}
        {success ? <div className="success">{success}</div> : null}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Processing…' : 'Pay & recharge'}
        </button>
      </form>

      <p style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setShowOffline((v) => !v)}
        >
          {showOffline ? 'Hide offline transfer' : 'Record offline bank / UPI transfer'}
        </button>
      </p>

      {showOffline ? (
        <form className="card card-wide form-stack" style={{ marginTop: 12 }} onSubmit={onOfflineRecharge}>
          <h2>Offline recharge</h2>
          <p className="muted">Use this only after you have already paid via bank/UPI to the platform.</p>
          <label>
            Amount (₹)
            <input
              type="number"
              min={minRecharge}
              step="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label>
            Payment reference
            <input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="UPI ref / bank txn id"
              required
            />
          </label>
          <button className="btn secondary" type="submit" disabled={busy}>
            {busy ? 'Processing…' : 'Credit from offline transfer'}
          </button>
        </form>
      ) : null}

      <div className="table-wrap" style={{ marginTop: 24 }}>
        <h2>Recent transactions</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Balance after</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {(wallet?.transactions || []).map((txn) => (
              <tr key={txn.id}>
                <td>{txn.created ? new Date(txn.created).toLocaleString() : '—'}</td>
                <td>{txn.type}</td>
                <td>
                  {txn.type === 'Platform Fee' ? '−' : '+'}₹{txn.amount.toFixed(0)}
                </td>
                <td>₹{txn.balance_after.toFixed(0)}</td>
                <td>{txn.reference || txn.payment_reference || txn.remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!wallet?.transactions?.length ? <p className="muted">No transactions yet.</p> : null}
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/b2b/order">Book walk-in test</Link>
        {' · '}
        <Link to="/b2b">Back to overview</Link>
      </p>
    </>
  );
}
