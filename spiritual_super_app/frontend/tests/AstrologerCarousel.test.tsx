import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASTROLOGER_REFRESH_MS, AstrologerCarousel } from '@/components/home/AstrologerCarousel';
import { api, type DirectoryAstrologer } from '@/lib/api';

const shama: DirectoryAstrologer = {
  id: '22222222-2222-2222-2222-222222222222',
  displayName: 'Astro Shama',
  status: 'IDLE',
  languages: ['English', 'Hindi'],
  expertise: ['Vedic', 'Numerology', 'Tarot', 'Vastu'],
  experienceYears: 15,
  perMinuteRate: '126.00',
  photoVersion: 1727190000000,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AstrologerCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the profile, status and call/chat actions from the backend', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ astrologers: [shama] });
    render(<AstrologerCarousel />);
    await flush();

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent("Talk to India's Top Rated Astrologers");
    expect(screen.getByText('Live now · 1 online')).toBeInTheDocument();
    expect(screen.getByText('Astro Shama')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Vedic')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('English · Hindi')).toBeInTheDocument();
    expect(screen.getByText('15 yrs exp')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Astro Shama' })).toHaveAttribute(
      'src',
      `/api/gw/content/astrologers/${shama.id}/photo?v=${shama.photoVersion}`,
    );
    expect(screen.getByRole('link', { name: 'Call Astro Shama' })).toHaveAttribute(
      'href',
      `/astrologers?astrologer=${shama.id}`,
    );
    expect(screen.getByRole('link', { name: /Chat/ })).toHaveAttribute('href', '/ai');
  });

  it('picks up status and profile changes on its own', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ astrologers: [shama] })
      .mockResolvedValue({ astrologers: [{ ...shama, status: 'OFFLINE', experienceYears: 16 }] });
    render(<AstrologerCarousel />);
    await flush();
    expect(screen.getByText('Online')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(ASTROLOGER_REFRESH_MS);
    });
    await flush();

    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('16 yrs exp')).toBeInTheDocument();
    expect(screen.getByText('Verified Vedic experts')).toBeInTheDocument();
  });
});
