const UNITS = [
  { size: 1_000_000_000, suffix: 'B' },
  { size: 1_000_000, suffix: 'M' },
  { size: 1_000, suffix: 'K' },
] as const;

/**
 * Compact "at least" count: 50000 → "50K+", 1500 → "1.5K+", 512 → "512+".
 * Rounds down so the label never claims more than the configured figure.
 */
export function formatCount(value: number): string {
  const whole = Math.floor(Math.max(0, value));
  if (whole === 0) return '0';
  const unit = UNITS.find((u) => whole >= u.size);
  if (!unit) return `${whole}+`;
  const scaled = whole / unit.size;
  const shown = scaled < 10 ? floorTenths(scaled) : Math.floor(scaled);
  return `${shown}${unit.suffix}+`;
}

export function formatRating(value: number): string {
  return `${floorTenths(Math.max(0, value)).toFixed(1)}/5`;
}

/** The epsilon absorbs float error such as 4.8 * 10 = 47.999… on some inputs. */
function floorTenths(value: number): number {
  return Math.floor(value * 10 + 1e-9) / 10;
}

export function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
}
