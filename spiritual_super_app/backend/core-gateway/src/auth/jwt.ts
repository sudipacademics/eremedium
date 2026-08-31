import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../config/env.js';

export const AppRole = {
  USER: 'USER',
  ASTROLOGER: 'ASTROLOGER',
  ADMIN: 'ADMIN',
} as const;

export type AppRole = (typeof AppRole)[keyof typeof AppRole];

export const authClaimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.nativeEnum(AppRole),
  astrologerId: z.string().uuid().optional(),
  phone: z.string().min(6),
});

export type AuthClaims = z.infer<typeof authClaimsSchema>;

export class AuthError extends Error {
  readonly statusCode = 401;

  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

export function signAccessToken(claims: AuthClaims): string {
  const options: SignOptions = {
    issuer: env.JWT_ISSUER,
    expiresIn: env.JWT_TTL_SECONDS,
    algorithm: 'HS256',
  };
  return jwt.sign(claims, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AuthClaims {
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      algorithms: ['HS256'],
    });
  } catch (error) {
    throw new AuthError(error instanceof Error ? `Invalid token: ${error.message}` : 'Invalid token');
  }

  if (typeof decoded === 'string') {
    throw new AuthError('Malformed token payload');
  }

  const parsed = authClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AuthError('Token claims failed validation');
  }
  return parsed.data;
}

/** Accepts `Authorization: Bearer <token>` or a `?token=` query parameter (WebSocket handshake). */
export function extractBearerToken(
  authorizationHeader: string | undefined,
  queryToken?: string | undefined,
): string {
  if (authorizationHeader) {
    const [scheme, value] = authorizationHeader.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && value) {
      return value;
    }
  }
  if (queryToken) {
    return queryToken;
  }
  throw new AuthError('Missing bearer token');
}
