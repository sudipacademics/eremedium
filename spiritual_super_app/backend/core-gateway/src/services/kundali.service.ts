import { CallSessionStatus } from '@prisma/client';
import { createHash } from 'node:crypto';

import { logger } from '../lib/logger.js';
import { Prisma, prisma } from '../lib/prisma.js';
import {
  AstroServiceClient,
  type DashaOutput,
  type NatalChartOutput,
} from './astro.client.js';
import { PlaceService, toBirthInstant, toLocalDisplay } from './place.service.js';

export class KundaliError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'KundaliError';
    this.statusCode = statusCode;
  }
}

/**
 * The conventions every cached chart was computed under.
 *
 * Part of the cache fingerprint, so that changing any of them produces new rows instead of silently
 * serving longitudes computed the old way. Bump this whenever the compute service's ayanamsha, node
 * type or house system changes.
 */
export const ENGINE_REVISION = 'lahiri-truenode-placidus-v1';

export interface BirthProfileInput {
  readonly birthDate: string;
  readonly birthTime?: string | undefined;
  readonly timezone: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly placeLabel: string;
}

export interface BirthProfileView {
  readonly complete: boolean;
  readonly birthDate: string | null;
  readonly birthTime: string | null;
  readonly birthTimeKnown: boolean;
  readonly timezone: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly placeLabel: string | null;
  /** The offset actually used, e.g. "+05:30". Shown so a wrong zone is visible, not buried. */
  readonly utcOffset: string | null;
  readonly birthInstantUtc: string | null;
}

export interface KundaliView {
  readonly profile: BirthProfileView;
  readonly chart: NatalChartOutput;
  readonly dasha: DashaOutput;
  /**
   * True when the chart was built from an assumed noon because no birth time is known.
   *
   * The ascendant and all house placements are meaningless in that case, and the client is expected
   * to say so rather than draw a lagna the user might believe.
   */
  readonly birthTimeAssumed: boolean;
  readonly engineRevision: string;
  readonly fromCache: boolean;
}

function fingerprintOf(birthInstant: Date, latitude: number, longitude: number): string {
  /*
   * Coordinates are rounded to six decimals -- about 11 cm -- before hashing, matching the precision
   * the database column stores. Without that, 25.3176450001 and 25.317645 would be two cache entries
   * for one chart.
   */
  const parts = [
    birthInstant.toISOString(),
    latitude.toFixed(6),
    longitude.toFixed(6),
    ENGINE_REVISION,
  ].join('|');
  return createHash('sha256').update(parts).digest('hex');
}

