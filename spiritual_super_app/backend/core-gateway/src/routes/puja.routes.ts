import { PujaBookingStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { money, prisma } from '../lib/prisma.js';
import { authenticate, requireRole, requireUser } from '../plugins/authenticate.js';
import { PujaError, PujaService } from '../services/puja.service.js';

const bookBody = z.object({
  pujaOfferingId: z.string().uuid(),
  /*
   * No price field, deliberately. The amount charged is read from the catalog entry; accepting it
   * from the client is how a devotee could pay one rupee for a ten thousand rupee puja.
   */
  sankalpName: z.string().min(2).max(160).optional(),
  sankalpGotra: z.string().max(120).optional(),
  sankalpWish: z.string().max(1000).optional(),
  /** Supplied by the client so a double-tapped confirm button books once. */
  idempotencyKey: z.string().uuid(),
});

const bookingParams = z.object({ bookingId: z.string().uuid() });

const scheduleBody = z.object({ scheduledFor: z.string().datetime() });

const advanceBody = z.object({
  status: z.nativeEnum(PujaBookingStatus),
  videoProofUrl: z.string().url().max(500).optional(),
  prasadAwb: z.string().min(3).max(80).optional(),
  prasadCourier: z.string().min(2).max(80).optional(),
});

const templeBody = z.object({
  name: z.string().min(3).max(180),
  location: z.string().min(3).max(180),
  primaryDeity: z.string().min(2).max(120),
  liveStreamUrl: z.string().url().max(500).optional(),
});

const offeringBody = z.object({
  templeId: z.string().uuid(),
  name: z.string().min(3).max(160),
  description: z.string().max(1000).optional(),
  price: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'price must be a decimal string'),
  durationLabel: z.string().max(60).optional(),
  prasadIncluded: z.string().max(300).optional(),
  active: z.boolean().default(true),
});

export async function pujaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // --- Catalog -------------------------------------------------------------------------------

  app.get('/temples', async (_request, reply) => {
    const temples = await PujaService.listTemples();
    return reply.send({ temples });
  });

  // --- Booking -------------------------------------------------------------------------------

  app.post('/bookings', async (request, reply) => {
    const claims = requireUser(request);
    const body = bookBody.parse(request.body);
    const result = await PujaService.book({
      userId: claims.sub,
      offeringId: body.pujaOfferingId,
      sankalpName: body.sankalpName,
      sankalpGotra: body.sankalpGotra,
      sankalpWish: body.sankalpWish,
      idempotencyKey: body.idempotencyKey,
    });
    return reply.code(201).send(result);
  });

  app.get('/bookings', async (request, reply) => {
    const claims = requireUser(request);
    const bookings = await PujaService.listBookingsForUser(claims.sub);
    return reply.send({ bookings });
  });

  app.get('/bookings/:bookingId', async (request, reply) => {
    const claims = requireUser(request);
    const { bookingId } = bookingParams.parse(request.params);
    const booking = await PujaService.getBookingForUser(bookingId, claims.sub);
    return reply.send(booking);
  });

  // --- Fulfilment (admin) --------------------------------------------------------------------
  //
  // Admin-only and role-gated on its own, not merely hidden from the UI: these endpoints decide
  // whether a devotee is told their puja was performed and their prasad posted.

  app.get('/admin/fulfilment', { preHandler: requireRole(AppRole.ADMIN) }, async (_request, reply) => {
    const bookings = await PujaService.listPendingFulfilment();
    return reply.send({ bookings });
  });

  app.post(
    '/admin/bookings/:bookingId/schedule',
    { preHandler: requireRole(AppRole.ADMIN) },
    async (request, reply) => {
      const { bookingId } = bookingParams.parse(request.params);
      const { scheduledFor } = scheduleBody.parse(request.body);
      const booking = await PujaService.schedule(bookingId, new Date(scheduledFor));
      return reply.send(booking);
    },
  );

  app.post(
    '/admin/bookings/:bookingId/advance',
    { preHandler: requireRole(AppRole.ADMIN) },
    async (request, reply) => {
      const { bookingId } = bookingParams.parse(request.params);
      const body = advanceBody.parse(request.body);
      const booking = await PujaService.advance(bookingId, body.status, {
        videoProofUrl: body.videoProofUrl,
        prasadAwb: body.prasadAwb,
        prasadCourier: body.prasadCourier,
      });
      return reply.send(booking);
    },
  );

  // --- Catalog administration ----------------------------------------------------------------

  app.post('/admin/temples', { preHandler: requireRole(AppRole.ADMIN) }, async (request, reply) => {
    const body = templeBody.parse(request.body);
    const temple = await prisma.temple.create({
      data: {
        name: body.name,
        location: body.location,
        primaryDeity: body.primaryDeity,
        ...(body.liveStreamUrl === undefined ? {} : { liveStreamUrl: body.liveStreamUrl }),
      },
      select: { id: true, name: true, location: true, primaryDeity: true },
    });
    return reply.code(201).send(temple);
  });

  app.post('/admin/offerings', { preHandler: requireRole(AppRole.ADMIN) }, async (request, reply) => {
    const body = offeringBody.parse(request.body);
    const temple = await prisma.temple.findUnique({ where: { id: body.templeId }, select: { id: true } });
    if (!temple) {
      throw new PujaError(`Temple ${body.templeId} not found`, 404);
    }
    const price = money(body.price);
    if (price.lessThanOrEqualTo(0)) {
      throw new PujaError('price must be greater than zero', 400);
    }
    const offering = await prisma.pujaOffering.create({
      data: {
        templeId: body.templeId,
        name: body.name,
        price,
        active: body.active,
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.durationLabel === undefined ? {} : { durationLabel: body.durationLabel }),
        ...(body.prasadIncluded === undefined ? {} : { prasadIncluded: body.prasadIncluded }),
      },
      select: { id: true, name: true, price: true, active: true },
    });
    return reply.code(201).send({ ...offering, price: money(offering.price).toFixed(2) });
  });
}
