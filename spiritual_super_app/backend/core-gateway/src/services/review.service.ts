import { prisma } from '../lib/prisma.js';
import { ContentError } from './content-security.js';
import {
  ADMIN_ORDER,
  LIVE_ORDER,
  REVIEW_THUMBNAIL_MAX_CHARS,
  assertFullOrder,
  assertReviewImage,
  decodeReviewImage,
} from './review-media.js';
import { parseYouTubeId, youtubeWatchUrl } from './review-videos.js';

/** Everything except the thumbnail bytes, which are served from their own cacheable URL. */
const FIELDS = {
  id: true,
  youtubeId: true,
  title: true,
  description: true,
  sortOrder: true,
  active: true,
  featured: true,
  thumbnailUpdatedAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  youtubeId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  featured: boolean;
  thumbnailUpdatedAt: Date | null;
  updatedAt: Date;
};

export interface ReviewVideoView {
  readonly id: string;
  readonly youtubeId: string;
  readonly title: string;
  readonly description: string | null;
  readonly featured: boolean;
  /** Cache-busting version for /review-videos/:id/thumbnail; null means use YouTube's thumbnail. */
  readonly thumbnailVersion: number | null;
}

export interface AdminReviewVideoView extends ReviewVideoView {
  readonly url: string;
  readonly sortOrder: number;
  readonly active: boolean;
  readonly updatedAt: string;
}

export interface ReviewVideoInput {
  /** Any YouTube link (or bare id); stored as the parsed video id. */
  readonly url?: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly active?: boolean;
  readonly featured?: boolean;
  readonly thumbnailData?: string | null;
}

function publicView(row: Row): ReviewVideoView {
  return {
    id: row.id,
    youtubeId: row.youtubeId,
    title: row.title,
    description: row.description,
    featured: row.featured,
    thumbnailVersion: row.thumbnailUpdatedAt?.getTime() ?? null,
  };
}

function adminView(row: Row): AdminReviewVideoView {
  return {
    ...publicView(row),
    url: youtubeWatchUrl(row.youtubeId),
    sortOrder: row.sortOrder,
    active: row.active,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toData(input: ReviewVideoInput) {
  const title = input.title?.trim();
  if (title !== undefined && title.length < 2) throw new ContentError('Title is required');
  const thumbnailData =
    input.thumbnailData === undefined
      ? undefined
      : assertReviewImage(input.thumbnailData, REVIEW_THUMBNAIL_MAX_CHARS, 'Thumbnail');
  return {
    ...(input.url !== undefined ? { youtubeId: parseYouTubeId(input.url) } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.featured !== undefined ? { featured: input.featured } : {}),
    ...(thumbnailData !== undefined ? { thumbnailData, thumbnailUpdatedAt: thumbnailData ? new Date() : null } : {}),
  };
}

export const ReviewService = {
  /** Published videos: featured first, then display order. */
  async listLive(): Promise<ReviewVideoView[]> {
    const rows = await prisma.reviewVideo.findMany({ where: { active: true }, orderBy: LIVE_ORDER, select: FIELDS });
    return rows.map(publicView);
  },

  async listAll(): Promise<AdminReviewVideoView[]> {
    const rows = await prisma.reviewVideo.findMany({ orderBy: ADMIN_ORDER, select: FIELDS });
    return rows.map(adminView);
  },

  async create(input: ReviewVideoInput & { url: string; title: string }, adminUserId: string): Promise<AdminReviewVideoView> {
    const data = toData(input);
    const last = await prisma.reviewVideo.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.reviewVideo.create({
      data: {
        ...data,
        youtubeId: data.youtubeId!,
        title: data.title!,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        updatedBy: adminUserId,
      },
      select: FIELDS,
    });
    return adminView(row);
  },

  async update(id: string, input: ReviewVideoInput, adminUserId: string): Promise<AdminReviewVideoView> {
    const data = toData(input);
    const updated = await prisma.reviewVideo.updateMany({ where: { id }, data: { ...data, updatedBy: adminUserId } });
    if (updated.count === 0) throw new ContentError('Review video not found', 404);
    return adminView(await prisma.reviewVideo.findUniqueOrThrow({ where: { id }, select: FIELDS }));
  },

  async remove(id: string): Promise<void> {
    const deleted = await prisma.reviewVideo.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new ContentError('Review video not found', 404);
  },

  /** `ids` is the full new order; every existing video must appear exactly once. */
  async reorder(ids: readonly string[]): Promise<AdminReviewVideoView[]> {
    const existing = await prisma.reviewVideo.findMany({ select: { id: true } });
    assertFullOrder(ids, existing.map((row) => row.id), 'video');
    await prisma.$transaction(
      ids.map((id, index) => prisma.reviewVideo.update({ where: { id }, data: { sortOrder: index } })),
    );
    return this.listAll();
  },

  async thumbnail(id: string): Promise<{ contentType: string; bytes: Buffer } | null> {
    const row = await prisma.reviewVideo.findUnique({ where: { id }, select: { thumbnailData: true } });
    return decodeReviewImage(row?.thumbnailData ?? null);
  },
};
