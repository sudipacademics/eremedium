'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { SiteFooter } from '@/components/SiteFooter';
import { session } from '@/lib/api';

import { ShrineStage } from './ShrineStage';
import { UpacharaTray } from './UpacharaTray';
import { DEITIES, UPACHARAS, deityById, type Deity, type RitualFx, type Upachara } from './templeCatalog';
import { useRitualAudio } from './useRitualAudio';

const STORAGE_PREFIX = 'ssa.virtualTemple.';
const PETALS = ['🌸', '🌼', '🌺', '🪷', '🏵️'] as const;

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

const QUICK = [
  { id: 'ghanta', label: 'Ring the ghanta', short: 'Ghanta', icon: '🔔' },
  { id: 'conch', label: 'Blow the shankh', short: 'Shankh', icon: '🐚' },
  { id: 'jal', label: 'Offer jal', short: 'Jal', icon: '💧' },
] as const;

export function TemplePage() {
  const userId = session.profile?.userId ?? 'guest';
  const { play } = useRitualAudio();

  const [deity, setDeity] = useState<Deity>(DEITIES[0]!);
  const [offered, setOffered] = useState<Set<string>>(() => new Set());
  const [activeFx, setActiveFx] = useState<RitualFx | null>(null);
  const [petalBurst, setPetalBurst] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadState(userId);
    const d = saved?.deityId ? deityById(saved.deityId) : undefined;
    if (d) {
      setDeity(d);
      setOffered(new Set(saved?.offeredIds ?? []));
    }
    setHydrated(true);
  }, [userId]);

  useEffect(() => {
    if (!hydrated) return;
    saveState(userId, { deityId: deity.id, offeredIds: [...offered] });
  }, [hydrated, userId, deity, offered]);

  const triggerFx = useCallback((fx: RitualFx, ms = 1600) => {
    setActiveFx(fx);
    if (fx === 'flowers' || fx === 'finale') setPetalBurst((n) => n + 1);
    window.setTimeout(() => setActiveFx((cur) => (cur === fx ? null : cur)), ms);
  }, []);

  const chooseDeity = (d: Deity) => {
    if (d.id === deity.id) return;
    setDeity(d);
    setOffered(new Set());
    setActiveFx(null);
    play('chime');
  };

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

  const offerFlowers = () => {
    play('chime');
    triggerFx('flowers', 1800);
  };

  const quick = (kind: (typeof QUICK)[number]['id']) => {
    if (kind === 'ghanta') {
      play('ghanta');
      triggerFx('glow', 1200);
    } else if (kind === 'conch') {
      play('conch');
      triggerFx('glow', 1000);
    } else {
      play('water');
      triggerFx('abhishek', 1400);
    }
  };

  if (!hydrated) {
    return (
      <div className="grid min-h-[60vh] place-items-center bg-[#F7F4EE] text-sm text-ved-green-800/60">
        Preparing your mandir…
      </div>
    );
  }

  return (
    <div className="bg-[#F7F4EE] bg-[radial-gradient(ellipse_at_top,_rgba(201,166,74,0.14),_transparent_60%)]">
      <PetalRain burst={petalBurst} />

      <div className="mx-auto max-w-7xl px-4 py-8 lg:py-10">
        <div className="mb-6 text-center lg:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ved-gold-600">Vedsutra Mandir</p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-ved-green-900 sm:text-4xl">
            Your virtual home temple
          </h1>
          <p className="mt-1 text-sm text-ved-green-800/60">
            Choose a deity for darshan, light the diyas and offer the sixteen upacharas.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="overflow-hidden rounded-3xl border border-ved-gold-500/40 bg-gradient-to-b from-ved-green-900 to-ved-green-950 text-ved-cream-50 shadow-xl lg:sticky lg:top-24 lg:self-start">
            <div className="border-b border-ved-gold-500/25 px-5 py-4 text-center">
              <p className="font-display text-2xl font-semibold text-ved-gold-300">Devalaya</p>
              <p className="text-[10px] uppercase tracking-[0.25em] text-ved-cream-100/60">Select your deity</p>
            </div>

            <nav
              aria-label="Deities"
              className="flex gap-2 overflow-x-auto p-3 lg:max-h-[52vh] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible"
            >
              {DEITIES.map((d) => {
                const active = d.id === deity.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => chooseDeity(d)}
                    className={`flex shrink-0 items-center gap-3 rounded-2xl border px-3 py-2 text-left transition lg:w-full ${
                      active
                        ? 'border-ved-gold-400/70 bg-gradient-to-r from-ved-gold-500/30 to-transparent text-ved-gold-100 shadow-[inset_4px_0_0_#c9a64a]'
                        : 'border-transparent text-ved-cream-50/85 hover:border-ved-gold-500/30 hover:bg-white/5'
                    }`}
                  >
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-ved-gold-400/60 bg-black/30">
                      <Image src={d.image} alt="" fill sizes="40px" className="object-cover object-top" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display text-lg font-semibold leading-tight">{d.name}</span>
                      <span className="block truncate text-[10px] text-ved-cream-100/55 lg:max-w-[160px]">
                        {d.symbol} {d.epithet}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="space-y-2 border-t border-ved-gold-500/25 p-4">
              <button
                type="button"
                disabled={busy}
                onClick={offerFlowers}
                className="w-full rounded-full bg-gradient-to-r from-ved-gold-400 via-ved-gold-300 to-ved-gold-400 py-2.5 font-display text-lg font-semibold text-ved-green-950 shadow-[0_0_15px_rgba(201,166,74,0.35)] transition hover:shadow-[0_0_22px_rgba(201,166,74,0.55)] disabled:opacity-50"
              >
                Offer flowers 🌸
              </button>
              <div className="grid grid-cols-3 gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={busy}
                    onClick={() => quick(q.id)}
                    title={q.label}
                    className="flex flex-col items-center gap-0.5 rounded-xl border border-ved-gold-500/30 bg-white/5 py-2 text-[10px] font-medium text-ved-cream-100/80 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    <span className="text-lg">{q.icon}</span>
                    {q.short}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="min-w-0 space-y-8">
            <div className="rounded-[2rem] border border-ved-gold-500/25 bg-gradient-to-b from-[#FBF7EE] to-[#EFE7D6] px-2 pb-8 pt-20 shadow-sm sm:px-6">
              <ShrineStage deity={deity} activeFx={activeFx} offeredCount={offered.size} total={UPACHARAS.length} />
            </div>

            <div className="card">
              <UpacharaTray
                offered={offered}
                busy={busy}
                onOffer={offerOne}
                onOfferAll={() => void offerAll()}
                onReset={reset}
              />
            </div>

            <p className="text-center text-xs text-ved-green-800/50">
              Virtual offerings are free for darshan. For temple-fulfilled E-Puja with prasad, visit{' '}
              <a href="/pujas" className="font-semibold text-ved-gold-600 hover:underline">
                E-Puja
              </a>
              . Deity images:{' '}
              <a
                href="https://commons.wikimedia.org"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted"
              >
                Wikimedia Commons
              </a>
              .
            </p>
          </section>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

/** Petals falling across the whole viewport, like flowers showered from above the shrine. */
function PetalRain({ burst }: { burst: number }) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!burst) return;
    setVisible(burst);
    const timer = window.setTimeout(() => setVisible((v) => (v === burst ? 0 : v)), 7000);
    return () => window.clearTimeout(timer);
  }, [burst]);

  const petals = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        id: `${burst}-${i}`,
        glyph: PETALS[i % PETALS.length],
        left: Math.random() * 100,
        size: 1 + Math.random() * 1.2,
        duration: 3 + Math.random() * 3,
        delay: i * 0.08,
      })),
    [burst],
  );

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {petals.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 motion-safe:animate-fall"
          style={{
            left: `${p.left}%`,
            fontSize: `${p.size * 1.4}rem`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            opacity: 0,
            animationFillMode: 'both',
          }}
        >
          {p.glyph}
        </span>
      ))}
    </div>
  );
}
