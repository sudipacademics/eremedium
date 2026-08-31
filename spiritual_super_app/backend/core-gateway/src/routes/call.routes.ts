import { AstrologerStatus, CallSessionStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { money, prisma } from '../lib/prisma.js';
import { authenticate, requireAstrologer, requireRole, requireUser } from '../plugins/authenticate.js';
import { CallService } from '../services/call.service.js';
import { LiveKitTokenService } from '../services/livekit.service.js';
import { QueueService } from '../services/queue.service.js';

const astrologerIdParams = z.object({ astrologerId: z.string().uuid() });
const sessionIdParams = z.object({ callSessionId: z.string().uuid() });
const presenceBody = z.object({ status: z.enum(['ONLINE', 'BUSY', 'OFFLINE']) });
const terminateBody = z.object({ reason: z.string().min(3).max(200).default('USER_HANGUP') });

export async function callRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/astrologers', async () => {
    const astrologers = await prisma.astrologer.findMany({
      where: { status: { not: AstrologerStatus.OFFLINE } },
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
      select: {
        id: true,
        displayName: true,
        perMinuteRate: true,
        status: true,
        languages: true,
      },
    });

    return {
      astrologers: await Promise.all(
        astrologers.map(async (astrologer) => ({
          id: astrologer.id,
          displayName: astrologer.displayName,
          perMinuteRate: money(astrologer.perMinuteRate).toFixed(2),
          minimumBalanceToStart: LiveKitTokenService.minimumBalanceFor(astrologer.perMinuteRate).toFixed(2),
          status: astrologer.status,
          languages: astrologer.languages,
          queueLength: (await QueueService.waitingUserIds(astrologer.id)).length,
        })),
      ),
    };
  });

  app.post('/queue/:astrologerId/join', async (request) => {
    const claims = requireUser(request);
    const { astrologerId } = astrologerIdParams.parse(request.params);
    return QueueService.joinQueue(claims.sub, astrologerId);
  });

  app.delete('/queue/:astrologerId', async (request) => {
    const claims = requireUser(request);
    const { astrologerId } = astrologerIdParams.parse(request.params);
    await QueueService.leaveQueue(claims.sub, astrologerId);
    return { left: true, astrologerId };
  });

  app.get('/queue/:astrologerId/position', async (request) => {
    const claims = requireUser(request);
    const { astrologerId } = astrologerIdParams.parse(request.params);
    return QueueService.positionOf(claims.sub, astrologerId);
  });

  app.put(
    '/astrologer/presence',
    { preHandler: requireRole(AppRole.ASTROLOGER, AppRole.ADMIN) },
    async (request) => {
      const { astrologerId } = requireAstrologer(request);
      const { status } = presenceBody.parse(request.body);
      const applied = await QueueService.setAstrologerPresence(astrologerId, status);
      return { astrologerId, status: applied };
    },
  );

  /** Called by each client once it has successfully joined the LiveKit room. */
  app.post('/sessions/:callSessionId/activate', async (request, reply) => {
    const claims = requireUser(request);
    const { callSessionId } = sessionIdParams.parse(request.params);

    const session = await prisma.callSession.findUnique({
      where: { id: callSessionId },
      select: { userId: true, astrologer: { select: { userId: true } } },
    });
    if (!session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Call session not found' });
    }
    if (claims.sub !== session.userId && claims.sub !== session.astrologer.userId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not a participant of this session' });
    }

    await CallService.activate(callSessionId);
    return reply.send({ callSessionId, status: CallSessionStatus.ACTIVE });
  });

  app.post('/sessions/:callSessionId/end', async (request, reply) => {
    const claims = requireUser(request);
    const { callSessionId } = sessionIdParams.parse(request.params);
    const { reason } = terminateBody.parse(request.body ?? {});

    const session = await prisma.callSession.findUnique({
      where: { id: callSessionId },
      select: { userId: true, astrologer: { select: { userId: true } } },
    });
    if (!session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Call session not found' });
    }
    if (claims.sub !== session.userId && claims.sub !== session.astrologer.userId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not a participant of this session' });
    }

    await CallService.terminate(callSessionId, CallSessionStatus.COMPLETED, reason);
    return reply.send({ callSessionId, status: CallSessionStatus.COMPLETED });
  });

  app.get('/sessions/:callSessionId', async (request, reply) => {
    const claims = requireUser(request);
    const { callSessionId } = sessionIdParams.parse(request.params);

    const session = await prisma.callSession.findUnique({
      where: { id: callSessionId },
      select: {
        id: true,
        status: true,
        channelId: true,
        ratePerMinute: true,
        totalMinutes: true,
        totalDeducted: true,
        startTime: true,
        endTime: true,
        userId: true,
        astrologerId: true,
        astrologer: { select: { userId: true, displayName: true } },
      },
    });
    if (!session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Call session not found' });
    }
    if (claims.sub !== session.userId && claims.sub !== session.astrologer.userId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not a participant of this session' });
    }

    return reply.send({
      id: session.id,
      status: session.status,
      channelId: session.channelId,
      astrologer: { id: session.astrologerId, displayName: session.astrologer.displayName },
      ratePerMinute: money(session.ratePerMinute).toFixed(2),
      totalMinutes: session.totalMinutes,
      totalDeducted: money(session.totalDeducted).toFixed(2),
      startTime: session.startTime?.toISOString() ?? null,
      endTime: session.endTime?.toISOString() ?? null,
    });
  });
}
