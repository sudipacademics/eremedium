import { CallSessionStatus, PujaBookingStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../src/auth/jwt.js';
import { prisma } from '../src/lib/prisma.js';
import { balanceOf, seedAstrologer, seedCallSession, seedUser } from './helpers/factories.js';

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

function tokenFor(
  userId: string,
  role: AppRole = AppRole.USER,
  astrologerId?: string,
): string {
  return signAccessToken({
    sub: userId,
    role,
    phone: '+919000000001',
    ...(astrologerId === undefined ? {} : { astrologerId }),
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedCatalog(price = '2100.00') {
  const temple = await prisma.temple.create({
    data: {
      name: `Temple ${randomUUID().slice(0, 8)}`,
      location: 'Ujjain, Madhya Pradesh',
      primaryDeity: 'Lord Shiva',
    },
    select: { id: true },
  });
  const offering = await prisma.pujaOffering.create({
    data: { templeId: temple.id, name: 'Rudrabhishek', price },
    select: { id: true },
  });
  return { templeId: temple.id, offeringId: offering.id };
}

describe('the catalog endpoint', () => {
  it('requires a logged-in devotee', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/pujas/temples' });
    expect(response.statusCode).toBe(401);
  });

  it('returns temples with prices as fixed decimal strings', async () => {
    const { userId } = await seedUser('0.00');
    await seedCatalog('2100.00');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/pujas/temples',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { temples: { offerings: { price: string }[] }[] };
    // Never a float: 2100 and 2100.00 are the same number but not the same money.
    expect(body.temples[0]!.offerings[0]!.price).toBe('2100.00');
  });
});

describe('booking through the API', () => {
  it('books at the catalog price', async () => {
    const { userId } = await seedUser('5000.00');
    const { offeringId } = await seedCatalog('2100.00');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/bookings',
      headers: auth(tokenFor(userId)),
      payload: { pujaOfferingId: offeringId, idempotencyKey: randomUUID() },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ amountDebited: '2100.00', walletBalanceAfter: '2900.00' });
  });

  /**
   * The API must offer no way to influence the amount charged. A price in the body is ignored
   * because the schema does not accept one and the service reads the catalog instead.
   */
  it('ignores a price smuggled into the request body', async () => {
    const { userId } = await seedUser('5000.00');
    const { offeringId } = await seedCatalog('2100.00');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/bookings',
      headers: auth(tokenFor(userId)),
      payload: {
        pujaOfferingId: offeringId,
        idempotencyKey: randomUUID(),
        price: '1.00',
        packagePrice: '1.00',
        amount: '1.00',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ amountDebited: '2100.00' });
    expect(await balanceOf(userId)).toBe('2900.00');
  });

  it('answers 402 when the wallet is short, so the client can offer a top-up', async () => {
    const { userId } = await seedUser('100.00');
    const { offeringId } = await seedCatalog('2100.00');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/bookings',
      headers: auth(tokenFor(userId)),
      payload: { pujaOfferingId: offeringId, idempotencyKey: randomUUID() },
    });

    expect(response.statusCode).toBe(402);
    expect(await prisma.pujaBooking.count()).toBe(0);
  });

  it('rejects a request with no idempotency key rather than risking a double booking', async () => {
    const { userId } = await seedUser('5000.00');
    const { offeringId } = await seedCatalog();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/bookings',
      headers: auth(tokenFor(userId)),
      payload: { pujaOfferingId: offeringId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('lets a devotee read their own booking but not another\'s', async () => {
    const alice = await seedUser('5000.00');
    const bob = await seedUser('5000.00');
    const { offeringId } = await seedCatalog();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/bookings',
      headers: auth(tokenFor(alice.userId)),
      payload: { pujaOfferingId: offeringId, idempotencyKey: randomUUID() },
    });
    const bookingId = (created.json() as { booking: { id: string } }).booking.id;

    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/pujas/bookings/${bookingId}`,
      headers: auth(tokenFor(alice.userId)),
    });
    expect(own.statusCode).toBe(200);

    const theirs = await app.inject({
      method: 'GET',
      url: `/api/v1/pujas/bookings/${bookingId}`,
      headers: auth(tokenFor(bob.userId)),
    });
    expect(theirs.statusCode).toBe(403);
  });
});

describe('fulfilment is admin-only', () => {
  async function bookedPuja() {
    const { userId } = await seedUser('5000.00');
    const { offeringId } = await seedCatalog();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/bookings',
      headers: auth(tokenFor(userId)),
      payload: { pujaOfferingId: offeringId, idempotencyKey: randomUUID() },
    });
    return {
      userId,
      bookingId: (created.json() as { booking: { id: string } }).booking.id,
    };
  }

  /**
   * These endpoints decide whether a devotee is told their puja happened. A devotee marking their
   * own booking COMPLETED would make the fulfilment trail worthless.
   */
  it('refuses a devotee trying to advance their own booking', async () => {
    const { userId, bookingId } = await bookedPuja();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/pujas/admin/bookings/${bookingId}/advance`,
      headers: auth(tokenFor(userId)),
      payload: { status: PujaBookingStatus.IN_PROGRESS },
    });

    expect(response.statusCode).toBe(403);
    const row = await prisma.pujaBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.status).toBe(PujaBookingStatus.CONFIRMED);
  });

  it('refuses an astrologer too', async () => {
    const { bookingId } = await bookedPuja();
    const { astrologerId, userId } = await seedAstrologer();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/pujas/admin/bookings/${bookingId}/advance`,
      headers: auth(tokenFor(userId, AppRole.ASTROLOGER, astrologerId)),
      payload: { status: PujaBookingStatus.IN_PROGRESS },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets an admin walk the booking through fulfilment', async () => {
    const { bookingId } = await bookedPuja();
    const admin = await seedUser('0.00');
    const adminAuth = auth(tokenFor(admin.userId, AppRole.ADMIN));

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/pujas/admin/fulfilment',
      headers: adminAuth,
    });
    expect(queue.statusCode).toBe(200);
    expect((queue.json() as { bookings: unknown[] }).bookings).toHaveLength(1);

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/pujas/admin/bookings/${bookingId}/advance`,
      headers: adminAuth,
      payload: { status: PujaBookingStatus.IN_PROGRESS },
    });
    expect(started.statusCode).toBe(200);

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/pujas/admin/bookings/${bookingId}/advance`,
      headers: adminAuth,
      payload: {
        status: PujaBookingStatus.COMPLETED,
        videoProofUrl: 'https://proof.example.com/puja.mp4',
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: PujaBookingStatus.COMPLETED });
  });

  it('rejects a video proof that is not a URL', async () => {
    const { bookingId } = await bookedPuja();
    const admin = await seedUser('0.00');
    const adminAuth = auth(tokenFor(admin.userId, AppRole.ADMIN));

    await app.inject({
      method: 'POST',
      url: `/api/v1/pujas/admin/bookings/${bookingId}/advance`,
      headers: adminAuth,
      payload: { status: PujaBookingStatus.IN_PROGRESS },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/pujas/admin/bookings/${bookingId}/advance`,
      headers: adminAuth,
      payload: { status: PujaBookingStatus.COMPLETED, videoProofUrl: 'not-a-url' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('only lets an admin add a temple to the catalog', async () => {
    const { userId } = await seedUser('0.00');
    const admin = await seedUser('0.00');

    const asDevotee = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/admin/temples',
      headers: auth(tokenFor(userId)),
      payload: { name: 'Rogue Temple', location: 'Nowhere', primaryDeity: 'Nobody' },
    });
    expect(asDevotee.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/pujas/admin/temples',
      headers: auth(tokenFor(admin.userId, AppRole.ADMIN)),
      payload: { name: 'Real Temple', location: 'Ujjain', primaryDeity: 'Lord Shiva' },
    });
    expect(asAdmin.statusCode).toBe(201);
  });
});

