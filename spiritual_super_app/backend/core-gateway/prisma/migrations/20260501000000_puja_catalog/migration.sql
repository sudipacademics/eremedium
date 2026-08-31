-- E-Puja: a priced catalog, and a fulfilment trail for what the devotee was promised.
--
-- Before this, the price of a puja was whatever the caller put in the request body. The astrologer's
-- in-call remedy card carried its own `package_price`, so the amount charged was decided by a client
-- rather than by the platform, and the booking did not even record WHICH puja had been bought.
-- Bookings now price themselves from `puja_offerings` and snapshot the name they were sold under.

CREATE TABLE "puja_offerings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "temple_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "price" DECIMAL(12,2) NOT NULL,
    "duration_label" VARCHAR(60),
    "prasad_included" VARCHAR(300),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "puja_offerings_pkey" PRIMARY KEY ("id"),
    -- A free or negative puja is never a real catalog entry, and it would debit nothing while
    -- promising a fulfilment the temple has not been paid for.
    CONSTRAINT "puja_offerings_price_positive" CHECK ("price" > 0)
);

CREATE UNIQUE INDEX "puja_offerings_temple_id_name_key" ON "puja_offerings"("temple_id", "name");
CREATE INDEX "puja_offerings_temple_id_active_idx" ON "puja_offerings"("temple_id", "active");

ALTER TABLE "puja_offerings"
    ADD CONSTRAINT "puja_offerings_temple_id_fkey"
    FOREIGN KEY ("temple_id") REFERENCES "temples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "temples" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "temples_active_idx" ON "temples"("active");

-- Existing rows predate the catalog, so the offering link is nullable. The name is not: every
-- booking must say what was bought, and the pre-catalog rows get a truthful placeholder.
ALTER TABLE "puja_bookings"
    ADD COLUMN "puja_offering_id" UUID,
    ADD COLUMN "puja_name" VARCHAR(160) NOT NULL DEFAULT 'Puja',
    ADD COLUMN "scheduled_for" TIMESTAMPTZ(3),
    ADD COLUMN "performed_at" TIMESTAMPTZ(3),
    ADD COLUMN "prasad_courier" VARCHAR(80),
    ADD COLUMN "prasad_dispatched_at" TIMESTAMPTZ(3),
    ADD COLUMN "idempotency_key" VARCHAR(160);

-- A double-tapped confirm button must not buy the same puja twice. The wallet's own idempotency key
-- stops the second debit, which alone would leave a free booking behind, so the booking needs its
-- own guard in the database rather than in application logic.
CREATE UNIQUE INDEX "puja_bookings_idempotency_key_key" ON "puja_bookings"("idempotency_key");

-- The default existed only to backfill; new rows must state the puja explicitly.
ALTER TABLE "puja_bookings" ALTER COLUMN "puja_name" DROP DEFAULT;

CREATE INDEX "puja_bookings_status_created_at_idx" ON "puja_bookings"("status", "created_at");

ALTER TABLE "puja_bookings"
    ADD CONSTRAINT "puja_bookings_puja_offering_id_fkey"
    FOREIGN KEY ("puja_offering_id") REFERENCES "puja_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fulfilment claims must be backed by evidence: a booking cannot be marked COMPLETED without proof
-- the puja was performed, nor PRASAD_DISPATCHED without a tracking number to give the devotee.
ALTER TABLE "puja_bookings"
    ADD CONSTRAINT "puja_bookings_completed_needs_proof"
    CHECK ("status" <> 'COMPLETED' OR ("video_proof_url" IS NOT NULL AND "performed_at" IS NOT NULL));

ALTER TABLE "puja_bookings"
    ADD CONSTRAINT "puja_bookings_dispatched_needs_awb"
    CHECK ("status" <> 'PRASAD_DISPATCHED' OR ("prasad_awb" IS NOT NULL AND "prasad_dispatched_at" IS NOT NULL));
