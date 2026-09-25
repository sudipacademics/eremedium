/**
 * Rashi (Moon-sign) horoscopes from real transits, using the classical Gochara rules: each graha is
 * favourable in fixed houses counted from the Moon sign (Phaladeepika ch. 26). Scores are the
 * weighted share of favourable placements across the period's daily sky samples.
 */

export const HOROSCOPE_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type HoroscopePeriod = (typeof HOROSCOPE_PERIODS)[number];

export const BODIES = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'] as const;
export type Body = (typeof BODIES)[number];

type Lord = 'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn';

export const SIGNS: ReadonlyArray<{ en: string; vedic: string; lord: Lord }> = [
  { en: 'Aries', vedic: 'Mesha', lord: 'Mars' },
  { en: 'Taurus', vedic: 'Vrishabha', lord: 'Venus' },
  { en: 'Gemini', vedic: 'Mithuna', lord: 'Mercury' },
  { en: 'Cancer', vedic: 'Karka', lord: 'Moon' },
  { en: 'Leo', vedic: 'Simha', lord: 'Sun' },
  { en: 'Virgo', vedic: 'Kanya', lord: 'Mercury' },
  { en: 'Libra', vedic: 'Tula', lord: 'Venus' },
  { en: 'Scorpio', vedic: 'Vrishchika', lord: 'Mars' },
  { en: 'Sagittarius', vedic: 'Dhanu', lord: 'Jupiter' },
  { en: 'Capricorn', vedic: 'Makara', lord: 'Saturn' },
  { en: 'Aquarius', vedic: 'Kumbha', lord: 'Saturn' },
  { en: 'Pisces', vedic: 'Meena', lord: 'Jupiter' },
];

/** Houses from the natal Moon in which each graha's transit is favourable. */
export const FAVOURABLE_HOUSES: Record<Body, ReadonlySet<number>> = {
  Sun: new Set([3, 6, 10, 11]),
  Moon: new Set([1, 3, 6, 7, 10, 11]),
  Mars: new Set([3, 6, 11]),
  Mercury: new Set([2, 4, 6, 8, 10, 11]),
  Jupiter: new Set([2, 5, 7, 9, 11]),
  Venus: new Set([1, 2, 3, 4, 5, 8, 9, 11, 12]),
  Saturn: new Set([3, 6, 11]),
  Rahu: new Set([3, 6, 11]),
  Ketu: new Set([3, 6, 11]),
};

/** How much each graha matters over the period: the Moon rules the day, slow planets the month. */
const PERIOD_WEIGHTS: Record<HoroscopePeriod, Record<Body, number>> = {
  daily: { Sun: 1, Moon: 3, Mars: 1, Mercury: 1, Jupiter: 1.5, Venus: 1, Saturn: 1.5, Rahu: 0.5, Ketu: 0.5 },
  weekly: { Sun: 1.5, Moon: 1.5, Mars: 1.5, Mercury: 1.5, Jupiter: 1.5, Venus: 1.5, Saturn: 1.5, Rahu: 0.5, Ketu: 0.5 },
  monthly: { Sun: 2, Moon: 0.5, Mars: 1.5, Mercury: 1, Jupiter: 2, Venus: 1, Saturn: 2, Rahu: 1, Ketu: 1 },
};

export const AREAS = ['love', 'career', 'money', 'health'] as const;
export type Area = (typeof AREAS)[number];

/** Karakas: which grahas speak for each area of life. */
const AREA_WEIGHTS: Record<Area, Partial<Record<Body, number>>> = {
  love: { Venus: 2, Moon: 1, Jupiter: 1, Mars: 0.5 },
  career: { Sun: 1.5, Saturn: 1.5, Mercury: 1, Jupiter: 1, Mars: 0.5 },
  money: { Jupiter: 2, Venus: 1, Mercury: 1, Moon: 0.5 },
  health: { Sun: 1.5, Mars: 1, Saturn: 1, Moon: 1 },
};

