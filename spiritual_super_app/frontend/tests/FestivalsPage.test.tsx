import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { FestivalsPage } from '@/components/festivals/FestivalsPage';
import { UpcomingFestivalsCard } from '@/components/festivals/UpcomingFestivalsCard';
import { monthsBetween, relativeDay, shiftMonth } from '@/components/festivals/festival-dates';
import { ApiError, api, type FestivalMonth, type UpcomingFestivals } from '@/lib/api';

function month(m: string): FestivalMonth {
  const festivals: FestivalMonth['festivals'] =
    m === '2026-09'
      ? [
          { date: '2026-09-17', name: 'Vishwakarma Puja', category: 'regional' },
          { date: '2026-09-26', name: 'Durga Ashtami', localName: 'दुर्गा अष्टमी', tithi: 'Shukla Ashtami', category: 'major' },
          { date: '2026-09-26', name: 'Saraswati Puja' },
          { date: '2026-09-28', name: 'Dussehra', description: 'Victory of good over evil.', anchor: 'aparahna' },
        ]
      : m === '2026-10'
        ? [{ date: '2026-10-18', name: 'Diwali' }]
        : [];
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const last = new Date(y, mm, 0).getDate();
  return { month: m, from: `${m}-01`, to: `${m}-${last}`, today: '2026-09-26', locale: 'en', festivals };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('FestivalsPage', () => {
  let get: MockInstance<typeof api.get>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T10:00:00'));
    window.history.replaceState(null, '', '/festivals');
    get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      const match = /^festivals\?month=(\d{4}-\d{2})$/.exec(path);
      if (match) return month(match[1]!);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lists this month grouped by day, highlighting today and the next festival', async () => {
    render(<FestivalsPage />);
    await flush();
    expect(get).toHaveBeenCalledWith('festivals?month=2026-09');
    expect(screen.getByRole('heading', { level: 2, name: 'September 2026' })).toBeInTheDocument();

    const today = screen.getByRole('region', { name: /Saturday, 26 September/ });
    expect(within(today).getByText('Today')).toBeInTheDocument();
    expect(within(today).getByText('Durga Ashtami')).toBeInTheDocument();
    expect(within(today).getByText('Saraswati Puja')).toBeInTheDocument();
    expect(within(today).getByText('Tithi: Shukla Ashtami')).toBeInTheDocument();
    expect(screen.getByText('Victory of good over evil.')).toBeInTheDocument();
    expect(screen.getByText('In 2 days')).toBeInTheDocument();
    expect(screen.getByText('9 days ago')).toBeInTheDocument();
    expect(screen.getByText(/Next:/)).toHaveTextContent('Next: Durga Ashtami · Today');
    expect(screen.queryByRole('button', { name: 'This month' })).not.toBeInTheDocument();
  });

  it('moves between months and keeps the month in the URL', async () => {
    render(<FestivalsPage />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await flush();
    expect(get).toHaveBeenCalledWith('festivals?month=2026-10');
    expect(screen.getByText('Diwali')).toBeInTheDocument();
    expect(window.location.search).toBe('?month=2026-10');

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await flush();
    expect(screen.getByText('No festivals are listed for November 2026.')).toBeInTheDocument();

    const calls = get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    await flush();
    expect(screen.getByRole('region', { name: /Saturday, 26 September/ })).toBeInTheDocument();
    expect(get.mock.calls.length).toBe(calls);
  });

  it('opens a shared month link and ignores an out-of-range one', async () => {
    window.history.replaceState(null, '', '/festivals?month=2026-10');
    const { unmount } = render(<FestivalsPage />);
    await flush();
    expect(get).toHaveBeenLastCalledWith('festivals?month=2026-10');
    unmount();

    window.history.replaceState(null, '', '/festivals?month=2035-01');
    render(<FestivalsPage />);
    await flush();
    expect(get).toHaveBeenLastCalledWith('festivals?month=2026-09');
  });

  it('shows a friendly notice when the calendar is not configured', async () => {
    get.mockRejectedValue(new ApiError(503, 'Festival calendar is not configured'));
    render(<FestivalsPage />);
    await flush();
    expect(screen.getByText('Festival calendar coming soon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Panchang' })).toHaveAttribute('href', '/panchang');
  });

  it('offers a retry after a vendor failure', async () => {
    const working = get.getMockImplementation()!;
    get.mockRejectedValue(new ApiError(502, 'The festival calendar is unavailable right now. Please try again shortly.'));
    render(<FestivalsPage />);
    await flush();
    expect(screen.getByText(/unavailable right now/)).toBeInTheDocument();
    get.mockImplementation(working);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(screen.getByRole('region', { name: /Saturday, 26 September/ })).toBeInTheDocument();
  });
});

describe('UpcomingFestivalsCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the next festivals with links into the calendar', async () => {
    const upcoming: UpcomingFestivals = {
      today: '2026-09-26',
      locale: 'en',
      festivals: [
        { date: '2026-09-27', name: 'Navami' },
        { date: '2026-10-18', name: 'Diwali' },
      ],
    };
    const get = vi.spyOn(api, 'get').mockResolvedValue(upcoming);
    render(<UpcomingFestivalsCard />);
    await flush();
    expect(get).toHaveBeenCalledWith('festivals/upcoming?limit=4');
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Diwali/ })).toHaveAttribute('href', '/festivals?month=2026-10');
  });

  it('stays hidden when the calendar is unavailable', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'Festival calendar is not configured'));
    const { container } = render(<UpcomingFestivalsCard />);
    await flush();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('festival dates', () => {
  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-09', '2028-09')).toBe(24);
    expect(relativeDay('2026-09-26', '2026-09-25')).toBe('Yesterday');
  });
});
