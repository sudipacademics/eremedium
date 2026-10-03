import { AyurvedaOrderStatus, JoinRequestStatus, PujaBookingStatus, type Prisma } from '@prisma/client';

import { Permission } from '../auth/permissions.js';
import { prisma } from '../lib/prisma.js';
import {
  PERIOD_LABELS,
  changePct,
  lastMonths,
  monthsOfThisYear,
  periodWindow,
  regionOf,
  topShares,
  type DashboardPeriod,
  type MonthBucket,
} from './dashboard-rules.js';
import { CATEGORY_LABELS, OPEN_STATUSES, STATUS_LABELS } from './join-request-rules.js';

export interface DashboardOptions {
  period: DashboardPeriod;
  revenueRange: 'year' | '12m';
  growthMonths: 6 | 12;
  permissions: readonly string[];
}

interface Window {
  from: Date | null;
  to: Date;
}

type MonthAmountRow = { month: string; amount: string };

const SERVICES = [
  { key: 'consultations', label: 'Consultations' },
  { key: 'epuja', label: 'E-Puja' },
  { key: 'ayurveda', label: 'Ayurveda products' },
  { key: 'crystals', label: 'Crystals' },
] as const;
type ServiceKey = (typeof SERVICES)[number]['key'];

const CALL_STATUS_LABELS: Record<string, string> = {
  INITIATED: 'Connecting',
  ACTIVE: 'Ongoing',
  COMPLETED: 'Completed',
  DROPPED_INSUFFICIENT_FUNDS: 'Ended (balance)',
};

const ORDER_STATUS_LABELS: Record<AyurvedaOrderStatus, string> = {
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  DISPATCHED: 'Shipped',
};

function createdIn(window: Window): { createdAt?: { gte?: Date; lt: Date } } {
  return { createdAt: { ...(window.from ? { gte: window.from } : {}), lt: window.to } };
}

/** Count in the period, in the period before it, and overall. */
async function trio(count: (where: { createdAt?: { gte?: Date; lt: Date } }) => Promise<number>, period: DashboardPeriod, now: Date) {
  const window = periodWindow(period, now);
  const [total, inPeriod, previous] = await Promise.all([
    count({}),
    window.from ? count(createdIn(window)) : Promise.resolve(null),
    window.from && window.previousFrom ? count({ createdAt: { gte: window.previousFrom, lt: window.from } }) : Promise.resolve(null),
  ]);
  return { total, inPeriod: inPeriod ?? total, changePct: changePct(inPeriod ?? total, previous) };
}

async function revenueByService(window: Window): Promise<Record<ServiceKey, number>> {
  const from = window.from ?? new Date(0);
  const [consultations, epuja, shop] = await Promise.all([
    prisma.astrologerEarning.aggregate({ where: createdIn(window), _sum: { grossAmount: true } }),
    prisma.pujaBooking.aggregate({ where: createdIn(window), _sum: { packagePrice: true } }),
    prisma.$queryRaw<{ category: string; amount: string }[]>`
      SELECT COALESCE(p.category::text, 'AYURVEDA') AS category, SUM(o.unit_price)::text AS amount
      FROM ayurveda_orders o LEFT JOIN ayurveda_products p ON p.id = o.product_id
      WHERE o.created_at >= ${from} AND o.created_at < ${window.to}
      GROUP BY 1`,
  ]);
  const shopBy = new Map(shop.map((row) => [row.category, Number(row.amount)]));
  return {
    consultations: Number(consultations._sum.grossAmount ?? 0),
    epuja: Number(epuja._sum.packagePrice ?? 0),
    ayurveda: shopBy.get('AYURVEDA') ?? 0,
    crystals: shopBy.get('CRYSTAL') ?? 0,
  };
}

function sumRevenue(revenue: Record<ServiceKey, number>): number {
  return Object.values(revenue).reduce((sum, value) => sum + value, 0);
}

