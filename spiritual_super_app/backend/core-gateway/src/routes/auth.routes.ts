import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole, signAccessToken } from '../auth/jwt.js';
import { prisma } from '../lib/prisma.js';

const registerSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'phone must be in E.164 form'),
  name: z.string().min(2).max(160),
  dob: z.string().datetime({ offset: true }).optional(),
  birthPlace: z.string().min(2).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  gotra: z.string().min(2).max(120).optional(),
});

const loginSchema = z.object({
  phone: z.string().min(6).max(20),
});

/**
 * Sprint 1 exposes deterministic phone-based issuance so the rest of the platform can be exercised
 * end to end. OTP verification lands in Sprint 2 and plugs in ahead of `signAccessToken`.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: body.phone,
          name: body.name,
          ...(body.dob === undefined ? {} : { dob: new Date(body.dob) }),
          ...(body.birthPlace === undefined ? {} : { birthPlace: body.birthPlace }),
          ...(body.latitude === undefined ? {} : { latitude: body.latitude }),
          ...(body.longitude === undefined ? {} : { longitude: body.longitude }),
          ...(body.gotra === undefined ? {} : { gotra: body.gotra }),
        },
        select: { id: true, phone: true, name: true },
      });
      await tx.wallet.create({ data: { userId: user.id, balance: 0, currency: 'INR' } });
      return user;
    });

    return reply.code(201).send({
      user: created,
      accessToken: signAccessToken({ sub: created.id, role: AppRole.USER, phone: created.phone }),
    });
  });

  app.post('/token', async (request, reply) => {
    const { phone } = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, phone: true, name: true, astrologer: { select: { id: true } } },
    });
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No account for this phone number' });
    }

    const accessToken = signAccessToken({
      sub: user.id,
      phone: user.phone,
      role: user.astrologer ? AppRole.ASTROLOGER : AppRole.USER,
      ...(user.astrologer ? { astrologerId: user.astrologer.id } : {}),
    });

    return reply.send({
      user: { id: user.id, name: user.name, phone: user.phone },
      role: user.astrologer ? AppRole.ASTROLOGER : AppRole.USER,
      accessToken,
    });
  });
}
