'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SiteFooter } from '@/components/SiteFooter';
import { KundaliChart, type ChartPlacement } from '@/components/kundali/KundaliChart';
import { ENGLISH } from '@/components/kundali/languages';
import {
  api,
  session,
  type Horoscope,
  type HoroscopeArea,
  type HoroscopePeriod,
  type Kundali,
  type SignHoroscope,
} from '@/lib/api';

export const PERIODS: ReadonlyArray<{ id: HoroscopePeriod; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

/* U+FE0E keeps the zodiac glyphs as text rather than emoji. */
const GLYPHS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'].map((g) => `${g}\uFE0E`);
const SIGN_SLUGS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
] as const;
const AREA_LABELS: Record<HoroscopeArea, string> = { love: 'Love', career: 'Career', money: 'Money', health: 'Health' };
const RASHI_CHART_LANGUAGE = { ...ENGLISH, lagna: 'Rashi' };
const STORED_SIGN = 'vedsutra.rashi';

function parseDay(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function formatDay(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-IN', options).format(parseDay(iso));
}

export function periodLabel(h: Pick<Horoscope, 'period' | 'start' | 'end'>): string {
  if (h.period === 'daily') return formatDay(h.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (h.period === 'monthly') return formatDay(h.start, { month: 'long', year: 'numeric' });
  return `${formatDay(h.start, { day: 'numeric', month: 'short' })} – ${formatDay(h.end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function Stars({ value, size = 'text-base' }: { value: number; size?: string }) {
  return (
    <span className={`relative inline-block leading-none tracking-[0.1em] ${size}`} role="img" aria-label={`${value} out of 5 stars`}>
      <span aria-hidden className="text-ved-gold-200">★★★★★</span>
      <span aria-hidden className="absolute inset-0 overflow-hidden text-ved-gold-500" style={{ width: `${(value / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

function DayChips({ days, today, tone }: { days: string[]; today: string; tone: 'good' | 'caution' }) {
  return (
    <div className="flex flex-wrap gap-2">
      {days.map((day) => (
        <span
          key={day}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            tone === 'good' ? 'bg-ved-green-50 text-ved-green-800 ring-1 ring-ved-green-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
          } ${day < today ? 'opacity-50' : ''}`}
        >
          {formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
      ))}
    </div>
  );
}

function SignReading({ data, sign }: { data: Horoscope; sign: SignHoroscope }) {
  const placements: ChartPlacement[] = data.sky.planets.map((p) => ({ body: p.body, sign: p.sign, retrograde: p.retrograde }));
  const noun = data.period === 'daily' ? 'today' : data.period === 'weekly' ? 'this week' : 'this month';

  return (
    <section id="reading" className="grid gap-5 lg:grid-cols-[1.35fr_1fr]" aria-label={`${sign.name} horoscope`}>
      <article className="rounded-3xl border border-ved-green-900/10 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-ved-gold-100 to-ved-gold-300 text-3xl text-ved-green-900 shadow-inner">
            {GLYPHS[sign.sign - 1]}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ved-gold-600">
              {PERIODS.find((p) => p.id === data.period)!.label} horoscope · {periodLabel(data)}
            </p>
            <h2 className="font-display text-3xl font-semibold text-ved-green-900">
              {sign.name} <span className="text-xl text-ved-green-800/60">({sign.vedicName})</span>
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <Stars value={sign.overall} size="text-xl" />
              <span className="text-sm font-semibold text-ved-green-800">{sign.overall.toFixed(1)}/5</span>
            </div>
          </div>
        </div>

        <h3 className="mt-6 font-display text-xl font-semibold text-ved-green-900">{sign.headline}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ved-green-800/80">{sign.summary}</p>

        {sign.moon && (
          <p
            className={`mt-4 rounded-xl px-4 py-3 text-sm ${
              sign.moon.chandrashtama ? 'bg-rose-50 text-rose-800 ring-1 ring-rose-200' : 'bg-ved-cream-100 text-ved-green-800'
            }`}
          >
            The Moon is in {SIGN_SLUGS[sign.moon.sign - 1]!.replace(/^\w/, (c) => c.toUpperCase())} ({sign.moon.nakshatra}{' '}
            nakshatra), your {sign.moon.house}
            {sign.moon.house === 1 ? 'st' : sign.moon.house === 2 ? 'nd' : sign.moon.house === 3 ? 'rd' : 'th'} house.
            {sign.moon.chandrashtama &&
              ' This is Chandrashtama, traditionally a day to avoid new ventures, big purchases and arguments.'}
          </p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {(Object.keys(AREA_LABELS) as HoroscopeArea[]).map((area) => (
            <div key={area} className="flex items-center justify-between rounded-xl bg-ved-cream-50 px-4 py-3 ring-1 ring-ved-green-900/5">
              <span className="text-sm font-semibold text-ved-green-900">{AREA_LABELS[area]}</span>
              <Stars value={sign.areas[area]} />
            </div>
          ))}
        </div>

        <h3 className="mt-7 text-sm font-semibold uppercase tracking-wide text-ved-green-800/70">
          Planetary influences {noun}
        </h3>
        <ul className="mt-3 space-y-2.5">
          {sign.influences.map((influence) => (
            <li key={influence.body} className="flex gap-3 text-sm text-ved-green-900">
              <span
                aria-hidden
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${influence.favourable ? 'bg-ved-green-500' : 'bg-amber-500'}`}
              />
              <span>
                <span className="sr-only">{influence.favourable ? 'Favourable: ' : 'Challenging: '}</span>
                {influence.text}
              </span>
            </li>
          ))}
        </ul>

        {(sign.bestDays.length > 0 || sign.cautionDays.length > 0) && (
          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            {sign.bestDays.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ved-green-800/70">Best days</h3>
                <DayChips days={sign.bestDays} today={data.today} tone="good" />
              </div>
            )}
            {sign.cautionDays.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ved-green-800/70">
                  Go slow (Chandrashtama)
                </h3>
                <DayChips days={sign.cautionDays} today={data.today} tone="caution" />
              </div>
            )}
          </div>
        )}

        <dl className="mt-7 grid grid-cols-3 gap-3 text-center">
          {[
            ['Lucky colour', sign.lucky.colour],
            ['Lucky day', sign.lucky.day],
            ['Lucky number', String(sign.lucky.number)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-ved-gold-50 px-2 py-3 ring-1 ring-ved-gold-200">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ved-gold-700">{label}</dt>
              <dd className="mt-1 font-display text-lg font-semibold text-ved-green-900">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 rounded-xl border border-ved-gold-300 bg-gradient-to-r from-ved-gold-50 to-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ved-gold-700">Remedy</p>
          <p className="mt-1 text-sm text-ved-green-900">{sign.remedy}</p>
        </div>
      </article>

      <aside className="space-y-5">
        <div className="rounded-3xl border border-ved-green-900/10 bg-white p-5 shadow-sm">
          <h3 className="font-display text-lg font-semibold text-ved-green-900">Transit chart</h3>
          <p className="mb-3 text-xs text-ved-green-800/60">
            Planets on {formatDay(data.sky.date, { day: 'numeric', month: 'long' })}, with houses counted from {sign.name} (your
            Moon sign).
          </p>
          <KundaliChart
            chartStyle="north"
            lagnaSign={sign.sign}
            showLagna
            placements={placements}
            title={sign.name}
            language={RASHI_CHART_LANGUAGE}
          />
        </div>

        {(data.events.length > 0 || data.retrograde.length > 0) && (
          <div className="rounded-3xl border border-ved-green-900/10 bg-white p-5 shadow-sm">
            <h3 className="font-display text-lg font-semibold text-ved-green-900">In the sky {noun}</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-ved-green-900">
              {data.events.map((event) => (
                <li key={`${event.date}${event.text}`} className="flex gap-3">
                  <span className="w-16 shrink-0 text-xs font-semibold text-ved-gold-700">
                    {formatDay(event.date, { day: 'numeric', month: 'short' })}
                  </span>
                  {event.text}
                </li>
              ))}
              {data.retrograde.length > 0 && (
                <li className="text-ved-green-800/75">Retrograde now: {data.retrograde.join(', ')}</li>
              )}
            </ul>
          </div>
        )}

        <div className="rounded-3xl bg-gradient-to-br from-ved-green-800 to-ved-green-900 p-5 text-white shadow-sm">
          <h3 className="font-display text-lg font-semibold">Want it for your own chart?</h3>
          <p className="mt-1 text-sm text-white/75">
            Sign horoscopes are general. For a reading from your full birth chart and running dasha, ask our AI
            astrologer or a live expert.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/ai?astrologer=vedic"
              className="rounded-lg bg-ved-gold-400 px-4 py-2 text-sm font-semibold text-ved-green-950 transition hover:bg-ved-gold-300"
            >
              Ask Acharya Veda (AI)
            </Link>
            <Link href="/astrologers" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold transition hover:bg-white/10">
              Talk to an astrologer
            </Link>
          </div>
        </div>
      </aside>
    </section>
  );
}

export function HoroscopePage() {
  const [period, setPeriod] = useState<HoroscopePeriod>('daily');
  const [sign, setSign] = useState(1);
  const [data, setData] = useState<Partial<Record<HoroscopePeriod, Horoscope>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('period');
    if (p === 'daily' || p === 'weekly' || p === 'monthly') setPeriod(p);
    const fromUrl = SIGN_SLUGS.indexOf((params.get('sign') ?? '') as (typeof SIGN_SLUGS)[number]);
    const stored = Number(window.localStorage.getItem(STORED_SIGN));
    if (fromUrl >= 0) setSign(fromUrl + 1);
    else if (stored >= 1 && stored <= 12) setSign(stored);
    else if (session.token) {
      void api
        .get<Kundali>('vedic/kundali?depth=1')
        .then((k) => {
          const moon = k.chart.planets.find((planet) => planet.body === 'Moon');
          if (moon) setSign(moon.zodiac_sign);
        })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (data[period]) return;
    setError(null);
    let cancelled = false;
    api
      .get<Horoscope>(`vedic/horoscope?period=${period}`)
      .then((result) => {
        if (!cancelled) setData((prev) => ({ ...prev, [period]: result }));
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load the horoscope');
      });
    return () => {
      cancelled = true;
    };
  }, [period, data]);

  function update(next: { period?: HoroscopePeriod; sign?: number }) {
    const p = next.period ?? period;
    const s = next.sign ?? sign;
    setPeriod(p);
    setSign(s);
    if (next.sign) window.localStorage.setItem(STORED_SIGN, String(next.sign));
    const url = new URL(window.location.href);
    url.searchParams.set('period', p);
    url.searchParams.set('sign', SIGN_SLUGS[s - 1]!);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }

  const current = data[period];
  const selected = current?.signs.find((s) => s.sign === sign);

  return (
    <div className="bg-ved-cream-100">
      <section className="bg-gradient-to-br from-ved-green-800 via-ved-green-700 to-ved-green-950 text-white">
        <div className="mx-auto max-w-7xl px-4 pb-10 pt-10 sm:pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ved-gold-300">Rashifal</p>
          <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">Daily, Weekly &amp; Monthly Horoscope</h1>
          <p className="mt-3 max-w-2xl text-sm text-white/75 sm:text-base">
            Vedic horoscopes for your Moon sign (rashi), worked out from the real planetary transits with the classical
            Gochara rules, not generic sun-sign copy.
          </p>
          <div role="tablist" aria-label="Horoscope period" className="mt-6 inline-flex rounded-full bg-white/10 p-1 ring-1 ring-white/15">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === period}
                onClick={() => update({ period: p.id })}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
                  p.id === period ? 'bg-ved-gold-400 text-ved-green-950 shadow' : 'text-white/80 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {current && <p className="mt-3 text-sm text-ved-gold-200">{periodLabel(current)}</p>}
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl font-semibold text-ved-green-900">Choose your Moon sign</h2>
            <Link href="/kundali" className="text-sm font-semibold text-ved-green-700 underline-offset-2 hover:underline">
              Don&apos;t know your Moon sign? Get your free Kundali
            </Link>
          </div>
          <div role="group" aria-label="Zodiac signs" className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 lg:gap-3">
            {SIGN_SLUGS.map((slug, index) => {
              const number = index + 1;
              const summary = current?.signs[index];
              const active = number === sign;
              return (
                <button
                  key={slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ sign: number })}
                  className={`flex flex-col items-center rounded-2xl border bg-white px-2 py-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400 ${
                    active
                      ? 'border-ved-gold-400 shadow-md ring-2 ring-ved-gold-300/70'
                      : 'border-ved-green-900/10 hover:-translate-y-0.5 hover:border-ved-gold-300 hover:shadow'
                  }`}
                >
                  <span className="text-2xl text-ved-gold-600">{GLYPHS[index]}</span>
                  <span className="mt-1 text-sm font-semibold capitalize text-ved-green-900">{slug}</span>
                  <span className="text-[11px] text-ved-green-800/55">{summary?.vedicName ?? '\u00A0'}</span>
                  <span className="mt-1 h-4">{summary && <Stars value={summary.overall} size="text-xs" />}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
        {!current && !error && (
          <p className="animate-pulse rounded-3xl bg-white px-6 py-16 text-center text-sm text-ved-green-800/60">
            Reading the planets…
          </p>
        )}
        {current && selected && <SignReading data={current} sign={selected} />}

        <p className="text-xs leading-relaxed text-ved-green-800/55">
          Positions are sidereal (Lahiri ayanamsha) and sampled at noon IST for each day of the period. Horoscopes by
          Moon sign are general guidance for reflection, not a substitute for professional advice.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
