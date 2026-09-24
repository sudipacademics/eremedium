import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, requireUser } from '../plugins/authenticate.js';
import { InvoiceService } from '../services/invoice.service.js';

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/invoices', async (request, reply) => {
    const claims = requireUser(request);
    return reply.send({ invoices: await InvoiceService.list(claims.sub) });
  });

  app.get(
    '/invoices/:invoiceId/pdf',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const claims = requireUser(request);
      const { invoiceId } = z.object({ invoiceId: z.string().min(1).max(80) }).parse(request.params);
      const { filename, pdf } = await InvoiceService.renderPdf(claims.sub, invoiceId);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'private, no-store')
        .send(pdf);
    },
  );
}
