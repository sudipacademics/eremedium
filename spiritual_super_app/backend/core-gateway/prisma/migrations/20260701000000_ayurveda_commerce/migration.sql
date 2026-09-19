-- Ayurveda commerce: priced product catalog and wallet-paid order fulfilment.
--
-- Mirrors the E-Puja pattern. The client never supplies a price; orders snapshot sku/name/amount
-- from `ayurveda_products` at purchase time. `AYURVEDA_ORDER` on the wallet ledger was reserved from
-- day one and is now the debit reference for these rows.

CREATE TYPE "AyurvedaOrderStatus" AS ENUM ('CONFIRMED', 'PACKED', 'DISPATCHED');

CREATE TABLE "ayurveda_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "price" DECIMAL(12,2) NOT NULL,
    "suited_doshas" "Dosha"[] NOT NULL DEFAULT ARRAY[]::"Dosha"[],
    "form_factor" VARCHAR(40) NOT NULL DEFAULT 'kit',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ayurveda_products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ayurveda_products_price_positive" CHECK ("price" > 0)
);

CREATE UNIQUE INDEX "ayurveda_products_sku_key" ON "ayurveda_products"("sku");
CREATE INDEX "ayurveda_products_active_price_idx" ON "ayurveda_products"("active", "price");

CREATE TABLE "ayurveda_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "product_id" UUID,
    "product_sku" VARCHAR(80) NOT NULL,
    "product_name" VARCHAR(160) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "status" "AyurvedaOrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "shipping_name" VARCHAR(160) NOT NULL,
    "shipping_phone" VARCHAR(20) NOT NULL,
    "shipping_address" VARCHAR(500) NOT NULL,
    "packed_at" TIMESTAMPTZ(3),
    "awb" VARCHAR(80),
    "courier" VARCHAR(80),
    "dispatched_at" TIMESTAMPTZ(3),
    "idempotency_key" VARCHAR(160),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ayurveda_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ayurveda_orders_dispatched_needs_awb"
      CHECK ("status" <> 'DISPATCHED' OR ("awb" IS NOT NULL AND "dispatched_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "ayurveda_orders_idempotency_key_key" ON "ayurveda_orders"("idempotency_key");
CREATE INDEX "ayurveda_orders_user_id_created_at_idx" ON "ayurveda_orders"("user_id", "created_at");
CREATE INDEX "ayurveda_orders_status_created_at_idx" ON "ayurveda_orders"("status", "created_at");

ALTER TABLE "ayurveda_orders"
    ADD CONSTRAINT "ayurveda_orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ayurveda_orders"
    ADD CONSTRAINT "ayurveda_orders_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "ayurveda_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
