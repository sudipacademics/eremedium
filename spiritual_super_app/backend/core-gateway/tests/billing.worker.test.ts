import { AstrologerStatus, CallSessionStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import type { BillingTickJobData } from '../src/queues/index.js';
import { balanceOf, seedAstrologer, seedCallSession, seedUser } from './helpers/factories.js';

/*
 * LiveKit is the only external dependency of a billing tick, and it is consulted for one thing: how
 * many people are actually in the room. Stubbing just that keeps the database behaviour real while
 * letting each test state the room condition it is about.
 */
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

const { processTick, handleOutcome } = await import('../src/workers/billing.worker.js');

const tick = (callSessionId: string, tickNumber: number) =>
  ({ data: { callSessionId, tickNumber } }) as Job<BillingTickJobData>;

beforeEach(() => {
  countParticipants.mockReset();
  countParticipants.mockResolvedValue(2);
});

describe('a billed minute', () => {
  it('charges the rate, credits the astrologer and rolls up the session in one go', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00', '0.50');
    const session = await seedCallSession({ userId, astrologerId });

    const outcome = await processTick(tick(session.id, 1));

    expect(outcome.kind).toBe('BILLED');
    expect(await balanceOf(userId)).toBe('80.00');

    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.totalMinutes).toBe(1);
    expect(row.totalDeducted.toFixed(2)).toBe('20.00');

    const earning = await prisma.astrologerEarning.findFirstOrThrow({
      where: { callSessionId: session.id },
    });
    expect(earning.minuteNumber).toBe(1);
    expect(earning.grossAmount.toFixed(2)).toBe('20.00');
    expect(earning.netAmount.toFixed(2)).toBe('10.00');
    expect(earning.platformFee.toFixed(2)).toBe('10.00');
  });

  it('honours the astrologer commission split rather than assuming an even one', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00', '0.70');
    const session = await seedCallSession({ userId, astrologerId });

    await processTick(tick(session.id, 1));

    const earning = await prisma.astrologerEarning.findFirstOrThrow({
      where: { callSessionId: session.id },
    });
    expect(earning.netAmount.toFixed(2)).toBe('14.00');
    expect(earning.platformFee.toFixed(2)).toBe('6.00');
    expect(earning.commissionSplit.toFixed(4)).toBe('0.7000');
  });

  /**
   * The platform deliberately takes the remainder instead of rounding its own share. Rounding both
   * halves independently is how a ledger ends up a paisa short of what the user actually paid.
   */
  it('splits an odd amount so the two shares still sum to exactly the gross', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('0.03', '0.50');
    const session = await seedCallSession({ userId, astrologerId, ratePerMinute: '0.03' });

    await processTick(tick(session.id, 1));

    const earning = await prisma.astrologerEarning.findFirstOrThrow({
      where: { callSessionId: session.id },
    });
    expect(earning.grossAmount.toFixed(2)).toBe('0.03');
    expect(earning.netAmount.plus(earning.platformFee).toFixed(2)).toBe('0.03');
  });

  it('keeps the user charge and the earnings ledger in agreement across several minutes', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00', '0.60');
    const session = await seedCallSession({ userId, astrologerId });

    for (let minute = 1; minute <= 3; minute += 1) {
      await processTick(tick(session.id, minute));
    }

    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    const totals = await prisma.astrologerEarning.aggregate({
      where: { callSessionId: session.id },
      _sum: { grossAmount: true, netAmount: true, platformFee: true },
    });

    expect(row.totalMinutes).toBe(3);
    expect(row.totalDeducted.toFixed(2)).toBe('60.00');
    expect(totals._sum.grossAmount?.toFixed(2)).toBe('60.00');
    expect(totals._sum.netAmount?.plus(totals._sum.platformFee!).toFixed(2)).toBe('60.00');
    expect(await balanceOf(userId)).toBe('40.00');
  });
});

describe('a replayed tick', () => {
  it('does not charge twice when the same minute is processed again', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({ userId, astrologerId });

    await processTick(tick(session.id, 1));
    await processTick(tick(session.id, 1));

    expect(await balanceOf(userId)).toBe('80.00');
    expect(await prisma.walletTransaction.count()).toBe(1);
    expect(await prisma.astrologerEarning.count()).toBe(1);
  });

  it('does not pay the astrologer twice for one minute even under simultaneous ticks', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({ userId, astrologerId });

    await Promise.allSettled([processTick(tick(session.id, 1)), processTick(tick(session.id, 1))]);

    const earnings = await prisma.astrologerEarning.findMany({
      where: { callSessionId: session.id },
    });
    expect(earnings).toHaveLength(1);
    expect(await balanceOf(userId)).toBe('80.00');
  });
});

