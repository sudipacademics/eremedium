'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import {
  api,
  type Astrologer,
  type AyurvedaProduct,
  type CmsArticle,
  type SiteContent,
} from '@/lib/api';

const CATEGORIES = [
  { href: '/astrologers', label: 'Astrology', tag: 'Get Clarity', icon: '✦' },
  { href: '/kundali', label: 'Kundali', tag: 'Know Your Self', icon: '◎' },
  { href: '/match', label: 'Match Making', tag: 'Build Together', icon: '⚭' },
  { href: '/gochar', label: 'Gochar', tag: 'Plan Ahead', icon: '☾' },
  { href: '/panchang', label: 'Panchang', tag: 'Auspicious Timings', icon: '☀' },
  { href: '/pujas', label: 'E-Puja', tag: 'Sacred Rituals', icon: '🕯' },
  { href: '/temple', label: 'Virtual Temple', tag: '16 Upacharas', icon: '🛕' },
  { href: '/ayurveda', label: 'Ayurveda', tag: 'Natural Wellness', icon: '🌿' },
] as const;

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

const STATS = [
  { value: '50K+', label: 'Happy Users', icon: '🍃' },
  { value: '500+', label: 'Verified Experts', icon: '✦' },
  { value: '10K+', label: 'Pujas Performed', icon: '🛕' },
  { value: '1K+', label: 'Authentic Products', icon: '🛍' },
  { value: '4.8/5', label: 'User Rating', icon: '👍' },
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
] as const;

