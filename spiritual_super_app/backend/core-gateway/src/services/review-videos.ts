import { ContentError } from './content-security.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** Path prefixes whose next segment is the video id (youtube.com/shorts/<id>, /embed/<id>, …). */
const ID_PATH_PREFIXES = ['shorts', 'embed', 'live', 'v'];

/**
 * The video id from any common YouTube link — watch?v=, youtu.be/, /shorts/, /embed/, /live/ — or a
 * bare 11-character id. Anything else is refused, so only YouTube can ever be embedded.
 */
export function parseYouTubeId(input: string): string {
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw invalid();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid();

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | undefined;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidate = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') candidate = url.searchParams.get('v') ?? undefined;
    else if (segments[0] && ID_PATH_PREFIXES.includes(segments[0])) candidate = segments[1];
  }

  if (!candidate || !VIDEO_ID.test(candidate)) throw invalid();
  return candidate;
}

function invalid(): ContentError {
  return new ContentError('Enter a YouTube video link, e.g. https://www.youtube.com/watch?v=… or https://youtu.be/…');
}

export function youtubeWatchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}
