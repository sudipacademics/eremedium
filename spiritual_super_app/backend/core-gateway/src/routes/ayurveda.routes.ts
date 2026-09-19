import { AyurvedaOrderStatus, Dosha } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { authenticate, requireRole, requireUser } from '../plugins/authenticate.js';
import { AyurvedaService } from '../services/ayurveda.service.js';

const productQuery = z.object({
  dosha: z.nativeEnum(Dosha).optional(),
});

const orderBody = z.object({
  productId: z.string().uuid(),
  /*
   * No price field. Amount is always read from the catalog — the same rule as E-Puja.
   */
  shippingName: z.string().min(2).max(160),
  shippingPhone: z.string().min(8).max(20),
  shippingAddress: z.string().min(10).max(500),
  idempotencyKey: z.string().uuid(),
});

const orderParams = z.object({ orderId: z.string().uuid() });

const advanceBody = z.object({
  status: z.nativeEnum(AyurvedaOrderStatus),
  awb: z.string().min(3).max(80).optional(),
  courier: z.string().min(2).max(80).optional(),
});

export async function ayurvedaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/products', async (request, reply) => {
    requireUser(request);
    const { dosha } = productQuery.parse(request.query);
    const products = await AyurvedaService.listProducts(dosha);
    return reply.send({ products });
  });

  app.post('/orders', async (request, reply) => {
    const claims = requireUser(request);
    const body = orderBody.parse(request.body);
    const result = await AyurvedaService.placeOrder({
      userId: claims.sub,
      productId: body.productId,
      shippingName: body.shippingName,
      shippingPhone: body.shippingPhone,
      shippingAddress: body.shippingAddress,
      idempotencyKey: body.idempotencyKey,
    });
    return reply.code(201).send(result);
  });

  app.get('/orders', async (request, reply) => {
    const claims = requireUser(request);
    const orders = await AyurvedaService.listOrdersForUser(claims.sub);
    return reply.send({ orders });
  });

  app.get('/orders/:orderId', async (request, reply) => {
    const claims = requireUser(request);
    const { orderId } = orderParams.parse(request.params);
    const order = await AyurvedaService.getOrderForUser(orderId, claims.sub);
    return reply.send(order);
  });

  app.get('/admin/fulfilment', { preHandler: requireRole(AppRole.ADMIN) }, async (_request, reply) => {
    const orders = await AyurvedaService.listPendingFulfilment();
    return reply.send({ orders });
  });

  app.post(
    '/admin/orders/:orderId/advance',
    { preHandler: requireRole(AppRole.ADMIN) },
    async (request, reply) => {
      const { orderId } = orderParams.parse(request.params);
      const body = advanceBody.parse(request.body);
      const order = await AyurvedaService.advanceStatus(orderId, body.status, {
        ...(body.awb === undefined ? {} : { awb: body.awb }),
        ...(body.courier === undefined ? {} : { courier: body.courier }),
      });
      return reply.send(order);
    },
  );
}
