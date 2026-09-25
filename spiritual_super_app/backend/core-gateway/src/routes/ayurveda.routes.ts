import { AyurvedaOrderStatus, Dosha, ProductCategory } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { authenticateUnlessPublic, requireRole, requireUser } from '../plugins/authenticate.js';
import { AyurvedaService } from '../services/ayurveda.service.js';

const productQuery = z.object({
  dosha: z.nativeEnum(Dosha).optional(),
  category: z.nativeEnum(ProductCategory).optional(),
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
  app.addHook('preHandler', authenticateUnlessPublic);

  app.get('/products', { config: { public: true } }, async (request, reply) => {
    const { dosha, category } = productQuery.parse(request.query);
    const products = await AyurvedaService.listProducts({
      ...(dosha === undefined ? {} : { dosha }),
      ...(category === undefined ? {} : { category }),
    });
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

  const productFields = z.object({
    sku: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, 'sku must be lowercase kebab-case'),
    name: z.string().min(2).max(160),
    description: z.string().max(1000).nullable().optional(),
    price: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
    suitedDoshas: z.array(z.nativeEnum(Dosha)).max(3).default([]),
    formFactor: z.string().min(2).max(40).default('kit'),
    category: z.nativeEnum(ProductCategory).default(ProductCategory.AYURVEDA),
    imageUrl: z.string().max(500).nullable().optional(),
    active: z.boolean().default(true),
  });

  const productBody = productFields.refine(
    (body) => body.category !== ProductCategory.AYURVEDA || body.suitedDoshas.length > 0,
    { message: 'Ayurveda products need at least one dosha', path: ['suitedDoshas'] },
  );

  const productPatch = productFields
    .omit({ sku: true })
    .partial()
    .extend({
      description: z.string().max(1000).nullable().optional(),
      suitedDoshas: z.array(z.nativeEnum(Dosha)).max(3).optional(),
      category: z.nativeEnum(ProductCategory).optional(),
      formFactor: z.string().min(2).max(40).optional(),
      active: z.boolean().optional(),
    });

  const productParams = z.object({ productId: z.string().uuid() });

  app.get('/admin/products', { preHandler: requireRole(AppRole.ADMIN) }, async (_request, reply) => {
    const products = await AyurvedaService.listProductsAdmin();
    return reply.send({ products });
  });

  app.post('/admin/products', { preHandler: requireRole(AppRole.ADMIN) }, async (request, reply) => {
    const body = productBody.parse(request.body);
    const product = await AyurvedaService.createProduct({
      sku: body.sku,
      name: body.name,
      price: body.price,
      suitedDoshas: body.suitedDoshas,
      formFactor: body.formFactor,
      category: body.category,
      active: body.active,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
    });
    return reply.code(201).send(product);
  });

  app.patch(
    '/admin/products/:productId',
    { preHandler: requireRole(AppRole.ADMIN) },
    async (request, reply) => {
      const { productId } = productParams.parse(request.params);
      const body = productPatch.parse(request.body);
      const product = await AyurvedaService.updateProduct(productId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...(body.suitedDoshas !== undefined ? { suitedDoshas: body.suitedDoshas } : {}),
        ...(body.formFactor !== undefined ? { formFactor: body.formFactor } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      });
      return reply.send(product);
    },
  );
}
