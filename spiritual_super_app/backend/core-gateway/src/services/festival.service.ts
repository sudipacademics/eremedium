import { DateTime } from 'luxon';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Hindu festival dates from the Kalia Panjika engine (GET /v1/festival/calendar).
 *
 * The vendor key stays on this server: it is sent as an Authorization header (never a query string,
 * which would land in access logs) and nothing vendor-specific is returned to callers except the
 * normalised festival list.
 */

const ZONE = 'Asia/Kolkata';
/** Festival days are reckoned at a place; New Delhi is the usual reference for a pan-Indian list. */
const REFERENCE_PLACE = { lat: 28.6139, lon: 77.209, tz_hours: 5.5 };
const TIMEOUT_MS = 10_000;
const CACHE_MS = 24 * 60 * 60 * 1000;
/** Bounds the months anyone can request, so an anonymous caller cannot walk the vendor's credit pool. */
export const MONTH_WINDOW = 24;
export const FESTIVAL_LOCALES = ['en', 'hi'] as const;
export type FestivalLocale = (typeof FESTIVAL_LOCALES)[number];

export interface Festival {
  /** Local civil date, YYYY-MM-DD. */
  date: string;
  name: string;
  localName?: string;
  description?: string;
  category?: string;
  tithi?: string;
  /** The rule that fixes the day (udaya tithi, madhyahna, pradosh…), when the engine states one. */
  anchor?: string;
  key?: string;
}

export interface FestivalMonth {
  month: string;
  from: string;
  to: string;
  today: string;
  locale: FestivalLocale;
  festivals: Festival[];
}

export interface UpcomingFestivals {
  today: string;
  locale: FestivalLocale;
  festivals: Festival[];
}

export class FestivalsNotConfiguredError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Festival calendar is not configured');
    this.name = 'FestivalsNotConfiguredError';
  }
}

/** The vendor's detail is logged and kept on `detail`; callers only ever see the generic message. */
export class FestivalProviderError extends Error {
  readonly statusCode = 502;

  constructor(readonly detail: string) {
    super('The festival calendar is unavailable right now. Please try again shortly.');
    this.name = 'FestivalProviderError';
  }
}

export class FestivalRangeError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'FestivalRangeError';
  }
}

// --- Normalisation ---------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
/** Only descend into keys that plausibly hold festival entries, so panchang angas are never mistaken for one. */
const CONTAINER_KEY = /festival|event|item|day|date|calendar|list|result|entr|observ|vrat|occasion|utsav|tyohar/i;
const MAX_DEPTH = 5;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (isObject(value)) return text(value.name) ?? text(value.label) ?? text(value.en) ?? text(value.key);
  return undefined;
}

function first(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Accepts "YYYY-MM-DD", an ISO timestamp (its leading local date) or `{ year, month, day }`. */
export function toIsoDate(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const match = ISO_DATE.exec(value.trim());
    if (!match) return undefined;
    const date = DateTime.fromObject({ year: +match[1]!, month: +match[2]!, day: +match[3]! });
    return date.isValid ? date.toISODate()! : undefined;
  }
  if (isObject(value)) {
    const { year, month, day } = value;
    if (typeof year === 'number' && typeof month === 'number' && typeof day === 'number') {
      const date = DateTime.fromObject({ year, month, day });
      return date.isValid ? `${year}-${pad(month)}-${pad(day)}` : undefined;
    }
    return toIsoDate(value.date ?? value.local ?? value.civil);
  }
  return undefined;
}

function dateOf(node: Json): string | undefined {
  return (
    toIsoDate(node.date) ??
    toIsoDate(node.civil_date) ??
    toIsoDate(node.local_date) ??
    toIsoDate(node.observed_on) ??
    toIsoDate(node.observance_date) ??
    toIsoDate(node.day) ??
    toIsoDate(node.start) ??
    toIsoDate(node.starts_at)
  );
}

function tithiOf(value: unknown): string | undefined {
  if (!isObject(value)) return text(value);
  const name = text(value.name);
  const paksha = text(value.paksha);
  return name && paksha && !name.toLowerCase().includes(paksha.toLowerCase()) ? `${paksha} ${name}` : name;
}

const TITHI_NAMES = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi', 'Saptami', 'Ashtami',
  'Navami', 'Dashami', 'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi',
];

/** The engine numbers tithis 1–30: 1–15 Shukla (15 = Purnima), 16–30 Krishna (30 = Amavasya). */
export function tithiFromNumber(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 30) return undefined;
  if (value === 15) return 'Purnima';
  if (value === 30) return 'Amavasya';
  return value < 15 ? `Shukla ${TITHI_NAMES[value - 1]}` : `Krishna ${TITHI_NAMES[value - 16]}`;
}

