'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { api, session, type Profile, type WalletBalance } from '@/lib/api';
import { SocketProvider, useSocket, useSocketEvent } from '@/lib/socket';

const PUBLIC_EXACT = new Set(['/login', '/']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/articles')) return true;
  return false;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ConnectionDot() {
  const { status } = useSocket();
  const colour =
    status === 'open' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-rose-500';
  const label =
    status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline';

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-ved-green-900/10 bg-ved-cream-50 px-2.5 py-1 text-xs text-ved-green-800"
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
      className="inline-flex items-center gap-1.5 rounded-full border border-ved-gold-400/50 bg-ved-gold-50 px-2.5 py-1 text-xs text-ved-gold-700 hover:bg-ved-gold-100"
    >
      ₹<span className="tabular font-semibold">{balance}</span>
    </Link>
  );
}

function BrandLogo({ className = 'h-8 w-auto' }: { className?: string }) {
  return (
    <Image
      src="/brand/vedsutra-logo.png"
      alt="Vedsutra"
      width={220}
      height={56}
      className={className}
      priority
    />
  );
}

/** Guest marketing nav — matches mock IA; no Wallet. */
const GUEST_NAV = [
  { href: '/', label: 'Home' },
  { href: '/astrologers', label: 'Astrology' },
  { href: '/panchang', label: 'Panchang' },
  { href: '/pujas', label: 'E-Puja' },
  { href: '/ayurveda', label: 'Ayurveda' },
  { href: '/ayurveda', label: 'Shop' },
  { href: '/gochar', label: 'Learn' },
  { href: '/astrologers', label: 'Consult Experts' },
] as const;

/** Logged-in: same IA plus wallet; role links added separately. */
const AUTH_NAV = [
  { href: '/', label: 'Home' },
  { href: '/astrologers', label: 'Astrology' },
  { href: '/panchang', label: 'Panchang' },
  { href: '/pujas', label: 'E-Puja' },
  { href: '/kundali', label: 'Kundali' },
  { href: '/ayurveda', label: 'Shop' },
  { href: '/gochar', label: 'Learn' },
  { href: '/wallet', label: 'Wallet' },
] as const;

function NavLinkList({
  links,
  pathname,
  onNavigate,
}: {
  links: readonly { href: string; label: string }[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={`${link.href}-${link.label}`}
            href={link.href}
            onClick={onNavigate}
            className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition ${
              active
                ? 'bg-ved-green-50 font-semibold text-ved-green-700'
                : 'text-ved-green-800/75 hover:bg-ved-cream-200 hover:text-ved-green-900'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

function NavBar({
  profile,
  guest,
}: {
  profile: Profile | null;
  guest: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const baseLinks = guest ? [...GUEST_NAV] : [...AUTH_NAV];
  const links = [
    ...baseLinks,
    ...(!guest && profile?.astrologerId ? [{ href: '/astrologer', label: 'My console' }] : []),
    ...(!guest && profile?.role === 'ADMIN' ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const initials = (profile?.name?.trim()?.[0] ?? profile?.phone?.slice(-2) ?? 'U').toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-ved-green-900/10 bg-white/95 text-ved-green-900 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link href="/" className="mr-1 flex shrink-0 items-center">
          <BrandLogo className="h-8 w-auto sm:h-9" />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex">
          <NavLinkList links={links} pathname={pathname} />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {!guest && profile && (
            <>
              <ConnectionDot />
              <WalletPill />
              <Link
                href="/profile"
                className="hidden items-center gap-2 rounded-full border border-ved-green-900/10 bg-ved-cream-50 py-1 pl-1 pr-3 text-xs text-ved-green-800 hover:bg-ved-cream-200 sm:inline-flex"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-ved-green-600 text-[11px] font-semibold text-white">
                  {initials}
                </span>
                <span className="max-w-[7rem] truncate font-medium">{profile.name ?? 'Profile'}</span>
              </Link>
              <button
                type="button"
                className="hidden rounded-lg px-2 py-1.5 text-xs text-ved-green-800/60 hover:text-ved-green-900 sm:inline"
                onClick={() => {
                  session.clear();
                  router.replace('/login');
                }}
              >
                Sign out
              </button>
            </>
          )}
          {guest && (
            <Link href="/login" className="btn-primary px-4 py-2 text-xs sm:text-sm">
              Login / Sign Up
            </Link>
          )}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ved-green-900/10 bg-ved-cream-50 text-ved-green-800 lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <span className="text-lg leading-none">×</span>
            ) : (
              <span className="flex flex-col gap-1.5">
                <span className="block h-0.5 w-5 bg-ved-green-800" />
                <span className="block h-0.5 w-5 bg-ved-green-800" />
                <span className="block h-0.5 w-5 bg-ved-green-800" />
              </span>
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-ved-green-900/10 bg-white px-4 py-3 lg:hidden">
          <nav className="flex flex-col gap-1">
            <NavLinkList links={links} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            {!guest && profile && (
              <>
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ved-green-700"
                >
                  My profile
                </Link>
                <button
                  type="button"
                  className="rounded-lg px-2.5 py-1.5 text-left text-sm text-rose-600"
                  onClick={() => {
                    session.clear();
                    setMenuOpen(false);
                    router.replace('/login');
                  }}
                >
                  Sign out
                </button>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

/**
 * Gates protected routes on a stored token. Marketing `/` and `/articles*` are public.
 * SocketProvider mounts only for authenticated sessions (WS requires JWT).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  const publicPath = isPublicPath(pathname);
  const isHome = pathname === '/';
  const isAdmin = pathname.startsWith('/admin');
  const fullBleed = isHome || pathname.startsWith('/articles');

  useEffect(() => {
    const stored = session.profile;
    const token = session.token;
    setProfile(token && stored ? stored : null);
    setChecked(true);
    if (!(token && stored) && !publicPath) {
      router.replace('/login');
    }
  }, [pathname, router, publicPath]);

  useEffect(() => {
    document.body.classList.toggle('admin-ops', isAdmin);
    return () => document.body.classList.remove('admin-ops');
  }, [isAdmin]);

  if (!checked) {
    return null;
  }

  if (pathname === '/login') {
    return <main className="mx-auto max-w-md px-4 py-10">{children}</main>;
  }

  if (!profile && publicPath) {
    return (
      <>
        <NavBar profile={null} guest />
        <main className={fullBleed ? '' : 'mx-auto max-w-5xl px-4 py-6'}>{children}</main>
      </>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <SocketProvider>
      <NavBar profile={profile} guest={false} />
      <main className={fullBleed ? '' : 'mx-auto max-w-5xl px-4 py-6'}>{children}</main>
    </SocketProvider>
  );
}
