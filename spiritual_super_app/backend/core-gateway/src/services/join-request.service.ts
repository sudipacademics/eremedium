import {
  AstrologerStatus,
  JoinRequestFileKind,
  JoinRequestStatus,
  Prisma,
  type ProviderCategory,
} from '@prisma/client';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { money, prisma } from '../lib/prisma.js';
import { brandedHtml, sendEmail } from './email.service.js';
import {
  CATEGORY_LABELS,
  OPEN_STATUSES,
  STATUS_LABELS,
  allowedTransitions,
  canTransition,
  cleanList,
  csvCell,
  generateApplicationNo,
} from './join-request-rules.js';
import { NotificationService } from './notification.service.js';
import { decodeDataUrl, readUpload, removeUpload, storeUpload, type DecodedUpload } from './upload-storage.js';

export class JoinRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'JoinRequestError';
    this.statusCode = statusCode;
  }
}

export const PHOTO_MAX_BYTES = 1_048_576;
export const DOCUMENT_MAX_BYTES = 2_621_440;
export const MAX_DOCUMENTS = 5;
/** The provider card photo is stored inline on the astrologer row, which caps it at this size. */
const PROVIDER_PHOTO_MAX_CHARS = 200_000;
const UPLOAD_FOLDER = 'join-requests';

export interface UploadInput {
  name: string;
  dataUrl: string;
  label?: string | undefined;
}

export interface SubmitInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  dateOfBirth: string;
  category: ProviderCategory;
  categoryOther?: string | undefined;
  expertise: string[];
  experienceYears: number;
  languages: string[];
  qualification: string;
  about: string;
  services: string[];
  photo: UploadInput;
  documents: UploadInput[];
}

export interface ListQuery {
  q?: string | undefined;
  status?: JoinRequestStatus | undefined;
  category?: ProviderCategory | undefined;
  location?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  pageSize: number;
}

export interface StaffActor {
  userId: string;
}

function siteUrl(pathname: string): string {
  const domain = env.PUBLIC_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const scheme = domain.startsWith('localhost') ? 'http' : 'https';
  return `${scheme}://${domain}${pathname}`;
}

function cleanFileName(name: string): string {
  return name.replace(/[^\w.\- ()]+/g, '_').slice(0, 200) || 'file';
}

interface PreparedFile {
  kind: JoinRequestFileKind;
  label: string | null;
  originalName: string;
  upload: DecodedUpload;
}

function prepareFiles(photo: UploadInput | null, documents: readonly UploadInput[]): PreparedFile[] {
  if (documents.length > MAX_DOCUMENTS) throw new JoinRequestError(`Attach at most ${MAX_DOCUMENTS} documents`, 400);
  const files: PreparedFile[] = [];
  if (photo) {
    files.push({
      kind: JoinRequestFileKind.PHOTO,
      label: 'Profile photo',
      originalName: cleanFileName(photo.name),
      upload: decodeDataUrl(photo.dataUrl, { maxBytes: PHOTO_MAX_BYTES, allowed: ['image/jpeg', 'image/png', 'image/webp'] }),
    });
  }
  for (const document of documents) {
    files.push({
      kind: JoinRequestFileKind.DOCUMENT,
      label: document.label?.trim().slice(0, 120) || null,
      originalName: cleanFileName(document.name),
      upload: decodeDataUrl(document.dataUrl, {
        maxBytes: DOCUMENT_MAX_BYTES,
        allowed: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      }),
    });
  }
  return files;
}

/** Writes files to disk; on any failure removes what was written so no orphans are left. */
async function persistFiles(files: readonly PreparedFile[]) {
  const stored: { file: PreparedFile; storageKey: string }[] = [];
  try {
    for (const file of files) {
      stored.push({ file, storageKey: await storeUpload(UPLOAD_FOLDER, file.upload) });
    }
  } catch (error) {
    await Promise.all(stored.map((entry) => removeUpload(entry.storageKey).catch(() => undefined)));
    throw error;
  }
  return stored.map(({ file, storageKey }) => ({
    kind: file.kind,
    label: file.label,
    originalName: file.originalName,
    mimeType: file.upload.mimeType,
    sizeBytes: file.upload.bytes.length,
    storageKey,
  }));
}

