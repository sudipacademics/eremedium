import { JoinRequestStatus, ProviderCategory } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Permission } from '../auth/permissions.js';
import { authenticate, authenticateUnlessPublic } from '../plugins/authenticate.js';
import { requirePermission } from '../plugins/staff.js';
import { recordAudit } from '../services/audit.service.js';
import { APPLICATION_NO_PATTERN, STATUS_LABELS } from '../services/join-request-rules.js';
import { JoinRequestService, MAX_DOCUMENTS } from '../services/join-request.service.js';

/** Base64 inflates by a third: five 2.5 MB documents plus a 1 MB photo stay under this. */
const SUBMIT_BODY_LIMIT = 19 * 1_048_576;

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .transform((value) => (/^\d{10}$/.test(value) ? `+91${value}` : value))
  .refine((value) => /^\+?[1-9]\d{7,14}$/.test(value), 'Enter a valid mobile number')
  .transform((value) => (value.startsWith('+') ? value : `+${value}`));

const applicationNoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => APPLICATION_NO_PATTERN.test(value), 'Enter a valid application ID, e.g. VSJ-261003-7KQ2M');

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dataUrl: z.string().min(20),
  label: z.string().trim().max(120).optional(),
});

const textList = (max: number, maxLength: number) => z.array(z.string().trim().min(1).max(maxLength)).max(max);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const submitSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    phone: phoneSchema,
    email: z.string().trim().toLowerCase().email().max(254),
    address: z.string().trim().min(5).max(500),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    dateOfBirth: isoDate.refine((value) => {
      const dob = new Date(`${value}T00:00:00.000Z`);
      const age = (Date.now() - dob.getTime()) / (365.25 * 86_400_000);
      return !Number.isNaN(dob.getTime()) && age >= 18 && age <= 110;
    }, 'Applicants must be at least 18 years old'),
    category: z.nativeEnum(ProviderCategory),
    categoryOther: z.string().trim().max(80).optional(),
    expertise: textList(12, 60).min(1, 'Add at least one area of expertise'),
    experienceYears: z.number().int().min(0).max(80),
    languages: textList(10, 40).min(1, 'Add at least one language'),
    qualification: z.string().trim().min(2).max(500),
    about: z.string().trim().min(30, 'Tell us a little more about yourself (30+ characters)').max(3000),
    services: textList(15, 80).min(1, 'Add at least one service'),
    photo: uploadSchema,
    documents: z.array(uploadSchema).min(1, 'Attach at least one supporting document').max(MAX_DOCUMENTS),
  })
  .refine((value) => value.category !== 'OTHER' || Boolean(value.categoryOther?.trim()), {
    path: ['categoryOther'],
    message: 'Describe your professional category',
  });

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.nativeEnum(JoinRequestStatus).optional(),
  category: z.nativeEnum(ProviderCategory).optional(),
  location: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

const idParams = z.object({ id: z.string().uuid() });

export async function joinRequestPublicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticateUnlessPublic);

  app.post(
    '/',
    { bodyLimit: SUBMIT_BODY_LIMIT, config: { public: true, rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const body = submitSchema.parse(request.body);
      const result = await JoinRequestService.submit(body, request.auth?.sub ?? null);
      return reply.code(201).send(result);
    },
  );

  app.get('/status', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const query = z.object({ applicationNo: applicationNoSchema, phone: phoneSchema }).parse(request.query);
    return JoinRequestService.publicStatus(query.applicationNo, query.phone);
  });

  app.post(
    '/respond',
    { bodyLimit: SUBMIT_BODY_LIMIT, config: { public: true, rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request) => {
      const body = z
        .object({
          applicationNo: applicationNoSchema,
          phone: phoneSchema,
          message: z.string().trim().min(2).max(1500),
          documents: z.array(uploadSchema).max(MAX_DOCUMENTS).default([]),
        })
        .parse(request.body);
      return JoinRequestService.respond(body);
    },
  );
}

export async function joinRequestAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requirePermission(Permission.JOIN_REQUESTS));

  app.get('/', async (request) => JoinRequestService.list(listQuerySchema.parse(request.query)));

  app.get('/export.csv', async (request, reply) => {
    const { page: _page, pageSize: _pageSize, ...filters } = listQuerySchema.parse(request.query);
    const csv = await JoinRequestService.exportCsv(filters);
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'JOIN_REQUESTS_EXPORTED',
      entityType: 'join_request',
      summary: 'Exported provider join requests to CSV',
      metadata: filters,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="join-requests-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(`\uFEFF${csv}`);
  });

  app.get('/:id', async (request) => JoinRequestService.detail(idParams.parse(request.params).id));

  app.get('/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = z.object({ id: z.string().uuid(), fileId: z.string().uuid() }).parse(request.params);
    const { file, bytes } = await JoinRequestService.file(id, fileId);
    return reply
      .header('content-type', file.mimeType)
      .header('content-disposition', `inline; filename="${file.originalName.replace(/"/g, '')}"`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, no-store')
      .send(bytes);
  });

  app.patch('/:id/status', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        status: z.nativeEnum(JoinRequestStatus),
        note: z.string().trim().max(2000).optional(),
        createAccount: z.boolean().optional(),
      })
      .parse(request.body);
    const staff = request.staff!;
    const before = await JoinRequestService.detail(id);
    const result = await JoinRequestService.changeStatus(id, body, { userId: staff.userId });
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'JOIN_REQUEST_STATUS_CHANGED',
      entityType: 'join_request',
      entityId: id,
      summary: `${result.applicationNo}: ${STATUS_LABELS[before.status]} → ${STATUS_LABELS[result.status]}`,
      metadata: {
        from: before.status,
        to: result.status,
        note: body.note ?? null,
        providerAstrologerId: result.providerAstrologerId,
      },
    });
    return result;
  });

  app.post('/:id/provision', async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await JoinRequestService.provision(id, { userId: request.staff!.userId });
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'PROVIDER_PROVISIONED',
      entityType: 'join_request',
      entityId: id,
      summary: `${result.applicationNo}: provider account created`,
      metadata: { providerAstrologerId: result.providerAstrologerId },
    });
    return result;
  });

  app.post('/:id/notes', async (request) => {
    const { id } = idParams.parse(request.params);
    const { note } = z.object({ note: z.string().trim().min(2).max(2000) }).parse(request.body);
    const result = await JoinRequestService.addNote(id, note, { userId: request.staff!.userId });
    request.auditHandled = true;
    await recordAudit(request, {
      action: 'JOIN_REQUEST_NOTE_ADDED',
      entityType: 'join_request',
      entityId: id,
      summary: `${result.applicationNo}: internal note added`,
    });
    return result;
  });
}
