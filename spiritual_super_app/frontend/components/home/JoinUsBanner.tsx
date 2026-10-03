import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const BENEFITS: { label: string; icon: ReactNode }[] = [
  {
    label: 'Connect with Thousands of Seekers',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="7" r="3" />
        <circle cx="5" cy="10" r="2.2" />
        <circle cx="19" cy="10" r="2.2" />
        <path d="M6.5 20a5.5 5.5 0 0 1 11 0M1.5 19a3.6 3.6 0 0 1 5-3.3M22.5 19a3.6 3.6 0 0 0-5-3.3" />
      </svg>
    ),
  },
  {
    label: 'Flexible Work Options',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
        <circle cx="15.5" cy="15.5" r="2.8" />
        <path d="M15.5 14.3v1.3l.9.6" />
      </svg>
    ),
  },
  {
    label: 'Earn with Your Expertise',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 8h7M8.5 11h7M12.5 8c2 0 2 6-4 6l5 4" />
      </svg>
    ),
  },
  {
    label: 'Trusted & Secure Platform',
    icon: (
      <svg {...iconProps}>
        <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" />
        <path d="M8.5 12l2.5 2.5 4.5-5" />
      </svg>
    ),
  },
];

/** Role chips floating over the artwork on large screens; positions are % of the image panel. */
const ROLES = [
  { label: 'Astrologer', glyph: '☉', className: 'left-[16%] top-[10%]' },
  { label: 'Numerologist', glyph: '९', className: 'left-[12%] top-[60%]' },
  { label: 'Ayurveda Expert', glyph: '❦', className: 'right-[4%] top-[20%]' },
  { label: 'Vastu Expert', glyph: '✣', className: 'right-[7%] top-[42%]' },
] as const;

export function JoinUsBanner() {
  return (
    <section aria-labelledby="join-us-title" className="mx-auto max-w-7xl px-4 pb-12">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#FBF6EC] via-[#F7F0E1] to-[#F1E6CF] shadow-[0_20px_50px_-25px_rgba(11,79,69,0.35)] ring-1 ring-ved-gold-400/30">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-ved-gold-200/40 blur-3xl" />

        <div className="relative aspect-[4/3] w-full sm:aspect-[16/9] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[56%]">
          <Image
            src="/home/join-us-experts.webp"
            alt="A Vedic astrologer and an Ayurveda expert, each working at their own desk"
            fill
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="object-cover object-[70%_center] lg:object-center"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#F7F0E1] to-transparent lg:inset-y-0 lg:left-0 lg:h-auto lg:w-2/5 lg:bg-gradient-to-r lg:from-[#F8F2E5] lg:via-[#F8F2E5]/70" />
          <ul className="hidden lg:block" aria-label="Roles we are hiring for">
            {ROLES.map((role) => (
              <li
                key={role.label}
                className={`absolute flex items-center gap-2 rounded-full border border-ved-gold-400/50 bg-white/90 py-1.5 pl-1.5 pr-3.5 text-xs font-semibold text-ved-green-900 shadow-md backdrop-blur ${role.className}`}
              >
                <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-ved-gold-50 text-sm text-ved-gold-600 ring-1 ring-ved-gold-400/40">
                  {role.glyph}
                </span>
                {role.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative px-6 pb-8 pt-2 sm:px-10 sm:pb-10 lg:w-[50%] lg:py-12 lg:pl-12 lg:pr-4">
          <div className="flex items-center gap-3">
            <Image src="/brand/vedsutra-logo.png" alt="Vedsutra" width={979} height={206} className="h-6 w-auto" />
            <span aria-hidden className="h-5 w-px bg-ved-gold-400/60" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ved-gold-600 sm:text-[11px]">
              Join a purpose beyond profession
            </p>
          </div>

          <h2 id="join-us-title" className="mt-4 font-display text-5xl font-semibold leading-none text-ved-green-900 sm:text-6xl lg:text-7xl">
            Join <span className="text-ved-gold-500">Us</span>
          </h2>
          <p className="mt-3 font-display text-xl font-semibold text-ved-green-800 sm:text-2xl">
            Share Vedic Wisdom. Create a Brighter Tomorrow.
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ved-green-800/75 sm:text-[15px]">
            Join Vedsutra as an Astrologer, Numerologist, Vastu Expert, Ayurveda Expert or Spiritual Guide, and be part of
            a trusted platform that brings ancient wisdom to millions.
          </p>

          <ul className="mt-6 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-ved-gold-400/30">
            {BENEFITS.map((benefit) => (
              <li key={benefit.label} className="flex flex-col items-center gap-2 px-2 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-white p-3 text-ved-gold-600 shadow-sm ring-1 ring-ved-gold-400/40">
                  {benefit.icon}
                </span>
                <span className="text-xs font-medium leading-snug text-ved-green-900">{benefit.label}</span>
              </li>
            ))}
          </ul>

          <div className="mt-7 flex items-center gap-4">
            <Link
              href="/join"
              className="inline-flex items-center gap-2 rounded-full bg-ved-green-800 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_10px_25px_-10px_rgba(11,79,69,0.7)] ring-1 ring-ved-gold-400/40 transition hover:bg-ved-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400 sm:text-base"
            >
              Join as an Expert <span aria-hidden>→</span>
            </Link>
            <span aria-hidden className="hidden h-px flex-1 max-w-[10rem] bg-gradient-to-r from-ved-gold-400/70 to-transparent sm:block" />
          </div>
        </div>
      </div>
    </section>
  );
}
