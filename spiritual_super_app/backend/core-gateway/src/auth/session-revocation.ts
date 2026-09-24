import { env } from '../config/env.js';
import { redis, redisKeys } from '../lib/redis.js';
import { AuthError, verifyAccessToken, type AuthClaims } from './jwt.js';

/**
 * Access tokens are stateless, so "sign out everywhere" is a per-user cutoff: any token issued before
 * it is refused. The key only needs to outlive the longest-lived token, after which every token it
 * could reject has expired on its own.
 */
export const SessionRevocation = {
  async revokeAllIssuedBefore(userId: string, cutoffSeconds: number): Promise<void> {
    await redis.set(
      redisKeys.sessionsRevokedBefore(userId),
      String(cutoffSeconds),
      'EX',
      env.JWT_TTL_SECONDS + 60,
    );
  },

  async assertActive(claims: AuthClaims): Promise<void> {
    const raw = await redis.get(redisKeys.sessionsRevokedBefore(claims.sub));
    if (raw === null) return;
    const cutoff = Number(raw);
    if (Number.isFinite(cutoff) && (claims.iat ?? 0) < cutoff) {
      throw new AuthError('Session has been signed out');
    }
  },
} as const;

/** Signature, expiry and claims check plus the revocation cutoff. Use for every authenticated entry point. */
export async function verifySessionToken(token: string): Promise<AuthClaims> {
  const claims = verifyAccessToken(token);
  await SessionRevocation.assertActive(claims);
  return claims;
}
