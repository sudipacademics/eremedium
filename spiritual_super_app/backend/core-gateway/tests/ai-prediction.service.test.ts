import { describe, expect, it } from 'vitest';

import { compactChartBrief } from '../src/services/chart-brief.js';
import type { KundaliView } from '../src/services/kundali.service.js';

function sampleKundali(overrides?: Partial<KundaliView>): KundaliView {
  return {
    profile: {
      complete: true,
      birthDate: '1990-05-15',
      birthTime: '14:30',
      birthTimeKnown: true,
      timezone: 'Asia/Kolkata',
      latitude: 25.317645,
      longitude: 83.005495,
      placeLabel: 'Varanasi, IN',
      utcOffset: '+05:30',
      birthInstantUtc: '1990-05-15T09:00:00.000Z',
    },
    chart: {
      dob_utc: '1990-05-15T09:00:00.000Z',
      julian_day_ut: 2_448_026.875,
      ayanamsha: 23.7,
      ayanamsha_system: 'Lahiri',
      node_type: 'true',
      latitude: 25.317645,
      longitude: 83.005495,
      ascendant: {
        sidereal_longitude: 120.5,
        degrees_in_sign: 0.5,
        zodiac_sign: 4,
        zodiac_sign_name: 'Leo',
        nakshatra: 12,
        nakshatra_name: 'Magha',
        nakshatra_pada: 1,
      },
      planets: [
        {
          body: 'Moon',
          sidereal_longitude: 45.2,
          sidereal_latitude: 0,
          degrees_in_sign: 15.2,
          zodiac_sign: 1,
          zodiac_sign_name: 'Taurus',
          nakshatra: 3,
          nakshatra_name: 'Rohini',
          nakshatra_pada: 2,
          house: 10,
          speed_deg_per_day: 13.1,
          is_retrograde: false,
        },
        {
          body: 'Sun',
          sidereal_longitude: 30.1,
          sidereal_latitude: 0,
          degrees_in_sign: 0.1,
          zodiac_sign: 1,
          zodiac_sign_name: 'Taurus',
          nakshatra: 2,
          nakshatra_name: 'Krittika',
          nakshatra_pada: 3,
          house: 10,
          speed_deg_per_day: 0.98,
          is_retrograde: false,
        },
      ],
      house_cusps: [],
    },
    dasha: {
      birth_utc: '1990-05-15T09:00:00.000Z',
      moon_sidereal_longitude: 45.2,
      birth_nakshatra: 3,
      birth_nakshatra_name: 'Rohini',
      birth_nakshatra_lord: 'Moon',
      balance_of_dasha_days: 1000,
      depth: 2,
      periods: [
        {
          level: 1,
          level_name: 'mahadasha',
          lord: 'Venus',
          start_utc: '2015-01-01T00:00:00.000Z',
          end_utc: '2035-01-01T00:00:00.000Z',
          duration_days: 7300,
          children: [
            {
              level: 2,
              level_name: 'antardasha',
              lord: 'Sun',
              start_utc: '2020-01-01T00:00:00.000Z',
              end_utc: '2030-01-01T00:00:00.000Z',
              duration_days: 3650,
              children: [],
            },
          ],
        },
      ],
    },
    birthTimeAssumed: false,
    engineRevision: 'lahiri-truenode-placidus-v1',
    fromCache: true,
    ...overrides,
  };
}

describe('compactChartBrief', () => {
  it('includes lagna, planets, and current dasha', () => {
    const brief = compactChartBrief(sampleKundali());
    expect(brief).toContain('LAGNA: Leo');
    expect(brief).toContain('Moon: Taurus');
    expect(brief).toContain('CURRENT DASHA: Venus mahadasha / Sun antardasha');
    expect(brief).toContain('MOON NAKSHATRA AT BIRTH: Rohini');
  });

  it('warns when birth time is assumed', () => {
    const brief = compactChartBrief(sampleKundali({ birthTimeAssumed: true }));
    expect(brief).toContain('Birth time unknown');
  });

  it('appends gochar lines when provided', () => {
    const brief = compactChartBrief(sampleKundali(), ['Saturn: Aquarius natal-h7']);
    expect(brief).toContain('TODAY GOCHAR');
    expect(brief).toContain('Saturn: Aquarius natal-h7');
  });
});
