'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';

import { LotusMark, Mandala } from '@/components/home/ornaments';
import {
  api,
  reviewThumbnailUrl,
  testimonialPhotoUrl,
  youtubeEmbedUrl,
  youtubeWatchUrl,
  type FooterSettings,
  type ReviewVideo,
  type Testimonial,
} from '@/lib/api';
import { loadFooterSettings } from '@/lib/footer';
import { buildReviewSlides } from '@/lib/reviews';

const AUTOPLAY_MS = 6500;
const SWIPE_PX = 50;

function YouTubeLogo({ className = 'h-4 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 20" className={className} aria-hidden>
      <rect width="28" height="20" rx="5" fill="#ff0000" />
      <path d="M11 6v8l7-4-7-4Z" fill="#fff" />
    </svg>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex shrink-0 gap-0.5" role="img" aria-label={`Rated ${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 20 20" className={`h-3.5 w-3.5 ${i < rating ? 'text-[#c9a24a]' : 'text-[#e8dcc0]'}`} fill="currentColor" aria-hidden>
          <path d="m10 1.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5Z" />
        </svg>
      ))}
    </span>
  );
}

function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  const photo = testimonialPhotoUrl(testimonial);
  const initials = testimonial.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <figure className="relative flex h-full flex-col rounded-[20px] border border-[#ecdcb4] bg-white/85 p-5 shadow-[0_12px_30px_-22px_rgba(150,110,40,0.55)] backdrop-blur-sm">
      <figcaption className="flex items-start gap-3">
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-[#ecdcb4] bg-ved-green-900">
          {photo ? (
            <Image src={photo} alt="" fill unoptimized className="object-cover" sizes="48px" />
          ) : (
            <span className="grid h-full w-full place-items-center font-display text-lg font-semibold text-cream-50">{initials}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[17px] font-semibold text-ved-green-900">{testimonial.name}</span>
          {testimonial.location && <span className="block truncate text-xs text-ved-green-900/60">{testimonial.location}</span>}
        </span>
        <Stars rating={testimonial.rating} />
      </figcaption>
      <blockquote className="relative mt-4 flex-1 pl-9 pr-4 font-display text-[16px] leading-relaxed text-ved-green-900/85">
        <span className="absolute -top-1 left-0 font-display text-5xl leading-none text-[#e6d3a3]" aria-hidden>
          &ldquo;
        </span>
        <p className="line-clamp-5">{testimonial.body}</p>
        <span className="absolute -bottom-6 right-0 font-display text-5xl leading-none text-[#e6d3a3]" aria-hidden>
          &rdquo;
        </span>
      </blockquote>
    </figure>
  );
}

function VideoCard({ video, playing, onPlay }: { video: ReviewVideo; playing: boolean; onPlay: () => void }) {
  return (
    <article className="relative aspect-video overflow-hidden rounded-[22px] bg-ved-green-950 shadow-[0_22px_45px_-24px_rgba(20,40,30,0.7)] ring-1 ring-[#e3cf9c]/60">
      {playing ? (
        <iframe
          src={youtubeEmbedUrl(video.youtubeId)}
          title={video.title}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <>
          <Image
            src={reviewThumbnailUrl(video)}
            alt=""
            fill
            unoptimized
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 560px"
          />
          <span className="absolute inset-0 bg-gradient-to-tr from-black/80 via-black/35 to-transparent" aria-hidden />
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Play video: ${video.title}`}
            className="group absolute inset-0 grid place-items-center"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/95 shadow-xl transition duration-300 group-hover:scale-110 sm:h-16 sm:w-16">
              <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 text-ved-green-950" fill="currentColor" aria-hidden>
                <path d="M7 4.5v15l12-7.5-12-7.5Z" />
              </svg>
            </span>
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
            <div className="max-w-[22rem]">
              <h3 className="font-display text-xl font-semibold leading-tight text-white sm:text-[26px]">{video.title}</h3>
              {video.description && <p className="mt-1.5 line-clamp-2 text-xs text-white/80 sm:text-[13px]">{video.description}</p>}
            </div>
            <a
              href={youtubeWatchUrl(video.youtubeId)}
              target="_blank"
              rel="noopener noreferrer"
              className="pointer-events-auto inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-gradient-to-r from-[#f3dfa8] to-[#e2c37a] px-4 py-2 text-xs font-semibold text-ved-green-950 shadow-md transition hover:brightness-105 sm:self-auto"
            >
              <YouTubeLogo className="h-3.5 w-5" />
              Watch on YouTube
            </a>
          </div>
        </>
      )}
    </article>
  );
}

function ChannelPlaceholder({ channelUrl }: { channelUrl: string | null }) {
  return (
    <article className="relative grid aspect-video place-items-center overflow-hidden rounded-[22px] bg-gradient-to-br from-ved-green-900 to-ved-green-950 p-6 text-center ring-1 ring-[#e3cf9c]/60">
      <div>
        <LotusMark className="mx-auto h-6 w-10 text-[#dcc06c]" />
        <h3 className="mt-3 font-display text-2xl font-semibold text-cream-50">Real Stories, Real Transformations</h3>
        {channelUrl && (
          <a href={channelUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#ecd59a] px-4 py-2 text-xs font-semibold text-ved-green-950">
            <YouTubeLogo className="h-3.5 w-5" />
            Watch on YouTube
          </a>
        )}
      </div>
    </article>
  );
}

function Arrow({ direction, onClick, className }: { direction: -1 | 1; onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction < 0 ? 'Previous reviews' : 'Next reviews'}
      className={`z-10 grid h-11 w-11 place-items-center rounded-full border border-[#ecdcb4] bg-white text-ved-green-900 shadow-md transition hover:border-[#c9a24a] hover:text-[#a8782c] ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={direction < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
      </svg>
    </button>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/**
 * Homepage "Reviews": slides of one YouTube video between two written testimonials, all managed in
 * Admin → Reviews. The player iframe is created only when a visitor presses play.
 */
export function ReviewsSection() {
  const [data, setData] = useState<{ videos: ReviewVideo[]; testimonials: Testimonial[] } | null>(null);
  const [footer, setFooter] = useState<FooterSettings | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const touchX = useRef<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    let live = true;
    void api
      .get<{ videos: ReviewVideo[]; testimonials: Testimonial[] }>('content/reviews')
      .then((res) => live && setData(res))
      .catch(() => live && setData({ videos: [], testimonials: [] }));
    void loadFooterSettings().then((settings) => live && setFooter(settings));
    return () => {
      live = false;
    };
  }, []);

  const slides = useMemo(() => (data ? buildReviewSlides(data.videos, data.testimonials) : []), [data]);
  const count = slides.length;
  const channelUrl = footer?.youtubeUrl ?? null;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setPlaying(null);
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  const paused = hovered || focused || playing !== null || reducedMotion;
  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((current) => (current + 1) % count);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  function onTouchStart(event: TouchEvent) {
    touchX.current = event.touches[0]?.clientX ?? null;
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchX.current;
    const end = event.changedTouches[0]?.clientX;
    touchX.current = null;
    if (start === null || end === undefined || Math.abs(end - start) < SWIPE_PX) return;
    go(index + (end < start ? 1 : -1));
  }

  if (!data) return null;

  return (
    <section className="relative overflow-hidden bg-[#FBF9F4]" aria-roledescription="carousel" aria-label="Reviews">
      <Mandala className="-top-10 left-1/2 h-72 w-72 -translate-x-1/2 opacity-[0.18]" />
      <div className="relative mx-auto max-w-7xl px-4 py-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a8782c]">
              In their own words
              <span className="flex items-center gap-1.5 text-[#c9a24a]" aria-hidden>
                <span className="h-px w-5 bg-current opacity-60" />
                <LotusMark />
                <span className="h-px w-5 bg-current opacity-60" />
              </span>
            </p>
            <h2 className="mt-1 font-display text-4xl font-bold text-ved-green-900 sm:text-[44px]">
              Revie<span className="text-[#a8782c]">ws</span>
            </h2>
            <p className="mt-1 text-sm text-ved-green-900/60">Real experiences. Real guidance. Real lives transformed.</p>
          </div>
          {channelUrl ? (
            <a
              href={channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center self-start overflow-hidden rounded-full border border-[#c9a24a] shadow-[0_8px_20px_-12px_rgba(150,110,40,0.7)] sm:self-auto"
            >
              <span className="grid h-11 place-items-center bg-white px-4">
                <YouTubeLogo />
              </span>
              <span className="flex h-11 items-center gap-2 bg-gradient-to-r from-[#b8924a] to-[#8f6a2c] px-5 text-sm font-semibold text-white transition group-hover:brightness-110">
                Watch all Reviews on YouTube
                <span aria-hidden>→</span>
              </span>
            </a>
          ) : (
            <span
              title="Add the YouTube channel link in Admin → Footer"
              aria-label="Vedsutra YouTube channel coming soon"
              className="inline-flex cursor-default items-center self-start overflow-hidden rounded-full border border-[#e3cf9c] opacity-60 sm:self-auto"
            >
              <span className="grid h-11 place-items-center bg-white px-4">
                <YouTubeLogo />
              </span>
              <span className="flex h-11 items-center bg-[#c9ab6c] px-5 text-sm font-semibold text-white">YouTube channel coming soon</span>
            </span>
          )}
        </div>

        {count === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-[22px] border border-dashed border-[#d9bd7a] bg-white/70 px-6 py-10 text-center">
            <LotusMark className="h-6 w-10 text-[#c9a24a]" />
            <p className="font-display text-xl text-ved-green-900">Stories from our devotees are coming soon</p>
            <p className="max-w-md text-sm text-ved-green-900/60">
              Hear how Vedsutra&apos;s astrologers, pujas and Ayurveda have guided seekers across India.
            </p>
          </div>
        ) : (
          <div
            className="relative mt-8"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
            }}
          >
            {count > 1 && (
              <>
                <Arrow direction={-1} onClick={() => go(index - 1)} className="absolute -left-2 top-1/2 hidden -translate-y-1/2 lg:grid xl:-left-6" />
                <Arrow direction={1} onClick={() => go(index + 1)} className="absolute -right-2 top-1/2 hidden -translate-y-1/2 lg:grid xl:-right-6" />
              </>
            )}
            <div className="overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <div
                className={`flex ${reducedMotion ? '' : 'transition-transform duration-700 ease-[cubic-bezier(.22,.61,.36,1)]'}`}
                style={{ transform: `translateX(-${index * 100}%)` }}
              >
                {slides.map((slide, i) => (
                  <div
                    key={i}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`${i + 1} of ${count}`}
                    aria-hidden={i !== index}
                    inert={i !== index}
                    className="w-full min-w-0 shrink-0 px-1 lg:px-8"
                  >
                    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-6">
                      <div className="order-first min-w-0 sm:col-span-2 lg:order-none lg:col-span-1 lg:col-start-2 lg:row-start-1">
                        {slide.video ? (
                          <VideoCard video={slide.video} playing={i === index && playing === slide.video.id} onPlay={() => setPlaying(slide.video!.id)} />
                        ) : (
                          <ChannelPlaceholder channelUrl={channelUrl} />
                        )}
                      </div>
                      {slide.left && (
                        <div className="h-full min-w-0 lg:col-start-1 lg:row-start-1 lg:h-auto">
                          <TestimonialCard testimonial={slide.left} />
                        </div>
                      )}
                      {slide.right && (
                        <div className="h-full min-w-0 lg:col-start-3 lg:row-start-1 lg:h-auto">
                          <TestimonialCard testimonial={slide.right} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {count > 1 && (
              <div className="mt-6 flex items-center justify-center gap-4">
                <Arrow direction={-1} onClick={() => go(index - 1)} className="lg:hidden" />
                <div className="flex items-center gap-2">
                  {slides.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => go(i)}
                      aria-label={`Show reviews ${i + 1} of ${count}`}
                      aria-current={i === index}
                      className={`h-2.5 rounded-full transition-all duration-300 ${i === index ? 'w-6 bg-[#c9a24a]' : 'w-2.5 bg-[#ddd3bf] hover:bg-[#cdbf9f]'}`}
                    />
                  ))}
                </div>
                <Arrow direction={1} onClick={() => go(index + 1)} className="lg:hidden" />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
