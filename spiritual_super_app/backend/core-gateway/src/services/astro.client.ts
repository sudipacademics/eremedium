import { request } from 'undici';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export class AstroServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AstroServiceError';
    this.statusCode = statusCode;
  }
}

async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const url = new URL(path, env.ASTRO_SERVICE_URL).toString();
  const response = await request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': env.INTERNAL_SERVICE_TOKEN,
    },
    body: JSON.stringify(body),
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
  });

  const text = await response.body.text();
  if (response.statusCode >= 400) {
    logger.warn({ path, status: response.statusCode, text }, 'Astro service returned an error');
    throw new AstroServiceError(`Astro service ${path} failed: ${text}`, response.statusCode);
  }
  return JSON.parse(text) as TResponse;
}

export interface NatalChartInput {
  readonly dob_utc: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface NatalChartPlanet {
  readonly body: string;
  readonly sidereal_longitude: number;
  readonly sidereal_latitude: number;
  readonly degrees_in_sign: number;
  readonly zodiac_sign: number;
  readonly zodiac_sign_name: string;
  readonly nakshatra: number;
  readonly nakshatra_name: string;
  readonly nakshatra_pada: number;
  readonly house: number;
  readonly speed_deg_per_day: number;
  readonly is_retrograde: boolean;
}

export interface NatalChartAscendant {
  readonly sidereal_longitude: number;
  readonly degrees_in_sign: number;
  readonly zodiac_sign: number;
  readonly zodiac_sign_name: string;
  readonly nakshatra: number;
  readonly nakshatra_name: string;
  readonly nakshatra_pada: number;
}

export interface NatalChartHouseCusp {
  readonly house: number;
  readonly sidereal_longitude: number;
  readonly zodiac_sign: number;
  readonly zodiac_sign_name: string;
}

/** Mirrors NatalChartResponse in the compute service's schemas.py. */
export interface NatalChartOutput {
  readonly dob_utc: string;
  readonly julian_day_ut: number;
  readonly ayanamsha: number;
  readonly ayanamsha_system: string;
  readonly node_type: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly ascendant: NatalChartAscendant;
  readonly planets: readonly NatalChartPlanet[];
  readonly house_cusps: readonly NatalChartHouseCusp[];
}

export interface DashaInput {
  readonly moon_sidereal_longitude: number;
  readonly birth_utc: string;
  readonly depth?: number;
  readonly horizon_years?: number;
}

export interface DashaPeriod {
  readonly level: number;
  readonly level_name: string;
  readonly lord: string;
  readonly start_utc: string;
  readonly end_utc: string;
  readonly duration_days: number;
  readonly children: readonly DashaPeriod[];
}

export interface DashaOutput {
  readonly birth_utc: string;
  readonly moon_sidereal_longitude: number;
  readonly birth_nakshatra: number;
  readonly birth_nakshatra_name: string;
  readonly birth_nakshatra_lord: string;
  readonly balance_of_dasha_days: number;
  readonly depth: number;
  readonly periods: readonly DashaPeriod[];
}

export interface PrakritiInput {
  readonly responses: Readonly<Record<string, 'VATA' | 'PITTA' | 'KAPHA'>>;
}

export interface PrakritiOutput {
  readonly distribution: {
    readonly vata_percent: number;
    readonly pitta_percent: number;
    readonly kapha_percent: number;
  };
  readonly prakriti_primary: 'VATA' | 'PITTA' | 'KAPHA' | 'TRIDOSHIC';
  readonly prakriti_secondary: 'VATA' | 'PITTA' | 'KAPHA' | null;
  readonly dominant_guna: string;
  readonly digestive_fire: string;
}

export interface PanchangInput {
  readonly date: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
}

export interface PanchangaAnga {
  readonly number: number;
  readonly name: string;
  readonly paksha: string | null;
  readonly pada: number | null;
  readonly start_utc: string;
  readonly end_utc: string;
}

export interface PanchangOutput {
  readonly date: string;
  readonly timezone: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly ayanamsha: number;
  readonly ayanamsha_system: string;
  readonly vaara: string;
  readonly sunrise: { readonly utc: string; readonly local: string };
  readonly sunset: { readonly utc: string; readonly local: string };
  readonly next_sunrise_utc: string;
  readonly sun_sign: string;
  readonly moon_sign: string;
  readonly tithi: PanchangaAnga;
  readonly nakshatra: PanchangaAnga;
  readonly yoga: PanchangaAnga;
  readonly karana: PanchangaAnga;
}

export interface AshtakootInput {
  readonly boy_nakshatra: number;
  readonly girl_nakshatra: number;
  readonly boy_moon_sign: number;
  readonly girl_moon_sign: number;
  readonly include_manglik?: boolean;
  readonly boy_mars_house?: number | null;
  readonly girl_mars_house?: number | null;
  readonly boy_birth_time_known?: boolean;
  readonly girl_birth_time_known?: boolean;
}

export interface KootaScore {
  readonly name: string;
  readonly max_points: number;
  readonly score: number;
  readonly detail: string;
}

export interface ManglikPerson {
  readonly is_manglik: boolean | null;
  readonly mars_house: number | null;
  readonly notes: string;
}

export interface AshtakootOutput {
  readonly total_guna: number;
  readonly max_guna: number;
  readonly kootas: readonly KootaScore[];
  readonly manglik: {
    readonly boy: ManglikPerson;
    readonly girl: ManglikPerson;
    readonly compatible: boolean | null;
  } | null;
  readonly boy_nakshatra: number;
  readonly girl_nakshatra: number;
  readonly boy_moon_sign: number;
  readonly girl_moon_sign: number;
}

export interface GocharInput {
  readonly transit_utc: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly natal_ascendant_longitude?: number | null;
  readonly natal_moon_longitude?: number | null;
}

export interface GocharPlanet {
  readonly body: string;
  readonly sidereal_longitude: number;
  readonly degrees_in_sign: number;
  readonly zodiac_sign: number;
  readonly zodiac_sign_name: string;
  readonly nakshatra: number;
  readonly nakshatra_name: string;
  readonly nakshatra_pada: number;
  readonly speed_deg_per_day: number;
  readonly is_retrograde: boolean;
  readonly house_from_natal_lagna: number | null;
  readonly house_from_transit_lagna: number | null;
}

export interface GocharOutput {
  readonly transit_utc: string;
  readonly julian_day_ut: number;
  readonly ayanamsha: number;
  readonly ayanamsha_system: string;
  readonly node_type: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly transit_ascendant: NatalChartAscendant;
  readonly planets: readonly GocharPlanet[];
  readonly natal_moon_sign: string | null;
  readonly natal_moon_nakshatra: string | null;
}

export const AstroServiceClient = {
  natalChart: (input: NatalChartInput) => postJson<NatalChartOutput>('/api/v1/astro/natal-chart', input),
  vimshottariDasha: (input: DashaInput) => postJson<DashaOutput>('/api/v1/astro/vimshottari-dasha', input),
  prakritiScore: (input: PrakritiInput) => postJson<PrakritiOutput>('/api/v1/ayurveda/prakriti-score', input),
  panchang: (input: PanchangInput) => postJson<PanchangOutput>('/api/v1/astro/panchang', input),
  ashtakoot: (input: AshtakootInput) => postJson<AshtakootOutput>('/api/v1/astro/ashtakoot', input),
  gochar: (input: GocharInput) => postJson<GocharOutput>('/api/v1/astro/gochar', input),
} as const;
