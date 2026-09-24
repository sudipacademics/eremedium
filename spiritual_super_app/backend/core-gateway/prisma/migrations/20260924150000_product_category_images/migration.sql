-- Shop products gain a category (Ayurveda or Crystal) and an optional image, so the homepage can
-- show one carousel per category straight from the catalog. Existing rows stay AYURVEDA.

CREATE TYPE "ProductCategory" AS ENUM ('AYURVEDA', 'CRYSTAL');

ALTER TABLE "ayurveda_products"
    ADD COLUMN "category" "ProductCategory" NOT NULL DEFAULT 'AYURVEDA',
    ADD COLUMN "image_url" VARCHAR(500);

CREATE INDEX "ayurveda_products_category_active_idx" ON "ayurveda_products"("category", "active");

-- Images for the seeded Ayurveda SKUs; never overwrites an image an admin has already set.
UPDATE "ayurveda_products" SET "image_url" = '/shop/products/' || "sku" || '.webp'
WHERE "image_url" IS NULL
  AND "sku" IN ('vata-balance-kit', 'pitta-cool-kit', 'kapha-light-kit', 'triphala-churna',
                'ashwagandha-churna', 'brahmi-oil', 'digestive-agni-kit');

-- Starter crystal catalog. Admin can edit prices or deactivate any of these.
INSERT INTO "ayurveda_products" ("sku", "name", "description", "price", "form_factor", "category", "image_url")
VALUES
  ('crystal-amethyst', 'Amethyst Cluster', 'Violet quartz traditionally associated with Shani and a calm, focused mind.', 1299.00, 'raw', 'CRYSTAL', '/shop/products/crystal-amethyst.webp'),
  ('crystal-rose-quartz', 'Rose Quartz Tumble', 'Soft pink quartz associated with Shukra, kept for harmony in relationships.', 499.00, 'tumbled', 'CRYSTAL', '/shop/products/crystal-rose-quartz.webp'),
  ('crystal-citrine', 'Citrine Stone', 'Golden quartz linked with Guru and traditionally kept for prosperity.', 899.00, 'tumbled', 'CRYSTAL', '/shop/products/crystal-citrine.webp'),
  ('crystal-sphatik', 'Sphatik (Clear Quartz) Cluster', 'Clear quartz revered as sphatik, used on altars and for meditation.', 1099.00, 'raw', 'CRYSTAL', '/shop/products/crystal-sphatik.webp'),
  ('crystal-tigers-eye', 'Tiger''s Eye Tumble', 'Banded golden-brown stone traditionally kept for courage and grounding.', 449.00, 'tumbled', 'CRYSTAL', '/shop/products/crystal-tigers-eye.webp'),
  ('crystal-black-tourmaline', 'Black Tourmaline', 'Deep black stone traditionally placed at entrances as a protective ward.', 699.00, 'raw', 'CRYSTAL', '/shop/products/crystal-black-tourmaline.webp'),
  ('crystal-pyrite', 'Pyrite Cluster', 'Metallic "fool''s gold" traditionally kept on work desks for abundance.', 799.00, 'raw', 'CRYSTAL', '/shop/products/crystal-pyrite.webp'),
  ('crystal-lapis-lazuli', 'Lapis Lazuli Stone', 'Royal-blue stone associated with clear expression and wisdom.', 999.00, 'tumbled', 'CRYSTAL', '/shop/products/crystal-lapis-lazuli.webp')
ON CONFLICT ("sku") DO NOTHING;
