'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import {
  api,
  type AyurvedaProduct,
  type CmsArticle,
  type HeroSlide,
  type SiteContent,
} from '@/lib/api';
import { SiteFooter } from '@/components/SiteFooter';
import { UpcomingFestivalsCard } from '@/components/festivals/UpcomingFestivalsCard';
import { AstrologerCarousel } from '@/components/home/AstrologerCarousel';
import { HeroSlider } from '@/components/home/HeroSlider';
import { JoinUsBanner } from '@/components/home/JoinUsBanner';
import { NewsletterSection } from '@/components/home/NewsletterSection';
import { ProductCarousel } from '@/components/home/ProductCarousel';
import { ReviewsSection } from '@/components/home/ReviewsSection';
import { StatsSection } from '@/components/home/StatsSection';

const CATEGORIES = [
  { href: '/astrologers', label: 'Astrology', tag: 'Get Clarity', icon: 'astrology', tint: 'from-amber-50 to-amber-100/70' },
  { href: '/kundali', label: 'Kundali', tag: 'Know Your Self', icon: 'kundali', tint: 'from-orange-50 to-rose-100/70' },
  { href: '/horoscope', label: 'Horoscope', tag: 'Daily Rashifal', icon: 'horoscope', tint: 'from-violet-50 to-violet-100/80' },
  { href: '/match', label: 'Match Making', tag: 'Build Together', icon: 'match', tint: 'from-rose-50 to-pink-100/80' },
  { href: '/gochar', label: 'Gochar', tag: 'Plan Ahead', icon: 'gochar', tint: 'from-sky-50 to-blue-100/80' },
  { href: '/panchang', label: 'Panchang', tag: 'Auspicious Timings', icon: 'panchang', tint: 'from-amber-50 to-yellow-100/80' },
  { href: '/pujas', label: 'E-Puja', tag: 'Sacred Rituals', icon: 'epuja', tint: 'from-orange-50 to-orange-100/80' },
  { href: '/temple', label: 'Virtual Temple', tag: '16 Upacharas', icon: 'temple', tint: 'from-purple-50 to-fuchsia-100/60' },
  { href: '/ayurveda', label: 'Ayurveda', tag: 'Natural Wellness', icon: 'ayurveda', tint: 'from-emerald-50 to-green-100/80' },
] as const;

const QUICK_ACTIONS = [
  { href: '/ai', label: 'AI Astrologers', tag: 'Vedic · Nadi · Western · Numerology', icon: 'chat' },
  { href: '/astrologers', label: 'Call Astrologer', tag: 'Talk to a verified expert', icon: 'call' },
  { href: '/horoscope', label: 'Daily Horoscope', tag: 'Daily, weekly & monthly rashifal', icon: 'sun' },
  { href: '/kundali', label: 'Get Free Kundali', tag: 'Your birth chart in seconds', icon: 'chart' },
] as const;

function QuickActionIcon({ name }: { name: (typeof QUICK_ACTIONS)[number]['icon'] }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'h-6 w-6',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
  switch (name) {
    case 'chat':
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z" />
          <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeWidth={2.4} />
        </svg>
      );
    case 'call':
      return (
        <svg {...common}>
          <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="1.5" />
          <path d="M3 3l18 18M21 3L3 21M12 3l9 9-9 9-9-9z" />
        </svg>
      );
  }
}

const POPULAR = [
  { href: '/kundali', title: 'Birth Chart Analysis', blurb: 'Lagna, grahas, and houses.', icon: '📜' },
  { href: '/astrologers', title: 'Career Guidance', blurb: 'Dasha-aligned career timing.', icon: '💼' },
  { href: '/match', title: 'Marriage Compatibility', blurb: 'Ashtakoot matching.', icon: '💍' },
  { href: '/ayurveda', title: 'Health & Wellness', blurb: 'Dosha-aware routines.', icon: '💚' },
  { href: '/astrologers', title: 'Business & Finance', blurb: 'Muhurta for deals & wealth.', icon: '📈' },
  { href: '/pujas', title: 'Dosha Nivaran', blurb: 'Remedies and temple rituals.', icon: '🛕' },
] as const;

