import { describe, expect, it } from 'vitest';

import { assertFullOrder, assertReviewImage, toTestimonialData } from '../src/services/review-media.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('toTestimonialData', () => {
  const now = new Date('2026-10-03T12:00:00.000Z');

  it('normalises a full testimonial', () => {
    expect(
      toTestimonialData(
        {
          name: '  Priya   Sharma ',
          location: ' Kolkata, West Bengal ',
          rating: 5,
          body: '  The guidance changed my perspective completely.  ',
          photoData: PNG,
          active: true,
          featured: true,
        },
        now,
      ),
    ).toEqual({
      name: 'Priya Sharma',
      location: 'Kolkata, West Bengal',
      rating: 5,
      body: 'The guidance changed my perspective completely.',
      photoData: PNG,
      photoUpdatedAt: now,
      active: true,
      featured: true,
    });
  });

  it('returns only the fields present, and clears photo and location when nulled', () => {
    expect(toTestimonialData({ featured: false }, now)).toEqual({ featured: false });
    expect(toTestimonialData({ photoData: null, location: '  ' }, now)).toEqual({
      photoData: null,
      photoUpdatedAt: null,
      location: null,
    });
  });

  it('rejects short names and reviews, out-of-range ratings and non-image photos', () => {
    expect(() => toTestimonialData({ name: 'A' })).toThrow(/Name/);
    expect(() => toTestimonialData({ body: 'Too short' })).toThrow(/Review text/);
    expect(() => toTestimonialData({ rating: 0 })).toThrow(/Rating/);
    expect(() => toTestimonialData({ rating: 4.5 })).toThrow(/Rating/);
    expect(() => toTestimonialData({ photoData: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow(/JPEG, PNG or WebP/);
  });
});

describe('assertReviewImage', () => {
  it('accepts small images, treats empty as none and refuses oversize ones', () => {
    expect(assertReviewImage(PNG, 1000, 'Thumbnail')).toBe(PNG);
    expect(assertReviewImage('', 1000, 'Thumbnail')).toBeNull();
    expect(() => assertReviewImage(PNG, 10, 'Thumbnail')).toThrow(/too large/);
  });
});

describe('assertFullOrder', () => {
  it('requires every id exactly once', () => {
    expect(() => assertFullOrder(['b', 'a'], ['a', 'b'], 'video')).not.toThrow();
    expect(() => assertFullOrder(['a'], ['a', 'b'], 'video')).toThrow(/every video/);
    expect(() => assertFullOrder(['a', 'a'], ['a', 'b'], 'video')).toThrow();
    expect(() => assertFullOrder(['a', 'c'], ['a', 'b'], 'video')).toThrow();
  });
});
