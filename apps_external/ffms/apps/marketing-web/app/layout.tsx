import type { Viewport } from 'next';
import { FloatingSupportButtons } from './floating-support';
import './responsive.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}<FloatingSupportButtons /></body></html>;
}
