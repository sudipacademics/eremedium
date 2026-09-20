import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { authenticate, requireRole } from '../plugins/authenticate.js';
import { HistoryError, HistoryService } from '../services/history.service.js';

const querySchema = z.object({
  phone: z
    .string()
    .trim()
    .min(8)
    .max(24)
    .transform((value) => value.replace(/[\s()-]/g, ''))
    .refine((value) => /^\+?[0-9]{8,15}$/.test(value), {
      message: 'phone must be digits, optionally with a leading +',
    }),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

/**
 * Cross-domain admin lookup. Phone is the only seeker identifier support has on a call.
 */
export async function historyAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(AppRole.ADMIN));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HistoryError) {
      return reply.code(error.statusCode).send({ error: 'HISTORY_ERROR', message: error.message });
    }
    throw error;
  });

  app.get('/history', async (request, reply) => {
    const query = querySchema.parse(request.query);
    const result = await HistoryService.searchByPhone(query.phone, query.limit);
    return reply.send(result);
  });
}
