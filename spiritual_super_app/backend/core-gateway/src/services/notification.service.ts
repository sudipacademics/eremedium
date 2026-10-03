import { prisma } from '../lib/prisma.js';

export interface NotificationInput {
  userId?: string | null;
  phone?: string | null;
  title: string;
  body: string;
  link?: string | null;
}

function recipientFilter(userId: string, phone: string) {
  return { OR: [{ userId }, { userId: null, phone }] };
}

export const NotificationService = {
  async create(input: NotificationInput): Promise<void> {
    await prisma.notification.create({
      data: {
        userId: input.userId ?? null,
        phone: input.phone ?? null,
        title: input.title.slice(0, 160),
        body: input.body.slice(0, 1000),
        link: input.link ?? null,
      },
    });
  },

  async list(userId: string, phone: string, limit = 50) {
    const where = recipientFilter(userId, phone);
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      unread,
      notifications: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        link: row.link,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  },

  async markRead(userId: string, phone: string, id: string | null): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { ...recipientFilter(userId, phone), readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
    return result.count;
  },
};
