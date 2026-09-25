import { describe, expect, it } from 'vitest';

import {
  BODIES,
  buildHoroscopes,
  houseFrom,
  signHoroscope,
  skyEvents,
  toStars,
  type SkySample,
} from '../src/services/horoscope.js';

function sky(date: string, signs: Partial<Record<string, number>>, retro: string[] = []): SkySample {
  return {
    date,
    planets: BODIES.map((body) => ({
      body,
      zodiac_sign: signs[body] ?? 1,
      degrees_in_sign: 10,
      is_retrograde: retro.includes(body) || body === 'Rahu' || body === 'Ketu',
      nakshatra_name: 'Ashwini',
    })),
  };
}

const everywhere = (sign: number) => Object.fromEntries(BODIES.map((b) => [b, sign]));

describe('houseFrom', () => {
  it('counts houses inclusively from the Moon sign', () => {
    expect(houseFrom(1, 1)).toBe(1);
    expect(houseFrom(12, 1)).toBe(2);
    expect(houseFrom(5, 4)).toBe(12);
    expect(houseFrom(1, 11)).toBe(11);
  });
});

describe('toStars', () => {
  it('maps a favourable share onto 1..5 in half steps', () => {
    expect(toStars(0)).toBe(1);
    expect(toStars(0.1)).toBe(1);
    expect(toStars(0.425)).toBe(3);
    expect(toStars(0.75)).toBe(5);
    expect(toStars(1)).toBe(5);
  });
});

describe('signHoroscope', () => {
  it('rates every graha in the 11th house (gains) as a five-star day', () => {
    const day = sky('2026-09-25', everywhere(11));
    const aries = signHoroscope(1, 'daily', [day], day);
    expect(aries.overall).toBe(5);
    expect(aries.areas).toEqual({ love: 5, career: 5, money: 5, health: 5 });
    expect(aries.headline).toBe('An excellent day: the stars are firmly on your side');
    expect(aries.influences[0]!.body).toBe('Moon');
    expect(aries.influences[0]!.text).toContain('Moon in your 11th house (gains, friends and ambitions)');
    expect(aries.remedy).toContain('Mars, your sign lord, on Tuesday');
    expect(aries.lucky).toEqual({ colour: 'Red', day: 'Tuesday', number: 9 });
  });

  it('flags Chandrashtama and suggests a remedy for the hardest graha', () => {
    const day = sky('2026-09-25', everywhere(8));
    const aries = signHoroscope(1, 'daily', [day], day);
    // Only Mercury and Venus are favourable in the 8th: (1 + 1) / 11 of the daily weight.
    expect(aries.overall).toBe(1.5);
    expect(aries.moon).toEqual({ sign: 8, house: 8, nakshatra: 'Ashwini', chandrashtama: true });
    expect(aries.remedy).toContain('Om Gurave Namah');
    expect(aries.headline).toContain('demanding day');
  });

  it('picks best days (upcoming first) and Chandrashtama days from the Moon across the week', () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((moon, i) => sky(`2026-09-2${i + 1}`, { ...everywhere(3), Moon: moon }));
    const libra = signHoroscope(7, 'weekly', week, week[4]!);
    expect(libra.cautionDays).toEqual(['2026-09-22']);
    // Favourable Moon on the 21st, 24th, 25th and 27th; from the 25th, both upcoming days win a slot.
    expect(libra.bestDays).toEqual(['2026-09-21', '2026-09-25', '2026-09-27']);
    expect(libra.moon).toBeNull();
    expect(libra.influences.map((i) => i.body)).not.toContain('Moon');
  });

  it('uses the sign a planet holds for most of the period', () => {
    const month = [
      sky('2026-09-01', { ...everywhere(1), Jupiter: 2 }),
      sky('2026-09-02', { ...everywhere(1), Jupiter: 3 }),
      sky('2026-09-03', { ...everywhere(1), Jupiter: 3 }),
    ];
    const aries = signHoroscope(1, 'monthly', month, month[0]!);
    expect(aries.influences.find((i) => i.body === 'Jupiter')).toMatchObject({ sign: 3, house: 3, favourable: false });
  });
});

describe('skyEvents', () => {
  it('reports ingresses and retrograde stations but not the Moon', () => {
    const events = skyEvents([
      sky('2026-09-21', { ...everywhere(5), Moon: 1 }),
      sky('2026-09-22', { ...everywhere(5), Moon: 2 }, ['Mercury']),
      sky('2026-09-23', { ...everywhere(5), Moon: 3, Venus: 6 }, ['Mercury']),
    ]);
    expect(events).toEqual([
      { date: '2026-09-22', text: 'Mercury turns retrograde' },
      { date: '2026-09-23', text: 'Venus enters Virgo (Kanya)' },
    ]);
  });
});

describe('buildHoroscopes', () => {
  it('covers all twelve signs and lists retrograde planets without the nodes', () => {
    const day = sky('2026-09-25', everywhere(4), ['Saturn']);
    const result = buildHoroscopes('daily', [day], day);
    expect(result.signs.map((s) => s.name)).toEqual([
      'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
      'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
    ]);
    expect(result.retrograde).toEqual(['Saturn']);
    expect(result.events).toEqual([]);
  });
});
