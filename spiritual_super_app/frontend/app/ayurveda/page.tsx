'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  api,
  session,
  type AyurvedaDosha,
  type AyurvedaOrder,
  type AyurvedaOrderResult,
  type AyurvedaProduct,
  type ProductCategory,
} from '@/lib/api';
import { useAuthGate } from '@/lib/auth-gate';
import { useSocketEvent } from '@/lib/socket';

type Tab = 'shop' | 'mine';
type DoshaFilter = 'ALL' | 'VATA' | 'PITTA' | 'KAPHA';

const STATUS_STEPS: AyurvedaOrder['status'][] = ['CONFIRMED', 'PACKED', 'DISPATCHED'];

export default function AyurvedaPage() {
  const { signedIn, requireLogin } = useAuthGate();
  const [tab, setTab] = useState<Tab>('shop');
  const [category, setCategory] = useState<ProductCategory>('AYURVEDA');
  const [ready, setReady] = useState(false);
  const wantedProduct = useRef<string | null>(null);
  const [dosha, setDosha] = useState<DoshaFilter>('ALL');
  const [products, setProducts] = useState<AyurvedaProduct[]>([]);
  const [orders, setOrders] = useState<AyurvedaOrder[]>([]);
  const [selection, setSelection] = useState<AyurvedaProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(() => {
    if (!signedIn) {
      setOrders([]);
      return;
    }
    void api
      .get<{ orders: AyurvedaOrder[] }>('ayurveda/shop/orders')
      .then((result) => setOrders(result.orders))
      .catch(() => undefined);
  }, [signedIn]);

  const loadProducts = useCallback((kind: ProductCategory, filter: DoshaFilter) => {
    setLoading(true);
    const params = new URLSearchParams({ category: kind });
    if (kind === 'AYURVEDA' && filter !== 'ALL') params.set('dosha', filter);
    void api
      .get<{ products: AyurvedaProduct[] }>(`ayurveda/shop/products?${params.toString()}`)
      .then((result) => {
        setProducts(result.products);
        if (wantedProduct.current) {
          const wanted = result.products.find((product) => product.id === wantedProduct.current);
          wantedProduct.current = null;
          if (wanted) setSelection(wanted);
        }
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the catalog'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('category')?.toUpperCase() === 'CRYSTAL') setCategory('CRYSTAL');
    wantedProduct.current = params.get('product');
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadProducts(category, dosha);
  }, [ready, category, dosha, loadProducts]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useSocketEvent<AyurvedaOrder>('AYURVEDA_ORDER_UPDATED', (updated) => {
    setOrders((current) => {
      const known = current.some((order) => order.id === updated.id);
      return known
        ? current.map((order) => (order.id === updated.id ? updated : order))
        : [updated, ...current];
    });
  });

  const pending = useMemo(
    () => orders.filter((order) => order.status !== 'DISPATCHED').length,
    [orders],
  );

  return (
    <div className="space-y-5">
      <div className="card bg-ved-green-50 border-ved-green-900/10">
        <h1 className="text-xl font-semibold">Vedsutra shop</h1>
        <p className="mt-1 text-sm text-ved-green-800/60">
          Dosha-tagged Ayurveda kits and churnas, and crystals — paid from your wallet.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl bg-ved-cream-200/80 p-1">
        <button
          type="button"
          onClick={() => setTab('shop')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
            tab === 'shop' ? 'bg-ved-green-100 text-white' : 'text-ved-green-800/60 hover:text-ved-green-900'
          }`}
        >
          Shop
        </button>
        <button
          type="button"
          onClick={() => setTab('mine')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
            tab === 'mine' ? 'bg-ved-green-100 text-white' : 'text-ved-green-800/60 hover:text-ved-green-900'
          }`}
        >
          My orders{pending > 0 ? ` (${pending})` : ''}
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {tab === 'shop' ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-xl bg-ved-cream-200/80 p-1" role="radiogroup" aria-label="Product category">
              {(['AYURVEDA', 'CRYSTAL'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={category === option}
                  onClick={() => setCategory(option)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                    category === option
                      ? 'bg-ved-green-800 text-white'
                      : 'text-ved-green-800/60 hover:text-ved-green-900'
                  }`}
                >
                  {option === 'AYURVEDA' ? 'Ayurveda' : 'Crystals'}
                </button>
              ))}
            </div>
            {category === 'AYURVEDA' && <DoshaChips value={dosha} onChange={setDosha} />}
          </div>
          {loading ? (
            <p className="text-sm text-ved-green-800/60">Loading…</p>
          ) : (
            <ProductGrid products={products} onSelect={setSelection} />
          )}
        </>
      ) : signedIn ? (
        <OrderList orders={orders} />
      ) : (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-ved-green-800/70">Log in to see and track your orders.</p>
          <button type="button" className="btn-primary" onClick={() => requireLogin('/ayurveda')}>
            Log in / Sign up
          </button>
        </div>
      )}

      {selection && (
        <CheckoutDialog
          product={selection}
          signedIn={signedIn}
          onLogin={() =>
            requireLogin(
              `/ayurveda?${selection.category === 'CRYSTAL' ? 'category=crystal&' : ''}product=${selection.id}`,
            )
          }
          onClose={() => setSelection(null)}
          onOrdered={() => {
            setSelection(null);
            loadOrders();
            setTab('mine');
          }}
        />
      )}
    </div>
  );
}

function DoshaChips({ value, onChange }: { value: DoshaFilter; onChange: (v: DoshaFilter) => void }) {
  const options: DoshaFilter[] = ['ALL', 'VATA', 'PITTA', 'KAPHA'];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-lg px-3 py-1.5 text-xs transition ${
            value === option ? 'bg-saffron-500/20 text-saffron-200' : 'bg-ved-cream-200/80 text-ved-green-800/60 hover:bg-ved-green-100'
          }`}
        >
          {option === 'ALL' ? 'All' : option.charAt(0) + option.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  );
}

function ProductGrid({
  products,
  onSelect,
}: {
  products: AyurvedaProduct[];
  onSelect: (product: AyurvedaProduct) => void;
}) {
  if (products.length === 0) {
    return <p className="text-sm text-ved-green-800/60">No products match this filter.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {products.map((product) => (
        <div key={product.id} className="card space-y-3">
          {product.imageUrl && (
            <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-ved-cream-200">
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 90vw, 45vw"
              />
            </div>
          )}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{product.name}</p>
              <p className="text-xs uppercase tracking-wide text-ved-green-800/50">{product.formFactor}</p>
            </div>
            <p className="tabular shrink-0 font-semibold">₹{product.price}</p>
          </div>
          {product.description && <p className="text-sm text-ved-green-800/60">{product.description}</p>}
          {product.suitedDoshas.length > 0 && (
            <p className="text-xs text-ved-green-800/50">
              Suited:{' '}
              {product.suitedDoshas.map((d: AyurvedaDosha) => d.charAt(0) + d.slice(1).toLowerCase()).join(', ')}
            </p>
          )}
          <button type="button" className="btn-primary w-full" onClick={() => onSelect(product)}>
            Order
          </button>
        </div>
      ))}
    </div>
  );
}

function OrderList({ orders }: { orders: AyurvedaOrder[] }) {
  if (orders.length === 0) {
    return <p className="text-sm text-ved-green-800/60">No orders yet.</p>;
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => (
        <div key={order.id} className="card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{order.productName}</p>
              <p className="text-xs text-ved-green-800/50">{order.productSku}</p>
            </div>
            <p className="tabular shrink-0 text-sm font-semibold">₹{order.unitPrice}</p>
          </div>
          <StatusTrail status={order.status} />
          {order.awb && (
            <p className="text-xs text-ved-green-800/60">
              {order.courier ?? 'Courier'} · AWB {order.awb}
            </p>
          )}
          <p className="text-[11px] text-ved-green-800/40">
            Ordered {new Date(order.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </p>
        </div>
      ))}
    </div>
  );
}

function StatusTrail({ status }: { status: AyurvedaOrder['status'] }) {
  const index = STATUS_STEPS.indexOf(status);
  return (
    <ol className="flex gap-1 text-[11px]">
      {STATUS_STEPS.map((step, i) => (
        <li
          key={step}
          className={`flex-1 rounded px-2 py-1 text-center ${
            i <= index ? 'bg-saffron-500/20 text-saffron-200' : 'bg-ved-cream-200/80 text-ved-green-800/50'
          }`}
        >
          {step.charAt(0) + step.slice(1).toLowerCase()}
        </li>
      ))}
    </ol>
  );
}

function CheckoutDialog({
  product,
  signedIn,
  onLogin,
  onClose,
  onOrdered,
}: {
  product: AyurvedaProduct;
  signedIn: boolean;
  /** Sends a guest to login, returning to this product's checkout. */
  onLogin: () => void;
  onClose: () => void;
  onOrdered: () => void;
}) {
  const profile = session.profile;
  const [shippingName, setShippingName] = useState(profile?.name ?? '');
  const [shippingPhone, setShippingPhone] = useState(profile?.phone ?? '');
  const [shippingAddress, setShippingAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AyurvedaOrderResult | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const confirm = async () => {
    if (shippingAddress.trim().length < 10) {
      setError('Enter a full shipping address');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ordered = await api.post<AyurvedaOrderResult>('ayurveda/shop/orders', {
        productId: product.id,
        shippingName: shippingName.trim(),
        shippingPhone: shippingPhone.trim(),
        shippingAddress: shippingAddress.trim(),
        idempotencyKey,
      });
      setResult(ordered);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        setError('Your wallet does not cover this item. Add money and try again.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not place the order');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
      <div className="card w-full max-w-md space-y-4">
        {result ? (
          <>
            <h2 className="text-lg font-semibold">Order confirmed</h2>
            <p className="text-sm text-ved-green-800/60">
              ₹{result.amountDebited} debited · wallet now ₹{result.walletBalanceAfter}
            </p>
            <button type="button" className="btn-primary w-full" onClick={onOrdered}>
              View my orders
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{product.name}</h2>
                <p className="tabular text-sm text-ved-green-800/60">₹{product.price}</p>
              </div>
              <button type="button" className="text-sm text-ved-green-800/60" onClick={onClose}>
                Close
              </button>
            </div>
            {!signedIn ? (
              <>
                {product.description && <p className="text-sm text-ved-green-800/70">{product.description}</p>}
                <p className="text-sm text-ved-green-800/60">
                  Log in or sign up to order — we&apos;ll bring you straight back to this checkout.
                </p>
                <button type="button" className="btn-primary w-full" onClick={onLogin}>
                  Log in / Sign up to order
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="label">Name</label>
                  <input className="input" value={shippingName} onChange={(e) => setShippingName(e.target.value)} />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={shippingPhone} onChange={(e) => setShippingPhone(e.target.value)} />
                </div>
                <div>
                  <label className="label">Shipping address</label>
                  <textarea
                    className="input min-h-[80px]"
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="House, street, city, PIN"
                  />
                </div>
                {error && <p className="text-sm text-rose-200">{error}</p>}
                <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void confirm()}>
                  {busy ? 'Placing…' : `Pay ₹${product.price} from wallet`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
