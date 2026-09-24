import { api, type FooterSettings } from '@/lib/api';

let cached: Promise<FooterSettings | null> | null = null;

/** Admin-managed footer links, fetched once per page load and shared by every footer instance. */
export function loadFooterSettings(): Promise<FooterSettings | null> {
  cached ??= api.get<FooterSettings>('content/footer').catch(() => {
    cached = null;
    return null;
  });
  return cached;
}

export function primeFooterSettings(settings: FooterSettings): void {
  cached = Promise.resolve(settings);
}
