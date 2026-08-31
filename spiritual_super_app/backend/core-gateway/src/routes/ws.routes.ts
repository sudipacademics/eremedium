import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole, AuthError, extractBearerToken, verifyAccessToken, type AuthClaims } from '../auth/jwt.js';
import { logger } from '../lib/logger.js';
import { money, prisma } from '../lib/prisma.js';
import { InCallRemedyDispatcher } from '../services/remedy.service.js';
import { LiveKitTokenService } from '../services/livekit.service.js';
import { QueueService } from '../services/queue.service.js';
import { WalletService } from '../services/wallet.service.js';
import { hub } from '../ws/hub.js';
import { clientMessageSchema, envelope, ServerEvent, type ClientMessage } from '../ws/protocol.js';

const handshakeQuerySchema = z.object({ token: z.string().min(20).optional() });

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * `/api/v1/ws` — the single client signalling channel.
 *
 * Every connection is authenticated at handshake time and re-checked for wallet solvency before any
 * queueing or room-admission action is honoured.
 */
export async function websocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, async (connection, request) => {
    let claims: AuthClaims;
    try {
      const query = handshakeQuerySchema.parse(request.query);
      claims = verifyAccessToken(extractBearerToken(request.headers.authorization, query.token));
    } catch (error) {
      const message = error instanceof AuthError ? error.message : 'Handshake authentication failed';
      connection.send(JSON.stringify(envelope(ServerEvent.ERROR, { message })));
      connection.close(4401, 'Unauthorized');
      return;
    }

    const socketLogger = logger.child({ userId: claims.sub, role: claims.role });
    hub.register(claims.sub, connection);

    const wallet = await WalletService.getBalanceByUserId(claims.sub).catch(() => null);
    connection.send(
      JSON.stringify(
        envelope(ServerEvent.CONNECTED, {
          userId: claims.sub,
          role: claims.role,
          astrologerId: claims.astrologerId ?? null,
          walletBalance: wallet ? wallet.balance.toFixed(2) : null,
          heartbeatSeconds: HEARTBEAT_INTERVAL_MS / 1_000,
        }),
      ),
    );

    let alive = true;
    connection.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        connection.terminate();
        return;
      }
      alive = false;
      connection.ping();
    }, HEARTBEAT_INTERVAL_MS);

    const fail = (message: string): void => {
      connection.send(JSON.stringify(envelope(ServerEvent.ERROR, { message })));
    };

    const handle = async (message: ClientMessage): Promise<void> => {
      switch (message.type) {
        case 'PING': {
          connection.send(JSON.stringify(envelope(ServerEvent.CONNECTED, { pong: true })));
          return;
        }

        case 'ASTROLOGER_SET_STATUS': {
          if (claims.role !== AppRole.ASTROLOGER || !claims.astrologerId) {
            fail('Only astrologers may change presence');
            return;
          }
          const status = await QueueService.setAstrologerPresence(claims.astrologerId, message.status);
          connection.send(
            JSON.stringify(
              envelope(ServerEvent.ASTROLOGER_STATUS, { astrologerId: claims.astrologerId, status }),
            ),
          );
          return;
        }

        case 'USER_JOIN_QUEUE': {
          const position = await QueueService.joinQueue(claims.sub, message.astrologerId);
          connection.send(JSON.stringify(envelope(ServerEvent.QUEUE_POSITION, position)));
          return;
        }

        case 'USER_LEAVE_QUEUE': {
          await QueueService.leaveQueue(claims.sub, message.astrologerId);
          return;
        }

        case 'USER_QUEUE_POSITION': {
          const position = await QueueService.positionOf(claims.sub, message.astrologerId);
          connection.send(JSON.stringify(envelope(ServerEvent.QUEUE_POSITION, position)));
          return;
        }

        case 'ASTROLOGER_PUSH_REMEDY': {
          if (claims.role !== AppRole.ASTROLOGER || !claims.astrologerId) {
            fail('Only astrologers may push remedies');
            return;
          }
          const card = await InCallRemedyDispatcher.dispatch({
            astrologerId: claims.astrologerId,
            callSessionId: message.callSessionId,
            pujaOfferingId: message.pujaOfferingId,
            sankalpWish: message.sankalpWish,
            expiresInSeconds: message.expiresInSeconds,
          });
          connection.send(JSON.stringify(envelope(ServerEvent.PUJA_REMEDY_CARD, card)));
          return;
        }
      }
    };

    connection.on('message', (raw) => {
      void (async () => {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw.toString());
        } catch {
          fail('Message must be valid JSON');
          return;
        }
        const parsed = clientMessageSchema.safeParse(parsedJson);
        if (!parsed.success) {
          fail(`Unsupported message: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
          return;
        }
        try {
          await handle(parsed.data);
        } catch (error) {
          socketLogger.warn({ err: error, type: parsed.data.type }, 'WebSocket command failed');
          fail(error instanceof Error ? error.message : 'Command failed');
        }
      })();
    });

    connection.on('close', () => {
      clearInterval(heartbeat);
      hub.unregister(claims.sub, connection);

      void (async () => {
        // A disconnecting astrologer must not keep users waiting on a dead socket.
        if (claims.role === AppRole.ASTROLOGER && claims.astrologerId) {
          await QueueService.setAstrologerPresence(claims.astrologerId, 'OFFLINE').catch((error: unknown) =>
            socketLogger.warn({ err: error }, 'Failed to mark astrologer offline on disconnect'),
          );
        }
      })();
      socketLogger.info('WebSocket closed');
    });
  });

  /**
   * Pre-flight token endpoint: the client asks for RTC credentials and we re-verify solvency at the
   * moment of admission rather than trusting the queue-time check.
   */
  app.post('/rtc/token', async (request, reply) => {
    let claims: AuthClaims;
    try {
      claims = verifyAccessToken(extractBearerToken(request.headers.authorization));
    } catch (error) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: error instanceof AuthError ? error.message : 'Unauthorized',
      });
    }

    const body = z.object({ callSessionId: z.string().uuid() }).parse(request.body);
    const session = await prisma.callSession.findUnique({
      where: { id: body.callSessionId },
      select: {
        channelId: true,
        userId: true,
        astrologerId: true,
        ratePerMinute: true,
        astrologer: { select: { userId: true } },
      },
    });
    if (!session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Call session not found' });
    }

    if (claims.sub === session.astrologer.userId) {
      return reply.send(
        await LiveKitTokenService.mintAstrologerToken({
          astrologerUserId: claims.sub,
          roomName: session.channelId,
        }),
      );
    }
    if (claims.sub !== session.userId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not a participant of this session' });
    }

    const minimum = LiveKitTokenService.minimumBalanceFor(session.ratePerMinute);
    const walletBalance = await WalletService.getBalanceByUserId(claims.sub);
    if (walletBalance.balance.lessThan(minimum)) {
      return reply.code(402).send({
        error: 'INSUFFICIENT_FUNDS',
        message: `Recharge to at least ${minimum.toFixed(2)} to join`,
        required: minimum.toFixed(2),
        available: money(walletBalance.balance).toFixed(2),
      });
    }

    return reply.send(
      await LiveKitTokenService.mintUserToken({
        userId: claims.sub,
        astrologerId: session.astrologerId,
        roomName: session.channelId,
      }),
    );
  });
}
