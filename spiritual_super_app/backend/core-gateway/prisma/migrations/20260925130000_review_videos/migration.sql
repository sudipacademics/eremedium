-- Backend-managed YouTube review videos for the homepage "Reviews" carousel (Admin → Reviews).
-- Only the 11-character YouTube video id is stored; the site builds thumbnail and embed URLs from it.

CREATE TABLE "review_videos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "youtube_id" VARCHAR(11) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(400),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "review_videos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_videos_youtube_id_format" CHECK ("youtube_id" ~ '^[A-Za-z0-9_-]{11}$')
);

CREATE INDEX "review_videos_active_sort_order_idx" ON "review_videos"("active", "sort_order");
