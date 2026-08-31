import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KundaliView } from '@/components/KundaliView';
import type { Kundali } from '@/lib/api';

function kundali(overrides: Partial<Kundali> = {}): Kundali {
  return {
    profile: {
      complete: true,
      birthDate: '1994-08-17',
      birthTime: '03:45',
      birthTimeKnown: true,
      timezone: 'Asia/Kolkata',
      latitude: 25.317645,
      longitude: 83.005495,
      placeLabel: 'Varanasi, IN',
      utcOffset: '+05:30',
      birthInstantUtc: '1994-08-16T22:15:00.000Z',
    },
    chart: {
      ayanamsha: 23.781997,
      ayanamsha_system: 'CHITRA_PAKSHA_LAHIRI',
      node_type: 'TRUE_NODE',
      ascendant: {
        sidereal_longitude: 95.906653,
        degrees_in_sign: 5.906653,
        zodiac_sign: 4,
        zodiac_sign_name: 'Karka',
        nakshatra_name: 'Pushya',
        nakshatra_pada: 1,
      },
      planets: [
        {
          body: 'Sun',
          sidereal_longitude: 120.020606,
          degrees_in_sign: 0.020606,
          zodiac_sign: 5,
          zodiac_sign_name: 'Simha',
          nakshatra: 10,
          nakshatra_name: 'Magha',
          nakshatra_pada: 1,
          house: 2,
          speed_deg_per_day: 0.961101,
          is_retrograde: false,
        },
        {
          body: 'Saturn',
          sidereal_longitude: 330.5,
          degrees_in_sign: 0.5,
          zodiac_sign: 12,
          zodiac_sign_name: 'Meena',
          nakshatra: 25,
          nakshatra_name: 'Purva Bhadrapada',
          nakshatra_pada: 4,
          house: 9,
          speed_deg_per_day: -0.05,
          is_retrograde: true,
        },
      ],
    },
    dasha: {
      birth_nakshatra_name: 'Mula',
      birth_nakshatra_lord: 'Ketu',
      balance_of_dasha_days: 1234.5,
      periods: [
        {
          level: 1,
          level_name: 'MAHADASHA',
          lord: 'Ketu',
          start_utc: '1991-04-01T00:00:00Z',
          end_utc: '1998-04-01T00:00:00Z',
          duration_days: 2556.7,
          children: [],
        },
      ],
    },
    birthTimeAssumed: false,
    engineRevision: 'lahiri-truenode-placidus-v1',
    fromCache: false,
    ...overrides,
  };
}

describe('KundaliView', () => {
  it('shows the lagna, the janma nakshatra and the graha table', () => {
    render(<KundaliView kundali={kundali()} />);

    expect(screen.getByText(/Karka/)).toBeTruthy();
    expect(screen.getByText('Mula')).toBeTruthy();
    expect(screen.getByText('lord Ketu')).toBeTruthy();
    expect(screen.getByText('Simha')).toBeTruthy();
    expect(screen.getByText('Meena')).toBeTruthy();
  });

  it('marks a retrograde planet', () => {
    render(<KundaliView kundali={kundali()} />);
    expect(screen.getAllByTitle('Retrograde').length).toBeGreaterThan(0);
  });

  it('states the ayanamsha it was cast under', () => {
    render(<KundaliView kundali={kundali()} />);
    expect(screen.getByText(/chitra paksha lahiri ayanamsha/i)).toBeTruthy();
  });

  /**
   * The important one. Without a birth time the ascendant and every house is arbitrary, and showing
   * one anyway would be a confident answer to a question the data cannot answer.
   */
  it('refuses to present a lagna or houses when the birth time is unknown', () => {
    render(
      <KundaliView
        kundali={kundali({
          birthTimeAssumed: true,
          profile: { ...kundali().profile, birthTime: null, birthTimeKnown: false },
        })}
      />,
    );

    expect(screen.getByText('Birth time unknown')).toBeTruthy();
    expect(screen.getByText(/ascendant and all house positions are not/i)).toBeTruthy();
    // The lagna is blanked rather than shown as a plausible-looking sign.
    expect(screen.queryByText(/Karka/)).toBeNull();
    expect(screen.getByText('House positions need a birth time')).toBeTruthy();
  });

  it('shows the lagna when the birth time is known', () => {
    render(<KundaliView kundali={kundali()} />);

    expect(screen.queryByText('Birth time unknown')).toBeNull();
    expect(screen.getByText(/Karka/)).toBeTruthy();
  });

  it('renders the birth details it was cast from, so a wrong entry is visible', () => {
    render(<KundaliView kundali={kundali()} />);
    expect(screen.getByText(/Varanasi, IN · 1994-08-17 03:45 \+05:30/)).toBeTruthy();
  });
});
