import { StaffRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppRole } from '../src/auth/jwt.js';
import { prisma } from '../src/lib/prisma.js';
import { seedStaff, seedUser } from './helpers/factories.js';

const { buildApp } = await import('../src/app.js');
const { signAccessToken } = await import('../src/auth/jwt.js');

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function staffToken(role: StaffRole): Promise<string> {
  const user = await seedUser('0.00', `Staff ${role}`);
  await seedStaff(user.userId, role);
  return signAccessToken({ sub: user.userId, role: AppRole.ADMIN, phone: user.phone });
}

async function seedSales() {
  const buyer = await prisma.user.create({
    data: { phone: `+9198${Date.now().toString().slice(-8)}`, name: 'Asha', birthPlace: 'Salt Lake, Kolkata, West Bengal, India' },
    select: { id: true },
  });
  const temple = await prisma.temple.create({
    data: { name: `Temple ${randomUUID().slice(0, 8)}`, location: 'Ujjain', primaryDeity: 'Shiva' },
    select: { id: true },
  });
  await prisma.pujaBooking.create({
    data: { userId: buyer.id, templeId: temple.id, pujaName: 'Rudrabhishek', sankalpName: 'Asha', packagePrice: '2100.00' },
  });
  const crystal = await prisma.ayurvedaProduct.create({
    data: { sku: `crystal-${randomUUID().slice(0, 8)}`, name: 'Amethyst', price: '1299.00', category: 'CRYSTAL' },
    select: { id: true },
  });
  await prisma.ayurvedaOrder.create({
    data: {
      userId: buyer.id,
      productId: crystal.id,
      productSku: 'amethyst',
      productName: 'Amethyst',
      unitPrice: '1299.00',
      shippingName: 'Asha',
      shippingPhone: '+919800000000',
      shippingAddress: 'Kolkata',
    },
  });
}

describe('GET /api/v1/admin/dashboard', () => {
  it('returns KPIs, revenue by service, growth, locations and activity for a Super Admin', async () => {
    await seedSales();
    const token = await staffToken(StaffRole.SUPER_ADMIN);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard?period=year&growthMonths=12',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.periodLabel).toBe('This year');
    expect(body.kpis.pujaBookings.total).toBeGreaterThanOrEqual(1);
    expect(body.kpis.revenue.total).toBeGreaterThanOrEqual(3399);
    const services = Object.fromEntries(body.serviceRevenue.items.map((item: { key: string; amount: number }) => [item.key, item.amount]));
    expect(services.epuja).toBeGreaterThanOrEqual(2100);
    expect(services.crystals).toBeGreaterThanOrEqual(1299);
    expect(body.revenueTrend.months).toHaveLength(12);
    expect(body.userGrowth).toHaveLength(12);
    expect(body.userGrowth.at(-1).total).toBe(await prisma.user.count());
    expect(body.topLocations.items.map((item: { label: string }) => item.label)).toContain('West Bengal');
    expect(body.latestOrders[0]).toMatchObject({ productName: 'Amethyst', amount: 1299, statusLabel: 'Confirmed' });
    expect(body.topServices.map((item: { label: string }) => item.label)).toEqual(expect.arrayContaining(['Rudrabhishek', 'Amethyst']));
    expect(body.recentActivity.length).toBeGreaterThan(0);
  });

  it('hides money and customer lists from a content manager', async () => {
    const token = await staffToken(StaffRole.CONTENT_MANAGER);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kpis.revenue).toBeNull();
    expect(body.serviceRevenue).toBeNull();
    expect(body.revenueTrend).toBeNull();
    expect(body.latestOrders).toEqual([]);
    expect(body.recentConsultations).toEqual([]);
    expect(body.latestJoinRequests).toEqual([]);
  });

  it('refuses non-staff and rejects unknown periods', async () => {
    const user = await seedUser();
    const userToken = signAccessToken({ sub: user.userId, role: AppRole.USER, phone: user.phone });
    const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: { authorization: `Bearer ${userToken}` } });
    expect(denied.statusCode).toBe(403);

    const token = await staffToken(StaffRole.ADMIN);
    const bad = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard?period=decade', headers: { authorization: `Bearer ${token}` } });
    expect(bad.statusCode).toBe(400);
  });

  it('includes the pending join-request badge in admin/me', async () => {
    const token = await staffToken(StaffRole.MANAGER);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Staff MANAGER', roleLabel: expect.any(String), badges: { joinRequestsPending: expect.any(Number) } });
  });
});
