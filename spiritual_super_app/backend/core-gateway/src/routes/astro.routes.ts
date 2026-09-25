import { Dosha } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { prisma } from '../lib/prisma.js';
import { authenticateUnlessPublic, requireAstrologer, requireRole, requireUser } from '../plugins/authenticate.js';
import { AiPredictionService } from '../services/ai-prediction.service.js';
import { AstroServiceClient } from '../services/astro.client.js';
import { KundaliService } from '../services/kundali.service.js';
import { PlaceService, toBirthInstant } from '../services/place.service.js';
import { OpenAiError } from '../services/openai.client.js';

const natalChartBody = z.object({
  dobUtc: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const dashaBody = z.object({
  moonSiderealLongitude: z.number().min(0).max(359.999999),
  birthUtc: z.string().datetime({ offset: true }),
  depth: z.number().int().min(1).max(5).default(3),
});

const prakritiBody = z.object({
  responses: z.record(z.string(), z.enum(['VATA', 'PITTA', 'KAPHA'])),
  persist: z.boolean().default(true),
});

const placeQuery = z.object({
  q: z.string().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const coordinateQuery = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const birthProfileBody = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD'),
  /*
   * Optional on purpose. Plenty of people genuinely do not know their birth time, and forcing a
   * value would put a fabricated ascendant in front of them; the profile records that it is unknown.
   */
  birthTime: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'birthTime must be HH:mm in 24-hour form')
    .optional(),
  timezone: z.string().min(3).max(64),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  placeLabel: z.string().min(2).max(180),
});

const kundaliQuery = z.object({
  // Depth 3 is 729 nested periods and nothing caches the dasha, so the ceiling is deliberate.
  depth: z.coerce.number().int().min(1).max(3).default(2),
});

const consultationParams = z.object({ userId: z.string().uuid() });

const panchangBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(3).max(64),
});

const matchPersonBody = z.object({
  label: z.string().min(1).max(80).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD'),
  birthTime: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'birthTime must be HH:mm in 24-hour form')
    .optional(),
  timezone: z.string().min(3).max(64),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  placeLabel: z.string().min(2).max(180).optional(),
});

const matchBody = z.object({
  boy: matchPersonBody,
  girl: matchPersonBody,
});

const gocharBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'time must be HH:mm')
    .optional(),
  timezone: z.string().min(3).max(64),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** When true (default), overlay houses from the signed-in user's natal Lagna if a profile exists. */
  useNatalOverlay: z.boolean().default(true),
});

const aiPredictBody = z.object({
  question: z.string().min(3).max(1_500),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4_000),
      }),
    )
    .max(6)
    .default([]),
  includeGochar: z.boolean().default(true),
});

/**
 * Thin proxy over the Python compute service. Nginx routes `/api/v1/astro/*` straight to FastAPI for
 * anonymous chart lookups; these authenticated variants additionally persist results against a user.
 */
