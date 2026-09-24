'use client';

/**
 * All calls go to /api/gw/*, which is this app's own server-side proxy to the gateway.
 * See app/api/gw/[...path]/route.ts for why the browser never addresses the gateway directly.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'ssa.token';
const PROFILE_KEY = 'ssa.profile';

export interface Profile {
  userId: string;
  role: 'USER' | 'ASTROLOGER' | 'ADMIN';
  astrologerId: string | null;
  name?: string | null;
  phone: string;
}

export interface UserProfileDetails {
  userId: string;
  name: string;
  phone: string;
  role: 'USER' | 'ASTROLOGER' | 'ADMIN';
  astrologerId: string | null;
  dob: string | null;
  birthPlace: string | null;
  gotra: string | null;
  latitude: string | null;
  longitude: string | null;
  email: string | null;
  address: string | null;
  /** Small data: URL avatar, or null. */
  photoDataUrl: string | null;
  createdAt: string;
}

export type InvoiceKind = 'TOPUP' | 'PUJA' | 'AYURVEDA' | 'CONSULTATION';

export interface Invoice {
  id: string;
  number: string;
  kind: InvoiceKind;
  title: string;
  description: string;
  amount: string;
  currency: string;
  issuedAt: string;
  paymentMethod: string;
}

export const session = {
  get token(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  get profile(): Profile | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Profile;
    } catch {
      return null;
    }
  },
  save(token: string, profile: Profile): void {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },
  updateProfile(partial: Partial<Profile>): void {
    const current = this.profile;
    const token = this.token;
    if (!current || !token) return;
    this.save(token, { ...current, ...partial });
  },
  clear(): void {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(PROFILE_KEY);
  },
};

/**
 * An expired or revoked session gets `error: UNAUTHORIZED` from the gateway. Other 401s (a wrong OTP
 * code, for instance) carry their own error names and must not sign the user out.
 */
