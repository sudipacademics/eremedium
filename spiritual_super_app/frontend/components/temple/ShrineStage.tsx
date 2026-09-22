'use client';

import type { Deity, RitualFx } from './templeCatalog';

const PETALS = ['🌸', '🌺', '🌼', '💮', '🏵️'] as const;

export function ShrineStage({
  deity,
  activeFx,
  offeredCount,
  total,
}: {
  deity: Deity;
  activeFx: RitualFx | null;
  offeredCount: number;
  total: number;
}) {
  const showFlowers = activeFx === 'flowers' || activeFx === 'finale';
  const showWater =
    activeFx === 'water-feet' ||
    activeFx === 'water-pour' ||
    activeFx === 'sip' ||
    activeFx === 'abhishek';
  const showSmoke = activeFx === 'smoke';
  const showFlame = activeFx === 'flame' || activeFx === 'aarti' || activeFx === 'finale';
  const showSparkle = activeFx === 'sparkle' || activeFx === 'chandan';
  const showCloth = activeFx === 'cloth' || activeFx === 'drape';
  const showPrasad = activeFx === 'prasad' || activeFx === 'tambul';
  const glow = activeFx === 'glow' || activeFx === 'finale' || activeFx === 'aarti';

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-ved-gold-400/40 bg-gradient-to-b from-ved-green-950 via-ved-green-900 to-[#1a1208] shadow-xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(212,175,55,0.18),_transparent_65%)]" />
      {glow && (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_50%_40%,_rgba(255,220,120,0.35),_transparent_50%)]" />
      )}

      <div className="relative flex min-h-[22rem] flex-col items-center justify-end px-4 pb-8 pt-10 sm:min-h-[26rem]">
        {/* Murti */}
        <div
          className={`relative z-10 grid h-40 w-40 place-items-center rounded-full bg-gradient-to-br ${deity.accent} shadow-[0_0_60px_rgba(212,175,55,0.35)] ring-4 ring-ved-gold-400/50 sm:h-48 sm:w-48`}
        >
          <span className="font-display text-5xl text-cream-50 sm:text-6xl">
            {deity.glyph === 'flute' ? '♪' : deity.glyph}
          </span>
          {showCloth && (
            <div className="absolute -bottom-2 left-1/2 h-8 w-28 -translate-x-1/2 rounded-full bg-ved-gold-300/80 blur-[1px]" />
          )}
          {showSparkle && (
            <div className="pointer-events-none absolute inset-0 animate-pulse text-center text-xl text-ved-gold-200">
              ✦ · ✧ · ✦
            </div>
          )}
        </div>

        <p className="relative z-10 mt-5 font-display text-2xl font-semibold text-ved-gold-300">
          {deity.name}
        </p>
        <p className="relative z-10 text-xs tracking-wide text-cream-100/60">{deity.epithet}</p>
        <p className="relative z-10 mt-2 max-w-xs text-center text-sm italic text-cream-100/75">
          {deity.mantra}
        </p>

        {/* Altar base */}
        <div className="relative z-10 mt-6 w-full max-w-sm">
          <div className="h-3 rounded-full bg-gradient-to-r from-ved-gold-700 via-ved-gold-400 to-ved-gold-700 shadow-lg" />
          <div className="mx-auto mt-2 flex items-end justify-center gap-6">
            <Diya lit={showFlame || offeredCount > 0} aarti={activeFx === 'aarti'} />
            {showPrasad && <span className="mb-1 text-2xl">🍬</span>}
            <Diya lit={showFlame || offeredCount > 0} aarti={activeFx === 'aarti'} />
          </div>
        </div>

        {/* FX layers */}
        {showFlowers && <FlowerShower />}
        {showWater && <WaterRain heavy={activeFx === 'abhishek'} />}
        {showSmoke && <SmokePlume />}

        <p className="relative z-10 mt-6 text-xs text-cream-100/50">
          Offered {offeredCount} / {total} upacharas
        </p>
      </div>
    </div>
  );
}

function Diya({ lit, aarti }: { lit: boolean; aarti: boolean }) {
  return (
    <div className={`relative ${aarti ? 'animate-float' : ''}`}>
      <span className="text-2xl">🪔</span>
      {lit && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 animate-pulse text-sm text-amber-300">
          ✦
        </span>
      )}
    </div>
  );
}

function FlowerShower() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className="absolute animate-fade-up text-lg opacity-90"
          style={{
            left: `${6 + ((i * 17) % 88)}%`,
            top: `${-5 + (i % 5) * 4}%`,
            animationDelay: `${(i % 8) * 0.12}s`,
            animationDuration: `${1.4 + (i % 4) * 0.25}s`,
          }}
        >
          {PETALS[i % PETALS.length]}
        </span>
      ))}
    </div>
  );
}

function WaterRain({ heavy }: { heavy: boolean }) {
  const n = heavy ? 24 : 12;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="absolute h-4 w-0.5 animate-fade-up rounded-full bg-sky-200/70"
          style={{
            left: `${10 + ((i * 13) % 80)}%`,
            top: `${(i % 6) * 8}%`,
            animationDelay: `${(i % 6) * 0.08}s`,
            animationDuration: '0.9s',
          }}
        />
      ))}
    </div>
  );
}

function SmokePlume() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex justify-center">
      <div className="h-24 w-16 animate-float rounded-full bg-gradient-to-t from-cream-100/20 to-transparent blur-md" />
    </div>
  );
}
