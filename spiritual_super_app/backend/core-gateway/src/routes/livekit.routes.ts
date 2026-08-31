import { CallSessionStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { CallService, TERMINAL_STATUSES } from '../services/call.service.js';

const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

const webhookLogger = logger.child({ component: 'LiveKitWebhook' });

/**
 * Turns LiveKit's view of the room into billing decisions.
 *
 * Before this existed, `CallService.terminate` was reachable only from the client's hangup endpoint
 * and from the billing worker running out of funds. A client that vanished without hanging up left
 * the session ACTIVE and billing every minute until the wallet drained. LiveKit knows the moment a
 * participant actually leaves, so it is the authoritative and immediate signal.
 *
 * Registered as its own plugin: the caller is LiveKit rather than a logged-in user, so there is no
 * JWT hook, and the signature is verified over the raw body.
 */
export async function livekitWebhookRoutes(app: FastifyInstance): Promise<void> {
  // LiveKit posts with Content-Type: application/webhook+json, which no default parser handles.
  for (const contentType of ['application/webhook+json', 'application/json']) {
    app.addContentTypeParser(contentType, { parseAs: 'string' }, (_request, body, done) => {
      done(null, { raw: typeof body === 'string' ? body : body.toString('utf8') });
    });
  }

  app.post('/livekit', async (request, reply) => {
    const { raw } = request.body as { raw: string };
    const authorization = request.headers.authorization;

    let event: Awaited<ReturnType<typeof receiver.receive>>;
    try {
      // Validates the JWT in the Authorization header AND that its sha256 claim matches the body.
      event = await receiver.receive(raw, authorization, true);
    } catch (error) {
      webhookLogger.warn({ err: error, ip: request.ip }, 'Rejected LiveKit webhook with bad signature');
      return reply.code(401).send({ error: 'INVALID_SIGNATURE' });
    }

    const roomName = event.room?.name;
    if (!roomName) {
      return reply.code(200).send({ received: true, action: 'ignored', reason: 'no_room' });
    }

    // channelId is the LiveKit room name and is unique on call_sessions.
    const session = await prisma.callSession.findUnique({
      where: { channelId: roomName },
      select: { id: true, status: true },
    });
    if (!session) {
      return reply.code(200).send({ received: true, action: 'ignored', reason: 'unknown_room' });
    }

    const alreadyFinished = TERMINAL_STATUSES.includes(session.status);

    switch (event.event) {
      case 'participant_joined': {
        // Start the clock only once both sides are actually in the room. activate() is guarded to
        // the INITIATED state, so repeated joins are harmless.
        const participantCount = event.room?.numParticipants ?? 0;
        if (!alreadyFinished && participantCount >= 2) {
          await CallService.activate(session.id);
          return reply.code(200).send({ received: true, action: 'activated' });
        }
        return reply.code(200).send({ received: true, action: 'waiting_for_peer' });
      }

      case 'participant_left': {
        // In a 1:1 paid consultation either party leaving ends the call. Ending early can only ever
        // undercharge, whereas staying ACTIVE overcharges, so this errs deliberately.
        if (alreadyFinished) {
          return reply.code(200).send({ received: true, action: 'ignored', reason: 'already_ended' });
        }
        await CallService.terminate(
          session.id,
          CallSessionStatus.COMPLETED,
          `PARTICIPANT_LEFT:${event.participant?.identity ?? 'unknown'}`,
        );
        return reply.code(200).send({ received: true, action: 'terminated' });
      }

      case 'room_finished': {
        if (alreadyFinished) {
          return reply.code(200).send({ received: true, action: 'ignored', reason: 'already_ended' });
        }
        await CallService.terminate(session.id, CallSessionStatus.COMPLETED, 'ROOM_FINISHED');
        return reply.code(200).send({ received: true, action: 'terminated' });
      }

      default:
        return reply.code(200).send({ received: true, action: 'ignored', reason: event.event });
    }
  });
}
