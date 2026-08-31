import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/AppShell';
import type { Profile } from '@/lib/api';
import { useSocket } from '@/lib/socket';

const replace = vi.fn();
let pathname = '/';

// The router object must be stable across renders. AppShell's session effect lists it as a
// dependency, so returning a fresh object each render re-runs the effect, sets state, renders again
// and loops until the process runs out of memory. Next's real useRouter returns a stable reference.
const router = { replace, push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
}));

/**
 * Stands in for a real page. Every protected page in this app calls useSocket, and useSocket throws
 * unless SocketProvider is above it -- so if the shell ever renders a page for a logged-out visitor
 * again, this component reproduces the exact crash rather than failing on a cosmetic assertion.
 */
function ProtectedPage() {
  useSocket();
  return <div>page content</div>;
}

function signIn(overrides: Partial<Profile> = {}) {
  const profile: Profile = {
    userId: 'u1',
    role: 'USER',
    astrologerId: null,
    name: 'Test',
    phone: '+919000000001',
    ...overrides,
  };
  window.localStorage.setItem('ssa.token', 'a-token');
  window.localStorage.setItem('ssa.profile', JSON.stringify(profile));
}

beforeEach(() => {
  replace.mockReset();
  pathname = '/';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
  );
});

describe('a logged-out visitor', () => {
  /**
   * THE regression test for the crash that met every first-time visitor.
   *
   * AppShell used to render `children` whenever no stored profile was found. Because SocketProvider
   * is only mounted in the authenticated branch, the page threw
   * "useSocket must be used inside SocketProvider" during render and React replaced the entire app
   * with its client-side exception screen -- so the bare domain was a crash, not a login page.
   */
  it('is redirected to the login page instead of crashing on the home page', async () => {
    pathname = '/';

    expect(() => render(<AppShell><ProtectedPage /></AppShell>)).not.toThrow();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('page content')).not.toBeInTheDocument();
  });

  it('is redirected away from any other protected route too', async () => {
    pathname = '/wallet';

    expect(() => render(<AppShell><ProtectedPage /></AppShell>)).not.toThrow();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('page content')).not.toBeInTheDocument();
  });

  it('can still reach the login page itself', async () => {
    pathname = '/login';

    render(<AppShell><div>login form</div></AppShell>);

    await waitFor(() => expect(screen.getByText('login form')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('a half-broken session', () => {
  /**
   * session.profile returns null when the stored JSON is corrupt, while the token survives. Guarding
   * on the token alone would leave such a visitor on a permanently blank page.
   */
  it('is sent to login when the token survives but the profile is unreadable', async () => {
    window.localStorage.setItem('ssa.token', 'a-token');
    window.localStorage.setItem('ssa.profile', '{not json');
    pathname = '/';

    expect(() => render(<AppShell><ProtectedPage /></AppShell>)).not.toThrow();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('is sent to login when a profile is stored without a token', async () => {
    window.localStorage.setItem('ssa.profile', JSON.stringify({ id: 'u1', name: 'Test' }));
    pathname = '/';

    render(<AppShell><ProtectedPage /></AppShell>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});

describe('a signed-in user', () => {
  it('sees the page, which means the socket provider is mounted above it', async () => {
    signIn();
    pathname = '/';

    render(<AppShell><ProtectedPage /></AppShell>);

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('gets the navigation chrome', async () => {
    signIn();
    pathname = '/';

    render(<AppShell><ProtectedPage /></AppShell>);

    await waitFor(() => expect(screen.getByText('Astrologers')).toBeInTheDocument());
    expect(screen.getByText('Wallet')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('is not offered the astrologer console when they are not an astrologer', async () => {
    signIn();
    pathname = '/';

    render(<AppShell><ProtectedPage /></AppShell>);

    await waitFor(() => expect(screen.getByText('Astrologers')).toBeInTheDocument());
    expect(screen.queryByText('My console')).not.toBeInTheDocument();
  });

  it('is offered the astrologer console once they have an astrologer profile', async () => {
    signIn({ role: 'ASTROLOGER', astrologerId: 'a1' });
    pathname = '/';

    render(<AppShell><ProtectedPage /></AppShell>);

    await waitFor(() => expect(screen.getByText('My console')).toBeInTheDocument());
  });
});
