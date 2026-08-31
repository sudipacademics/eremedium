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

  /*
   * The puja catalog. Prices live here and nowhere else: a booking reads its amount from the
   * offering, so this is the only place that decides what a devotee pays.
   */
  const catalog: ReadonlyArray<{
    name: string;
    location: string;
    primaryDeity: string;
    liveStreamUrl?: string;
    offerings: ReadonlyArray<{
      name: string;
      description: string;
      price: string;
      durationLabel: string;
      prasadIncluded: string;
    }>;
  }> = [
    {
      name: 'Shree Mahakaleshwar Jyotirlinga',
      location: 'Ujjain, Madhya Pradesh',
      primaryDeity: 'Lord Shiva',
      liveStreamUrl: 'https://stream.example.com/mahakaleshwar/live.m3u8',
      offerings: [
        {
          name: 'Rudrabhishek',
          description:
            'Abhishek of the Jyotirlinga with milk, honey, curd and Ganga jal, with recitation of the Rudri path.',
          price: '2100.00',
          durationLabel: '45 minutes',
          prasadIncluded: 'Bhasma, prasad and photographs of your puja',
        },
        {
          name: 'Mahamrityunjaya Jaap (11,000)',
          description:
            'Eleven thousand recitations of the Mahamrityunjaya mantra by eleven pandits for health and longevity.',
          price: '5100.00',
          durationLabel: '3 hours',
          prasadIncluded: 'Rudraksha, bhasma, prasad and a video recording',
        },
        {
          name: 'Kaal Sarp Dosh Nivaran',
          description:
            'Remedial puja for Kaal Sarp Yoga in the birth chart, performed with naga pratishtha and Rahu-Ketu shanti.',
          price: '7100.00',
          durationLabel: '4 hours',
          prasadIncluded: 'Silver naga yantra, prasad and a video recording',
        },
      ],
    },
    {
      name: 'Shree Trimbakeshwar Jyotirlinga',
      location: 'Nashik, Maharashtra',
      primaryDeity: 'Lord Shiva',
      offerings: [
        {
          name: 'Narayan Nagbali',
          description:
            'The traditional three-day rite performed at Trimbakeshwar for release from ancestral debts and pitru dosha.',
          price: '11000.00',
          durationLabel: '3 days',
          prasadIncluded: 'Prasad, sankalp certificate and a video recording',
        },
        {
          name: 'Rudra Abhishek',
          description: 'Abhishek at the Trimbakeshwar Jyotirlinga with the Rudri path in your name and gotra.',
          price: '1800.00',
          durationLabel: '40 minutes',
          prasadIncluded: 'Bhasma, prasad and photographs',
        },
      ],
    },
    {
      name: 'Shree Siddhivinayak Mandir',
      location: 'Mumbai, Maharashtra',
      primaryDeity: 'Lord Ganesha',
      offerings: [
        {
          name: 'Sankashti Ganapati Puja',
          description: 'Sankashti Chaturthi puja with Atharvashirsha recitation for the removal of obstacles.',
          price: '1100.00',
          durationLabel: '30 minutes',
          prasadIncluded: 'Modak prasad and photographs',
        },
        {
          name: 'Ganapati Havan',
          description: 'A full havan with 1,008 offerings invoking Ganapati before a new venture or marriage.',
          price: '3100.00',
          durationLabel: '2 hours',
          prasadIncluded: 'Prasad, yantra and a video recording',
        },
      ],
    },
  ];

  const templeIds: Record<string, string> = {};

  for (const entry of catalog) {
    const temple = await prisma.temple.upsert({
      where: { name_location: { name: entry.name, location: entry.location } },
      update: { active: true },
      create: {
        name: entry.name,
        location: entry.location,
        primaryDeity: entry.primaryDeity,
        ...(entry.liveStreamUrl === undefined ? {} : { liveStreamUrl: entry.liveStreamUrl }),
      },
      select: { id: true },
    });
    templeIds[entry.name] = temple.id;

    for (const offering of entry.offerings) {
      await prisma.pujaOffering.upsert({
        where: { templeId_name: { templeId: temple.id, name: offering.name } },
        // Re-running the seed corrects prices and copy without duplicating the catalog.
        update: {
          description: offering.description,
          price: offering.price,
          durationLabel: offering.durationLabel,
          prasadIncluded: offering.prasadIncluded,
          active: true,
        },
        create: {
          templeId: temple.id,
          name: offering.name,
          description: offering.description,
          price: offering.price,
          durationLabel: offering.durationLabel,
          prasadIncluded: offering.prasadIncluded,
        },
      });
    }
  }

  const offeringCount = await prisma.pujaOffering.count();

  console.info(
    JSON.stringify(
      {
        consumerId: consumer.id,
        astrologerId: astrologer.id,
        temples: templeIds,
        offeringCount,
      },
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
