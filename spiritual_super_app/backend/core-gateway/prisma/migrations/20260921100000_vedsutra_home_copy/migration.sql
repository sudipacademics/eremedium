-- Rebrand homepage CMS singleton from Nakshya → Vedsutra.

UPDATE "site_content"
SET
  "hero_eyebrow" = 'Ancient wisdom for a brighter tomorrow',
  "hero_title" = 'Your Life, Guided by Vedic Wisdom',
  "hero_subtitle" = 'Astrology, Puja, Panchang & Ayurveda — guided by Vedsutra.',
  "promo_quote" = 'Aligned with the Stars, Rooted in Nature',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND (
    "hero_subtitle" ILIKE '%Nakshya%'
    OR "hero_title" = 'Find Clarity in Every Phase of Life'
  );