export function HomePage() {
  const router = useRouter();
  const [site, setSite] = useState<SiteContent | null>(null);
  const [articles, setArticles] = useState<CmsArticle[]>([]);
  const [astrologers, setAstrologers] = useState<Astrologer[]>([]);
  const [products, setProducts] = useState<AyurvedaProduct[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void api.get<SiteContent>('content/home').then(setSite).catch(() => setSite(null));
    void api
      .get<{ articles: CmsArticle[] }>('content/articles?featured=true&limit=3')
      .then((res) => setArticles(res.articles))
      .catch(() => setArticles([]));
    void api
      .get<{ astrologers: Astrologer[] }>('astrologers')
      .then((res) => setAstrologers(res.astrologers.slice(0, 6)))
      .catch(() => setAstrologers([]));
    void api
      .get<{ products: AyurvedaProduct[] }>('ayurveda/shop/products')
      .then((res) => setProducts(res.products.slice(0, 8)))
      .catch(() => setProducts([]));
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

  // Brand hero copy + art are fixed to the Vedsutra mock; CMS only supplies the quote.
  const promoQuote = site?.promoQuote?.trim() || 'Aligned with the Stars, Rooted in Nature';
  const heroImage = '/brand/vedsutra-hero-mandala.png';
  const heroEyebrow = 'Ancient wisdom for a brighter tomorrow';
  const heroSubtitle =
    'Astrology | Puja | Panchang | Ayurveda — all in one trusted platform – Vedsutra';

  return (
    <div className="bg-[#F7F4EE] text-ved-green-900">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ved-green-900/5 bg-[#F7F4EE]">
        <div className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full bg-ved-gold-200/50 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 lg:grid-cols-2 lg:py-16">
          <div className="animate-fade-up">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ved-gold-600">
              {heroEyebrow}
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.15] text-ved-green-900 sm:text-5xl lg:text-[3.4rem]">
              Your Life, Guided by <span className="text-ved-gold-500">Vedic Wisdom</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ved-green-800/70">
              {heroSubtitle}
            </p>
            <form
              onSubmit={onSearch}
              className="mt-8 flex overflow-hidden rounded-full border border-ved-green-900/10 bg-white shadow-[0_8px_30px_rgba(11,79,69,0.08)]"
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
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3">
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
          </div>

          <div className="relative mx-auto aspect-[4/5] w-full max-w-md animate-float lg:max-w-lg">
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-ved-gold-300/50 to-ved-green-200/40 blur-2xl" />
            <div className="relative h-full overflow-hidden rounded-[2rem] border border-ved-gold-400/40 bg-[#F7F4EE] shadow-xl">
              <Image
                src={heroImage}
                alt="Vedic mandala and diya"
                fill
                unoptimized
                className="object-cover object-center"
                sizes="(max-width: 1024px) 90vw, 40vw"
                priority
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" />
              <p className="absolute bottom-5 right-5 max-w-[11rem] text-right font-display text-base italic leading-snug text-white drop-shadow">
                {promoQuote}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.label}
              href={cat.href}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-ved-gold-400/30 bg-[#FBF8F2] px-2 py-4 text-center transition hover:-translate-y-0.5 hover:border-ved-green-500/40 hover:shadow-md"
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-white text-lg text-ved-gold-600 shadow-sm ring-1 ring-ved-gold-400/20 transition group-hover:scale-105">
                {cat.icon}
              </span>
              <span className="text-xs font-semibold text-ved-green-900">{cat.label}</span>
              <span className="text-[10px] text-ved-green-800/50">{cat.tag}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA banners */}
      <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-12 md:grid-cols-3">
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
              sizes="33vw"
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

      {/* Astrologers */}
      {astrologers.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-12">
          <SectionHead title="Consult Experts" href="/astrologers" linkLabel="See all" />
          <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
            {astrologers.map((a) => (
              <Link
                key={a.id}
                href="/astrologers"
                className="w-52 shrink-0 space-y-2 rounded-2xl border border-ved-green-900/8 bg-white p-4 shadow-sm transition hover:border-ved-green-500/25"
              >
                <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-ved-gold-300 to-ved-gold-500 font-display text-xl text-ved-green-950">
                  {a.displayName.slice(0, 1)}
                </div>
                <p className="font-semibold text-ved-green-900">{a.displayName}</p>
                <p className="text-xs text-ved-green-800/55">
                  ₹{a.perMinuteRate}/min · {a.status}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Products */}
      {products.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-12">
          <SectionHead title="Featured Ayurvedic Products" href="/ayurveda" linkLabel="Shop all" />
          <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
            {products.map((p) => (
              <article
                key={p.id}
                className="w-52 shrink-0 space-y-2 rounded-2xl border border-ved-green-900/8 bg-white p-3 shadow-sm"
              >
                <div className="grid h-28 place-items-center rounded-xl bg-ved-cream-200 text-3xl">🌿</div>
                <p className="line-clamp-2 text-sm font-semibold text-ved-green-900">{p.name}</p>
                <p className="text-xs text-ved-green-800/55">{p.suitedDoshas.join(' · ') || 'Ayurveda'}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-ved-green-900">₹{p.price}</span>
                  <Link
                    href="/ayurveda"
                    className="rounded-full bg-ved-green-800 px-3 py-1 text-[11px] font-semibold text-white"
                  >
                    View
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Stats */}
      <section className="border-y border-ved-green-900/5 bg-[#F1EDE4]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-10 sm:grid-cols-3 lg:grid-cols-5">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-xl">{stat.icon}</p>
              <p className="mt-1 font-display text-2xl font-semibold text-ved-gold-600 sm:text-3xl">
                {stat.value}
              </p>
              <p className="mt-1 text-sm text-ved-green-800/65">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

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

      {/* Newsletter */}
      <section className="border-t border-ved-green-900/5 bg-[#F1EDE4]">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 md:flex-row md:items-center">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ved-green-900">Stay Connected</h2>
            <p className="mt-1 text-sm text-ved-green-800/65">
              Muhurta tips, gochar notes, and shop drops — gently, in your inbox.
            </p>
          </div>
          <form
            className="flex w-full max-w-md overflow-hidden rounded-full border border-ved-green-900/10 bg-white"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              placeholder="Email address"
              className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
            />
            <button
              type="submit"
              className="m-1 rounded-full bg-ved-green-800 px-5 py-2 text-sm font-semibold text-white"
            >
              Subscribe
            </button>
          </form>
        </div>
      </section>

      <HomeFooter />
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

function HomeFooter() {
  return (
    <footer className="bg-ved-green-950 text-cream-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Image
            src="/brand/vedsutra-logo.png"
            alt="Vedsutra"
            width={180}
            height={46}
            className="h-9 w-auto brightness-110"
          />
          <p className="mt-3 max-w-xs text-sm text-cream-100/65">
            Your life, in harmony — astrology, ritual, and Ayurveda under one trusted roof.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Explore</p>
          <ul className="mt-3 space-y-2 text-sm text-cream-100/70">
            <li>
              <Link href="/astrologers">Astrology</Link>
            </li>
            <li>
              <Link href="/pujas">E-Puja</Link>
            </li>
            <li>
              <Link href="/ayurveda">Shop</Link>
            </li>
            <li>
              <Link href="/panchang">Panchang</Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Company</p>
          <ul className="mt-3 space-y-2 text-sm text-cream-100/70">
            <li>
              <Link href="/gochar">Learn</Link>
            </li>
            <li>
              <Link href="/ai">Jyotish AI</Link>
            </li>
            <li>
              <Link href="/login">Login</Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Support</p>
          <ul className="mt-3 space-y-2 text-sm text-cream-100/70">
            <li>
              <Link href="/wallet">Wallet</Link>
            </li>
            <li>
              <Link href="/profile">Profile</Link>
            </li>
            <li>
              <Link href="/admin">Admin</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-4 text-[11px] text-cream-100/45">
        <span>© {new Date().getFullYear()} Vedsutra. All rights reserved.</span>
        <span>Made with care for a better tomorrow.</span>
      </div>
    </footer>
  );
}
