import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, requireUser } from '../plugins/authenticate.js';
import { prisma } from '../lib/prisma.js';
import { WalletService } from '../services/wallet.service.js';

const rechargeSchema = z.object({
  amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'amount must be a decimal string with <= 2 places'),
  paymentReferenceId: z.string().min(6).max(120),
});

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

  app.post('/recharge', async (request, reply) => {
    const claims = requireUser(request);
    const body = rechargeSchema.parse(request.body);
    // In production this handler runs only after the payment gateway webhook has been verified.
    const movement = await WalletService.recharge(claims.sub, body.amount, body.paymentReferenceId);
    return reply.code(201).send({
      transactionId: movement.transactionId,
      credited: movement.amount.toFixed(2),
      balance: movement.balanceAfter.toFixed(2),
      currency: movement.currency,
    });
  });

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
