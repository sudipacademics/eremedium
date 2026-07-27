import { randomUUID } from 'node:crypto';

function text(value, max = 8000) {
  return String(value ?? '').trim().slice(0, max);
}

function lines(value, maxItems = 20, maxLen = 500) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((line) => line.slice(0, maxLen));
}

function faqItems(value, maxItems = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => ({
    id: text(item?.id, 80) || randomUUID(),
    question: text(item?.question, 300),
    answer: text(item?.answer, 4000),
  })).filter((item) => item.question && item.answer);
}

function featureItems(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => ({
    id: text(item?.id, 80) || randomUUID(),
    title: text(item?.title, 180),
    description: text(item?.description, 1200),
    image_url: text(item?.image_url, 500),
  })).filter((item) => item.title);
}

function timelineSteps(value, maxItems = 10) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => ({
    id: text(item?.id, 80) || randomUUID(),
    title: text(item?.title, 120),
    description: text(item?.description, 500),
  })).filter((item) => item.title);
}

function investmentItems(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => ({
    id: text(item?.id, 80) || randomUUID(),
    label: text(item?.label, 160),
    value: text(item?.value, 120),
    description: text(item?.description, 800),
  })).filter((item) => item.label);
}

function heroSlides(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item, index) => ({
    id: text(item?.id, 80) || randomUUID(),
    image_url: text(item?.image_url, 500),
    alt: text(item?.alt, 200),
    sort_order: Number(item?.sort_order) || index + 1,
    is_published: item?.is_published !== false,
  })).filter((item) => item.image_url);
}

function modelCardDefaults(model) {
  const isFofo = model === 'FOFO';
  return {
    is_published: true,
    title: model,
    subtitle: isFofo ? 'Franchise Owned, Franchise Operated' : 'Franchise Owned, Company Operated',
    description: isFofo
      ? 'Own and operate a diagnostics collection centre with direct control of your business.'
      : 'Invest in a guided format while Remedium supports operations and quality systems.',
    image_url: '',
    features: isFofo
      ? ['Local ownership and operations', 'Structured training and support', 'Growth under the Remedium brand']
      : ['Company-supported operations', 'Guided operating model', 'Ideal for hands-off investors'],
    button_text: isFofo ? 'Explore FOFO details ->' : 'Explore FOCO details ->',
    button_url: isFofo ? '/fofo' : '/foco',
    sort_order: isFofo ? 1 : 2,
  };
}

