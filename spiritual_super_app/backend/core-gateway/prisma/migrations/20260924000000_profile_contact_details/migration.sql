-- Profile page: contact details and a profile photo.
--
-- Email is informational only (receipts, support contact). The phone number stays the sole login
-- credential, so email is neither unique nor verified.

ALTER TABLE "users"
    ADD COLUMN "email" VARCHAR(254),
    ADD COLUMN "address" VARCHAR(500),
    ADD COLUMN "photo_data_url" TEXT;

-- The photo is a small client-resized image stored inline; anything else here is a bug or an abuse.
ALTER TABLE "users"
    ADD CONSTRAINT "users_photo_data_url_format"
    CHECK (
        "photo_data_url" IS NULL
        OR ("photo_data_url" ~ '^data:image/(jpeg|png|webp);base64,' AND length("photo_data_url") <= 400000)
    );
