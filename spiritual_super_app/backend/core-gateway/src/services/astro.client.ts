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

export const AstroServiceClient = {
  natalChart: (input: NatalChartInput) => postJson<NatalChartOutput>('/api/v1/astro/natal-chart', input),
  vimshottariDasha: (input: DashaInput) => postJson<DashaOutput>('/api/v1/astro/vimshottari-dasha', input),
  prakritiScore: (input: PrakritiInput) => postJson<PrakritiOutput>('/api/v1/ayurveda/prakriti-score', input),
} as const;
