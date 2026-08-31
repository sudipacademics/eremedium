import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Jyotish Consultations',
  description: 'Live Vedic astrology consultations, billed by the minute.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
