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
  clear(): void {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(PROFILE_KEY);
  },
};

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

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const message =
      (parsed as { message?: string; error?: string } | null)?.message ??
      (parsed as { error?: string } | null)?.error ??
      `Request failed (${response.status})`;
    throw new ApiError(response.status, message, parsed);
  }

  return parsed as T;
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T,>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
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
