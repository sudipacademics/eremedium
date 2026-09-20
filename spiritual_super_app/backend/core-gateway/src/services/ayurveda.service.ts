import { AyurvedaOrderStatus, Dosha, ReferenceType } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { Prisma, money, prisma } from '../lib/prisma.js';
import { hub } from '../ws/hub.js';
import { ServerEvent } from '../ws/protocol.js';
import { WalletService } from './wallet.service.js';

export class AyurvedaError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'AyurvedaError';
    this.statusCode = statusCode;
  }
}

export interface ProductView {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly price: string;
  readonly suitedDoshas: readonly Dosha[];
  readonly formFactor: string;
  readonly active?: boolean;
}

export interface OrderView {
  readonly id: string;
  readonly status: AyurvedaOrderStatus;
  readonly productId: string | null;
  readonly productSku: string;
  readonly productName: string;
  readonly unitPrice: string;
  readonly shippingName: string;
  readonly shippingPhone: string;
  readonly shippingAddress: string;
  readonly packedAt: string | null;
  readonly awb: string | null;
  readonly courier: string | null;
  readonly dispatchedAt: string | null;
  readonly createdAt: string;
}

export interface OrderResult {
  readonly order: OrderView;
  readonly amountDebited: string;
  readonly walletBalanceAfter: string;
}