function modelPageDefaults(model) {
  const isFofo = model === 'FOFO';
  return {
    is_published: true,
    updated_at: '',
    seo: {
      title: `${model} Franchise Opportunity | Remedium Lab`,
      description: isFofo
        ? 'Explore the FOFO franchise model and operate your own diagnostics collection centre with Remedium Lab support.'
        : 'Explore the FOCO franchise model and invest in a company-supported diagnostics business with Remedium Lab.',
      keywords: `${model}, franchise, diagnostics, Remedium Lab, West Bengal`,
    },
    hero: {
      title: `${model} Franchise Opportunity`,
      subtitle: isFofo ? 'Franchise Owned, Franchise Operated' : 'Franchise Owned, Company Operated',
      description: 'Build a trusted diagnostics collection centre with the operating model that matches your goals.',
      banner_image_url: '',
      slides: [],
      cta_text: `Apply for ${model}`,
      cta_url: '',
    },
    calculator: {
      is_published: true,
      sort_order: 1,
      title: 'Investment & profitability calculator',
      note: isFofo
        ? 'Profit is calculated as 30% of monthly revenue. Illustrative estimate only.'
        : 'Profit = 30% revenue + (FOFO units x 20% revenue). Illustrative estimate only.',
    },
    success_story: {
      is_published: true,
      sort_order: 2,
      title: 'Success story',
      subtitle: 'Built for local trust',
      body: 'The support helped build a respected diagnostics business in the community.',
      youtube_embed_code: '',
      youtube_embed_url: '',
      image_url: '',
    },
    territory: {
      is_published: true,
      sort_order: 3,
      title: 'West Bengal Opportunity',
      subtitle: 'Explore available territories across West Bengal.',
      description: 'Territory availability is verified before final approval.',
      map_labels: ['Kolkata', 'Howrah', 'Siliguri', 'Bardhaman', 'Malda'],
      image_url: '',
    },
    support_timeline: {
      is_published: true,
      sort_order: 4,
      title: 'End-to-end operational support',
      steps: timelineSteps([
        { title: 'Application', description: 'Submit and review your franchise application.' },
        { title: 'Centre setup', description: 'Prepare your diagnostics collection centre.' },
        { title: 'Training', description: 'Complete mandatory franchise training.' },
        { title: 'Operations', description: 'Launch with operational guidance.' },
        { title: 'Marketing', description: 'Build local awareness with brand support.' },
        { title: 'Growth', description: 'Scale with ongoing franchise support.' },
      ]),
    },
    investment: {
      is_published: true,
      sort_order: 5,
      title: 'Investment overview',
      items: investmentItems([
        { label: isFofo ? 'FOFO one-time fee' : 'Application fee', value: isFofo ? 'As per current plan' : 'Stage 1', description: 'Payable after application acceptance.' },
        { label: 'Operating support', value: 'Included', description: 'Structured onboarding and launch guidance from Remedium Lab.' },
      ]),
    },
    benefits: {
      is_published: true,
      sort_order: 6,
      title: 'Why choose this model',
      items: featureItems(isFofo
        ? [
            { title: 'Local control', description: 'Operate your centre with direct ownership and accountability.' },
            { title: 'Brand trust', description: 'Build on Remedium Lab quality and fair-price positioning.' },
            { title: 'Structured support', description: 'Training, launch guidance and ongoing operational help.' },
          ]
        : [
            { title: 'Guided operations', description: 'Benefit from company-supported operating systems.' },
            { title: 'Investor friendly', description: 'Ideal for partners seeking a hands-off investment format.' },
            { title: 'Scalable model', description: 'Expand with FOFO units under your FOCO structure.' },
          ]),
    },
    faqs: {
      is_published: true,
      sort_order: 7,
      title: 'Frequently asked questions',
      items: faqItems([
        { question: `Who should choose ${model}?`, answer: isFofo ? 'Entrepreneurs who want to own and operate a local diagnostics centre.' : 'Investors who prefer company-supported operations with franchise ownership.' },
        { question: 'How is territory decided?', answer: 'Territory availability is reviewed before approval and allotment.' },
      ]),
    },
    features: {
      is_published: true,
      sort_order: 8,
      title: 'Key features',
      items: featureItems([]),
    },
    cta: {
      is_published: true,
      sort_order: 9,
      title: `Ready to apply for ${model}?`,
      description: 'Start your franchise application and connect with the Remedium Lab team.',
      button_text: `Apply for ${model}`,
      button_url: '',
    },
  };
}

export function defaultMarketingPages() {
  return {
    homepage_models: {
      is_published: true,
      heading: 'Choose the model that fits your ambition.',
      intro: 'One healthcare brand. Two ways to build your franchise business.',
      fofo: modelCardDefaults('FOFO'),
      foco: modelCardDefaults('FOCO'),
    },
    fofo_page: modelPageDefaults('FOFO'),
    foco_page: modelPageDefaults('FOCO'),
  };
}

function normalizeModelCard(value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  const features = Array.isArray(source.features)
    ? source.features.map((item) => text(item, 240)).filter(Boolean).slice(0, 8)
    : fallback.features;
  return {
    is_published: source.is_published !== false,
    title: text(source.title, 40) || fallback.title,
    subtitle: text(source.subtitle, 180) || fallback.subtitle,
    description: text(source.description, 1200) || fallback.description,
    image_url: text(source.image_url, 500),
    features: features.length ? features : fallback.features,
    button_text: text(source.button_text, 120) || fallback.button_text,
    button_url: text(source.button_url, 500) || fallback.button_url,
    sort_order: Number(source.sort_order) || fallback.sort_order,
  };
}

