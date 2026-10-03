import { ProviderCategory, ProviderKycStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Permission } from '../auth/permissions.js';
import { authenticate } from '../plugins/authenticate.js';
import { requirePermission } from '../plugins/staff.js';
import { ASTROLOGER_PHOTO_PATTERN } from '../services/astrologer-directory.js';
import { recordAudit } from '../services/audit.service.js';
import { DEBOARD_REASONS, payoutAccountSchema, weeklyScheduleSchema } from '../services/provider-admin-rules.js';
import { ProviderAdminService } from '../services/provider-admin.service.js';

const PHOTO_MAX_CHARS = 200_000;
const idParams = z.object({ id: z.string().uuid() });
const tags = (max: number) => z.array(z.string().trim().min(2).max(60)).max(max);
const amount = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.50');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Dates picked in the admin UI are Indian calendar days. */
function istMidnight(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

const updateSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160).optional(),
    category: z.nativeEnum(ProviderCategory).optional(),
    bio: z.string().max(2000).nullable().optional(),
    languages: tags(10).min(1).optional(),
    expertise: tags(8).optional(),
    services: tags(12).optional(),
    experienceYears: z.number().int().min(0).max(80).nullable().optional(),
    perMinuteRate: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(),
    commissionSplit: z.string().regex(/^0(\.\d{1,4})?$|^1(\.0{1,4})?$/, 'Commission is the provider share, 0–1').optional(),
    weeklySchedule: weeklyScheduleSchema.nullable().optional(),
    kycStatus: z.nativeEnum(ProviderKycStatus).optional(),
    identityVerified: z.boolean().optional(),
    profileApproved: z.boolean().optional(),
    photoDataUrl: z
      .string()
      .max(PHOTO_MAX_CHARS, 'Photo is too large')
      .regex(ASTROLOGER_PHOTO_PATTERN, 'Photo must be a JPEG, PNG or WebP image')
      .nullable()
      .optional(),
  })
  .strict();

const payoutSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('RAZORPAYX'), amount, note: z.string().trim().max(500).optional() }),
  z.object({
    method: z.literal('MANUAL'),
    amount,
    mode: z.string().trim().min(2).max(40),
    reference: z.string().trim().min(3).max(120),
    paidOn: isoDate,
    note: z.string().trim().max(500).optional(),
  }),
]);

