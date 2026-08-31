import { CallSessionStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { seedAstrologer, seedCallSession, seedUser } from './helpers/factories.js';

const natalChart = vi.hoisted(() => vi.fn());
const vimshottariDasha = vi.hoisted(() => vi.fn());

vi.mock('../src/services/astro.client.js', () => ({
  AstroServiceClient: { natalChart, vimshottariDasha },
  AstroServiceError: class AstroServiceError extends Error {},
}));

const { KundaliService, KundaliError, ENGINE_REVISION } = await import('../src/services/kundali.service.js');

/** A response shaped exactly like the compute service's NatalChartResponse. */
function chartFixture(overrides: Record<string, unknown> = {}) {
  return {
    dob_utc: '1994-08-16T22:15:00Z',
    julian_day_ut: 2449581.4270833335,
    ayanamsha: 23.781997,
    ayanamsha_system: 'CHITRA_PAKSHA_LAHIRI',
    node_type: 'TRUE_NODE',
    latitude: 25.317645,
    longitude: 83.005495,
    ascendant: {
      sidereal_longitude: 95.906653,
      degrees_in_sign: 5.906653,
      zodiac_sign: 4,
      zodiac_sign_name: 'Karka',
      nakshatra: 8,
      nakshatra_name: 'Pushya',
      nakshatra_pada: 1,
    },
    planets: [
      {
        body: 'Sun',
        sidereal_longitude: 120.020606,
        sidereal_latitude: 0.000108,
        degrees_in_sign: 0.020606,
        zodiac_sign: 5,
        zodiac_sign_name: 'Simha',
        nakshatra: 10,
        nakshatra_name: 'Magha',
        nakshatra_pada: 1,
        house: 2,
        speed_deg_per_day: 0.961101,
        is_retrograde: false,
      },
      {
        body: 'Moon',
        sidereal_longitude: 245.026887,
        sidereal_latitude: 3.223713,
        degrees_in_sign: 5.026887,
        zodiac_sign: 9,
        zodiac_sign_name: 'Dhanu',
        nakshatra: 19,
        nakshatra_name: 'Mula',
        nakshatra_pada: 2,
        house: 6,
        speed_deg_per_day: 13.92292,
        is_retrograde: false,
      },
    ],
    house_cusps: [],
    ...overrides,
  };
}

const dashaFixture = {
  birth_utc: '1994-08-16T22:15:00Z',
  moon_sidereal_longitude: 245.026887,
  birth_nakshatra: 19,
  birth_nakshatra_name: 'Mula',
  birth_nakshatra_lord: 'Ketu',
  balance_of_dasha_days: 1234.5,
  depth: 2,
  periods: [],
};

beforeEach(() => {
  natalChart.mockReset().mockResolvedValue(chartFixture());
  vimshottariDasha.mockReset().mockResolvedValue(dashaFixture);
});

afterEach(() => {
  vi.clearAllMocks();
});

const varanasi = {
  birthDate: '1994-08-17',
  birthTime: '03:45',
  timezone: 'Asia/Kolkata',
  latitude: 25.317645,
  longitude: 83.005495,
  placeLabel: 'Varanasi, IN',
};

describe('saving a birth profile', () => {
  it('stores the local details and the UTC instant they imply', async () => {
    const { userId } = await seedUser('0.00');

    const profile = await KundaliService.saveBirthProfile(userId, varanasi);

    expect(profile.complete).toBe(true);
    expect(profile.birthDate).toBe('1994-08-17');
    expect(profile.birthTime).toBe('03:45');
    expect(profile.birthTimeKnown).toBe(true);
    expect(profile.utcOffset).toBe('+05:30');
    expect(profile.birthInstantUtc).toBe('1994-08-16T22:15:00.000Z');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.dob?.toISOString()).toBe('1994-08-16T22:15:00.000Z');
    expect(row.birthTimezone).toBe('Asia/Kolkata');
    expect(row.birthTimeLocal).toBe('03:45');
  });

  /**
   * Storing only the instant would make the birth time unrecoverable, since an offset cannot be
   * inferred from a UTC timestamp. A 1943 birth is the case that proves it.
   */
  it('shows a wartime birth back at the offset in force then, not today\'s', async () => {
    const { userId } = await seedUser('0.00');

    const profile = await KundaliService.saveBirthProfile(userId, {
      ...varanasi,
      birthDate: '1943-05-15',
      birthTime: '09:20',
    });

    expect(profile.birthTime).toBe('09:20');
    expect(profile.utcOffset).toBe('+06:30');
    // 09:20 minus 6h30m. Under today's +05:30 it would be 03:50Z, an hour adrift and a chart that
    // still looks entirely plausible.
    expect(profile.birthInstantUtc).toBe('1943-05-15T02:50:00.000Z');
  });

  it('records an unknown birth time as unknown instead of inventing one', async () => {
    const { userId } = await seedUser('0.00');

    const profile = await KundaliService.saveBirthProfile(userId, {
      ...varanasi,
      birthTime: undefined,
    });

    expect(profile.birthTimeKnown).toBe(false);
    expect(profile.birthTime).toBeNull();
    // Noon is used for the calculation, but nothing claims it was the birth time.
    expect(profile.birthInstantUtc).toBe('1994-08-17T06:30:00.000Z');
  });

  it('reports an empty profile as incomplete rather than failing', async () => {
    const { userId } = await seedUser('0.00');

    const profile = await KundaliService.getBirthProfile(userId);

    expect(profile.complete).toBe(false);
    expect(profile.birthInstantUtc).toBeNull();
  });

  it('refuses an unknown timezone and a skipped wall-clock time', async () => {
    const { userId } = await seedUser('0.00');

    await expect(
      KundaliService.saveBirthProfile(userId, { ...varanasi, timezone: 'Asia/Ujjain' }),
    ).rejects.toThrow(/Unknown timezone/);
    await expect(
      KundaliService.saveBirthProfile(userId, {
        ...varanasi,
        birthDate: '2024-03-10',
        birthTime: '02:30',
        timezone: 'America/New_York',
      }),
    ).rejects.toThrow(/never occurred/);
  });

  it('lets a correction overwrite an earlier profile', async () => {
    const { userId } = await seedUser('0.00');
    await KundaliService.saveBirthProfile(userId, varanasi);

    const corrected = await KundaliService.saveBirthProfile(userId, { ...varanasi, birthTime: '04:15' });

    expect(corrected.birthTime).toBe('04:15');
    expect(corrected.birthInstantUtc).toBe('1994-08-16T22:45:00.000Z');
  });
});