function normalizeHero(hero, fallback) {
  const source = hero && typeof hero === 'object' ? hero : {};
  const banner = text(source.banner_image_url, 500);
  let slides = heroSlides(source.slides);
  if (!slides.length && banner) {
    slides = [{ id: randomUUID(), image_url: banner, alt: '', sort_order: 1, is_published: true }];
  }
  slides.sort((first, second) => first.sort_order - second.sort_order);
  return {
    title: text(source.title, 180) || fallback.hero.title,
    subtitle: text(source.subtitle, 240) || fallback.hero.subtitle,
    description: text(source.description, 1200) || fallback.hero.description,
    banner_image_url: slides[0]?.image_url || banner,
    slides,
    cta_text: text(source.cta_text, 120) || fallback.hero.cta_text,
    cta_url: text(source.cta_url, 500),
  };
}

function normalizeModelPage(value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  const seo = source.seo && typeof source.seo === 'object' ? source.seo : {};
  const section = (key) => {
    const block = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const base = fallback[key];
    if (key === 'support_timeline') {
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        steps: timelineSteps(block.steps).length ? timelineSteps(block.steps) : base.steps,
      };
    }
    if (key === 'investment') {
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        items: investmentItems(block.items).length ? investmentItems(block.items) : base.items,
      };
    }
    if (key === 'benefits' || key === 'features') {
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        items: featureItems(block.items).length ? featureItems(block.items) : base.items,
      };
    }
    if (key === 'faqs') {
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        items: faqItems(block.items).length ? faqItems(block.items) : base.items,
      };
    }
    if (key === 'territory') {
      const labels = Array.isArray(block.map_labels)
        ? block.map_labels.map((item) => text(item, 80)).filter(Boolean).slice(0, 12)
        : base.map_labels;
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        subtitle: text(block.subtitle, 240) || base.subtitle,
        description: text(block.description, 1200) || base.description,
        map_labels: labels.length ? labels : base.map_labels,
        image_url: text(block.image_url, 500),
      };
    }
    if (key === 'success_story') {
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        subtitle: text(block.subtitle, 240) || base.subtitle,
        body: text(block.body, 4000) || base.body,
        youtube_embed_code: text(block.youtube_embed_code, 4000),
        youtube_embed_url: text(block.youtube_embed_url, 500),
        image_url: text(block.image_url, 500),
      };
    }
    if (key === 'calculator') {
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        note: text(block.note, 1200) || base.note,
      };
    }
    if (key === 'cta') {
      return {
        is_published: block.is_published !== false,
        sort_order: Number(block.sort_order) || base.sort_order,
        title: text(block.title, 180) || base.title,
        description: text(block.description, 1200) || base.description,
        button_text: text(block.button_text, 120) || base.button_text,
        button_url: text(block.button_url, 500),
      };
    }
    return base;
  };

  return {
    is_published: source.is_published !== false,
    updated_at: text(source.updated_at, 40),
    seo: {
      title: text(seo.title, 180) || fallback.seo.title,
      description: text(seo.description, 500) || fallback.seo.description,
      keywords: text(seo.keywords, 300) || fallback.seo.keywords,
    },
    hero: normalizeHero(source.hero, fallback),
    calculator: section('calculator'),
    success_story: section('success_story'),
    territory: section('territory'),
    support_timeline: section('support_timeline'),
    investment: section('investment'),
    benefits: section('benefits'),
    faqs: section('faqs'),
    features: section('features'),
    cta: section('cta'),
  };
}

export function normalizeMarketingPages(value) {
  const defaults = defaultMarketingPages();
  const source = value && typeof value === 'object' ? value : {};
  const homepage = source.homepage_models && typeof source.homepage_models === 'object' ? source.homepage_models : {};
  return {
    homepage_models: {
      is_published: homepage.is_published !== false,
      heading: text(homepage.heading, 240) || defaults.homepage_models.heading,
      intro: text(homepage.intro, 500) || defaults.homepage_models.intro,
      fofo: normalizeModelCard(homepage.fofo, defaults.homepage_models.fofo),
      foco: normalizeModelCard(homepage.foco, defaults.homepage_models.foco),
    },
    fofo_page: normalizeModelPage(source.fofo_page, defaults.fofo_page),
    foco_page: normalizeModelPage(source.foco_page, defaults.foco_page),
  };
}

