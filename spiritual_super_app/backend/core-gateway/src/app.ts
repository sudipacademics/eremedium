import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { AuthError } from './auth/jwt.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { astroRoutes } from './routes/astro.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { callRoutes } from './routes/call.routes.js';
import { remedyRoutes } from './routes/remedy.routes.js';
import { walletRoutes } from './routes/wallet.routes.js';
import { websocketRoutes } from './routes/ws.routes.js';
import { hub } from './ws/hub.js';

interface StatusCarrying {
  statusCode: number;
}

function hasStatusCode(error: unknown): error is Error & StatusCarrying {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number'
  );
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // pino's Logger and Fastify's FastifyBaseLogger differ only in optional helpers.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 1_048_576,
    disableRequestLogging: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? /\.?[a-z0-9-]+\.[a-z]{2,}$/i : true,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => request.ip,
  });
  await app.register(websocket, {
    options: { maxPayload: 65_536, clientTracking: false },
  });

  await hub.initialise();

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    if (error instanceof AuthError) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: error.message });
    }
    if (hasStatusCode(error) && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.name, message: error.message });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
  });

  app.get('/healthz', async () => {
    const [dbCheck, redisCheck] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      redis.ping(),
    ]);
    const healthy = dbCheck.status === 'fulfilled' && redisCheck.status === 'fulfilled';
    return {
      status: healthy ? 'ok' : 'degraded',
      postgres: dbCheck.status === 'fulfilled' ? 'up' : 'down',
      redis: redisCheck.status === 'fulfilled' ? 'up' : 'down',
      websocketConnections: hub.localConnectionCount(),
    };
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(walletRoutes, { prefix: '/api/v1/wallet' });
  await app.register(callRoutes, { prefix: '/api/v1/calls' });
  await app.register(remedyRoutes, { prefix: '/api/v1/remedies' });
  await app.register(astroRoutes, { prefix: '/api/v1/vedic' });
  await app.register(websocketRoutes, { prefix: '/api/v1' });

  return app;
}
