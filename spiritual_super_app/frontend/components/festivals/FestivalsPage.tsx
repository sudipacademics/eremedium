'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { SiteFooter } from '@/components/SiteFooter';
import {
  MONTH_WINDOW,
  formatDay,
  isMonth,
  monthLabel,
  monthOf,
  monthsBetween,
  relativeDay,
  shiftMonth,
} from '@/components/festivals/festival-dates';
import { ApiError, api, type Festival, type FestivalMonth } from '@/lib/api';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: FestivalMonth }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

function groupByDate(festivals: Festival[]): Array<{ date: string; festivals: Festival[] }> {
  const groups = new Map<string, Festival[]>();
  for (const festival of festivals) {
    const list = groups.get(festival.date) ?? [];
    list.push(festival);
    groups.set(festival.date, list);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, list]) => ({ date, festivals: list }));
}

function FestivalCard({ festival }: { festival: Festival }) {
  return (
    <li className="rounded-2xl border border-ved-green-900/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold text-ved-green-900">{festival.name}</h3>
        {festival.localName && <span className="text-sm text-ved-green-800/60">{festival.localName}</span>}
        {festival.category && (
          <span className="rounded-full bg-ved-gold-50 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-ved-gold-700 ring-1 ring-ved-gold-200">
            {festival.category.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      {festival.tithi && <p className="mt-1 text-xs font-semibold text-ved-green-700">Tithi: {festival.tithi}</p>}
      {festival.description && <p className="mt-2 text-sm leading-relaxed text-ved-green-800/80">{festival.description}</p>}
      {festival.anchor && <p className="mt-2 text-xs text-ved-green-800/55">Observed by {festival.anchor.replace(/_/g, ' ')}</p>}
    </li>
  );
}

function DayGroup({ date, festivals, today }: { date: string; festivals: Festival[]; today: string }) {
  const isToday = date === today;
  const past = date < today;
  return (
    <section
      aria-label={formatDay(date, { weekday: 'long', day: 'numeric', month: 'long' })}
      className={`grid gap-3 rounded-3xl p-3 sm:grid-cols-[6.5rem_1fr] sm:p-4 ${
        isToday ? 'bg-ved-gold-50 ring-2 ring-ved-gold-300' : 'bg-white/60 ring-1 ring-ved-green-900/5'
      } ${past ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-0">
        <span className="font-display text-4xl font-semibold leading-none text-ved-green-900">
          {formatDay(date, { day: 'numeric' })}
        </span>
        <span className="text-sm font-semibold text-ved-green-800/70 sm:mt-1">{formatDay(date, { weekday: 'long' })}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold sm:mt-2 ${
            isToday ? 'bg-ved-gold-400 text-ved-green-950' : past ? 'bg-ved-green-900/5 text-ved-green-800/60' : 'bg-ved-green-50 text-ved-green-800 ring-1 ring-ved-green-200'
          }`}
        >
          {relativeDay(today, date)}
        </span>
      </div>
      <ul className="space-y-3">
        {festivals.map((festival) => (
          <FestivalCard key={`${festival.date}${festival.name}`} festival={festival} />
        ))}
      </ul>
    </section>
  );
}

export function FestivalsPage() {
  const [thisMonth] = useState(() => monthOf(new Date()));
  const [month, setMonth] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, FestivalMonth>>({});
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('month');
    setMonth(isMonth(fromUrl) && Math.abs(monthsBetween(thisMonth, fromUrl)) <= MONTH_WINDOW ? fromUrl : thisMonth);
  }, [thisMonth]);

  useEffect(() => {
    if (!month) return;
    const hit = cache[month];
    if (hit) {
      setState({ status: 'ready', data: hit });
      return;
    }
    setState({ status: 'loading' });
    let cancelled = false;
    api
      .get<FestivalMonth>(`festivals?month=${month}`)
      .then((data) => {
        if (cancelled) return;
        setCache((prev) => ({ ...prev, [month]: data }));
        setState({ status: 'ready', data });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 503) setState({ status: 'unconfigured' });
        else setState({ status: 'error', message: caught instanceof Error ? caught.message : 'Could not load festivals' });
      });
    return () => {
      cancelled = true;
    };
  }, [month, cache, attempt]);

  const go = useCallback((next: string) => {
    setMonth(next);
    const url = new URL(window.location.href);
    url.searchParams.set('month', next);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  const offset = month ? monthsBetween(thisMonth, month) : 0;
  const data = state.status === 'ready' ? state.data : null;
  const groups = data ? groupByDate(data.festivals) : [];
  const next = data?.festivals.find((f) => f.date >= data.today);

  return (
    <div className="bg-ved-cream-100">
      <section className="bg-gradient-to-br from-ved-green-800 via-ved-green-700 to-ved-green-950 text-white">
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-10 sm:pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ved-gold-300">Tyohar · Vrat</p>
          <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">Hindu Festival Calendar</h1>
          <p className="mt-3 max-w-2xl text-sm text-white/75 sm:text-base">
            Festivals, vrats and sacred days for every month, with each date fixed by its tithi the way the panchang
            reckons it.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-full bg-white/10 p-1 ring-1 ring-white/15">
              <button
                type="button"
                aria-label="Previous month"
                disabled={!month || offset <= -MONTH_WINDOW}
                onClick={() => month && go(shiftMonth(month, -1))}
                className="grid h-9 w-9 place-items-center rounded-full text-lg text-white/85 transition hover:bg-white/10 disabled:opacity-30"
              >
                ‹
              </button>
              <h2 aria-live="polite" className="min-w-[10.5rem] px-2 text-center font-display text-lg font-semibold">
                {month ? monthLabel(month) : '\u00A0'}
              </h2>
              <button
                type="button"
                aria-label="Next month"
                disabled={!month || offset >= MONTH_WINDOW}
                onClick={() => month && go(shiftMonth(month, 1))}
                className="grid h-9 w-9 place-items-center rounded-full text-lg text-white/85 transition hover:bg-white/10 disabled:opacity-30"
              >
                ›
              </button>
            </div>
            {month && month !== thisMonth && (
              <button
                type="button"
                onClick={() => go(thisMonth)}
                className="rounded-full bg-ved-gold-400 px-4 py-2 text-sm font-semibold text-ved-green-950 shadow transition hover:bg-ved-gold-300"
              >
                This month
              </button>
            )}
          </div>
          {next && month === thisMonth && (
            <p className="mt-4 text-sm text-ved-gold-200">
              Next: <span className="font-semibold text-white">{next.name}</span> · {relativeDay(data!.today, next.date)}
            </p>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        {state.status === 'loading' && (
          <p className="animate-pulse rounded-3xl bg-white px-6 py-16 text-center text-sm text-ved-green-800/60">
            Consulting the panchang…
          </p>
        )}

        {state.status === 'unconfigured' && (
          <div className="rounded-3xl border border-ved-gold-300 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-3xl" aria-hidden>
              🪔
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-ved-green-900">Festival calendar coming soon</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ved-green-800/70">
              We are setting up festival dates. Meanwhile, today&apos;s tithi and auspicious timings are in the Panchang.
            </p>
            <Link
              href="/panchang"
              className="mt-5 inline-block rounded-lg bg-ved-green-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-ved-green-700"
            >
              Open Panchang
            </Link>
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
            <p>{state.message}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="rounded-lg bg-white px-3 py-1.5 font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
            >
              Try again
            </button>
          </div>
        )}

        {data && groups.length === 0 && (
          <p className="rounded-3xl bg-white px-6 py-14 text-center text-sm text-ved-green-800/60">
            No festivals are listed for {monthLabel(data.month)}.
          </p>
        )}

        {data && groups.map((group) => <DayGroup key={group.date} date={group.date} festivals={group.festivals} today={data.today} />)}

        <p className="pt-2 text-xs leading-relaxed text-ved-green-800/55">
          Dates are computed for India (IST, reckoned at New Delhi) using the Lahiri ayanamsha; regional traditions can
          observe some festivals a day apart. Festival data by{' '}
          <a href="https://kaliapanjika.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Kalia Panjika
          </a>
          .
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
