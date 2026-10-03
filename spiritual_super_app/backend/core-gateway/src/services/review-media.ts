import { ContentError } from './content-security.js';
import { HERO_IMAGE_DATA_PATTERN, decodeHeroImage } from './hero-slides.js';

/** Thumbnails are resized in the browser to ~1280px wide; photos to a 240px square. */
export const REVIEW_THUMBNAIL_MAX_CHARS = 700_000;
export const TESTIMONIAL_PHOTO_MAX_CHARS = 200_000;

export function assertReviewImage(data: string | null | undefined, maxChars: number, label: string): string | null {
  if (data === null || data === undefined || data === '') return null;
  if (data.length > maxChars) throw new ContentError(`${label} is too large — use a smaller image`);
  if (!HERO_IMAGE_DATA_PATTERN.test(data)) throw new ContentError(`${label} must be a JPEG, PNG or WebP image`);
  return data;
}

export const decodeReviewImage = decodeHeroImage;

export interface TestimonialInput {
  readonly name?: string;
  readonly location?: string | null;
  readonly rating?: number;
  readonly body?: string;
  readonly photoData?: string | null;
  readonly active?: boolean;
  readonly featured?: boolean;
}

/** Validates and normalises a create/patch body; only the fields present are returned. */
export function toTestimonialData(input: TestimonialInput, now = new Date()) {
  const name = input.name?.trim().replace(/\s+/g, ' ');
  if (name !== undefined && (name.length < 2 || name.length > 80)) throw new ContentError('Name must be 2–80 characters');
  const body = input.body?.trim();
  if (body !== undefined && (body.length < 10 || body.length > 600)) throw new ContentError('Review text must be 10–600 characters');
  if (input.rating !== undefined && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) {
    throw new ContentError('Rating must be 1 to 5 stars');
  }
  const location = input.location === undefined ? undefined : input.location?.trim().slice(0, 120) || null;
  const photoData =
    input.photoData === undefined ? undefined : assertReviewImage(input.photoData, TESTIMONIAL_PHOTO_MAX_CHARS, 'Photo');
  return {
    ...(name !== undefined ? { name } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(photoData !== undefined ? { photoData, photoUpdatedAt: photoData ? now : null } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.featured !== undefined ? { featured: input.featured } : {}),
  };
}

/** Same rule for videos and testimonials: featured first, then the admin's order. */
export const LIVE_ORDER = [{ featured: 'desc' as const }, { sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];
export const ADMIN_ORDER = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

/** `ids` must be the full new order: every existing id exactly once. */
export function assertFullOrder(ids: readonly string[], existing: readonly string[], noun: string): void {
  const known = new Set(existing);
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new ContentError(`Reorder must list every ${noun} exactly once`, 409);
  }
}
