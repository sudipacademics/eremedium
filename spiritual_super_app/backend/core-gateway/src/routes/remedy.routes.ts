import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { authenticate, requireAstrologer, requireRole, requireUser } from '../plugins/authenticate.js';
import { InCallRemedyDispatcher } from '../services/remedy.service.js';

const dispatchBody = z.object({
  callSessionId: z.string().uuid(),
  templeId: z.string().uuid(),
  pujaName: z.string().min(3).max(160),
  packagePrice: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'packagePrice must be a decimal string'),
  sankalpWish: z.string().max(1000).optional(),
  expiresInSeconds: z.number().int().min(30).max(1800).default(600),
});

const cardParams = z.object({ cardId: z.string().uuid() });

export async function remedyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post('/dispatch', { preHandler: requireRole(AppRole.ASTROLOGER) }, async (request, reply) => {
    const { astrologerId } = requireAstrologer(request);
    const body = dispatchBody.parse(request.body);
    const card = await InCallRemedyDispatcher.dispatch({
      astrologerId,
      callSessionId: body.callSessionId,
      templeId: body.templeId,
      pujaName: body.pujaName,
      packagePrice: body.packagePrice,
      sankalpWish: body.sankalpWish,
      expiresInSeconds: body.expiresInSeconds,
    });
    return reply.code(201).send(card);
  });

  app.get('/:cardId', async (request, reply) => {
    const claims = requireUser(request);
    const { cardId } = cardParams.parse(request.params);
    const card = await InCallRemedyDispatcher.getCard(cardId);
    if (!card) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Remedy card expired or unknown' });
    }
    if (card.userId !== claims.sub && card.astrologerId !== claims.astrologerId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your remedy card' });
    }
    return reply.send(card);
  });

  /** One-click wallet debit authorisation from the in-call PujaRemedyCard. */
  app.post('/:cardId/authorize', async (request, reply) => {
    const claims = requireUser(request);
    const { cardId } = cardParams.parse(request.params);
    const result = await InCallRemedyDispatcher.authorize(cardId, claims.sub);
    return reply.code(201).send(result);
  });
}