function endSessionIfRejected(response: Response, parsed: unknown, sentToken: boolean): void {
  if (!sentToken || response.status !== 401) return;
  if ((parsed as { error?: string } | null)?.error !== 'UNAUTHORIZED') return;
  session.clear();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

function errorFrom(response: Response, parsed: unknown): ApiError {
  const message =
    (parsed as { message?: string; error?: string } | null)?.message ??
    (parsed as { error?: string } | null)?.error ??
    `Request failed (${response.status})`;
  return new ApiError(response.status, message, parsed);
}

function parseBody(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = session.token;
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`/api/gw/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const parsed = parseBody(await response.text());

  if (!response.ok) {
    endSessionIfRejected(response, parsed, token !== null);
    throw errorFrom(response, parsed);
  }

  return parsed as T;
}

/** Authenticated binary download (e.g. invoice PDFs); returns the file and the server's filename. */
async function download(path: string, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const token = session.token;
  const response = await fetch(`/api/gw/${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!response.ok) {
    const parsed = parseBody(await response.text());
    endSessionIfRejected(response, parsed, token !== null);
    throw errorFrom(response, parsed);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  return { blob: await response.blob(), filename };
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T,>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
  download,
};

// --- Typed endpoint shapes, mirroring the gateway's responses -----------------------------------

export interface OtpRequestResult {
  expiresInSeconds: number;
  resendAfterSeconds: number;
  debugCode?: string;
}

export interface VerifyResult {
  accessToken: string;
  expiresInSeconds: number;
  user: { id: string; phone: string; name: string | null; role: Profile['role']; astrologerId: string | null };
}

export interface Astrologer {
  id: string;
  displayName: string;
  perMinuteRate: string;
  status: 'IDLE' | 'BUSY' | 'IN_CALL' | 'OFFLINE';
  languages: string[];
  minimumBalanceRequired: string;
}

export interface WalletBalance {
  walletId: string;
  balance: string;
  currency: string;
}

export interface PlaceMatch {
  label: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number;
}

export interface PanchangaAnga {
  number: number;
  name: string;
  paksha: string | null;
  pada: number | null;
  start_utc: string;
  end_utc: string;
}

export interface Panchang {
  date: string;
  timezone: string;
  latitude: number;
  longitude: number;
  ayanamsha: number;
  ayanamsha_system: string;
  vaara: string;
  sunrise: { utc: string; local: string };
  sunset: { utc: string; local: string };
  next_sunrise_utc: string;
  sun_sign: string;
  moon_sign: string;
  tithi: PanchangaAnga;
  nakshatra: PanchangaAnga;
  yoga: PanchangaAnga;
  karana: PanchangaAnga;
}

export interface MatchPersonInput {
  label?: string;
  birthDate: string;
  birthTime?: string;
  timezone: string;
  latitude: number;
  longitude: number;
  placeLabel?: string;
}

export interface MatchKoota {
  name: string;
  max_points: number;
  score: number;
  detail: string;
}

export interface MatchResult {
  total_guna: number;
  max_guna: number;
  kootas: MatchKoota[];
  manglik: {
    boy: { is_manglik: boolean | null; mars_house: number | null; notes: string };
    girl: { is_manglik: boolean | null; mars_house: number | null; notes: string };
    compatible: boolean | null;
  } | null;
  boy: {
    label: string;
    moonSign: string;
    moonNakshatra: string;
    moonPada: number;
    birthTimeKnown: boolean;
    birthInstantUtc: string;
  };
  girl: {
    label: string;
    moonSign: string;
    moonNakshatra: string;
    moonPada: number;
    birthTimeKnown: boolean;
    birthInstantUtc: string;
  };
}

export interface GocharPlanet {
  body: string;
  sidereal_longitude: number;
  degrees_in_sign: number;
  zodiac_sign: number;
  zodiac_sign_name: string;
  nakshatra: number;
  nakshatra_name: string;
  nakshatra_pada: number;
  speed_deg_per_day: number;
  is_retrograde: boolean;
  house_from_natal_lagna: number | null;
  house_from_transit_lagna: number | null;
}

export interface Gochar {
  transit_utc: string;
  ayanamsha: number;
  ayanamsha_system: string;
  node_type: string;
  latitude: number;
  longitude: number;
  transit_ascendant: {
    sidereal_longitude: number;
    degrees_in_sign: number;
    zodiac_sign: number;
    zodiac_sign_name: string;
    nakshatra: number;
    nakshatra_name: string;
    nakshatra_pada: number;
  };
  planets: GocharPlanet[];
  natal_moon_sign: string | null;
  natal_moon_nakshatra: string | null;
  local: { date: string; time: string; timezone: string; offset: string };
  natalOverlayApplied: boolean;
  birthTimeAssumed: boolean;
}

export interface BirthProfile {
  complete: boolean;
  birthDate: string | null;
  birthTime: string | null;
  birthTimeKnown: boolean;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  placeLabel: string | null;
  utcOffset: string | null;
  birthInstantUtc: string | null;
}

export interface ChartPlanet {
  body: string;
  sidereal_longitude: number;
  degrees_in_sign: number;
  zodiac_sign: number;
  zodiac_sign_name: string;
  nakshatra: number;
  nakshatra_name: string;
  nakshatra_pada: number;
  house: number;
  speed_deg_per_day: number;
  is_retrograde: boolean;
}

export interface ChartAscendant {
  sidereal_longitude: number;
  degrees_in_sign: number;
  zodiac_sign: number;
  zodiac_sign_name: string;
  nakshatra_name: string;
  nakshatra_pada: number;
}

export interface DashaPeriod {
  level: number;
  level_name: string;
  lord: string;
  start_utc: string;
  end_utc: string;
  duration_days: number;
  children: DashaPeriod[];
}

export interface Kundali {
  profile: BirthProfile;
  chart: {
    ayanamsha: number;
    ayanamsha_system: string;
    node_type: string;
    ascendant: ChartAscendant;
    planets: ChartPlanet[];
  };
  dasha: {
    birth_nakshatra_name: string;
    birth_nakshatra_lord: string;
    balance_of_dasha_days: number;
    periods: DashaPeriod[];
  };
  /** True when no birth time is known, which makes the ascendant and houses meaningless. */
  birthTimeAssumed: boolean;
  engineRevision: string;
  fromCache: boolean;
}

export interface AiPredictStatus {
  configured: boolean;
  model: string;
  ready: boolean;
  provider?: string;
}

export interface AiPredictTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiPredictResult {
  answer: string;
  model: string;
  birthTimeAssumed: boolean;
  chartBrief: string;
  disclaimer: string;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
  };
}

export interface SiteContent {
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string | null;
  promoQuote: string | null;
  updatedAt: string;
}

export interface FooterSettings {
  facebookUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  xUrl: string | null;
  linkedinUrl: string | null;
  whatsappUrl: string | null;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
  updatedAt: string | null;
}

export interface CmsArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body?: string;
  coverUrl: string | null;
  ctaHref: string | null;
  published: boolean;
  featured: boolean;
  publishedAt: string | null;
  updatedAt?: string;
}