async function revenueTrend(buckets: MonthBucket[]) {
  const from = buckets[0]!.start;
  const [consultations, epuja, shop] = await Promise.all([
    prisma.$queryRaw<MonthAmountRow[]>`
      SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, SUM(gross_amount)::text AS amount
      FROM astrologer_earnings WHERE created_at >= ${from} GROUP BY 1`,
    prisma.$queryRaw<MonthAmountRow[]>`
      SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, SUM(package_price)::text AS amount
      FROM puja_bookings WHERE created_at >= ${from} GROUP BY 1`,
    prisma.$queryRaw<MonthAmountRow[]>`
      SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, SUM(unit_price)::text AS amount
      FROM ayurveda_orders WHERE created_at >= ${from} GROUP BY 1`,
  ]);
  const index = (rows: MonthAmountRow[]) => new Map(rows.map((row) => [row.month, Number(row.amount)]));
  const [c, e, s] = [index(consultations), index(epuja), index(shop)];
  return buckets.map((bucket) => ({
    month: bucket.key,
    label: bucket.label,
    consultations: c.get(bucket.key) ?? 0,
    epuja: e.get(bucket.key) ?? 0,
    shop: s.get(bucket.key) ?? 0,
  }));
}

async function userGrowth(buckets: MonthBucket[]) {
  const from = buckets[0]!.start;
  const [before, rows] = await Promise.all([
    prisma.user.count({ where: { createdAt: { lt: from } } }),
    prisma.$queryRaw<{ month: string; count: bigint }[]>`
      SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, COUNT(*) AS count
      FROM users WHERE created_at >= ${from} GROUP BY 1`,
  ]);
  const byMonth = new Map(rows.map((row) => [row.month, Number(row.count)]));
  let running = before;
  return buckets.map((bucket) => {
    const added = byMonth.get(bucket.key) ?? 0;
    running += added;
    return { month: bucket.key, label: bucket.label, newUsers: added, total: running };
  });
}

async function topServices(window: Window) {
  const where = createdIn(window);
  const [calls, pujas, products] = await Promise.all([
    prisma.callSession.findMany({ where: { ...where, startTime: { not: null } }, select: { astrologer: { select: { category: true } } } }),
    prisma.pujaBooking.groupBy({ by: ['pujaName'], where, _count: { _all: true }, orderBy: { _count: { pujaName: 'desc' } }, take: 5 }),
    prisma.ayurvedaOrder.groupBy({ by: ['productName'], where, _count: { _all: true }, orderBy: { _count: { productName: 'desc' } }, take: 5 }),
  ]);
  const byCategory = new Map<string, number>();
  for (const call of calls) {
    const label = `${CATEGORY_LABELS[call.astrologer.category]} consultation`;
    byCategory.set(label, (byCategory.get(label) ?? 0) + 1);
  }
  return [
    ...[...byCategory.entries()].map(([label, count]) => ({ label, kind: 'Consultation', count })),
    ...pujas.map((row) => ({ label: row.pujaName, kind: 'E-Puja', count: row._count._all })),
    ...products.map((row) => ({ label: row.productName, kind: 'Product', count: row._count._all })),
  ]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5);
}

interface Activity {
  kind: 'user' | 'join' | 'puja' | 'order' | 'call' | 'audit';
  text: string;
  at: string;
  href: string | null;
}