describe('casting a kundali', () => {
  it('needs birth details first, and says which are missing with a 428', async () => {
    const { userId } = await seedUser('0.00');

    await expect(KundaliService.kundaliFor(userId)).rejects.toThrow(KundaliError);
    await expect(KundaliService.kundaliFor(userId)).rejects.toMatchObject({ statusCode: 428 });
    expect(natalChart).not.toHaveBeenCalled();
  });

  it('computes the chart and the dasha from the stored instant', async () => {
    const { userId } = await seedUser('0.00');
    await KundaliService.saveBirthProfile(userId, varanasi);

    const kundali = await KundaliService.kundaliFor(userId);

    expect(natalChart).toHaveBeenCalledWith({
      dob_utc: '1994-08-16T22:15:00.000Z',
      latitude: 25.317645,
      longitude: 83.005495,
    });
    expect(kundali.chart.ascendant.zodiac_sign_name).toBe('Karka');
    expect(kundali.birthTimeAssumed).toBe(false);
    expect(kundali.fromCache).toBe(false);

    // The dasha is derived from the Moon in the computed chart, not from the request.
    expect(vimshottariDasha).toHaveBeenCalledWith(
      expect.objectContaining({ moon_sidereal_longitude: 245.026887, depth: 2 }),
    );
  });

  it('flags a chart built on an assumed birth time', async () => {
    const { userId } = await seedUser('0.00');
    await KundaliService.saveBirthProfile(userId, { ...varanasi, birthTime: undefined });

    const kundali = await KundaliService.kundaliFor(userId);

    // The ascendant is present but meaningless; the client needs to know not to present it.
    expect(kundali.birthTimeAssumed).toBe(true);
  });
});

/**
 * A chart is a pure function of the birth instant, the coordinates and the engine's conventions, so
 * the cache never needs invalidating. It exists because an astrologer opens a client's chart mid-call,
 * where a round trip to the compute service is latency the caller can hear.
 */
