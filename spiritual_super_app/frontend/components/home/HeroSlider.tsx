'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { heroSlideImageUrl, type HeroSlide } from '@/lib/api';

const AUTO_ADVANCE_MS = 6000;

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
export function HeroTitle({ title }: { title: string }) {
  return (
    <>
      {title.split('*').map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="text-ved-gold-500">
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

function Arrow({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
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
  promoQuote: string;
  /** Static content under the slide copy (search, trust badges). */
  children?: ReactNode;
}) {
  const slides = loaded && loaded.length > 0 ? loaded : [DEFAULT_HERO_SLIDE];
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
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
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-8 lg:grid-cols-2 lg:gap-10 lg:py-10">
        <div className="animate-fade-up">
          <div className="grid">
            {slides.map((slide, i) => {
              const current = i === active;
              const Heading = i === 0 ? 'h1' : 'h2';
              return (
                <div
                  key={slide.id}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${count}`}
                  aria-hidden={!current}
                  className={`[grid-area:1/1] transition-opacity duration-700 ${
                    current ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  {slide.eyebrow && (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ved-gold-600">
                      {slide.eyebrow}
                    </p>
                  )}
                  <Heading className="mt-3 font-display text-4xl font-semibold leading-[1.12] text-ved-green-900 sm:text-[2.75rem] lg:text-[3rem]">
                    <HeroTitle title={slide.title} />
                  </Heading>
                  {slide.description && (
                    <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ved-green-800/70">
                      {slide.description}
                    </p>
                  )}
                  {slide.ctaText && slide.ctaHref && (
                    <Link
                      href={slide.ctaHref}
                      tabIndex={current ? undefined : -1}
                      {...(isExternal(slide.ctaHref) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="mt-5 inline-flex items-center gap-2 rounded-full bg-ved-gold-500 px-6 py-2.5 text-sm font-semibold text-ved-green-900 shadow-sm transition hover:bg-ved-gold-400"
                    >
                      {slide.ctaText} <span aria-hidden>→</span>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
          {children}
        </div>

        <div className="relative mx-auto aspect-[4/5] h-[20rem] animate-float sm:h-[24rem] lg:h-[27rem]">
          <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-ved-gold-300/50 to-ved-green-200/40 blur-2xl" />
          <div className="relative h-full overflow-hidden rounded-[2rem] border border-ved-gold-400/40 bg-[#F7F4EE] shadow-xl">
            {slides.map((slide, i) => (
              <Image
                key={slide.id}
                src={heroSlideImageUrl(slide)}
                alt={i === active ? plainTitle(slide.title) : ''}
                fill
                unoptimized
                priority={i === 0}
                sizes="(max-width: 1024px) 70vw, 30vw"
                className={`object-cover object-center transition-opacity duration-700 ${
                  i === active ? 'opacity-100' : 'opacity-0'
                }`}
              />
            ))}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" />
            <p className="absolute bottom-5 right-5 max-w-[11rem] text-right font-display text-base italic leading-snug text-white drop-shadow">
              {promoQuote}
            </p>
            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(active - 1)}
                  aria-label="Previous slide"
                  className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-ved-green-900 shadow transition hover:bg-white"
                >
                  <Arrow direction="prev" />
                </button>
                <button
                  type="button"
                  onClick={() => go(active + 1)}
                  aria-label="Next slide"
                  className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-ved-green-900 shadow transition hover:bg-white"
                >
                  <Arrow direction="next" />
                </button>
                <div className="absolute bottom-6 left-5 flex gap-1.5">
                  {slides.map((slide, i) => (
                    <button
                      key={slide.id}
                      type="button"
                      onClick={() => go(i)}
                      aria-label={`Show slide ${i + 1}`}
                      aria-current={i === active}
                      className={`h-2 rounded-full transition-all ${
                        i === active ? 'w-6 bg-ved-gold-400' : 'w-2 bg-white/70 hover:bg-white'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
