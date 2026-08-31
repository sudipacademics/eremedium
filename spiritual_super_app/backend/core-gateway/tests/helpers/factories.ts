import { AstrologerStatus, CallSessionStatus } from '@prisma/client';

import { prisma } from '../../src/lib/prisma.js';

let counter = 0;
function unique(): string {
  counter += 1;
  return `${Date.now()}${counter}`.slice(-9);
}

export interface SeededUser {
  userId: string;
  walletId: string;
  phone: string;
}

/** A user with a wallet, because every money path assumes the wallet row already exists. */
export async function seedUser(balance = '0.00', name = 'Test Seeker'): Promise<SeededUser> {
  const phone = `+9199${unique()}`;
  const user = await prisma.user.create({
    data: { phone, name, wallet: { create: { balance } } },
    select: { id: true, wallet: { select: { id: true } } },
  });
  return { userId: user.id, walletId: user.wallet!.id, phone };
}

export interface SeededAstrologer {
  astrologerId: string;
  userId: string;
}

export async function seedAstrologer(
  perMinuteRate = '20.00',
  commissionSplit = '0.50',
  status: AstrologerStatus = AstrologerStatus.IDLE,
): Promise<SeededAstrologer> {
  const { userId } = await seedUser('0.00', 'Test Jyotishi');
  const astrologer = await prisma.astrologer.create({
    data: {
      userId,
      displayName: 'Test Jyotishi',
      perMinuteRate,
      commissionSplit,
      status,
      languages: ['Hindi'],
    },
    select: { id: true },
  });
  return { astrologerId: astrologer.id, userId };
}

export async function seedCallSession(options: {
  userId: string;
  astrologerId: string;
  ratePerMinute?: string;
  status?: CallSessionStatus;
}): Promise<{ id: string; channelId: string }> {
  const channelId = `call_test_${unique()}`;
  const session = await prisma.callSession.create({
    data: {
      userId: options.userId,
      astrologerId: options.astrologerId,
      channelId,
      ratePerMinute: options.ratePerMinute ?? '20.00',
      status: options.status ?? CallSessionStatus.ACTIVE,
      startTime: new Date(),
    },
    select: { id: true, channelId: true },
  });
  return session;
}

export async function balanceOf(userId: string): Promise<string> {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId },
    select: { balance: true },
  });
  return wallet.balance.toFixed(2);
}
