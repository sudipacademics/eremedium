import type { ReviewVideo, Testimonial } from '@/lib/api';

export interface ReviewSlide {
  video: ReviewVideo | null;
  left: Testimonial | null;
  right: Testimonial | null;
}

/**
 * Groups the published reviews into carousel slides of one video flanked by two testimonials.
 * There are enough slides to show every video and every testimonial at least once; the shorter
 * list wraps around. Inputs arrive featured-first from the API, so featured items lead slide one.
 */
export function buildReviewSlides(videos: readonly ReviewVideo[], testimonials: readonly Testimonial[]): ReviewSlide[] {
  const count = Math.max(videos.length, Math.ceil(testimonials.length / 2));
  return Array.from({ length: count }, (_, i) => ({
    video: videos.length ? videos[i % videos.length]! : null,
    left: testimonials.length ? testimonials[(2 * i) % testimonials.length]! : null,
    right: testimonials.length >= 2 ? testimonials[(2 * i + 1) % testimonials.length]! : null,
  }));
}
