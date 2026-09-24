-- Footer singleton: social profile URLs and app-store download links, edited from the admin panel.

CREATE TABLE "footer_settings" (
    "id" VARCHAR(32) NOT NULL,
    "facebook_url" VARCHAR(500),
    "instagram_url" VARCHAR(500),
    "youtube_url" VARCHAR(500),
    "x_url" VARCHAR(500),
    "linkedin_url" VARCHAR(500),
    "whatsapp_url" VARCHAR(500),
    "app_store_url" VARCHAR(500),
    "play_store_url" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "footer_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "footer_settings" ("id", "updated_at") VALUES ('default', CURRENT_TIMESTAMP);
