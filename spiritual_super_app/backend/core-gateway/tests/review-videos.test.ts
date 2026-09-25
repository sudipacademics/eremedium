import { describe, expect, it } from 'vitest';

import { parseYouTubeId, youtubeWatchUrl } from '../src/services/review-videos.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeId', () => {
  it.each([
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
  ])('reads the id from %s', (input) => {
    expect(parseYouTubeId(input)).toBe(ID);
  });

  it.each([
    'https://vimeo.com/123456789',
    `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@vedsutra',
    `javascript:alert('${ID}')`,
    'not a link',
  ])('refuses %s', (input) => {
    expect(() => parseYouTubeId(input)).toThrow();
  });

  it('builds the canonical watch link', () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});