const TRUST = [
  { label: 'Verified Experts', icon: '✓' },
  { label: '100% Secure', icon: '🛡' },
  { label: 'Trusted by Thousands', icon: '★' },
  { label: '24×7 Support', icon: '💬' },
] as const;

const BANNERS = [
  {
    title: 'Kundali Analysis',
    body: 'Deep birth-chart reading with dasha insight.',
    href: '/kundali',
    cta: 'Consult Now →',
    image:
      'https://images.unsplash.com/photo-1419242902214-272b3f66ee70?auto=format&fit=crop&w=900&q=80',
    overlay: 'from-[#0a2f4a]/95 to-[#0a2f4a]/55',
  },
  {
    title: 'Book Authentic E-Puja',
    body: 'Temple rituals with sankalp and prasad.',
    href: '/pujas',
    cta: 'Book a Puja →',
    image:
      'https://images.unsplash.com/photo-1545558014-8692077e9b5c?auto=format&fit=crop&w=900&q=80',
    overlay: 'from-[#5c3a2a]/95 to-[#5c3a2a]/50',
  },
  {
    title: 'Virtual Temple',
    body: 'Offer sixteen upacharas — flowers, jal, ghanta, deepam.',
    href: '/temple',
    cta: 'Enter shrine →',
    image:
      'https://images.unsplash.com/photo-1507400492013-162706c8c05e?auto=format&fit=crop&w=900&q=80',
    overlay: 'from-ved-green-900/95 to-ved-green-700/50',
  },
  {
    title: 'Explore Ayurveda',
    body: 'Dosha-tagged kits and churnas from the shop.',
    href: '/ayurveda',
    cta: 'Shop Now →',
    image:
      'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=900&q=80',
    overlay: 'from-ved-green-800/95 to-[#5c3a2a]/50',
  },
  {
    title: 'Donate Bhandara',
    body: 'Support a sacred meal and help feed devotees in need.',
    href: '/pujas',
    cta: 'Donate Now →',
    image:
      'https://images.unsplash.com/photo-1567337710282-00832b415979?auto=format&fit=crop&w=900&q=80',
    overlay: 'from-[#6b3410]/95 to-[#6b3410]/50',
  },
  {
    title: 'Find Pandit',
    body: 'Find verified Pandits for Puja, rituals and ceremonies.',
    href: '/astrologers',
    cta: 'Find Pandit →',
    image:
      'https://images.unsplash.com/photo-1561361058-c24cecae35ca?auto=format&fit=crop&w=900&q=80',
    overlay: 'from-[#3b2a5c]/95 to-[#3b2a5c]/50',
  },
] as const;

