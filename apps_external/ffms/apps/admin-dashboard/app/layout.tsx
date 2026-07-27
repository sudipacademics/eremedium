import './styles.css';
import './admin-sidebar-fix.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'RFMS Operations', description: 'Remedium Lab Franchise Management System' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