describe('the in-call remedy card', () => {
  /**
   * Regression test for a pricing hole. The astrologer used to send `pujaName` and `packagePrice` in
   * this request, so the person selling the puja decided what the devotee was charged. The card now
   * carries the catalog price and the endpoint accepts no amount at all.
   */
  it('prices itself from the catalog, not from the astrologer', async () => {
    const { userId } = await seedUser('9000.00');
    const { astrologerId, userId: astrologerUserId } = await seedAstrologer();
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.ACTIVE,
    });
    const { offeringId } = await seedCatalog('2100.00');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remedies/dispatch',
      headers: auth(tokenFor(astrologerUserId, AppRole.ASTROLOGER, astrologerId)),
      payload: {
        callSessionId: session.id,
        pujaOfferingId: offeringId,
        // Both ignored: the schema does not accept them.
        packagePrice: '99999.00',
        pujaName: 'Whatever I feel like charging for',
      },
    });

    expect(response.statusCode).toBe(201);
    const card = response.json() as { packagePrice: string; pujaName: string; cardId: string };
    expect(card.packagePrice).toBe('2100.00');
    expect(card.pujaName).toBe('Rudrabhishek');

    // Authorising it charges the catalog price and records the offering on the booking.
    const authorized = await app.inject({
      method: 'POST',
      url: `/api/v1/remedies/${card.cardId}/authorize`,
      headers: auth(tokenFor(userId)),
    });
    expect(authorized.statusCode).toBe(201);
    expect(authorized.json()).toMatchObject({ amountDebited: '2100.00' });
    expect(await balanceOf(userId)).toBe('6900.00');

    const booking = await prisma.pujaBooking.findFirstOrThrow({});
    expect(booking.pujaOfferingId).toBe(offeringId);
    expect(booking.pujaName).toBe('Rudrabhishek');
    expect(booking.referredByAstrologerId).toBe(astrologerId);
  });

  it('cannot be dispatched by an astrologer who is not on the call', async () => {
    const { userId } = await seedUser('9000.00');
    const onCall = await seedAstrologer();
    const stranger = await seedAstrologer();
    const session = await seedCallSession({
      userId,
      astrologerId: onCall.astrologerId,
      status: CallSessionStatus.ACTIVE,
    });
    const { offeringId } = await seedCatalog();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remedies/dispatch',
      headers: auth(tokenFor(stranger.userId, AppRole.ASTROLOGER, stranger.astrologerId)),
      payload: { callSessionId: session.id, pujaOfferingId: offeringId },
    });

    expect(response.statusCode).toBe(409);
  });

  it('charges once when the authorize button is pressed twice', async () => {
    const { userId } = await seedUser('9000.00');
    const { astrologerId, userId: astrologerUserId } = await seedAstrologer();
    const session = await seedCallSession({ userId, astrologerId, status: CallSessionStatus.ACTIVE });
    const { offeringId } = await seedCatalog('2100.00');

    const dispatched = await app.inject({
      method: 'POST',
      url: '/api/v1/remedies/dispatch',
      headers: auth(tokenFor(astrologerUserId, AppRole.ASTROLOGER, astrologerId)),
      payload: { callSessionId: session.id, pujaOfferingId: offeringId },
    });
    const { cardId } = dispatched.json() as { cardId: string };

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/remedies/${cardId}/authorize`,
      headers: auth(tokenFor(userId)),
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/remedies/${cardId}/authorize`,
      headers: auth(tokenFor(userId)),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(await prisma.pujaBooking.count()).toBe(1);
    expect(await balanceOf(userId)).toBe('6900.00');
  });
});
