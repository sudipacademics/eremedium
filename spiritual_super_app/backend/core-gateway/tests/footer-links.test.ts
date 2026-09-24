import { describe, expect, it } from 'vitest';

import { ContentError } from '../src/services/content-security.js';
import { normaliseFooterInput } from '../src/services/footer-links.js';

describe('footer link validation', () => {
  it('accepts official profile and store links, including subdomains', () => {
    expect(
      normaliseFooterInput({
        facebookUrl: 'https://www.facebook.com/vedsutra',
        instagramUrl: 'https://instagram.com/vedsutra',
        youtubeUrl: 'https://www.youtube.com/@vedsutra',
        appStoreUrl: 'https://apps.apple.com/in/app/vedsutra/id123456789',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=in.vedsutra.app',
      }),
    ).toEqual({
      facebookUrl: 'https://www.facebook.com/vedsutra',
      instagramUrl: 'https://instagram.com/vedsutra',
      youtubeUrl: 'https://www.youtube.com/@vedsutra',
      appStoreUrl: 'https://apps.apple.com/in/app/vedsutra/id123456789',
      playStoreUrl: 'https://play.google.com/store/apps/details?id=in.vedsutra.app',
    });
  });

  it('clears a link when sent empty and leaves omitted fields untouched', () => {
    expect(normaliseFooterInput({ facebookUrl: '', xUrl: null })).toEqual({ facebookUrl: null, xUrl: null });
  });

  it('refuses links to the wrong site, lookalike hosts, http and credentials', () => {
    expect(() => normaliseFooterInput({ playStoreUrl: 'https://evil.example/app' })).toThrow(ContentError);
    expect(() => normaliseFooterInput({ facebookUrl: 'https://facebook.com.evil.example/x' })).toThrow(ContentError);
    expect(() => normaliseFooterInput({ instagramUrl: 'https://notinstagram.com/x' })).toThrow(ContentError);
    expect(() => normaliseFooterInput({ youtubeUrl: 'http://youtube.com/@v' })).toThrow(ContentError);
    expect(() => normaliseFooterInput({ appStoreUrl: 'https://user:pw@apps.apple.com/x' })).toThrow(ContentError);
    expect(() => normaliseFooterInput({ facebookUrl: 'javascript:alert(1)' })).toThrow(ContentError);
  });
});
