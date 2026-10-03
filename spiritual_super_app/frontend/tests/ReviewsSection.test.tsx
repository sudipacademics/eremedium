import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewsSection } from '@/components/home/ReviewsSection';
import { api, type ReviewVideo, type Testimonial } from '@/lib/api';
import { buildReviewSlides } from '@/lib/reviews';

const video = (id: string, title: string, extra: Partial<ReviewVideo> = {}): ReviewVideo => ({
  id,
  youtubeId: `${id}`.padEnd(11, 'x'),
  title,
  description: 'Hear from our devotees.',
  featured: false,
  thumbnailVersion: null,
  ...extra,
});

const testimonial = (id: string, name: string, rating = 5): Testimonial => ({
  id,
  name,
  location: 'Kolkata, West Bengal',
  rating,
  body: `${name} says the guidance changed everything.`,
  featured: false,
  photoVersion: null,
});

const videos = [video('v1', 'Real Stories, Real Transformations'), video('v2', 'Peace after Rudrabhishek', { thumbnailVersion: 42 })];
const testimonials = [testimonial('t1', 'Priya Sharma'), testimonial('t2', 'Rahul Mehta', 4), testimonial('t3', 'Anita Rao')];

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockApi(reviews: { videos: ReviewVideo[]; testimonials: Testimonial[] }) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    path === 'content/reviews' ? reviews : { youtubeUrl: 'https://www.youtube.com/@vedsutra' },
  );
}

function activeSlide(): HTMLElement {
  return document.querySelector('[aria-roledescription="slide"][aria-hidden="false"]') as HTMLElement;
}

describe('buildReviewSlides', () => {
  it('pairs each video with two testimonials and wraps the shorter list', () => {
    const slides = buildReviewSlides(videos, testimonials);
    expect(slides.map((s) => [s.video?.id, s.left?.id, s.right?.id])).toEqual([
      ['v1', 't1', 't2'],
      ['v2', 't3', 't1'],
    ]);
  });

  it('handles missing videos or testimonials', () => {
    expect(buildReviewSlides([], [])).toEqual([]);
    expect(buildReviewSlides([], testimonials).map((s) => [s.video, s.left?.id, s.right?.id])).toEqual([
      [null, 't1', 't2'],
      [null, 't3', 't1'],
    ]);
    expect(buildReviewSlides(videos, [testimonials[0]!]).map((s) => [s.left?.id, s.right])).toEqual([
      ['t1', null],
      ['t1', null],
    ]);
  });
});

describe('ReviewsSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows the heading, channel button and the first slide of video plus testimonials', async () => {
    mockApi({ videos, testimonials });
    render(<ReviewsSection />);
    await flush();

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Reviews');
    expect(screen.getByText('Real experiences. Real guidance. Real lives transformed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Watch all Reviews on YouTube/ })).toHaveAttribute('href', 'https://www.youtube.com/@vedsutra');

    const slide = activeSlide();
    expect(slide).toHaveTextContent('Real Stories, Real Transformations');
    expect(slide).toHaveTextContent('Priya Sharma');
    expect(slide).toHaveTextContent('Rahul Mehta');
    expect(slide.querySelector('[aria-label="Rated 4 out of 5"]')).not.toBeNull();
    expect(slide.querySelector('a[href^="https://www.youtube.com/watch?v=v1"]')).toHaveTextContent('Watch on YouTube');
  });

  it('moves with arrows and dots, and plays the video in place', async () => {
    mockApi({ videos, testimonials });
    render(<ReviewsSection />);
    await flush();

    fireEvent.click(screen.getAllByRole('button', { name: 'Next reviews' })[0]!);
    expect(activeSlide()).toHaveTextContent('Peace after Rudrabhishek');
    expect(activeSlide().querySelector('img')?.getAttribute('src')).toBe('/api/gw/content/review-videos/v2/thumbnail?v=42');

    fireEvent.click(screen.getByRole('button', { name: 'Show reviews 1 of 2' }));
    expect(activeSlide()).toHaveTextContent('Real Stories, Real Transformations');

    fireEvent.click(screen.getByRole('button', { name: 'Play video: Real Stories, Real Transformations' }));
    expect(activeSlide().querySelector('iframe')?.getAttribute('src')).toContain('/embed/v1');
  });

  it('autoplays to the next slide and pauses while hovered', async () => {
    vi.useFakeTimers();
    mockApi({ videos, testimonials });
    render(<ReviewsSection />);
    await flush();

    act(() => vi.advanceTimersByTime(6600));
    expect(activeSlide()).toHaveTextContent('Peace after Rudrabhishek');

    fireEvent.mouseEnter(activeSlide().closest('.relative.mt-8')!);
    act(() => vi.advanceTimersByTime(20_000));
    expect(activeSlide()).toHaveTextContent('Peace after Rudrabhishek');
  });

  it('changes slide on a horizontal swipe', async () => {
    mockApi({ videos, testimonials });
    render(<ReviewsSection />);
    await flush();

    const viewport = activeSlide().parentElement!.parentElement!;
    fireEvent.touchStart(viewport, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 150 }] });
    expect(activeSlide()).toHaveTextContent('Peace after Rudrabhishek');
  });

  it('keeps the section with a coming-soon note when nothing is published', async () => {
    mockApi({ videos: [], testimonials: [] });
    render(<ReviewsSection />);
    await flush();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Reviews');
    expect(screen.getByText(/coming soon/)).toBeInTheDocument();
  });
});
