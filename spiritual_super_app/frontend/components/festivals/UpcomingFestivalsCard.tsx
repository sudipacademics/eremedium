'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { formatDay, relativeDay } from '@/components/festivals/festival-dates';
import { api, type UpcomingFestivals } from '@/lib/api';

/**
 * The next few festivals, for the home page. Renders nothing until data arrives and stays hidden if
 * the calendar is unconfigured or unavailable, so it never puts an error on a marketing page.
 */
export function UpcomingFestivalsCard({ limit = 4, className = '' }: { limit?: number; className?: string }) {
  const [data, setData] = useState<UpcomingFestivals | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<UpcomingFestivals>(`festivals/upcoming?limit=${limit}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [limit]);

  if (!data || data.festivals.length === 0) return null;

  return (
    <section aria-label="Upcoming festivals" className={className}>
      <div className="rounded-3xl border border-ved-gold-400/30 bg-gradient-to-br from-white to-[#FBF8F2] p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold text-ved-green-900">
            <span aria-hidden className="mr-2">
              🪔
            </span>
            Upcoming Festivals
          </h2>
          <Link href="/festivals" className="text-sm font-semibold text-ved-green-700 underline-offset-2 hover:underline">
            Full calendar →
          </Link>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.festivals.map((festival) => (
            <li key={`${festival.date}${festival.name}`}>
              <Link
                href={`/festivals?month=${festival.date.slice(0, 7)}`}
                className="flex h-full items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-ved-green-900/5 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-ved-green-800 text-center text-ved-gold-300">
                  <span className="leading-tight">
                    <span className="block font-display text-xl font-semibold">{formatDay(festival.date, { day: 'numeric' })}</span>
                    <span className="block text-[10px] font-semibold uppercase tracking-wide">
                      {formatDay(festival.date, { month: 'short' })}
                    </span>
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ved-green-900">{festival.name}</span>
                  <span className="block text-xs text-ved-green-800/60">{relativeDay(data.today, festival.date)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
