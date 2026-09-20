export class ContentError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ContentError';
    this.statusCode = statusCode;
  }
}

const ALLOWED_IMAGE_HOSTS = new Set(['images.unsplash.com', 'images.pexels.com']);

/** Same-origin relative path only — blocks open redirects and javascript: URLs. */
export function assertSafeInternalHref(href: string | null | undefined): string | null {
  if (href === null || href === undefined || href.trim() === '') return null;
  const value = href.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    throw new ContentError('CTA links must be relative paths starting with a single /');
  }
  if (/[\s<>"']/.test(value) || value.toLowerCase().includes('javascript:')) {
    throw new ContentError('CTA link contains unsafe characters');
  }
  return value.slice(0, 200);
}

export function assertSafeImageUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url.trim() === '') return null;
  const value = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ContentError('Image URL is not valid');
  }
  if (parsed.protocol !== 'https:') {
    throw new ContentError('Image URL must use https');
  }
  if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    throw new ContentError(`Image host not allowed: ${parsed.hostname}`);
  }
  return value.slice(0, 500);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
