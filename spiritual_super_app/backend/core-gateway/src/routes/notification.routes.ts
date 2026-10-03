import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, requireUser } from '../plugins/authenticate.js';
import { NotificationService } from '../services/notification.service.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const claims = requireUser(request);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    return NotificationService.list(claims.sub, claims.phone, limit);
  });

  app.post('/:id/read', async (request) => {
    const claims = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { updated: await NotificationService.markRead(claims.sub, claims.phone, id) };
  });

  app.post('/read-all', async (request) => {
    const claims = requireUser(request);
    return { updated: await NotificationService.markRead(claims.sub, claims.phone, null) };
  });
}
