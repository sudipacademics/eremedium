'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { api, type HomeStats } from '@/lib/api';
import { easeOutQuart, formatCount, formatRating } from '@/lib/stat-format';

type StatKey = Exclude<keyof HomeStats, 'updatedAt'>;

const STATS: readonly { key: StatKey; label: string; icon: string; tint: string; format: (value: number) => string }[] = [
  { key: 'happyUsers', label: 'Happy Users', icon: 'users', tint: 'from-[#e3f3ec] to-[#cfe9de]', format: formatCount },
  { key: 'verifiedExperts', label: 'Verified Experts', icon: 'experts', tint: 'from-[#fbf1dc] to-[#f3e3c0]', format: formatCount },
  { key: 'pujasPerformed', label: 'Pujas Performed', icon: 'pujas', tint: 'from-[#fdeedd] to-[#f8dcbd]', format: formatCount },
  { key: 'authenticProducts', label: 'Authentic Products', icon: 'products', tint: 'from-[#e6f1ea] to-[#d3e6da]', format: formatCount },
  { key: 'userRating', label: 'User Rating', icon: 'rating', tint: 'from-[#fdf0dc] to-[#f9dfb6]', format: formatRating },
];

const DURATION_MS = 1800;

/**
 * Eased 0→1 progress that runs while `ref` is in view. With `replay` it resets when the element
 * leaves the viewport and plays again on return; otherwise it plays once. Users who prefer reduced
 * motion, and browsers without IntersectionObserver, get the final value straight away.
 */
function useCountUp(ref: RefObject<HTMLElement | null>, enabled: boolean, replay: boolean): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setProgress(1);
      return;
    }

    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        cancelAnimationFrame(frame);
        if (!entry?.isIntersecting) {
          if (replay) setProgress(0);
          return;
        }
        if (!replay) observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS);
          setProgress(easeOutQuart(t));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, enabled, replay]);

  return progress;
}

function LotusDivider() {
  return (
    <div className="mt-3 flex items-center justify-center gap-2 text-[#c9a24a]" aria-hidden>
      <span className="h-px w-10 bg-gradient-to-r from-transparent to-current opacity-70" />
      <svg viewBox="0 0 24 14" className="h-3 w-5" fill="currentColor">
        <path d="M12 1c1.8 2 2.6 4.4 2.6 6.6 0 2.4-1.1 4.3-2.6 5.4-1.5-1.1-2.6-3-2.6-5.4C9.4 5.4 10.2 3 12 1Z" />
        <path d="M3 5.5c3.1.2 5.7 1.7 7 4 .6 1 .9 2.2 1 3.5-2.9-.2-5.6-1.4-7-3.6C3.4 8.4 3.1 7 3 5.5Zm18 0c-.1 1.5-.4 2.9-1 3.9-1.4 2.2-4.1 3.4-7 3.6.1-1.3.4-2.5 1-3.5 1.3-2.3 3.9-3.8 7-4Z" opacity=".75" />
      </svg>
      <span className="h-px w-10 bg-gradient-to-l from-transparent to-current opacity-70" />
    </div>
  );
}

function CornerFlourish({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`pointer-events-none absolute h-16 w-16 text-[#d9bd7a] opacity-40 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden
    >
      <circle cx="0" cy="64" r="14" />
      <circle cx="0" cy="64" r="22" />
      {[0, 18, 36, 54, 72, 90].map((deg) => (
        <path key={deg} transform={`rotate(${-deg} 0 64)`} d="M22 64c6-6 14-7 22-5-5 6-13 8-22 5Z" />
      ))}
      <circle cx="0" cy="64" r="46" strokeDasharray="1.5 3" />
    </svg>
  );
}

export function StatsSection({ replay = true }: { replay?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [failed, setFailed] = useState(false);
  const progress = useCountUp(ref, stats !== null, replay);

  useEffect(() => {
    void api
      .get<HomeStats>('content/home-stats')
      .then(setStats)
      .catch(() => setFailed(true));
  }, []);

  return (
    <section ref={ref} aria-label="Vedsutra in numbers" className="bg-[#FBF9F4]">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-12 sm:grid-cols-3 sm:gap-5 lg:grid-cols-5">
        {STATS.map((stat) => {
          const target = stats?.[stat.key] ?? 0;
          const final = stats ? stat.format(target) : failed ? '—' : stat.format(0);
          return (
            <div
              key={stat.key}
              className="relative overflow-hidden rounded-[22px] border border-[#e3cf9c] bg-gradient-to-b from-[#fffdf8] to-[#fbf5e8] px-4 pb-5 pt-6 text-center shadow-[0_10px_30px_-18px_rgba(150,110,40,0.45)]"
            >
              <CornerFlourish className="bottom-0 left-0" />
              <CornerFlourish className="bottom-0 right-0 -scale-x-100" />
              <div
                className={`relative mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gradient-to-br ${stat.tint} ring-4 ring-white/70`}
              >
                <Image
                  src={`/home/stats/${stat.icon}.webp`}
                  alt=""
                  width={44}
                  height={44}
                  unoptimized
                  className="h-11 w-11 object-contain drop-shadow-[0_3px_4px_rgba(60,40,10,0.18)]"
                />
              </div>
              <p className="relative mt-3 font-display text-4xl font-semibold leading-none text-[#a8782c] sm:text-[42px]">
                <span aria-hidden>{stats ? stat.format(target * progress) : final}</span>
                <span className="sr-only">{final}</span>
              </p>
              <p className="relative mt-2 text-sm font-medium text-ved-green-900/75">{stat.label}</p>
              <LotusDivider />
            </div>
          );
        })}
      </div>
    </section>
  );
}
