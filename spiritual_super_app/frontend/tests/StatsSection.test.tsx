import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatsSection } from '@/components/home/StatsSection';
import { api, type HomeStats } from '@/lib/api';
import { formatCount, formatRating } from '@/lib/stat-format';

const stats: HomeStats = {
  happyUsers: 52_300,
  verifiedExperts: 512,
  pujasPerformed: 10_000,
  authenticProducts: 1_000,
  userRating: 4.8,
  updatedAt: '2026-10-03T12:00:00.000Z',
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function shown(): string[] {
  return [...document.querySelectorAll('p > span[aria-hidden]')].map((node) => node.textContent ?? '');
}

describe('stat formatting', () => {
  it('formats compact counts rounded down, with a plus', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7.9)).toBe('7+');
    expect(formatCount(500)).toBe('500+');
    expect(formatCount(1_000)).toBe('1K+');
    expect(formatCount(1_550)).toBe('1.5K+');
    expect(formatCount(10_000)).toBe('10K+');
    expect(formatCount(52_300)).toBe('52K+');
    expect(formatCount(1_250_000)).toBe('1.2M+');
  });

  it('formats the rating with one decimal out of 5', () => {
    expect(formatRating(0)).toBe('0.0/5');
    expect(formatRating(2.46)).toBe('2.4/5');
    expect(formatRating(4.8)).toBe('4.8/5');
  });
});

describe('StatsSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the configured values from the API when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const get = vi.spyOn(api, 'get').mockResolvedValue(stats);
    render(<StatsSection />);
    await flush();

    expect(get).toHaveBeenCalledWith('content/home-stats');
    expect(shown()).toEqual(['52K+', '512+', '10K+', '1K+', '4.8/5']);
    expect(screen.getByText('Happy Users')).toBeInTheDocument();
  });

  describe('with an observer', () => {
    let observe: (visible: boolean) => void;
    let frames: FrameRequestCallback[];

    beforeEach(() => {
      frames = [];
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: IntersectionObserverCallback) {
            observe = (visible) =>
              callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
          }
          observe() {}
          disconnect() {}
        },
      );
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', () => {});
      vi.spyOn(performance, 'now').mockReturnValue(0);
      vi.spyOn(api, 'get').mockResolvedValue(stats);
    });

    function runFrame(at: number) {
      const pending = frames.splice(0);
      act(() => pending.forEach((cb) => cb(at)));
    }

    it('counts up from zero when the section enters view, and replays after leaving', async () => {
      render(<StatsSection />);
      await flush();
      expect(shown()).toEqual(['0', '0', '0', '0', '0.0/5']);

      act(() => observe(true));
      runFrame(600);
      const midway = shown();
      expect(midway[0]).not.toBe('0');
      expect(midway[0]).not.toBe('52K+');

      runFrame(1800);
      expect(shown()).toEqual(['52K+', '512+', '10K+', '1K+', '4.8/5']);
      expect(screen.getByText('52K+', { selector: '.sr-only' })).toBeInTheDocument();

      act(() => observe(false));
      expect(shown()[0]).toBe('0');
      act(() => observe(true));
      runFrame(1800);
      expect(shown()[0]).toBe('52K+');
    });

    it('keeps the final value after leaving when replay is off', async () => {
      render(<StatsSection replay={false} />);
      await flush();
      act(() => observe(true));
      runFrame(1800);
      act(() => observe(false));
      expect(shown()[0]).toBe('52K+');
    });
  });
});