const HOUSE_TOPICS = [
  'self and vitality',
  'family and savings',
  'courage, siblings and short trips',
  'home, mother and peace of mind',
  'children, creativity and romance',
  'health, work and competition',
  'partnerships and marriage',
  'obstacles and sudden changes',
  'fortune, faith and elders',
  'career and reputation',
  'gains, friends and ambitions',
  'expenses, rest and faraway places',
] as const;

const GOOD: Record<Body, string> = {
  Sun: 'authority and recognition come more easily',
  Moon: 'the mood is buoyant and people respond warmly',
  Mars: 'energy and drive help you win',
  Mercury: 'communication, deals and learning flow well',
  Jupiter: 'growth, wise guidance and good fortune support you',
  Venus: 'comfort, affection and pleasant spending',
  Saturn: 'steady effort pays off with lasting results',
  Rahu: 'bold, unconventional moves can succeed',
  Ketu: 'detachment brings clarity and insight',
};

const HARD: Record<Body, string> = {
  Sun: 'ego clashes and fatigue need watching',
  Moon: 'emotions run high, so avoid reactive decisions',
  Mars: 'haste and temper can cause friction or minor injuries',
  Mercury: 'double-check messages, paperwork and plans',
  Jupiter: 'over-promising or complacency can dilute results',
  Venus: 'indulgence or misunderstandings in relationships',
  Saturn: 'delays and pressure test your patience',
  Rahu: 'confusion or restlessness, so verify before you trust',
  Ketu: 'you may feel disconnected, so slow down',
};

const REMEDIES: Record<Body, string> = {
  Sun: 'Offer water to the rising Sun and chant "Om Suryaya Namah".',
  Moon: 'On Monday, drink water from a silver vessel and chant "Om Chandraya Namah".',
  Mars: 'Recite the Hanuman Chalisa on Tuesday.',
  Mercury: 'On Wednesday, feed green grass to a cow and chant "Om Budhaya Namah".',
  Jupiter: 'On Thursday, offer yellow sweets or chana dal at a temple and chant "Om Gurave Namah".',
  Venus: 'On Friday, offer white flowers and chant "Om Shukraya Namah".',
  Saturn: 'On Saturday, light a sesame-oil lamp and chant "Om Shanaischaraya Namah".',
  Rahu: 'Chant "Om Rahave Namah" 108 times and donate to the needy on Saturday.',
  Ketu: 'Feed a stray dog and chant "Om Ketave Namah" on Tuesday.',
};

const LUCKY: Record<Lord, { colour: string; day: string; number: number }> = {
  Sun: { colour: 'Orange', day: 'Sunday', number: 1 },
  Moon: { colour: 'White', day: 'Monday', number: 2 },
  Mars: { colour: 'Red', day: 'Tuesday', number: 9 },
  Mercury: { colour: 'Green', day: 'Wednesday', number: 5 },
  Jupiter: { colour: 'Yellow', day: 'Thursday', number: 3 },
  Venus: { colour: 'Pink', day: 'Friday', number: 6 },
  Saturn: { colour: 'Blue', day: 'Saturday', number: 8 },
};

const PERIOD_NOUN: Record<HoroscopePeriod, string> = { daily: 'day', weekly: 'week', monthly: 'month' };
const INFLUENCE_COUNT: Record<HoroscopePeriod, number> = { daily: 4, weekly: 4, monthly: 5 };
const BEST_DAY_COUNT: Record<HoroscopePeriod, number> = { daily: 0, weekly: 3, monthly: 5 };

export interface SkyPlanet {
  readonly body: string;
  readonly zodiac_sign: number;
  readonly degrees_in_sign: number;
  readonly is_retrograde: boolean;
  readonly nakshatra_name: string;
}

export interface SkySample {
  /** Civil date (YYYY-MM-DD) the sample stands for. */
  readonly date: string;
  readonly planets: readonly SkyPlanet[];
}

export interface Influence {
  body: Body;
  sign: number;
  house: number;
  favourable: boolean;
  text: string;
}

