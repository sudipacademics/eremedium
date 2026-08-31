import { Dosha } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { authenticate, requireUser } from '../plugins/authenticate.js';
import { AstroServiceClient } from '../services/astro.client.js';

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
}
