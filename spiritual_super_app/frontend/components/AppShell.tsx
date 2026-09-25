'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { SESSION_EVENT, api, loginHref, session, type Profile, type WalletBalance } from '@/lib/api';
import { isProtectedPath } from '@/lib/auth-gate';
import { SocketProvider, useSocket, useSocketEvent } from '@/lib/socket';

/** Marketing pages that render their own full-width layout and the site footer. */
const INFO_PAGES = new Set([
  '/knowledge',
  '/disclaimer',
  '/terms',
  '/refund-policy',
  '/data-protection',
  '/help',
  '/how-it-works',
  '/faq',
  '/privacy-policy',
]);

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function StatusDot() {
  const { status } = useSocket();
  const online = status === 'open';
  const label = online ? 'Online' : 'Offline';

  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
        online ? 'bg-emerald-500' : 'bg-rose-500'
      }`}
      title={label}
      aria-label={label}
      role="status"
    />
  );
}

function ProfileMenu({
  profile,
  initials,
  onSignOut,
}: {
  profile: Profile;
  initials: string;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemClass =
    'block w-full rounded-lg px-3 py-2 text-left text-sm text-ved-green-800 hover:bg-ved-cream-100';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-ved-green-900/10 bg-ved-cream-50 p-1 text-xs text-ved-green-800 hover:bg-ved-cream-200 sm:pr-3"
      >
        <span className="relative grid h-7 w-7 place-items-center rounded-full bg-ved-green-600 text-[11px] font-semibold text-white">
          {initials}
          <StatusDot />
        </span>
        <span className="hidden max-w-[7rem] truncate font-medium sm:inline">
          {profile.name ?? 'Profile'}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-ved-green-900/10 bg-white p-1.5 shadow-lg"
        >
          <Link href="/profile" role="menuitem" className={itemClass}>
            My profile
          </Link>
          <Link href="/wallet" role="menuitem" className={itemClass}>
            Wallet
          </Link>
          <div className="my-1 border-t border-ved-green-900/10" />
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
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
      width={979}
      height={206}
      className={className}
      priority
    />
  );
}

/** Top menu for guests and signed-in users; Learn lives in the footer, Wallet in the profile menu. */
const MAIN_NAV = [
  { href: '/', label: 'Home' },
  { href: '/astrologers', label: 'Astrology' },
  { href: '/panchang', label: 'Panchang' },
  { href: '/pujas', label: 'E-Puja' },
  { href: '/temple', label: 'Temple' },
  { href: '/ayurveda', label: 'Ayurveda' },
  { href: '/ayurveda', label: 'Shop' },
  { href: '/astrologers', label: 'Consult Experts' },
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
  onSignOut,
}: {
  profile: Profile | null;
  guest: boolean;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    ...MAIN_NAV,
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
        <Link
          href="/"
          aria-label="Vedsutra home"
          onClick={() => {
            setMenuOpen(false);
            if (pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="mr-1 flex shrink-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400"
        >
          <BrandLogo className="h-6 w-auto sm:h-7" />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex">
          <NavLinkList links={links} pathname={pathname} />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/astrologers"
            className="hidden h-9 w-9 items-center justify-center rounded-full border border-ved-green-900/10 text-ved-green-800 hover:bg-ved-cream-100 sm:inline-flex"
            aria-label="Search"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </Link>
          <Link
            href="/ayurveda"
            className="relative hidden h-9 w-9 items-center justify-center rounded-full border border-ved-green-900/10 text-ved-green-800 hover:bg-ved-cream-100 sm:inline-flex"
            aria-label="Cart"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6h15l-1.5 9h-12z" />
              <path d="M6 6L5 3H2" />
              <circle cx="9" cy="20" r="1" />
              <circle cx="18" cy="20" r="1" />
            </svg>
            <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-ved-green-700 text-[9px] font-bold text-white">
              0
            </span>
          </Link>
          {!guest && profile && (
            <>
              <WalletPill />
              <ProfileMenu profile={profile} initials={initials} onSignOut={onSignOut} />
            </>
          )}
          {guest && (
            <Link href={loginHref(pathname)} className="btn-primary px-4 py-2 text-xs sm:text-sm">
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
          </nav>
        </div>
      )}
    </header>
  );
}

/**
 * Guests can browse every page except the account areas in PROTECTED_PREFIXES, which send them to
 * login and back. SocketProvider is keyed on the user so it connects (WS requires a JWT) on sign-in
 * and drops the connection on sign-out; for guests it stays idle.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  const signingOut = useRef(false);
  const protectedPath = isProtectedPath(pathname);
  const isHome = pathname === '/';
  const isAdmin = pathname.startsWith('/admin');
  const fullBleed =
    isHome || pathname === '/temple' || pathname.startsWith('/articles') || INFO_PAGES.has(pathname);

  useEffect(() => {
    const sync = () => {
      const stored = session.profile;
      setProfile(session.token && stored ? stored : null);
      setChecked(true);
    };
    sync();
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    signingOut.current = false;
  }, [pathname]);

  useEffect(() => {
    if (!checked || profile || !protectedPath || signingOut.current) return;
    router.replace(loginHref(pathname + window.location.search));
  }, [checked, profile, protectedPath, pathname, router]);

  const signOut = () => {
    if (protectedPath) {
      signingOut.current = true;
      router.replace('/');
    }
    session.clear();
  };

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

  if (!profile && protectedPath) {
    return null;
  }

  return (
    <SocketProvider key={profile?.userId ?? 'guest'}>
      <NavBar profile={profile} guest={!profile} onSignOut={signOut} />
      <main className={fullBleed ? '' : 'mx-auto max-w-5xl px-4 py-6'}>{children}</main>
    </SocketProvider>
  );
}
