import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { authenticate, requireAstrologer, requireRole, requireUser } from '../plugins/authenticate.js';
import { InCallRemedyDispatcher } from '../services/remedy.service.js';

const dispatchBody = z.object({
  callSessionId: z.string().uuid(),
  // No price and no puja name: both come from the catalog entry this id points at, so the astrologer
  // on the call cannot set what the devotee is charged.
  pujaOfferingId: z.string().uuid(),
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
      pujaOfferingId: body.pujaOfferingId,
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
