'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { canAccess, navItemForPath, visibleNav, type AdminPermission } from '@/lib/admin-nav';
import type { AdminMe } from '@/lib/admin-types';
import { ApiError, api, loginHref, session } from '@/lib/api';

const AdminAccessContext = createContext<AdminMe | null>(null);

/** The signed-in staff member's role and permissions; only available inside AdminGate. */
export function useAdminAccess(): AdminMe & { can: (permission: AdminPermission) => boolean } {
  const me = useContext(AdminAccessContext);
  if (!me) throw new Error('useAdminAccess must be used inside AdminGate');
  return { ...me, can: (permission) => me.permissions.includes(permission) };
}

type GateState = { kind: 'checking' } | { kind: 'ready'; me: AdminMe } | { kind: 'error'; message: string };

export function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/admin';
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const profile = session.profile;
    if (!session.token || !profile) {
      router.replace(loginHref(window.location.pathname));
      return;
    }
    if (profile.role !== 'ADMIN') {
      router.replace('/');
      return;
    }
    let cancelled = false;
    api
      .get<AdminMe>('admin/me')
      .then((me) => {
        if (!cancelled) setState({ kind: 'ready', me });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 403) {
          router.replace('/');
          return;
        }
        setState({ kind: 'error', message: caught instanceof Error ? caught.message : 'Could not load admin access' });
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  const me = state.kind === 'ready' ? state.me : null;
  const groups = useMemo(() => (me ? visibleNav(me.permissions) : []), [me]);
  const current = navItemForPath(pathname);

  if (state.kind === 'checking') {
    return <p className="p-6 text-sm text-ved-green-800/60">Checking admin access…</p>;
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="mx-auto max-w-xl p-6 text-sm text-rose-700">
        {state.message}
      </p>
    );
  }

  const allowed = current ? canAccess(current, state.me.permissions) : state.me.permissions.includes('dashboard.view');

  const nav = (
    <nav aria-label="Admin" className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-ved-gold-400/80">{group.label}</p>
          <ul className="mt-1.5 space-y-0.5">
            {group.items.map((item) => {
              const active = current?.href === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${
                      active
                        ? 'bg-ved-gold-400/15 font-semibold text-ved-gold-200 ring-1 ring-ved-gold-400/30'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span aria-hidden className="grid w-5 place-items-center text-base">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <Link href="/" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-400 hover:text-white">
        <span aria-hidden className="grid w-5 place-items-center">←</span>
        Back to site
      </Link>
    </nav>
  );

  return (
    <AdminAccessContext.Provider value={state.me}>
      <div className="admin-dark mx-auto max-w-7xl overflow-hidden rounded-3xl bg-ved-green-950 shadow-xl ring-1 ring-ved-gold-400/20 lg:flex">
        <aside className="border-b border-white/10 bg-[#021310] lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ved-gold-400">Vedsutra Admin</p>
              <p className="mt-0.5 text-sm text-slate-300">
                {session.profile?.name || session.profile?.phone}
                <span className="ml-2 rounded-full bg-ved-gold-400/15 px-2 py-0.5 text-[11px] font-semibold text-ved-gold-200">
                  {state.me.roleLabel}
                </span>
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="admin-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
          <div id="admin-menu" className={`${menuOpen ? 'block' : 'hidden'} px-2 pb-5 lg:block`}>
            {nav}
          </div>
        </aside>
        <main className="min-w-0 flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {current && (
            <div>
              <p className="text-xs uppercase tracking-wider text-ved-gold-400">Vedsutra Admin</p>
              <h1 className="font-display text-2xl font-semibold text-white">{current.label}</h1>
            </div>
          )}
          {allowed ? (
            children
          ) : (
            <div role="alert" className="card">
              <h2 className="font-semibold text-white">Access restricted</h2>
              <p className="mt-1 text-sm text-slate-400">
                Your role ({state.me.roleLabel}) does not include this section. Ask a Super Admin if you need access.
              </p>
            </div>
          )}
        </main>
      </div>
    </AdminAccessContext.Provider>
  );
}
