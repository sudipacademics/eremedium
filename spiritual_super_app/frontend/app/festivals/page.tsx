import type { Metadata } from 'next';

import { FestivalsPage } from '@/components/festivals/FestivalsPage';

export const metadata: Metadata = {
  title: 'Hindu Festival Calendar – Tyohar & Vrat Dates | Vedsutra',
  description:
    'Month-by-month Hindu festival and vrat calendar with tithi-based dates: Ekadashi, Navaratri, Diwali, Sankranti and more.',
};

export default function Page() {
  return <FestivalsPage />;
}
