import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, requireUser } from '../plugins/authenticate.js';
import { prisma } from '../lib/prisma.js';
import { WalletService } from '../services/wallet.service.js';

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/balance', async (request) => {
    const claims = requireUser(request);
    const wallet = await WalletService.getBalanceByUserId(claims.sub);
    return {
      walletId: wallet.walletId,
      balance: wallet.balance.toFixed(2),
      currency: wallet.currency,
    };
  });

  /**
   * `POST /recharge` used to live here and credited a wallet from a caller-supplied payment
   * reference, letting any authenticated user mint balance. Top-ups now start at
   * `POST /api/v1/payments/order` and are credited only by the signed provider webhook.
   */
  app.post('/recharge', async (_request, reply) =>
    reply.code(410).send({
      error: 'ENDPOINT_REMOVED',
      message: 'Use POST /api/v1/payments/order; wallets are credited only by a verified payment webhook',
    }),
  );

  app.get('/transactions', async (request) => {
    const claims = requireUser(request);
    const query = historyQuerySchema.parse(request.query);
    const wallet = await WalletService.getBalanceByUserId(claims.sub);

    const rows = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.walletId },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      select: {
        id: true,
        amount: true,
        type: true,
        referenceType: true,
        referenceId: true,
        balanceAfter: true,
        createdAt: true,
      },
    });

    return {
      balance: wallet.balance.toFixed(2),
      currency: wallet.currency,
      transactions: rows.map((row) => ({
        id: row.id,
        amount: row.amount.toFixed(2),
        type: row.type,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        balanceAfter: row.balanceAfter.toFixed(2),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length === query.limit ? rows[rows.length - 1]?.id ?? null : null,
    };
  });
}