function toOrderView(row: {
  id: string;
  status: AyurvedaOrderStatus;
  productId: string | null;
  productSku: string;
  productName: string;
  unitPrice: Prisma.Decimal;
  shippingName: string;
  shippingPhone: string;
  shippingAddress: string;
  packedAt: Date | null;
  awb: string | null;
  courier: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
}): OrderView {
  return {
    id: row.id,
    status: row.status,
    productId: row.productId,
    productSku: row.productSku,
    productName: row.productName,
    unitPrice: money(row.unitPrice).toFixed(2),
    shippingName: row.shippingName,
    shippingPhone: row.shippingPhone,
    shippingAddress: row.shippingAddress,
    packedAt: row.packedAt?.toISOString() ?? null,
    awb: row.awb,
    courier: row.courier,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const ALLOWED_TRANSITIONS: Readonly<Record<AyurvedaOrderStatus, readonly AyurvedaOrderStatus[]>> = {
  [AyurvedaOrderStatus.CONFIRMED]: [AyurvedaOrderStatus.PACKED],
  [AyurvedaOrderStatus.PACKED]: [AyurvedaOrderStatus.DISPATCHED],
  [AyurvedaOrderStatus.DISPATCHED]: [],
};

export interface PlaceOrderInput {
  readonly userId: string;
  readonly productId: string;
  readonly shippingName: string;
  readonly shippingPhone: string;
  readonly shippingAddress: string;
  readonly idempotencyKey: string;
}

export const AyurvedaService = {
  async listProducts(dosha?: Dosha): Promise<ProductView[]> {
    const products = await prisma.ayurvedaProduct.findMany({
      where: {
        active: true,
        ...(dosha === undefined ? {} : { suitedDoshas: { has: dosha } }),
      },
      orderBy: { price: 'asc' },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        price: true,
        suitedDoshas: true,
        formFactor: true,
      },
    });

    return products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      price: money(product.price).toFixed(2),
      suitedDoshas: product.suitedDoshas,
      formFactor: product.formFactor,
    }));
  },

  /** Admin catalog: includes inactive SKUs. */
  async listProductsAdmin(): Promise<Array<ProductView & { active: boolean }>> {
    const products = await prisma.ayurvedaProduct.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      price: money(product.price).toFixed(2),
      suitedDoshas: product.suitedDoshas,
      formFactor: product.formFactor,
      active: product.active,
    }));
  },

  async createProduct(input: {
    readonly sku: string;
    readonly name: string;
    readonly description?: string | null;
    readonly price: string;
    readonly suitedDoshas: readonly Dosha[];
    readonly formFactor: string;
    readonly active?: boolean;
  }): Promise<ProductView & { active: boolean }> {
    const price = money(input.price);
    if (price.lessThanOrEqualTo(0)) {
      throw new AyurvedaError('price must be greater than zero', 400);
    }
    try {
      const product = await prisma.ayurvedaProduct.create({
        data: {
          sku: input.sku.trim().toLowerCase(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          price,
          suitedDoshas: [...input.suitedDoshas],
          formFactor: input.formFactor.trim() || 'kit',
          active: input.active !== false,
        },
      });
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        price: money(product.price).toFixed(2),
        suitedDoshas: product.suitedDoshas,
        formFactor: product.formFactor,
        active: product.active,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new AyurvedaError('SKU already exists', 409);
      }
      throw error;
    }
  },

  async updateProduct(
    productId: string,
    input: {
      readonly name?: string;
      readonly description?: string | null;
      readonly price?: string;
      readonly suitedDoshas?: readonly Dosha[];
      readonly formFactor?: string;
      readonly active?: boolean;
    },
  ): Promise<ProductView & { active: boolean }> {
    const existing = await prisma.ayurvedaProduct.findUnique({ where: { id: productId } });
    if (!existing) {
      throw new AyurvedaError('Product not found', 404);
    }
    if (input.price !== undefined && money(input.price).lessThanOrEqualTo(0)) {
      throw new AyurvedaError('price must be greater than zero', 400);
    }
    const product = await prisma.ayurvedaProduct.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.price !== undefined ? { price: money(input.price) } : {}),
        ...(input.suitedDoshas !== undefined ? { suitedDoshas: [...input.suitedDoshas] } : {}),
        ...(input.formFactor !== undefined ? { formFactor: input.formFactor.trim() } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      price: money(product.price).toFixed(2),
      suitedDoshas: product.suitedDoshas,
      formFactor: product.formFactor,
      active: product.active,
    };
  },

  async requireActiveProduct(productId: string) {
    const product = await prisma.ayurvedaProduct.findUnique({
      where: { id: productId },
      select: {
        id: true,
        sku: true,
        name: true,
        price: true,
        active: true,
        suitedDoshas: true,
        formFactor: true,
      },
    });
    if (!product) {
      throw new AyurvedaError(`Product ${productId} not found`, 404);
    }
    if (!product.active) {
      throw new AyurvedaError('This product is no longer available');
    }
    return product;
  },

  /**
   * Places an order and pays for it in one transaction.
   *
   * Price comes only from the catalog row. A retried request with the same idempotency key returns
   * the original order instead of buying twice.
   */
  async placeOrder(input: PlaceOrderInput): Promise<OrderResult> {
    const replay = await prisma.ayurvedaOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) {
      if (replay.userId !== input.userId) {
        throw new AyurvedaError('Idempotency key already used by another account');
      }
      logger.warn({ orderId: replay.id }, 'Replayed Ayurveda order ignored');
      const balance = await WalletService.getBalanceByUserId(input.userId);
      return {
        order: toOrderView(replay),
        amountDebited: money(replay.unitPrice).toFixed(2),
        walletBalanceAfter: balance.balance.toFixed(2),
      };
    }

    const product = await this.requireActiveProduct(input.productId);
    const price = money(product.price);

    const { order, debit } = await prisma.$transaction(
      async (tx) => {
        const created = await tx.ayurvedaOrder.create({
          data: {
            userId: input.userId,
            productId: product.id,
            productSku: product.sku,
            productName: product.name,
            unitPrice: price,
            status: AyurvedaOrderStatus.CONFIRMED,
            shippingName: input.shippingName.trim(),
            shippingPhone: input.shippingPhone.trim(),
            shippingAddress: input.shippingAddress.trim(),
            idempotencyKey: input.idempotencyKey,
          },
        });

        const movement = await WalletService.debitByUserId(
          input.userId,
          {
            amount: price,
            referenceType: ReferenceType.AYURVEDA_ORDER,
            referenceId: created.id,
            idempotencyKey: `ayurveda:${input.idempotencyKey}`,
          },
          tx,
        );

        return { order: created, debit: movement };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
    );

    logger.info(
      {
        orderId: order.id,
        userId: input.userId,
        productId: product.id,
        amount: price.toFixed(2),
        balanceAfter: debit.balanceAfter.toFixed(2),
      },
      'Ayurveda order placed',
    );

    return {
      order: toOrderView(order),
      amountDebited: price.toFixed(2),
      walletBalanceAfter: debit.balanceAfter.toFixed(2),
    };
  },

  async listOrdersForUser(userId: string): Promise<OrderView[]> {
    const rows = await prisma.ayurvedaOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toOrderView);
  },

  async getOrderForUser(orderId: string, userId: string): Promise<OrderView> {
    const row = await prisma.ayurvedaOrder.findUnique({ where: { id: orderId } });
    if (!row || row.userId !== userId) {
      throw new AyurvedaError('Order not found', 404);
    }
    return toOrderView(row);
  },

  async listPendingFulfilment(): Promise<OrderView[]> {
    const rows = await prisma.ayurvedaOrder.findMany({
      where: { status: { in: [AyurvedaOrderStatus.CONFIRMED, AyurvedaOrderStatus.PACKED] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toOrderView);
  },

  async advanceStatus(
    orderId: string,
    next: AyurvedaOrderStatus,
    extras: { awb?: string; courier?: string } = {},
  ): Promise<OrderView> {
    const row = await prisma.ayurvedaOrder.findUnique({ where: { id: orderId } });
    if (!row) {
      throw new AyurvedaError('Order not found', 404);
    }

    const allowed = ALLOWED_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(next)) {
      throw new AyurvedaError(`Cannot move from ${row.status} to ${next}`);
    }

    if (next === AyurvedaOrderStatus.DISPATCHED) {
      if (!extras.awb?.trim()) {
        throw new AyurvedaError('Dispatch needs an AWB / tracking number', 400);
      }
    }

    const updated = await prisma.ayurvedaOrder.update({
      where: { id: orderId },
      data: {
        status: next,
        ...(next === AyurvedaOrderStatus.PACKED ? { packedAt: new Date() } : {}),
        ...(next === AyurvedaOrderStatus.DISPATCHED
          ? {
              awb: extras.awb!.trim(),
              courier: extras.courier?.trim() || null,
              dispatchedAt: new Date(),
            }
          : {}),
      },
    });

    const view = toOrderView(updated);
    await hub.emitToUser(row.userId, ServerEvent.AYURVEDA_ORDER_UPDATED, view);
    return view;
  },
};
