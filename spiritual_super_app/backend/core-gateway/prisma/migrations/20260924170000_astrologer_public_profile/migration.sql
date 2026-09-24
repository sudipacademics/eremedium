-- Public profile fields for the homepage astrologer carousel, managed from Admin → Astrologers.
-- The photo is a small admin-uploaded image kept apart from the user's private profile photo.

ALTER TABLE "astrologers"
    ADD COLUMN "photo_data_url" TEXT,
    ADD COLUMN "photo_updated_at" TIMESTAMPTZ(3),
    ADD COLUMN "expertise" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "experience_years" SMALLINT,
    ADD CONSTRAINT "astrologers_experience_years_range"
      CHECK ("experience_years" IS NULL OR ("experience_years" >= 0 AND "experience_years" <= 80));
