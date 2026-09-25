import { DateTime } from 'luxon';

import { AstroServiceClient } from './astro.client.js';
import { buildHoroscopes, type HoroscopePeriod, type SkySample } from './horoscope.js';

/** Horoscope days follow Indian civil time; the sky is sampled at local noon from Ujjain. */
const ZONE = 'Asia/Kolkata';
const UJJAIN = { latitude: 23.1765, longitude: 75.7885 };
const CACHE_MS = 3 * 60 * 60 * 1000;
const BATCH = 8;

export interface HoroscopeResponse extends ReturnType<typeof buildHoroscopes> {
  period: HoroscopePeriod;
  start: string;
  end: string;
  today: string;
  sky: {
    date: string;
    ayanamsha: number;
    planets: Array<{ body: string; sign: number; degree: number; retrograde: boolean; nakshatra: string }>;
  };
}

const cache = new Map<string, { expires: number; value: Promise<HoroscopeResponse> }>();

export function periodRange(period: HoroscopePeriod, today: DateTime): { start: DateTime; end: DateTime } {
  const day = today.startOf('day');
  if (period === 'weekly') return { start: day.startOf('week'), end: day.endOf('week').startOf('day') };
  if (period === 'monthly') return { start: day.startOf('month'), end: day.endOf('month').startOf('day') };
  return { start: day, end: day };
}

async function sample(date: DateTime): Promise<SkySample & { ayanamsha: number }> {
  const sky = await AstroServiceClient.gochar({
    transit_utc: date.set({ hour: 12, minute: 0 }).toUTC().toISO()!,
    ...UJJAIN,
  });
  return { date: date.toISODate()!, planets: sky.planets, ayanamsha: sky.ayanamsha };
}

async function compute(period: HoroscopePeriod, today: DateTime): Promise<HoroscopeResponse> {
  const { start, end } = periodRange(period, today);
  const days: DateTime[] = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) days.push(d);

  const samples: Array<SkySample & { ayanamsha: number }> = [];
  for (let i = 0; i < days.length; i += BATCH) {
    samples.push(...(await Promise.all(days.slice(i, i + BATCH).map(sample))));
  }
  const todayIso = today.toISODate()!;
  const reference = samples.find((s) => s.date === todayIso) ?? samples[0]!;

  return {
    period,
    start: start.toISODate()!,
    end: end.toISODate()!,
    today: todayIso,
    sky: {
      date: reference.date,
      ayanamsha: reference.ayanamsha,
      planets: reference.planets.map((p) => ({
        body: p.body,
        sign: p.zodiac_sign,
        degree: Math.round(p.degrees_in_sign * 10) / 10,
        retrograde: p.is_retrograde,
        nakshatra: p.nakshatra_name,
      })),
    },
    ...buildHoroscopes(period, samples, reference),
  };
}

export const HoroscopeService = {
  /** Every sign's horoscope for the current day, week (Mon–Sun) or calendar month, in IST. */
  forPeriod(period: HoroscopePeriod, now: Date = new Date()): Promise<HoroscopeResponse> {
    const today = DateTime.fromJSDate(now, { zone: ZONE });
    const key = `${period}:${today.toISODate()}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;

    const value = compute(period, today);
    cache.set(key, { expires: Date.now() + CACHE_MS, value });
    value.catch(() => cache.delete(key));
    for (const [k, entry] of cache) if (entry.expires <= Date.now()) cache.delete(k);
    return value;
  },
};