describe('a room that is not a call any more', () => {
  it('charges nothing when one party has dropped, tolerating a single blip', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({ userId, astrologerId });
    countParticipants.mockResolvedValue(1);

    const outcome = await processTick(tick(session.id, 1));

    expect(outcome.kind).toBe('SKIPPED');
    expect(await balanceOf(userId)).toBe('100.00');
    expect(await prisma.astrologerEarning.count()).toBe(0);
  });

  it('ends the call once the room stays short-handed, instead of billing an empty room forever', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00', '0.50', AstrologerStatus.IN_CALL);
    const session = await seedCallSession({ userId, astrologerId });
    countParticipants.mockResolvedValue(0);

    const first = await processTick(tick(session.id, 1));
    expect(first.kind).toBe('SKIPPED');

    const second = await processTick(tick(session.id, 2));
    expect(second.kind).toBe('ABANDONED');

    await handleOutcome(tick(session.id, 2), second);

    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.COMPLETED);
    expect(row.totalMinutes).toBe(0);
    expect(await balanceOf(userId)).toBe('100.00');

    // The astrologer must be bookable again, or one abandoned call removes them from supply.
    const astrologer = await prisma.astrologer.findUniqueOrThrow({ where: { id: astrologerId } });
    expect(astrologer.status).toBe(AstrologerStatus.IDLE);
  });

  it('resets the strike count once both parties are back, so a blip never accumulates', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({ userId, astrologerId });

    countParticipants.mockResolvedValue(1);
    expect((await processTick(tick(session.id, 1))).kind).toBe('SKIPPED');

    countParticipants.mockResolvedValue(2);
    expect((await processTick(tick(session.id, 2))).kind).toBe('BILLED');

    countParticipants.mockResolvedValue(1);
    // Would be ABANDONED if the earlier strike had persisted through the successful minute.
    expect((await processTick(tick(session.id, 3))).kind).toBe('SKIPPED');
  });

  /**
   * An unreachable LiveKit is not evidence of an empty room. Billing blindly would charge for calls
   * that ended; hanging up would kill live ones. The minute goes unbilled and the loop continues.
   */
  it('charges nothing and keeps the call alive when LiveKit cannot be reached', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({ userId, astrologerId });
    countParticipants.mockResolvedValue(null);

    const outcome = await processTick(tick(session.id, 1));

    expect(outcome).toMatchObject({ kind: 'SKIPPED', reason: 'LIVEKIT_UNREACHABLE' });
    expect(await balanceOf(userId)).toBe('100.00');

    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.ACTIVE);
  });
});

describe('a wallet that runs out', () => {
  it('drops the call rather than letting the balance go negative', async () => {
    const { userId } = await seedUser('15.00');
    const { astrologerId } = await seedAstrologer('20.00', '0.50', AstrologerStatus.IN_CALL);
    const session = await seedCallSession({ userId, astrologerId });

    const outcome = await processTick(tick(session.id, 1));
    expect(outcome).toMatchObject({ kind: 'DROPPED' });

    await handleOutcome(tick(session.id, 1), outcome);

    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe(CallSessionStatus.DROPPED_INSUFFICIENT_FUNDS);
    expect(await balanceOf(userId)).toBe('15.00');
    expect(await prisma.astrologerEarning.count()).toBe(0);
  });

  it('bills the last affordable minute and only then drops the call', async () => {
    const { userId } = await seedUser('20.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({ userId, astrologerId });

    expect((await processTick(tick(session.id, 1))).kind).toBe('BILLED');
    expect(await balanceOf(userId)).toBe('0.00');

    expect((await processTick(tick(session.id, 2))).kind).toBe('DROPPED');
    expect(await prisma.astrologerEarning.count()).toBe(1);
  });
});

describe('a session that is no longer billable', () => {
  it('stops the loop instead of charging a completed call', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.COMPLETED,
    });

    const outcome = await processTick(tick(session.id, 1));

    expect(outcome).toMatchObject({ kind: 'STOPPED' });
    expect(await balanceOf(userId)).toBe('100.00');
  });

  it('does not bill a session that was never activated', async () => {
    const { userId } = await seedUser('100.00');
    const { astrologerId } = await seedAstrologer('20.00');
    const session = await seedCallSession({
      userId,
      astrologerId,
      status: CallSessionStatus.INITIATED,
    });

    const outcome = await processTick(tick(session.id, 1));

    expect(outcome).toMatchObject({ kind: 'STOPPED', reason: 'SESSION_INITIATED' });
    expect(await balanceOf(userId)).toBe('100.00');
  });

  it('stops quietly when the session has been deleted', async () => {
    const outcome = await processTick(tick('00000000-0000-0000-0000-000000000000', 1));
    expect(outcome).toMatchObject({ kind: 'STOPPED', reason: 'SESSION_NOT_FOUND' });
  });
});
