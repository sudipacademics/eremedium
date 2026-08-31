import { AstrologerStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { money, prisma } from '../lib/prisma.js';
import { authenticate, requireUser } from '../plugins/authenticate.js';

export class AstrologerError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'AstrologerError';
    this.statusCode = statusCode;
  }
}

const applySchema = z.object({
  displayName: z.string().min(2).max(160),
  languages: z.array(z.string().min(2).max(40)).min(1).max(10),
});

const availabilitySchema = z.object({
  online: z.boolean(),
});

const rateSchema = z.object({
  perMinuteRate: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(),
  commissionSplit: z.string().regex(/^0(\.\d{1,4})?$|^1(\.0{1,4})?$/).optional(),
});

const listQuerySchema = z.object({
  onlineOnly: z.enum(['true', 'false']).default('true'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function astrologerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Browse consultants. Only IDLE astrologers are bookable right now. */
  app.get('/', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const rows = await prisma.astrologer.findMany({
      where: query.onlineOnly === 'true' ? { status: AstrologerStatus.IDLE } : {},
      orderBy: { createdAt: 'asc' },
      take: query.limit,
      select: {
        id: true,
        displayName: true,
        perMinuteRate: true,
        status: true,
        languages: true,
      },
    });

    return {
      astrologers: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        perMinuteRate: money(row.perMinuteRate).toFixed(2),
        status: row.status,
        languages: row.languages,
        // Surfaced so a client can check affordability before attempting a call.
        minimumBalanceRequired: money(
          money(row.perMinuteRate).times(env.MIN_CALL_MINUTES_BUFFER),
        ).toFixed(2),
      })),
    };
  });

  /**
   * Self-service application. The rate is deliberately NOT caller-supplied: pricing is a platform
   * decision, and letting an applicant name their own per-minute rate would let them set what users
   * are charged. An admin adjusts it afterwards.
   */
  app.post('/apply', async (request, reply) => {
    const claims = requireUser(request);
    const body = applySchema.parse(request.body);

    const existing = await prisma.astrologer.findUnique({
      where: { userId: claims.sub },
      select: { id: true },
    });
    if (existing) {
      throw new AstrologerError('This account is already registered as an astrologer');
    }

    const created = await prisma.astrologer.create({
      data: {
        userId: claims.sub,
        displayName: body.displayName,
        languages: body.languages,
        perMinuteRate: money(env.ASTROLOGER_DEFAULT_RATE),
        // Starts OFFLINE: nobody becomes bookable just by applying.
        status: AstrologerStatus.OFFLINE,
      },
      select: { id: true, displayName: true, perMinuteRate: true, status: true, commissionSplit: true },
    });

    logger.info({ userId: claims.sub, astrologerId: created.id }, 'Astrologer profile created');

    return reply.code(201).send({
      id: created.id,
      displayName: created.displayName,
      perMinuteRate: money(created.perMinuteRate).toFixed(2),
      status: created.status,
      note: 'Re-authenticate to receive a token carrying the ASTROLOGER role',
    });
  });

  /**
   * Go online / offline. Only the OFFLINE <-> IDLE transition is caller-controlled; BUSY and IN_CALL
   * are owned by the matching and call engines, and letting a client set them would corrupt the
   * reservation that stops two users booking the same astrologer.
   */
  app.patch('/me/availability', async (request) => {
    const claims = requireUser(request);
    const body = availabilitySchema.parse(request.body);

    const astrologer = await prisma.astrologer.findUnique({
      where: { userId: claims.sub },
      select: { id: true, status: true },
    });
    if (!astrologer) {
      throw new AstrologerError('This account is not an astrologer', 404);
    }
    if (astrologer.status === AstrologerStatus.IN_CALL || astrologer.status === AstrologerStatus.BUSY) {
      throw new AstrologerError(`Cannot change availability while ${astrologer.status}`);
    }

    const target = body.online ? AstrologerStatus.IDLE : AstrologerStatus.OFFLINE;
    // Conditional update: refuses if the engine changed status underneath us.
    const updated = await prisma.astrologer.updateMany({
      where: { id: astrologer.id, status: { in: [AstrologerStatus.IDLE, AstrologerStatus.OFFLINE] } },
      data: { status: target },
    });
    if (updated.count !== 1) {
      throw new AstrologerError('Availability changed concurrently; retry');
    }

    return { id: astrologer.id, status: target };
  });

  app.get('/me/earnings', async (request) => {
    const claims = requireUser(request);
    const astrologer = await prisma.astrologer.findUnique({
      where: { userId: claims.sub },
      select: { id: true, commissionSplit: true },
    });
    if (!astrologer) {
      throw new AstrologerError('This account is not an astrologer', 404);
    }

    const [totals, recent] = await Promise.all([
      prisma.astrologerEarning.aggregate({
        where: { astrologerId: astrologer.id },
        _sum: { netAmount: true, grossAmount: true, platformFee: true },
        _count: true,
      }),
      prisma.astrologerEarning.findMany({
        where: { astrologerId: astrologer.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          callSessionId: true,
          minuteNumber: true,
          grossAmount: true,
          netAmount: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      commissionSplit: astrologer.commissionSplit.toFixed(4),
      billedMinutes: totals._count,
      grossEarned: money(totals._sum.grossAmount ?? 0).toFixed(2),
      netEarned: money(totals._sum.netAmount ?? 0).toFixed(2),
      platformFee: money(totals._sum.platformFee ?? 0).toFixed(2),
      recent: recent.map((row) => ({
        callSessionId: row.callSessionId,
        minute: row.minuteNumber,
        gross: money(row.grossAmount).toFixed(2),
        net: money(row.netAmount).toFixed(2),
        at: row.createdAt.toISOString(),
      })),
    };
  });

  /** Pricing changes are an admin action: they decide what every future user is charged. */
  app.patch('/:astrologerId/pricing', async (request) => {
    const claims = requireUser(request);
    if (claims.role !== AppRole.ADMIN) {
      throw new AstrologerError('Admin role required', 403);
    }
    const { astrologerId } = z.object({ astrologerId: z.string().uuid() }).parse(request.params);
    const body = rateSchema.parse(request.body);
    if (!body.perMinuteRate && !body.commissionSplit) {
      throw new AstrologerError('Supply perMinuteRate and/or commissionSplit', 400);
    }

    const updated = await prisma.astrologer.update({
      where: { id: astrologerId },
      data: {
        ...(body.perMinuteRate === undefined ? {} : { perMinuteRate: money(body.perMinuteRate) }),
        ...(body.commissionSplit === undefined ? {} : { commissionSplit: body.commissionSplit }),
      },
      select: { id: true, perMinuteRate: true, commissionSplit: true },
    });

    logger.warn(
      { adminUserId: claims.sub, astrologerId, ...body },
      'Astrologer pricing changed by admin',
    );

    return {
      id: updated.id,
      perMinuteRate: money(updated.perMinuteRate).toFixed(2),
      commissionSplit: updated.commissionSplit.toFixed(4),
      // Existing earnings keep their own snapshot, so this only affects future minutes.
      note: 'Applies to future billed minutes only',
    };
  });
}