async function notifyApplicant(
  request: { userId: string | null; phone: string; email: string; name: string; applicationNo: string },
  content: { title: string; paragraphs: string[]; link: string; cta: string },
): Promise<void> {
  try {
    await NotificationService.create({
      userId: request.userId,
      phone: request.phone,
      title: content.title,
      body: content.paragraphs.join(' '),
      link: content.link,
    });
  } catch (error) {
    logger.error({ err: error, applicationNo: request.applicationNo }, 'Applicant notification failed');
  }
  const greeting = `Namaste ${request.name.split(' ')[0] ?? request.name},`;
  void sendEmail({
    to: request.email,
    subject: `${content.title} — ${request.applicationNo}`,
    text: [greeting, ...content.paragraphs, `${content.cta}: ${siteUrl(content.link)}`].join('\n\n'),
    html: brandedHtml(content.title, [greeting, ...content.paragraphs], { label: content.cta, href: siteUrl(content.link) }),
  });
}

function statusLink(applicationNo: string): string {
  return `/join/status?application=${encodeURIComponent(applicationNo)}`;
}

const STATUS_MESSAGES: Partial<Record<JoinRequestStatus, (note: string | null) => { title: string; paragraphs: string[] }>> = {
  [JoinRequestStatus.UNDER_REVIEW]: () => ({
    title: 'Your application is under review',
    paragraphs: ['Our team has started reviewing your Vedsutra expert application. We will update you soon.'],
  }),
  [JoinRequestStatus.MORE_INFO_REQUESTED]: (note) => ({
    title: 'More information needed for your application',
    paragraphs: [
      'Our team needs a little more information to continue reviewing your application.',
      ...(note ? [`Note from the team: ${note}`] : []),
      'Please open your application status page to reply and attach any documents.',
    ],
  }),
  [JoinRequestStatus.REJECTED]: (note) => ({
    title: 'Update on your Vedsutra application',
    paragraphs: [
      'Thank you for your interest in joining Vedsutra. After careful review we are unable to approve your application at this time.',
      ...(note ? [`Note from the team: ${note}`] : []),
    ],
  }),
};

const detailInclude = {
  files: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ProviderJoinRequestInclude;

type DetailRow = Prisma.ProviderJoinRequestGetPayload<{ include: typeof detailInclude }>;

async function actorNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, phone: true } });
  return new Map(users.map((user) => [user.id, user.name || user.phone]));
}

async function serializeDetail(row: DetailRow) {
  const names = await actorNames([row.reviewedBy, ...row.events.map((event) => event.actorUserId)]);
  return {
    id: row.id,
    applicationNo: row.applicationNo,
    userId: row.userId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    state: row.state,
    dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category],
    categoryOther: row.categoryOther,
    expertise: row.expertise,
    experienceYears: row.experienceYears,
    languages: row.languages,
    qualification: row.qualification,
    about: row.about,
    services: row.services,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    allowedStatuses: allowedTransitions(row.status),
    adminNote: row.adminNote,
    reviewedBy: row.reviewedBy ? (names.get(row.reviewedBy) ?? null) : null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    providerAstrologerId: row.providerAstrologerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    files: row.files.map((file) => ({
      id: file.id,
      kind: file.kind,
      label: file.label,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt.toISOString(),
    })),
    events: row.events.map((event) => ({
      id: event.id,
      actorKind: event.actorKind,
      actorName: event.actorUserId ? (names.get(event.actorUserId) ?? null) : null,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

function listWhere(query: Omit<ListQuery, 'page' | 'pageSize'>): Prisma.ProviderJoinRequestWhereInput {
  const and: Prisma.ProviderJoinRequestWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.category) and.push({ category: query.category });
  if (query.q?.trim()) {
    const q = query.q.trim();
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q.replace(/[\s()-]/g, '') } },
        { applicationNo: { contains: q.toUpperCase() } },
      ],
    });
  }
  if (query.location?.trim()) {
    const location = query.location.trim();
    and.push({
      OR: [
        { city: { contains: location, mode: 'insensitive' } },
        { state: { contains: location, mode: 'insensitive' } },
        { address: { contains: location, mode: 'insensitive' } },
      ],
    });
  }
  if (query.from) and.push({ createdAt: { gte: new Date(`${query.from}T00:00:00.000Z`) } });
  if (query.to) and.push({ createdAt: { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) } });
  return and.length > 0 ? { AND: and } : {};
}

