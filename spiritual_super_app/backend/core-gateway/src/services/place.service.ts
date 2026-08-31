import cities from 'all-the-cities';
import { DateTime } from 'luxon';
import tzLookup from 'tz-lookup';

export class PlaceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PlaceError';
    this.statusCode = statusCode;
  }
}

export interface PlaceMatch {
  readonly label: string;
  readonly name: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
  readonly population: number;
}

/**
 * Strips diacritics so "Surat" finds "Sūrat".
 *
 * The gazetteer stores transliterated names with macrons, which nobody types.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

type CityRecord = (typeof cities)[number];

/*
 * Built once at module load. The gazetteer is ~135k rows; folding names on every keystroke of every
 * user would be wasteful, and the data never changes at runtime.
 */
const index: ReadonlyArray<{ folded: string; foldedAlt: string; record: CityRecord }> = cities.map(
  (record) => ({
    folded: fold(record.name),
    foldedAlt: record.altName ? fold(record.altName) : '',
    record,
  }),
);

export const PlaceService = {
  /**
   * Searches the offline gazetteer for a birthplace.
   *
   * Deliberately offline: a birth-data form is the first thing a new user meets, and hanging it on a
   * third-party geocoder's rate limit or outage is not worth the extra coverage.
   *
   * Coverage is good but not complete -- the dataset omits some sizeable Indian cities -- which is why
   * the API also accepts explicit coordinates. The UI must show the resolved latitude, longitude and
   * timezone so a wrong match can be seen and corrected: four minutes of longitude moves the
   * ascendant by a degree, and a misplaced birthplace is a wrong chart that still looks plausible.
   */
  search(query: string, limit = 8): PlaceMatch[] {
    const needle = fold(query);
    if (needle.length < 2) {
      return [];
    }

    const exact: typeof index[number][] = [];
    const prefix: typeof index[number][] = [];
    const contains: typeof index[number][] = [];

    for (const entry of index) {
      if (entry.folded === needle || entry.foldedAlt === needle) {
        exact.push(entry);
      } else if (entry.folded.startsWith(needle) || entry.foldedAlt.startsWith(needle)) {
        prefix.push(entry);
      } else if (entry.folded.includes(needle) || entry.foldedAlt.includes(needle)) {
        contains.push(entry);
      }
    }

    // Best match quality first, then by population: someone typing "Nashik" wants the city, not a
    // hamlet that happens to share the name.
    const byPopulation = (a: typeof index[number], b: typeof index[number]): number =>
      b.record.population - a.record.population;

    return [...exact.sort(byPopulation), ...prefix.sort(byPopulation), ...contains.sort(byPopulation)]
      .slice(0, limit)
      .map((entry) => this.describe(entry.record));
  },

  describe(record: CityRecord): PlaceMatch {
    const [longitude, latitude] = record.loc.coordinates;
    return {
      label: `${record.name}, ${record.country}`,
      name: record.name,
      country: record.country,
      latitude,
      longitude,
      timezone: this.timezoneAt(latitude, longitude),
      population: record.population,
    };
  },

  /** Resolves the IANA zone from coordinates, offline. */
  timezoneAt(latitude: number, longitude: number): string {
    return tzLookup(latitude, longitude);
  },

  isKnownTimezone(timezone: string): boolean {
    return DateTime.local().setZone(timezone).isValid;
  },
};

export interface BirthInstantInput {
  /** "YYYY-MM-DD" in the birthplace's own calendar. */
  readonly date: string;
  /** "HH:mm" local, or undefined when the person does not know it. */
  readonly time?: string | undefined;
  readonly timezone: string;
}

export interface BirthInstant {
  readonly utc: Date;
  /** The offset actually applied, in minutes, e.g. 330 for IST. Surfaced so it can be checked. */
  readonly offsetMinutes: number;
  readonly timeAssumed: boolean;
}

/**
 * Converts a local wall-clock birth time into the UTC instant the ephemeris needs.
 *
 * This is the step every chart depends on, and the one most easily got wrong. It uses the IANA zone
 * rather than a fixed offset because offsets are historical facts: a birth in Kolkata in 1943 was at
 * +06:30 under the wartime shift, not the +05:30 that India has used since 1955. Luxon reads the
 * system tz database, so those transitions are applied rather than assumed away.
 */
export function toBirthInstant(input: BirthInstantInput): BirthInstant {
  if (!PlaceService.isKnownTimezone(input.timezone)) {
    throw new PlaceError(`Unknown timezone "${input.timezone}"`);
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  if (!dateMatch) {
    throw new PlaceError('Birth date must be YYYY-MM-DD');
  }
  const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])];

  const timeAssumed = input.time === undefined;
  let hour = 12;
  let minute = 0;
  if (input.time !== undefined) {
    const timeMatch = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(input.time);
    if (!timeMatch) {
      throw new PlaceError('Birth time must be HH:mm in 24-hour form');
    }
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
  }

  const local = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone: input.timezone },
  );

  if (!local.isValid) {
    throw new PlaceError(
      `Could not interpret ${input.date} ${input.time ?? '12:00'} in ${input.timezone}: ${local.invalidReason ?? 'invalid'}`,
    );
  }

  if (local.year !== year || local.month !== month || local.day !== day) {
    throw new PlaceError(`${input.date} is not a real date`);
  }

  /*
   * Rejects a wall-clock time that never existed in that zone, because a forward transition skipped
   * it. Luxon does not report these as invalid; it silently moves them forward by the gap, which
   * would answer a question the user did not ask. An hour of error is fifteen degrees of ascendant,
   * so the caller is told rather than guessed at. India's own 1942 shift created such a gap.
   *
   * The reverse case, a time that occurred twice when the clocks went back, is resolved to the first
   * occurrence; `offsetMinutes` is returned so the choice is visible rather than hidden.
   */
  if (local.hour !== hour || local.minute !== minute) {
    throw new PlaceError(
      `${input.date} ${input.time ?? '12:00'} never occurred in ${input.timezone}: ` +
        `the clocks moved forward over it, and the nearest real time is ${local.toFormat('HH:mm')}`,
    );
  }

  return {
    utc: local.toUTC().toJSDate(),
    offsetMinutes: local.offset,
    timeAssumed,
  };
}

/** Renders a stored UTC instant back in the birthplace's zone, for display. */
export function toLocalDisplay(utc: Date, timezone: string): { date: string; time: string; offset: string } {
  const local = DateTime.fromJSDate(utc, { zone: timezone });
  return {
    date: local.toFormat('yyyy-MM-dd'),
    time: local.toFormat('HH:mm'),
    offset: local.toFormat('ZZ'),
  };
}