/** "Diwali (Kartika Amavasya purnimanta / Aswina Amavasya amanta)" → name "Diwali" + that note. */
function splitCalendarNote(name: string): { name: string; note?: string } {
  const match = /^(.*?)\s*\(([^()]*\b(?:purnimanta|amanta)\b[^()]*)\)\s*$/i.exec(name);
  return match?.[1] && match[2] ? { name: match[1], note: match[2] } : { name };
}

function toFestival(node: Json, date: string): Festival | undefined {
  const english = first(node.name_en, node.english_name);
  const rawName = english ?? first(node.name, node.festival, node.title, node.label);
  if (!rawName) return undefined;
  const { name, note } = splitCalendarNote(rawName);
  const localName = first(
    node.local_name,
    node.name_local,
    node.localized_name,
    node.native_name,
    english ? node.name : undefined,
    isObject(node.name) ? node.name.local : undefined,
  );
  const festival: Festival = { date, name };
  if (localName && localName !== name) festival.localName = localName;
  const details = isObject(node.details) ? node.details : { description: node.details };
  const description = [node.description, node.summary, node.significance, details.description, details.summary, node.note]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value.length > 0);
  const about = description ?? note;
  if (about) festival.description = about;
  const category = first(node.category, node.type, node.kind, node.family);
  if (category) festival.category = category;
  const tithi = tithiOf(node.tithi) ?? tithiFromNumber(node.tithi_number);
  if (tithi) festival.tithi = tithi;
  const anchor = first(node.anchor, node.anchoring_rule, node.anchor_rule, node.observance_rule, node.rule);
  if (anchor) festival.anchor = anchor;
  const key = first(node.key, node.id, node.slug, isObject(node.name) ? node.name.key : undefined);
  if (key) festival.key = key;
  return festival;
}

function collect(
  node: unknown,
  inheritedDate: string | undefined,
  depth: number,
  out: Festival[],
  replaced: Set<string>,
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const entry of node) {
      if (typeof entry === 'string' && inheritedDate) out.push({ date: inheritedDate, name: entry.trim() });
      else collect(entry, inheritedDate, depth + 1, out, replaced);
    }
    return;
  }
  if (!isObject(node)) return;

  const date = dateOf(node) ?? inheritedDate;
  const hasOwnName = first(node.name_en, node.english_name, node.name, node.festival, node.title, node.label);
  if (date && hasOwnName && depth > 0) {
    const festival = toFestival(node, date);
    if (festival) {
      out.push(festival);
      // A named Ekadashi row repeats the generic vrat row it names; keep only the named one.
      const fromVrat = text(node.from_vrat);
      if (fromVrat) replaced.add(`${date}|${fromVrat}`);
      return;
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value) || (isObject(value) && CONTAINER_KEY.test(key))) {
      collect(value, date, depth + 1, out, replaced);
    }
  }
}

/**
 * Turns the engine's `{ data: … }` payload into our own stable list.
 *
 * The vendor does not publish response schemas, so this reads the list defensively: festivals may
 * arrive as a flat array or grouped under per-day entries, names as plain strings or `{ key, name }`.
 * Anything without both a date and a name is dropped rather than guessed at.
 */