export interface PujaOffering {
  id: string;
  name: string;
  description: string | null;
  /** A decimal string, never a number: money must not pass through a float. */
  price: string;
  durationLabel: string | null;
  prasadIncluded: string | null;
}

export interface PujaTemple {
  id: string;
  name: string;
  location: string;
  primaryDeity: string;
  liveStreamUrl: string | null;
  offerings: PujaOffering[];
}

export type PujaBookingStatus = 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'PRASAD_DISPATCHED';

export interface PujaBooking {
  id: string;
  status: PujaBookingStatus;
  pujaName: string;
  packagePrice: string;
  templeId: string;
  templeName: string;
  templeLocation: string;
  liveStreamUrl: string | null;
  sankalpName: string;
  sankalpGotra: string | null;
  sankalpWish: string | null;
  referredByAstrologerId: string | null;
  scheduledFor: string | null;
  performedAt: string | null;
  videoProofUrl: string | null;
  prasadAwb: string | null;
  prasadCourier: string | null;
  prasadDispatchedAt: string | null;
  createdAt: string;
}

export interface PujaBookingResult {
  booking: PujaBooking;
  amountDebited: string;
  walletBalanceAfter: string;
}

export type AyurvedaDosha = 'VATA' | 'PITTA' | 'KAPHA' | 'TRIDOSHIC';

export type ProductCategory = 'AYURVEDA' | 'CRYSTAL';

export interface AyurvedaProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: string;
  suitedDoshas: AyurvedaDosha[];
  formFactor: string;
  category: ProductCategory;
  imageUrl: string | null;
}

export type AyurvedaOrderStatus = 'CONFIRMED' | 'PACKED' | 'DISPATCHED';

export interface AyurvedaOrder {
  id: string;
  status: AyurvedaOrderStatus;
  productId: string | null;
  productSku: string;
  productName: string;
  unitPrice: string;
  shippingName: string;
  shippingPhone: string;
  shippingAddress: string;
  packedAt: string | null;
  awb: string | null;
  courier: string | null;
  dispatchedAt: string | null;
  createdAt: string;
}

export interface AyurvedaOrderResult {
  order: AyurvedaOrder;
  amountDebited: string;
  walletBalanceAfter: string;
}

export interface WalletTransaction {
  id: string;
  amount: string;
  type: string;
  referenceType: string | null;
  balanceAfter: string;
  createdAt: string;
}

export interface RtcToken {
  accessToken: string;
  roomName: string;
  identity: string;
  serverUrl: string;
  walletBalance: string;
  minimumBalanceRequired: string;
}

export interface CallSessionView {
  id: string;
  status: string;
  channelId: string;
  astrologer: { id: string; displayName: string };
  /** Sent only to the astrologer, who needs it to open the client's kundali. */
  client?: { id: string; name: string };
  ratePerMinute: string;
  totalMinutes: number;
  totalDeducted: string;
  startTime: string | null;
  endTime: string | null;
}
