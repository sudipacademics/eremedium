import type { ReviewVideo } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { ContentError } from './content-security.js';
import { parseYouTubeId, youtubeWatchUrl } from './review-videos.js';

export interface ReviewVideoView {
  readonly id: string;
  readonly youtubeId: string;
  readonly title: string;
  readonly description: string | null;
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
}

function publicView(row: ReviewVideo): ReviewVideoView {
  return { id: row.id, youtubeId: row.youtubeId, title: row.title, description: row.description };
}

function adminView(row: ReviewVideo): AdminReviewVideoView {
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
  return {
    ...(input.url !== undefined ? { youtubeId: parseYouTubeId(input.url) } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
}

const ORDER = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

export const ReviewService = {
  /** Active videos in display order. */
  async listLive(): Promise<ReviewVideoView[]> {
    const rows = await prisma.reviewVideo.findMany({ where: { active: true }, orderBy: ORDER });
    return rows.map(publicView);
  },

  async listAll(): Promise<AdminReviewVideoView[]> {
    const rows = await prisma.reviewVideo.findMany({ orderBy: ORDER });
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
    });
    return adminView(row);
  },

  async update(id: string, input: ReviewVideoInput, adminUserId: string): Promise<AdminReviewVideoView> {
    const data = toData(input);
    const updated = await prisma.reviewVideo.updateMany({ where: { id }, data: { ...data, updatedBy: adminUserId } });
    if (updated.count === 0) throw new ContentError('Review video not found', 404);
    return adminView(await prisma.reviewVideo.findUniqueOrThrow({ where: { id } }));
  },

  async remove(id: string): Promise<void> {
    const deleted = await prisma.reviewVideo.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new ContentError('Review video not found', 404);
  },

  /** `ids` is the full new order; every existing video must appear exactly once. */
  async reorder(ids: readonly string[]): Promise<AdminReviewVideoView[]> {
    const existing = await prisma.reviewVideo.findMany({ select: { id: true } });
    const known = new Set(existing.map((row) => row.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new ContentError('Reorder must list every video exactly once', 409);
    }
    await prisma.$transaction(
      ids.map((id, index) => prisma.reviewVideo.update({ where: { id }, data: { sortOrder: index } })),
    );
    return this.listAll();
  },
};
