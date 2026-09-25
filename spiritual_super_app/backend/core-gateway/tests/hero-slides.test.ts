import { describe, expect, it } from 'vitest';

import {
  HERO_IMAGE_MAX_CHARS,
  assertSafeCtaHref,
  assertSafeHeroImageData,
  decodeHeroImage,
  slideStatus,
} from '../src/services/hero-slides.js';

const now = new Date('2026-09-25T12:00:00Z');
const before = new Date('2026-09-24T00:00:00Z');
const after = new Date('2026-09-26T00:00:00Z');

describe('slideStatus', () => {
  it('is live only when active and inside its schedule', () => {
    expect(slideStatus({ active: true, startsAt: null, endsAt: null }, now)).toBe('LIVE');
    expect(slideStatus({ active: true, startsAt: before, endsAt: after }, now)).toBe('LIVE');
    expect(slideStatus({ active: true, startsAt: after, endsAt: null }, now)).toBe('SCHEDULED');
    expect(slideStatus({ active: true, startsAt: null, endsAt: before }, now)).toBe('EXPIRED');
    expect(slideStatus({ active: true, startsAt: null, endsAt: now }, now)).toBe('EXPIRED');
    expect(slideStatus({ active: false, startsAt: before, endsAt: after }, now)).toBe('DISABLED');
  });
});

describe('assertSafeCtaHref', () => {
  it('accepts site paths and https links', () => {
    expect(assertSafeCtaHref('/pujas')).toBe('/pujas');
    expect(assertSafeCtaHref('https://example.com/offer')).toBe('https://example.com/offer');
    expect(assertSafeCtaHref('')).toBeNull();
  });

  it('refuses scripts, protocol-relative and plain http links', () => {
    for (const bad of ['javascript:alert(1)', '//evil.example', 'http://example.com', 'https://u:p@example.com']) {
      expect(() => assertSafeCtaHref(bad), bad).toThrow();
    }
  });
});

describe('hero image data', () => {
  it('accepts small image data URLs and decodes them', () => {
    const data = 'data:image/webp;base64,UklGRg==';
    expect(assertSafeHeroImageData(data)).toBe(data);
    expect(decodeHeroImage(data)?.contentType).toBe('image/webp');
  });

  it('refuses other types and oversized uploads', () => {
    expect(() => assertSafeHeroImageData('data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
    expect(() => assertSafeHeroImageData(`data:image/jpeg;base64,${'A'.repeat(HERO_IMAGE_MAX_CHARS)}`)).toThrow();
    expect(decodeHeroImage(null)).toBeNull();
  });
});
