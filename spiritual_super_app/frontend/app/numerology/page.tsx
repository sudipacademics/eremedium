import type { Metadata } from 'next';

import { NumerologyPage } from '@/components/numerology/NumerologyPage';

export const metadata: Metadata = {
  title: 'Numerology — Free Numerology Calculator | Vedsutra',
  description:
    'Decode your Life Path, Destiny, Soul Urge and Personality numbers with the free Vedsutra numerology calculator.',
};

export default function Page() {
  return <NumerologyPage />;
}
