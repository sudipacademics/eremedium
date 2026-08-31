import { Dosha } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAstrologer, requireRole, requireUser } from '../plugins/authenticate.js';
import { AstroServiceClient } from '../services/astro.client.js';
import { KundaliService } from '../services/kundali.service.js';
import { PlaceService } from '../services/place.service.js';

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

/**
 * Thin proxy over the Python compute service. Nginx routes `/api/v1/astro/*` straight to FastAPI for
 * anonymous chart lookups; these authenticated variants additionally persist results against a user.
 */
export async function astroRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

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
  app.get('/places', async (request) => {
    requireUser(request);
    const { q, limit } = placeQuery.parse(request.query);
    return { places: PlaceService.search(q, limit) };
  });

  /**
   * The IANA zone at a coordinate pair.
   *
   * Needed because the gazetteer omits a great many Indian villages, so coordinate entry has to be a
   * first-class path -- and a birth time is uninterpretable without knowing the zone it was told in.
   */
  app.get('/timezone', async (request) => {
    requireUser(request);
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
}
