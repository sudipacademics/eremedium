'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, astrologerPhotoUrl, type DirectoryAstrologer } from '@/lib/api';

import { CAROUSEL_ARROW, useCarousel } from './useCarousel';

/** How often the roster is re-read so online/offline changes and profile edits show up by themselves. */
export const ASTROLOGER_REFRESH_MS = 20_000;

const STATUS: Record<DirectoryAstrologer['status'], { label: string; dot: string; ring: string; pill: string }> = {
  IDLE: { label: 'Online', dot: 'bg-emerald-500', ring: 'ring-emerald-500', pill: 'bg-emerald-50 text-emerald-700' },
  BUSY: { label: 'Busy', dot: 'bg-amber-500', ring: 'ring-amber-400', pill: 'bg-amber-50 text-amber-700' },
  IN_CALL: { label: 'On a call', dot: 'bg-amber-500', ring: 'ring-amber-400', pill: 'bg-amber-50 text-amber-700' },
  OFFLINE: { label: 'Offline', dot: 'bg-slate-400', ring: 'ring-ved-green-900/10', pill: 'bg-slate-100 text-slate-500' },
};

function useLiveAstrologers(): DirectoryAstrologer[] | null {
  const [astrologers, setAstrologers] = useState<DirectoryAstrologer[] | null>(null);

  const load = useCallback(() => {
    void api
      .get<{ astrologers: DirectoryAstrologer[] }>('content/astrologers')
      .then((res) => setAstrologers(res.astrologers))
      .catch(() => setAstrologers((current) => current ?? []));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, ASTROLOGER_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return astrologers;
}

function VerifiedTick() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-emerald-600" fill="currentColor" aria-label="Verified">
      <path d="M10 1.5l2.2 1.6 2.7-.2.9 2.6 2.3 1.5-.7 2.6.7 2.6-2.3 1.5-.9 2.6-2.7-.2L10 18.5l-2.2-1.6-2.7.2-.9-2.6-2.3-1.5.7-2.6-.7-2.6 2.3-1.5.9-2.6 2.7.2L10 1.5zm-1.2 11.3l5-5-1.1-1.1-3.9 3.9-1.8-1.8-1.1 1.1 2.9 2.9z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path
        d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AstrologerCard({ astrologer }: { astrologer: DirectoryAstrologer }) {
  const status = STATUS[astrologer.status];
  const photo = astrologerPhotoUrl(astrologer);
  const available = astrologer.status === 'IDLE';
  const chips = astrologer.expertise.slice(0, 3);
  const more = astrologer.expertise.length - chips.length;

  return (
    <article className="flex h-full flex-col rounded-2xl border border-ved-green-900/8 bg-white p-5 shadow-sm transition hover:border-ved-gold-400/50 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="relative">
          <div className={`h-16 w-16 overflow-hidden rounded-full ring-2 ring-offset-2 ${status.ring}`}>
            {photo ? (
              <Image
                src={photo}
                alt={astrologer.displayName}
                width={64}
                height={64}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="grid h-full w-full place-items-center bg-gradient-to-br from-ved-gold-300 to-ved-gold-500 font-display text-2xl font-semibold text-ved-green-950">
                {astrologer.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <span
            className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white ${status.dot}`}
            aria-hidden
          />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.pill}`}>{status.label}</span>
      </div>

      <h3 className="mt-4 flex items-center gap-1.5 text-lg font-semibold text-ved-green-900">
        <span className="truncate">{astrologer.displayName}</span>
        <VerifiedTick />
      </h3>

      {chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Expertise">
          {chips.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-ved-green-900/10 bg-[#FBF8F2] px-2.5 py-1 text-[11px] font-medium text-ved-green-800"
            >
              {tag}
            </li>
          ))}
          {more > 0 && <li className="px-1 py-1 text-[11px] text-ved-green-800/50">+{more}</li>}
        </ul>
      )}

      <div className="mt-4 space-y-0.5 text-[13px]">
        {astrologer.languages.length > 0 && (
          <p className="font-medium text-ved-green-800/80">{astrologer.languages.join(' · ')}</p>
        )}
        {astrologer.experienceYears !== null && (
          <p className="text-ved-green-800/55">
            {astrologer.experienceYears} {astrologer.experienceYears === 1 ? 'yr' : 'yrs'} exp
          </p>
        )}
      </div>

      <p className="mt-auto pt-4 text-right">
        <span className="font-display text-xl font-semibold text-ved-green-900">₹{Number(astrologer.perMinuteRate)}</span>
        <span className="text-xs text-ved-green-800/55">/min</span>
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href="/ai"
          className="flex items-center justify-center gap-1.5 rounded-full border border-ved-green-700/30 py-2.5 text-sm font-semibold text-ved-green-800 transition hover:bg-ved-green-50"
          title="Chat about your chart with an AI astrologer"
        >
          <ChatIcon />
          Chat
        </Link>
        <Link
          href={`/astrologers?astrologer=${astrologer.id}`}
          className={`flex items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold transition ${
            available
              ? 'bg-ved-green-800 text-white hover:bg-ved-green-700'
              : 'border border-ved-green-700/30 text-ved-green-800 hover:bg-ved-green-50'
          }`}
          aria-label={`Call ${astrologer.displayName}`}
        >
          <PhoneIcon />
          Call
        </Link>
      </div>
    </article>
  );
}

export function AstrologerCarousel() {
  const astrologers = useLiveAstrologers();
  const { track, edges, measure, scroll } = useCarousel(astrologers?.length ?? 0);

  if (astrologers !== null && astrologers.length === 0) return null;

  const onlineCount = astrologers?.filter((a) => a.status !== 'OFFLINE').length ?? 0;
  const cardWidth = 'w-[82%] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-3rem)/4)]';

  return (
    <section
      className="border-y border-ved-green-900/5 bg-gradient-to-b from-[#FBF3E0] via-[#F7F4EE] to-[#F7F4EE]"
      aria-roledescription="carousel"
      aria-label="Talk to India's Top Rated Astrologers"
    >
      <div className="mx-auto max-w-7xl px-4 py-12">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ved-gold-600">
          {onlineCount > 0 ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live now · {onlineCount} online
            </>
          ) : (
            'Verified Vedic experts'
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-4xl font-semibold leading-tight text-ved-green-900 sm:text-5xl">
              Talk to India&apos;s <span className="text-ved-gold-500">Top Rated</span> Astrologers
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ved-green-800/65">
              Consult experienced Vedic astrologers by call — billed per minute, only while you are connected.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={CAROUSEL_ARROW} onClick={() => scroll(-1)} disabled={edges.start} aria-label="Previous astrologers">
              ‹
            </button>
            <button type="button" className={CAROUSEL_ARROW} onClick={() => scroll(1)} disabled={edges.end} aria-label="Next astrologers">
              ›
            </button>
            <Link
              href="/astrologers"
              className="ml-1 inline-flex items-center gap-2 rounded-full border border-ved-gold-500/60 px-5 py-2.5 text-sm font-semibold text-ved-gold-700 transition hover:bg-ved-gold-50"
            >
              View all astrologers <span aria-hidden>→</span>
            </Link>
          </div>
        </div>

        <ul ref={track} onScroll={measure} className="scrollbar-none mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
          {astrologers === null
            ? Array.from({ length: 4 }, (_, i) => (
                <li key={i} aria-hidden className={`${cardWidth} h-[21rem] animate-pulse rounded-2xl bg-white/70`} />
              ))
            : astrologers.map((astrologer) => (
                <li key={astrologer.id} className={cardWidth}>
                  <AstrologerCard astrologer={astrologer} />
                </li>
              ))}
        </ul>
      </div>
    </section>
  );
}
