import { describe, expect, it } from 'vitest';

import { changePct, lastMonths, monthsOfThisYear, periodWindow, regionOf, topShares } from '../src/services/dashboard-rules.js';

// 3 Oct 2026, 16:30 IST.
const NOW = new Date('2026-10-03T11:00:00.000Z');

describe('dashboard periods', () => {
  it('starts each period at midnight IST and compares with an equally long window before it', () => {
    const month = periodWindow('month', NOW);
    expect(month.from?.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(month.previousFrom!.getTime()).toBe(month.from!.getTime() - (NOW.getTime() - month.from!.getTime()));
    expect(periodWindow('quarter', NOW).from?.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(periodWindow('year', NOW).from?.toISOString()).toBe('2025-12-31T18:30:00.000Z');
    expect(periodWindow('all', NOW)).toMatchObject({ from: null, previousFrom: null });
  });

  it('uses the IST calendar near midnight', () => {
    // 1 Nov 2026, 00:15 IST is still 31 Oct in UTC.
    expect(periodWindow('month', new Date('2026-10-31T18:45:00.000Z')).from?.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('lists month buckets oldest first across a year boundary', () => {
    const months = lastMonths(6, new Date('2026-02-10T06:00:00.000Z'));
    expect(months.map((month) => month.key)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect(months[0]!.label).toBe('Sep');
    expect(monthsOfThisYear(NOW).map((month) => month.label)).toHaveLength(12);
  });

  it('reports change only when there is a baseline', () => {
    expect(changePct(15, 10)).toBe(50);
    expect(changePct(5, 10)).toBe(-50);
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(5, null)).toBeNull();
  });
});

describe('locations', () => {
  it('takes the region from a free-text place', () => {
    expect(regionOf('Salt Lake, Kolkata, West Bengal, India')).toBe('West Bengal');
    expect(regionOf('Pune, Maharashtra 411001, India')).toBe('Maharashtra');
    expect(regionOf('Delhi')).toBe('Delhi');
    expect(regionOf('  ')).toBeNull();
    expect(regionOf(null)).toBeNull();
  });

  it('ranks regions with their share of the whole', () => {
    expect(topShares(['A', 'B', 'A', 'C', 'A', 'B'], 2)).toEqual([
      { label: 'A', count: 3, pct: 50 },
      { label: 'B', count: 2, pct: 33 },
    ]);
  });
});
