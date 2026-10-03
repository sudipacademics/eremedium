'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import { heroSlideImageUrl, type HeroSlide } from '@/lib/api';

const AUTO_ADVANCE_MS = 6000;
const SWIPE_THRESHOLD_PX = 40;

/** Shown while slides load and whenever the backend has none live. */
export const DEFAULT_HERO_SLIDE: HeroSlide = {
  id: 'default',
  eyebrow: 'Ancient wisdom for a brighter tomorrow',
  title: 'Your Life, Guided by *Vedic Wisdom*',
  description: 'Astrology | Puja | Panchang | Ayurveda — all in one trusted platform – Vedsutra',
  imageUrl: '/brand/vedsutra-hero-mandala.png',
  imageVersion: null,
  ctaText: null,
  ctaHref: null,
};

/** Renders `*gold words*` spans of a slide title. */
export function HeroTitle({ title, accentClassName = 'text-ved-gold-500' }: { title: string; accentClassName?: string }) {
  return (
    <>
      {title.split('*').map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className={accentClassName}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function plainTitle(title: string): string {
  return title.replaceAll('*', '');
}

function isExternal(href: string): boolean {
  return /^https:\/\//i.test(href);
}

/** Signed shortest distance from the active card around the ring: 0 front, ±1 behind it, beyond that hidden. */
function offsetFrom(index: number, active: number, count: number): number {
  let offset = (index - active + count) % count;
  if (offset > count / 2) offset -= count;
  return offset;
}

function cardStyle(offset: number, reducedMotion: boolean): CSSProperties {
  const side = Math.sign(offset);
  const far = Math.abs(offset) > 1;
  const transform =
    offset === 0
      ? 'translate3d(-50%, 0, 0) rotateY(0deg) rotateZ(0deg) scale(1)'
      : `translate3d(calc(-50% + var(--hero-shift) * ${far ? 1.45 * side : side}), ${far ? '0' : '6%'}, ${
          far ? '-260px' : '-140px'
        }) rotateY(${-18 * side}deg) rotateZ(${4 * side}deg) scale(${far ? 0.6 : 0.8})`;
  return {
    transform,
    zIndex: 30 - Math.abs(offset) * 10,
    opacity: far ? 0 : 1,
    transition: reducedMotion ? 'none' : 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 500ms ease, filter 500ms ease',
    filter: offset === 0 ? 'none' : 'saturate(0.9) brightness(0.92)',
  };
}

function Arrow({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <path d={direction === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HeroSlider({
  slides: loaded,
  promoQuote,
  children,
}: {
  /** `null` while loading. */
  slides: HeroSlide[] | null;
  /** Caption for a card whose title just repeats the hero heading (e.g. the default slide). */
  promoQuote: string;
  /** Static content under the hero copy (search, trust badges). */
  children?: ReactNode;
}) {
  const slides = loaded && loaded.length > 0 ? loaded : [DEFAULT_HERO_SLIDE];
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const active = Math.min(index, count - 1);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (count < 2 || paused || reducedMotion) return;
    const timer = window.setTimeout(() => setIndex((active + 1) % count), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, count, paused, reducedMotion]);

  const go = (next: number) => setIndex((next + count) % count);
  const heading = plainTitle(DEFAULT_HERO_SLIDE.title);
  const captionFor = (slide: HeroSlide) => (plainTitle(slide.title) === heading ? promoQuote : slide.title);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(active - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(active + 1);
    }
  };

  return (
    <section
      className="relative overflow-hidden border-b border-ved-green-900/5 bg-[#F7F4EE]"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full bg-ved-gold-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-ved-gold-100/70 blur-3xl" />
      <div className="mx-auto grid max-w-7xl items-center gap-6 px-4 py-8 lg:grid-cols-2 lg:gap-10 lg:py-10">
        <div className="animate-fade-up">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ved-gold-600">
            {DEFAULT_HERO_SLIDE.eyebrow}
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.12] text-ved-green-900 sm:text-[2.75rem] lg:text-[3rem]">
            <HeroTitle title={DEFAULT_HERO_SLIDE.title} />
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ved-green-800/70">
            {DEFAULT_HERO_SLIDE.description}
          </p>
          {children}
        </div>

        <div className="relative" onKeyDown={onKeyDown}>
          <div
            className="relative mx-auto h-[21rem] w-full touch-pan-y select-none [--hero-shift:44%] [perspective:1200px] sm:h-[25rem] sm:[--hero-shift:66%] lg:h-[27rem] lg:[--hero-shift:72%]"
            aria-live={paused || reducedMotion ? 'polite' : 'off'}
            onPointerDown={(event) => {
              swipeStart.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
              const start = swipeStart.current;
              swipeStart.current = null;
              if (!start || count < 2) return;
              const dx = event.clientX - start.x;
              if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
                go(dx < 0 ? active + 1 : active - 1);
              }
            }}
            onPointerCancel={() => {
              swipeStart.current = null;
            }}
          >
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-3/4 w-2/3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-ved-gold-300/50 to-ved-green-200/40 blur-3xl" />
            {slides.map((slide, i) => {
              const offset = offsetFrom(i, active, count);
              const current = offset === 0;
              const caption = captionFor(slide);
              return (
                <div
                  key={slide.id}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${count}`}
                  aria-hidden={!current}
                  onClick={current ? undefined : () => go(i)}
                  style={cardStyle(offset, reducedMotion)}
                  className={`absolute left-1/2 top-[4%] aspect-[4/5] h-[88%] will-change-transform ${
                    current ? '' : 'cursor-pointer'
                  } ${Math.abs(offset) > 1 ? 'pointer-events-none' : ''}`}
                >
                  <div
                    className={`relative h-full overflow-hidden rounded-[1.75rem] border bg-[#F7F4EE] ${
                      current
                        ? 'border-ved-gold-400/60 shadow-[0_30px_60px_-15px_rgba(11,79,69,0.45)]'
                        : 'border-ved-gold-300/40 shadow-[0_18px_40px_-18px_rgba(11,79,69,0.4)]'
                    }`}
                  >
                    <Image
                      src={heroSlideImageUrl(slide)}
                      alt={current ? (caption !== promoQuote && slide.description) || plainTitle(caption) : ''}
                      fill
                      unoptimized
                      priority={i === 0}
                      draggable={false}
                      sizes="(max-width: 1024px) 60vw, 22vw"
                      className="object-cover object-center"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                    <div className="absolute inset-x-4 bottom-4 text-right sm:inset-x-5 sm:bottom-5">
                      {slide.eyebrow && plainTitle(slide.title) !== heading && (
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ved-gold-200">{slide.eyebrow}</p>
                      )}
                      <p className="ml-auto mt-1 max-w-[13rem] font-display text-base italic leading-snug text-white drop-shadow sm:text-lg">
                        <HeroTitle title={caption} accentClassName="text-ved-gold-200" />
                      </p>
                      {slide.ctaText && slide.ctaHref && (
                        <Link
                          href={slide.ctaHref}
                          tabIndex={current ? undefined : -1}
                          {...(isExternal(slide.ctaHref) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ved-gold-500 px-4 py-1.5 text-xs font-semibold text-ved-green-900 shadow-sm transition hover:bg-ved-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                          {slide.ctaText} <span aria-hidden>→</span>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(active - 1)}
                  aria-label="Previous slide"
                  className="absolute left-0 top-1/2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white text-ved-green-900 shadow-[0_6px_20px_rgba(11,79,69,0.18)] transition hover:scale-105 hover:bg-ved-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400 sm:left-2 sm:h-11 sm:w-11"
                >
                  <Arrow direction="prev" />
                </button>
                <button
                  type="button"
                  onClick={() => go(active + 1)}
                  aria-label="Next slide"
                  className="absolute right-0 top-1/2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white text-ved-green-900 shadow-[0_6px_20px_rgba(11,79,69,0.18)] transition hover:scale-105 hover:bg-ved-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400 sm:right-2 sm:h-11 sm:w-11"
                >
                  <Arrow direction="next" />
                </button>
              </>
            )}
          </div>

          {count > 1 && (
            <div className="mt-3 flex justify-center gap-2">
              {slides.map((slide, i) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Show slide ${i + 1}`}
                  aria-current={i === active}
                  className="grid h-6 w-6 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400"
                >
                  <span
                    className={`block rounded-full transition-all ${
                      i === active
                        ? 'h-3 w-3 border-2 border-ved-gold-500 bg-ved-gold-400'
                        : 'h-2.5 w-2.5 bg-ved-green-900/20 hover:bg-ved-green-900/35'
                    }`}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
