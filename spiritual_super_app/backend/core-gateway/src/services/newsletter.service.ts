import { z } from 'zod';

import { prisma } from '../lib/prisma.js';

export const newsletterBody = z
  .object({ email: z.string().trim().toLowerCase().email().max(254) })
  .strict();

export const NewsletterService = {
  /** Idempotent: subscribing twice is a no-op, and the response never reveals whether the email was known. */
  async subscribe(email: string): Promise<{ subscribed: true }> {
    await prisma.newsletterSubscriber.upsert({ where: { email }, create: { email }, update: {} });
    return { subscribed: true };
  },

  async list(limit: number) {
    const [total, subscribers] = await Promise.all([
      prisma.newsletterSubscriber.count(),
      prisma.newsletterSubscriber.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
    ]);
    return {
      total,
      subscribers: subscribers.map((row) => ({ id: row.id, email: row.email, createdAt: row.createdAt.toISOString() })),
    };
  },
};
