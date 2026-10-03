export const DASHBOARD_PERIODS = ['month', 'quarter', 'year', 'all'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time',
};

const IST_OFFSET_MS = 330 * 60_000;

/** Calendar parts of an instant as seen in India. */
function istParts(at: Date): { year: number; month: number } {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

/** Midnight IST on the 1st of the given month (month may overflow either way). */
export function istMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS);
}

export interface PeriodWindow {
  from: Date | null;
  to: Date;
  /** The equally long window just before `from`, for the change percentage; null for all time. */
  previousFrom: Date | null;
}

export function periodWindow(period: DashboardPeriod, now = new Date()): PeriodWindow {
  if (period === 'all') return { from: null, to: now, previousFrom: null };
  const { year, month } = istParts(now);
  const from =
    period === 'month' ? istMonthStart(year, month) : period === 'quarter' ? istMonthStart(year, month - (month % 3)) : istMonthStart(year, 0);
  return { from, to: now, previousFrom: new Date(from.getTime() - (now.getTime() - from.getTime())) };
}

/** Percentage change, rounded to a whole number; null when there is nothing to compare against. */
export function changePct(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface MonthBucket {
  key: string;
  label: string;
  start: Date;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The last `count` IST calendar months ending with the current one, oldest first. */
export function lastMonths(count: number, now = new Date()): MonthBucket[] {
  const { year, month } = istParts(now);
  return Array.from({ length: count }, (_, index) => {
    const offset = month - (count - 1 - index);
    const start = istMonthStart(year, offset);
    const parts = istParts(start);
    return { key: `${parts.year}-${String(parts.month + 1).padStart(2, '0')}`, label: MONTH_LABELS[parts.month]!, start };
  });
}

/** January to December of the current IST year. */
export function monthsOfThisYear(now = new Date()): MonthBucket[] {
  const { year } = istParts(now);
  return Array.from({ length: 12 }, (_, month) => ({
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    label: MONTH_LABELS[month]!,
    start: istMonthStart(year, month),
  }));
}

/**
 * The region of a free-text place such as "Salt Lake, Kolkata, West Bengal, India": the last part
 * once the country is dropped. Returns null for blanks.
 */
export function regionOf(place: string | null | undefined): string | null {
  if (!place) return null;
  const parts = place
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1 && /^(india|bharat)$/i.test(parts[parts.length - 1]!)) parts.pop();
  const region = parts[parts.length - 1];
  if (!region || /^\d+$/.test(region)) return null;
  return region.replace(/\s+\d{6}$/, '').replace(/\s+/g, ' ');
}

/** Counts per label, largest first, with each share of the whole as a whole-number percentage. */
export function topShares(labels: readonly string[], limit: number): { label: string; count: number; pct: number }[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const total = labels.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, pct: total ? Math.round((count / total) * 100) : 0 }));
}
