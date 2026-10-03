import {
  AstrologerStatus,
  AyurvedaOrderStatus,
  JoinRequestStatus,
  PaymentOrderStatus,
  PujaBookingStatus,
  StaffRole,
  type Prisma,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Permission, STAFF_ROLE_LABELS, permissionsFor } from '../auth/permissions.js';
import { env } from '../config/env.js';
import { money, prisma } from '../lib/prisma.js';
import { authenticate } from '../plugins/authenticate.js';
import { requirePermission } from '../plugins/staff.js';
import { recordAudit } from '../services/audit.service.js';
import { CATEGORY_LABELS, OPEN_STATUSES, STATUS_LABELS, csvCell } from '../services/join-request-rules.js';

class AdminError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'AdminError';
    this.statusCode = statusCode;
  }
}

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .transform((value) => (/^\d{10}$/.test(value) ? `+91${value}` : value))
  .refine((value) => /^\+?[1-9]\d{7,14}$/.test(value), 'Enter a valid mobile number')
  .transform((value) => (value.startsWith('+') ? value : `+${value}`));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const auditQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(60).optional(),
  actor: z.string().trim().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

function auditWhere(query: Omit<z.infer<typeof auditQuerySchema>, 'page' | 'pageSize'>): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (query.q) {
    and.push({
      OR: [
        { summary: { contains: query.q, mode: 'insensitive' } },
        { action: { contains: query.q, mode: 'insensitive' } },
        { entityId: { contains: query.q } },
      ],
    });
  }
  if (query.entityType) and.push({ entityType: query.entityType });
  if (query.actor) and.push({ actorPhone: { contains: query.actor.replace(/[\s()-]/g, '') } });
  if (query.from) and.push({ createdAt: { gte: new Date(`${query.from}T00:00:00.000Z`) } });
  if (query.to) and.push({ createdAt: { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) } });
  return and.length > 0 ? { AND: and } : {};
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function startOfTodayIst(): Date {
  const istOffsetMs = 330 * 60_000;
  const nowIst = new Date(Date.now() + istOffsetMs);
  nowIst.setUTCHours(0, 0, 0, 0);
  return new Date(nowIst.getTime() - istOffsetMs);
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AdminError) {
      return reply.code(error.statusCode).send({ error: error.name, message: error.message });
    }
    throw error;
  });

  /** Who am I in the admin: role and the permissions that drive the dashboard navigation. */
  app.get('/me', { preHandler: requirePermission() }, async (request) => {
    const staff = request.staff!;
    return {
      role: staff.role,
      roleLabel: STAFF_ROLE_LABELS[staff.role],
      permissions: staff.permissions,
      viaAdminPhones: env.ADMIN_PHONES.includes(staff.phone),
    };
  });

  app.get('/overview', { preHandler: requirePermission(Permission.DASHBOARD) }, async (request) => {
    const staff = request.staff!;
    const canFinance = staff.permissions.includes(Permission.FINANCE);
    const canJoin = staff.permissions.includes(Permission.JOIN_REQUESTS);
    const today = startOfTodayIst();
    const monthAgo = daysAgo(30);

    const [
      usersTotal,
      usersNew7d,
      providersTotal,
      providersOnline,
      providersByCategory,
      joinOpen,
      joinPending,
      pujaOpen,
      ordersOpen,
      callsToday,
      callsActive,
      recentJoin,
      recharge30d,
      consultation30d,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      prisma.astrologer.count(),
      prisma.astrologer.count({ where: { status: { in: [AstrologerStatus.IDLE, AstrologerStatus.BUSY, AstrologerStatus.IN_CALL] } } }),
      prisma.astrologer.groupBy({ by: ['category'], _count: { _all: true } }),
      prisma.providerJoinRequest.count({ where: { status: { in: [...OPEN_STATUSES] } } }),
      prisma.providerJoinRequest.count({ where: { status: JoinRequestStatus.PENDING } }),
      prisma.pujaBooking.count({ where: { status: { in: [PujaBookingStatus.CONFIRMED, PujaBookingStatus.IN_PROGRESS] } } }),
      prisma.ayurvedaOrder.count({ where: { status: { in: [AyurvedaOrderStatus.CONFIRMED, AyurvedaOrderStatus.PACKED] } } }),
      prisma.callSession.count({ where: { createdAt: { gte: today } } }),
      prisma.callSession.count({ where: { status: 'ACTIVE' } }),
      canJoin
        ? prisma.providerJoinRequest.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, applicationNo: true, name: true, category: true, city: true, status: true, createdAt: true },
          })
        : Promise.resolve([]),
      canFinance
        ? prisma.paymentOrder.aggregate({ where: { status: PaymentOrderStatus.PAID, paidAt: { gte: monthAgo } }, _sum: { amount: true }, _count: true })
        : Promise.resolve(null),
      canFinance
        ? prisma.astrologerEarning.aggregate({ where: { createdAt: { gte: monthAgo } }, _sum: { grossAmount: true, platformFee: true } })
        : Promise.resolve(null),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      users: { total: usersTotal, new7d: usersNew7d },
      providers: {
        total: providersTotal,
        online: providersOnline,
        byCategory: providersByCategory.map((group) => ({
          category: group.category,
          label: CATEGORY_LABELS[group.category],
          count: group._count._all,
        })),
      },
      joinRequests: { open: joinOpen, pending: joinPending },
      operations: { pujaBookingsOpen: pujaOpen, shopOrdersOpen: ordersOpen, callsToday, callsActive },
      finance:
        recharge30d && consultation30d
          ? {
              walletRecharges30d: money(recharge30d._sum.amount ?? 0).toFixed(2),
              walletRechargeCount30d: recharge30d._count,
              consultationGross30d: money(consultation30d._sum.grossAmount ?? 0).toFixed(2),
              platformFee30d: money(consultation30d._sum.platformFee ?? 0).toFixed(2),
            }
          : null,
      recentJoinRequests: recentJoin.map((row) => ({
        id: row.id,
        applicationNo: row.applicationNo,
        name: row.name,
        categoryLabel: CATEGORY_LABELS[row.category],
        city: row.city,
        status: row.status,
        statusLabel: STATUS_LABELS[row.status],
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  // --- Staff & roles (Super Admin only) ---------------------------------------------------------

  app.get('/staff', { preHandler: requirePermission(Permission.STAFF) }, async () => {
    const rows = await prisma.staffMember.findMany({
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });
    const envUsers = await prisma.user.findMany({
      where: { phone: { in: env.ADMIN_PHONES } },
      select: { id: true, name: true, phone: true },
    });
    const envByPhone = new Map(envUsers.map((user) => [user.phone, user]));
    return {
      roles: Object.values(StaffRole).map((role) => ({ role, label: STAFF_ROLE_LABELS[role], permissions: permissionsFor(role) })),
      builtIn: env.ADMIN_PHONES.map((phone) => ({
        phone,
        name: envByPhone.get(phone)?.name ?? null,
        role: StaffRole.SUPER_ADMIN,
        roleLabel: STAFF_ROLE_LABELS[StaffRole.SUPER_ADMIN],
      })),
      staff: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.user.name,
        phone: row.user.phone,
        role: row.role,
        roleLabel: STAFF_ROLE_LABELS[row.role],
        active: row.active,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  });

  app.post('/staff', { preHandler: requirePermission(Permission.STAFF) }, async (request, reply) => {
    const body = z
      .object({ phone: phoneSchema, name: z.string().trim().min(2).max(160).optional(), role: z.nativeEnum(StaffRole) })
      .parse(request.body);
    if (env.ADMIN_PHONES.includes(body.phone)) {
      throw new AdminError('This number is already a built-in Super Admin');
    }
    const staffMember = await prisma.$transaction(async (tx) => {
      const user =
        (await tx.user.findUnique({ where: { phone: body.phone }, select: { id: true } })) ??
        (await tx.user.create({
          data: { phone: body.phone, name: body.name ?? 'Vedsutra Staff', wallet: { create: { balance: 0, currency: 'INR' } } },
          select: { id: true },
        }));
      const existing = await tx.staffMember.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (existing) throw new AdminError('This person is already a staff member; edit their role instead');
      return tx.staffMember.create({ data: { userId: user.id, role: body.role, createdBy: request.staff!.userId } });
    });
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'STAFF_ADDED',
      entityType: 'staff',
      entityId: staffMember.id,
      summary: `Added ${body.phone} as ${STAFF_ROLE_LABELS[body.role]}`,
      metadata: { phone: body.phone, role: body.role },
    });
    return reply.code(201).send({ id: staffMember.id });
  });

  app.patch('/staff/:id', { preHandler: requirePermission(Permission.STAFF) }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: z.nativeEnum(StaffRole).optional(), active: z.boolean().optional() }).parse(request.body);
    const row = await prisma.staffMember.findUnique({ where: { id }, include: { user: { select: { phone: true } } } });
    if (!row) throw new AdminError('Staff member not found', 404);
    if (row.userId === request.staff!.userId) throw new AdminError('You cannot change your own role or access');
    const updated = await prisma.staffMember.update({
      where: { id },
      data: { ...(body.role ? { role: body.role } : {}), ...(body.active === undefined ? {} : { active: body.active }) },
    });
    const changes = [
      body.role && body.role !== row.role ? `role ${STAFF_ROLE_LABELS[row.role]} → ${STAFF_ROLE_LABELS[body.role]}` : null,
      body.active !== undefined && body.active !== row.active ? (body.active ? 'activated' : 'deactivated') : null,
    ].filter(Boolean);
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'STAFF_UPDATED',
      entityType: 'staff',
      entityId: id,
      summary: `${row.user.phone}: ${changes.join(', ') || 'no change'}`,
      metadata: { before: { role: row.role, active: row.active }, after: { role: updated.role, active: updated.active } },
    });
    return { id, role: updated.role, active: updated.active };
  });

  app.delete('/staff/:id', { preHandler: requirePermission(Permission.STAFF) }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await prisma.staffMember.findUnique({ where: { id }, include: { user: { select: { phone: true } } } });
    if (!row) throw new AdminError('Staff member not found', 404);
    if (row.userId === request.staff!.userId) throw new AdminError('You cannot remove yourself');
    await prisma.staffMember.delete({ where: { id } });
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'STAFF_REMOVED',
      entityType: 'staff',
      entityId: id,
      summary: `Removed ${row.user.phone} (${STAFF_ROLE_LABELS[row.role]}) from staff`,
    });
    return { removed: true };
  });

  // --- Audit trail ------------------------------------------------------------------------------

  app.get('/audit', { preHandler: requirePermission(Permission.AUDIT) }, async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const where = auditWhere(query);
    const [rows, total, types] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      entityTypes: types.map((type) => type.entityType),
      items: rows.map((row) => ({
        id: row.id,
        actorPhone: row.actorPhone,
        actorRole: row.actorRole,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary,
        metadata: row.metadata,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.get('/audit/export.csv', { preHandler: requirePermission(Permission.AUDIT) }, async (request, reply) => {
    const { page: _page, pageSize: _pageSize, ...filters } = auditQuerySchema.parse(request.query);
    const rows = await prisma.auditLog.findMany({ where: auditWhere(filters), orderBy: { createdAt: 'desc' }, take: 10_000 });
    const header = ['Time', 'Actor phone', 'Actor role', 'Action', 'Entity type', 'Entity ID', 'Summary', 'IP'];
    const lines = rows.map((row) =>
      [row.createdAt.toISOString(), row.actorPhone, row.actorRole, row.action, row.entityType, row.entityId, row.summary, row.ip]
        .map(csvCell)
        .join(','),
    );
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(`\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}`);
  });
}
