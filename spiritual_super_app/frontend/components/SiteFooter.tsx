'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { FooterSettings } from '@/lib/api';
import { loadFooterSettings } from '@/lib/footer';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/social';

const EXPLORE = [
  { href: '/articles', label: 'Blog' },
  { href: '/knowledge', label: 'Knowledge' },
  { href: '/gochar', label: 'Learn' },
] as const;

const SUPPORT = [
  { href: '/help', label: 'Help Centre' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/faq', label: 'FAQ' },
  { href: '/privacy-policy', label: 'Privacy Policy' },
] as const;

const LEGAL = [
  { href: '/disclaimer', label: 'Disclaimer' },
  { href: '/terms', label: 'Terms & Conditions' },
  { href: '/refund-policy', label: 'Refund Policy' },
  { href: '/data-protection', label: 'Data Protection Policy' },
] as const;

function SocialIcon({ platform }: { platform: SocialPlatform }) {
  const common = { viewBox: '0 0 24 24', className: 'h-4 w-4', 'aria-hidden': true } as const;
  switch (platform) {
    case 'instagram':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...common} fill="currentColor">
          <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H7.9v3h2.6V21h3z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...common} fill="currentColor">
          <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common} fill="currentColor">
          <path d="M17.7 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L1.8 3h6.4l4.4 5.9L17.7 3zm-1.1 16.2h1.7L7.5 4.7H5.7l10.9 14.5z" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg {...common} fill="currentColor">
          <path d="M6.9 8.8H3.6V20h3.3V8.8zM5.2 3.5a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM20.4 13.6c0-3-1.6-4.9-4.3-4.9-1.4 0-2.4.7-2.8 1.4V8.8h-3.2V20h3.3v-5.6c0-1.5.3-2.9 2.1-2.9 1.8 0 1.8 1.7 1.8 3V20h3.3v-6.4z" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...common} fill="currentColor">
          <path d="M12 2.5a9.4 9.4 0 0 0-8.1 14.2L2.5 21.5l4.9-1.3A9.4 9.4 0 1 0 12 2.5zm0 17.1c-1.4 0-2.8-.4-4-1.1l-.3-.2-2.9.8.8-2.8-.2-.3a7.7 7.7 0 1 1 6.6 3.6zm4.2-5.8c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.3 6.3 0 0 1-3.1-2.7c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1c0 1.2.9 2.4 1 2.6.1.2 1.8 2.7 4.3 3.8 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.3z" />
        </svg>
      );
  }
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="currentColor" aria-hidden>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function PlayLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden>
      <path d="M3.6 1.8 13.4 12 3.6 22.2A1.3 1.3 0 0 1 3 21.1V2.9a1.3 1.3 0 0 1 .6-1.1z" fill="#4285F4" />
      <path d="M3.6 1.8 16.8 8.9 13.4 12z" fill="#34A853" />
      <path d="M3.6 22.2 13.4 12l3.4 3.1z" fill="#EA4335" />
      <path d="M16.8 8.9 20.4 10.9a1.3 1.3 0 0 1 0 2.2l-3.6 2L13.4 12z" fill="#FBBC04" />
    </svg>
  );
}

function StoreBadge({
  href,
  logo,
  caption,
  store,
}: {
  href: string | null | undefined;
  logo: ReactNode;
  caption: string;
  store: string;
}) {
  const body = (
    <>
      {logo}
      <span className="leading-tight">
        <span className="block text-[9px] uppercase tracking-wide text-cream-100/70">{caption}</span>
        <span className="block text-[15px] font-semibold text-cream-50">{store}</span>
      </span>
    </>
  );
  const base =
    'flex h-12 w-[10.5rem] items-center gap-2.5 rounded-xl border px-3 text-cream-50 transition';

  if (!href) {
    return (
      <span
        className={`${base} cursor-default border-white/10 bg-black/30 opacity-60`}
        title={`${store} — coming soon`}
        aria-label={`${store} app coming soon`}
      >
        {body}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${caption} ${store}`}
      className={`${base} border-white/20 bg-black hover:border-ved-gold-400/60`}
    >
      {body}
    </a>
  );
}

function LinkColumn({ title, links }: { title: string; links: ReadonlyArray<{ href: string; label: string }> }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-cream-100/70">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="hover:text-cream-50">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  const [settings, setSettings] = useState<FooterSettings | null>(null);

  useEffect(() => {
    let live = true;
    void loadFooterSettings().then((loaded) => {
      if (live) setSettings(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  const socials = SOCIAL_PLATFORMS.map((info) => ({ ...info, href: settings?.[info.field] ?? null })).filter(
    (link) => link.core || link.href,
  );

  return (
    <footer className="bg-ved-green-950 text-cream-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]">
        <div>
          <Link href="/" className="inline-block text-[1.75rem] font-bold leading-none tracking-tight text-cream-50">
            Vedsutra
          </Link>
          <p className="mt-3 max-w-xs text-sm text-cream-100/65">
            Your life, in harmony — astrology, ritual, and Ayurveda under one trusted roof.
          </p>
          <ul className="mt-5 flex flex-wrap items-center gap-2.5" aria-label="Vedsutra on social media">
            {socials.map((link) => (
              <li key={link.platform}>
                {link.href ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Vedsutra on ${link.label}`}
                    title={link.label}
                    className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-cream-100/75 transition hover:border-ved-gold-400/60 hover:bg-white/5 hover:text-ved-gold-300"
                  >
                    <SocialIcon platform={link.platform} />
                  </a>
                ) : (
                  <span
                    aria-label={`Vedsutra on ${link.label} — coming soon`}
                    title={`${link.label} — coming soon`}
                    className="grid h-9 w-9 cursor-default place-items-center rounded-full border border-white/10 text-cream-100/35"
                  >
                    <SocialIcon platform={link.platform} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <LinkColumn title="Explore" links={EXPLORE} />
        <LinkColumn title="Support" links={SUPPORT} />
        <LinkColumn title="Legal" links={LEGAL} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Download Our App</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <StoreBadge href={settings?.appStoreUrl} logo={<AppleLogo />} caption="Download on the" store="App Store" />
            <StoreBadge href={settings?.playStoreUrl} logo={<PlayLogo />} caption="Get it on" store="Google Play" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-4 text-[11px] text-cream-100/45">
        <span>© {new Date().getFullYear()} Vedsutra. All rights reserved.</span>
        <span>Made with care for a better tomorrow.</span>
      </div>
    </footer>
  );
}
