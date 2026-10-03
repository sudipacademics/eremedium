'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { SocialIcon } from '@/components/SiteFooter';
import { api, type FooterSettings } from '@/lib/api';
import { loadFooterSettings } from '@/lib/footer';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/social';

const gold = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const PERKS: readonly { title: string; body: string; icon: ReactNode }[] = [
  {
    title: 'Muhurta Tips',
    body: 'Auspicious timings',
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...gold}>
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    title: 'Gochar Notes',
    body: 'Planetary insights',
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...gold}>
        <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
        <path d="M9 11h6M9 14.5h6M9 18h3.5" />
      </svg>
    ),
  },
  {
    title: 'Shop Drops',
    body: 'New products & offers',
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...gold}>
        <path d="M5 8h14l-1 12.5H6L5 8Z" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      </svg>
    ),
  },
  {
    title: 'Important Updates',
    body: 'Events & special offers',
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...gold}>
        <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </svg>
    ),
  },
];

const SOCIAL_ORDER: readonly { platform: SocialPlatform; color: string }[] = [
  { platform: 'youtube', color: 'text-[#ff0000]' },
  { platform: 'facebook', color: 'text-[#1877f2]' },
  { platform: 'instagram', color: 'text-[#e1306c]' },
  { platform: 'x', color: 'text-black' },
];

function Mandala({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 200 200" className={`pointer-events-none absolute text-[#d9bd7a] ${className}`} fill="none" stroke="currentColor" strokeWidth="0.8" aria-hidden>
      <circle cx="100" cy="100" r="28" />
      <circle cx="100" cy="100" r="44" strokeDasharray="2 4" />
      <circle cx="100" cy="100" r="92" />
      {Array.from({ length: 16 }, (_, i) => (
        <path key={i} transform={`rotate(${i * 22.5} 100 100)`} d="M100 56c10 10 12 22 0 34-12-12-10-24 0-34Z" />
      ))}
      {Array.from({ length: 24 }, (_, i) => (
        <path key={`o${i}`} transform={`rotate(${i * 15} 100 100)`} d="M100 8c6 8 6 16 0 24-6-8-6-16 0-24Z" />
      ))}
    </svg>
  );
}

function LotusRule() {
  return (
    <div className="flex items-center gap-2 text-[#c9a24a]" aria-hidden>
      <span className="h-px w-6 bg-current opacity-60" />
      <svg viewBox="0 0 24 14" className="h-3 w-5" fill="currentColor">
        <path d="M12 1c1.8 2 2.6 4.4 2.6 6.6 0 2.4-1.1 4.3-2.6 5.4-1.5-1.1-2.6-3-2.6-5.4C9.4 5.4 10.2 3 12 1Z" />
        <path d="M3 5.5c3.1.2 5.7 1.7 7 4 .6 1 .9 2.2 1 3.5-2.9-.2-5.6-1.4-7-3.6C3.4 8.4 3.1 7 3 5.5Zm18 0c-.1 1.5-.4 2.9-1 3.9-1.4 2.2-4.1 3.4-7 3.6.1-1.3.4-2.5 1-3.5 1.3-2.3 3.9-3.8 7-4Z" opacity=".75" />
      </svg>
      <span className="h-px w-16 bg-gradient-to-r from-current to-transparent opacity-60" />
    </div>
  );
}

type Status = { kind: 'idle' | 'busy' | 'done' } | { kind: 'error'; message: string };

