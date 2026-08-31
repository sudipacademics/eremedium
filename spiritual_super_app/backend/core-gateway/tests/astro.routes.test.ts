import { CallSessionStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../src/auth/jwt.js';
import { seedAstrologer, seedCallSession, seedUser } from './helpers/factories.js';

const natalChart = vi.hoisted(() => vi.fn());
const vimshottariDasha = vi.hoisted(() => vi.fn());

vi.mock('../src/services/astro.client.js', () => ({
  AstroServiceClient: { natalChart, vimshottariDasha, prakritiScore: vi.fn() },
  AstroServiceError: class AstroServiceError extends Error {},
}));

vi.mock('../src/services/livekit.service.js', () => ({
  LiveKitTokenService: {
    countParticipants: vi.fn().mockResolvedValue(2),
    closeRoom: vi.fn().mockResolvedValue(undefined),
    publishRoomData: vi.fn().mockResolvedValue(undefined),
    removeUserFromRoom: vi.fn().mockResolvedValue(undefined),
    mintUserToken: vi.fn(),
    mintAstrologerToken: vi.fn(),
  },
}));

const { buildApp } = await import('../src/app.js');
const { signAccessToken } = await import('../src/auth/jwt.js');

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const CHART = {
  dob_utc: '1994-08-16T22:15:00Z',
  julian_day_ut: 2449581.4270833335,
  ayanamsha: 23.781997,
  ayanamsha_system: 'CHITRA_PAKSHA_LAHIRI',
  node_type: 'TRUE_NODE',
  latitude: 25.317645,
  longitude: 83.005495,
  ascendant: {
    sidereal_longitude: 95.906653,
    degrees_in_sign: 5.906653,
    zodiac_sign: 4,
    zodiac_sign_name: 'Karka',
    nakshatra: 8,
    nakshatra_name: 'Pushya',
    nakshatra_pada: 1,
  },
  planets: [
    {
      body: 'Moon',
      sidereal_longitude: 245.026887,
      sidereal_latitude: 3.223713,
      degrees_in_sign: 5.026887,
      zodiac_sign: 9,
      zodiac_sign_name: 'Dhanu',
      nakshatra: 19,
      nakshatra_name: 'Mula',
      nakshatra_pada: 2,
      house: 6,
      speed_deg_per_day: 13.92292,
      is_retrograde: false,
    },
  ],
  house_cusps: [],
};

const DASHA = {
  birth_utc: '1994-08-16T22:15:00Z',
  moon_sidereal_longitude: 245.026887,
  birth_nakshatra: 19,
  birth_nakshatra_name: 'Mula',
  birth_nakshatra_lord: 'Ketu',
  balance_of_dasha_days: 1234.5,
  depth: 2,
  periods: [],
};

beforeEach(() => {
  natalChart.mockReset().mockResolvedValue(CHART);
  vimshottariDasha.mockReset().mockResolvedValue(DASHA);
});

function tokenFor(userId: string, role: AppRole = AppRole.USER, astrologerId?: string): string {
  return signAccessToken({
    sub: userId,
    role,
    phone: '+919000000001',
    ...(astrologerId === undefined ? {} : { astrologerId }),
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const VARANASI = {
  birthDate: '1994-08-17',
  birthTime: '03:45',
  timezone: 'Asia/Kolkata',
  latitude: 25.317645,
  longitude: 83.005495,
  placeLabel: 'Varanasi, IN',
};

describe('GET /api/v1/vedic/places', () => {
  it('returns candidates with the coordinates and zone the chart will use', async () => {
    const { userId } = await seedUser('0.00');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vedic/places?q=Varanasi',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(200);
    const [first] = response.json().places;
    expect(first.name).toBe('Varanasi');
    expect(first.timezone).toBe('Asia/Kolkata');
    expect(first.latitude).toBeCloseTo(25.32, 1);
  });

  it('rejects a one-character query rather than scanning the gazetteer', async () => {
    const { userId } = await seedUser('0.00');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vedic/places?q=a',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(400);
  });

  it('needs a signed-in user', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/vedic/places?q=Varanasi' });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/v1/vedic/timezone', () => {
  it('resolves a zone from coordinates, for places the gazetteer omits', async () => {
    const { userId } = await seedUser('0.00');

    const response = await app.inject({
      method: 'GET',
      // Bhagalpur, absent from the dataset entirely.
      url: '/api/v1/vedic/timezone?latitude=25.2445&longitude=86.9718',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().timezone).toBe('Asia/Kolkata');
  });

  it('rejects coordinates off the globe', async () => {
    const { userId } = await seedUser('0.00');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vedic/timezone?latitude=91&longitude=0',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('PUT /api/v1/vedic/birth-profile', () => {
  it('saves the details and reports the offset it applied', async () => {
    const { userId } = await seedUser('0.00');

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/vedic/birth-profile',
      headers: auth(tokenFor(userId)),
      payload: VARANASI,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.complete).toBe(true);
    expect(body.utcOffset).toBe('+05:30');
    expect(body.birthInstantUtc).toBe('1994-08-16T22:15:00.000Z');
  });

  it('accepts a birth with no known time', async () => {
    const { userId } = await seedUser('0.00');
    const { birthTime: _omitted, ...withoutTime } = VARANASI;

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/vedic/birth-profile',
      headers: auth(tokenFor(userId)),
      payload: withoutTime,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().birthTimeKnown).toBe(false);
  });

  it('rejects a malformed date, a 25th hour and an invented zone', async () => {
    const { userId } = await seedUser('0.00');
    const headers = auth(tokenFor(userId));

    for (const payload of [
      { ...VARANASI, birthDate: '17-08-1994' },
      { ...VARANASI, birthTime: '25:00' },
      { ...VARANASI, latitude: 91 },
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/vedic/birth-profile',
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('starts out incomplete for a new account', async () => {
    const { userId } = await seedUser('0.00');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vedic/birth-profile',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().complete).toBe(false);
  });
});

describe('GET /api/v1/vedic/kundali', () => {
  it('asks for birth details before casting anything', async () => {
    const { userId } = await seedUser('0.00');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vedic/kundali',
      headers: auth(tokenFor(userId)),
    });

    // 428 Precondition Required: the request is fine, the account is simply not ready.
    expect(response.statusCode).toBe(428);
    expect(natalChart).not.toHaveBeenCalled();
  });

  it('returns the chart and dasha once details exist', async () => {
    const { userId } = await seedUser('0.00');
    const headers = auth(tokenFor(userId));
    await app.inject({
      method: 'PUT',
      url: '/api/v1/vedic/birth-profile',
      headers,
      payload: VARANASI,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/vedic/kundali', headers });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.chart.ascendant.zodiac_sign_name).toBe('Karka');
    expect(body.dasha.birth_nakshatra_name).toBe('Mula');
    expect(body.birthTimeAssumed).toBe(false);
  });

  it('caps the dasha depth so one request cannot ask for the whole tree', async () => {
    const { userId } = await seedUser('0.00');
    const headers = auth(tokenFor(userId));
    await app.inject({
      method: 'PUT',
      url: '/api/v1/vedic/birth-profile',
      headers,
      payload: VARANASI,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vedic/kundali?depth=5',
      headers,
    });

    expect(response.statusCode).toBe(400);
  });
});

/**
 * Birth date, time and place is exactly the data used to impersonate someone. These verify that the
 * astrologer's access is bounded by the consultation and not by their role.
 */
describe('GET /api/v1/vedic/kundali/consultation/:userId', () => {
  async function seedClientWithProfile() {
    const client = await seedUser('0.00');
    await app.inject({
      method: 'PUT',
      url: '/api/v1/vedic/birth-profile',
      headers: auth(tokenFor(client.userId)),
      payload: VARANASI,
    });
    return client;
  }

  it('lets the astrologer on the live call read it', async () => {
    const client = await seedClientWithProfile();
    const { astrologerId, userId: astrologerUserId } = await seedAstrologer();
    await seedCallSession({
      userId: client.userId,
      astrologerId,
      status: CallSessionStatus.ACTIVE,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/vedic/kundali/consultation/${client.userId}`,
      headers: auth(tokenFor(astrologerUserId, AppRole.ASTROLOGER, astrologerId)),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().chart.ascendant.zodiac_sign_name).toBe('Karka');
  });

  it('refuses an astrologer with no call to this person', async () => {
    const client = await seedClientWithProfile();
    const stranger = await seedAstrologer();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/vedic/kundali/consultation/${client.userId}`,
      headers: auth(tokenFor(stranger.userId, AppRole.ASTROLOGER, stranger.astrologerId)),
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses once the call is over', async () => {
    const client = await seedClientWithProfile();
    const { astrologerId, userId: astrologerUserId } = await seedAstrologer();
    await seedCallSession({
      userId: client.userId,
      astrologerId,
      status: CallSessionStatus.COMPLETED,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/vedic/kundali/consultation/${client.userId}`,
      headers: auth(tokenFor(astrologerUserId, AppRole.ASTROLOGER, astrologerId)),
    });

    expect(response.statusCode).toBe(403);
  });

  it('is not a route an ordinary user can call', async () => {
    const client = await seedClientWithProfile();
    const nosy = await seedUser('0.00');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/vedic/kundali/consultation/${client.userId}`,
      headers: auth(tokenFor(nosy.userId)),
    });

    expect(response.statusCode).toBe(403);
  });
});
