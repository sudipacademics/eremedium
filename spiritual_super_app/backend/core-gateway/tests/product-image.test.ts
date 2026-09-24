import { describe, expect, it } from 'vitest';

import { assertSafeProductImage } from '../src/services/content-security.js';

describe('assertSafeProductImage', () => {
  it('accepts bundled site images and allowed https hosts', () => {
    expect(assertSafeProductImage('/shop/products/crystal-amethyst.webp')).toBe('/shop/products/crystal-amethyst.webp');
    expect(assertSafeProductImage('https://images.unsplash.com/photo-1?w=600')).toBe(
      'https://images.unsplash.com/photo-1?w=600',
    );
    expect(assertSafeProductImage('  ')).toBeNull();
    expect(assertSafeProductImage(null)).toBeNull();
  });

  it('refuses protocol-relative, traversal, script and foreign-host images', () => {
    for (const bad of [
      '//evil.example/x.webp',
      '/shop/../secret.webp',
      '/shop/x.svg',
      'javascript:alert(1)',
      'http://images.unsplash.com/x.jpg',
      'https://evil.example/x.jpg',
    ]) {
      expect(() => assertSafeProductImage(bad), bad).toThrow();
    }
  });
});
