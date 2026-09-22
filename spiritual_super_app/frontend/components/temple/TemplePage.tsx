'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { session } from '@/lib/api';

import { ShrineStage } from './ShrineStage';
import { UpacharaTray } from './UpacharaTray';
import {
  DEITIES,
  UPACHARAS,
  deityById,
  type Deity,
  type RitualFx,
  type Upachara,
} from './templeCatalog';
import { useRitualAudio } from './useRitualAudio';

const STORAGE_PREFIX = 'ssa.virtualTemple.';

interface TempleState {
  deityId: string;
  offeredIds: string[];
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function loadState(userId: string): TempleState | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as TempleState;
  } catch {
    return null;
  }
}

function saveState(userId: string, state: TempleState) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

export function TemplePage() {
  const profile = session.profile;
  const userId = profile?.userId ?? 'guest';
  const { play } = useRitualAudio();

  const [deity, setDeity] = useState<Deity | null>(null);
  const [offered, setOffered] = useState<Set<string>>(() => new Set());
  const [activeFx, setActiveFx] = useState<RitualFx | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadState(userId);
    if (saved?.deityId) {
      const d = deityById(saved.deityId);
      if (d) setDeity(d);
      setOffered(new Set(saved.offeredIds ?? []));
    }
    setHydrated(true);
  }, [userId]);

  useEffect(() => {
    if (!hydrated || !deity) return;
    saveState(userId, { deityId: deity.id, offeredIds: [...offered] });
  }, [hydrated, userId, deity, offered]);

  const triggerFx = useCallback((fx: RitualFx, ms = 1600) => {
    setActiveFx(fx);
    window.setTimeout(() => setActiveFx((cur) => (cur === fx ? null : cur)), ms);
  }, []);

  const offerOne = useCallback(
    (u: Upachara) => {
      play(u.sound);
      triggerFx(u.fx);
      setOffered((prev) => new Set(prev).add(u.id));
    },
    [play, triggerFx],
  );

  const offerAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    for (const u of UPACHARAS) {
      play(u.sound);
      triggerFx(u.fx, 900);
      setOffered((prev) => new Set(prev).add(u.id));
      await new Promise((r) => setTimeout(r, 700));
    }
    setBusy(false);
  }, [busy, play, triggerFx]);

  const reset = useCallback(() => {
    setOffered(new Set());
    setActiveFx(null);
  }, []);

  const quick = useCallback(
    (kind: 'ghanta' | 'conch' | 'flowers' | 'jal') => {
      if (kind === 'ghanta') {
        play('ghanta');
        triggerFx('finale', 1200);
      } else if (kind === 'conch') {
        play('conch');
        triggerFx('glow', 1000);
      } else if (kind === 'flowers') {
        play('chime');
        triggerFx('flowers', 1800);
      } else {
        play('water');
        triggerFx('abhishek', 1400);
      }
    },
    [play, triggerFx],
  );

  const offeredCount = offered.size;

  const picker = useMemo(
    () => (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ved-gold-600">
            Virtual Temple
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-ved-green-900 sm:text-4xl">
            Build your sacred shrine
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-ved-green-800/65">
            Choose a deity, then offer the classic sixteen upacharas — flower shower, jal, ghanta,
            deepam, and more.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEITIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setDeity(d);
                setOffered(new Set());
              }}
              className="rounded-2xl border border-ved-green-900/10 bg-white p-5 text-left shadow-sm transition hover:border-ved-gold-400/50 hover:shadow-md"
            >
              <div
                className={`grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br ${d.accent} font-display text-2xl text-cream-50`}
              >
                {d.glyph === 'flute' ? '♪' : d.glyph}
              </div>
              <p className="mt-3 font-display text-xl font-semibold text-ved-green-900">{d.name}</p>
              <p className="text-xs text-ved-green-800/55">{d.epithet}</p>
              <p className="mt-2 text-xs italic text-ved-gold-600">{d.mantra}</p>
            </button>
          ))}
        </div>
      </div>
    ),
    [],
  );

  if (!hydrated) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-sm text-ved-green-800/60">
        Preparing your shrine…
      </div>
    );
  }

  if (!deity) return picker;

  return (
    <div className="bg-[#F7F4EE] pb-16">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ved-gold-600">
              Your Virtual Temple
            </p>
            <h1 className="font-display text-2xl font-semibold text-ved-green-900 sm:text-3xl">
              Darshan of {deity.name}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => {
              setDeity(null);
              setOffered(new Set());
              setActiveFx(null);
            }}
            className="rounded-full border border-ved-green-900/15 bg-white px-4 py-2 text-xs font-semibold text-ved-green-800"
          >
            Change deity
          </button>
        </div>

        <ShrineStage
          deity={deity}
          activeFx={activeFx}
          offeredCount={offeredCount}
          total={UPACHARAS.length}
        />

        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'ghanta', label: 'Ghanta', icon: '🔔' },
              { id: 'conch', label: 'Conch', icon: '🐚' },
              { id: 'flowers', label: 'Flower shower', icon: '🌸' },
              { id: 'jal', label: 'Jal', icon: '💧' },
            ] as const
          ).map((q) => (
            <button
              key={q.id}
              type="button"
              disabled={busy}
              onClick={() => quick(q.id)}
              className="inline-flex items-center gap-2 rounded-full border border-ved-gold-400/40 bg-ved-gold-50 px-4 py-2 text-xs font-semibold text-ved-green-900 hover:bg-ved-gold-100 disabled:opacity-40"
            >
              <span>{q.icon}</span>
              {q.label}
            </button>
          ))}
        </div>

        <UpacharaTray
          offered={offered}
          busy={busy}
          onOffer={offerOne}
          onOfferAll={() => void offerAll()}
          onReset={reset}
        />

        <p className="text-center text-xs text-ved-green-800/50">
          Virtual offerings are free for darshan. For temple-fulfilled E-Puja with prasad, visit{' '}
          <a href="/pujas" className="font-semibold text-ved-gold-600 hover:underline">
            E-Puja
          </a>
          .
        </p>
      </div>
    </div>
  );
}
