-- Reviews carousel: featured flag and optional uploaded thumbnail on videos, plus written testimonials.

ALTER TABLE "review_videos"
    ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "thumbnail_data" TEXT,
    ADD COLUMN "thumbnail_updated_at" TIMESTAMPTZ(3);

CREATE TABLE "testimonials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "location" VARCHAR(120),
    "rating" SMALLINT NOT NULL DEFAULT 5,
    "body" VARCHAR(600) NOT NULL,
    "photo_data" TEXT,
    "photo_updated_at" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "testimonials_rating_range" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE INDEX "testimonials_active_sort_order_idx" ON "testimonials"("active", "sort_order");
