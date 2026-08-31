-- Sprint 2: gateway-verified wallet top-ups.
--
-- Money may only enter a wallet when a signed provider webhook marks a row here PAID. The unique
-- constraints on provider ids are the last line of defence against a replayed webhook crediting a
-- wallet twice, independent of any application-level idempotency.

CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY');
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'PAID', 'FAILED');

CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "provider_order_id" VARCHAR(120) NOT NULL,
    "provider_payment_id" VARCHAR(120),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "wallet_transaction_id" UUID,
    "failure_reason" VARCHAR(300),
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
    -- A top-up can never be for zero or a negative amount.
    CONSTRAINT "payment_orders_amount_positive" CHECK ("amount" > 0),
    -- A PAID row must always carry the payment id it was credited against, so the audit trail
    -- cannot contain a completed payment of unknown origin.
    CONSTRAINT "payment_orders_paid_requires_payment_id" CHECK (
        "status" <> 'PAID' OR "provider_payment_id" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "payment_orders_provider_order_id_key" ON "payment_orders"("provider_order_id");
CREATE UNIQUE INDEX "payment_orders_provider_payment_id_key" ON "payment_orders"("provider_payment_id");
CREATE UNIQUE INDEX "payment_orders_wallet_transaction_id_key" ON "payment_orders"("wallet_transaction_id");
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id", "created_at");
CREATE INDEX "payment_orders_status_idx" ON "payment_orders"("status");

ALTER TABLE "payment_orders"
    ADD CONSTRAINT "payment_orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
