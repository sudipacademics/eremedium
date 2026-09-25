-- Backend-managed homepage hero slides (Admin → Hero slides).
-- A slide shows when it is active and "now" falls inside its optional schedule window.
-- The image is either a URL (site path or allowed https host) or a small admin-uploaded data URL.

CREATE TABLE "hero_slides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eyebrow" VARCHAR(120),
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(400),
    "image_url" VARCHAR(500),
    "image_data" TEXT,
    "image_updated_at" TIMESTAMPTZ(3),
    "cta_text" VARCHAR(40),
    "cta_href" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "hero_slides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hero_slides_has_image" CHECK ("image_url" IS NOT NULL OR "image_data" IS NOT NULL),
    CONSTRAINT "hero_slides_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE INDEX "hero_slides_active_sort_order_idx" ON "hero_slides"("active", "sort_order");

-- The current hero becomes the first slide, so the homepage looks the same until an admin edits it.
-- *Asterisks* mark the words shown in gold.
INSERT INTO "hero_slides" ("eyebrow", "title", "description", "image_url", "sort_order")
VALUES (
    'Ancient wisdom for a brighter tomorrow',
    'Your Life, Guided by *Vedic Wisdom*',
    'Astrology | Puja | Panchang | Ayurveda — all in one trusted platform – Vedsutra',
    '/brand/vedsutra-hero-mandala.png',
    0
);
