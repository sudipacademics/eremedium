'use client';

import { useCallback, useEffect, useState } from 'react';

import { ProfileIcon, type ProfileIconName } from '@/components/profile/ProfileIcon';
import { api, session, type WalletTransaction } from '@/lib/api';
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

const PRESETS = ['500', '1000', '2000', '5000', '10000'];
const RECENT_ROWS = 6;
const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INR_WHOLE = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const inr = (value: string | number) => `₹${INR.format(Number(value))}`;

/** en-IN abbreviates September as "Sept"; every other month is three letters. */
const shortMonth = (text: string) => text.replace('Sept', 'Sep');

export function formatDate(iso: string): string {
  return shortMonth(new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
}

export function formatDateTime(iso: string): string {
  return shortMonth(new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
}

/** "+91 9000000000" for Indian numbers; other countries as stored. */
export function formatPhone(phone: string): string {
  return /^\+91\d{10}$/.test(phone) ? `+91 ${phone.slice(3)}` : phone;
}

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

const KIND_STYLE: Record<string, { icon: ProfileIconName; tone: string }> = {
  CALL_SESSION: { icon: 'consultation', tone: 'bg-amber-50 text-amber-600 ring-amber-100' },
  RECHARGE: { icon: 'wallet', tone: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
  PUJA_BOOKING: { icon: 'temple', tone: 'bg-rose-50 text-rose-500 ring-rose-100' },
  AYURVEDA_ORDER: { icon: 'bag', tone: 'bg-pink-50 text-pink-500 ring-pink-100' },
};

function titleOf(transaction: WalletTransaction): string {
  if (transaction.title) return transaction.title;
  if (transaction.referenceType === 'CALL_SESSION') return 'Consultation payment';
  if (transaction.referenceType === 'RECHARGE') return 'Wallet top up';
  return transaction.type === 'CREDIT' ? 'Credit' : 'Debit';
}

/** Balance with top-up, then the transaction history; the Wallet part of Profile. */
export function WalletSection() {
  const [balance, setBalance] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[] | null>(null);
  const [amount, setAmount] = useState('2000');
  const [custom, setCustom] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .get<{ balance: string; currency: string; transactions: WalletTransaction[] }>('wallet/transactions?limit=50')
      .then((result) => {
        setTransactions(result.transactions);
        setBalance(result.balance);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load your wallet'));
  }, []);

  useEffect(() => {
    load();
    void api
      .get<{ enabled: boolean }>('payments/config')
      .then((config) => setPaymentsEnabled(config.enabled))
      .catch(() => setPaymentsEnabled(false));
  }, [load]);

  useSocketEvent('BILLING_TICK', load);
  useSocketEvent('CALL_ENDED', load);

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
        name: 'Vedsutra',
        description: `Wallet top-up ₹${order.amount}`,
        prefill: { contact: session.profile?.phone ?? '' },
        theme: { color: '#0b4f45' },
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

  const validAmount = Number(amount) > 0;
  const rows = transactions ? (showAll ? transactions : transactions.slice(0, RECENT_ROWS)) : [];

  return (
    <>
      <section id="wallet" aria-labelledby="wallet-heading" className="profile-card scroll-mt-24">
        <h2 id="wallet-heading" className="profile-card-title">
          Wallet
        </h2>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#F6EFE2] text-ved-gold-600 ring-1 ring-ved-gold-400/20">
              <ProfileIcon name="wallet" className="h-7 w-7" />
            </span>
            <div>
              <p className="text-sm text-ved-green-800/65">Wallet Balance</p>
              <p className="tabular text-4xl font-bold tracking-tight text-ved-green-900">{balance === null ? '—' : inr(balance)}</p>
              <p className="mt-0.5 text-xs text-ved-green-800/55">Use your wallet for consultations, e-puja, shop orders and more.</p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-ved-green-800 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-ved-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || paymentsEnabled !== true || !validAmount}
            onClick={() => void topUp()}
          >
            <ProfileIcon name="plus" className="h-5 w-5" />
            {busy ? 'Opening payment…' : validAmount ? `Add ₹${INR_WHOLE.format(Number(amount))}` : 'Add Money'}
          </button>
        </div>

        <p className="mt-5 text-xs font-medium text-ved-green-800/70">Quick Add Amount</p>
        <div className="mt-2 flex flex-wrap gap-2.5">
          {PRESETS.map((preset) => {
            const active = !custom && amount === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCustom(false);
                  setAmount(preset);
                }}
                className={`min-w-[5.5rem] rounded-full px-5 py-2.5 text-sm font-semibold tabular transition ${
                  active ? 'bg-ved-green-700 text-white shadow-sm' : 'bg-[#F4EFE6] text-ved-green-900 hover:bg-[#EDE5D6]'
                }`}
              >
                ₹{INR_WHOLE.format(Number(preset))}
              </button>
            );
          })}
          {custom ? (
            <label className="flex items-center rounded-full bg-[#F4EFE6] px-4 ring-2 ring-ved-green-700">
              <span className="text-sm font-semibold text-ved-green-900">₹</span>
              <span className="sr-only">Other amount</span>
              <input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                className="w-24 bg-transparent py-2.5 pl-1 text-sm font-semibold tabular text-ved-green-900 outline-none"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCustom(true);
                setAmount('');
              }}
              className="rounded-full border border-dashed border-ved-green-900/20 px-5 py-2.5 text-sm font-medium text-ved-green-800/75 hover:bg-[#F4EFE6]"
            >
              Other
            </button>
          )}
        </div>

        {paymentsEnabled === false && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">Online top-ups are not available yet. Please check back soon.</p>
        )}
        {notice && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</p>}
        {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}
      </section>

      <section id="transactions" aria-labelledby="transactions-heading" className="profile-card scroll-mt-24">
        <div className="flex items-center justify-between gap-3">
          <h2 id="transactions-heading" className="profile-card-title">
            Transaction History
          </h2>
          {transactions && transactions.length > RECENT_ROWS && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="inline-flex items-center gap-1 text-sm font-semibold text-ved-green-900 hover:text-ved-green-600">
              {showAll ? 'Show less' : 'View All'} <ProfileIcon name="arrowRight" className="h-4 w-4" />
            </button>
          )}
        </div>

        {transactions === null && !error && <p className="mt-4 text-sm text-ved-green-800/60">Loading transactions…</p>}
        {transactions !== null && transactions.length === 0 && (
          <p className="mt-4 rounded-xl bg-ved-cream-100 px-4 py-3 text-sm text-ved-green-800/65">No transactions yet. Top-ups and payments will appear here.</p>
        )}

        {rows.length > 0 && (
          <div className="mt-4">
            <div className="hidden grid-cols-[12.5rem_minmax(0,1fr)_5.5rem_7rem_7rem] gap-3 rounded-xl bg-[#FAF7F1] px-3 py-2.5 text-xs font-medium text-ved-green-800/65 md:grid">
              <span>Date &amp; Time</span>
              <span>Description</span>
              <span>Type</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Balance</span>
            </div>
            <ul className="divide-y divide-ved-green-900/[0.06]">
              {rows.map((transaction) => {
                const credit = transaction.type === 'CREDIT';
                const style = KIND_STYLE[transaction.referenceType ?? ''] ?? { icon: credit ? 'refund' : 'wallet', tone: 'bg-slate-50 text-slate-500 ring-slate-100' };
                return (
                  <li
                    key={transaction.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-1 py-3 md:grid-cols-[12.5rem_minmax(0,1fr)_5.5rem_7rem_7rem] md:px-3"
                  >
                    <span className="order-3 col-span-2 flex items-center gap-2 text-xs text-ved-green-800/60 md:order-none md:col-span-1 md:whitespace-nowrap md:text-sm md:text-ved-green-800/80">
                      <ProfileIcon name="calendar" className="hidden h-4 w-4 text-sky-600 md:block" />
                      {formatDateTime(transaction.createdAt)}
                    </span>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ${style.tone}`}>
                        <ProfileIcon name={style.icon} className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ved-green-900">{titleOf(transaction)}</span>
                        {transaction.detail && <span className="block truncate text-xs text-ved-green-800/55">{transaction.detail}</span>}
                      </span>
                    </span>
                    <span className="hidden md:block">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${credit ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                        {credit ? 'Credit' : 'Debit'}
                      </span>
                    </span>
                    <span className={`text-right text-sm font-bold tabular ${credit ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {credit ? '+' : '−'}
                      {inr(transaction.amount)}
                    </span>
                    <span className="hidden text-right text-sm tabular text-ved-green-900 md:block">{inr(transaction.balanceAfter)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
