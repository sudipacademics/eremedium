/** Homepage hero slider content limits — keep in sync with marketing-web CSS clamps. */
export const HERO_SLIDE_TITLE_MAX = 90;
export const HERO_SLIDE_DESCRIPTION_MAX = 280;
export const HERO_SLIDE_IMAGE_HINT = 'Use 1200×740 px (or similar 16:10) PNG/JPG/WEBP for best fit.';

export function clampHeroSlideText(value: string, max: number) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
