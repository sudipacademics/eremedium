-- Sprint 1: foundational schema for the Spiritual-Tech Super App.
-- Money is always numeric(12,2); wallet balance can never go negative.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums -----------------------------------------------------------------------
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "ReferenceType" AS ENUM ('CALL_SESSION', 'PUJA_BOOKING', 'AYURVEDA_ORDER', 'RECHARGE');
CREATE TYPE "AstrologerStatus" AS ENUM ('OFFLINE', 'IDLE', 'BUSY', 'IN_CALL');
CREATE TYPE "CallSessionStatus" AS ENUM ('INITIATED', 'ACTIVE', 'COMPLETED', 'DROPPED_INSUFFICIENT_FUNDS');
CREATE TYPE "PujaBookingStatus" AS ENUM ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'PRASAD_DISPATCHED');
CREATE TYPE "Dosha" AS ENUM ('VATA', 'PITTA', 'KAPHA', 'TRIDOSHIC');

-- Users -----------------------------------------------------------------------
CREATE TABLE "users" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "phone"       VARCHAR(20)  NOT NULL,
    "name"        VARCHAR(160) NOT NULL,
    "dob"         TIMESTAMPTZ(3),
    "birth_place" VARCHAR(180),
    "latitude"    DECIMAL(9,6),
    "longitude"   DECIMAL(9,6),
    "gotra"       VARCHAR(120),
    "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_latitude_range_check"  CHECK ("latitude"  IS NULL OR ("latitude"  BETWEEN -90  AND 90)),
    CONSTRAINT "users_longitude_range_check" CHECK ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180))
);
CREATE UNIQUE INDEX "users_phone_key" ON "users" ("phone");

-- Wallets ---------------------------------------------------------------------
CREATE TABLE "wallets" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID           NOT NULL,
    "balance"    DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    "currency"   CHAR(3)        NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallets_balance_non_negative_check" CHECK ("balance" >= 0)
);
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets" ("user_id");
ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wallet ledger ---------------------------------------------------------------
CREATE TABLE "wallet_transactions" (
    "id"              UUID              NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id"       UUID              NOT NULL,
    "amount"          DECIMAL(12,2)     NOT NULL,
    "type"            "TransactionType" NOT NULL,
    "reference_type"  "ReferenceType"   NOT NULL,
    "reference_id"    VARCHAR(120)      NOT NULL,
    "balance_after"   DECIMAL(12,2)     NOT NULL,
    "idempotency_key" VARCHAR(160),
    "created_at"      TIMESTAMPTZ(3)    NOT NULL DEFAULT now(),
    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_transactions_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "wallet_transactions_balance_after_check"   CHECK ("balance_after" >= 0)
);
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "wallet_transactions" ("idempotency_key");
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions" ("wallet_id", "created_at");
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions" ("reference_type", "reference_id");
ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id")
    REFERENCES "wallets" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Astrologers -----------------------------------------------------------------
CREATE TABLE "astrologers" (
    "id"               UUID               NOT NULL DEFAULT gen_random_uuid(),
    "user_id"          UUID               NOT NULL,
    "display_name"     VARCHAR(160)       NOT NULL,
    "per_minute_rate"  DECIMAL(12,2)      NOT NULL,
    "commission_split" DECIMAL(5,4)       NOT NULL DEFAULT 0.5000,
    "status"           "AstrologerStatus" NOT NULL DEFAULT 'OFFLINE',
    "languages"        TEXT[]             NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at"       TIMESTAMPTZ(3)     NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ(3)     NOT NULL DEFAULT now(),
    CONSTRAINT "astrologers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "astrologers_rate_positive_check"     CHECK ("per_minute_rate" > 0),
    CONSTRAINT "astrologers_commission_range_check"  CHECK ("commission_split" >= 0 AND "commission_split" <= 1)
);
CREATE UNIQUE INDEX "astrologers_user_id_key" ON "astrologers" ("user_id");
CREATE INDEX "astrologers_status_idx" ON "astrologers" ("status");
ALTER TABLE "astrologers"
    ADD CONSTRAINT "astrologers_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Call sessions ---------------------------------------------------------------