export async function astroRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticateUnlessPublic);

  app.post('/natal-chart', async (request) => {
    requireUser(request);
    const body = natalChartBody.parse(request.body);
    return AstroServiceClient.natalChart({
      dob_utc: body.dobUtc,
      latitude: body.latitude,
      longitude: body.longitude,
    });
  });

  app.post('/vimshottari-dasha', async (request) => {
    requireUser(request);
    const body = dashaBody.parse(request.body);
    return AstroServiceClient.vimshottariDasha({
      moon_sidereal_longitude: body.moonSiderealLongitude,
      birth_utc: body.birthUtc,
      depth: body.depth,
    });
  });

  app.post('/prakriti-score', async (request) => {
    const claims = requireUser(request);
    const body = prakritiBody.parse(request.body);
    const scored = await AstroServiceClient.prakritiScore({ responses: body.responses });

    if (!body.persist) {
      return scored;
    }

    const profile = await prisma.ayurvedicProfile.create({
      data: {
        userId: claims.sub,
        prakritiPrimary: scored.prakriti_primary as Dosha,
        ...(scored.prakriti_secondary === null
          ? {}
          : { vikritiCurrent: scored.prakriti_secondary as Dosha }),
        dominantGuna: scored.dominant_guna,
        digestiveFire: scored.digestive_fire,
        vataScore: scored.distribution.vata_percent.toFixed(2),
        pittaScore: scored.distribution.pitta_percent.toFixed(2),
        kaphaScore: scored.distribution.kapha_percent.toFixed(2),
      },
      select: { id: true, createdAt: true },
    });

    return { ...scored, profileId: profile.id, createdAt: profile.createdAt.toISOString() };
  });

  // --- Birth profile and kundali ----------------------------------------------------------------

  /** Offline birthplace search. Returns the coordinates and zone so the client can show them. */
  app.get('/places', { config: { public: true } }, async (request) => {
    const { q, limit } = placeQuery.parse(request.query);
    return { places: PlaceService.search(q, limit) };
  });

  /**
   * The IANA zone at a coordinate pair.
   *
   * Needed because the gazetteer omits a great many Indian villages, so coordinate entry has to be a
   * first-class path -- and a birth time is uninterpretable without knowing the zone it was told in.
   */
  app.get('/timezone', { config: { public: true } }, async (request) => {
    const { latitude, longitude } = coordinateQuery.parse(request.query);
    return { latitude, longitude, timezone: PlaceService.timezoneAt(latitude, longitude) };
  });

  app.get('/birth-profile', async (request) => {
    const claims = requireUser(request);
    return KundaliService.getBirthProfile(claims.sub);
  });

  app.put('/birth-profile', async (request) => {
    const claims = requireUser(request);
    const body = birthProfileBody.parse(request.body);
    return KundaliService.saveBirthProfile(claims.sub, {
      birthDate: body.birthDate,
      birthTime: body.birthTime,
      timezone: body.timezone,
      latitude: body.latitude,
      longitude: body.longitude,
      placeLabel: body.placeLabel,
    });
  });

  /** The signed-in user's own chart. 428 until birth details exist. */
  app.get('/kundali', async (request) => {
    const claims = requireUser(request);
    const { depth } = kundaliQuery.parse(request.query);
    return KundaliService.kundaliFor(claims.sub, depth);
  });

  /**
   * A client's chart, for the astrologer consulting them right now.
   *
   * Authorised by the live call, not by the astrologer role: see kundaliForConsultation.
   */
  app.get('/kundali/consultation/:userId', { preHandler: requireRole(AppRole.ASTROLOGER) }, async (request) => {
    const { astrologerId } = requireAstrologer(request);
    const { userId } = consultationParams.parse(request.params);
    return KundaliService.kundaliForConsultation(astrologerId, userId);
  });

  /**
   * Daily panchang for a civil date at a place.
   *
   * The angas are evaluated at local sunrise, so the date is place-relative and the timezone is
   * required -- a UTC midnight would put the wrong sunrise under the wrong day near the dateline.
   */
  app.post(
    '/panchang',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = panchangBody.parse(request.body);
      if (!PlaceService.isKnownTimezone(body.timezone)) {
        return reply.code(400).send({ error: 'BAD_REQUEST', message: `Unknown timezone "${body.timezone}"` });
      }
      return AstroServiceClient.panchang({
        date: body.date,
        latitude: body.latitude,
        longitude: body.longitude,
        timezone: body.timezone,
      });
    },
  );

  /**
   * Ashtakoot / Guna Milan for two birth details.
   *
   * Charts are cast first so Moon nakshatra/sign (and Mars house when time is known) come from the
   * same Lahiri engine as kundali — not from a free-text nakshatra picker.
   */
  app.post(
    '/match',
    { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = matchBody.parse(request.body);

      for (const person of [body.boy, body.girl]) {
        if (!PlaceService.isKnownTimezone(person.timezone)) {
          return reply.code(400).send({
            error: 'BAD_REQUEST',
            message: `Unknown timezone "${person.timezone}"`,
          });
        }
      }

      const [boyChart, girlChart] = await Promise.all([
        castForMatch(body.boy),
        castForMatch(body.girl),
      ]);

      const score = await AstroServiceClient.ashtakoot({
        boy_nakshatra: boyChart.moon.nakshatra,
        girl_nakshatra: girlChart.moon.nakshatra,
        boy_moon_sign: boyChart.moon.zodiac_sign,
        girl_moon_sign: girlChart.moon.zodiac_sign,
        include_manglik: true,
        boy_mars_house: boyChart.marsHouse,
        girl_mars_house: girlChart.marsHouse,
        boy_birth_time_known: boyChart.birthTimeKnown,
        girl_birth_time_known: girlChart.birthTimeKnown,
      });

      return {
        ...score,
        boy: {
          label: body.boy.label ?? 'Boy',
          moonSign: boyChart.moon.zodiac_sign_name,
          moonNakshatra: boyChart.moon.nakshatra_name,
          moonPada: boyChart.moon.nakshatra_pada,
          birthTimeKnown: boyChart.birthTimeKnown,
          birthInstantUtc: boyChart.dobUtc,
        },
        girl: {
          label: body.girl.label ?? 'Girl',
          moonSign: girlChart.moon.zodiac_sign_name,
          moonNakshatra: girlChart.moon.nakshatra_name,
          moonPada: girlChart.moon.nakshatra_pada,
          birthTimeKnown: girlChart.birthTimeKnown,
          birthInstantUtc: girlChart.dobUtc,
        },
      };
    },
  );

  /**
   * Gochar — the transit sky at a civil date/time, optionally housed from the user's natal Lagna.
   * Guests get the transit sky only; the natal overlay needs a signed-in user's birth profile.
   */
  app.post(
    '/gochar',
    { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const claims = request.auth;
      const body = gocharBody.parse(request.body);
      if (!PlaceService.isKnownTimezone(body.timezone)) {
        return reply.code(400).send({ error: 'BAD_REQUEST', message: `Unknown timezone "${body.timezone}"` });
      }

      const instant = toBirthInstant({
        date: body.date,
        time: body.time,
        timezone: body.timezone,
      });

      let natalAscendant: number | undefined;
      let natalMoon: number | undefined;
      let natalOverlayApplied = false;
      let birthTimeAssumed = false;

      if (body.useNatalOverlay && claims) {
        try {
          const kundali = await KundaliService.kundaliFor(claims.sub, 1);
          natalAscendant = kundali.chart.ascendant.sidereal_longitude;
          const moon = kundali.chart.planets.find((p) => p.body === 'Moon');
          natalMoon = moon?.sidereal_longitude;
          natalOverlayApplied = true;
          birthTimeAssumed = kundali.birthTimeAssumed;
        } catch {
          // No birth profile yet — still return the transit sky without natal houses.
        }
      }

      const sky = await AstroServiceClient.gochar({
        transit_utc: instant.utc.toISOString(),
        latitude: body.latitude,
        longitude: body.longitude,
        ...(natalAscendant === undefined ? {} : { natal_ascendant_longitude: natalAscendant }),
        ...(natalMoon === undefined ? {} : { natal_moon_longitude: natalMoon }),
      });

      return {
        ...sky,
        local: {
          date: body.date,
          time: body.time ?? '12:00',
          timezone: body.timezone,
          offset: DateTime.fromJSDate(instant.utc, { zone: body.timezone }).toFormat('ZZ'),
        },
        natalOverlayApplied,
        birthTimeAssumed,
      };
    },
  );

  /**
   * Whether Jyotish AI is ready (cloud key or local trial engine).
   */
  app.get('/ai-predict/status', { config: { public: true } }, async () => AiPredictionService.status());

  /**
   * Astro-GPT style reading grounded in the caller's cached Lahiri kundali (+ optional gochar).
   *
   * Rate-limited tightly: each call hits OpenAI and rebuilds a chart brief.
   */
  app.post(
    '/ai-predict',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const claims = requireUser(request);
      const body = aiPredictBody.parse(request.body);
      try {
        return await AiPredictionService.predict(claims.sub, body);
      } catch (error) {
        if (error instanceof OpenAiError) {
          return reply.code(error.statusCode).send({
            error: error.code,
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
}

async function castForMatch(person: z.infer<typeof matchPersonBody>): Promise<{
  moon: {
    nakshatra: number;
    nakshatra_name: string;
    nakshatra_pada: number;
    zodiac_sign: number;
    zodiac_sign_name: string;
  };
  marsHouse: number | null;
  birthTimeKnown: boolean;
  dobUtc: string;
}> {
  const instant = toBirthInstant({
    date: person.birthDate,
    time: person.birthTime,
    timezone: person.timezone,
  });
  const chart = await AstroServiceClient.natalChart({
    dob_utc: instant.utc.toISOString(),
    latitude: person.latitude,
    longitude: person.longitude,
  });
  const moon = chart.planets.find((p) => p.body === 'Moon');
  const mars = chart.planets.find((p) => p.body === 'Mars');
  if (!moon) {
    throw new Error('Natal chart missing Moon');
  }
  return {
    moon: {
      nakshatra: moon.nakshatra,
      nakshatra_name: moon.nakshatra_name,
      nakshatra_pada: moon.nakshatra_pada,
      zodiac_sign: moon.zodiac_sign,
      zodiac_sign_name: moon.zodiac_sign_name,
    },
    marsHouse: instant.timeAssumed ? null : (mars?.house ?? null),
    birthTimeKnown: !instant.timeAssumed,
    dobUtc: instant.utc.toISOString(),
  };
}