export interface SignHoroscope {
  sign: number;
  name: string;
  vedicName: string;
  lord: Lord;
  overall: number;
  areas: Record<Area, number>;
  headline: string;
  summary: string;
  influences: Influence[];
  /** Days the Moon transits a favourable house (weekly/monthly). */
  bestDays: string[];
  /** Chandrashtama: the Moon in the 8th from the sign, traditionally a day for caution. */
  cautionDays: string[];
  moon: { sign: number; house: number; nakshatra: string; chandrashtama: boolean } | null;
  lucky: { colour: string; day: string; number: number };
  remedy: string;
}

export interface SkyEvent {
  date: string;
  text: string;
}

export function houseFrom(moonSign: number, planetSign: number): number {
  return ((((planetSign - moonSign) % 12) + 12) % 12) + 1;
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** Maps a favourable share (0..1) to 1..5 stars in half steps; typical skies land around 3. */
export function toStars(share: number): number {
  const stretched = Math.min(1, Math.max(0, (share - 0.1) / 0.65));
  return Math.round((1 + 4 * stretched) * 2) / 2;
}

function signOf(sample: SkySample, body: Body): SkyPlanet | undefined {
  return sample.planets.find((p) => p.body === body);
}

/** The sign a graha occupies for most of the period (ties go to the later sign). */
function dominantPlacement(samples: readonly SkySample[], body: Body): SkyPlanet | undefined {
  const counts = new Map<number, { n: number; planet: SkyPlanet }>();
  for (const sample of samples) {
    const planet = signOf(sample, body);
    if (!planet) continue;
    const entry = counts.get(planet.zodiac_sign);
    counts.set(planet.zodiac_sign, { n: (entry?.n ?? 0) + 1, planet });
  }
  let best: { n: number; planet: SkyPlanet } | undefined;
  for (const entry of counts.values()) if (!best || entry.n >= best.n) best = entry;
  return best?.planet;
}

function share(samples: readonly SkySample[], moonSign: number, weight: (body: Body) => number): number {
  let total = 0;
  let good = 0;
  for (const sample of samples) {
    for (const body of BODIES) {
      const planet = signOf(sample, body);
      const w = weight(body);
      if (!planet || w === 0) continue;
      total += w;
      if (FAVOURABLE_HOUSES[body].has(houseFrom(moonSign, planet.zodiac_sign))) good += w;
    }
  }
  return total === 0 ? 0.5 : good / total;
}

function headlineFor(stars: number, period: HoroscopePeriod): string {
  const noun = PERIOD_NOUN[period];
  if (stars >= 4.5) return `An excellent ${noun}: the stars are firmly on your side`;
  if (stars >= 3.5) return `A favourable ${noun} with good momentum`;
  if (stars >= 2.5) return `A mixed ${noun}: steady effort beats shortcuts`;
  if (stars >= 1.5) return `A demanding ${noun}: pace yourself and stay patient`;
  return `A testing ${noun}: keep things simple and lean on routine`;
}

const AREA_LABEL: Record<Area, string> = { love: 'Love', career: 'Career', money: 'Money', health: 'Health' };

export function signHoroscope(
  sign: number,
  period: HoroscopePeriod,
  samples: readonly SkySample[],
  reference: SkySample,
): SignHoroscope {
  const meta = SIGNS[sign - 1]!;
  const weights = PERIOD_WEIGHTS[period];

  const overall = toStars(share(samples, sign, (b) => weights[b]));
  const areas = Object.fromEntries(
    AREAS.map((area) => [area, toStars(share(samples, sign, (b) => weights[b] * (AREA_WEIGHTS[area][b] ?? 0)))]),
  ) as Record<Area, number>;

  const ranked = [...BODIES]
    .filter((b) => period === 'daily' || b !== 'Moon')
    .sort((a, b) => weights[b] - weights[a] || BODIES.indexOf(a) - BODIES.indexOf(b))
    .slice(0, INFLUENCE_COUNT[period]);
  const influences: Influence[] = [];
  for (const body of ranked) {
    const planet = period === 'daily' ? signOf(reference, body) : dominantPlacement(samples, body);
    if (!planet) continue;
    const house = houseFrom(sign, planet.zodiac_sign);
    const favourable = FAVOURABLE_HOUSES[body].has(house);
    influences.push({
      body,
      sign: planet.zodiac_sign,
      house,
      favourable,
      text: `${body} in your ${ordinal(house)} house (${HOUSE_TOPICS[house - 1]}): ${favourable ? GOOD[body] : HARD[body]}.`,
    });
  }

  const byArea = [...AREAS].sort((a, b) => areas[b] - areas[a]);
  const strongest = byArea[0]!;
  const weakest = byArea[byArea.length - 1]!;
  const focus =
    areas[strongest] === areas[weakest]
      ? 'All areas of life move at a similar pace.'
      : `${AREA_LABEL[strongest]} looks strongest, while ${AREA_LABEL[weakest].toLowerCase()} needs the most care.`;
  const lead = influences[0];
  const summary = [focus, lead ? lead.text : ''].filter(Boolean).join(' ');

  const bestDays: string[] = [];
  const cautionDays: string[] = [];
  if (period !== 'daily') {
    const scored: Array<{ date: string; score: number }> = [];
    for (const sample of samples) {
      const moon = signOf(sample, 'Moon');
      if (!moon) continue;
      const house = houseFrom(sign, moon.zodiac_sign);
      if (house === 8) cautionDays.push(sample.date);
      if (FAVOURABLE_HOUSES.Moon.has(house)) {
        scored.push({ date: sample.date, score: share([sample], sign, (b) => PERIOD_WEIGHTS.daily[b]) });
      }
    }
    scored
      .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
      .slice(0, BEST_DAY_COUNT[period])
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((d) => bestDays.push(d.date));
  }

  const refMoon = signOf(reference, 'Moon');
  const moon =
    period === 'daily' && refMoon
      ? {
          sign: refMoon.zodiac_sign,
          house: houseFrom(sign, refMoon.zodiac_sign),
          nakshatra: refMoon.nakshatra_name,
          chandrashtama: houseFrom(sign, refMoon.zodiac_sign) === 8,
        }
      : null;

  const troubled = influences.filter((i) => !i.favourable && i.body !== 'Moon');
  const remedy = troubled[0]
    ? REMEDIES[troubled[0].body]
    : `Keep the momentum: offer a short prayer to ${meta.lord}, your sign lord, on ${LUCKY[meta.lord].day}.`;

  return {
    sign,
    name: meta.en,
    vedicName: meta.vedic,
    lord: meta.lord,
    overall,
    areas,
    headline: headlineFor(overall, period),
    summary,
    influences,
    bestDays,
    cautionDays,
    moon,
    lucky: LUCKY[meta.lord],
    remedy,
  };
}

/** Sign changes and retrograde stations between consecutive samples (the Moon's daily moves are skipped). */
export function skyEvents(samples: readonly SkySample[]): SkyEvent[] {
  const events: SkyEvent[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    for (const body of BODIES) {
      if (body === 'Moon') continue;
      const a = signOf(prev, body);
      const b = signOf(curr, body);
      if (!a || !b) continue;
      if (a.zodiac_sign !== b.zodiac_sign) {
        const s = SIGNS[b.zodiac_sign - 1]!;
        events.push({ date: curr.date, text: `${body} enters ${s.en} (${s.vedic})` });
      }
      if (body !== 'Rahu' && body !== 'Ketu' && a.is_retrograde !== b.is_retrograde) {
        events.push({ date: curr.date, text: `${body} turns ${b.is_retrograde ? 'retrograde' : 'direct'}` });
      }
    }
  }
  return events;
}

export function buildHoroscopes(period: HoroscopePeriod, samples: readonly SkySample[], reference: SkySample) {
  return {
    signs: SIGNS.map((_, index) => signHoroscope(index + 1, period, samples, reference)),
    events: skyEvents(samples),
    retrograde: reference.planets
      .filter((p) => p.is_retrograde && p.body !== 'Rahu' && p.body !== 'Ketu')
      .map((p) => p.body),
  };
}
