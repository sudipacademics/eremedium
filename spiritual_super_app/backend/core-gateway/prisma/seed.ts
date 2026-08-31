/**
 * Development seed: one consumer with a funded wallet, one online astrologer and one temple.
 * Run with: npx tsx prisma/seed.ts
 */
import { AstrologerStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const consumer = await prisma.user.upsert({
    where: { phone: '+919000000001' },
    update: {},
    create: {
      phone: '+919000000001',
      name: 'Ananya Sharma',
      dob: new Date('1994-08-17T03:45:00.000Z'),
      birthPlace: 'Varanasi, India',
      latitude: '25.317645',
      longitude: '83.005495',
      gotra: 'Bharadwaja',
      wallet: { create: { balance: '2500.00', currency: 'INR' } },
    },
    select: { id: true },
  });

  const astrologerUser = await prisma.user.upsert({
    where: { phone: '+919000000002' },
    update: {},
    create: {
      phone: '+919000000002',
      name: 'Pandit Rajesh Trivedi',
      birthPlace: 'Ujjain, India',
      wallet: { create: { balance: '0.00', currency: 'INR' } },
    },
    select: { id: true },
  });

  const astrologer = await prisma.astrologer.upsert({
    where: { userId: astrologerUser.id },
    update: { status: AstrologerStatus.IDLE },
    create: {
      userId: astrologerUser.id,
      displayName: 'Pandit Rajesh Trivedi',
      perMinuteRate: '35.00',
      commissionSplit: '0.5000',
      status: AstrologerStatus.IDLE,
      languages: ['hi', 'en', 'sa'],
    },
    select: { id: true },
  });

  const temple = await prisma.temple.upsert({
    where: { name_location: { name: 'Shree Mahakaleshwar Jyotirlinga', location: 'Ujjain, Madhya Pradesh' } },
    update: {},
    create: {
      name: 'Shree Mahakaleshwar Jyotirlinga',
      location: 'Ujjain, Madhya Pradesh',
      primaryDeity: 'Lord Shiva',
      liveStreamUrl: 'https://stream.example.com/mahakaleshwar/live.m3u8',
    },
    select: { id: true },
  });

  console.info(
    JSON.stringify(
      { consumerId: consumer.id, astrologerId: astrologer.id, templeId: temple.id },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