function resolvePublicUrl(url, resolveUploadUrl) {
  const value = text(url, 500);
  if (!value) return '';
  return resolveUploadUrl ? resolveUploadUrl(value) : value;
}

function publicModelCard(card, resolveUploadUrl) {
  if (!card?.is_published) return null;
  return {
    ...card,
    image_url: resolvePublicUrl(card.image_url, resolveUploadUrl),
  };
}

function publicModelPage(page, resolveUploadUrl) {
  if (!page?.is_published) return null;
  return {
    ...page,
    hero: {
      ...page.hero,
      banner_image_url: resolvePublicUrl(page.hero.banner_image_url, resolveUploadUrl),
      slides: page.hero.slides
        .filter((slide) => slide.is_published !== false)
        .map((slide) => ({
          ...slide,
          image_url: resolvePublicUrl(slide.image_url, resolveUploadUrl),
        })),
    },
    success_story: {
      ...page.success_story,
      image_url: resolvePublicUrl(page.success_story.image_url, resolveUploadUrl),
    },
    territory: {
      ...page.territory,
      image_url: resolvePublicUrl(page.territory.image_url, resolveUploadUrl),
    },
    benefits: {
      ...page.benefits,
      items: page.benefits.items.map((item) => ({ ...item, image_url: resolvePublicUrl(item.image_url, resolveUploadUrl) })),
    },
    features: {
      ...page.features,
      items: page.features.items.map((item) => ({ ...item, image_url: resolvePublicUrl(item.image_url, resolveUploadUrl) })),
    },
  };
}

export function publicMarketingPages(value, resolveUploadUrl) {
  const pages = normalizeMarketingPages(value);
  const homepage = pages.homepage_models.is_published
    ? {
        is_published: true,
        heading: pages.homepage_models.heading,
        intro: pages.homepage_models.intro,
        fofo: publicModelCard(pages.homepage_models.fofo, resolveUploadUrl),
        foco: publicModelCard(pages.homepage_models.foco, resolveUploadUrl),
      }
    : null;
  return {
    homepage_models: homepage,
    fofo_page: publicModelPage(pages.fofo_page, resolveUploadUrl),
    foco_page: publicModelPage(pages.foco_page, resolveUploadUrl),
  };
}

export function adminMarketingPages(value, resolveUploadUrl) {
  const pages = normalizeMarketingPages(value);
  return {
    homepage_models: {
      ...pages.homepage_models,
      fofo: { ...pages.homepage_models.fofo, image_url: resolvePublicUrl(pages.homepage_models.fofo.image_url, resolveUploadUrl) },
      foco: { ...pages.homepage_models.foco, image_url: resolvePublicUrl(pages.homepage_models.foco.image_url, resolveUploadUrl) },
    },
    fofo_page: pages.fofo_page,
    foco_page: pages.foco_page,
  };
}

export function mergeMarketingPages(current, patch) {
  const base = normalizeMarketingPages(current);
  const next = normalizeMarketingPages({ ...base, ...patch });
  if (patch?.fofo_page) next.fofo_page = normalizeModelPage({ ...base.fofo_page, ...patch.fofo_page }, base.fofo_page);
  if (patch?.foco_page) next.foco_page = normalizeModelPage({ ...base.foco_page, ...patch.foco_page }, base.foco_page);
  if (patch?.homepage_models) {
    next.homepage_models = {
      ...base.homepage_models,
      ...patch.homepage_models,
      fofo: normalizeModelCard({ ...base.homepage_models.fofo, ...patch.homepage_models?.fofo }, base.homepage_models.fofo),
      foco: normalizeModelCard({ ...base.homepage_models.foco, ...patch.homepage_models?.foco }, base.homepage_models.foco),
    };
  }
  return next;
}

export function youtubeEmbedUrlFromCode(embedCode) {
  const source = String(embedCode ?? '').trim();
  const match = source.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  const url = match?.[1] ?? source;
  try {
    const parsed = new URL(url);
    if (!['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(parsed.hostname)) return '';
    if (!parsed.pathname.startsWith('/embed/')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}
