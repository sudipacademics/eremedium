'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { api, type HomeStats } from '@/lib/api';
import { formatCount, formatRating } from '@/lib/stat-format';

type StatKey = Exclude<keyof HomeStats, 'updatedAt'>;

const FIELDS: readonly { key: StatKey; label: string; rating?: true }[] = [
  { key: 'happyUsers', label: 'Happy users' },
  { key: 'verifiedExperts', label: 'Verified experts' },
  { key: 'pujasPerformed', label: 'Pujas performed' },
  { key: 'authenticProducts', label: 'Authentic products' },
  { key: 'userRating', label: 'User rating (out of 5)', rating: true },
];

const EMPTY: Record<StatKey, string> = {
  happyUsers: '',
  verifiedExperts: '',
  pujasPerformed: '',
  authenticProducts: '',
  userRating: '',
};

function toForm(stats: HomeStats): Record<StatKey, string> {
  return Object.fromEntries(FIELDS.map(({ key }) => [key, String(stats[key])])) as Record<StatKey, string>;
}

function preview(field: (typeof FIELDS)[number], raw: string): string | null {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return null;
  return field.rating ? formatRating(value) : formatCount(value);
}

export function HomeStatsForm() {
  const [form, setForm] = useState(EMPTY);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<HomeStats>('content/home-stats')
      .then((stats) => {
        setForm(toForm(stats));
        setUpdatedAt(stats.updatedAt);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load statistics'));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const body = Object.fromEntries(FIELDS.map(({ key }) => [key, Number(form[key])]));
      const saved = await api.put<HomeStats>('content/admin/home-stats', body);
      setForm(toForm(saved));
      setUpdatedAt(saved.updatedAt);
      setMessage('Statistics saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Homepage statistics</h2>
        <p className="mt-1 text-sm text-slate-400">
          The figures the five stat cards count up to. Counts are shown rounded down, e.g. 52,300 as 52K+.
          {updatedAt && ` Last saved ${new Date(updatedAt).toLocaleString('en-IN')}.`}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="label">{field.label}</span>
            <input
              type="number"
              inputMode={field.rating ? 'decimal' : 'numeric'}
              className="input"
              min={0}
              max={field.rating ? 5 : 1_000_000_000}
              step={field.rating ? 0.1 : 1}
              value={form[field.key]}
              onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
              required
            />
            <span className="mt-1 block text-xs text-slate-400">Shows as {preview(field, form[field.key]) ?? '—'}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save statistics'}
      </button>
    </form>
  );
}
