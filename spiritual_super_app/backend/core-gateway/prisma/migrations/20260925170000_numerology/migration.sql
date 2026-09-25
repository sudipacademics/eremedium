-- Free numerology calculator on /numerology. Every calculated report is kept as a lead for
-- Admin → Numerology, together with the numbers it produced.

CREATE TABLE "numerology_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "birth_date" DATE NOT NULL,
    "gender" VARCHAR(10) NOT NULL,
    "life_path" SMALLINT NOT NULL,
    "destiny" SMALLINT NOT NULL,
    "soul_urge" SMALLINT NOT NULL,
    "personality" SMALLINT NOT NULL,
    "birthday" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "numerology_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "numerology_reports_gender" CHECK ("gender" IN ('MALE', 'FEMALE', 'OTHER'))
);

CREATE INDEX "numerology_reports_created_at_idx" ON "numerology_reports"("created_at");

-- Singleton (id = 'default'): the explainer video shown beside the calculator.
CREATE TABLE "numerology_settings" (
    "id" VARCHAR(32) NOT NULL,
    "video_youtube_id" VARCHAR(11),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "numerology_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "numerology_settings_video_format" CHECK ("video_youtube_id" IS NULL OR "video_youtube_id" ~ '^[A-Za-z0-9_-]{11}$')
);
