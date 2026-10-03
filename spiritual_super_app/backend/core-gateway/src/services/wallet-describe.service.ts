import { ReferenceType } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import {
  describeTransaction,
  type DescribableTransaction,
  type TransactionDescription,
  type TransactionLookups,
} from './wallet-describe-rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsOf(rows: readonly DescribableTransaction[], kind: ReferenceType): string[] {
  return [...new Set(rows.filter((row) => row.referenceType === kind && UUID.test(row.referenceId)).map((row) => row.referenceId))];
}

/** Labels a page of ledger rows with three batched lookups, scoped to the owner's own records. */
export async function describeTransactions(
  userId: string,
  rows: readonly DescribableTransaction[],
): Promise<TransactionDescription[]> {
  const [calls, pujas, orders] = await Promise.all([
    prisma.callSession.findMany({
      where: { userId, id: { in: idsOf(rows, ReferenceType.CALL_SESSION) } },
      select: { id: true, astrologer: { select: { displayName: true, expertise: true } } },
    }),
    prisma.pujaBooking.findMany({
      where: { userId, id: { in: idsOf(rows, ReferenceType.PUJA_BOOKING) } },
      select: { id: true, pujaName: true },
    }),
    prisma.ayurvedaOrder.findMany({
      where: { userId, id: { in: idsOf(rows, ReferenceType.AYURVEDA_ORDER) } },
      select: { id: true, productName: true },
    }),
  ]);
  const lookups: TransactionLookups = {
    calls: new Map(calls.map((c) => [c.id, { astrologer: c.astrologer.displayName, expertise: c.astrologer.expertise[0] ?? null }])),
    pujas: new Map(pujas.map((p) => [p.id, p.pujaName])),
    orders: new Map(orders.map((o) => [o.id, o.productName])),
  };
  return rows.map((row) => describeTransaction(row, lookups));
}
