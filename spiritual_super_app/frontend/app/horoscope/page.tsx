import type { Metadata } from 'next';

import { HoroscopePage } from '@/components/horoscope/HoroscopePage';

export const metadata: Metadata = {
  title: 'Daily, Weekly & Monthly Horoscope (Rashifal) | Vedsutra',
  description:
    'Free Vedic horoscope for all 12 Moon signs, today, this week and this month, calculated from real planetary transits.',
};

export default function Page() {
  return <HoroscopePage />;
}
