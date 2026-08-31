'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, session, type WalletBalance, type WalletTransaction } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

interface CreatedOrder {
  paymentOrderId: string;
  providerOrderId: string;
  amount: string;
  currency: string;
  razorpayKeyId: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const PRESETS = ['100', '250', '500', '1000'];

const TYPE_STYLES: Record<string, string> = {
  CREDIT: 'text-emerald-300',
  DEBIT: 'text-rose-300',
};

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [amount, setAmount] = useState('500');
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .get<{ balance: string; currency: string; transactions: WalletTransaction[] }>(
        'wallet/transactions?limit=25',
      )
      .then((result) => {
        setTransactions(result.transactions);
        setWallet({ walletId: '', balance: result.balance, currency: result.currency });
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Failed to load'));
  }, []);

  useEffect(() => {
    load();
    void api
      .get<{ enabled: boolean }>('payments/config')
      .then((config) => setPaymentsEnabled(config.enabled))
      .catch(() => setPaymentsEnabled(false));
  }, [load]);

  useSocketEvent('BILLING_TICK', load);

  const topUp = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const order = await api.post<CreatedOrder>('payments/order', { amount });

      const ready = await loadRazorpayScript();
      if (!ready || !window.Razorpay) {
        setError('Could not load the payment window. Check your connection and retry.');
        return;
      }

      const checkout = new window.Razorpay({
        key: order.razorpayKeyId,
        order_id: order.providerOrderId,
        // Razorpay expects the smallest currency unit.
        amount: Math.round(Number(order.amount) * 100),
        currency: order.currency,
        name: 'Jyotish Consultations',
        description: `Wallet top-up ₹${order.amount}`,
        prefill: { contact: session.profile?.phone ?? '' },
        theme: { color: '#ff7f11' },
        handler: () => {
          /*
           * Deliberately does NOT credit the wallet. The balance moves only when Razorpay's signed
           * webhook reaches the gateway, so this callback just tells the user to expect it. Trusting
           * a browser callback here is exactly how a client could mint free balance.
           */
          setNotice('Payment received. Your balance updates once the provider confirms it.');
          setTimeout(load, 2500);
          setTimeout(load, 6000);
        },
        modal: {
          ondismiss: () => setNotice('Payment window closed. Nothing was charged.'),
        },
      });
      checkout.open();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the top-up');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card bg-gradient-to-br from-saffron-500/15 to-transparent">
        <p className="text-xs uppercase tracking-wide text-slate-400">Wallet balance</p>
        <p className="tabular mt-1 text-4xl font-semibold">
          ₹{wallet?.balance ?? '—'}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          Consultations are debited a minute at a time while you are connected.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Add money</h2>

        {paymentsEnabled === false && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Payments are not configured on this environment yet, so top-ups cannot complete. Add the
            Razorpay keys to enable them.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(preset)}
              className={`btn ${
                amount === preset
                  ? 'bg-saffron-500 text-night-950'
                  : 'border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
              }`}
            >
              ₹{preset}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="amount">
            Or enter an amount
          </label>
          <input
            id="amount"
            className="input tabular"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>

        <button
          type="button"
          className="btn-primary w-full"
          disabled={busy || paymentsEnabled !== true || Number(amount) <= 0}
          onClick={() => void topUp()}
        >
          {busy ? 'Opening payment…' : `Add ₹${amount || '0'}`}
        </button>

        {notice && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{notice}</p>
        )}
        {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">Recent activity</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">
                    {transaction.referenceType === 'CALL_SESSION'
                      ? 'Consultation minute'
                      : transaction.referenceType === 'RECHARGE'
                        ? 'Wallet top-up'
                        : transaction.type}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(transaction.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`tabular text-sm font-semibold ${TYPE_STYLES[transaction.type] ?? ''}`}>
                    {transaction.type === 'DEBIT' ? '−' : '+'}₹{transaction.amount}
                  </p>
                  <p className="tabular text-xs text-slate-500">₹{transaction.balanceAfter}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
