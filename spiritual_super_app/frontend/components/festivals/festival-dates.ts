/** Month and day helpers for the festival calendar. Months are `YYYY-MM`, days `YYYY-MM-DD`. */

/** How far either side of today the gateway serves; mirrors MONTH_WINDOW in festival.service.ts. */
export const MONTH_WINDOW = 24;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string | null | undefined): value is string {
  return !!value && MONTH.test(value);
}

export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return ty * 12 + tm - (fy * 12 + fm);
}

function parseDay(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function formatDay(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-IN', options).format(parseDay(iso));
}

export function monthLabel(month: string): string {
  return formatDay(`${month}-01`, { month: 'long', year: 'numeric' });
}

export function daysUntil(today: string, date: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(date) - toUtc(today)) / 86_400_000);
}

export function relativeDay(today: string, date: string): string {
  const days = daysUntil(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  if (days === -1) return 'Yesterday';
  return `${-days} days ago`;
}
