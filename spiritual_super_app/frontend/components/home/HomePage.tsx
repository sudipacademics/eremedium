'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';

import { api, type Astrologer, type AyurvedaProduct, type CmsArticle, type SiteContent } from '@/lib/api';

const CATEGORIES = [
  { href: '/astrologers', label: 'Astrologers', tone: 'bg-orange-100 text-orange-700', icon: '☉' },
  { href: '/kundali', label: 'Kundali', tone: 'bg-violet-100 text-violet-700', icon: '✦' },
  { href: '/match', label: 'Match', tone: 'bg-pink-100 text-pink-700', icon: '♥' },
  { href: '/gochar', label: 'Gochar', tone: 'bg-sky-100 text-sky-700', icon: '♄' },
  { href: '/ai', label: 'Jyotish AI', tone: 'bg-cyan-100 text-cyan-700', icon: '◉' },
  { href: '/panchang', label: 'Panchang', tone: 'bg-amber-100 text-amber-700', icon: '▦' },
  { href: '/pujas', label: 'E-Puja', tone: 'bg-yellow-100 text-yellow-800', icon: '🪔' },
  { href: '/ayurveda', label: 'Ayurveda', tone: 'bg-emerald-100 text-emerald-700', icon: '🌿' },
  { href: '/ayurveda', label: 'Ayurvedic Shop', tone: 'bg-lime-100 text-lime-800', icon: '🛒' },
  { href: '/wallet', label: 'Wallet', tone: 'bg-purple-100 text-purple-700', icon: '₹' },
] as const;

const TRUST = [
  { label: 'Trusted Experts', icon: '✓' },
  { label: '100% Secure', icon: '🛡' },
  { label: 'Accurate Guidance', icon: '◎' },
  { label: '24×7 Support', icon: '☾' },
] as const;

const WHY = [
  {
    title: 'Verified Experts',
    body: 'Talk to screened Vedic astrologers with live availability and transparent per-minute rates.',
  },
  {
    title: 'Authentic Puja Services',
    body: 'Book temple rituals online and follow every step from confirmation to prasad.',
  },
  {
    title: 'Lahiri Kundali Engine',
    body: 'Swiss Ephemeris charts with Chitra Paksha ayanamsha — the same conventions as your consult.',
  },
  {
    title: 'Ayurveda Commerce',
    body: 'Dosha-tagged kits and churnas, paid securely from your Nakshya wallet.',
  },
  {
    title: 'Jyotish AI',
    body: 'Ask chart-grounded questions anytime — trial engine or cloud models when configured.',
  },
  {
    title: 'Secure & Private',
    body: 'OTP login, wallet ledger integrity, and staging gates on every public surface.',
  },
] as const;

const ARTICLES_FALLBACK = [
  {
    title: 'Moon Transit Effects on Your Life',
    excerpt: 'How gochar through nakshatras colours mood, decisions, and timing this month.',
    href: '/gochar',
    image:
      'https://images.unsplash.com/photo-1419242902214-272b3f66ee70?auto=format&fit=crop&w=600&q=80',
  },
] as const;

const STATS = [
  { value: '50K+', label: 'Happy Users' },
  { value: '500+', label: 'Verified Astrologers' },
  { value: '10K+', label: 'Pujas Performed' },
  { value: '1K+', label: 'Ayurvedic Products' },
  { value: '4.8/5', label: 'User Rating' },
] as const;

function routeForQuery(q: string): string {
  const t = q.toLowerCase();
  if (/ai|jyotish|predict/.test(t)) return '/ai';
  if (/kundali|chart|birth/.test(t)) return '/kundali';
  if (/match|guna|ashtakoot|marriage/.test(t)) return '/match';
  if (/gochar|transit/.test(t)) return '/gochar';
  if (/panchang|tithi/.test(t)) return '/panchang';
  if (/puja|ritual|temple/.test(t)) return '/pujas';
  if (/ayur|herb|product|shop/.test(t)) return '/ayurveda';
  if (/wallet|top.?up|recharge/.test(t)) return '/wallet';
  return '/astrologers';
}

