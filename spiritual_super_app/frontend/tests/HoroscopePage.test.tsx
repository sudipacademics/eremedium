import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { HoroscopePage, periodLabel } from '@/components/horoscope/HoroscopePage';
import { api, type Horoscope, type HoroscopePeriod, type SignHoroscope } from '@/lib/api';

const NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

function sign(n: number, period: HoroscopePeriod): SignHoroscope {
  return {
    sign: n,
    name: NAMES[n - 1]!,
    vedicName: `Vedic${n}`,
    lord: 'Mars',
    overall: 3.5,
    areas: { love: 4, career: 3, money: 2.5, health: 3 },
    headline: `${NAMES[n - 1]} ${period} headline`,
    summary: `${NAMES[n - 1]} ${period} summary`,
    influences: [{ body: 'Jupiter', sign: 5, house: 5, favourable: true, text: 'Jupiter in your 5th house: growth.' }],
    bestDays: period === 'daily' ? [] : ['2026-09-22', '2026-09-26'],
    cautionDays: period === 'daily' ? [] : ['2026-09-24'],
    moon: period === 'daily' ? { sign: 8, house: 8, nakshatra: 'Anuradha', chandrashtama: true } : null,
    lucky: { colour: 'Red', day: 'Tuesday', number: 9 },
    remedy: 'Recite the Hanuman Chalisa on Tuesday.',
  };
}

function horoscope(period: HoroscopePeriod): Horoscope {
  const range = { daily: ['2026-09-25', '2026-09-25'], weekly: ['2026-09-21', '2026-09-27'], monthly: ['2026-09-01', '2026-09-30'] }[period];
  return {
    period,
    start: range[0]!,
    end: range[1]!,
    today: '2026-09-25',
    sky: { date: '2026-09-25', ayanamsha: 24.2, planets: [{ body: 'Sun', sign: 6, degree: 8, retrograde: false, nakshatra: 'Uttara Phalguni' }] },
    signs: NAMES.map((_, i) => sign(i + 1, period)),
    events: period === 'daily' ? [] : [{ date: '2026-09-26', text: 'Venus enters Virgo (Kanya)' }],
    retrograde: ['Saturn'],
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('HoroscopePage', () => {
  let get: MockInstance<typeof api.get>;

  beforeEach(() => {
    window.history.replaceState(null, '', '/horoscope');
    get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      const match = /period=(\w+)/.exec(path);
      if (match) return horoscope(match[1] as HoroscopePeriod);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('shows today\'s reading for Aries with the Chandrashtama warning', async () => {
    render(<HoroscopePage />);
    await flush();
    expect(get).toHaveBeenCalledWith('vedic/horoscope?period=daily');
    expect(screen.getByRole('tab', { name: 'Daily' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Aries daily headline')).toBeInTheDocument();
    expect(screen.getByText(/This is Chandrashtama/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Aries chart' })).toBeInTheDocument();
    expect(screen.getByText('Retrograde now: Saturn')).toBeInTheDocument();
  });

  it('switches sign and period, remembering both in the URL', async () => {
    render(<HoroscopePage />);
    await flush();
    const signs = screen.getByRole('group', { name: 'Zodiac signs' });
    fireEvent.click(within(signs).getByRole('button', { name: /leo/i }));
    expect(screen.getByText('Leo daily headline')).toBeInTheDocument();
    expect(window.localStorage.getItem('vedsutra.rashi')).toBe('5');

    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    await flush();
    expect(get).toHaveBeenCalledWith('vedic/horoscope?period=weekly');
    expect(screen.getByText('Leo weekly headline')).toBeInTheDocument();
    expect(screen.getByText('Best days')).toBeInTheDocument();
    expect(screen.getByText('Venus enters Virgo (Kanya)')).toBeInTheDocument();
    expect(window.location.search).toBe('?period=weekly&sign=leo');
  });

  it('opens straight to a shared link', async () => {
    window.history.replaceState(null, '', '/horoscope?period=monthly&sign=pisces');
    render(<HoroscopePage />);
    await flush();
    expect(get).toHaveBeenCalledWith('vedic/horoscope?period=monthly');
    expect(screen.getByText('Pisces monthly headline')).toBeInTheDocument();
  });
});

describe('periodLabel', () => {
  it('formats each period', () => {
    expect(periodLabel({ period: 'monthly', start: '2026-09-01', end: '2026-09-30' })).toBe('September 2026');
    expect(periodLabel({ period: 'weekly', start: '2026-09-21', end: '2026-09-27' })).toBe('21 Sept – 27 Sept 2026');
  });
});
