import { CallSessionStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { CallService, TERMINAL_STATUSES } from '../services/call.service.js';
import { LiveKitTokenService } from '../services/livekit.service.js';

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
      /*
       * Validates the JWT in the Authorization header AND that its sha256 claim matches the body.
       *
       * The third parameter is `skipAuth`. It was previously passed as `true`, which disabled
       * signature verification entirely: this endpoint accepted any unsigned POST, so anyone able to
       * reach it could end a stranger's call or start the billing clock on one. Verification is the
       * entire reason the raw body is preserved, so the flag must stay false.
       */
      event = await receiver.receive(raw, authorization, false);
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
        if (alreadyFinished) {
          return reply.code(200).send({ received: true, action: 'ignored', reason: 'already_ended' });
        }

        /*
         * Ask LiveKit how many participants are in the room rather than trusting the payload.
         *
         * event.room.numParticipants is NOT the live count in a participant_joined event -- it
         * arrives as 0 -- so gating on it meant activate() never fired. A two-party call with real
         * media then sat at INITIATED for its whole duration and billed nothing: the billing worker
         * only ticks on ACTIVE. The client also calls /activate, which masked this whenever that
         * request happened to succeed, but a native client or one failed request was a free
         * consultation and an unpaid astrologer.
         */
        const liveCount = await LiveKitTokenService.countParticipants(roomName);
        const participantCount = liveCount ?? event.room?.numParticipants ?? 0;

        if (participantCount >= 2) {
          // activate() is guarded to the INITIATED state, so both joins racing here is harmless.
          await CallService.activate(session.id);
          return reply.code(200).send({ received: true, action: 'activated' });
        }
        return reply.code(200).send({ received: true, action: 'waiting_for_peer', participantCount });
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
