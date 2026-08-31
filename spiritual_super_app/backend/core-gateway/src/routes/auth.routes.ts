import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole, signAccessToken } from '../auth/jwt.js';
import { prisma } from '../lib/prisma.js';
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
 * Possession of the phone number is the only credential. Sprint 1 shipped `/register` and `/token`,
 * which minted a token for any phone number with no proof of ownership whatsoever; both are gone.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/otp/request', async (request, reply) => {
    const { phone } = requestOtpSchema.parse(request.body);
    const challenge = await OtpService.request(phone);

    // The response is identical for known and unknown numbers: differing status codes, bodies or
    // timings here would turn this route into a "does this person have an account?" oracle.
    return reply.code(202).send({
      sent: true,
      expiresInSeconds: challenge.expiresInSeconds,
      resendAfterSeconds: challenge.resendAfterSeconds,
      ...(challenge.debugCode === undefined ? {} : { debugCode: challenge.debugCode }),
    });
  });

  app.post('/otp/verify', async (request, reply) => {
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

    const role = user.astrologer ? AppRole.ASTROLOGER : AppRole.USER;

    return reply.code(existing ? 200 : 201).send({
      user: { id: user.id, name: user.name, phone: user.phone },
      role,
      isNewAccount: !existing,
      accessToken: signAccessToken({
        sub: user.id,
        phone: user.phone,
        role,
        ...(user.astrologer ? { astrologerId: user.astrologer.id } : {}),
      }),
    });
  });
}
