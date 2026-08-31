import { createHash } from 'node:crypto';

import { AstrologerStatus, CallSessionStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { seedAstrologer, seedCallSession, seedUser } from './helpers/factories.js';

const countParticipants = vi.fn<(room: string) => Promise<number | null>>();

vi.mock('../src/services/livekit.service.js', () => ({
  LiveKitTokenService: {
    countParticipants: (room: string) => countParticipants(room),
    closeRoom: vi.fn().mockResolvedValue(undefined),
    publishRoomData: vi.fn().mockResolvedValue(undefined),
    removeUserFromRoom: vi.fn().mockResolvedValue(undefined),
    mintUserToken: vi.fn(),
    mintAstrologerToken: vi.fn(),
  },
}));

const { buildApp } = await import('../src/app.js');

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  countParticipants.mockReset();
});

/**
 * Signs a webhook the way LiveKit does: a JWT issued by the API key whose `sha256` claim is the
 * digest of the exact body bytes. Building it by hand keeps the route's signature verification in
 * the test path -- an unsigned request must never be able to start or stop billing.
 */
function signedWebhook(body: unknown): { payload: string; headers: Record<string, string> } {
  const payload = JSON.stringify(body);
  const hash = createHash('sha256').update(payload).digest('base64');
  const token = jwt.sign({ sha256: hash }, process.env.LIVEKIT_API_SECRET!, {
    issuer: process.env.LIVEKIT_API_KEY!,
    expiresIn: '5m',
  });
  return {
    payload,
    headers: { 'content-type': 'application/webhook+json', authorization: token },
  };
}

async function post(body: unknown) {
  const { payload, headers } = signedWebhook(body);
  return app.inject({ method: 'POST', url: '/api/v1/rtc/webhook/livekit', payload, headers });
}

const joinEvent = (room: string, numParticipants: number) => ({
  event: 'participant_joined',
  room: { name: room, numParticipants },
  participant: { identity: 'user:someone' },
});

describe('participant_joined starts the billing clock', () => {
  /**
   * THE regression test for a bug that made the platform earn nothing.
   *
   * The handler used to gate activation on the event payload's room.numParticipants. In a real
   * participant_joined event LiveKit sends 0 there, so activate() never ran: a two-party call with
   * live audio sat at INITIATED for its whole duration and the billing worker, which only ticks on
   * ACTIVE, charged nobody. The payload count below is deliberately 0 while the room really holds
   * two people.
   */
  it('activates when LiveKit reports two people, even though the payload claims zero', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.INITIATED,
    });
    countParticipants.mockResolvedValue(2);

    const response = await post(joinEvent(session.channelId, 0));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: 'activated' });

    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.ACTIVE);
    expect(row.startTime).not.toBeNull();
  });

  it('waits when only one person is in the room, so a caller alone is never charged', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.INITIATED,
    });
    countParticipants.mockResolvedValue(1);

    const response = await post(joinEvent(session.channelId, 1));

    expect(response.json()).toMatchObject({ action: 'waiting_for_peer' });
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.INITIATED);
  });

  it('falls back to the payload count when LiveKit cannot be asked', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.INITIATED,
    });
    countParticipants.mockResolvedValue(null);

    const response = await post(joinEvent(session.channelId, 2));

    expect(response.json()).toMatchObject({ action: 'activated' });
  });

  it('is safe to deliver twice: the second join does not restart the clock', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.INITIATED,
    });
    countParticipants.mockResolvedValue(2);

    await post(joinEvent(session.channelId, 0));
    const first = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });

    await post(joinEvent(session.channelId, 0));
    const second = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });

    expect(second.startTime?.toISOString()).toBe(first.startTime?.toISOString());
  });

  it('does not resurrect a call that has already ended', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.COMPLETED,
    });
    countParticipants.mockResolvedValue(2);

    const response = await post(joinEvent(session.channelId, 2));

    expect(response.json()).toMatchObject({ action: 'ignored' });
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.COMPLETED);
  });
});

describe('leaving stops the billing clock', () => {
  it('ends the call when a participant leaves, freeing the astrologer', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00', '0.50', AstrologerStatus.IN_CALL);
    const session = await seedCallSession({ userId, astrologerId });

    const response = await post({
      event: 'participant_left',
      room: { name: session.channelId, numParticipants: 1 },
      participant: { identity: 'user:someone' },
    });

    expect(response.json()).toMatchObject({ action: 'terminated' });
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.COMPLETED);
    expect(row.endTime).not.toBeNull();

    const astrologer = await prisma.astrologer.findUniqueOrThrow({ where: { id: astrologerId } });
    expect(astrologer.status).toBe(AstrologerStatus.IDLE);
  });

  it('ends the call when the room finishes', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({ userId, astrologerId });

    const response = await post({
      event: 'room_finished',
      room: { name: session.channelId, numParticipants: 0 },
    });

    expect(response.json()).toMatchObject({ action: 'terminated' });
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.COMPLETED);
  });
});

describe('webhook authenticity', () => {
  it('rejects an unsigned request, which could otherwise end any call on demand', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({ userId, astrologerId });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rtc/webhook/livekit',
      payload: JSON.stringify({ event: 'room_finished', room: { name: session.channelId } }),
      headers: { 'content-type': 'application/webhook+json' },
    });

    expect(response.statusCode).toBe(401);
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.ACTIVE);
  });

  it('rejects a body that does not match the signature it arrived with', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer();
    const session = await seedCallSession({ userId, astrologerId });

    const { headers } = signedWebhook({ event: 'room_started', room: { name: 'other-room' } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rtc/webhook/livekit',
      payload: JSON.stringify({ event: 'room_finished', room: { name: session.channelId } }),
      headers,
    });

    expect(response.statusCode).toBe(401);
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.ACTIVE);
  });

  it('acknowledges events for rooms it does not know, so LiveKit stops retrying', async () => {
    const response = await post({
      event: 'room_finished',
      room: { name: 'call_not_in_our_database', numParticipants: 0 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reason: 'unknown_room' });
  });
});
