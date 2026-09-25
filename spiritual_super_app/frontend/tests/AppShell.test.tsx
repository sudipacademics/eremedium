import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
 * Stands in for a real page. Several pages (astrologers, shop, E-Puja, wallet) call useSocket, which
 * throws unless SocketProvider is above it -- so this reproduces the exact crash if the shell ever
 * renders such a page without the provider.
 */
function SocketPage() {
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
  window.localStorage.clear();
  replace.mockReset();
  pathname = '/';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }),
  );
});

describe('a logged-out visitor', () => {
  it('can view the public homepage without a session', async () => {
    pathname = '/';

    expect(() => render(<AppShell><div>marketing home</div></AppShell>)).not.toThrow();

    await waitFor(() => expect(screen.getByText('marketing home')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['/astrologers', '/ayurveda', '/pujas', '/panchang', '/kundali', '/temple', '/ai'])(
    'can browse %s without being asked to log in',
    async (path) => {
      pathname = path;

      render(<AppShell><SocketPage /></AppShell>);

      await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByRole('link', { name: 'Login / Sign Up' })).toHaveAttribute(
        'href',
        `/login?next=${encodeURIComponent(path)}`,
      );
    },
  );

  it.each(['/wallet', '/profile', '/call/abc', '/astrologer', '/admin/hero'])(
    'is sent to login from the account area %s, and back afterwards',
    async (path) => {
      pathname = path;

      expect(() => render(<AppShell><SocketPage /></AppShell>)).not.toThrow();

      await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(path)}`));
      expect(screen.queryByText('page content')).not.toBeInTheDocument();
    },
  );

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
    pathname = '/wallet';

    expect(() => render(<AppShell><SocketPage /></AppShell>)).not.toThrow();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fwallet'));
  });

  it('is sent to login when a profile is stored without a token', async () => {
    window.localStorage.setItem('ssa.profile', JSON.stringify({ id: 'u1', name: 'Test' }));
    pathname = '/wallet';

    render(<AppShell><SocketPage /></AppShell>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fwallet'));
  });
});

describe('a signed-in user', () => {
  it('sees account pages, which means the socket provider is mounted above them', async () => {
    signIn();
    pathname = '/wallet';

    render(<AppShell><SocketPage /></AppShell>);

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('gets the navigation chrome and profile menu', async () => {
    signIn();
    pathname = '/';

    render(<AppShell><SocketPage /></AppShell>);

    await waitFor(() => expect(screen.getAllByText('Astrology').length).toBeGreaterThan(0));
    for (const label of ['Panchang', 'E-Puja', 'Temple', 'Ayurveda', 'Shop', 'Consult Experts']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('link', { name: 'Login / Sign Up' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Test/ }));
    expect(screen.getByRole('menuitem', { name: 'Wallet' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('is not offered the astrologer console when they are not an astrologer', async () => {
    signIn();
    pathname = '/';

    render(<AppShell><SocketPage /></AppShell>);

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(screen.queryByText('My console')).not.toBeInTheDocument();
  });

  it('is offered the astrologer console once they have an astrologer profile', async () => {
    signIn({ role: 'ASTROLOGER', astrologerId: 'a1' });
    pathname = '/';

    render(<AppShell><SocketPage /></AppShell>);

    await waitFor(() => expect(screen.getAllByText('My console').length).toBeGreaterThan(0));
  });

  it('stays on a public page after signing out, now as a guest', async () => {
    signIn();
    pathname = '/pujas';

    render(<AppShell><SocketPage /></AppShell>);
    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Test/ }));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' })));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Login / Sign Up' })).toBeInTheDocument());
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes home, not to login, after signing out on an account page', async () => {
    signIn();
    pathname = '/wallet';

    render(<AppShell><SocketPage /></AppShell>);
    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Test/ }));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' })));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining('/login'));
  });
});
