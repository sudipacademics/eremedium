import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { FESTIVAL_LOCALES, FestivalService } from '../services/festival.service.js';

const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM'),
  locale: z.enum(FESTIVAL_LOCALES).default('en'),
});

const upcomingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  locale: z.enum(FESTIVAL_LOCALES).default('en'),
});

/** Public Hindu festival calendar. 503 until KALIAPANJIKA_API_KEY is configured. */
export async function festivalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { month, locale } = monthQuery.parse(request.query);
    const result = await FestivalService.forMonth(month, locale);
    reply.header('cache-control', 'public, max-age=3600');
    return result;
  });

  app.get('/upcoming', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { limit, locale } = upcomingQuery.parse(request.query);
    const result = await FestivalService.upcoming(limit, locale);
    reply.header('cache-control', 'public, max-age=900');
    return result;
  });
}