export async function buildDashboard(options: DashboardOptions, now = new Date()) {
  const can = (permission: string) => options.permissions.includes(permission);
  const finance = can(Permission.FINANCE);
  const join = can(Permission.JOIN_REQUESTS);
  const seesCalls = can(Permission.SUPPORT) || finance;
  const seesOrders = can(Permission.OPERATIONS) || finance;
  const window = periodWindow(options.period, now);
  const current: Window = { from: window.from, to: now };

  const revenueBuckets = options.revenueRange === 'year' ? monthsOfThisYear(now) : lastMonths(12, now);
  const growthBuckets = lastMonths(options.growthMonths, now);

  const [
    users,
    providers,
    joinRequests,
    consultations,
    pujaBookings,
    shopOrders,
    joinPending,
    joinOpen,
    pujaOpen,
    ordersOpen,
    liveCalls,
    providersByCategory,
    growth,
    places,
    services,
  ] = await Promise.all([
    trio((where) => prisma.user.count({ where }), options.period, now),
    trio((where) => prisma.astrologer.count({ where }), options.period, now),
    trio((where) => prisma.providerJoinRequest.count({ where }), options.period, now),
    trio((where) => prisma.callSession.count({ where: { ...where, startTime: { not: null } } }), options.period, now),
    trio((where) => prisma.pujaBooking.count({ where }), options.period, now),
    trio((where) => prisma.ayurvedaOrder.count({ where }), options.period, now),
    prisma.providerJoinRequest.count({ where: { status: JoinRequestStatus.PENDING } }),
    prisma.providerJoinRequest.count({ where: { status: { in: [...OPEN_STATUSES] } } }),
    prisma.pujaBooking.count({ where: { status: { in: [PujaBookingStatus.CONFIRMED, PujaBookingStatus.IN_PROGRESS] } } }),
    prisma.ayurvedaOrder.count({ where: { status: { in: [AyurvedaOrderStatus.CONFIRMED, AyurvedaOrderStatus.PACKED] } } }),
    prisma.callSession.count({ where: { status: 'ACTIVE' } }),
    prisma.astrologer.groupBy({ by: ['category'], _count: { _all: true } }),
    userGrowth(growthBuckets),
    prisma.user.findMany({ where: { birthPlace: { not: null } }, select: { birthPlace: true }, take: 20_000 }),
    topServices(current),
  ]);

  let revenue: { total: number; inPeriod: number; changePct: number | null } | null = null;
  let serviceRevenue: { total: number; items: { key: string; label: string; amount: number; pct: number }[] } | null = null;
  let trend: Awaited<ReturnType<typeof revenueTrend>> | null = null;
  if (finance) {
    const [all, inPeriod, previous, months] = await Promise.all([
      revenueByService({ from: null, to: now }),
      revenueByService(current),
      window.from && window.previousFrom ? revenueByService({ from: window.previousFrom, to: window.from }) : Promise.resolve(null),
      revenueTrend(revenueBuckets),
    ]);
    const periodTotal = sumRevenue(inPeriod);
    revenue = { total: sumRevenue(all), inPeriod: periodTotal, changePct: changePct(periodTotal, previous ? sumRevenue(previous) : null) };
    serviceRevenue = {
      total: periodTotal,
      items: SERVICES.map((service) => ({
        key: service.key,
        label: service.label,
        amount: inPeriod[service.key],
        pct: periodTotal ? Math.round((inPeriod[service.key] / periodTotal) * 100) : 0,
      })),
    };
    trend = months;
  }

  const [latestJoin, recentCalls, latestOrders, activity] = await Promise.all([
    join
      ? prisma.providerJoinRequest.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, applicationNo: true, name: true, category: true, city: true, status: true, createdAt: true },
        })
      : Promise.resolve([]),
    seesCalls
      ? prisma.callSession.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            startTime: true,
            createdAt: true,
            totalMinutes: true,
            user: { select: { name: true } },
            astrologer: { select: { displayName: true, category: true } },
          },
        })
      : Promise.resolve([]),
    seesOrders
      ? prisma.ayurvedaOrder.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, productName: true, unitPrice: true, status: true, createdAt: true, product: { select: { imageUrl: true } } },
        })
      : Promise.resolve([]),
    recentActivity({ join, seesCalls, seesOrders, audit: can(Permission.AUDIT) }),
  ]);

  const regions = places.map((row) => regionOf(row.birthPlace)).filter((region): region is string => region !== null);

  return {
    generatedAt: now.toISOString(),
    period: options.period,
    periodLabel: PERIOD_LABELS[options.period],
    kpis: { users, providers, joinRequests: { ...joinRequests, pending: joinPending }, consultations, pujaBookings, shopOrders, revenue },
    revenueTrend: trend ? { range: options.revenueRange, months: trend } : null,
    serviceRevenue,
    userGrowth: growth,
    pending: { joinRequests: joinOpen, pujaBookings: pujaOpen, shopOrders: ordersOpen, liveCalls },
    latestJoinRequests: latestJoin.map((row) => ({
      id: row.id,
      applicationNo: row.applicationNo,
      name: row.name,
      categoryLabel: CATEGORY_LABELS[row.category],
      city: row.city,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
      createdAt: row.createdAt.toISOString(),
    })),
    recentConsultations: recentCalls.map((row) => ({
      id: row.id,
      userName: row.user.name,
      providerName: row.astrologer.displayName,
      service: CATEGORY_LABELS[row.astrologer.category],
      at: (row.startTime ?? row.createdAt).toISOString(),
      minutes: row.totalMinutes,
      status: row.status,
      statusLabel: CALL_STATUS_LABELS[row.status] ?? row.status,
    })),
    latestOrders: latestOrders.map((row) => ({
      id: row.id,
      productName: row.productName,
      imageUrl: row.product?.imageUrl ?? null,
      amount: Number(row.unitPrice),
      status: row.status,
      statusLabel: ORDER_STATUS_LABELS[row.status],
      createdAt: row.createdAt.toISOString(),
    })),
    topLocations: { basis: regions.length, items: topShares(regions, 5) },
    providersByCategory: providersByCategory
      .map((group) => ({ category: group.category, label: CATEGORY_LABELS[group.category], count: group._count._all }))
      .sort((a, b) => b.count - a.count),
    topServices: services,
    recentActivity: activity,
  };
}

