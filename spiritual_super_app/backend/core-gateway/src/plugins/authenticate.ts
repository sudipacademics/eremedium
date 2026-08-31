import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppRole, AuthError, extractBearerToken, verifyAccessToken, type AuthClaims } from '../auth/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthClaims;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const token = extractBearerToken(request.headers.authorization);
    request.auth = verifyAccessToken(token);
  } catch (error) {
    const message = error instanceof AuthError ? error.message : 'Unauthorized';
    await reply.code(401).send({ error: 'UNAUTHORIZED', message });
  }
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
