'use client';

import { useCallback, useEffect, useState } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, type AyurvedaOrder, type AyurvedaOrderStatus } from '@/lib/api';

const NEXT: Partial<Record<AyurvedaOrderStatus, AyurvedaOrderStatus>> = {
  CONFIRMED: 'PACKED',
  PACKED: 'DISPATCHED',
};

const NEXT_LABEL: Partial<Record<AyurvedaOrderStatus, string>> = {
  CONFIRMED: 'Mark packed',
  PACKED: 'Mark dispatched',
};

export default function AdminAyurvedaOrdersPage() {
  const [orders, setOrders] = useState<AyurvedaOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ship, setShip] = useState<Record<string, { awb: string; courier: string }>>({});

  const load = useCallback(() => {
    void api
      .get<{ orders: AyurvedaOrder[] }>('ayurveda/shop/admin/fulfilment')
      .then((res) => setOrders(res.orders))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load orders'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function fields(id: string) {
    return ship[id] ?? { awb: '', courier: '' };
  }

  async function advance(order: AyurvedaOrder) {
    const next = NEXT[order.status];
    if (!next) return;
    const f = fields(order.id);
    setBusyId(order.id);
    setError(null);
    try {
      await api.post(`ayurveda/shop/admin/orders/${order.id}/advance`, {
        status: next,
        ...(next === 'DISPATCHED'
          ? { awb: f.awb, ...(f.courier ? { courier: f.courier } : {}) }
          : {}),
      });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Advance failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <p className="text-sm text-slate-400">
        Ayurveda fulfilment queue — confirmed → packed → dispatched (AWB required). Oldest first.
      </p>

      {orders.length === 0 ? (
        <p className="text-sm text-slate-500">No open orders.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const next = NEXT[o.status];
            const f = fields(o.id);
            const busy = busyId === o.id;
            return (
              <article key={o.id} className="card space-y-3 py-3">
                <div>
                  <p className="font-medium">
                    {o.productName}{' '}
                    <span className="text-sm font-normal text-saffron-300">· {o.status}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    SKU {o.productSku} · ₹{o.unitPrice} · {new Date(o.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm">
                    Ship to <strong>{o.shippingName}</strong> · {o.shippingPhone}
                  </p>
                  <p className="text-xs text-slate-400 whitespace-pre-wrap">{o.shippingAddress}</p>
                </div>

                {next === 'DISPATCHED' && (
                  <div className="flex flex-wrap gap-2">
                    <label className="grow text-xs text-slate-400">
                      AWB / tracking (required)
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                        value={f.awb}
                        onChange={(e) =>
                          setShip((prev) => ({
                            ...prev,
                            [o.id]: { ...fields(o.id), awb: e.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="grow text-xs text-slate-400">
                      Courier
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                        value={f.courier}
                        onChange={(e) =>
                          setShip((prev) => ({
                            ...prev,
                            [o.id]: { ...fields(o.id), courier: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                )}

                {next && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-saffron-500/90 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-saffron-400 disabled:opacity-50"
                    onClick={() => void advance(o)}
                  >
                    {NEXT_LABEL[o.status] ?? `Advance to ${next}`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </AdminGate>
  );
}
