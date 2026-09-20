import { money, prisma } from '../lib/prisma.js';

export class HistoryError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 404) {
    super(message);
    this.name = 'HistoryError';
    this.statusCode = statusCode;
  }
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

/**
 * Admin history lookup by devotee phone. Exact E.164 first; if missing and the input has ≥10
 * digits, fall back to a single endsWith match so ops can paste a local 10-digit number.
 */
export const HistoryService = {
  async searchByPhone(rawPhone: string, limit = 40) {
    const take = Math.min(Math.max(limit, 1), 100);
    const exact = normalizePhone(rawPhone);
    const digits = rawPhone.replace(/\D/g, '');

    let user = await prisma.user.findUnique({
      where: { phone: exact },
      select: {
        id: true,
        phone: true,
        name: true,
        createdAt: true,
        wallet: { select: { id: true, balance: true, currency: true } },
        astrologer: { select: { id: true, displayName: true, status: true } },
      },
    });

    if (!user && digits.length >= 10) {
      const suffix = digits.slice(-10);
      const matches = await prisma.user.findMany({
        where: { phone: { endsWith: suffix } },
        take: 2,
        select: {
          id: true,
          phone: true,
          name: true,
          createdAt: true,
          wallet: { select: { id: true, balance: true, currency: true } },
          astrologer: { select: { id: true, displayName: true, status: true } },
        },
      });
      if (matches.length === 1) {
        user = matches[0] ?? null;
      } else if (matches.length > 1) {
        throw new HistoryError(
          `Multiple users end with …${suffix}; use full E.164 phone`,
          409,
        );
      }
    }

    if (!user) {
      throw new HistoryError(`No user found for phone ${exact}`);
    }

    const [bookings, orders, calls, transactions] = await Promise.all([
      prisma.pujaBooking.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          temple: { select: { name: true, location: true } },
        },
      }),
      prisma.ayurvedaOrder.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      prisma.callSession.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          astrologer: { select: { id: true, displayName: true } },
        },
      }),
      user.wallet
        ? prisma.walletTransaction.findMany({
            where: { walletId: user.wallet.id },
            orderBy: { createdAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
    ]);

    return {
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
        walletBalance: user.wallet ? money(user.wallet.balance).toFixed(2) : null,
        walletCurrency: user.wallet?.currency ?? null,
        astrologerId: user.astrologer?.id ?? null,
        astrologerDisplayName: user.astrologer?.displayName ?? null,
        astrologerStatus: user.astrologer?.status ?? null,
      },
      bookings: bookings.map((b) => ({
        id: b.id,
        status: b.status,
        pujaName: b.pujaName,
        packagePrice: money(b.packagePrice).toFixed(2),
        templeName: b.temple.name,
        templeLocation: b.temple.location,
        sankalpName: b.sankalpName,
        scheduledFor: b.scheduledFor?.toISOString() ?? null,
        performedAt: b.performedAt?.toISOString() ?? null,
        prasadAwb: b.prasadAwb,
        prasadCourier: b.prasadCourier,
        createdAt: b.createdAt.toISOString(),
      })),
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        productSku: o.productSku,
        productName: o.productName,
        unitPrice: money(o.unitPrice).toFixed(2),
        shippingName: o.shippingName,
        shippingPhone: o.shippingPhone,
        awb: o.awb,
        courier: o.courier,
        packedAt: o.packedAt?.toISOString() ?? null,
        dispatchedAt: o.dispatchedAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
      calls: calls.map((c) => ({
        id: c.id,
        status: c.status,
        ratePerMinute: money(c.ratePerMinute).toFixed(2),
        totalMinutes: c.totalMinutes,
        totalDeducted: money(c.totalDeducted).toFixed(2),
        startTime: c.startTime?.toISOString() ?? null,
        endTime: c.endTime?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        astrologer: {
          id: c.astrologer.id,
          displayName: c.astrologer.displayName,
        },
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: money(t.amount).toFixed(2),
        type: t.type,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        balanceAfter: money(t.balanceAfter).toFixed(2),
        createdAt: t.createdAt.toISOString(),
      })),
    };
  },
} as const;