export async function providerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  const view = { preHandler: requirePermission(Permission.PROVIDERS, Permission.FINANCE) };
  const manage = { preHandler: requirePermission(Permission.PROVIDERS) };
  const finance = { preHandler: requirePermission(Permission.FINANCE) };

  app.get('/', view, async () => ProviderAdminService.list());

  app.get('/:id', view, async (request) => ProviderAdminService.detail(idParams.parse(request.params).id));

  app.patch('/:id', manage, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateSchema.parse(request.body);
    const result = await ProviderAdminService.update(id, body);
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_UPDATED',
      entityType: 'provider',
      entityId: id,
      summary: `${result.item.displayName}: updated ${result.changed.join(', ') || 'nothing'}`,
      metadata: {
        changed: result.changed,
        ...(body.perMinuteRate !== undefined ? { perMinuteRate: body.perMinuteRate } : {}),
        ...(body.commissionSplit !== undefined ? { commissionSplit: body.commissionSplit } : {}),
        ...(body.kycStatus !== undefined ? { kycStatus: body.kycStatus } : {}),
      },
    });
    return result.item;
  });

  app.post('/:id/suspend', manage, async (request) => {
    const { id } = idParams.parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body);
    const result = await ProviderAdminService.suspend(id, reason);
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_SUSPENDED',
      entityType: 'provider',
      entityId: id,
      summary: `${result.item.displayName}: suspended (${reason})`,
      metadata: { from: result.from, reason },
    });
    return result.item;
  });

  app.post('/:id/reinstate', manage, async (request) => {
    const { id } = idParams.parse(request.params);
    const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    const result = await ProviderAdminService.reinstate(id);
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_REINSTATED',
      entityType: 'provider',
      entityId: id,
      summary: `${result.item.displayName}: reinstated from ${result.from.toLowerCase()}`,
      metadata: { from: result.from, note: note ?? null },
    });
    return result.item;
  });

  app.post('/:id/deboard', manage, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        reason: z.enum(DEBOARD_REASONS),
        effectiveDate: isoDate,
        notes: z.string().trim().max(2000).optional(),
      })
      .parse(request.body);
    const result = await ProviderAdminService.deboard(id, {
      reason: body.reason,
      effectiveDate: istMidnight(body.effectiveDate),
      notes: body.notes,
    });
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_DEBOARDED',
      entityType: 'provider',
      entityId: id,
      summary: `${result.item.displayName}: ${result.immediate ? 'deboarded' : `deboarding effective ${body.effectiveDate}`} (${body.reason})`,
      metadata: { from: result.from, reason: body.reason, effectiveDate: body.effectiveDate, notes: body.notes ?? null },
    });
    return result.item;
  });

  app.delete('/:id', manage, async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await ProviderAdminService.remove(id);
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_DELETED',
      entityType: 'provider',
      entityId: id,
      summary: `${result.displayName} (${result.phone}): provider profile deleted`,
    });
    return { deleted: true, id };
  });

  app.patch('/:id/reviews/:reviewId', manage, async (request) => {
    const { id, reviewId } = z.object({ id: z.string().uuid(), reviewId: z.string().uuid() }).parse(request.params);
    const { hidden } = z.object({ hidden: z.boolean() }).parse(request.body);
    const result = await ProviderAdminService.setReviewHidden(id, reviewId, hidden);
    request.auditHandled = true;
    await recordAudit(request, {
      action: hidden ? 'PROVIDER_REVIEW_HIDDEN' : 'PROVIDER_REVIEW_SHOWN',
      entityType: 'provider',
      entityId: id,
      summary: `Review ${hidden ? 'hidden from' : 'restored to'} the provider rating`,
      metadata: { reviewId },
    });
    return result;
  });

  // --- Payouts -------------------------------------------------------------------------------

  app.get('/:id/payouts', view, async (request) => ProviderAdminService.payouts(idParams.parse(request.params).id));

  app.put('/:id/payout-account', finance, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = payoutAccountSchema.parse(request.body);
    const destination = await ProviderAdminService.savePayoutAccount(id, body, { userId: request.staff!.userId });
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_PAYOUT_ACCOUNT_SAVED',
      entityType: 'provider',
      entityId: id,
      summary: `Payout account set to ${destination}`,
      metadata: { accountType: body.accountType },
    });
    return ProviderAdminService.payouts(id);
  });

  app.post('/:id/payouts', finance, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = payoutSchema.parse(request.body);
    const result = await ProviderAdminService.createPayout(
      id,
      body.method === 'MANUAL'
        ? { method: 'MANUAL', amount: body.amount, mode: body.mode, reference: body.reference, paidOn: istMidnight(body.paidOn), note: body.note }
        : { method: 'RAZORPAYX', amount: body.amount, note: body.note },
      { userId: request.staff!.userId },
    );
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_PAYOUT_CREATED',
      entityType: 'provider',
      entityId: id,
      summary: `${result.displayName}: ₹${result.payout.amount} payout ${body.method === 'MANUAL' ? 'recorded' : 'sent via RazorpayX'} (${result.payout.status.toLowerCase()})`,
      metadata: { payoutId: result.payout.id, method: body.method, amount: result.payout.amount, status: result.payout.status },
    });
    return reply.code(201).send(result.payout);
  });

  app.post('/:id/payouts/:payoutId/refresh', finance, async (request) => {
    const { id, payoutId } = z.object({ id: z.string().uuid(), payoutId: z.string().uuid() }).parse(request.params);
    request.auditHandled = true;
    return ProviderAdminService.refreshPayout(id, payoutId);
  });
}
