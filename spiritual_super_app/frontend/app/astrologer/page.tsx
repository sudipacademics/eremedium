'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, session as store } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

interface Earnings {
  commissionSplit: string;
  billedMinutes: number;
  grossEarned: string;
  netEarned: string;
  platformFee: string;
  recent: { callSessionId: string; minute: number; gross: string; net: string; at: string }[];
}

interface Me {
  id: string;
  displayName: string;
  perMinuteRate: string;
  status: 'IDLE' | 'BUSY' | 'IN_CALL' | 'OFFLINE';
  languages: string[];
}

export default function AstrologerConsolePage() {
  const router = useRouter();
  const profile = store.profile;
  const [me, setMe] = useState<Me | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [applyName, setApplyName] = useState(profile?.name ?? '');
  const [languages, setLanguages] = useState('Hindi, English');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!store.profile?.astrologerId) return;
    void api
      .get<{ astrologers: Me[] }>('astrologers?onlineOnly=false&limit=100')
      .then((list) => setMe(list.astrologers.find((row) => row.id === store.profile?.astrologerId) ?? null))
      .catch(() => undefined);
    void api
      .get<Earnings>('astrologers/me/earnings')
      .then(setEarnings)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  // A waiting user was matched to us: the session already exists and we are reserved.
  useSocketEvent<{ callSessionId: string }>('CALL_READY', (payload) => {
    router.push(`/call/${payload.callSessionId}`);
  });
  useSocketEvent('CALL_ENDED', load);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('astrologers/apply', {
        displayName: applyName.trim(),
        languages: languages
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setNotice('Profile created. Sign in again to pick up your astrologer role, then go online.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not apply');
    } finally {
      setBusy(false);
    }
  };

  const setAvailability = async (online: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.patch<{ status: Me['status'] }>('astrologers/me/availability', { online });
      setMe((current) => (current ? { ...current, status: result.status } : current));
      setNotice(
        online
          ? 'You are online. Keep this tab open — you are matched only while connected.'
          : 'You are offline. Anyone waiting has been released.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change availability');
    } finally {
      setBusy(false);
    }
  };

  if (!profile?.astrologerId) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="card space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Become an astrologer</h1>
            <p className="mt-1 text-sm text-slate-400">
              Your per-minute rate is set by the platform, not here.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="displayName">
              Display name
            </label>
            <input
              id="displayName"
              className="input"
              value={applyName}
              onChange={(event) => setApplyName(event.target.value)}
              placeholder="Pandit Sharma"
            />
          </div>

          <div>
            <label className="label" htmlFor="languages">
              Languages (comma separated)
            </label>
            <input
              id="languages"
              className="input"
              value={languages}
              onChange={(event) => setLanguages(event.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || applyName.trim().length < 2}
            onClick={() => void apply()}
          >
            {busy ? 'Submitting…' : 'Create profile'}
          </button>

          {notice && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{notice}</p>
          )}
          {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        </div>
      </div>
    );
  }

  const online = me?.status === 'IDLE';

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{me?.displayName ?? 'My console'}</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              ₹{me?.perMinuteRate ?? '—'} per minute
              {earnings && ` · you keep ${(Number(earnings.commissionSplit) * 100).toFixed(0)}%`}
            </p>
          </div>

          <button
            type="button"
            className={online ? 'btn-ghost' : 'btn-primary'}
            disabled={busy || me?.status === 'IN_CALL'}
            onClick={() => void setAvailability(!online)}
          >
            {me?.status === 'IN_CALL' ? 'On a call' : online ? 'Go offline' : 'Go online'}
          </button>
        </div>

        {online && (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            Waiting for consultations. You are matched only while this tab stays open.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-slate-400">Your earnings</p>
          <p className="tabular mt-1 text-2xl font-semibold">₹{earnings?.netEarned ?? '0.00'}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-slate-400">Billed minutes</p>
          <p className="tabular mt-1 text-2xl font-semibold">{earnings?.billedMinutes ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-slate-400">Platform fee</p>
          <p className="tabular mt-1 text-2xl font-semibold">₹{earnings?.platformFee ?? '0.00'}</p>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">Recent billed minutes</h2>
        {!earnings || earnings.recent.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {earnings.recent.map((row) => (
              <li key={`${row.callSessionId}:${row.minute}`} className="flex justify-between py-2 text-sm">
                <span className="text-slate-400">
                  Minute {row.minute} · {new Date(row.at).toLocaleTimeString()}
                </span>
                <span className="tabular">
                  <span className="text-slate-500">₹{row.gross}</span>{' '}
                  <span className="font-medium text-emerald-300">₹{row.net}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {notice && (
        <p className="card border-emerald-400/20 bg-emerald-500/10 text-sm text-emerald-100">{notice}</p>
      )}
      {error && <p className="card border-rose-400/20 bg-rose-500/10 text-sm text-rose-200">{error}</p>}
    </div>
  );
}