export function NewsletterSection() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: 'busy' });
    try {
      await api.post('content/newsletter', { email: email.trim() });
      setStatus({ kind: 'done' });
      setEmail('');
    } catch (caught) {
      setStatus({ kind: 'error', message: caught instanceof Error ? caught.message : 'Could not subscribe. Please try again.' });
    }
  }

  const socials = SOCIAL_ORDER.map((entry) => {
    const info = SOCIAL_PLATFORMS.find((p) => p.platform === entry.platform)!;
    return { ...entry, label: info.label, href: settings?.[info.field] ?? null };
  });

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="relative overflow-hidden rounded-[26px] border border-[#e8d6a8] bg-gradient-to-br from-[#fdf9f1] via-[#fbf5ea] to-[#f8f0e1] px-6 py-9 shadow-[0_18px_40px_-28px_rgba(150,110,40,0.5)] sm:px-10 lg:px-12">
        <Mandala className="-top-16 left-[38%] h-56 w-56 opacity-25" />
        <Mandala className="-bottom-24 left-[46%] h-56 w-56 opacity-20" />
        <Image src="/home/newsletter/leaf-left.webp" alt="" width={189} height={260} unoptimized className="pointer-events-none absolute -bottom-6 -left-5 h-28 w-auto opacity-90 sm:h-32" />
        <Image src="/home/newsletter/leaf-right.webp" alt="" width={212} height={260} unoptimized className="pointer-events-none absolute -right-4 -top-5 h-28 w-auto opacity-90 sm:h-32" />

        <div className="relative grid items-center gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-8">
          <div>
            <LotusRule />
            <h2 className="mt-3 font-display text-4xl font-bold text-ved-green-900 sm:text-[44px]">
              Stay <span className="text-[#a8782c]">Connected</span>
            </h2>
            <p className="mt-2 font-display text-lg text-ved-green-900/70">
              Muhurta tips, gochar notes, and shop drops — gently, in your inbox.
            </p>
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 xl:flex xl:items-center xl:gap-0">
              {PERKS.map((perk, index) => (
                <li
                  key={perk.title}
                  className={`flex items-center gap-2 xl:min-w-0 xl:pr-3 ${index > 0 ? 'xl:border-l xl:border-[#e3cf9c] xl:pl-3' : ''}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#ecdcb4] bg-[#fbf1dc] text-[#b08433]">
                    {perk.icon}
                  </span>
                  <span className="leading-tight">
                    <span className="block font-display text-[15px] font-semibold text-ved-green-900">{perk.title}</span>
                    <span className="block text-[11px] text-ved-green-900/60">{perk.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div className="relative mx-auto -mt-2 mb-3 h-28 w-48 sm:h-32 sm:w-56" aria-hidden>
              <Image src="/home/newsletter/envelope.webp" alt="" width={360} height={244} unoptimized className="h-full w-full object-contain drop-shadow-[0_10px_14px_rgba(150,110,40,0.18)]" />
              <svg viewBox="0 0 120 40" className="absolute -right-16 top-3 hidden h-10 w-28 text-[#c9a24a] sm:block" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3">
                <path d="M2 34c20 6 36-2 46-12s30-18 50-12" />
              </svg>
              <Image src="/home/newsletter/plane.webp" alt="" width={200} height={144} unoptimized className="absolute -right-24 -top-1 hidden h-9 w-auto sm:block" />
            </div>

            <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-full border border-[#e3cf9c] bg-white p-1.5 pl-4 shadow-[0_6px_18px_-12px_rgba(150,110,40,0.5)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ved-green-900/70" {...gold} aria-hidden>
                <rect x="3" y="5.5" width="18" height="13" rx="2" />
                <path d="m3.5 7 8.5 6 8.5-6" />
              </svg>
              <label htmlFor="newsletter-email" className="sr-only">
                Email address
              </label>
              <input
                id="newsletter-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (status.kind !== 'busy') setStatus({ kind: 'idle' });
                }}
                placeholder="Enter your email address"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ved-green-900 outline-none placeholder:text-ved-green-900/40"
              />
              <button
                type="submit"
                disabled={status.kind === 'busy'}
                className="flex shrink-0 items-center gap-2 rounded-full bg-ved-green-900 px-5 py-2.5 font-display text-[15px] font-semibold text-white transition hover:bg-ved-green-800 disabled:opacity-70 sm:px-6"
              >
                {status.kind === 'busy' ? 'Subscribing…' : 'Subscribe'}
                <svg viewBox="0 0 24 24" className="h-4 w-4" {...gold} strokeWidth={2} aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </form>
            <p role="status" className={`mt-2 min-h-[1.25rem] px-4 text-xs ${status.kind === 'error' ? 'text-rose-600' : 'text-ved-green-700'}`}>
              {status.kind === 'done' && 'You’re subscribed — look out for our next note.'}
              {status.kind === 'error' && status.message}
            </p>

            <div className="mt-1 flex items-center gap-4 px-2">
              <ul className="flex shrink-0 items-center gap-2.5" aria-label="Vedsutra on social media">
                {socials.map((social) => (
                  <li key={social.platform}>
                    {social.href ? (
                      <a
                        href={social.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Vedsutra on ${social.label}`}
                        title={social.label}
                        className={`grid h-9 w-9 place-items-center rounded-full border border-[#ecdcb4] bg-white shadow-sm transition hover:-translate-y-0.5 ${social.color}`}
                      >
                        <SocialIcon platform={social.platform} />
                      </a>
                    ) : (
                      <span
                        aria-label={`Vedsutra on ${social.label} — coming soon`}
                        title={`${social.label} — coming soon`}
                        className={`grid h-9 w-9 cursor-default place-items-center rounded-full border border-[#ecdcb4] bg-white/70 opacity-60 ${social.color}`}
                      >
                        <SocialIcon platform={social.platform} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="min-w-0 border-l border-[#e3cf9c] pl-4 text-xs leading-snug text-ved-green-900/65">
                Follow us for daily insights, rituals &amp; updates
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
