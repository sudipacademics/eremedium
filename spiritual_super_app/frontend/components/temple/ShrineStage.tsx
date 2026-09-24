'use client';

import Image from 'next/image';
import type { CSSProperties } from 'react';

import type { Deity, RitualFx } from './templeCatalog';

/** Deep Vedsutra-green lacquer, carved and lit from the centre like polished teak. */
const LACQUER: CSSProperties = {
  background: 'linear-gradient(90deg, #031814 0%, #07332c 20%, #0d5c4d 50%, #07332c 80%, #031814 100%)',
  boxShadow: 'inset 0 0 20px rgba(0,0,0,0.7), 0 10px 30px rgba(3,24,20,0.45)',
};

const GOLD_TRIM: CSSProperties = {
  background: 'linear-gradient(to bottom, #f5e3a3, #c9a64a, #8f6e28, #c9a64a)',
  boxShadow: '0 0 10px rgba(201,166,74,0.45)',
};

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
  const showWater =
    activeFx === 'water-feet' || activeFx === 'water-pour' || activeFx === 'sip' || activeFx === 'abhishek';
  const showSmoke = activeFx === 'smoke';
  const aarti = activeFx === 'aarti' || activeFx === 'flame' || activeFx === 'finale';
  const showSparkle = activeFx === 'sparkle' || activeFx === 'chandan';
  const showCloth = activeFx === 'cloth' || activeFx === 'drape';
  const showPrasad = activeFx === 'prasad' || activeFx === 'tambul';
  const glow = activeFx === 'glow' || activeFx === 'finale' || activeFx === 'aarti';

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center">
      {/* Shikhara with kalash and dhwaja */}
      <div className="relative z-10 flex h-20 w-1/2 justify-center sm:h-28">
        <div className="relative h-full w-full rounded-t-full border-t-4 border-ved-gold-500" style={LACQUER}>
          <div className="absolute inset-x-[12%] bottom-0 top-[18%] rounded-t-full border-2 border-b-0 border-ved-gold-400/40" />
          <div className="absolute left-1/2 top-[42%] -translate-x-1/2 font-display text-2xl text-ved-gold-300/80 sm:text-3xl">
            ॐ
          </div>
        </div>
        <div className="absolute -top-9 left-1/2 flex -translate-x-1/2 flex-col items-center">
          <div className="h-3 w-2 rounded-t-full" style={GOLD_TRIM} />
          <div className="-mt-1 h-5 w-5 rounded-full shadow-[0_0_15px_#c9a64a]" style={GOLD_TRIM} />
          <div className="-mt-1 h-3 w-7 rounded-b-full" style={GOLD_TRIM} />
        </div>
        <div className="absolute -top-16 left-[calc(50%+2px)] h-8 w-0.5 bg-ved-gold-600">
          <div className="absolute left-0.5 top-0 h-0 w-0 border-y-[7px] border-l-[18px] border-y-transparent border-l-[#e8671b] motion-safe:animate-swing" />
        </div>
      </div>

      {/* Toran arch with bells and marigold garland */}
      <div className="relative z-20 -mt-1 h-20 w-[92%] sm:h-28 sm:w-[84%]">
        <div
          className="relative h-full w-full rounded-t-[48px] border-t-4 border-ved-gold-500 sm:rounded-t-[88px]"
          style={LACQUER}
        >
          <div className="absolute inset-x-6 bottom-0 top-4 rounded-t-[36px] border-2 border-b-0 border-ved-gold-400/35 sm:inset-x-10 sm:top-5 sm:rounded-t-[72px]" />
          <Garland />
          <Bell className="left-[14%]" chain="h-10" delay="0s" />
          <Bell className="left-1/2 -translate-x-1/2" chain="h-7" delay="0.5s" />
          <Bell className="right-[14%]" chain="h-10" delay="1s" />
        </div>
      </div>

      {/* Pillars and garbhagriha */}
      <div className="relative z-0 -mt-2 flex w-[92%] sm:w-[84%]">
        <Pillar side="left" />

        <div
          className="relative flex min-h-[26rem] flex-1 items-center justify-center overflow-hidden border-x-4 border-black/40 transition-[background] duration-1000 sm:min-h-[32rem]"
          style={{
            background: `radial-gradient(circle at 50% 42%, ${deity.glow} 0%, #0a0503 72%)`,
            boxShadow: 'inset 0 0 50px rgba(0,0,0,0.9)',
          }}
        >
          <svg
            className="pointer-events-none absolute h-[150%] w-[150%] opacity-25 motion-safe:animate-spin-slow"
            viewBox="0 0 100 100"
            style={{ color: deity.halo }}
            aria-hidden
          >
            <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="50" cy="50" r="25" fill="none" stroke="currentColor" strokeWidth="0.3" strokeDasharray="1 1.5" />
            {Array.from({ length: 16 }).map((_, i) => (
              <ellipse
                key={i}
                cx="50"
                cy="20"
                rx="4"
                ry="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.35"
                transform={`rotate(${i * 22.5} 50 50)`}
              />
            ))}
          </svg>

          {glow && (
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,_rgba(255,220,120,0.35),_transparent_55%)] motion-safe:animate-pulse" />
          )}

          <div key={deity.id} className="relative z-10 flex flex-col items-center px-4 py-6 motion-safe:animate-fade-up">
            <div className="relative">
              <div
                className="absolute -inset-5 rounded-t-full opacity-70 blur-xl"
                style={{ background: `radial-gradient(circle, ${deity.halo}88 0%, transparent 70%)` }}
              />
              <div className="relative h-56 w-44 overflow-hidden rounded-t-full border-4 border-ved-gold-400 bg-black/40 shadow-[0_0_40px_rgba(201,166,74,0.35)] sm:h-72 sm:w-56">
                <Image
                  src={deity.image}
                  alt={`${deity.name} murti`}
                  fill
                  sizes="(min-width: 640px) 224px, 176px"
                  className="object-cover object-top transition-transform duration-500 hover:scale-105"
                  priority
                />
                {showCloth && (
                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-ved-gold-300/80 to-transparent" />
                )}
                {showSparkle && (
                  <div className="absolute inset-0 grid place-items-center text-2xl text-ved-gold-100 motion-safe:animate-pulse">
                    ✦ ✧ ✦
                  </div>
                )}
              </div>
              <div className="absolute -bottom-2 left-1/2 h-3 w-[110%] -translate-x-1/2 rounded-full" style={GOLD_TRIM} />
            </div>

            <h2 className="mt-6 bg-gradient-to-b from-ved-gold-100 to-ved-gold-400 bg-clip-text text-center font-display text-3xl font-semibold text-transparent drop-shadow sm:text-4xl">
              {deity.name}
            </h2>
            <p className="mt-1 text-center text-[11px] uppercase tracking-[0.2em] text-ved-gold-300/80">{deity.epithet}</p>
            <p lang="sa" className="mt-3 text-center text-lg text-ved-cream-100 sm:text-xl">
              {deity.mantraDevanagari}
            </p>
            <p className="text-center text-xs text-ved-cream-100/60">{deity.mantra}</p>
          </div>

          {showWater && <WaterRain heavy={activeFx === 'abhishek'} />}
          {showSmoke && <SmokePlume />}
        </div>

        <Pillar side="right" />
      </div>

      {/* Peetham */}
      <div className="relative z-20 flex w-[96%] flex-col items-center sm:w-[88%]">
        <div className="h-5 w-[94%] border-t-[3px] border-ved-gold-500 sm:h-7" style={LACQUER} />
        <div className="flex h-12 w-full items-start justify-between px-8 sm:h-14 sm:px-16" style={LACQUER}>
          <Diya aarti={aarti} />
          <div className="flex h-full items-center gap-2 text-lg sm:text-xl">
            {showPrasad ? <span>🍬</span> : null}
            <span className="opacity-80">🪷</span>
            <span className="text-xs text-ved-gold-300/80">
              {offeredCount}/{total}
            </span>
            <span className="opacity-80">🪷</span>
          </div>
          <Diya aarti={aarti} delay="0.3s" />
        </div>
        <div className="flex h-9 w-[104%] items-center justify-center sm:h-11" style={LACQUER}>
          <span className="font-display text-lg tracking-[1em] text-ved-gold-400/40">ॐ</span>
        </div>
      </div>
    </div>
  );
}

