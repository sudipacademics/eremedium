import { describe, expect, it } from 'vitest';

import {
  assertSafeImageUrl,
  assertSafeInternalHref,
  ContentError,
} from '../src/services/content-security.js';

describe('CMS URL hardening', () => {
  it('accepts relative CTA paths only', () => {
    expect(assertSafeInternalHref('/gochar')).toBe('/gochar');
    expect(assertSafeInternalHref(null)).toBeNull();
    expect(() => assertSafeInternalHref('https://evil.example')).toThrow(ContentError);
    expect(() => assertSafeInternalHref('//evil.example')).toThrow(ContentError);
    expect(() => assertSafeInternalHref('javascript:alert(1)')).toThrow(ContentError);
  });

  it('allowlists image hosts over https', () => {
    expect(
      assertSafeImageUrl(
        'https://images.unsplash.com/photo-1?auto=format&fit=crop&w=600&q=80',
      ),
    ).toContain('unsplash');
    expect(() => assertSafeImageUrl('http://images.unsplash.com/x')).toThrow(ContentError);
    expect(() => assertSafeImageUrl('https://evil.example/x.png')).toThrow(ContentError);
  });
});
