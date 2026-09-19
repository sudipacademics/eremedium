import { AyurvedaOrderStatus, ReferenceType } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../src/auth/jwt.js';
import { prisma } from '../src/lib/prisma.js';
import { balanceOf, seedUser } from './helpers/factories.js';

vi.mock('../src/services/livekit.service.js', () => ({
  LiveKitTokenService: {
    countParticipants: vi.fn().mockResolvedValue(2),
    closeRoom: vi.fn().mockResolvedValue(undefined),
    publishRoomData: vi.fn().mockResolvedValue(undefined),
    removeUserFromRoom: vi.fn().mockResolvedValue(undefined),
    mintUserToken: vi.fn(),
    mintAstrologerToken: vi.fn(),
  },
}));

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

function tokenFor(userId: string, role: AppRole = AppRole.USER): string {
  return signAccessToken({
    sub: userId,
    role,
    phone: '+919000000001',
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedProduct(price = '899.00', sku = `sku-${randomUUID().slice(0, 8)}`) {
  return prisma.ayurvedaProduct.create({
    data: {
      sku,
      name: 'Vata Balance Kit',
      description: 'Warming kit',
      price,
      suitedDoshas: ['VATA'],
      formFactor: 'kit',
    },
    select: { id: true, sku: true, price: true },
  });
}

describe('GET /api/v1/ayurveda/shop/products', () => {
  it('requires a signed-in user', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/ayurveda/shop/products' });
    expect(response.statusCode).toBe(401);
  });

  it('returns catalog prices as fixed decimal strings', async () => {
    const { userId } = await seedUser('0.00');
    await seedProduct('899.00');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ayurveda/shop/products',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(200);
    const { products } = response.json() as { products: Array<{ price: string; sku: string }> };
    expect(products.some((p) => p.price === '899.00')).toBe(true);
  });

  it('filters by dosha when asked', async () => {
    const { userId } = await seedUser('0.00');
    await seedProduct('100.00', `vata-${randomUUID().slice(0, 6)}`);
    await prisma.ayurvedaProduct.create({
      data: {
        sku: `pitta-${randomUUID().slice(0, 6)}`,
        name: 'Pitta Cool Kit',
        price: '200.00',
        suitedDoshas: ['PITTA'],
        formFactor: 'kit',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ayurveda/shop/products?dosha=PITTA',
      headers: auth(tokenFor(userId)),
    });

    expect(response.statusCode).toBe(200);
    const { products } = response.json() as { products: Array<{ suitedDoshas: string[] }> };
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.suitedDoshas.includes('PITTA'))).toBe(true);
  });
});

describe('POST /api/v1/ayurveda/shop/orders', () => {
  const ship = {
    shippingName: 'Ananya Sharma',
    shippingPhone: '+919000000001',
    shippingAddress: '12 Assi Ghat Road, Varanasi, UP 221005',
  };

  it('debits the wallet from the catalog price, not a client amount', async () => {
    const { userId } = await seedUser('2000.00');
    const product = await seedProduct('899.00');
    const key = randomUUID();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ayurveda/shop/orders',
      headers: auth(tokenFor(userId)),
      payload: { productId: product.id, ...ship, idempotencyKey: key },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().amountDebited).toBe('899.00');
    expect(response.json().order.productSku).toBe(product.sku);
    expect(await balanceOf(userId)).toBe('1101.00');

    const ledger = await prisma.walletTransaction.findFirst({
      where: { referenceType: ReferenceType.AYURVEDA_ORDER, referenceId: response.json().order.id },
    });
    expect(ledger).not.toBeNull();
  });

  it('replays the same idempotency key without a second debit', async () => {
    const { userId } = await seedUser('2000.00');
    const product = await seedProduct('899.00');
    const key = randomUUID();
    const payload = { productId: product.id, ...ship, idempotencyKey: key };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/ayurveda/shop/orders',
      headers: auth(tokenFor(userId)),
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/ayurveda/shop/orders',
      headers: auth(tokenFor(userId)),
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().order.id).toBe(first.json().order.id);
    expect(await balanceOf(userId)).toBe('1101.00');
  });

  it('refuses when the wallet cannot cover the catalog price', async () => {
    const { userId } = await seedUser('10.00');
    const product = await seedProduct('899.00');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ayurveda/shop/orders',
      headers: auth(tokenFor(userId)),
      payload: { productId: product.id, ...ship, idempotencyKey: randomUUID() },
    });

    expect(response.statusCode).toBe(402);
    expect(await balanceOf(userId)).toBe('10.00');
  });
});

describe('admin fulfilment', () => {
  it('advances CONFIRMED → PACKED → DISPATCHED with an AWB', async () => {
    const { userId } = await seedUser('2000.00');
    const product = await seedProduct('249.00');
    const placed = await app.inject({
      method: 'POST',
      url: '/api/v1/ayurveda/shop/orders',
      headers: auth(tokenFor(userId)),
      payload: {
        productId: product.id,
        shippingName: 'Ananya',
        shippingPhone: '+919000000001',
        shippingAddress: '12 Assi Ghat Road, Varanasi',
        idempotencyKey: randomUUID(),
      },
    });
    const orderId = placed.json().order.id as string;

    const packed = await app.inject({
      method: 'POST',
      url: `/api/v1/ayurveda/shop/admin/orders/${orderId}/advance`,
      headers: auth(tokenFor(userId, AppRole.ADMIN)),
      payload: { status: AyurvedaOrderStatus.PACKED },
    });
    expect(packed.statusCode).toBe(200);
    expect(packed.json().status).toBe('PACKED');

    const dispatched = await app.inject({
      method: 'POST',
      url: `/api/v1/ayurveda/shop/admin/orders/${orderId}/advance`,
      headers: auth(tokenFor(userId, AppRole.ADMIN)),
      payload: { status: AyurvedaOrderStatus.DISPATCHED, awb: 'AWB123456', courier: 'Delhivery' },
    });
    expect(dispatched.statusCode).toBe(200);
    expect(dispatched.json().status).toBe('DISPATCHED');
    expect(dispatched.json().awb).toBe('AWB123456');
  });
});
