'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { api, session, type Profile, type WalletBalance } from '@/lib/api';
import { SocketProvider, useSocket, useSocketEvent } from '@/lib/socket';

const PUBLIC_ROUTES = ['/login'];

function ConnectionDot() {
  const { status } = useSocket();
  const colour =
    status === 'open' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-rose-500';
  const label =
    status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline';

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-cream-100"
      title={`Signalling channel: ${label}`}
    >
      <span className="relative flex h-2 w-2">
        {status === 'open' && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${colour} animate-pulse-ring`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${colour}`} />
      </span>
      {label}
    </span>
  );
}

function WalletPill() {
  const [balance, setBalance] = useState<string | null>(null);

  const load = () => {
    void api
      .get<WalletBalance>('wallet/balance')
      .then((wallet) => setBalance(wallet.balance))
      .catch(() => setBalance(null));
  };

  useEffect(load, []);
  useSocketEvent<{ balanceAfter: string }>('BILLING_TICK', (payload) => setBalance(payload.balanceAfter));
  useSocketEvent('CALL_ENDED', load);

  if (balance === null) return null;

  return (
    <Link
      href="/wallet"
      className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/40 bg-gold-400/15 px-2.5 py-1 text-xs text-gold-300 hover:bg-gold-400/25"
    >
      ₹<span className="tabular font-semibold">{balance}</span>
    </Link>
  );
}

function NakshyaMark() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden>
      <circle cx="20" cy="20" r="18" fill="none" stroke="#d4a84b" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="8" fill="#d4a84b" opacity="0.9" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = 20 + Math.cos(rad) * 10;
        const y1 = 20 + Math.sin(rad) * 10;
        const x2 = 20 + Math.cos(rad) * 16;
        const y2 = 20 + Math.sin(rad) * 16;
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#d4a84b"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

function Nav({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { href: '/astrologers', label: 'Astrologers' },
    { href: '/kundali', label: 'Kundali' },
    { href: '/match', label: 'Match' },
    { href: '/gochar', label: 'Gochar' },
    { href: '/ai', label: 'Jyotish AI' },
    { href: '/panchang', label: 'Panchang' },
    { href: '/pujas', label: 'E-Puja' },
    { href: '/ayurveda', label: 'Ayurveda' },
    { href: '/ayurveda', label: 'Ayurvedic Shop' },
    { href: '/wallet', label: 'Wallet' },
    ...(profile.astrologerId ? [{ href: '/astrologer', label: 'My console' }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-900/95 text-cream-50 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link href="/" className="mr-1 flex shrink-0 items-center gap-2.5">
          <NakshyaMark />
          <span className="leading-tight">
            <span className="block font-display text-xl font-semibold tracking-wide text-gold-300">
              Nakshya
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.14em] text-cream-200/70 sm:block">
              Your Life. In Harmony.
            </span>
          </span>
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto lg:flex">
          {links.map((link) => {
            const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
            return (
              <Link
                key={`${link.href}-${link.label}`}
                href={link.href}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                  active
                    ? 'bg-white/10 text-gold-300'
                    : 'text-cream-100/75 hover:bg-white/5 hover:text-cream-50'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ConnectionDot />
          <WalletPill />
          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-xs text-cream-100/70 hover:text-cream-50"
            onClick={() => {
              session.clear();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Mobile / tablet strip */}
      <nav className="flex gap-1 overflow-x-auto border-t border-white/5 px-3 py-2 lg:hidden">
        {links.map((link) => (
          <Link
            key={`m-${link.href}-${link.label}`}
            href={link.href}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              pathname === link.href
                ? 'bg-gold-400/20 text-gold-300'
                : 'bg-white/5 text-cream-100/80'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/**
 * Gates every non-public route on a stored token and mounts the signalling channel only for
 * authenticated users, since the handshake requires a JWT.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  const isHome = pathname === '/';

  useEffect(() => {
    const stored = session.profile;
    const token = session.token;
    setProfile(stored);
    setChecked(true);
    if (!(token && stored) && !PUBLIC_ROUTES.includes(pathname)) {
      router.replace('/login');
    }
  }, [pathname, router]);

  useEffect(() => {
    document.body.classList.toggle('nakshya-home', isHome);
    return () => document.body.classList.remove('nakshya-home');
  }, [isHome]);

  if (!checked) {
    return null;
  }

  if (PUBLIC_ROUTES.includes(pathname)) {
    return <main className="mx-auto max-w-md px-4 py-10">{children}</main>;
  }

  if (!profile) {
    return null;
  }

  return (
    <SocketProvider>
      <Nav profile={profile} />
      <main className={isHome ? '' : 'mx-auto max-w-5xl px-4 py-6'}>{children}</main>
    </SocketProvider>
  );
}