export function HomePage() {
  const router = useRouter();
  const [site, setSite] = useState<SiteContent | null>(null);
  const [articles, setArticles] = useState<CmsArticle[]>([]);
  const [ayurveda, setAyurveda] = useState<AyurvedaProduct[] | null>(null);
  const [crystals, setCrystals] = useState<AyurvedaProduct[] | null>(null);
  const [heroSlides, setHeroSlides] = useState<HeroSlide[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void api
      .get<{ slides: HeroSlide[] }>('content/hero-slides')
      .then((res) => setHeroSlides(res.slides))
      .catch(() => setHeroSlides([]));
    void api.get<SiteContent>('content/home').then(setSite).catch(() => setSite(null));
    void api
      .get<{ articles: CmsArticle[] }>('content/articles?featured=true&limit=3')
      .then((res) => setArticles(res.articles))
      .catch(() => setArticles([]));
    void api
      .get<{ products: AyurvedaProduct[] }>('content/products?category=AYURVEDA')
      .then((res) => setAyurveda(res.products))
      .catch(() => setAyurveda([]));
    void api
      .get<{ products: AyurvedaProduct[] }>('content/products?category=CRYSTAL')
      .then((res) => setCrystals(res.products))
      .catch(() => setCrystals([]));
  }, []);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) {
      router.push('/astrologers');
      return;
    }
    if (q.includes('puja')) router.push('/pujas');
    else if (q.includes('temple') || q.includes('upachar') || q.includes('darshan'))
      router.push('/temple');
    else if (q.includes('ayur') || q.includes('shop')) router.push('/ayurveda');
    else if (q.includes('panch')) router.push('/panchang');
    else if (q.includes('kundali') || q.includes('chart')) router.push('/kundali');
    else router.push('/astrologers');
  }

  const promoQuote = site?.promoQuote?.trim() || 'Aligned with the Stars, Rooted in Nature';

  return (
    <div className="bg-[#F7F4EE] text-ved-green-900">
      <HeroSlider slides={heroSlides} promoQuote={promoQuote}>
        <form
          onSubmit={onSearch}
          className="mt-6 flex overflow-hidden rounded-full border border-ved-green-900/10 bg-white shadow-[0_8px_30px_rgba(11,79,69,0.08)]"
        >
          <input
            className="min-w-0 flex-1 bg-transparent px-5 py-3.5 text-sm outline-none placeholder:text-ved-green-900/35"
            placeholder="Search astrologers, puja, products, articles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            className="m-1.5 rounded-full bg-ved-green-800 px-7 py-2.5 text-sm font-semibold text-white hover:bg-ved-green-700"
          >
            Search
          </button>
        </form>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
          {TRUST.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-2 text-xs font-medium text-ved-green-800/70"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-ved-gold-100 text-[10px] text-ved-gold-700">
                {item.icon}
              </span>
              {item.label}
            </span>
          ))}
        </div>
      </HeroSlider>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:grid-cols-9">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.label}
              href={cat.href}
              className="group relative flex flex-col items-center rounded-2xl border border-ved-gold-400/40 bg-gradient-to-b from-white to-[#FCF9F3] px-2 pb-11 pt-5 text-center shadow-[0_6px_18px_-10px_rgba(176,138,50,0.35)] transition duration-300 hover:-translate-y-1 hover:border-ved-gold-400/70 hover:shadow-[0_14px_28px_-12px_rgba(176,138,50,0.45)]"
            >
              <span
                className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${cat.tint} shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition duration-300 group-hover:scale-105`}
              >
                <Image src={`/home/categories/${cat.icon}.webp`} alt="" width={44} height={44} unoptimized className="h-11 w-11 object-contain drop-shadow-[0_2px_3px_rgba(120,80,20,0.18)]" />
              </span>
              <span className="mt-3 font-display text-[15px] font-bold leading-tight text-ved-green-900 sm:text-base">{cat.label}</span>
              <span className="mt-1 text-[11px] leading-snug text-ved-green-800/60">{cat.tag}</span>
              <span
                aria-hidden
                className="absolute bottom-2.5 right-2.5 grid h-6 w-6 place-items-center rounded-full border border-ved-gold-400/60 bg-white text-ved-gold-700 transition group-hover:bg-ved-gold-400 group-hover:text-white"
              >
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path d="M4 10h11M11 5.5 15.5 10 11 14.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA banners */}
      <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-12 sm:grid-cols-2 lg:grid-cols-3">
        {BANNERS.map((banner) => (
          <Link
            key={banner.title}
            href={banner.href}
            className="group relative min-h-[11rem] overflow-hidden rounded-2xl shadow-md"
          >
            <Image
              src={banner.image}
              alt=""
              fill
              className="object-cover transition duration-500 group-hover:scale-105"
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            />
            <div className={`absolute inset-0 bg-gradient-to-r ${banner.overlay}`} />
            <div className="relative flex h-full flex-col justify-end p-5 text-white">
              <h3 className="font-display text-2xl font-semibold">{banner.title}</h3>
              <p className="mt-1 max-w-[16rem] text-sm text-white/80">{banner.body}</p>
              <span className="mt-4 inline-flex w-fit rounded-full bg-ved-gold-400 px-4 py-1.5 text-xs font-semibold text-ved-green-950">
                {banner.cta}
              </span>
            </div>
          </Link>
        ))}
      </section>

      {/* Quick actions */}
      <nav aria-label="Quick actions" className="mx-auto max-w-7xl px-4 pb-12">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <li key={action.href}>
              <Link
                href={action.href}
                className="group flex h-full items-center gap-3 rounded-2xl border border-ved-gold-400/30 bg-gradient-to-br from-white to-[#FBF8F2] p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-ved-green-500/40 hover:shadow-md sm:gap-4 sm:p-4"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ved-green-800 text-ved-gold-300 shadow-inner transition group-hover:scale-105 sm:h-12 sm:w-12">
                  <QuickActionIcon name={action.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight text-ved-green-900 sm:text-[15px]">
                    {action.label}
                  </span>
                  <span className="mt-0.5 hidden text-xs text-ved-green-800/55 sm:block">{action.tag}</span>
                </span>
                <span
                  aria-hidden
                  className="ml-auto hidden text-ved-gold-500 transition group-hover:translate-x-0.5 md:block"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <UpcomingFestivalsCard className="mx-auto max-w-7xl px-4 pb-12" />

      {/* Popular services */}
      <section className="mx-auto max-w-7xl px-4 pb-12">
        <SectionHead title="Popular Services" href="/astrologers" linkLabel="View All" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {POPULAR.map((item) => (
            <Link
              key={item.href + item.title}
              href={item.href}
              className="flex items-start gap-3 rounded-2xl border border-ved-green-900/8 bg-white p-4 shadow-sm transition hover:border-ved-green-500/25 hover:shadow-md"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ved-gold-100 text-lg">
                {item.icon}
              </span>
              <span>
                <span className="block font-semibold text-ved-green-900">{item.title}</span>
                <span className="mt-0.5 block text-sm text-ved-green-800/55">{item.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div id="featured-products" className="scroll-mt-20">
        <ProductCarousel
          title="Featured Ayurvedic Products"
          category="AYURVEDA"
          products={ayurveda ?? []}
          loading={ayurveda === null}
        />
        <ProductCarousel
          title="Featured Crystals"
          category="CRYSTAL"
          products={crystals ?? []}
          loading={crystals === null}
        />
      </div>

      <AstrologerCarousel />

      <StatsSection />

      {/* Articles */}
      <section className="mx-auto max-w-7xl px-4 py-12">
        <SectionHead title="Wisdom for Everyday Life" href="/gochar" linkLabel="View all" />
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {(articles.length > 0
            ? articles
            : ([
                {
                  id: '1',
                  slug: 'gochar',
                  title: "Moon's Transit Effects on Your Life",
                  excerpt: 'How gochar shapes the week ahead.',
                  coverUrl: null,
                  ctaHref: '/gochar',
                  featured: true,
                  published: true,
                  publishedAt: null,
                },
                {
                  id: '2',
                  slug: 'pujas',
                  title: 'Significance of Navratri Puja',
                  excerpt: 'Intention behind every E-Puja booking.',
                  coverUrl: null,
                  ctaHref: '/pujas',
                  featured: true,
                  published: true,
                  publishedAt: null,
                },
                {
                  id: '3',
                  slug: 'ayurveda',
                  title: 'Ayurveda for a Stronger Immunity',
                  excerpt: 'Simple dosha-aware routines.',
                  coverUrl: null,
                  ctaHref: '/ayurveda',
                  featured: true,
                  published: true,
                  publishedAt: null,
                },
              ] satisfies CmsArticle[])
          ).map((article) => (
            <Link
              key={article.id}
              href={
                article.id.length > 8
                  ? `/articles/${article.slug}`
                  : (article.ctaHref ?? `/${article.slug}`)
              }
              className="overflow-hidden rounded-2xl border border-ved-green-900/8 bg-white shadow-sm transition hover:border-ved-green-500/25"
            >
              <div className="relative h-40 bg-ved-green-100">
                {article.coverUrl ? (
                  <Image src={article.coverUrl} alt="" fill className="object-cover" sizes="33vw" />
                ) : (
                  <div className="grid h-full place-items-center text-3xl text-ved-green-600">☽</div>
                )}
              </div>
              <div className="space-y-2 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ved-gold-600">
                  Wisdom
                </p>
                <h3 className="font-display text-lg font-semibold leading-snug text-ved-green-900">
                  {article.title}
                </h3>
                <p className="line-clamp-2 text-sm text-ved-green-800/60">{article.excerpt}</p>
                <span className="text-xs font-semibold text-ved-green-700">Read More →</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <JoinUsBanner />

      <NewsletterSection />

      <ReviewsSection />

      <SiteFooter />
    </div>
  );
}

function SectionHead({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="font-display text-3xl font-semibold text-ved-green-900">{title}</h2>
      <Link href={href} className="text-sm font-medium text-ved-gold-600 hover:underline">
        {linkLabel}
      </Link>
    </div>
  );
}