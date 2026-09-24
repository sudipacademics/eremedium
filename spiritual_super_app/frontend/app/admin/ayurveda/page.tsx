'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, type AyurvedaDosha, type AyurvedaProduct, type ProductCategory } from '@/lib/api';

type AdminProduct = AyurvedaProduct & { active: boolean };

const DOSHAS: AyurvedaDosha[] = ['VATA', 'PITTA', 'KAPHA'];
const CATEGORY_LABEL: Record<ProductCategory, string> = { AYURVEDA: 'Ayurveda', CRYSTAL: 'Crystal' };

const EMPTY_FORM = {
  sku: '',
  name: '',
  description: '',
  price: '',
  formFactor: 'kit',
  imageUrl: '',
  suitedDoshas: ['VATA'] as AyurvedaDosha[],
};

export default function AdminAyurvedaPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ProductCategory>('AYURVEDA');
  const [form, setForm] = useState(EMPTY_FORM);

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
    if (category === 'AYURVEDA' && form.suitedDoshas.length === 0) {
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
        category,
        imageUrl: form.imageUrl.trim() || null,
        suitedDoshas: category === 'AYURVEDA' ? form.suitedDoshas : [],
        active: true,
      });
      setForm({ ...EMPTY_FORM, formFactor: category === 'CRYSTAL' ? 'tumbled' : 'kit' });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function patch(product: AdminProduct, body: Record<string, unknown>, failure: string) {
    try {
      await api.patch(`ayurveda/shop/admin/products/${product.id}`, body);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failure);
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}

      <form onSubmit={onCreate} className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Add product</h2>
          <div className="flex gap-1 rounded-lg bg-white/5 p-1 text-sm" role="radiogroup" aria-label="Category">
            {(Object.keys(CATEGORY_LABEL) as ProductCategory[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={category === option}
                onClick={() => {
                  setCategory(option);
                  setForm((f) => ({ ...f, formFactor: option === 'CRYSTAL' ? 'tumbled' : 'kit' }));
                }}
                className={`rounded-md px-3 py-1 ${category === option ? 'bg-white/15 text-white' : 'text-slate-400'}`}
              >
                {CATEGORY_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
        <input
          className="input"
          placeholder={category === 'CRYSTAL' ? 'sku (e.g. crystal-moonstone)' : 'sku (kebab-case)'}
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
            placeholder={category === 'CRYSTAL' ? 'Form (tumbled / raw / bracelet)' : 'Form (kit / churna / oil)'}
            value={form.formFactor}
            onChange={(e) => setForm((f) => ({ ...f, formFactor: e.target.value }))}
          />
        </div>
        <input
          className="input"
          placeholder="Image URL (https://images.unsplash.com/… or /shop/products/name.webp)"
          value={form.imageUrl}
          onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
        />
        {category === 'AYURVEDA' && (
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
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          Create {CATEGORY_LABEL[category].toLowerCase()} product
        </button>
      </form>

      <div className="space-y-2">
        {products.map((product) => (
          <article key={product.id} className="card flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/5 text-lg">
                  {product.category === 'CRYSTAL' ? '💎' : '🌿'}
                </span>
              )}
              <div className="min-w-0">
                <p className="font-medium">
                  {product.name} <span className="text-xs text-slate-500">{product.sku}</span>
                </p>
                <p className="text-xs text-slate-400">
                  {CATEGORY_LABEL[product.category]}
                  {product.suitedDoshas.length > 0 ? ` · ${product.suitedDoshas.join(' · ')}` : ''} ·{' '}
                  {product.formFactor} · {product.active ? 'active' : 'hidden'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input w-56 py-1.5 text-xs"
                placeholder="Image URL"
                aria-label={`Image URL for ${product.name}`}
                defaultValue={product.imageUrl ?? ''}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== (product.imageUrl ?? '')) {
                    void patch(product, { imageUrl: next || null }, 'Image update failed');
                  }
                }}
              />
              <input
                className="input w-28 py-1.5 text-sm"
                aria-label={`Price for ${product.name}`}
                defaultValue={product.price}
                onBlur={(e) => {
                  if (e.target.value !== product.price) {
                    void patch(product, { price: e.target.value }, 'Price update failed');
                  }
                }}
              />
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => void patch(product, { active: !product.active }, 'Update failed')}
              >
                {product.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </AdminGate>
  );
}
