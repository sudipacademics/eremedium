import { PujaBookingStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { PujaError, PujaService } from '../src/services/puja.service.js';
import { InsufficientFundsError } from '../src/services/wallet.service.js';
import { balanceOf, seedUser } from './helpers/factories.js';

async function seedTemple(options: { active?: boolean; name?: string } = {}) {
  return prisma.temple.create({
    data: {
      name: options.name ?? `Temple ${randomUUID().slice(0, 8)}`,
      location: 'Ujjain, Madhya Pradesh',
      primaryDeity: 'Lord Shiva',
      liveStreamUrl: 'https://stream.example.com/live.m3u8',
      active: options.active ?? true,
    },
    select: { id: true, name: true },
  });
}

async function seedOffering(
  templeId: string,
  price = '2100.00',
  options: { active?: boolean; name?: string } = {},
) {
  return prisma.pujaOffering.create({
    data: {
      templeId,
      name: options.name ?? `Rudrabhishek ${randomUUID().slice(0, 8)}`,
      description: 'Abhishek of the Jyotirlinga',
      price,
      durationLabel: '45 minutes',
      prasadIncluded: 'Bhasma and prasad',
      active: options.active ?? true,
    },
    select: { id: true, name: true, price: true },
  });
}

describe('the puja catalog', () => {
  it('lists active temples with their active offerings and prices', async () => {
    const temple = await seedTemple({ name: 'Mahakaleshwar' });
    await seedOffering(temple.id, '2100.00', { name: 'Rudrabhishek' });
    await seedOffering(temple.id, '5100.00', { name: 'Mahamrityunjaya Jaap' });

    const temples = await PujaService.listTemples();

    expect(temples).toHaveLength(1);
    expect(temples[0]!.name).toBe('Mahakaleshwar');
    // Cheapest first, so the catalog does not open on the most expensive option.
    expect(temples[0]!.offerings.map((o) => o.price)).toEqual(['2100.00', '5100.00']);
  });

  it('hides an inactive temple and an inactive offering', async () => {
    const hidden = await seedTemple({ active: false });
    await seedOffering(hidden.id);

    const visible = await seedTemple();
    await seedOffering(visible.id, '1100.00', { name: 'Visible puja' });
    await seedOffering(visible.id, '9999.00', { name: 'Retired puja', active: false });

    const temples = await PujaService.listTemples();

    expect(temples).toHaveLength(1);
    expect(temples[0]!.offerings.map((o) => o.name)).toEqual(['Visible puja']);
  });
});

describe('booking a puja', () => {
  /**
   * The price is the whole point of the catalog. Callers cannot pass an amount, so this asserts the
   * charge equals the offering price and nothing else.
   */
  it('charges the catalog price and records what was bought', async () => {
    const { userId } = await seedUser('5000.00', 'Ananya Sharma');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00', { name: 'Rudrabhishek' });

    const result = await PujaService.book({
      userId,
      offeringId: offering.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.amountDebited).toBe('2100.00');
    expect(result.walletBalanceAfter).toBe('2900.00');
    expect(await balanceOf(userId)).toBe('2900.00');
    expect(result.booking.packagePrice).toBe('2100.00');
    expect(result.booking.pujaName).toBe('Rudrabhishek');
    expect(result.booking.status).toBe(PujaBookingStatus.CONFIRMED);

    const row = await prisma.pujaBooking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(row.pujaOfferingId).toBe(offering.id);
  });

  it('links the wallet ledger entry to the booking it paid for', async () => {
    const { userId } = await seedUser('5000.00');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00');

    const result = await PujaService.book({
      userId,
      offeringId: offering.id,
      idempotencyKey: randomUUID(),
    });

    const ledger = await prisma.walletTransaction.findFirstOrThrow({
      where: { referenceType: 'PUJA_BOOKING' },
    });
    expect(ledger.referenceId).toBe(result.booking.id);
    expect(ledger.amount.toFixed(2)).toBe('2100.00');
  });

  it('defaults the sankalp to the devotee, but lets them book for someone else', async () => {
    const { userId } = await seedUser('9000.00', 'Ananya Sharma');
    await prisma.user.update({ where: { id: userId }, data: { gotra: 'Bharadwaja' } });
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '1100.00');

    const own = await PujaService.book({
      userId,
      offeringId: offering.id,
      idempotencyKey: randomUUID(),
    });
    expect(own.booking.sankalpName).toBe('Ananya Sharma');
    expect(own.booking.sankalpGotra).toBe('Bharadwaja');

    // Pujas are routinely booked on behalf of a parent or child.
    const forMother = await PujaService.book({
      userId,
      offeringId: offering.id,
      idempotencyKey: randomUUID(),
      sankalpName: 'Sunita Sharma',
      sankalpGotra: 'Kashyapa',
      sankalpWish: 'Good health',
    });
    expect(forMother.booking.sankalpName).toBe('Sunita Sharma');
    expect(forMother.booking.sankalpGotra).toBe('Kashyapa');
    expect(forMother.booking.sankalpWish).toBe('Good health');
  });

  it('refuses to book when the wallet cannot cover it, and creates no booking', async () => {
    const { userId } = await seedUser('500.00');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00');

    await expect(
      PujaService.book({ userId, offeringId: offering.id, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(InsufficientFundsError);

    // The booking is created before the debit inside one transaction, so a failed payment must not
    // leave a confirmed booking behind promising a puja nobody paid for.
    expect(await prisma.pujaBooking.count()).toBe(0);
    expect(await balanceOf(userId)).toBe('500.00');
  });

  it('refuses a retired offering or one at a hidden temple', async () => {
    const { userId } = await seedUser('9000.00');
    const temple = await seedTemple();
    const retired = await seedOffering(temple.id, '2100.00', { active: false });
    const hiddenTemple = await seedTemple({ active: false });
    const orphan = await seedOffering(hiddenTemple.id, '2100.00');

    await expect(
      PujaService.book({ userId, offeringId: retired.id, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/no longer available/);
    await expect(
      PujaService.book({ userId, offeringId: orphan.id, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/no longer available/);

    expect(await balanceOf(userId)).toBe('9000.00');
  });

  it('reports an unknown offering as not found', async () => {
    const { userId } = await seedUser('9000.00');
    await expect(
      PujaService.book({
        userId,
        offeringId: '00000000-0000-0000-0000-000000000000',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(PujaError);
  });
});

describe('a double-tapped confirm button', () => {
  it('books and charges once when the same request is retried', async () => {
    const { userId } = await seedUser('9000.00');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00');
    const key = randomUUID();

    const first = await PujaService.book({ userId, offeringId: offering.id, idempotencyKey: key });
    const replay = await PujaService.book({ userId, offeringId: offering.id, idempotencyKey: key });

    expect(replay.booking.id).toBe(first.booking.id);
    expect(await prisma.pujaBooking.count()).toBe(1);
    expect(await prisma.walletTransaction.count()).toBe(1);
    expect(await balanceOf(userId)).toBe('6900.00');
  });

  it('books once even when two taps land simultaneously', async () => {
    const { userId } = await seedUser('9000.00');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00');
    const key = randomUUID();

    await Promise.allSettled([
      PujaService.book({ userId, offeringId: offering.id, idempotencyKey: key }),
      PujaService.book({ userId, offeringId: offering.id, idempotencyKey: key }),
    ]);

    expect(await prisma.pujaBooking.count()).toBe(1);
    expect(await balanceOf(userId)).toBe('6900.00');
  });

  it('does not let one account replay another account\'s key', async () => {
    const alice = await seedUser('9000.00');
    const bob = await seedUser('9000.00');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00');
    const key = randomUUID();

    await PujaService.book({ userId: alice.userId, offeringId: offering.id, idempotencyKey: key });

    await expect(
      PujaService.book({ userId: bob.userId, offeringId: offering.id, idempotencyKey: key }),
    ).rejects.toThrow(/another account/);
    expect(await balanceOf(bob.userId)).toBe('9000.00');
  });
});

describe('reading bookings back', () => {
  it('shows a devotee their own bookings, newest first', async () => {
    const { userId } = await seedUser('20000.00');
    const temple = await seedTemple();
    const cheap = await seedOffering(temple.id, '1100.00', { name: 'Sankashti puja' });
    const dear = await seedOffering(temple.id, '5100.00', { name: 'Mahamrityunjaya' });

    await PujaService.book({ userId, offeringId: cheap.id, idempotencyKey: randomUUID() });
    await PujaService.book({ userId, offeringId: dear.id, idempotencyKey: randomUUID() });

    const bookings = await PujaService.listBookingsForUser(userId);
    expect(bookings).toHaveLength(2);
    expect(bookings[0]!.pujaName).toBe('Mahamrityunjaya');
  });

  it('does not show one devotee another\'s booking', async () => {
    const alice = await seedUser('9000.00');
    const bob = await seedUser('9000.00');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00');

    const booked = await PujaService.book({
      userId: alice.userId,
      offeringId: offering.id,
      idempotencyKey: randomUUID(),
    });

    expect(await PujaService.listBookingsForUser(bob.userId)).toHaveLength(0);
    await expect(PujaService.getBookingForUser(booked.booking.id, bob.userId)).rejects.toThrow(
      /another account/,
    );
  });
});

describe('the fulfilment pipeline', () => {
  async function bookedPuja() {
    const { userId } = await seedUser('20000.00');
    const temple = await seedTemple();
    const offering = await seedOffering(temple.id, '2100.00');
    const result = await PujaService.book({
      userId,
      offeringId: offering.id,
      idempotencyKey: randomUUID(),
    });
    return { userId, bookingId: result.booking.id };
  }

  it('walks a booking from confirmed to prasad dispatched', async () => {
    const { bookingId } = await bookedPuja();

    const scheduled = await PujaService.schedule(bookingId, new Date('2026-09-15T04:30:00.000Z'));
    expect(scheduled.scheduledFor).toBe('2026-09-15T04:30:00.000Z');
    expect(scheduled.status).toBe(PujaBookingStatus.CONFIRMED);

    const started = await PujaService.advance(bookingId, PujaBookingStatus.IN_PROGRESS, {});
    expect(started.status).toBe(PujaBookingStatus.IN_PROGRESS);

    const done = await PujaService.advance(bookingId, PujaBookingStatus.COMPLETED, {
      videoProofUrl: 'https://proof.example.com/puja.mp4',
    });
    expect(done.status).toBe(PujaBookingStatus.COMPLETED);
    expect(done.videoProofUrl).toBe('https://proof.example.com/puja.mp4');
    expect(done.performedAt).not.toBeNull();

    const posted = await PujaService.advance(bookingId, PujaBookingStatus.PRASAD_DISPATCHED, {
      prasadAwb: 'AWB123456',
      prasadCourier: 'Bluedart',
    });
    expect(posted.status).toBe(PujaBookingStatus.PRASAD_DISPATCHED);
    expect(posted.prasadAwb).toBe('AWB123456');
    expect(posted.prasadCourier).toBe('Bluedart');
    expect(posted.prasadDispatchedAt).not.toBeNull();
  });

  /**
   * The devotee cannot see the puja happen, so the status is the entire product. Skipping a stage
   * would tell them their prasad is in the post before anyone had performed the rite.
   */
  it('refuses to skip a stage', async () => {
    const { bookingId } = await bookedPuja();

    await expect(
      PujaService.advance(bookingId, PujaBookingStatus.COMPLETED, {
        videoProofUrl: 'https://proof.example.com/puja.mp4',
      }),
    ).rejects.toThrow(/Cannot move a booking from CONFIRMED to COMPLETED/);

    await expect(
      PujaService.advance(bookingId, PujaBookingStatus.PRASAD_DISPATCHED, { prasadAwb: 'AWB1' }),
    ).rejects.toThrow(/Cannot move a booking/);

    const row = await prisma.pujaBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.status).toBe(PujaBookingStatus.CONFIRMED);
  });

  it('refuses to go backwards or repeat a stage', async () => {
    const { bookingId } = await bookedPuja();
    await PujaService.advance(bookingId, PujaBookingStatus.IN_PROGRESS, {});

    await expect(
      PujaService.advance(bookingId, PujaBookingStatus.IN_PROGRESS, {}),
    ).rejects.toThrow(/already IN_PROGRESS/);
    await expect(
      PujaService.advance(bookingId, PujaBookingStatus.CONFIRMED, {}),
    ).rejects.toThrow(/Cannot move a booking from IN_PROGRESS to CONFIRMED/);
  });

  it('will not claim a puja was performed without video proof', async () => {
    const { bookingId } = await bookedPuja();
    await PujaService.advance(bookingId, PujaBookingStatus.IN_PROGRESS, {});

    await expect(
      PujaService.advance(bookingId, PujaBookingStatus.COMPLETED, {}),
    ).rejects.toThrow(/videoProofUrl is required/);

    const row = await prisma.pujaBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.status).toBe(PujaBookingStatus.IN_PROGRESS);
  });

  it('will not claim prasad was posted without a tracking number', async () => {
    const { bookingId } = await bookedPuja();
    await PujaService.advance(bookingId, PujaBookingStatus.IN_PROGRESS, {});
    await PujaService.advance(bookingId, PujaBookingStatus.COMPLETED, {
      videoProofUrl: 'https://proof.example.com/puja.mp4',
    });

    await expect(
      PujaService.advance(bookingId, PujaBookingStatus.PRASAD_DISPATCHED, {}),
    ).rejects.toThrow(/prasadAwb is required/);
  });

  it('only schedules a booking that has not started', async () => {
    const { bookingId } = await bookedPuja();
    await PujaService.advance(bookingId, PujaBookingStatus.IN_PROGRESS, {});

    await expect(PujaService.schedule(bookingId, new Date())).rejects.toThrow(
      /Cannot schedule a booking that is IN_PROGRESS/,
    );
  });

  it('lists everything still awaiting fulfilment, oldest first, and drops it when finished', async () => {
    const first = await bookedPuja();
    const second = await bookedPuja();

    let pending = await PujaService.listPendingFulfilment();
    expect(pending.map((b) => b.id)).toEqual([first.bookingId, second.bookingId]);

    await PujaService.advance(first.bookingId, PujaBookingStatus.IN_PROGRESS, {});
    await PujaService.advance(first.bookingId, PujaBookingStatus.COMPLETED, {
      videoProofUrl: 'https://proof.example.com/puja.mp4',
    });
    await PujaService.advance(first.bookingId, PujaBookingStatus.PRASAD_DISPATCHED, {
      prasadAwb: 'AWB1',
    });

    pending = await PujaService.listPendingFulfilment();
    expect(pending.map((b) => b.id)).toEqual([second.bookingId]);
  });

  it('reports an unknown booking rather than failing opaquely', async () => {
    await expect(
      PujaService.advance('00000000-0000-0000-0000-000000000000', PujaBookingStatus.IN_PROGRESS, {}),
    ).rejects.toThrow(/not found/);
  });
});
