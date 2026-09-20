'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, type SiteContent } from '@/lib/api';

export default function AdminHomePage() {
  const [form, setForm] = useState({
    heroEyebrow: '',
    heroTitle: '',
    heroSubtitle: '',
    heroImageUrl: '',
    promoQuote: '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<SiteContent>('content/home')
      .then((site) =>
        setForm({
          heroEyebrow: site.heroEyebrow,
          heroTitle: site.heroTitle,
          heroSubtitle: site.heroSubtitle,
          heroImageUrl: site.heroImageUrl ?? '',
          promoQuote: site.promoQuote ?? '',
        }),
      )
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load homepage content'),
      );
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await api.put<SiteContent>('content/admin/home', {
        heroEyebrow: form.heroEyebrow,
        heroTitle: form.heroTitle,
        heroSubtitle: form.heroSubtitle,
        heroImageUrl: form.heroImageUrl || null,
        promoQuote: form.promoQuote || null,
      });
      setMessage('Homepage saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminGate>
      <form onSubmit={onSubmit} className="card space-y-4">
        <h2 className="text-lg font-semibold">Homepage hero</h2>
        {(
          [
            ['heroEyebrow', 'Eyebrow', true],
            ['heroTitle', 'Title', true],
            ['heroSubtitle', 'Subtitle', true],
            ['heroImageUrl', 'Hero image URL (unsplash/pexels https only)', false],
            ['promoQuote', 'Promo quote', false],
          ] as const
        ).map(([key, label, required]) => (
          <label key={key} className="block">
            <span className="label">{label}</span>
            {key === 'heroSubtitle' ? (
              <textarea
                className="input min-h-[5rem]"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                required={required}
              />
            ) : (
              <input
                className="input"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                required={required}
              />
            )}
          </label>
        ))}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {message && <p className="text-sm text-emerald-300">{message}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save homepage'}
        </button>
      </form>
    </AdminGate>
  );
}
