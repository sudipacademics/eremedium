'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, type AyurvedaDosha, type AyurvedaProduct } from '@/lib/api';

type AdminProduct = AyurvedaProduct & { active: boolean };

const DOSHAS: AyurvedaDosha[] = ['VATA', 'PITTA', 'KAPHA'];

export default function AdminAyurvedaPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    sku: '',
    name: '',
    description: '',
    price: '',
    formFactor: 'kit',
    suitedDoshas: ['VATA'] as AyurvedaDosha[],
  });

  const load = useCallback(() => {
    void api
      .get<{ products: AdminProduct[] }>('ayurveda/shop/admin/products')
      .then((res) => setProducts(res.products))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load products'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleDosha(dosha: AyurvedaDosha) {
    setForm((f) => ({
      ...f,
      suitedDoshas: f.suitedDoshas.includes(dosha)
        ? f.suitedDoshas.filter((d) => d !== dosha)
        : [...f.suitedDoshas, dosha],
    }));
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (form.suitedDoshas.length === 0) {
      setError('Pick at least one dosha');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('ayurveda/shop/admin/products', {
        sku: form.sku,
        name: form.name,
        description: form.description || null,
        price: form.price,
        formFactor: form.formFactor,
        suitedDoshas: form.suitedDoshas,
        active: true,
      });
      setForm({
        sku: '',
        name: '',
        description: '',
        price: '',
        formFactor: 'kit',
        suitedDoshas: ['VATA'],
      });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function savePrice(product: AdminProduct, price: string) {
    try {
      await api.patch(`ayurveda/shop/admin/products/${product.id}`, { price });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Price update failed');
    }
  }

  async function toggleActive(product: AdminProduct) {
    try {
      await api.patch(`ayurveda/shop/admin/products/${product.id}`, { active: !product.active });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed');
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}

      <form onSubmit={onCreate} className="card space-y-3">
        <h2 className="font-semibold">Add product</h2>
        <input
          className="input"
          placeholder="sku (kebab-case)"
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
          required
        />
        <input
          className="input"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <input
          className="input"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Price (e.g. 899.00)"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Form (kit / churna / oil)"
            value={form.formFactor}
            onChange={(e) => setForm((f) => ({ ...f, formFactor: e.target.value }))}
          />
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {DOSHAS.map((dosha) => (
            <label key={dosha} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.suitedDoshas.includes(dosha)}
                onChange={() => toggleDosha(dosha)}
              />
              {dosha}
            </label>
          ))}
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          Create product
        </button>
      </form>

      <div className="space-y-2">
        {products.map((product) => (
          <article
            key={product.id}
            className="card flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="font-medium">
                {product.name}{' '}
                <span className="text-xs text-slate-500">{product.sku}</span>
              </p>
              <p className="text-xs text-slate-400">
                {product.suitedDoshas.join(' · ')} · {product.formFactor} ·{' '}
                {product.active ? 'active' : 'hidden'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input w-28 py-1.5 text-sm"
                defaultValue={product.price}
                onBlur={(e) => {
                  if (e.target.value !== product.price) {
                    void savePrice(product, e.target.value);
                  }
                }}
              />
              <button type="button" className="btn-ghost text-xs" onClick={() => void toggleActive(product)}>
                {product.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </AdminGate>
  );
}