async function recentActivity(scope: { join: boolean; seesCalls: boolean; seesOrders: boolean; audit: boolean }): Promise<Activity[]> {
  const take = 6;
  const recentFirst = { orderBy: { createdAt: 'desc' as Prisma.SortOrder }, take };
  const [users, joins, pujas, orders, calls, audits] = await Promise.all([
    prisma.user.findMany({ ...recentFirst, select: { name: true, createdAt: true } }),
    scope.join ? prisma.providerJoinRequest.findMany({ ...recentFirst, select: { id: true, name: true, category: true, createdAt: true } }) : [],
    scope.seesOrders ? prisma.pujaBooking.findMany({ ...recentFirst, select: { pujaName: true, createdAt: true } }) : [],
    scope.seesOrders ? prisma.ayurvedaOrder.findMany({ ...recentFirst, select: { productName: true, createdAt: true } }) : [],
    scope.seesCalls
      ? prisma.callSession.findMany({
          where: { status: 'COMPLETED' },
          orderBy: { updatedAt: 'desc' },
          take,
          select: { updatedAt: true, totalMinutes: true, astrologer: { select: { displayName: true } } },
        })
      : [],
    scope.audit ? prisma.auditLog.findMany({ ...recentFirst, select: { summary: true, createdAt: true } }) : [],
  ]);
  const items: Activity[] = [
    ...users.map((row) => ({ kind: 'user' as const, text: `New user registered: ${row.name}`, at: row.createdAt.toISOString(), href: null })),
    ...joins.map((row) => ({
      kind: 'join' as const,
      text: `New ${CATEGORY_LABELS[row.category]} join request from ${row.name}`,
      at: row.createdAt.toISOString(),
      href: `/admin/join-requests/${row.id}`,
    })),
    ...pujas.map((row) => ({ kind: 'puja' as const, text: `E-Puja booked: ${row.pujaName}`, at: row.createdAt.toISOString(), href: '/admin/puja-bookings' })),
    ...orders.map((row) => ({ kind: 'order' as const, text: `Order placed: ${row.productName}`, at: row.createdAt.toISOString(), href: '/admin/ayurveda-orders' })),
    ...calls.map((row) => ({
      kind: 'call' as const,
      text: `Consultation with ${row.astrologer.displayName} completed (${row.totalMinutes} min)`,
      at: row.updatedAt.toISOString(),
      href: null,
    })),
    ...audits.map((row) => ({ kind: 'audit' as const, text: row.summary, at: row.createdAt.toISOString(), href: '/admin/audit' })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}
