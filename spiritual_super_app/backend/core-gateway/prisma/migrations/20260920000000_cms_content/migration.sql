-- CMS: homepage singleton + articles for Nakshya marketing / admin.

CREATE TABLE "site_content" (
    "id" VARCHAR(32) NOT NULL,
    "hero_eyebrow" VARCHAR(120) NOT NULL,
    "hero_title" VARCHAR(200) NOT NULL,
    "hero_subtitle" VARCHAR(500) NOT NULL,
    "hero_image_url" VARCHAR(500),
    "promo_quote" VARCHAR(200),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "site_content_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "excerpt" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "cover_url" VARCHAR(500),
    "cta_href" VARCHAR(200),
    "published" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");
CREATE INDEX "articles_published_featured_published_at_idx" ON "articles"("published", "featured", "published_at");

INSERT INTO "site_content" (
  "id", "hero_eyebrow", "hero_title", "hero_subtitle", "hero_image_url", "promo_quote", "updated_at"
) VALUES (
  'default',
  'Ancient wisdom for a brighter tomorrow',
  'Find Clarity in Every Phase of Life',
  'Astrology · Puja · Panchang · Ayurveda · Guidance. All in one trusted platform — Nakshya.',
  'https://images.unsplash.com/photo-1507400492013-162706c8c05e?auto=format&fit=crop&w=2000&q=80',
  'Aligned with the Stars, Rooted in Nature',
  CURRENT_TIMESTAMP
);

INSERT INTO "articles" (
  "id", "slug", "title", "excerpt", "body", "cover_url", "cta_href",
  "published", "featured", "published_at", "created_at", "updated_at"
) VALUES
(
  'a1000000-0000-4000-8000-000000000001',
  'moon-transit-effects',
  'Moon Transit Effects on Your Life',
  'How gochar through nakshatras colours mood, decisions, and timing this month.',
  E'## Moon in transit\n\nGochar through the lunar mansions sets the emotional weather.\n\n- Watch the Moon''s nakshatra for day-to-day mood\n- Pair with your current Vimshottari dasha for timing\n- Prefer reflection over hard commitments on void-of-course days\n\nOpen **Gochar** for today''s sky against your natal Lagna.',
  'https://images.unsplash.com/photo-1419242902214-272b3f66ee70?auto=format&fit=crop&w=600&q=80',
  '/gochar',
  true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'a1000000-0000-4000-8000-000000000002',
  'reading-your-current-dasha',
  'Reading Your Current Dasha',
  'A practical guide to mahadasha and antardasha without fatalism or fear.',
  E'## Dasha without fear\n\nYour mahadasha and antardasha describe *themes*, not fate.\n\n1. Open your Kundali and note the current lords\n2. Ask what those grahas rule in your chart\n3. Act on what is already in motion\n\nJyotish AI can summarise your stack once birth details are saved.',
  'https://images.unsplash.com/photo-1507400492013-162706c8c05e?auto=format&fit=crop&w=600&q=80',
  '/kundali',
  true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'a1000000-0000-4000-8000-000000000003',
  'ayurveda-habits-vata-season',
  'Ayurveda Habits for Vata Season',
  'Warm routines, grounding food, and sleep tips when air and space dominate.',
  E'## Steady the wind\n\nWhen Vata rises: warm food, regular sleep, and gentle oiling calm the system.\n\nBrowse the Ayurveda shop for dosha-tagged kits paid from your wallet.',
  'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=600&q=80',
  '/ayurveda',
  true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
