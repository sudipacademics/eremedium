'use client';

import { useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api } from '@/lib/api';

interface HistoryResult {
  user: {
    id: string;
    phone: string;
    name: string;
    createdAt: string;
    walletBalance: string | null;
    walletCurrency: string | null;
    astrologerId: string | null;
    astrologerDisplayName: string | null;
    astrologerStatus: string | null;
  };
  bookings: Array<{
    id: string;
    status: string;
    pujaName: string;
    packagePrice: string;
    templeName: string;
    templeLocation: string;
    sankalpName: string;
    scheduledFor: string | null;
    performedAt: string | null;
    prasadAwb: string | null;
    prasadCourier: string | null;
    createdAt: string;
  }>;
  orders: Array<{
    id: string;
    status: string;
    productSku: string;
    productName: string;
    unitPrice: string;
    shippingName: string;
    shippingPhone: string;
    awb: string | null;
    courier: string | null;
    packedAt: string | null;
    dispatchedAt: string | null;
    createdAt: string;
  }>;
  calls: Array<{
    id: string;
    status: string;
    ratePerMinute: string;
    totalMinutes: number;
    totalDeducted: string;
    startTime: string | null;
    endTime: string | null;
    createdAt: string;
    astrologer: { id: string; displayName: string };
  }>;
  transactions: Array<{
    id: string;
    amount: string;
    type: string;
    referenceType: string;
    referenceId: string;
    balanceAfter: string;
    createdAt: string;
  }>;
}

export default function AdminHistoryPage() {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResult | null>(null);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      setError('Enter a phone number');
      return;
    }
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const result = await api.get<HistoryResult>(
        `admin/history?phone=${encodeURIComponent(trimmed)}`,
      );
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminGate>
      <p className="text-sm text-slate-400">
        Look up a devotee by E.164 phone (or 10-digit local). Shows bookings, shop orders, calls, and
        wallet ledger — including completed history.
      </p>

      <form onSubmit={(e) => void onSearch(e)} className="flex flex-wrap items-end gap-2">
        <label className="grow text-xs text-slate-400">
          Phone
          <input
            type="tel"
            inputMode="tel"
            placeholder="+9198… or 98…"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-saffron-500/90 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-saffron-400 disabled:opacity-50"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      {data && (
        <div className="space-y-6">
          <section className="card space-y-1 py-3">
            <p className="font-medium">
              {data.user.name} · {data.user.phone}
            </p>
            <p className="text-sm text-slate-400">
              Wallet{' '}
              {data.user.walletBalance != null
                ? `₹${data.user.walletBalance} ${data.user.walletCurrency ?? ''}`
                : '—'}
              {data.user.astrologerDisplayName
                ? ` · also astrologer “${data.user.astrologerDisplayName}” (${data.user.astrologerStatus})`
                : ''}
            </p>
            <p className="font-mono text-[11px] text-slate-500">
              {data.user.id} · joined {new Date(data.user.createdAt).toLocaleString()}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">E-Puja bookings ({data.bookings.length})</h2>
            {data.bookings.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              data.bookings.map((b) => (
                <article key={b.id} className="card space-y-1 py-3">
                  <p className="font-medium">
                    {b.pujaName}{' '}
                    <span className="text-sm font-normal text-saffron-300">· {b.status}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {b.templeName} · ₹{b.packagePrice} · sankalp {b.sankalpName} ·{' '}
                    {new Date(b.createdAt).toLocaleString()}
                  </p>
                  {b.prasadAwb ? (
                    <p className="text-xs text-slate-400">
                      AWB {b.prasadAwb}
                      {b.prasadCourier ? ` · ${b.prasadCourier}` : ''}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Ayurveda orders ({data.orders.length})</h2>
            {data.orders.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              data.orders.map((o) => (
                <article key={o.id} className="card space-y-1 py-3">
                  <p className="font-medium">
                    {o.productName}{' '}
                    <span className="text-sm font-normal text-saffron-300">· {o.status}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {o.productSku} · ₹{o.unitPrice} · {o.shippingName} ·{' '}
                    {new Date(o.createdAt).toLocaleString()}
                  </p>
                  {o.awb ? (
                    <p className="text-xs text-slate-400">
                      AWB {o.awb}
                      {o.courier ? ` · ${o.courier}` : ''}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Calls ({data.calls.length})</h2>
            {data.calls.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              data.calls.map((c) => (
                <article key={c.id} className="card space-y-1 py-3">
                  <p className="font-medium">
                    {c.astrologer.displayName}{' '}
                    <span className="text-sm font-normal text-saffron-300">· {c.status}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    ₹{c.ratePerMinute}/min · {c.totalMinutes} min · deducted ₹{c.totalDeducted} ·{' '}
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </article>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Wallet ledger ({data.transactions.length})</h2>
            {data.transactions.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2 pr-3">Ref</th>
                      <th className="py-2">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t) => (
                      <tr key={t.id} className="border-t border-white/5">
                        <td className="py-2 pr-3 text-xs text-slate-400">
                          {new Date(t.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">{t.type}</td>
                        <td className="py-2 pr-3">₹{t.amount}</td>
                        <td className="py-2 pr-3 text-xs">
                          {t.referenceType}
                          <span className="block font-mono text-[10px] text-slate-500">
                            {t.referenceId.slice(0, 8)}…
                          </span>
                        </td>
                        <td className="py-2">₹{t.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </AdminGate>
  );
}
