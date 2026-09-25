import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole, signAccessToken } from '../auth/jwt.js';
import { SessionRevocation } from '../auth/session-revocation.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireUser } from '../plugins/authenticate.js';
import { OtpService } from '../services/otp.service.js';

const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, 'phone must be in E.164 form')
  // Normalising here means the OTP redis key and the users.phone column always agree.
  .transform((value) => (value.startsWith('+') ? value : `+${value}`));

const requestOtpSchema = z.object({
  phone: phoneSchema,
});

const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{4,8}$/, 'code must be numeric'),
  /** Supplied on first login only; ignored for existing accounts. */
  name: z.string().min(2).max(160).optional(),
  dob: z.string().datetime({ offset: true }).optional(),
  birthPlace: z.string().min(2).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  gotra: z.string().min(2).max(120).optional(),
});

/**
 * ADMIN comes from an env allowlist rather than any endpoint, so admin rights cannot be granted over
 * the API even by another admin. Changing the list requires a deploy, which is the intended friction.
 */
function resolveRole(phone: string, isAstrologer: boolean): AppRole {
  if (env.ADMIN_PHONES.includes(phone)) {
    return AppRole.ADMIN;
  }
  return isAstrologer ? AppRole.ASTROLOGER : AppRole.USER;
}

/**
 * Possession of the phone number is the only credential. Sprint 1 shipped `/register` and `/token`,
 * which minted a token for any phone number with no proof of ownership whatsoever; both are gone.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /*
   * Tighter than the global 300/min: OTP endpoints are the blast radius for credential stuffing and
   * SMS cost. Per-phone limits in OtpService still apply; this caps abuse across many numbers from
   * one IP (including the BFF, which now forwards a trusted client IP).
   */
  app.post(
    '/otp/request',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { phone } = requestOtpSchema.parse(request.body);
      const challenge = await OtpService.request(phone);

      // The response is identical for known and unknown numbers: differing status codes, bodies or
      // timings here would turn this route into a "does this person have an account?" oracle.
      return reply.code(202).send({
        sent: true,
        codeLength: env.OTP_LENGTH,
        expiresInSeconds: challenge.expiresInSeconds,
        resendAfterSeconds: challenge.resendAfterSeconds,
        ...(challenge.debugCode === undefined ? {} : { debugCode: challenge.debugCode }),
      });
    },
  );

  app.post(
    '/otp/verify',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = verifyOtpSchema.parse(request.body);

      // Throws before any account is touched, so a wrong code can never create a user.
      await OtpService.verify(body.phone, body.code);

      const existing = await prisma.user.findUnique({
        where: { phone: body.phone },
        select: { id: true, phone: true, name: true, astrologer: { select: { id: true } } },
      });

      const user =
        existing ??
        (await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              phone: body.phone,
              name: body.name ?? 'Devotee',
              ...(body.dob === undefined ? {} : { dob: new Date(body.dob) }),
              ...(body.birthPlace === undefined ? {} : { birthPlace: body.birthPlace }),
              ...(body.latitude === undefined ? {} : { latitude: body.latitude }),
              ...(body.longitude === undefined ? {} : { longitude: body.longitude }),
              ...(body.gotra === undefined ? {} : { gotra: body.gotra }),
            },
            select: { id: true, phone: true, name: true },
          });
          // Same transaction as the user: an account without a wallet would break every debit path.
          await tx.wallet.create({ data: { userId: created.id, balance: 0, currency: 'INR' } });
          return { ...created, astrologer: null as { id: string } | null };
        }));

      const role = resolveRole(user.phone, user.astrologer !== null);
      const astrologerId = user.astrologer?.id ?? null;

      return reply.code(existing ? 200 : 201).send({
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role,
          astrologerId,
        },
        role,
        isNewAccount: !existing,
        accessToken: signAccessToken({
          sub: user.id,
          phone: user.phone,
          role,
          ...(astrologerId ? { astrologerId } : {}),
        }),
      });
    },
  );

  app.get('/profile', { preHandler: authenticate }, async (request, reply) => {
    const claims = requireUser(request);
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: profileSelect,
    });
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found' });
    }
    return reply.send(serializeProfile(user));
  });

  const profilePatchSchema = z.object({
    name: z.string().min(2).max(160).optional(),
    dob: z.string().datetime({ offset: true }).nullable().optional(),
    birthPlace: z.string().min(2).max(180).nullable().optional(),
    gotra: z.string().min(2).max(120).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
    address: z.string().trim().min(5).max(500).nullable().optional(),
    photoDataUrl: z
      .string()
      .max(PHOTO_MAX_CHARS, 'Photo is too large')
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Photo must be a JPEG, PNG or WebP image')
      .nullable()
      .optional(),
  });

  app.patch('/profile', { preHandler: authenticate }, async (request, reply) => {
    const claims = requireUser(request);
    const body = profilePatchSchema.parse(request.body);

    const updated = await prisma.user.update({
      where: { id: claims.sub },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.dob !== undefined ? { dob: body.dob ? new Date(body.dob) : null } : {}),
        ...(body.birthPlace !== undefined
          ? { birthPlace: body.birthPlace?.trim() || null }
          : {}),
        ...(body.gotra !== undefined ? { gotra: body.gotra?.trim() || null } : {}),
        ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
        ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.address !== undefined ? { address: body.address || null } : {}),
        ...(body.photoDataUrl !== undefined ? { photoDataUrl: body.photoDataUrl } : {}),
      },
      select: profileSelect,
    });

    return reply.send(serializeProfile(updated));
  });

  /**
   * Signs out every other device. The caller re-proves possession of the phone with a fresh OTP
   * (requested through /otp/request), so a stolen access token alone cannot lock the owner out.
   * The current device receives a new token issued at the cutoff and stays signed in.
   */
  app.post(
    '/sessions/revoke-others',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const claims = requireUser(request);
      const { code } = z
        .object({ code: z.string().regex(/^\d{4,8}$/, 'code must be numeric') })
        .parse(request.body);

      await OtpService.verify(claims.phone, code);

      const cutoff = Math.floor(Date.now() / 1000);
      await SessionRevocation.revokeAllIssuedBefore(claims.sub, cutoff);

      return reply.send({
        signedOutOtherDevices: true,
        accessToken: signAccessToken({
          sub: claims.sub,
          phone: claims.phone,
          role: claims.role,
          ...(claims.astrologerId ? { astrologerId: claims.astrologerId } : {}),
          iat: cutoff,
        }),
      });
    },
  );
}

/** A 256px JPEG is ~30 KB; this leaves headroom for PNG/WebP without admitting full-size photos. */
const PHOTO_MAX_CHARS = 350_000;

const profileSelect = {
  id: true,
  name: true,
  phone: true,
  dob: true,
  birthPlace: true,
  gotra: true,
  latitude: true,
  longitude: true,
  email: true,
  address: true,
  photoDataUrl: true,
  createdAt: true,
  astrologer: { select: { id: true } },
} as const;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

function serializeProfile(user: ProfileRow) {
  return {
    userId: user.id,
    name: user.name,
    phone: user.phone,
    role: resolveRole(user.phone, user.astrologer !== null),
    astrologerId: user.astrologer?.id ?? null,
    dob: user.dob?.toISOString() ?? null,
    birthPlace: user.birthPlace,
    gotra: user.gotra,
    latitude: user.latitude?.toString() ?? null,
    longitude: user.longitude?.toString() ?? null,
    email: user.email,
    address: user.address,
    photoDataUrl: user.photoDataUrl,
    createdAt: user.createdAt.toISOString(),
  };
}