export const KundaliService = {
  async saveBirthProfile(userId: string, input: BirthProfileInput): Promise<BirthProfileView> {
    if (!PlaceService.isKnownTimezone(input.timezone)) {
      throw new KundaliError(`Unknown timezone "${input.timezone}"`, 400);
    }

    // Throws on an impossible date or a wall-clock time the zone skipped.
    const instant = toBirthInstant({
      date: input.birthDate,
      time: input.birthTime,
      timezone: input.timezone,
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        dob: instant.utc,
        birthDateLocal: new Date(`${input.birthDate}T00:00:00.000Z`),
        birthTimeLocal: input.birthTime ?? null,
        birthTimeKnown: input.birthTime !== undefined,
        birthTimezone: input.timezone,
        latitude: new Prisma.Decimal(input.latitude.toFixed(6)),
        longitude: new Prisma.Decimal(input.longitude.toFixed(6)),
        birthPlace: input.placeLabel,
      },
    });

    logger.info(
      { userId, timezone: input.timezone, offsetMinutes: instant.offsetMinutes, timeKnown: !instant.timeAssumed },
      'Birth profile saved',
    );

    return this.getBirthProfile(userId);
  },

  async getBirthProfile(userId: string): Promise<BirthProfileView> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        dob: true,
        birthDateLocal: true,
        birthTimeLocal: true,
        birthTimeKnown: true,
        birthTimezone: true,
        latitude: true,
        longitude: true,
        birthPlace: true,
      },
    });

    const complete =
      user.dob !== null &&
      user.birthTimezone !== null &&
      user.latitude !== null &&
      user.longitude !== null;

    if (!complete || user.dob === null || user.birthTimezone === null) {
      return {
        complete: false,
        birthDate: null,
        birthTime: null,
        birthTimeKnown: false,
        timezone: user.birthTimezone,
        latitude: user.latitude === null ? null : Number(user.latitude),
        longitude: user.longitude === null ? null : Number(user.longitude),
        placeLabel: user.birthPlace,
        utcOffset: null,
        birthInstantUtc: null,
      };
    }

    const display = toLocalDisplay(user.dob, user.birthTimezone);

    return {
      complete: true,
      // Rendered from the stored instant in the birthplace's zone, so what is shown is what the
      // ephemeris was actually given rather than a separately stored string that could drift.
      birthDate: display.date,
      birthTime: user.birthTimeKnown ? display.time : null,
      birthTimeKnown: user.birthTimeKnown,
      timezone: user.birthTimezone,
      latitude: user.latitude === null ? null : Number(user.latitude),
      longitude: user.longitude === null ? null : Number(user.longitude),
      placeLabel: user.birthPlace,
      utcOffset: display.offset,
      birthInstantUtc: user.dob.toISOString(),
    };
  },

  /**
   * Returns the chart for a birth moment, computing it only if it has never been computed before.
   *
   * The cache is keyed by the inputs rather than by user, so it is safe to reuse across people and
   * needs no invalidation: Swiss Ephemeris is deterministic, and the engine's conventions are part of
   * the key.
   */
  async chartFor(
    birthInstant: Date,
    latitude: number,
    longitude: number,
  ): Promise<{ chart: NatalChartOutput; fromCache: boolean }> {
    const fingerprint = fingerprintOf(birthInstant, latitude, longitude);

    const cached = await prisma.natalChart.findUnique({ where: { fingerprint } });
    if (cached) {
      return { chart: cached.chart as unknown as NatalChartOutput, fromCache: true };
    }

    const chart = await AstroServiceClient.natalChart({
      dob_utc: birthInstant.toISOString(),
      latitude,
      longitude,
    });

    await prisma.natalChart.upsert({
      where: { fingerprint },
      // A concurrent request may have stored the identical chart first; the row is a pure function of
      // the key, so the loser of that race has nothing to correct.
      update: {},
      create: {
        fingerprint,
        birthInstant,
        latitude: new Prisma.Decimal(latitude.toFixed(6)),
        longitude: new Prisma.Decimal(longitude.toFixed(6)),
        engineRevision: ENGINE_REVISION,
        ayanamsha: new Prisma.Decimal(chart.ayanamsha.toFixed(6)),
        chart: chart as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info({ fingerprint, latitude, longitude }, 'Natal chart computed and cached');
    return { chart, fromCache: false };
  },

  async kundaliFor(userId: string, dashaDepth = 2): Promise<KundaliView> {
    const profile = await this.getBirthProfile(userId);
    if (!profile.complete || profile.birthInstantUtc === null) {
      throw new KundaliError('Birth details are needed before a kundali can be cast', 428);
    }

    const birthInstant = new Date(profile.birthInstantUtc);
    const { chart, fromCache } = await this.chartFor(
      birthInstant,
      profile.latitude as number,
      profile.longitude as number,
    );

    const moon = chart.planets.find((planet) => planet.body === 'Moon');
    if (!moon) {
      throw new KundaliError('Chart is missing the Moon, so no dasha can be derived');
    }

    const dasha = await AstroServiceClient.vimshottariDasha({
      moon_sidereal_longitude: moon.sidereal_longitude,
      birth_utc: birthInstant.toISOString(),
      depth: dashaDepth,
      // The dasha cycle is 120 years; asking for the whole span at depth 3 builds 729 nested periods
      // per request and nothing caches it, so the horizon is kept to a human lifetime of interest.
      horizon_years: 100,
    });

    return {
      profile,
      chart,
      dasha,
      birthTimeAssumed: !profile.birthTimeKnown,
      engineRevision: ENGINE_REVISION,
      fromCache,
    };
  },

  /**
   * The chart of the person an astrologer is currently consulting.
   *
   * Gated on a live call rather than on the astrologer role. Birth date, time and place is precisely
   * the data used to impersonate someone, and an astrologer has no standing to read it for a user who
   * is not in front of them; access ends when the call does.
   */
  async kundaliForConsultation(astrologerId: string, userId: string): Promise<KundaliView> {
    const session = await prisma.callSession.findFirst({
      where: {
        astrologerId,
        userId,
        status: { in: [CallSessionStatus.ACTIVE, CallSessionStatus.INITIATED] },
      },
      select: { id: true },
    });
    if (!session) {
      throw new KundaliError('You are not currently in a consultation with this person', 403);
    }

    logger.info({ astrologerId, userId, callSessionId: session.id }, 'Astrologer opened a client kundali');
    return this.kundaliFor(userId);
  },
} as const;
