import { ContentError, assertSafeInternalHref, assertSafeProductImage } from './content-security.js';

export type SlideStatus = 'LIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED';

export interface SlideWindow {
  readonly active: boolean;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

export function slideStatus(slide: SlideWindow, now: Date): SlideStatus {
  if (!slide.active) return 'DISABLED';
  if (slide.startsAt && slide.startsAt > now) return 'SCHEDULED';
  if (slide.endsAt && slide.endsAt <= now) return 'EXPIRED';
  return 'LIVE';
}

/** CTA target: a same-site path (/pujas) or an https link. */
export function assertSafeCtaHref(href: string | null | undefined): string | null {
  if (href === null || href === undefined || href.trim() === '') return null;
  const value = href.trim();
  if (value.startsWith('/')) return assertSafeInternalHref(value);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ContentError('Button link must be a path like /pujas or an https:// URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new ContentError('Button link must be a path like /pujas or an https:// URL');
  }
  return parsed.toString().slice(0, 500);
}

export const HERO_IMAGE_DATA_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

/** Resized in the browser to ~1400px; this still refuses a full-size photo. */
export const HERO_IMAGE_MAX_CHARS = 900_000;

export function assertSafeHeroImageData(data: string | null | undefined): string | null {
  if (data === null || data === undefined || data === '') return null;
  if (data.length > HERO_IMAGE_MAX_CHARS) {
    throw new ContentError('Banner image is too large — use a smaller image');
  }
  if (!HERO_IMAGE_DATA_PATTERN.test(data)) {
    throw new ContentError('Banner must be a JPEG, PNG or WebP image');
  }
  return data;
}

export function decodeHeroImage(data: string | null): { contentType: string; bytes: Buffer } | null {
  const match = data ? HERO_IMAGE_DATA_PATTERN.exec(data) : null;
  return match ? { contentType: `image/${match[1]}`, bytes: Buffer.from(match[2]!, 'base64') } : null;
}

export const assertSafeHeroImageUrl = assertSafeProductImage;
