import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppRole, AuthError, extractBearerToken, type AuthClaims } from '../auth/jwt.js';
import { verifySessionToken } from '../auth/session-revocation.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthClaims;
  }
  interface FastifyContextConfig {
    /** Browsable without signing in; see authenticateUnlessPublic. */
    public?: boolean;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const token = extractBearerToken(request.headers.authorization);
    request.auth = await verifySessionToken(token);
  } catch (error) {
    if (error instanceof AuthError) {
      await reply.code(401).send({ error: 'UNAUTHORIZED', message: error.message });
      return;
    }
    // A Redis outage must not look like a bad token, or clients would discard valid sessions.
    request.log.error({ err: error }, 'Session check unavailable');
    await reply.code(503).send({ error: 'AUTH_UNAVAILABLE', message: 'Please try again shortly' });
  }
}

/**
 * For route groups that mix public catalog reads with protected actions. Routes declared with
 * `config: { public: true }` serve guests; a bearer token, when sent, is still verified so the
 * handler can personalise. Every other route in the group requires a valid session.
 */
export async function authenticateUnlessPublic(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.routeOptions.config.public === true && !request.headers.authorization) return;
  await authenticate(request, reply);
}

export function requireRole(...allowed: readonly AppRole[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const claims = request.auth;
    if (!claims) {
      await reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }
    if (!allowed.includes(claims.role)) {
      await reply
        .code(403)
        .send({ error: 'FORBIDDEN', message: `Requires one of: ${allowed.join(', ')}` });
    }
  };
}

export function requireAstrologer(request: FastifyRequest): { userId: string; astrologerId: string } {
  const claims = request.auth;
  if (!claims || claims.role !== AppRole.ASTROLOGER || !claims.astrologerId) {
    throw new AuthError('Astrologer credentials required');
  }
  return { userId: claims.sub, astrologerId: claims.astrologerId };
}

export function requireUser(request: FastifyRequest): AuthClaims {
  const claims = request.auth;
  if (!claims) {
    throw new AuthError('Authentication required');
  }
  return claims;
}