describe('the chart cache', () => {
  it('computes once and serves the second request from Postgres', async () => {
    const { userId } = await seedUser('0.00');
    await KundaliService.saveBirthProfile(userId, varanasi);

    const first = await KundaliService.kundaliFor(userId);
    const second = await KundaliService.kundaliFor(userId);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(natalChart).toHaveBeenCalledTimes(1);
    expect(second.chart.ascendant.sidereal_longitude).toBe(first.chart.ascendant.sidereal_longitude);
    expect(await prisma.natalChart.count()).toBe(1);
  });

  it('shares one row between two people born at the same moment and place', async () => {
    const twinA = await seedUser('0.00');
    const twinB = await seedUser('0.00');
    await KundaliService.saveBirthProfile(twinA.userId, varanasi);
    await KundaliService.saveBirthProfile(twinB.userId, varanasi);

    await KundaliService.kundaliFor(twinA.userId);
    await KundaliService.kundaliFor(twinB.userId);

    expect(natalChart).toHaveBeenCalledTimes(1);
    expect(await prisma.natalChart.count()).toBe(1);
  });

  it('does not reuse a chart for a different birth time or place', async () => {
    const { userId } = await seedUser('0.00');

    await KundaliService.saveBirthProfile(userId, varanasi);
    await KundaliService.kundaliFor(userId);

    await KundaliService.saveBirthProfile(userId, { ...varanasi, birthTime: '04:15' });
    await KundaliService.kundaliFor(userId);

    await KundaliService.saveBirthProfile(userId, { ...varanasi, latitude: 19.9973, longitude: 73.791 });
    await KundaliService.kundaliFor(userId);

    expect(natalChart).toHaveBeenCalledTimes(3);
    expect(await prisma.natalChart.count()).toBe(3);
  });

  it('records the conventions the chart was computed under', async () => {
    const { userId } = await seedUser('0.00');
    await KundaliService.saveBirthProfile(userId, varanasi);
    await KundaliService.kundaliFor(userId);

    const row = await prisma.natalChart.findFirstOrThrow();
    // Part of the fingerprint, so changing ayanamsha or house system cannot silently reuse these
    // longitudes.
    expect(row.engineRevision).toBe(ENGINE_REVISION);
    expect(row.ayanamsha.toFixed(6)).toBe('23.781997');
  });

  it('survives two simultaneous first requests for the same chart', async () => {
    const { userId } = await seedUser('0.00');
    await KundaliService.saveBirthProfile(userId, varanasi);

    await Promise.all([KundaliService.kundaliFor(userId), KundaliService.kundaliFor(userId)]);

    expect(await prisma.natalChart.count()).toBe(1);
  });
});

/**
 * Birth date, time and place is exactly the data used to impersonate someone. An astrologer has no
 * standing to read it for a person who is not in front of them, so access follows the call.
 */
describe('an astrologer reading a client chart', () => {
  it('is allowed while the consultation is live', async () => {
    const { userId } = await seedUser('0.00');
    const { astrologerId } = await seedAstrologer();
    await seedCallSession({ userId, astrologerId, status: CallSessionStatus.ACTIVE });
    await KundaliService.saveBirthProfile(userId, varanasi);

    const kundali = await KundaliService.kundaliForConsultation(astrologerId, userId);

    expect(kundali.chart.ascendant.zodiac_sign_name).toBe('Karka');
    expect(kundali.profile.placeLabel).toBe('Varanasi, IN');
  });

  it('is refused for someone they are not consulting', async () => {
    const { userId } = await seedUser('0.00');
    const stranger = await seedAstrologer();
    await KundaliService.saveBirthProfile(userId, varanasi);

    await expect(KundaliService.kundaliForConsultation(stranger.astrologerId, userId)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(natalChart).not.toHaveBeenCalled();
  });

  it('is refused once the call has ended', async () => {
    const { userId } = await seedUser('0.00');
    const { astrologerId } = await seedAstrologer();
    await seedCallSession({ userId, astrologerId, status: CallSessionStatus.COMPLETED });
    await KundaliService.saveBirthProfile(userId, varanasi);

    await expect(KundaliService.kundaliForConsultation(astrologerId, userId)).rejects.toThrow(
      /not currently in a consultation/,
    );
  });

  it('is allowed from the moment the call is created, before media connects', async () => {
    const { userId } = await seedUser('0.00');
    const { astrologerId } = await seedAstrologer();
    await seedCallSession({ userId, astrologerId, status: CallSessionStatus.INITIATED });
    await KundaliService.saveBirthProfile(userId, varanasi);

    // The astrologer wants the chart open before they start talking.
    await expect(KundaliService.kundaliForConsultation(astrologerId, userId)).resolves.toBeDefined();
  });
});
