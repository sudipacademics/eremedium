import { describe, expect, it } from 'vitest';

import { cleanTags, decodePhotoDataUrl, sortForDirectory } from '../src/services/astrologer-directory.js';

describe('sortForDirectory', () => {
  it('puts available astrologers first, then busy, then offline; most experienced first within each', () => {
    const sorted = sortForDirectory([
      { displayName: 'Off', status: 'OFFLINE', experienceYears: 30 },
      { displayName: 'Busy', status: 'IN_CALL', experienceYears: 5 },
      { displayName: 'New', status: 'IDLE', experienceYears: null },
      { displayName: 'Senior', status: 'IDLE', experienceYears: 20 },
    ] as const);
    expect(sorted.map((row) => row.displayName)).toEqual(['Senior', 'New', 'Busy', 'Off']);
  });
});

describe('decodePhotoDataUrl', () => {
  it('decodes image data URLs and rejects anything else', () => {
    const photo = decodePhotoDataUrl('data:image/jpeg;base64,/9j/4A==');
    expect(photo?.contentType).toBe('image/jpeg');
    expect(photo?.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(decodePhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(decodePhotoDataUrl(null)).toBeNull();
  });
});

describe('cleanTags', () => {
  it('trims, collapses spaces and removes case-insensitive duplicates', () => {
    expect(cleanTags([' Vedic ', 'vedic', 'Life  Coach', '', 'Tarot'])).toEqual(['Vedic', 'Life Coach', 'Tarot']);
  });
});