export const JoinRequestService = {
  async submit(input: SubmitInput, userId: string | null) {
    const open = await prisma.providerJoinRequest.findFirst({
      where: { phone: input.phone, status: { in: [...OPEN_STATUSES] } },
      select: { id: true },
    });
    if (open) {
      throw new JoinRequestError(
        'An application for this mobile number is already being reviewed. Check its status with your application ID.',
      );
    }

    const files = await persistFiles(prepareFiles(input.photo, input.documents));
    const data = {
      userId,
      name: input.name.trim(),
      phone: input.phone,
      email: input.email,
      address: input.address.trim(),
      city: input.city.trim(),
      state: input.state.trim(),
      dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00.000Z`),
      category: input.category,
      categoryOther: input.category === 'OTHER' ? (input.categoryOther?.trim() || null) : null,
      expertise: cleanList(input.expertise, 12),
      experienceYears: input.experienceYears,
      languages: cleanList(input.languages, 10, 40),
      qualification: input.qualification.trim(),
      about: input.about.trim(),
      services: cleanList(input.services, 15, 80),
    };

    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const created = await prisma.providerJoinRequest.create({
            data: {
              ...data,
              applicationNo: generateApplicationNo(),
              files: { create: files },
              events: { create: { actorKind: 'APPLICANT', actorUserId: userId, action: 'SUBMITTED', toStatus: JoinRequestStatus.PENDING } },
            },
            select: { id: true, applicationNo: true, status: true, createdAt: true, userId: true, phone: true, email: true, name: true },
          });
          await notifyApplicant(created, {
            title: 'Application received',
            paragraphs: [
              `Thank you for applying to join Vedsutra as a ${CATEGORY_LABELS[input.category]}. Your application ID is ${created.applicationNo}.`,
              'Our team will review your details and documents, and we will notify you of every update.',
            ],
            link: statusLink(created.applicationNo),
            cta: 'Track your application',
          });
          return {
            id: created.id,
            applicationNo: created.applicationNo,
            status: created.status,
            statusLabel: STATUS_LABELS[created.status],
            submittedAt: created.createdAt.toISOString(),
          };
        } catch (error) {
          const collision =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002' &&
            String(error.meta?.target ?? '').includes('application_no');
          if (!collision || attempt >= 4) throw error;
        }
      }
    } catch (error) {
      await Promise.all(files.map((file) => removeUpload(file.storageKey).catch(() => undefined)));
      throw error;
    }
  },

  async publicStatus(applicationNo: string, phone: string) {
    const row = await prisma.providerJoinRequest.findUnique({
      where: { applicationNo },
      select: {
        applicationNo: true,
        phone: true,
        name: true,
        category: true,
        status: true,
        adminNote: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // The same response for "no such ID" and "wrong phone", so IDs cannot be probed.
    if (!row || row.phone !== phone) throw new JoinRequestError('No application matches that ID and mobile number', 404);
    const showNote = row.status === JoinRequestStatus.MORE_INFO_REQUESTED || row.status === JoinRequestStatus.REJECTED;
    return {
      applicationNo: row.applicationNo,
      firstName: row.name.split(' ')[0] ?? row.name,
      category: row.category,
      categoryLabel: CATEGORY_LABELS[row.category],
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
      note: showNote ? row.adminNote : null,
      canRespond: row.status === JoinRequestStatus.MORE_INFO_REQUESTED,
      submittedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  async respond(input: { applicationNo: string; phone: string; message: string; documents: UploadInput[] }) {
    const row = await prisma.providerJoinRequest.findUnique({
      where: { applicationNo: input.applicationNo },
      select: { id: true, phone: true, status: true },
    });
    if (!row || row.phone !== input.phone) throw new JoinRequestError('No application matches that ID and mobile number', 404);
    if (row.status !== JoinRequestStatus.MORE_INFO_REQUESTED) {
      throw new JoinRequestError('This application is not waiting for more information');
    }
    const files = await persistFiles(prepareFiles(null, input.documents));
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.providerJoinRequest.updateMany({
          where: { id: row.id, status: JoinRequestStatus.MORE_INFO_REQUESTED },
          data: { status: JoinRequestStatus.UNDER_REVIEW },
        });
        if (updated.count === 0) throw new JoinRequestError('This application is not waiting for more information');
        if (files.length > 0) {
          await tx.joinRequestFile.createMany({ data: files.map((file) => ({ ...file, requestId: row.id })) });
        }
        await tx.joinRequestEvent.create({
          data: {
            requestId: row.id,
            actorKind: 'APPLICANT',
            action: 'APPLICANT_RESPONDED',
            fromStatus: JoinRequestStatus.MORE_INFO_REQUESTED,
            toStatus: JoinRequestStatus.UNDER_REVIEW,
            note: [input.message.trim(), files.length > 0 ? `Attached ${files.length} document(s).` : '']
              .filter(Boolean)
              .join(' ')
              .slice(0, 2000),
          },
        });
      });
    } catch (error) {
      await Promise.all(files.map((file) => removeUpload(file.storageKey).catch(() => undefined)));
      throw error;
    }
    return { status: JoinRequestStatus.UNDER_REVIEW, statusLabel: STATUS_LABELS[JoinRequestStatus.UNDER_REVIEW] };
  },

  async list(query: ListQuery) {
    const where = listWhere(query);
    const [rows, total, grouped] = await Promise.all([
      prisma.providerJoinRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          applicationNo: true,
          name: true,
          phone: true,
          email: true,
          city: true,
          state: true,
          category: true,
          categoryOther: true,
          experienceYears: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { files: true } },
        },
      }),
      prisma.providerJoinRequest.count({ where }),
      prisma.providerJoinRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(Object.keys(STATUS_LABELS).map((status) => [status, 0])) as Record<JoinRequestStatus, number>;
    for (const group of grouped) counts[group.status] = group._count._all;
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts,
      items: rows.map((row) => ({
        id: row.id,
        applicationNo: row.applicationNo,
        name: row.name,
        phone: row.phone,
        email: row.email,
        city: row.city,
        state: row.state,
        category: row.category,
        categoryLabel: row.categoryOther ? `${CATEGORY_LABELS[row.category]} (${row.categoryOther})` : CATEGORY_LABELS[row.category],
        experienceYears: row.experienceYears,
        status: row.status,
        statusLabel: STATUS_LABELS[row.status],
        fileCount: row._count.files,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  },

  async exportCsv(query: Omit<ListQuery, 'page' | 'pageSize'>): Promise<string> {
    const rows = await prisma.providerJoinRequest.findMany({ where: listWhere(query), orderBy: { createdAt: 'desc' }, take: 5000 });
    const header = [
      'Application ID', 'Submitted', 'Status', 'Name', 'Mobile', 'Email', 'Category', 'City', 'State',
      'Experience (years)', 'Languages', 'Expertise', 'Services', 'Qualification', 'Admin note',
    ];
    const lines = rows.map((row) =>
      [
        row.applicationNo, row.createdAt.toISOString(), STATUS_LABELS[row.status], row.name, row.phone, row.email,
        row.categoryOther ? `${CATEGORY_LABELS[row.category]} (${row.categoryOther})` : CATEGORY_LABELS[row.category],
        row.city, row.state, row.experienceYears, row.languages.join('; '), row.expertise.join('; '),
        row.services.join('; '), row.qualification, row.adminNote,
      ].map(csvCell).join(','),
    );
    return [header.map(csvCell).join(','), ...lines].join('\r\n');
  },

  async detail(id: string) {
    const row = await prisma.providerJoinRequest.findUnique({ where: { id }, include: detailInclude });
    if (!row) throw new JoinRequestError('Application not found', 404);
    return serializeDetail(row);
  },

  async file(id: string, fileId: string) {
    const file = await prisma.joinRequestFile.findFirst({ where: { id: fileId, requestId: id } });
    if (!file) throw new JoinRequestError('File not found', 404);
    return { file, bytes: await readUpload(file.storageKey) };
  },

  async addNote(id: string, note: string, actor: StaffActor) {
    const exists = await prisma.providerJoinRequest.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new JoinRequestError('Application not found', 404);
    await prisma.joinRequestEvent.create({
      data: { requestId: id, actorKind: 'STAFF', actorUserId: actor.userId, action: 'NOTE_ADDED', note: note.trim().slice(0, 2000) },
    });
    return this.detail(id);
  },

  async changeStatus(
    id: string,
    input: { status: JoinRequestStatus; note?: string | undefined; createAccount?: boolean | undefined },
    actor: StaffActor,
  ) {
    const row = await prisma.providerJoinRequest.findUnique({ where: { id } });
    if (!row) throw new JoinRequestError('Application not found', 404);
    if (row.status === input.status) throw new JoinRequestError(`Application is already ${STATUS_LABELS[row.status]}`);
    if (!canTransition(row.status, input.status)) {
      throw new JoinRequestError(`Cannot move an application from ${STATUS_LABELS[row.status]} to ${STATUS_LABELS[input.status]}`);
    }
    const note = input.note?.trim() || null;
    if (input.status === JoinRequestStatus.MORE_INFO_REQUESTED && !note) {
      throw new JoinRequestError('Tell the applicant what information is needed', 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.providerJoinRequest.updateMany({
        where: { id, status: row.status },
        data: {
          status: input.status,
          adminNote: note ?? row.adminNote,
          reviewedBy: actor.userId,
          reviewedAt: new Date(),
        },
      });
      if (changed.count === 0) throw new JoinRequestError('The application was changed by someone else; reload and try again');
      await tx.joinRequestEvent.create({
        data: {
          requestId: id,
          actorKind: 'STAFF',
          actorUserId: actor.userId,
          action: 'STATUS_CHANGED',
          fromStatus: row.status,
          toStatus: input.status,
          note,
        },
      });
      return tx.providerJoinRequest.findUniqueOrThrow({ where: { id } });
    });

    if (input.status === JoinRequestStatus.APPROVED && input.createAccount !== false) {
      await this.provision(id, actor, { notify: false });
    }

    const recipient = await prisma.providerJoinRequest.findUniqueOrThrow({ where: { id } });
    if (input.status === JoinRequestStatus.APPROVED) {
      await notifyApplicant(recipient, approvalMessage(recipient.applicationNo, recipient.providerAstrologerId !== null));
    } else {
      const message = STATUS_MESSAGES[input.status]?.(note);
      if (message) {
        await notifyApplicant(recipient, { ...message, link: statusLink(recipient.applicationNo), cta: 'View your application' });
      }
    }

    logger.info({ applicationNo: updated.applicationNo, from: row.status, to: input.status, by: actor.userId }, 'Join request status changed');
    return this.detail(id);
  },

  /**
   * Creates (or links) the provider account for an approved application: the applicant's user is
   * found or created by phone, and a provider profile is created OFFLINE at the platform default rate.
   */
  async provision(id: string, actor: StaffActor, options: { notify: boolean } = { notify: true }) {
    const row = await prisma.providerJoinRequest.findUnique({ where: { id }, include: { files: true } });
    if (!row) throw new JoinRequestError('Application not found', 404);
    if (row.status !== JoinRequestStatus.APPROVED) throw new JoinRequestError('Approve the application before creating the provider account');
    if (row.providerAstrologerId) throw new JoinRequestError('A provider account already exists for this application');

    const photoFile = row.files.find((file) => file.kind === JoinRequestFileKind.PHOTO);
    let photoDataUrl: string | null = null;
    if (photoFile) {
      try {
        const bytes = await readUpload(photoFile.storageKey);
        const dataUrl = `data:${photoFile.mimeType};base64,${bytes.toString('base64')}`;
        if (dataUrl.length <= PROVIDER_PHOTO_MAX_CHARS) photoDataUrl = dataUrl;
      } catch (error) {
        logger.warn({ err: error, applicationNo: row.applicationNo }, 'Applicant photo unreadable; provider created without photo');
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { phone: row.phone },
        select: { id: true, email: true, address: true, astrologer: { select: { id: true } } },
      });
      const user =
        existingUser ??
        (await tx.user.create({
          data: { phone: row.phone, name: row.name, email: row.email, address: row.address, wallet: { create: { balance: 0, currency: 'INR' } } },
          select: { id: true, email: true, address: true, astrologer: { select: { id: true } } },
        }));
      if (existingUser && (!existingUser.email || !existingUser.address)) {
        await tx.user.update({
          where: { id: existingUser.id },
          data: { ...(existingUser.email ? {} : { email: row.email }), ...(existingUser.address ? {} : { address: row.address }) },
        });
      }

      const astrologerId =
        user.astrologer?.id ??
        (
          await tx.astrologer.create({
            data: {
              userId: user.id,
              displayName: row.name,
              category: row.category,
              languages: row.languages.length > 0 ? row.languages : ['Hindi'],
              expertise: cleanList(row.expertise, 8, 40),
              experienceYears: row.experienceYears,
              perMinuteRate: money(env.ASTROLOGER_DEFAULT_RATE),
              status: AstrologerStatus.OFFLINE,
              services: cleanList(row.services, 12, 60),
              // Documents were reviewed as part of approving the application.
              kycStatus: 'VERIFIED',
              identityVerified: true,
              profileApproved: true,
              ...(photoDataUrl ? { photoDataUrl, photoUpdatedAt: new Date() } : {}),
            },
            select: { id: true },
          })
        ).id;

      await tx.providerJoinRequest.update({ where: { id }, data: { providerAstrologerId: astrologerId, userId: user.id } });
      await tx.joinRequestEvent.create({
        data: {
          requestId: id,
          actorKind: 'STAFF',
          actorUserId: actor.userId,
          action: user.astrologer ? 'PROVIDER_LINKED' : 'PROVIDER_CREATED',
          note: user.astrologer ? 'Linked to the existing provider profile for this mobile number.' : 'Provider account created (offline, default rate).',
        },
      });
      return { astrologerId, linked: Boolean(user.astrologer) };
    });

    if (options.notify) {
      const refreshed = await prisma.providerJoinRequest.findUniqueOrThrow({ where: { id } });
      await notifyApplicant(refreshed, approvalMessage(refreshed.applicationNo, true));
    }
    logger.info({ applicationNo: row.applicationNo, astrologerId: result.astrologerId, by: actor.userId }, 'Provider account provisioned');
    return this.detail(id);
  },
};

function approvalMessage(applicationNo: string, accountReady: boolean) {
  return accountReady
    ? {
        title: 'Welcome to Vedsutra — your application is approved',
        paragraphs: [
          `Congratulations! Your application ${applicationNo} has been approved and your provider account is ready.`,
          'Sign in with your registered mobile number to open your provider console. Your profile starts offline; our team will confirm your rate and you can go online when ready.',
        ],
        link: '/astrologer',
        cta: 'Open provider console',
      }
    : {
        title: 'Your Vedsutra application is approved',
        paragraphs: [
          `Congratulations! Your application ${applicationNo} has been approved. Our team will contact you to complete your provider account setup.`,
        ],
        link: statusLink(applicationNo),
        cta: 'View your application',
      };
}
