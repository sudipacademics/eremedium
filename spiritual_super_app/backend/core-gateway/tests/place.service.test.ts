import { describe, expect, it } from 'vitest';

import { PlaceError, PlaceService, toBirthInstant, toLocalDisplay } from '../src/services/place.service.js';

describe('birthplace search', () => {
  it('finds a major Indian city with usable coordinates and zone', () => {
    const [first] = PlaceService.search('Varanasi');

    expect(first).toBeDefined();
    expect(first!.name).toBe('Varanasi');
    expect(first!.country).toBe('IN');
    expect(first!.latitude).toBeCloseTo(25.32, 1);
    expect(first!.longitude).toBeCloseTo(83.01, 1);
    expect(first!.timezone).toBe('Asia/Kolkata');
  });

  it('prefers the city people mean over a hamlet of the same name', () => {
    const results = PlaceService.search('Nashik');

    expect(results[0]!.name).toBe('Nashik');
    // Ordering is by population within match quality, so the 1.2 million city wins.
    expect(results[0]!.population).toBeGreaterThan(100_000);
  });

  /** The gazetteer spells transliterated names with macrons, which nobody types. */
  it('ignores diacritics, so "Surat" finds "Sūrat"', () => {
    const results = PlaceService.search('Surat');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.population).toBeGreaterThan(1_000_000);
  });

  it('ranks an exact name above a longer name that merely contains it', () => {
    const results = PlaceService.search('Ujjain');
    expect(results[0]!.name).toBe('Ujjain');
  });

  it('returns nothing for a single character rather than the whole gazetteer', () => {
    expect(PlaceService.search('a')).toEqual([]);
  });

  it('respects the result limit', () => {
    expect(PlaceService.search('San', 3)).toHaveLength(3);
  });

  it('resolves a timezone from bare coordinates, for places it does not list', () => {
    // Bhagalpur, which the dataset omits entirely: the manual-entry path must still work.
    expect(PlaceService.timezoneAt(25.2445, 86.9718)).toBe('Asia/Kolkata');
  });

  it('recognises real zones and rejects invented ones', () => {
    expect(PlaceService.isKnownTimezone('Asia/Kolkata')).toBe(true);
    expect(PlaceService.isKnownTimezone('Asia/Ujjain')).toBe(false);
  });
});

/**
 * The conversion from a local birth time to a UTC instant is the foundation every chart rests on. An
 * hour of error here moves the ascendant by fifteen degrees -- a different sign, different houses for
 * every planet, and a different dasha balance -- while still producing a chart that looks credible.
 */
describe('turning a local birth time into a UTC instant', () => {
  it('applies the modern Indian offset', () => {
    const instant = toBirthInstant({ date: '1994-08-17', time: '03:45', timezone: 'Asia/Kolkata' });

    expect(instant.offsetMinutes).toBe(330);
    expect(instant.utc.toISOString()).toBe('1994-08-16T22:15:00.000Z');
    expect(instant.timeAssumed).toBe(false);
  });

  /**
   * India ran on +06:30 during the 1942-45 wartime shift. A hardcoded +05:30 would misplace every
   * birth from those years by an hour, which is the single most common way this gets got wrong.
   */
  it('applies the 1942-45 wartime offset for a birth in those years', () => {
    const wartime = toBirthInstant({ date: '1943-05-15', time: '12:00', timezone: 'Asia/Kolkata' });
    expect(wartime.offsetMinutes).toBe(390);
    expect(wartime.utc.toISOString()).toBe('1943-05-15T05:30:00.000Z');

    const afterwards = toBirthInstant({ date: '1950-05-15', time: '12:00', timezone: 'Asia/Kolkata' });
    expect(afterwards.offsetMinutes).toBe(330);
  });

  it('applies Calcutta local mean time for a birth before 1906', () => {
    const instant = toBirthInstant({ date: '1905-05-15', time: '12:00', timezone: 'Asia/Kolkata' });

    // +05:21:10, the meridian of Calcutta, not a whole number of minutes.
    expect(instant.offsetMinutes).toBeCloseTo(321.17, 1);
  });

  it('applies daylight saving where it exists', () => {
    const summer = toBirthInstant({ date: '1980-06-15', time: '12:00', timezone: 'America/New_York' });
    const winter = toBirthInstant({ date: '1980-01-15', time: '12:00', timezone: 'America/New_York' });

    expect(summer.offsetMinutes).toBe(-240);
    expect(winter.offsetMinutes).toBe(-300);
  });

  it('assumes noon when the birth time is unknown, and says so', () => {
    const instant = toBirthInstant({ date: '1994-08-17', timezone: 'Asia/Kolkata' });

    expect(instant.timeAssumed).toBe(true);
    expect(instant.utc.toISOString()).toBe('1994-08-17T06:30:00.000Z');
  });

  /**
   * Luxon silently shifts a skipped wall-clock time forward. Accepting that would answer a question
   * the user did not ask, so this must be refused rather than adjusted.
   */
  it('refuses a wall-clock time the clocks jumped over', () => {
    expect(() =>
      toBirthInstant({ date: '2024-03-10', time: '02:30', timezone: 'America/New_York' }),
    ).toThrow(/never occurred/);
  });

  it('refuses impossible dates and malformed input', () => {
    expect(() => toBirthInstant({ date: '1994-02-30', time: '10:00', timezone: 'Asia/Kolkata' })).toThrow(
      PlaceError,
    );
    expect(() => toBirthInstant({ date: '17-08-1994', time: '10:00', timezone: 'Asia/Kolkata' })).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => toBirthInstant({ date: '1994-08-17', time: '25:00', timezone: 'Asia/Kolkata' })).toThrow(
      /HH:mm/,
    );
    expect(() => toBirthInstant({ date: '1994-08-17', time: '10:00', timezone: 'Asia/Ujjain' })).toThrow(
      /Unknown timezone/,
    );
  });

  it('round-trips an instant back to the local time it came from', () => {
    const instant = toBirthInstant({ date: '1994-08-17', time: '03:45', timezone: 'Asia/Kolkata' });
    const display = toLocalDisplay(instant.utc, 'Asia/Kolkata');

    expect(display.date).toBe('1994-08-17');
    expect(display.time).toBe('03:45');
    expect(display.offset).toBe('+05:30');
  });

  it('round-trips a wartime birth to the offset actually in force then', () => {
    const instant = toBirthInstant({ date: '1943-05-15', time: '09:20', timezone: 'Asia/Kolkata' });
    const display = toLocalDisplay(instant.utc, 'Asia/Kolkata');

    expect(display.time).toBe('09:20');
    expect(display.offset).toBe('+06:30');
  });
});
