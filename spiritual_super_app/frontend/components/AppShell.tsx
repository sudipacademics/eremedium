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
    <span className="pill bg-white/5 text-slate-300" title={`Signalling channel: ${label}`}>
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
  // The wallet changes underneath the UI on every billed minute and every completed top-up.
  useSocketEvent<{ balanceAfter: string }>('BILLING_TICK', (payload) => setBalance(payload.balanceAfter));
  useSocketEvent('CALL_ENDED', load);

  if (balance === null) return null;

  return (
    <Link href="/wallet" className="pill bg-saffron-500/15 text-saffron-200 hover:bg-saffron-500/25">
      ₹<span className="tabular font-semibold">{balance}</span>
    </Link>
  );
}

function Nav({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { href: '/', label: 'Astrologers' },
    { href: '/kundali', label: 'Kundali' },
    { href: '/pujas', label: 'E-Puja' },
    { href: '/wallet', label: 'Wallet' },
    ...(profile.astrologerId ? [{ href: '/astrologer', label: 'My console' }] : []),
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-night-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-saffron-500 text-night-950">॥</span>
          <span className="hidden sm:inline">Jyotish</span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                pathname === link.href
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ConnectionDot />
          <WalletPill />
          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-100"
            onClick={() => {
              session.clear();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </div>
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

  useEffect(() => {
    const stored = session.profile;
    const token = session.token;
    setProfile(stored);
    setChecked(true);
    // Both halves are required: a corrupt profile blob reads back as null while the token survives,
    // and that state has to redirect too or the guard below renders nothing forever.
    if (!(token && stored) && !PUBLIC_ROUTES.includes(pathname)) {
      router.replace('/login');
    }
  }, [pathname, router]);

  if (!checked) {
    return null;
  }

  if (PUBLIC_ROUTES.includes(pathname)) {
    return <main className="mx-auto max-w-md px-4 py-10">{children}</main>;
  }

  /*
   * Protected route with no session: render nothing while the redirect above runs.
   *
   * Never render `children` here. Every protected page calls useSocket, and SocketProvider is only
   * mounted in the authenticated branch below, so rendering the page bare threw
   * "useSocket must be used inside SocketProvider" and replaced the whole app with React's
   * client-side exception screen. That made the bare domain -- the first thing any new visitor
   * loads -- a crash instead of a redirect to the login page.
   */
  if (!profile) {
    return null;
  }

  return (
    <SocketProvider>
      <Nav profile={profile} />
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </SocketProvider>
  );
}
