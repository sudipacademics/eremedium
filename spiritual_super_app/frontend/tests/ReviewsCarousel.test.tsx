import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewsCarousel } from '@/components/home/ReviewsCarousel';
import { api, type ReviewVideo } from '@/lib/api';

const videos: ReviewVideo[] = [
  { id: 'a', youtubeId: 'dQw4w9WgXcQ', title: 'Peace after Rudrabhishek', description: 'Priya, Pune' },
  { id: 'b', youtubeId: 'aaaaaaaaaaa', title: 'Kundali reading', description: null },
];

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ReviewsCarousel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows active videos as YouTube thumbnails and plays one on click', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ videos });
    render(<ReviewsCarousel />);
    await flush();

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Reviews');
    expect(screen.getByText('Priya, Pune')).toBeInTheDocument();
    expect(document.querySelector('img')?.getAttribute('src')).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/');
    expect(document.querySelector('iframe')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Play video: Peace after Rudrabhishek' }));
    const iframe = document.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/);

    fireEvent.click(screen.getByRole('button', { name: 'Play video: Kundali reading' }));
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(document.querySelector('iframe')?.getAttribute('src')).toContain('/embed/aaaaaaaaaaa');
  });

  it('renders nothing when no review is active', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ videos: [] });
    const { container } = render(<ReviewsCarousel />);
    await flush();
    expect(container).toBeEmptyDOMElement();
  });
});
