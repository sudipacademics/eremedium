import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PanchangResult } from '@/app/panchang/page';
import type { Panchang } from '@/lib/api';

const SAMPLE: Panchang = {
  date: '1994-08-17',
  timezone: 'Asia/Kolkata',
  latitude: 25.317645,
  longitude: 83.005495,
  ayanamsha: 23.781997,
  ayanamsha_system: 'CHITRA_PAKSHA_LAHIRI',
  vaara: 'Budhavara',
  sunrise: { utc: '1994-08-17T00:15:00Z', local: '05:45:12' },
  sunset: { utc: '1994-08-17T12:45:00Z', local: '18:15:44' },
  next_sunrise_utc: '1994-08-18T00:15:00Z',
  sun_sign: 'Simha',
  moon_sign: 'Dhanu',
  tithi: {
    number: 10,
    name: 'Dashami',
    paksha: 'Shukla',
    pada: null,
    start_utc: '1994-08-17T00:15:00Z',
    end_utc: '1994-08-17T20:00:00Z',
  },
  nakshatra: {
    number: 19,
    name: 'Mula',
    paksha: null,
    pada: 2,
    start_utc: '1994-08-17T00:15:00Z',
    end_utc: '1994-08-17T14:00:00Z',
  },
  yoga: {
    number: 1,
    name: 'Vishkambha',
    paksha: null,
    pada: null,
    start_utc: '1994-08-17T00:15:00Z',
    end_utc: '1994-08-17T16:00:00Z',
  },
  karana: {
    number: 1,
    name: 'Bava',
    paksha: null,
    pada: null,
    start_utc: '1994-08-17T00:15:00Z',
    end_utc: '1994-08-17T10:00:00Z',
  },
};

describe('PanchangResult', () => {
  it('shows the vaara, sunrise/sunset and all five angas', () => {
    render(<PanchangResult panchang={SAMPLE} placeLabel="Varanasi, IN" />);

    expect(screen.getByText('Budhavara')).toBeTruthy();
    expect(screen.getByText('05:45')).toBeTruthy();
    expect(screen.getByText('18:15')).toBeTruthy();
    expect(screen.getByText('Dashami')).toBeTruthy();
    expect(screen.getByText(/Shukla paksha/)).toBeTruthy();
    expect(screen.getByText('Mula')).toBeTruthy();
    expect(screen.getByText(/pada 2/)).toBeTruthy();
    expect(screen.getByText('Vishkambha')).toBeTruthy();
    expect(screen.getByText('Bava')).toBeTruthy();
    expect(screen.getByText('Simha')).toBeTruthy();
    expect(screen.getByText('Dhanu')).toBeTruthy();
    expect(screen.getByText(/Varanasi, IN/)).toBeTruthy();
  });

  it('states the ayanamsha convention', () => {
    render(<PanchangResult panchang={SAMPLE} placeLabel="Varanasi, IN" />);
    expect(screen.getByText(/chitra paksha lahiri ayanamsha/i)).toBeTruthy();
  });
});
