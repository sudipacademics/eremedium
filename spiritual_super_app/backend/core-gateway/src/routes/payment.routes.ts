import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { logger } from '../lib/logger.js';
import { authenticate, requireUser } from '../plugins/authenticate.js';
import { PaymentService } from '../services/payment.service.js';
import { RazorpayClient, paymentsConfigured } from '../services/razorpay.client.js';

const createOrderSchema = z.object({
  amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'amount must be a decimal string with <= 2 places'),
});

const webhookEventSchema = z.object({
  event: z.string().min(3),
  payload: z.object({
    payment: z
      .object({
        entity: z.object({
          id: z.string().min(3),
          order_id: z.string().min(3).nullable().optional(),
          amount: z.number().int().nonnegative(),
          error_description: z.string().nullable().optional(),
        }),
      })
      .optional(),
  }),
});

/** Authenticated top-up initiation. */
export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/config', async () => ({ enabled: paymentsConfigured() }));

  app.post('/order', async (request, reply) => {
    const claims = requireUser(request);
    const body = createOrderSchema.parse(request.body);
    const order = await PaymentService.createTopUpOrder(claims.sub, body.amount);
    return reply.code(201).send(order);
  });
}

/**
 * Registered as a SEPARATE plugin because of two encapsulation requirements that conflict with the
 * authenticated routes above:
 *
 *  1. No JWT hook. The caller is Razorpay, not a logged-in user; the HMAC signature is the credential.
 *  2. A raw-body content type parser. Fastify's default JSON parser discards the exact bytes, but the
 *     signature is computed over them, so re-serialising the parsed object would fail verification.
 */
export async function paymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      // Hand the parser's raw string through untouched; the route parses it after verifying.
      done(null, { raw: typeof body === 'string' ? body : body.toString('utf8') });
    },
  );

  app.post('/razorpay', async (request, reply) => {
    if (!paymentsConfigured()) {
      return reply.code(503).send({ error: 'PAYMENTS_DISABLED' });
    }

    const { raw } = request.body as { raw: string };
    const signature = request.headers['x-razorpay-signature'];

    if (!RazorpayClient.verifyWebhookSignature(raw, typeof signature === 'string' ? signature : undefined)) {
      logger.warn({ ip: request.ip }, 'Rejected payment webhook with invalid signature');
      // 401 rather than 400: an unsigned caller is unauthenticated, and Razorpay retries on 5xx only.
      return reply.code(401).send({ error: 'INVALID_SIGNATURE' });
    }

    let event: z.infer<typeof webhookEventSchema>;
    try {
      event = webhookEventSchema.parse(JSON.parse(raw));
    } catch (error) {
      logger.error({ err: error }, 'Signed webhook body failed validation');
      return reply.code(400).send({ error: 'MALFORMED_EVENT' });
    }

    const entity = event.payload.payment?.entity;
    if (!entity?.order_id) {
      // Acknowledged: retrying will not make an unrelated event become relevant.
      return reply.code(200).send({ received: true, action: 'ignored', reason: 'no_order_id' });
    }

    if (event.event === 'payment.captured') {
      const outcome = await PaymentService.handleCapturedPayment({
        providerOrderId: entity.order_id,
        providerPaymentId: entity.id,
        amountInPaise: entity.amount,
      });
      // Always 200 on a verified event, even when we chose not to credit. A non-2xx would make
      // Razorpay retry an event we have already decided about.
      return reply.code(200).send({ received: true, ...outcome });
    }

    if (event.event === 'payment.failed') {
      const outcome = await PaymentService.handleFailedPayment({
        providerOrderId: entity.order_id,
        providerPaymentId: entity.id,
        reason: entity.error_description ?? 'unspecified',
      });
      return reply.code(200).send({ received: true, ...outcome });
    }

    return reply.code(200).send({ received: true, action: 'ignored', reason: 'unhandled_event' });
  });
}