export function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [site, setSite] = useState<SiteContent | null>(null);
  const [articles, setArticles] = useState<CmsArticle[]>([]);
  const [astrologers, setAstrologers] = useState<Astrologer[]>([]);
  const [products, setProducts] = useState<AyurvedaProduct[]>([]);
  const astroRail = useRef<HTMLDivElement>(null);
  const productRail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .get<SiteContent>('content/home')
      .then(setSite)
      .catch(() => undefined);
    void api
      .get<{ articles: CmsArticle[] }>('content/articles?featured=true')
      .then((res) => setArticles(res.articles.slice(0, 6)))
      .catch(() => undefined);
    void api
      .get<{ astrologers: Astrologer[] }>('astrologers?onlineOnly=false&limit=12')
      .then((res) => setAstrologers(res.astrologers))
      .catch(() => undefined);
    void api
      .get<{ products: AyurvedaProduct[] }>('ayurveda/shop/products')
      .then((res) => setProducts(res.products.slice(0, 8)))
      .catch(() => undefined);
  }, []);

  const featuredAstrologers = useMemo(() => {
    const online = astrologers.filter((a) => a.status === 'IDLE');
    const rest = astrologers.filter((a) => a.status !== 'IDLE');
    return [...online, ...rest].slice(0, 8);
  }, [astrologers]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    router.push(routeForQuery(query.trim()));
  }

  function scrollRail(ref: RefObject<HTMLDivElement | null>, dir: -1 | 1) {
    ref.current?.scrollBy({ left: dir * 280, behavior: 'smooth' });
  }

  return (
    <div className="bg-cream-100 text-navy-900">
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src={
              site?.heroImageUrl ??
              'https://images.unsplash.com/photo-1507400492013-162706c8c05e?auto=format&fit=crop&w=2000&q=80'
            }
            alt=""
            fill
            priority
            className="object-cover"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-cream-100 via-cream-100/92 to-cream-100/35" />
          <div className="absolute inset-0 bg-gradient-to-t from-cream-100 via-transparent to-cream-100/40" />
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pb-24 lg:pt-20">
          <div className="animate-fade-up max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-600">
              {site?.heroEyebrow ?? 'Ancient wisdom for a brighter tomorrow'}
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.1] text-navy-950 sm:text-5xl lg:text-[3.35rem]">
              {site?.heroTitle ?? 'Find Clarity in Every Phase of Life'}
            </h1>
            <p className="mt-4 text-base text-navy-800/80 sm:text-lg">
              {site?.heroSubtitle ??
                'Astrology · Puja · Panchang · Ayurveda · Guidance. All in one trusted platform — Nakshya.'}
            </p>

            <form
              onSubmit={onSearch}
              className="mt-8 flex overflow-hidden rounded-xl border border-navy-900/10 bg-white shadow-lg shadow-navy-900/5"
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search astrologers, puja, products, articles…"
                className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3.5 text-sm text-navy-900 placeholder:text-navy-800/40 focus:outline-none focus:ring-0"
              />
              <button type="submit" className="btn-gold rounded-none px-6">
                Search
              </button>
            </form>

            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {TRUST.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-xs text-navy-800/75">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-gold-400/20 text-[11px] text-gold-600">
                    {item.icon}
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative hidden min-h-[22rem] lg:block">
            <div className="absolute inset-0 animate-float rounded-[2rem] bg-gradient-to-br from-navy-900/20 via-gold-400/10 to-transparent" />
            <div className="absolute right-4 top-6 h-64 w-64 rounded-full border border-gold-400/40 bg-gold-400/10 blur-sm" />
            <div className="absolute bottom-8 right-10 max-w-[14rem] text-right font-display text-xl italic text-cream-50 drop-shadow-lg">
              {site?.promoQuote ?? (
                <>
                  Aligned with the Stars,
                  <br />
                  Rooted in Nature
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Category strip */}
      <section className="relative z-10 mx-auto -mt-6 max-w-7xl px-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.label}
              href={cat.href}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-navy-900/5 bg-white p-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span
                className={`grid h-11 w-11 place-items-center rounded-xl text-lg ${cat.tone} transition group-hover:scale-105`}
              >
                {cat.icon}
              </span>
              <span className="text-[11px] font-medium leading-tight text-navy-800">{cat.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Service banners */}
      <section className="mx-auto mt-12 grid max-w-7xl gap-4 px-4 md:grid-cols-3">
        <PromoCard
          href="/kundali"
          title="Generate Your Kundali Instantly"
          body="Lahiri sidereal chart with Vimshottari dasha — ready for you and your astrologer."
          cta="Create Kundali"
          image="https://images.unsplash.com/photo-1532693322450-2cb5c511067d?auto=format&fit=crop&w=900&q=80"
          overlay="from-navy-950/90 via-navy-900/70 to-navy-900/30"
        />
        <PromoCard
          href="/pujas"
          title="Perform E-Puja from Anywhere"
          body="Book authentic temple rituals and track every status through to prasad."
          cta="Book a Puja"
          image="https://images.unsplash.com/photo-1604608672516-f1b9c1d2d0c5?auto=format&fit=crop&w=900&q=80"
          overlay="from-[#3a2412]/90 via-[#5a3818]/65 to-transparent"
        />
        <PromoCard
          href="/ayurveda"
          title="Healing Through Ayurveda"
          body="Dosha-aware kits and churnas, ordered from your wallet in a few taps."
          cta="Explore Ayurveda"
          image="https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=900&q=80"
          overlay="from-emerald-950/90 via-emerald-900/60 to-transparent"
        />
      </section>

      {/* Astrologers */}
      <section className="mx-auto mt-16 max-w-7xl px-4">
        <SectionHead
          title="Our Expert Astrologers"
          subtitle="Live consults, billed by the minute — only while you are connected."
          href="/astrologers"
          linkLabel="View All"
        />
        <div className="relative">
          <RailButtons onPrev={() => scrollRail(astroRail, -1)} onNext={() => scrollRail(astroRail, 1)} />
          <div
            ref={astroRail}
            className="flex gap-4 overflow-x-auto pb-2 scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {featuredAstrologers.length === 0
              ? [0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-64 w-56 shrink-0 animate-pulse rounded-2xl bg-white/70"
                  />
                ))
              : featuredAstrologers.map((a) => (
                  <article
                    key={a.id}
                    className="w-56 shrink-0 rounded-2xl border border-navy-900/5 bg-white p-4 shadow-sm"
                  >
                    <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-gold-300 to-gold-600 font-display text-2xl font-semibold text-navy-950">
                      {a.displayName.charAt(0).toUpperCase()}
                      <span
                        className={`absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          a.status === 'IDLE'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-400 text-white'
                        }`}
                      >
                        {a.status === 'IDLE' ? 'Online' : 'Busy'}
                      </span>
                    </div>
                    <h3 className="mt-4 text-center text-sm font-semibold text-navy-950">
                      {a.displayName}
                    </h3>
                    <p className="mt-0.5 text-center text-xs text-navy-800/60">
                      {a.languages.slice(0, 2).join(' · ') || 'Vedic Astrology'}
                    </p>
                    <p className="mt-2 text-center text-xs text-amber-600">★ 4.9</p>
                    <p className="mt-1 text-center text-sm font-semibold text-navy-900">
                      ₹ {a.perMinuteRate}
                      <span className="font-normal text-navy-800/50">/min</span>
                    </p>
                    <Link
                      href="/astrologers"
                      className="mt-3 flex w-full items-center justify-center rounded-xl border border-gold-500/50 px-3 py-2 text-xs font-semibold text-gold-600 transition hover:bg-gold-400/15"
                    >
                      Consult Now
                    </Link>
                  </article>
                ))}
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="mx-auto mt-16 max-w-7xl px-4">
        <SectionHead
          title="Featured Ayurvedic Products"
          subtitle="Dosha-tagged wellness from the Nakshya shop."
          href="/ayurveda"
          linkLabel="View All Products"
        />
        <div className="relative">
          <RailButtons
            onPrev={() => scrollRail(productRail, -1)}
            onNext={() => scrollRail(productRail, 1)}
          />
          <div
            ref={productRail}
            className="flex gap-4 overflow-x-auto pb-2 scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {products.length === 0
              ? FALLBACK_PRODUCTS.map((p) => <ProductCard key={p.name} {...p} />)
              : products.map((p) => (
                  <ProductCard
                    key={p.id}
                    name={p.name}
                    benefit={p.description ?? p.suitedDoshas.join(' · ') ?? 'Ayurvedic care'}
                    price={p.price}
                    href="/ayurveda"
                  />
                ))}
          </div>
        </div>
      </section>

      {/* Why + stats */}
      <section className="mx-auto mt-16 max-w-7xl px-4">
        <h2 className="font-display text-3xl font-semibold text-navy-950">Why Choose Nakshya</h2>
        <p className="mt-1 max-w-2xl text-sm text-navy-800/70">
          One platform for chart, consult, ritual, and remedy — built for clarity, not clutter.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WHY.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-navy-900/5 bg-white p-5 shadow-sm"
            >
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy-900 text-gold-300">
                ✦
              </div>
              <h3 className="mt-3 text-sm font-semibold text-navy-950">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-navy-800/70">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 rounded-2xl bg-sage-100 px-4 py-6 sm:grid-cols-5">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="font-display text-2xl font-semibold text-navy-950">{stat.value}</p>
              <p className="mt-0.5 text-[11px] text-navy-800/65">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Articles */}
      <section className="mx-auto mt-16 max-w-7xl px-4">
        <SectionHead title="Latest from Nakshya" href="/gochar" linkLabel="View All" />
        <div className="grid gap-4 md:grid-cols-3">
          {(articles.length > 0
            ? articles.map((article) => ({
                title: article.title,
                excerpt: article.excerpt,
                href: article.ctaHref || `/articles/${article.slug}`,
                image:
                  article.coverUrl ||
                  'https://images.unsplash.com/photo-1419242902214-272b3f66ee70?auto=format&fit=crop&w=600&q=80',
              }))
            : ARTICLES_FALLBACK
          ).map((article) => (
            <Link
              key={article.title}
              href={article.href}
              className="group flex overflow-hidden rounded-2xl border border-navy-900/5 bg-white shadow-sm transition hover:shadow-md"
            >
              <div className="relative w-28 shrink-0 sm:w-32">
                <Image
                  src={article.image}
                  alt=""
                  fill
                  className="object-cover transition duration-500 group-hover:scale-105"
                  sizes="128px"
                />
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-display text-lg font-semibold leading-snug text-navy-950">
                  {article.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-navy-800/65">{article.excerpt}</p>
                <span className="mt-auto pt-3 text-xs font-semibold text-gold-600">
                  Read More →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Ayurveda banner */}
      <section className="mx-auto mt-16 max-w-7xl px-4">
        <div className="relative overflow-hidden rounded-3xl bg-sage-100 px-6 py-10 sm:px-10">
          <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-emerald-300/30 blur-2xl" />
          <div className="pointer-events-none absolute bottom-0 right-10 hidden h-28 w-40 rounded-t-full bg-emerald-600/10 sm:block" />
          <div className="relative max-w-lg">
            <h2 className="font-display text-3xl font-semibold text-navy-950">
              Embrace a Balanced Life with Ayurveda
            </h2>
            <p className="mt-2 text-sm text-navy-800/75">
              Discover dosha-aligned formulas and daily rituals — wellness rooted in nature.
            </p>
            <Link href="/ayurveda" className="btn-gold mt-6 inline-flex">
              Shop Ayurvedic Products →
            </Link>
          </div>
          <p className="absolute bottom-6 right-8 hidden font-display text-sm italic text-emerald-800/70 sm:block">
            Wellness Rooted in Nature
          </p>
        </div>
      </section>

      <HomeFooter />
    </div>
  );
}

function SectionHead({
  title,
  subtitle,
  href,
  linkLabel,
}: {
  title: string;
  subtitle?: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-3xl font-semibold text-navy-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-navy-800/65">{subtitle}</p>}
      </div>
      <Link href={href} className="shrink-0 text-sm font-semibold text-gold-600 hover:text-gold-500">
        {linkLabel} →
      </Link>
    </div>
  );
}

function RailButtons({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Previous"
        onClick={onPrev}
        className="absolute -left-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-navy-900/10 bg-white text-navy-900 shadow md:grid"
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={onNext}
        className="absolute -right-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-navy-900/10 bg-white text-navy-900 shadow md:grid"
      >
        ›
      </button>
    </>
  );
}

function PromoCard({
  href,
  title,
  body,
  cta,
  image,
  overlay,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
  image: string;
  overlay: string;
}) {
  return (
    <Link
      href={href}
      className="group relative min-h-[14rem] overflow-hidden rounded-2xl text-cream-50 shadow-md"
    >
      <Image
        src={image}
        alt=""
        fill
        className="object-cover transition duration-700 group-hover:scale-105"
        sizes="(max-width:768px) 100vw, 33vw"
      />
      <div className={`absolute inset-0 bg-gradient-to-t ${overlay}`} />
      <div className="relative flex h-full flex-col justify-end p-5">
        <h3 className="font-display text-2xl font-semibold leading-tight">{title}</h3>
        <p className="mt-2 text-sm text-cream-100/85">{body}</p>
        <span className="mt-4 inline-flex w-fit items-center rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-navy-950">
          {cta} →
        </span>
      </div>
    </Link>
  );
}

const FALLBACK_PRODUCTS = [
  { name: 'Ashwagandha Capsules', benefit: 'Immunity & Stress Relief', price: '499.00', href: '/ayurveda' },
  { name: 'Triphala Churna', benefit: 'Digestive Balance', price: '299.00', href: '/ayurveda' },
  { name: 'Brahmi Syrup', benefit: 'Focus & Calm', price: '349.00', href: '/ayurveda' },
  { name: 'Chyawanprash', benefit: 'Daily Vitality', price: '449.00', href: '/ayurveda' },
] as const;

function ProductCard({
  name,
  benefit,
  price,
  href,
}: {
  name: string;
  benefit: string;
  price: string;
  href: string;
}) {
  return (
    <article className="w-48 shrink-0 rounded-2xl border border-navy-900/5 bg-white p-3 shadow-sm">
      <div className="grid h-28 place-items-center rounded-xl bg-sage-100 text-3xl">🌿</div>
      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-navy-950">{name}</h3>
      <p className="mt-0.5 line-clamp-1 text-[11px] text-navy-800/55">{benefit}</p>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-navy-900">₹ {price}</span>
        <span className="text-amber-600">★ 4.8</span>
      </div>
      <Link
        href={href}
        className="mt-3 flex w-full items-center justify-center rounded-xl border border-gold-500/50 px-3 py-2 text-xs font-semibold text-gold-600 hover:bg-gold-400/15"
      >
        Add to Cart
      </Link>
    </article>
  );
}

function HomeFooter() {
  return (
    <footer className="mt-20 bg-navy-950 text-cream-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-[1.2fr_1fr_1fr_1.1fr]">
        <div>
          <Image
            src="/brand/vedsutra-logo.png"
            alt="Vedsutra"
            width={180}
            height={46}
            className="h-9 w-auto"
          />
          <p className="mt-2 max-w-xs text-sm text-cream-100/65">
            Your life, in harmony — astrology, ritual, and Ayurveda under one trusted roof.
          </p>
          <div className="mt-4 flex gap-3 text-xs text-cream-100/50">
            <span>FB</span>
            <span>IG</span>
            <span>YT</span>
            <span>X</span>
            <span>in</span>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-300">Quick Links</p>
          <ul className="mt-3 space-y-2 text-sm text-cream-100/70">
            <li>
              <Link href="/astrologers">Astrologers</Link>
            </li>
            <li>
              <Link href="/kundali">Kundali</Link>
            </li>
            <li>
              <Link href="/ai">Jyotish AI</Link>
            </li>
            <li>
              <Link href="/wallet">Wallet</Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-300">Our Services</p>
          <ul className="mt-3 space-y-2 text-sm text-cream-100/70">
            <li>
              <Link href="/pujas">E-Puja</Link>
            </li>
            <li>
              <Link href="/ayurveda">Ayurveda Shop</Link>
            </li>
            <li>
              <Link href="/match">Matchmaking</Link>
            </li>
            <li>
              <Link href="/gochar">Gochar</Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-300">
            Join Our Newsletter
          </p>
          <form
            className="mt-3 flex overflow-hidden rounded-xl border border-white/10 bg-white/5"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              placeholder="Email address"
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-cream-50 placeholder:text-cream-100/40 focus:outline-none"
            />
            <button type="submit" className="bg-gold-400 px-3 text-xs font-semibold text-navy-950">
              Subscribe
            </button>
          </form>
          <p className="mt-4 font-display text-sm italic text-cream-100/55">
            May the light of the stars guide you always.
          </p>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-4 text-center text-[11px] text-cream-100/45">
        © {new Date().getFullYear()} Nakshya · Sitemap · Cookie Policy · Disclaimer
      </div>
    </footer>
  );
}
