import { prisma } from '../lib/prisma.js';
import { ContentError } from './content-security.js';
import {
  ADMIN_ORDER,
  LIVE_ORDER,
  assertFullOrder,
  decodeReviewImage,
  toTestimonialData,
  type TestimonialInput,
} from './review-media.js';

export type { TestimonialInput } from './review-media.js';

/** Everything except the photo bytes, which are served from their own cacheable URL. */
const FIELDS = {
  id: true,
  name: true,
  location: true,
  rating: true,
  body: true,
  photoUpdatedAt: true,
  sortOrder: true,
  active: true,
  featured: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  name: string;
  location: string | null;
  rating: number;
  body: string;
  photoUpdatedAt: Date | null;
  sortOrder: number;
  active: boolean;
  featured: boolean;
  updatedAt: Date;
};

export interface TestimonialView {
  readonly id: string;
  readonly name: string;
  readonly location: string | null;
  readonly rating: number;
  readonly body: string;
  readonly featured: boolean;
  /** Cache-busting version for /testimonials/:id/photo; null when there is no photo. */
  readonly photoVersion: number | null;
}

export interface AdminTestimonialView extends TestimonialView {
  readonly sortOrder: number;
  readonly active: boolean;
  readonly updatedAt: string;
}

function publicView(row: Row): TestimonialView {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    rating: row.rating,
    body: row.body,
    featured: row.featured,
    photoVersion: row.photoUpdatedAt?.getTime() ?? null,
  };
}

function adminView(row: Row): AdminTestimonialView {
  return { ...publicView(row), sortOrder: row.sortOrder, active: row.active, updatedAt: row.updatedAt.toISOString() };
}

export const TestimonialService = {
  async listLive(): Promise<TestimonialView[]> {
    const rows = await prisma.testimonial.findMany({ where: { active: true }, orderBy: LIVE_ORDER, select: FIELDS });
    return rows.map(publicView);
  },

  async listAll(): Promise<AdminTestimonialView[]> {
    const rows = await prisma.testimonial.findMany({ orderBy: ADMIN_ORDER, select: FIELDS });
    return rows.map(adminView);
  },

  async create(input: TestimonialInput & { name: string; body: string }, adminUserId: string): Promise<AdminTestimonialView> {
    const data = toTestimonialData(input);
    const last = await prisma.testimonial.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.testimonial.create({
      data: { ...data, name: data.name!, body: data.body!, sortOrder: (last._max.sortOrder ?? -1) + 1, updatedBy: adminUserId },
      select: FIELDS,
    });
    return adminView(row);
  },

  async update(id: string, input: TestimonialInput, adminUserId: string): Promise<AdminTestimonialView> {
    const data = toTestimonialData(input);
    const updated = await prisma.testimonial.updateMany({ where: { id }, data: { ...data, updatedBy: adminUserId } });
    if (updated.count === 0) throw new ContentError('Testimonial not found', 404);
    return adminView(await prisma.testimonial.findUniqueOrThrow({ where: { id }, select: FIELDS }));
  },

  async remove(id: string): Promise<void> {
    const deleted = await prisma.testimonial.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new ContentError('Testimonial not found', 404);
  },

  async reorder(ids: readonly string[]): Promise<AdminTestimonialView[]> {
    const existing = await prisma.testimonial.findMany({ select: { id: true } });
    assertFullOrder(ids, existing.map((row) => row.id), 'testimonial');
    await prisma.$transaction(ids.map((id, index) => prisma.testimonial.update({ where: { id }, data: { sortOrder: index } })));
    return this.listAll();
  },

  async photo(id: string): Promise<{ contentType: string; bytes: Buffer } | null> {
    const row = await prisma.testimonial.findUnique({ where: { id }, select: { photoData: true } });
    return decodeReviewImage(row?.photoData ?? null);
  },
};
