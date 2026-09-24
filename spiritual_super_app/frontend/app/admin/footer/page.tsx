'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, type FooterSettings } from '@/lib/api';
import { primeFooterSettings } from '@/lib/footer';
import { SOCIAL_PLATFORMS } from '@/lib/social';

type LinkField = Exclude<keyof FooterSettings, 'updatedAt'>;

const APP_FIELDS: readonly { field: LinkField; label: string; placeholder: string }[] = [
  { field: 'appStoreUrl', label: 'App Store (apps.apple.com)', placeholder: 'https://apps.apple.com/in/app/vedsutra/id0000000000' },
  { field: 'playStoreUrl', label: 'Google Play (play.google.com)', placeholder: 'https://play.google.com/store/apps/details?id=in.vedsutra.app' },
];

const ALL_FIELDS: LinkField[] = [...SOCIAL_PLATFORMS.map((p) => p.field), ...APP_FIELDS.map((a) => a.field)];

function toForm(settings: FooterSettings): Record<LinkField, string> {
  return Object.fromEntries(ALL_FIELDS.map((field) => [field, settings[field] ?? ''])) as Record<LinkField, string>;
}

export default function AdminFooterPage() {
  const [form, setForm] = useState<Record<LinkField, string>>(
    () => Object.fromEntries(ALL_FIELDS.map((field) => [field, ''])) as Record<LinkField, string>,
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<FooterSettings>('content/footer')
      .then((settings) => {
        setForm(toForm(settings));
        setUpdatedAt(settings.updatedAt);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load footer settings'),
      );
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const body = Object.fromEntries(ALL_FIELDS.map((field) => [field, form[field].trim() || null]));
      const saved = await api.put<FooterSettings>('content/admin/footer', body);
      primeFooterSettings(saved);
      setForm(toForm(saved));
      setUpdatedAt(saved.updatedAt);
      setMessage('Footer links saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function input(field: LinkField, label: string, placeholder: string) {
    return (
      <label key={field} className="block">
        <span className="label">{label}</span>
        <input
          type="url"
          inputMode="url"
          className="input"
          value={form[field]}
          placeholder={placeholder}
          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
          maxLength={500}
        />
      </label>
    );
  }

  return (
    <AdminGate>
      <form onSubmit={onSubmit} className="card space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Footer links</h2>
          <p className="mt-1 text-sm text-slate-400">
            Links must be https and on the platform&apos;s own domain. Leave a field empty to hide it — Facebook,
            Instagram, YouTube and the app badges then show as &ldquo;coming soon&rdquo;.
            {updatedAt && ` Last saved ${new Date(updatedAt).toLocaleString('en-IN')}.`}
          </p>
        </div>
        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Social media</legend>
          {SOCIAL_PLATFORMS.map((p) => input(p.field, p.label, p.placeholder))}
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Download our app</legend>
          {APP_FIELDS.map((a) => input(a.field, a.label, a.placeholder))}
        </fieldset>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {message && <p className="text-sm text-emerald-300">{message}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save footer links'}
        </button>
      </form>
    </AdminGate>
  );
}
