-- Kundali: capture birth data properly, and cache the charts computed from it.
--
-- `users.dob`, `latitude` and `longitude` have existed since the initial migration and no code path
-- ever wrote them: there was no way for anyone to enter their birth details, so the Swiss Ephemeris
-- service had no consumer. Storing only a UTC instant is also not enough on its own -- the offset is
-- not recoverable from an instant, so the app could never show a person the time they were born, nor
-- recompute the chart if the zone turned out to be wrong.

ALTER TABLE "users"
    ADD COLUMN "birth_date_local" DATE,
    ADD COLUMN "birth_time_local" VARCHAR(5),
    ADD COLUMN "birth_timezone" VARCHAR(64),
    ADD COLUMN "birth_time_known" BOOLEAN NOT NULL DEFAULT false;

-- A birth time is "HH:mm" in the birthplace's own zone. Rejected in the database as well as in zod
-- because a malformed value here silently becomes the wrong ascendant rather than an error.
ALTER TABLE "users"
    ADD CONSTRAINT "users_birth_time_local_format"
    CHECK ("birth_time_local" IS NULL OR "birth_time_local" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- A local date and time cannot be turned into an instant without the zone, so the three travel
-- together or not at all.
ALTER TABLE "users"
    ADD CONSTRAINT "users_birth_locality_complete"
    CHECK (
        ("birth_date_local" IS NULL AND "birth_timezone" IS NULL)
        OR ("birth_date_local" IS NOT NULL AND "birth_timezone" IS NOT NULL)
    );

-- Claiming the birth time is known while storing none would put a precise-looking ascendant in front
-- of a user who never supplied a time.
ALTER TABLE "users"
    ADD CONSTRAINT "users_birth_time_known_needs_time"
    CHECK ("birth_time_known" = false OR "birth_time_local" IS NOT NULL);

CREATE TABLE "natal_charts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fingerprint" VARCHAR(64) NOT NULL,
    "birth_instant" TIMESTAMPTZ(3) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "engine_revision" VARCHAR(60) NOT NULL,
    "ayanamsha" DECIMAL(9,6) NOT NULL,
    "chart" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "natal_charts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "natal_charts_latitude_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
    CONSTRAINT "natal_charts_longitude_range" CHECK ("longitude" >= -180 AND "longitude" <= 180)
);

-- The cache key. A chart is a pure function of its inputs and the engine's conventions, so a row can
-- never go stale and needs no expiry; a change of ayanamsha or house system produces a different
-- fingerprint instead of quietly reusing numbers computed under the old convention.
CREATE UNIQUE INDEX "natal_charts_fingerprint_key" ON "natal_charts"("fingerprint");
CREATE INDEX "natal_charts_birth_instant_idx" ON "natal_charts"("birth_instant");
