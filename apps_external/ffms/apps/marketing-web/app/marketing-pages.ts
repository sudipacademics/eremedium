'use client';

import { useEffect, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';

export type ModelCardContent = {
  is_published: boolean;
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  features: string[];
  button_text: string;
  button_url: string;
  sort_order: number;
};

export type HomepageModelsContent = {
  is_published: boolean;
  heading: string;
  intro: string;
  fofo: ModelCardContent | null;
  foco: ModelCardContent | null;
};

export type ModelPageSection = {
  is_published: boolean;
  sort_order: number;
  title: string;
};

export type HeroSlideContent = {
  id: string;
  image_url: string;
  alt: string;
  sort_order: number;
  is_published: boolean;
};

export type ModelPageContent = {
  is_published: boolean;
  updated_at?: string;
  seo: { title: string; description: string; keywords: string };
  hero: {
    title: string;
    subtitle: string;
    description: string;
    banner_image_url: string;
    slides: HeroSlideContent[];
    cta_text: string;
    cta_url: string;
  };
  calculator: ModelPageSection & { note: string };
  success_story: ModelPageSection & {
    subtitle: string;
    body: string;
    youtube_embed_code: string;
    youtube_embed_url: string;
    image_url: string;
  };
  territory: ModelPageSection & {
    subtitle: string;
    description: string;
    map_labels: string[];
    image_url: string;
  };
  support_timeline: ModelPageSection & {
    steps: { id: string; title: string; description: string }[];
  };
  investment: ModelPageSection & {
    items: { id: string; label: string; value: string; description: string }[];
  };
  benefits: ModelPageSection & {
    items: { id: string; title: string; description: string; image_url?: string }[];
  };
  faqs: ModelPageSection & {
    items: { id: string; question: string; answer: string }[];
  };
  features: ModelPageSection & {
    items: { id: string; title: string; description: string; image_url?: string }[];
  };
  cta: ModelPageSection & {
    description: string;
    button_text: string;
    button_url: string;
  };
};

export type MarketingPagesContent = {
  homepage_models: HomepageModelsContent | null;
  fofo_page: ModelPageContent | null;
  foco_page: ModelPageContent | null;
};

const API_BASE = RFMS_API_BASE;

export function useMarketingPages() {
  const [content, setContent] = useState<MarketingPagesContent | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`${API_BASE}/content/marketing-pages`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null) as { success?: boolean; data?: MarketingPagesContent } | null;
        if (!cancelled && response.ok && payload?.success && payload.data) setContent(payload.data);
      } catch {
        if (!cancelled) setContent(null);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return content;
}

export function youtubePreviewUrl(embedCode: string) {
  const source = embedCode.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ?? embedCode.trim();
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:') return '';
    if (!['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname)) return '';
    if (!url.pathname.startsWith('/embed/')) return '';
    return url.toString();
  } catch {
    return '';
  }
}
