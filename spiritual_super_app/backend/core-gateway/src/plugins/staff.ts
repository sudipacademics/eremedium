import type { StaffRole } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { hasAnyPermission, permissionsFor, type Permission } from '../auth/permissions.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

export interface StaffContext {
  userId: string;
  phone: string;
  role: StaffRole;
  permissions: readonly Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffContext;
    /** Set by handlers that write their own audit entry, so the generic activity hook skips them. */
    auditHandled?: boolean;
  }
}

/**
 * Looked up on every admin request rather than read from the JWT, so deactivating a staff member or
 * changing their role takes effect immediately instead of when their token expires.
 */
export async function resolveStaffRole(userId: string, phone: string): Promise<StaffRole | null> {
  if (env.ADMIN_PHONES.includes(phone)) return 'SUPER_ADMIN';
  const row = await prisma.staffMember.findUnique({
    where: { userId },
    select: { role: true, active: true },
  });
  return row?.active ? row.role : null;
}

/** preHandler: the caller must be active staff holding at least one of the permissions. */
export function requirePermission(...required: readonly Permission[]) {
  return async function permissionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const claims = request.auth;
    if (!claims) {
      await reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }
    const role = await resolveStaffRole(claims.sub, claims.phone);
    if (!role) {
      await reply.code(403).send({ error: 'FORBIDDEN', message: 'Staff access required' });
      return;
    }
    if (required.length > 0 && !hasAnyPermission(role, required)) {
      await reply.code(403).send({ error: 'FORBIDDEN', message: 'Your role does not allow this action' });
      return;
    }
    request.staff = { userId: claims.sub, phone: claims.phone, role, permissions: permissionsFor(role) };
  };
}
