import { describe, expect, it } from 'vitest';

import { HOME_STATS_DEFAULTS, homeStatsBody, toHomeStatsView } from '../src/services/home-stats-rules.js';

const valid = { happyUsers: 52_300, verifiedExperts: 512, pujasPerformed: 10_400, authenticProducts: 1_050, userRating: 4.84 };

describe('homeStatsBody', () => {
  it('accepts whole counts and rounds the rating to one decimal', () => {
    expect(homeStatsBody.parse(valid)).toEqual({ ...valid, userRating: 4.8 });
  });

  it('rejects negative or fractional counts, ratings above 5 and unknown fields', () => {
    expect(homeStatsBody.safeParse({ ...valid, happyUsers: -1 }).success).toBe(false);
    expect(homeStatsBody.safeParse({ ...valid, verifiedExperts: 1.5 }).success).toBe(false);
    expect(homeStatsBody.safeParse({ ...valid, userRating: 5.1 }).success).toBe(false);
    expect(homeStatsBody.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe('toHomeStatsView', () => {
  it('falls back to the defaults when the row is missing', () => {
    expect(toHomeStatsView(null)).toEqual({ ...HOME_STATS_DEFAULTS, updatedAt: null });
  });

  it('converts the decimal rating to a number', () => {
    const updatedAt = new Date('2026-10-03T12:00:00.000Z');
    expect(toHomeStatsView({ ...valid, userRating: { toString: () => '4.9' }, updatedAt })).toEqual({
      ...valid,
      userRating: 4.9,
      updatedAt: '2026-10-03T12:00:00.000Z',
    });
  });
});