export function normaliseFestivals(payload: unknown, from?: string, to?: string): Festival[] {
  const root = isObject(payload) && 'data' in payload ? payload.data : payload;
  const found: Festival[] = [];
  const replaced = new Set<string>();
  collect(root, undefined, 0, found, replaced);

  const seen = new Set<string>();
  return found
    .filter((f) => f.name.length > 0 && (!from || f.date >= from) && (!to || f.date <= to))
    .filter((f) => !(f.key && replaced.has(`${f.date}|${f.key}`)))
    .filter((f) => {
      const id = `${f.date}|${f.name.toLowerCase()}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
}

// --- Vendor client ----------------------------------------------------------------------------------

function vendorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; detail?: string; param?: string } };
    if (parsed.error) {
      return [parsed.error.code, parsed.error.param && `param=${parsed.error.param}`, parsed.error.detail]
        .filter(Boolean)
        .join(' ')
        .slice(0, 300);
    }
  } catch {
    // not JSON; fall through to the raw text
  }
  return body.slice(0, 200);
}

export async function fetchFestivalCalendar(from: string, to: string, locale: FestivalLocale): Promise<Festival[]> {
  const apiKey = env.KALIAPANJIKA_API_KEY;
  if (!apiKey) throw new FestivalsNotConfiguredError();

  const fail = (detail: string): never => {
    logger.error({ provider: 'kaliapanjika', from, to, detail }, 'Festival calendar request failed');
    throw new FestivalProviderError(detail);
  };

  const start = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  const url = new URL('/v1/festival/calendar', env.KALIAPANJIKA_API_BASE);
  // The engine's GET form flattens nested objects one level with dotted keys: from.year=2026.
  url.search = new URLSearchParams({
    'from.year': String(start.year),
    'from.month': String(start.month),
    'from.day': String(start.day),
    'to.year': String(end.year),
    'to.month': String(end.month),
    'to.day': String(end.day),
    tz_hours: String(REFERENCE_PLACE.tz_hours),
    lat: String(REFERENCE_PLACE.lat),
    lon: String(REFERENCE_PLACE.lon),
    // The engine refuses to default any convention, so each one is named here.
    provider: 'de440',
    ayanamsha: 'lahiri_true',
    sunrise_convention: 'upper_limb',
    locale,
    ...(env.KALIAPANJIKA_REGION ? { region: env.KALIAPANJIKA_REGION } : {}),
    include: 'details',
  }).toString();

  let status = 0;
  let body = '';
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    body = await response.text().catch(() => '');
  } catch (error) {
    fail(error instanceof Error ? `request failed: ${error.name} ${error.message}` : 'request failed');
  }

  if (status < 200 || status >= 300) fail(`HTTP ${status} ${vendorDetail(body)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(`HTTP ${status} returned non-JSON`);
  }

  const festivals = normaliseFestivals(parsed, from, to);
  if (festivals.length === 0) {
    const data = isObject(parsed) ? parsed.data : undefined;
    // Keys only, never values: lets the normaliser be adjusted if the vendor's shape differs.
    logger.warn(
      { provider: 'kaliapanjika', from, to, dataKeys: isObject(data) ? Object.keys(data).slice(0, 20) : typeof data },
      'Festival calendar returned no recognisable festivals',
    );
  }
  return festivals;
}

// --- Service ----------------------------------------------------------------------------------------

const cache = new Map<string, { expires: number; value: Promise<Festival[]> }>();

function monthRange(month: string): { from: string; to: string } {
  const start = DateTime.fromISO(`${month}-01`, { zone: ZONE });
  return { from: start.toISODate()!, to: start.endOf('month').toISODate()! };
}

function cachedMonth(month: string, locale: FestivalLocale): Promise<Festival[]> {
  const key = `${month}:${locale}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const { from, to } = monthRange(month);
  const value = fetchFestivalCalendar(from, to, locale);
  cache.set(key, { expires: Date.now() + CACHE_MS, value });
  value.catch(() => cache.delete(key));
  for (const [k, entry] of cache) if (entry.expires <= Date.now()) cache.delete(k);
  return value;
}

function todayIn(now: Date): DateTime {
  return DateTime.fromJSDate(now, { zone: ZONE }).startOf('day');
}

export const FestivalService = {
  isConfigured(): boolean {
    return Boolean(env.KALIAPANJIKA_API_KEY);
  },

  /** Festivals in a calendar month (YYYY-MM), within MONTH_WINDOW months of today. */
  async forMonth(month: string, locale: FestivalLocale = 'en', now: Date = new Date()): Promise<FestivalMonth> {
    if (!env.KALIAPANJIKA_API_KEY) throw new FestivalsNotConfiguredError();
    const today = todayIn(now);
    const requested = DateTime.fromISO(`${month}-01`, { zone: ZONE });
    const offset = Math.round(requested.diff(today.startOf('month'), 'months').months);
    if (!requested.isValid || Math.abs(offset) > MONTH_WINDOW) {
      throw new FestivalRangeError(`month must be within ${MONTH_WINDOW} months of today`);
    }
    const { from, to } = monthRange(month);
    return { month, from, to, today: today.toISODate()!, locale, festivals: await cachedMonth(month, locale) };
  },

  /** The next few festivals from today, drawn from this month and the next (both cached). */
  async upcoming(limit: number, locale: FestivalLocale = 'en', now: Date = new Date()): Promise<UpcomingFestivals> {
    if (!env.KALIAPANJIKA_API_KEY) throw new FestivalsNotConfiguredError();
    const today = todayIn(now);
    const todayIso = today.toISODate()!;
    const months = [today.toFormat('yyyy-MM'), today.plus({ months: 1 }).toFormat('yyyy-MM')];
    const lists = await Promise.all(months.map((m) => cachedMonth(m, locale)));
    return {
      today: todayIso,
      locale,
      festivals: lists
        .flat()
        .filter((f) => f.date >= todayIso)
        .slice(0, limit),
    };
  },

  /** Test hook. */
  clearCache(): void {
    cache.clear();
  },
};