CREATE TABLE "call_sessions" (
    "id"              UUID                NOT NULL DEFAULT gen_random_uuid(),
    "user_id"         UUID                NOT NULL,
    "astrologer_id"   UUID                NOT NULL,
    "channel_id"      VARCHAR(120)        NOT NULL,
    "rate_per_minute" DECIMAL(12,2)       NOT NULL,
    "start_time"      TIMESTAMPTZ(3),
    "end_time"        TIMESTAMPTZ(3),
    "total_minutes"   INTEGER             NOT NULL DEFAULT 0,
    "total_deducted"  DECIMAL(12,2)       NOT NULL DEFAULT 0.00,
    "status"          "CallSessionStatus" NOT NULL DEFAULT 'INITIATED',
    "created_at"      TIMESTAMPTZ(3)      NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(3)      NOT NULL DEFAULT now(),
    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "call_sessions_rate_positive_check"   CHECK ("rate_per_minute" > 0),
    CONSTRAINT "call_sessions_minutes_check"         CHECK ("total_minutes" >= 0),
    CONSTRAINT "call_sessions_deducted_check"        CHECK ("total_deducted" >= 0),
    CONSTRAINT "call_sessions_time_order_check"      CHECK ("end_time" IS NULL OR "start_time" IS NULL OR "end_time" >= "start_time")
);
CREATE UNIQUE INDEX "call_sessions_channel_id_key" ON "call_sessions" ("channel_id");
CREATE INDEX "call_sessions_user_id_created_at_idx" ON "call_sessions" ("user_id", "created_at");
CREATE INDEX "call_sessions_astrologer_id_created_at_idx" ON "call_sessions" ("astrologer_id", "created_at");
CREATE INDEX "call_sessions_status_idx" ON "call_sessions" ("status");
ALTER TABLE "call_sessions"
    ADD CONSTRAINT "call_sessions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "call_sessions"
    ADD CONSTRAINT "call_sessions_astrologer_id_fkey" FOREIGN KEY ("astrologer_id")
    REFERENCES "astrologers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Temples ---------------------------------------------------------------------
CREATE TABLE "temples" (
    "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
    "name"            VARCHAR(180)   NOT NULL,
    "location"        VARCHAR(180)   NOT NULL,
    "primary_deity"   VARCHAR(120)   NOT NULL,
    "live_stream_url" VARCHAR(500),
    "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT "temples_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "temples_name_location_key" ON "temples" ("name", "location");

-- Puja bookings ---------------------------------------------------------------
CREATE TABLE "puja_bookings" (
    "id"                        UUID                NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                   UUID                NOT NULL,
    "temple_id"                 UUID                NOT NULL,
    "referred_by_astrologer_id" UUID,
    "sankalp_name"              VARCHAR(160)        NOT NULL,
    "sankalp_gotra"             VARCHAR(120),
    "sankalp_wish"              VARCHAR(1000),
    "package_price"             DECIMAL(12,2)       NOT NULL,
    "status"                    "PujaBookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "video_proof_url"           VARCHAR(500),
    "prasad_awb"                VARCHAR(80),
    "created_at"                TIMESTAMPTZ(3)      NOT NULL DEFAULT now(),
    "updated_at"                TIMESTAMPTZ(3)      NOT NULL DEFAULT now(),
    CONSTRAINT "puja_bookings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "puja_bookings_price_positive_check" CHECK ("package_price" > 0)
);
CREATE INDEX "puja_bookings_user_id_created_at_idx" ON "puja_bookings" ("user_id", "created_at");
CREATE INDEX "puja_bookings_temple_id_status_idx" ON "puja_bookings" ("temple_id", "status");
ALTER TABLE "puja_bookings"
    ADD CONSTRAINT "puja_bookings_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "puja_bookings"
    ADD CONSTRAINT "puja_bookings_temple_id_fkey" FOREIGN KEY ("temple_id")
    REFERENCES "temples" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "puja_bookings"
    ADD CONSTRAINT "puja_bookings_referred_by_astrologer_id_fkey" FOREIGN KEY ("referred_by_astrologer_id")
    REFERENCES "astrologers" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ayurvedic profiles ----------------------------------------------------------
CREATE TABLE "ayurvedic_profiles" (
    "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
    "user_id"          UUID           NOT NULL,
    "prakriti_primary" "Dosha"        NOT NULL,
    "vikriti_current"  "Dosha",
    "dominant_guna"    VARCHAR(40),
    "digestive_fire"   VARCHAR(40),
    "vata_score"       DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
    "pitta_score"      DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
    "kapha_score"      DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
    "created_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT "ayurvedic_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ayurvedic_profiles_score_range_check" CHECK (
        "vata_score"  BETWEEN 0 AND 100 AND
        "pitta_score" BETWEEN 0 AND 100 AND
        "kapha_score" BETWEEN 0 AND 100
    )
);
CREATE INDEX "ayurvedic_profiles_user_id_created_at_idx" ON "ayurvedic_profiles" ("user_id", "created_at");
ALTER TABLE "ayurvedic_profiles"
    ADD CONSTRAINT "ayurvedic_profiles_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
