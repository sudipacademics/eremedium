-- Sprint 2: astrologers actually get paid.
--
-- `astrologers.commission_split` existed since the initial migration but no code read it, so every
-- billed minute charged the user and credited nobody. Each row here is written inside the same
-- transaction as the user's wallet debit, which is what keeps platform revenue plus astrologer
-- payable exactly equal to what the user was charged.

CREATE TABLE "astrologer_earnings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "astrologer_id" UUID NOT NULL,
    "call_session_id" UUID NOT NULL,
    "minute_number" INTEGER NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "platform_fee" DECIMAL(12,2) NOT NULL,
    "commission_split" DECIMAL(5,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "astrologer_earnings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "astrologer_earnings_gross_positive" CHECK ("gross_amount" > 0),
    CONSTRAINT "astrologer_earnings_shares_non_negative" CHECK ("net_amount" >= 0 AND "platform_fee" >= 0),
    -- The split must be exact to the paisa. Enforced in the database so no future code path can
    -- create money out of nothing or quietly lose a rounding remainder.
    CONSTRAINT "astrologer_earnings_split_balances" CHECK ("net_amount" + "platform_fee" = "gross_amount"),
    CONSTRAINT "astrologer_earnings_minute_positive" CHECK ("minute_number" > 0)
);

-- Replay guard: a retried billing tick for the same minute cannot pay an astrologer twice.
CREATE UNIQUE INDEX "astrologer_earnings_call_session_id_minute_number_key"
    ON "astrologer_earnings"("call_session_id", "minute_number");
CREATE INDEX "astrologer_earnings_astrologer_id_created_at_idx"
    ON "astrologer_earnings"("astrologer_id", "created_at");

ALTER TABLE "astrologer_earnings"
    ADD CONSTRAINT "astrologer_earnings_astrologer_id_fkey"
    FOREIGN KEY ("astrologer_id") REFERENCES "astrologers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "astrologer_earnings"
    ADD CONSTRAINT "astrologer_earnings_call_session_id_fkey"
    FOREIGN KEY ("call_session_id") REFERENCES "call_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
