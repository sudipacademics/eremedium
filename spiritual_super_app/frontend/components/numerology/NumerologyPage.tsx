'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { SiteFooter } from '@/components/SiteFooter';
import { CAROUSEL_ARROW, useCarousel } from '@/components/home/useCarousel';
import { api, youtubeEmbedUrl, type CmsArticle, type NumerologyReading } from '@/lib/api';

import { NumerologyCalculator } from './NumerologyCalculator';
import { NumerologyReport } from './NumerologyReport';

const ICON = {
  viewBox: '0 0 24 24',
  className: 'h-full w-full',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const ICONS = {
  person: (
    <svg {...ICON}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  lotus: (
    <svg {...ICON}>
      <path d="M12 20c-4 0-8-2-9-6 3 0 6 1 9 4 3-3 6-4 9-4-1 4-5 6-9 6z" />
      <path d="M12 18c-2-2-3-5-3-8 1-2 2-4 3-6 1 2 2 4 3 6 0 3-1 6-3 8z" />
    </svg>
  ),
  heart: (
    <svg {...ICON} fill="currentColor" stroke="none">
      <path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" />
    </svg>
  ),
  briefcase: (
    <svg {...ICON}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </svg>
  ),
  star: (
    <svg {...ICON} fill="currentColor" stroke="none">
      <path d="m12 2 3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z" />
    </svg>
  ),
  path: (
    <svg {...ICON}>
      <path d="M8 21c0-5 8-5 8-10a4 4 0 0 0-8 0" />
      <circle cx="12" cy="4" r="1" />
    </svg>
  ),
  couple: (
    <svg {...ICON}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M2 20a6 6 0 0 1 12 0M10 20a6 6 0 0 1 12 0" />
    </svg>
  ),
  chart: (
    <svg {...ICON}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
  shield: (
    <svg {...ICON}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  medal: (
    <svg {...ICON}>
      <circle cx="12" cy="14" r="6" />
      <path d="M8 3h8l-2 5h-4zM12 11v6M10 14h4" />
    </svg>
  ),
  clock: (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  sparkle: (
    <svg {...ICON}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </svg>
  ),
  form: (
    <svg {...ICON}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
  calculator: (
    <svg {...ICON}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" strokeWidth={2.2} />
    </svg>
  ),
  report: (
    <svg {...ICON}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  ),
  chat: (
    <svg {...ICON}>
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z" />
    </svg>
  ),
  bulb: (
    <svg {...ICON}>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" />
    </svg>
  ),
  users: (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
    </svg>
  ),
  gem: (
    <svg {...ICON}>
      <path d="M6 3h12l3 6-9 12L3 9z" />
      <path d="M3 9h18M9 3l3 6 3-6M12 21 9 9M12 21l3-12" />
    </svg>
  ),
} satisfies Record<string, ReactNode>;

const TRUST = [
  { label: '100% Vedic Principles', icon: ICONS.shield },
  { label: 'Trusted Experts', icon: ICONS.medal },
  { label: 'Quick & Accurate', icon: ICONS.clock },
  { label: 'Personalized Insights', icon: ICONS.sparkle },
] as const;

const BENEFITS = [
  { label: 'Understand Your Personality', icon: ICONS.person, tone: 'bg-[#FDF3E7] text-[#C27A2C]' },
  { label: 'Find Your Life Purpose', icon: ICONS.lotus, tone: 'bg-[#F3EEFB] text-[#7B5BB5]' },
  { label: 'Improve Relationships', icon: ICONS.heart, tone: 'bg-[#FCEEF0] text-[#D2435B]' },
  { label: 'Get Career Guidance', icon: ICONS.briefcase, tone: 'bg-[#EAF5EF] text-ved-green-600' },
  { label: 'Make Better Life Decisions', icon: ICONS.star, tone: 'bg-[#FDF1E6] text-[#D9772B]' },
] as const;

/** `target` is the report card each insight scrolls to once a report exists. */
const INSIGHTS = [
  {
    title: 'Life Path Number',
    body: 'Reveals your core personality, strengths and life purpose.',
    icon: ICONS.path,
    tone: 'bg-[#FDF3E7] text-[#C27A2C]',
    target: 'report-lifePath',
  },
  {
    title: 'Destiny Number',
    body: 'Shows your natural talents and what you are meant to achieve.',
    icon: ICONS.star,
    tone: 'bg-[#FDF1E6] text-[#D9772B]',
    target: 'report-destiny',
  },
  {
    title: 'Soul Urge Number',
    body: 'Uncovers your inner desires, emotions and true motivations.',
    icon: ICONS.heart,
    tone: 'bg-[#FCEEF0] text-[#D2435B]',
    target: 'report-soulUrge',
  },
  {
    title: 'Compatibility',
    body: 'Understand relationship harmony through numbers.',
    icon: ICONS.couple,
    tone: 'bg-[#FCEEF0] text-[#C0506A]',
    target: 'report-compatibility',
  },
  {
    title: 'Career Guidance',
    body: 'Find the right career path aligned with your numbers.',
    icon: ICONS.chart,
    tone: 'bg-[#F3EEFB] text-[#7B5BB5]',
    target: 'report-career',
  },
] as const;

const STEPS = [
  { title: 'Enter Your Details', body: 'Provide your name and date of birth', icon: ICONS.form },
  { title: 'We Calculate', body: 'Our system analyzes your numbers using Vedic numerology', icon: ICONS.calculator },
  { title: 'Get Your Report', body: 'Receive detailed insights about your life path and more', icon: ICONS.report },
] as const;

const EXPERT_POINTS = [
  { label: 'Live Chat or Call', icon: ICONS.chat },
  { label: 'Personalized Solutions', icon: ICONS.bulb },
  { label: 'Relationship & Career Guidance', icon: ICONS.users },
  { label: 'Remedies & Suggestions', icon: ICONS.gem },
] as const;

interface GuideCard {
  key: string;
  title: string;
  href: string;
  meta: string;
  cover: { src: string; position: string } | null;
  numeral?: string;
}

/** Shown until the blog has numerology articles; each links to the part of this page it summarises. */
const BUILT_IN_GUIDES: readonly GuideCard[] = [
  {
    key: 'beginners',
    title: 'A Beginner’s Guide to Numerology',
    href: '#what-is-numerology',
    meta: 'Guide · 3 min read',
    cover: { src: '/numerology/hero.webp', position: '75% 40%' },
  },
  {
    key: 'life-path',
    title: 'How to Calculate Your Life Path Number',
    href: '#how-it-works',
    meta: 'Guide · 2 min read',
    cover: null,
    numeral: '7',
  },
  {
    key: 'relationships',
    title: 'Numerology and Relationships',
    href: '#insights',
    meta: 'Guide · 3 min read',
    cover: { src: '/numerology/video.webp', position: '60% 60%' },
  },
  {
    key: 'career',
    title: 'Numerology for Career Success',
    href: '#insights',
    meta: 'Guide · 3 min read',
    cover: null,
    numeral: '8',
  },
  {
    key: 'lucky',
    title: 'Lucky Numbers and How to Use Them',
    href: '#calculator',
    meta: 'Guide · 2 min read',
    cover: { src: '/numerology/scroll.webp', position: '45% 60%' },
  },
];

function isNumerologyArticle(article: CmsArticle): boolean {
  return /numerolog|life path|lucky number/i.test(`${article.title} ${article.excerpt}`);
}

function articleCard(article: CmsArticle): GuideCard {
  return {
    key: article.id,
    title: article.title,
    href: `/articles/${article.slug}`,
    meta: article.publishedAt
      ? new Date(article.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Article',
    cover: article.coverUrl ? { src: article.coverUrl, position: 'center' } : null,
  };
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-display text-3xl font-semibold text-ved-green-900 sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-ved-green-800/60">{subtitle}</p>}
    </div>
  );
}

function ExplainerVideo({ youtubeId }: { youtubeId: string | null }) {
  const [playing, setPlaying] = useState(false);

  if (youtubeId && playing) {
    return (
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ved-green-950 shadow-lg">
        <iframe
          src={youtubeEmbedUrl(youtubeId)}
          title="Understand Numerology"
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  const cover = (
    <>
      <Image src="/numerology/video.webp" alt="" fill className="object-cover transition duration-700 group-hover:scale-105" sizes="(min-width: 1024px) 40vw, 100vw" />
      <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
    </>
  );

  if (!youtubeId) {
    return (
      <div className="group relative aspect-video overflow-hidden rounded-2xl shadow-lg">
        {cover}
        <p className="absolute bottom-4 left-5 font-display text-lg text-white">Numbers carry a divine vibration</p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="group relative block aspect-video w-full overflow-hidden rounded-2xl text-left shadow-lg"
      aria-label="Watch video to understand numerology"
    >
      {cover}
      <span className="absolute bottom-4 left-5 flex items-center gap-3 text-white">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-ved-gold-400 text-ved-green-950 shadow-lg transition group-hover:scale-110">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M7 4v16l13-8z" />
          </svg>
        </span>
        <span className="text-sm font-semibold leading-tight">
          Watch Video
          <span className="block font-normal text-white/80">to Understand Numerology</span>
        </span>
      </span>
    </button>
  );
}

function GuideCover({ card }: { card: GuideCard }) {
  if (card.cover) {
    return (
      <Image
        src={card.cover.src}
        alt=""
        fill
        unoptimized={card.cover.src.startsWith('http') || card.cover.src.startsWith('data:')}
        className="object-cover transition duration-500 group-hover:scale-105"
        style={{ objectPosition: card.cover.position }}
        sizes="(min-width: 1024px) 20vw, 70vw"
      />
    );
  }
  return (
    <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_40%,#1f5c50,#031814)]">
      <span className="grid h-20 w-20 place-items-center rounded-full border border-ved-gold-300/50 font-display text-5xl text-ved-gold-300 shadow-[0_0_40px_rgba(201,166,74,0.35)]">
        {card.numeral ?? '✦'}
      </span>
    </div>
  );
}

function GuidesCarousel({ cards }: { cards: readonly GuideCard[] }) {
  const { track, edges, measure, scroll } = useCarousel(cards.length);
  return (
    <section className="mx-auto max-w-7xl px-4 py-12" aria-label="Learn more about numerology">
      <div className="flex items-end justify-between gap-3">
        <SectionTitle title="Learn More About Numerology" subtitle="Articles, guides and tips to help you understand the power of numbers" />
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/articles" className="hidden text-sm font-semibold text-ved-green-700 hover:underline sm:inline">
            View All Articles →
          </Link>
          <button type="button" className={CAROUSEL_ARROW} onClick={() => scroll(-1)} disabled={edges.start} aria-label="Previous articles">
            ‹
          </button>
          <button type="button" className={CAROUSEL_ARROW} onClick={() => scroll(1)} disabled={edges.end} aria-label="Next articles">
            ›
          </button>
        </div>
      </div>
      <ul ref={track} onScroll={measure} className="scrollbar-none mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2">
        {cards.map((card) => (
          <li key={card.key} className="w-[70%] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-4rem)/5)]">
            <Link
              href={card.href}
              onClick={(event) => {
                if (card.href.startsWith('#')) {
                  event.preventDefault();
                  scrollToId(card.href.slice(1));
                }
              }}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ved-green-900/8 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-ved-green-900">
                <GuideCover card={card} />
              </div>
              <div className="flex flex-1 flex-col justify-between gap-3 p-4">
                <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ved-green-900">{card.title}</h3>
                <p className="text-[11px] text-ved-green-800/50">{card.meta}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/articles" className="mt-4 inline-block text-sm font-semibold text-ved-green-700 hover:underline sm:hidden">
        View All Articles →
      </Link>
    </section>
  );
}

export function NumerologyPage() {
  const [reading, setReading] = useState<NumerologyReading | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [guides, setGuides] = useState<readonly GuideCard[]>(BUILT_IN_GUIDES);

  useEffect(() => {
    void api
      .get<{ videoYoutubeId: string | null }>('content/numerology')
      .then((res) => setVideoId(res.videoYoutubeId))
      .catch(() => setVideoId(null));
    void api
      .get<{ articles: CmsArticle[] }>('content/articles')
      .then((res) => {
        const related = res.articles.filter(isNumerologyArticle).slice(0, 5).map(articleCard);
        if (related.length > 0) setGuides([...related, ...BUILT_IN_GUIDES].slice(0, Math.max(5, related.length)));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reading) requestAnimationFrame(() => scrollToId('report'));
  }, [reading]);

  function openInsight(target: string) {
    if (reading) {
      scrollToId(target);
      return;
    }
    scrollToId('calculator');
    window.setTimeout(() => document.querySelector<HTMLInputElement>('#calculator input[name="fullName"]')?.focus(), 450);
  }

  return (
    <div className="bg-[#F7F4EE] text-ved-green-900">
      {/* Hero */}
      <section className="relative overflow-hidden bg-ved-green-950 text-white">
        <Image src="/numerology/hero.webp" alt="" fill priority className="object-cover object-[70%_center]" sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#031814] via-[#031814]/85 to-[#031814]/10 md:via-[#031814]/60" />
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-6 sm:pb-14">
          <nav aria-label="Breadcrumb" className="text-xs text-white/60">
            <Link href="/" className="hover:text-white">
              Home
            </Link>
            <span className="mx-2">›</span>
            <span className="text-white/85">Numerology</span>
          </nav>
          <div className="max-w-xl pt-8 sm:pt-12">
            <h1 className="font-display text-5xl font-semibold text-ved-gold-300 sm:text-6xl">Numerology</h1>
            <p className="mt-3 font-display text-2xl leading-snug text-white sm:text-3xl">
              Decode Your Numbers,
              <br />
              Discover Your True Self
            </p>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/75">
              Numbers carry a divine vibration that influences your personality, relationships, career, health and life
              path. Explore personalized numerology insights and take a step towards a more balanced and successful life.
            </p>
            <button
              type="button"
              onClick={() => openInsight('report')}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-ved-gold-400 px-5 py-3 text-sm font-semibold text-ved-green-950 shadow-lg transition hover:bg-ved-gold-300"
            >
              Get Your Free Numerology Report <span aria-hidden>→</span>
            </button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/80">
            {TRUST.map((item) => (
              <li key={item.label} className="flex items-center gap-2">
                <span className="h-4 w-4 text-ved-gold-300">{item.icon}</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-7xl px-4 py-8">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {BENEFITS.map((benefit) => (
            <li
              key={benefit.label}
              className="flex flex-col items-center gap-3 rounded-2xl border border-ved-gold-400/20 bg-white/70 px-3 py-5 text-center shadow-sm last:col-span-2 sm:last:col-span-1"
            >
              <span className={`grid h-12 w-12 place-items-center rounded-full p-3 ${benefit.tone}`}>{benefit.icon}</span>
              <span className="text-xs font-semibold leading-snug text-ved-green-900 sm:text-sm">{benefit.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* What is numerology + calculator */}
      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-12 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        <div id="what-is-numerology" className="scroll-mt-24">
          <h2 className="font-display text-3xl font-semibold text-ved-green-900 sm:text-4xl">What is Numerology?</h2>
          <span className="mt-3 block h-0.5 w-14 rounded bg-ved-gold-400" />
          <p className="mt-5 text-sm leading-relaxed text-ved-green-800/75 sm:text-base">
            Numerology is an ancient Vedic science that studies the mystical relationship between numbers and human life.
            Each number carries a unique vibration that influences your personality, strengths, challenges, relationships,
            career and destiny.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ved-green-800/75 sm:text-base">
            By understanding your key numbers, you can gain clarity, make better decisions and align with your true life
            path.
          </p>
          <button
            type="button"
            onClick={() => scrollToId('insights')}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-ved-gold-400/70 bg-white px-5 py-2.5 text-sm font-semibold text-ved-green-800 transition hover:bg-ved-gold-50"
          >
            Learn More About Numerology <span aria-hidden>→</span>
          </button>
          <div className="mt-8">
            <ExplainerVideo youtubeId={videoId} />
          </div>
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <NumerologyCalculator onResult={setReading} />
        </div>
      </section>

      {reading && (
        <NumerologyReport
          reading={reading}
          onReset={() => {
            setReading(null);
            requestAnimationFrame(() => scrollToId('calculator'));
          }}
        />
      )}

      {/* Key insights */}
      <section id="insights" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
        <SectionTitle title="Key Numerology Insights" subtitle="Explore the most important numbers in your numerology chart" />
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {INSIGHTS.map((insight) => (
            <li key={insight.title}>
              <button
                type="button"
                onClick={() => openInsight(insight.target)}
                className="group flex h-full w-full flex-col rounded-2xl border border-ved-green-900/8 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-ved-gold-400/50 hover:shadow-md"
              >
                <span className="flex items-center gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full p-2.5 ${insight.tone}`}>{insight.icon}</span>
                  <span className="text-sm font-semibold text-ved-green-900">{insight.title}</span>
                </span>
                <span className="mt-3 flex-1 text-xs leading-relaxed text-ved-green-800/60">{insight.body}</span>
                <span className="mt-4 grid h-8 w-8 place-items-center rounded-full border border-ved-gold-400/60 text-ved-gold-600 transition group-hover:bg-ved-gold-400 group-hover:text-ved-green-950">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative scroll-mt-20 overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-6 px-4 py-12 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <SectionTitle title="How does a Numerology Calculator work?" />
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ved-green-800/70">
              Our calculator uses your name and date of birth to generate your key numerology numbers based on Vedic
              numerology principles. These numbers reveal important insights about your personality, life path, destiny,
              relationships, career and more.
            </p>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3 sm:gap-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative flex items-start gap-3">
                  <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#F3EEFB] p-3 text-[#7B5BB5]">
                    {step.icon}
                    <span className="absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[#7B5BB5] text-[10px] font-bold text-white">
                      {index + 1}
                    </span>
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ved-green-900">{step.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ved-green-800/60">{step.body}</span>
                  </span>
                  {index < STEPS.length - 1 && (
                    <span aria-hidden className="absolute -right-3 top-3 hidden text-ved-green-800/30 sm:block">
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
          <div className="relative mx-auto aspect-[4/3] w-full max-w-sm lg:max-w-none">
            <Image src="/numerology/scroll.webp" alt="" fill className="object-contain mix-blend-multiply" sizes="(min-width: 1024px) 33vw, 80vw" />
          </div>
        </div>
      </section>

      <GuidesCarousel cards={guides} />

      {/* Expert CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-14">
        <div className="grid overflow-hidden rounded-3xl bg-gradient-to-r from-[#F6EAD2] via-[#FBF3E3] to-[#F7EBD5] shadow-sm ring-1 ring-ved-gold-400/25 md:grid-cols-[0.9fr_1.3fr_1fr]">
          <div className="relative min-h-[14rem]">
            <Image src="/numerology/expert.webp" alt="" fill className="object-cover object-[65%_20%]" sizes="(min-width: 768px) 28vw, 100vw" />
            <span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-ved-gold-700 shadow">
              1:1 Guidance
            </span>
          </div>
          <div className="flex flex-col justify-center p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold leading-tight text-ved-green-900 sm:text-3xl">
              Get Personalized Guidance from Our Expert Numerologists
            </h2>
            <p className="mt-2 text-sm text-ved-green-800/70">
              Discuss your numerology chart, career, relationships and life path with experienced Vedsutra numerologists.
            </p>
            <Link
              href="/astrologers"
              className="mt-5 inline-flex w-fit items-center gap-2 rounded-lg bg-ved-green-800 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-ved-green-700"
            >
              Talk to a Numerologist <span aria-hidden>→</span>
            </Link>
          </div>
          <ul className="flex flex-col justify-center gap-3 border-t border-ved-gold-400/25 p-6 md:border-l md:border-t-0">
            {EXPERT_POINTS.map((point) => (
              <li key={point.label} className="flex items-center gap-3 text-sm font-medium text-ved-green-900">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white p-1.5 text-ved-gold-600 shadow-sm">
                  {point.icon}
                </span>
                {point.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
