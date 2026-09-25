import { describe, expect, it } from 'vitest';

import { loginHref, safeNextPath } from '@/lib/api';
import { isProtectedPath } from '@/lib/auth-gate';

describe('login return path', () => {
  it('round-trips the intended page and action', () => {
    const href = loginHref('/pujas?book=abc');
    expect(href).toBe('/login?next=%2Fpujas%3Fbook%3Dabc');
    const next = new URL(href, 'https://vedsutra.test').searchParams.get('next');
    expect(safeNextPath(next)).toBe('/pujas?book=abc');
  });

  it('only returns to same-site paths', () => {
    for (const bad of [null, '', 'https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/login?next=/x']) {
      expect(safeNextPath(bad), String(bad)).toBe('/');
    }
    expect(loginHref('/')).toBe('/login');
  });
});

describe('account areas', () => {
  it('protects account pages but not the public astrologer directory', () => {
    expect(isProtectedPath('/wallet')).toBe(true);
    expect(isProtectedPath('/astrologer')).toBe(true);
    expect(isProtectedPath('/call/123')).toBe(true);
    expect(isProtectedPath('/astrologers')).toBe(false);
    expect(isProtectedPath('/kundali')).toBe(false);
    expect(isProtectedPath('/')).toBe(false);
  });
});
