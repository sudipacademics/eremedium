import type { HeroSlide } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { ContentError } from './content-security.js';
import {
  assertSafeCtaHref,
  assertSafeHeroImageData,
  assertSafeHeroImageUrl,
  decodeHeroImage,
  slideStatus,
  type SlideStatus,
} from './hero-slides.js';

export interface HeroSlideView {
  readonly id: string;
  readonly eyebrow: string | null;
  readonly title: string;
  readonly description: string | null;
  /** Set when the slide uses a URL image; otherwise load the uploaded image by id + imageVersion. */
  readonly imageUrl: string | null;
  readonly imageVersion: number | null;
  readonly ctaText: string | null;
  readonly ctaHref: string | null;
}

export interface AdminHeroSlideView extends HeroSlideView {
  readonly sortOrder: number;
  readonly active: boolean;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly status: SlideStatus;
  readonly updatedAt: string;
}

export interface HeroSlideInput {
  readonly eyebrow?: string | null;
  readonly title?: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly imageData?: string | null;
  readonly ctaText?: string | null;
  readonly ctaHref?: string | null;
  readonly active?: boolean;
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
}

type SlideRow = Omit<HeroSlide, 'imageData'> & { imageData?: string | null };

const LIST_SELECT = {
  id: true,
  eyebrow: true,
  title: true,
  description: true,
  imageUrl: true,
  imageUpdatedAt: true,
  ctaText: true,
  ctaHref: true,
  sortOrder: true,
  active: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: true,
} as const;

function publicView(row: SlideRow): HeroSlideView {
  return {
    id: row.id,
    eyebrow: row.eyebrow,
    title: row.title,
    description: row.description,
    imageUrl: row.imageUpdatedAt ? null : row.imageUrl,
    imageVersion: row.imageUpdatedAt?.getTime() ?? null,
    ctaText: row.ctaText,
    ctaHref: row.ctaHref,
  };
}

function adminView(row: SlideRow, now: Date): AdminHeroSlideView {
  return {
    ...publicView(row),
    sortOrder: row.sortOrder,
    active: row.active,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    status: slideStatus(row, now),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function optionalText(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value?.trim() || null;
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ContentError('Schedule dates must be valid date-times');
  return date;
}

/** Validates and maps the fields present in `input`; absent fields are left untouched on update. */
function toData(input: HeroSlideInput) {
  const cta = optionalText(input.ctaText);
  const href = input.ctaHref === undefined ? undefined : assertSafeCtaHref(input.ctaHref);
  const imageData = input.imageData === undefined ? undefined : assertSafeHeroImageData(input.imageData);
  return {
    ...(input.eyebrow !== undefined ? { eyebrow: optionalText(input.eyebrow) ?? null } : {}),
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.description !== undefined ? { description: optionalText(input.description) ?? null } : {}),
    ...(input.imageUrl !== undefined ? { imageUrl: assertSafeHeroImageUrl(input.imageUrl) } : {}),
    ...(imageData !== undefined ? { imageData, imageUpdatedAt: imageData ? new Date() : null } : {}),
    ...(cta !== undefined ? { ctaText: cta } : {}),
    ...(href !== undefined ? { ctaHref: href } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.startsAt !== undefined ? { startsAt: toDate(input.startsAt) ?? null } : {}),
    ...(input.endsAt !== undefined ? { endsAt: toDate(input.endsAt) ?? null } : {}),
  };
}

function assertConsistent(slide: {
  title: string;
  imageUrl: string | null;
  hasImageData: boolean;
  ctaText: string | null;
  ctaHref: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}): void {
  if (slide.title.length < 2) throw new ContentError('Title is required');
  if (!slide.imageUrl && !slide.hasImageData) throw new ContentError('Add a banner image (upload or URL)');
  if (Boolean(slide.ctaText) !== Boolean(slide.ctaHref)) {
    throw new ContentError('Button text and button link go together — fill both or neither');
  }
  if (slide.startsAt && slide.endsAt && slide.endsAt <= slide.startsAt) {
    throw new ContentError('The end of the schedule must be after its start');
  }
}

export const HeroService = {
  /** Live slides only, in display order. */
  async listLive(now = new Date()): Promise<HeroSlideView[]> {
    const rows = await prisma.heroSlide.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: LIST_SELECT,
    });
    return rows.map(publicView);
  },

  async listAll(now = new Date()): Promise<AdminHeroSlideView[]> {
    const rows = await prisma.heroSlide.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: LIST_SELECT,
    });
    return rows.map((row) => adminView(row, now));
  },

  async create(input: HeroSlideInput & { title: string }, adminUserId: string): Promise<AdminHeroSlideView> {
    const data = toData(input);
    assertConsistent({
      title: data.title ?? '',
      imageUrl: data.imageUrl ?? null,
      hasImageData: Boolean(data.imageData),
      ctaText: data.ctaText ?? null,
      ctaHref: data.ctaHref ?? null,
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
    });
    const last = await prisma.heroSlide.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.heroSlide.create({
      data: { ...data, title: data.title!, sortOrder: (last._max.sortOrder ?? -1) + 1, updatedBy: adminUserId },
      select: LIST_SELECT,
    });
    return adminView(row, new Date());
  },

  async update(id: string, input: HeroSlideInput, adminUserId: string): Promise<AdminHeroSlideView> {
    const existing = await prisma.heroSlide.findUnique({ where: { id } });
    if (!existing) throw new ContentError('Slide not found', 404);
    const data = toData(input);
    assertConsistent({
      title: data.title ?? existing.title,
      imageUrl: data.imageUrl !== undefined ? data.imageUrl : existing.imageUrl,
      hasImageData: data.imageData !== undefined ? Boolean(data.imageData) : Boolean(existing.imageData),
      ctaText: data.ctaText !== undefined ? data.ctaText : existing.ctaText,
      ctaHref: data.ctaHref !== undefined ? data.ctaHref : existing.ctaHref,
      startsAt: data.startsAt !== undefined ? data.startsAt : existing.startsAt,
      endsAt: data.endsAt !== undefined ? data.endsAt : existing.endsAt,
    });
    const row = await prisma.heroSlide.update({
      where: { id },
      data: { ...data, updatedBy: adminUserId },
      select: LIST_SELECT,
    });
    return adminView(row, new Date());
  },

  async remove(id: string): Promise<void> {
    const deleted = await prisma.heroSlide.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new ContentError('Slide not found', 404);
  },

  /** `ids` is the full new order; every existing slide must appear exactly once. */
  async reorder(ids: readonly string[]): Promise<AdminHeroSlideView[]> {
    const existing = await prisma.heroSlide.findMany({ select: { id: true } });
    const known = new Set(existing.map((row) => row.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new ContentError('Reorder must list every slide exactly once', 409);
    }
    await prisma.$transaction(ids.map((id, index) => prisma.heroSlide.update({ where: { id }, data: { sortOrder: index } })));
    return this.listAll();
  },

  async image(id: string): Promise<{ contentType: string; bytes: Buffer } | null> {
    const row = await prisma.heroSlide.findUnique({ where: { id }, select: { imageData: true } });
    return decodeHeroImage(row?.imageData ?? null);
  },
};
