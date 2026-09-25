import { describe, expect, it } from 'vitest';

import {
  AI_ASTROLOGER_IDS,
  majorAspects,
  nadiBrief,
  numerologyBrief,
  SYSTEM_PROMPTS,
  tropicalLongitude,
  westernBrief,
} from '../src/services/ai-astrologers.js';
import type { GocharPlanet, NatalChartOutput } from '../src/services/astro.client.js';
import { buildReading } from '../src/services/numerology.js';

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

function planet(body: string, siderealLongitude: number, retro = false) {
  const sign = Math.floor(siderealLongitude / 30);
  return {
    body,
    sidereal_longitude: siderealLongitude,
    sidereal_latitude: 0,
    degrees_in_sign: siderealLongitude % 30,
    zodiac_sign: sign + 1,
    zodiac_sign_name: SIGNS[sign]!,
    nakshatra: 1,
    nakshatra_name: 'Ashwini',
    nakshatra_pada: 1,
    house: 1,
    speed_deg_per_day: 1,
    is_retrograde: retro,
  };
}

// Ayanamsha 24°: sidereal Sun 10° Aries (10°) is tropical 4° Taurus (34°).
const chart: NatalChartOutput = {
  dob_utc: '1990-05-15T06:30:00Z',
  julian_day_ut: 0,
  ayanamsha: 24,
  ayanamsha_system: 'LAHIRI',
  node_type: 'TRUE',
  latitude: 19,
  longitude: 72.8,
  ascendant: { sidereal_longitude: 100, degrees_in_sign: 10, zodiac_sign: 4, zodiac_sign_name: 'Cancer', nakshatra: 8, nakshatra_name: 'Pushya', nakshatra_pada: 2 },
  planets: [
    planet('Sun', 10),
    planet('Moon', 130),
    planet('Jupiter', 250),
    planet('Saturn', 280, true),
    planet('Rahu', 300),
    planet('Ketu', 120),
  ],
  house_cusps: [],
};

function transit(body: string, siderealLongitude: number): GocharPlanet {
  const p = planet(body, siderealLongitude);
  return { ...p, house_from_natal_lagna: null, house_from_transit_lagna: null };
}

describe('AI astrologers', () => {
  it('has a system prompt for each of the four traditions', () => {
    expect(AI_ASTROLOGER_IDS).toEqual(['vedic', 'nadi', 'western', 'numerology']);
    expect(SYSTEM_PROMPTS.nadi).toMatch(/Bhrigu Nandi Nadi/);
    expect(SYSTEM_PROMPTS.western).toMatch(/tropical/);
    expect(SYSTEM_PROMPTS.numerology).toMatch(/Life Path/);
  });

  it('converts sidereal to tropical by adding the ayanamsha', () => {
    expect(tropicalLongitude(10, 24)).toBe(34);
    expect(tropicalLongitude(350, 24)).toBe(14);
  });

  it('finds major aspects within orb, tightest first', () => {
    const aspects = majorAspects([
      { name: 'Sun', longitude: 10 },
      { name: 'Moon', longitude: 132 },
      { name: 'Mars', longitude: 187 },
    ]);
    expect(aspects).toEqual([
      { a: 'Sun', b: 'Moon', name: 'trine', orb: 2 },
      { a: 'Sun', b: 'Mars', name: 'opposition', orb: 3 },
      { a: 'Moon', b: 'Mars', name: 'sextile', orb: 5 },
    ]);
  });
});

describe('western brief', () => {
  it('uses tropical signs, whole-sign houses and western node names', () => {
    const brief = westernBrief(chart, false);
    // Tropical Ascendant 124° = Leo 4°, so tropical Sun in Taurus sits in the 10th house.
    expect(brief).toContain('BIG THREE: Sun Taurus, Moon Virgo, Ascendant Leo 4.0°');
    expect(brief).toContain('Sun: Taurus 4.0° | house 10');
    expect(brief).toContain('North Node:');
    expect(brief).not.toContain('Rahu');
    expect(brief).toContain('Sun trine Jupiter');
  });

  it('warns when the birth time is assumed and lists slow transits', () => {
    const brief = westernBrief(chart, true, [transit('Jupiter', 70), transit('Moon', 5)], 24.2);
    expect(brief).toMatch(/Birth time unknown/);
    expect(brief).toContain('CURRENT TRANSITS (tropical):');
    expect(brief).toContain('Jupiter: Cancer 4.2° | natal house 12');
    expect(brief).not.toMatch(/CURRENT TRANSITS[\s\S]*Moon:/);
  });
});

describe('nadi brief', () => {
  it('reads planets by sidereal sign links, skipping the Rahu-Ketu axis', () => {
    const brief = nadiBrief(chart);
    // Sun in Aries, Moon in Leo, Jupiter in Sagittarius: a fire trine.
    expect(brief).toContain('Moon is trine (5th) from Sun');
    expect(brief).toContain('Jupiter is trine (9th) from Sun');
    // Saturn (Capricorn) and Rahu (Aquarius) are adjacent signs.
    expect(brief).toContain('Rahu is 2nd from Saturn');
    expect(brief).not.toMatch(/Ketu is .* Rahu|Rahu is .* Ketu/);
  });

  it('times events by transits over natal planets', () => {
    const brief = nadiBrief(chart, [transit('Jupiter', 5), transit('Saturn', 200), transit('Rahu', 50)]);
    expect(brief).toContain('Transit Jupiter in Aries — activates natal Sun, Moon, Jupiter, Ketu');
    expect(brief).toContain('Transit Saturn in Libra — activates natal Rahu');
    // Taurus: its trines Virgo and Capricorn hold Saturn only.
    expect(brief).toContain('Transit Rahu in Taurus — activates natal Saturn');
  });
});

describe('numerology brief', () => {
  it('summarises the reading for the numerologist', () => {
    const reading = buildReading('John Smith', '1990-05-15', new Date('2026-09-25T12:00:00Z'));
    const brief = numerologyBrief(reading, 2026);
    expect(brief).toContain('NAME USED: John Smith');
    expect(brief).toContain('Life Path: 3 — The Communicator; ruled by Jupiter (Guru)');
    expect(brief).toContain('Personality: 11 — The Illuminator (Master 11)');
    expect(brief).toContain('PERSONAL YEAR 2026: 3');
  });
});
