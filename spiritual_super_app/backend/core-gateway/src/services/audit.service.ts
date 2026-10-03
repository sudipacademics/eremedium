import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** An audit write must never fail the action it describes; failures are logged instead. */
export async function recordAudit(request: FastifyRequest, entry: AuditEntry): Promise<void> {
  const actor = request.staff ?? (request.auth ? { userId: request.auth.sub, phone: request.auth.phone, role: request.auth.role } : null);
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: actor?.userId ?? null,
        actorPhone: actor?.phone ?? null,
        actorRole: actor?.role ?? null,
        action: entry.action.slice(0, 80),
        entityType: entry.entityType.slice(0, 60),
        entityId: entry.entityId?.slice(0, 120) ?? null,
        summary: entry.summary.slice(0, 500),
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
        ip: request.ip.slice(0, 64),
      },
    });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, 'Audit log write failed');
  }
}

/**
 * Derives an audit entry for a staff mutation that did not record its own. The route pattern names
 * the action; only body keys are kept, since bodies can carry images or personal details.
 */
export function describeStaffMutation(request: FastifyRequest): AuditEntry | null {
  if (!MUTATING_METHODS.has(request.method)) return null;
  const route = request.routeOptions.url ?? request.url.split('?')[0] ?? '';
  const segments = route
    .replace(/^\/api\/v1\//, '')
    .split('/')
    .filter((segment) => segment && segment !== 'admin' && !segment.startsWith(':'));
  const entityType = segments.slice(0, 2).join('.') || 'admin';
  const params = (request.params ?? {}) as Record<string, unknown>;
  const entityId = Object.values(params).find(
    (value): value is string => typeof value === 'string' && UUID_PATTERN.test(value),
  );
  const body = request.body;
  const bodyKeys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).slice(0, 30) : [];
  return {
    action: `${request.method} ${route}`,
    entityType,
    entityId: entityId ?? null,
    summary: `${request.method} ${route.replace(/^\/api\/v1/, '')}`,
    metadata: { params: params as Prisma.InputJsonValue, bodyKeys },
  };
}