function Pillar({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      className={`relative z-10 w-9 shrink-0 sm:w-14 ${side === 'left' ? 'border-r-2' : 'border-l-2'} border-black/50`}
      style={LACQUER}
    >
      <div className="absolute inset-y-0 left-1/4 w-1/2 bg-black/20" />
      <div className="absolute inset-x-0 top-[8%] h-3 sm:h-4" style={GOLD_TRIM} />
      <div className="absolute inset-x-0 top-[50%] h-1.5" style={GOLD_TRIM} />
      <div className="absolute inset-x-0 bottom-[8%] h-3 sm:h-4" style={GOLD_TRIM} />
    </div>
  );
}

function Bell({ className, chain, delay }: { className: string; chain: string; delay: string }) {
  return (
    <div className={`absolute top-full z-30 flex flex-col items-center ${className}`}>
      <div className={`w-0.5 bg-ved-gold-500 ${chain}`} />
      <span
        className="-mt-1 origin-top text-2xl drop-shadow motion-safe:animate-swing"
        style={{ animationDelay: delay }}
        aria-hidden
      >
        🔔
      </span>
    </div>
  );
}

/** Three swags of marigold hung from the toran, with mango leaves at the ends. */
function Garland() {
  const beads: { x: number; y: number; c: string }[] = [];
  for (let swag = 0; swag < 3; swag++) {
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      beads.push({
        x: swag * 33.33 + t * 33.33,
        y: 2 + Math.sin(Math.PI * t) * 9,
        c: i % 2 ? '#f59e0b' : '#ea580c',
      });
    }
  }
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 -bottom-3 z-30 h-6 w-full sm:h-8"
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      aria-hidden
    >
      {[0, 33.33, 66.66, 100].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="4" rx="1.3" ry="3.2" fill="#3f7d3a" transform={`rotate(-20 ${x} 4)`} />
          <ellipse cx={x} cy="4" rx="1.3" ry="3.2" fill="#2f6a2c" transform={`rotate(20 ${x} 4)`} />
        </g>
      ))}
      {beads.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r="1.35" fill={b.c} />
      ))}
    </svg>
  );
}

function Diya({ aarti, delay = '0s' }: { aarti: boolean; delay?: string }) {
  return (
    <div className={`relative -mt-5 flex flex-col items-center ${aarti ? 'motion-safe:animate-float' : ''}`}>
      <div
        className={`rounded-b-full rounded-t-[100%] bg-gradient-to-t from-yellow-200 via-orange-400 to-red-500 motion-safe:animate-flicker ${
          aarti ? 'h-6 w-4 shadow-[0_0_30px_#ff9900]' : 'h-4 w-3 shadow-[0_0_20px_#ff9900]'
        }`}
        style={{ animationDelay: delay }}
      />
      <div className="mt-1 h-4 w-8 rounded-b-full border border-amber-900 bg-gradient-to-b from-amber-600 to-amber-800 shadow-md" />
      <div className="h-2 w-4 rounded-b-sm bg-amber-900" />
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
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center">
      <div className="h-28 w-16 animate-float rounded-full bg-gradient-to-t from-ved-cream-100/25 to-transparent blur-md" />
    </div>
  );
}
