-- Provider management: account lifecycle (suspend / deboard), KYC, services and schedule on the
-- provider, payout accounts and payouts (RazorpayX or manual records), and post-call reviews.

CREATE TYPE "ProviderAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEBOARDING', 'DEBOARDED');
CREATE TYPE "ProviderKycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "ProviderPayoutMethod" AS ENUM ('RAZORPAYX', 'MANUAL');
CREATE TYPE "ProviderPayoutStatus" AS ENUM ('PROCESSING', 'QUEUED', 'PENDING', 'PROCESSED', 'FAILED', 'REVERSED', 'CANCELLED', 'REJECTED');

ALTER TABLE "astrologers"
    ADD COLUMN "bio" VARCHAR(2000),
    ADD COLUMN "services" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "weekly_schedule" JSONB,
    ADD COLUMN "account_status" "ProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "suspended_at" TIMESTAMPTZ(3),
    ADD COLUMN "suspension_reason" VARCHAR(500),
    ADD COLUMN "deboard_reason" VARCHAR(120),
    ADD COLUMN "deboard_notes" VARCHAR(2000),
    ADD COLUMN "deboard_effective_at" TIMESTAMPTZ(3),
    ADD COLUMN "deboard_requested_at" TIMESTAMPTZ(3),
    ADD COLUMN "kyc_status" "ProviderKycStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "profile_approved" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "astrologers_account_status_idx" ON "astrologers"("account_status");

-- Services from the approved application carry over to the provider profile.
UPDATE "astrologers" a
SET "services" = j."services"
FROM "provider_join_requests" j
WHERE j."provider_astrologer_id" = a."id" AND cardinality(j."services") > 0;

-- Demo KYC states for existing providers (requested): providers approved through Join Requests are
-- verified; the rest alternate between verified and pending so the dashboard shows both.
WITH ranked AS (
    SELECT a."id",
           EXISTS (SELECT 1 FROM "provider_join_requests" j WHERE j."provider_astrologer_id" = a."id") AS via_join,
           row_number() OVER (ORDER BY a."created_at", a."id") AS n
    FROM "astrologers" a
)
UPDATE "astrologers" a
SET "kyc_status" = CASE WHEN r.via_join OR r.n % 3 <> 0 THEN 'VERIFIED'::"ProviderKycStatus" ELSE 'PENDING'::"ProviderKycStatus" END,
    "identity_verified" = (r.via_join OR r.n % 3 <> 0),
    "profile_approved" = true
FROM ranked r
WHERE r."id" = a."id";

CREATE TABLE "provider_payout_accounts" (
    "astrologer_id" UUID NOT NULL,
    "account_type" VARCHAR(8) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "account_number" VARCHAR(34),
    "ifsc" VARCHAR(11),
    "vpa" VARCHAR(100),
    "razorpay_contact_id" VARCHAR(40),
    "razorpay_fund_account_id" VARCHAR(40),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "provider_payout_accounts_pkey" PRIMARY KEY ("astrologer_id"),
    CONSTRAINT "provider_payout_accounts_type" CHECK (
        ("account_type" = 'BANK' AND "account_number" IS NOT NULL AND "ifsc" IS NOT NULL)
        OR ("account_type" = 'UPI' AND "vpa" IS NOT NULL)
    ),
    CONSTRAINT "provider_payout_accounts_astrologer_id_fkey" FOREIGN KEY ("astrologer_id") REFERENCES "astrologers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "provider_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "astrologer_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "ProviderPayoutMethod" NOT NULL,
    "status" "ProviderPayoutStatus" NOT NULL,
    "mode" VARCHAR(40),
    "razorpay_payout_id" VARCHAR(40),
    "reference" VARCHAR(120),
    "failure_reason" VARCHAR(500),
    "note" VARCHAR(500),
    "destination" VARCHAR(140),
    "created_by" UUID,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_payouts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_payouts_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "provider_payouts_astrologer_id_fkey" FOREIGN KEY ("astrologer_id") REFERENCES "astrologers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provider_payouts_razorpay_payout_id_key" ON "provider_payouts"("razorpay_payout_id");
CREATE INDEX "provider_payouts_astrologer_id_created_at_idx" ON "provider_payouts"("astrologer_id", "created_at");
CREATE INDEX "provider_payouts_status_processed_at_idx" ON "provider_payouts"("status", "processed_at");

CREATE TABLE "provider_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_session_id" UUID NOT NULL,
    "astrologer_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" VARCHAR(1000),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "provider_reviews_call_session_id_fkey" FOREIGN KEY ("call_session_id") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_reviews_astrologer_id_fkey" FOREIGN KEY ("astrologer_id") REFERENCES "astrologers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provider_reviews_call_session_id_key" ON "provider_reviews"("call_session_id");
CREATE INDEX "provider_reviews_astrologer_id_created_at_idx" ON "provider_reviews"("astrologer_id", "created_at");
