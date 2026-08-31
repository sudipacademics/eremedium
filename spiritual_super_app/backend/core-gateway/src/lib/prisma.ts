import { Prisma, PrismaClient } from '@prisma/client';

import { env } from '../config/env.js';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
  log:
    env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'warn' }]
      : [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
});

export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Money helper: every monetary value in this codebase is a Prisma.Decimal, never a JS number. */
export function money(value: string | number | Prisma.Decimal): Prisma.Decimal {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function isDecimalZeroOrLess(value: Prisma.Decimal): boolean {
  return value.lessThanOrEqualTo(0);
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Prisma disconnected');
}

export { Prisma };
