'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { AdminIcon, LotusMark } from '@/components/admin/AdminIcon';
import { NotificationBell } from '@/components/NotificationBell';
import { canAccess, navItemForPath, searchNav, visibleNav, type AdminNavItem, type AdminPermission } from '@/lib/admin-nav';
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || 'A';
}

function NavLink({ item, active, collapsed, badge }: { item: AdminNavItem; active: boolean; collapsed: boolean; badge: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition ${
        active
          ? 'bg-gradient-to-r from-ved-gold-400/25 to-ved-gold-400/5 font-semibold text-ved-gold-200 ring-1 ring-ved-gold-400/40'
          : 'text-emerald-50/80 hover:bg-white/[0.06] hover:text-white'
      } ${collapsed ? 'justify-center' : ''}`}
    >
      <span className={`relative shrink-0 ${active ? 'text-ved-gold-300' : 'text-emerald-100/70 group-hover:text-white'}`}>
        <AdminIcon name={item.icon} className="h-[18px] w-[18px]" />
        {collapsed && badge > 0 && <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[#06231e]" />}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {badge > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
          ) : (
            <AdminIcon name="chevronRight" className="h-3.5 w-3.5 text-emerald-100/30" />
          )}
        </>
      )}
    </Link>
  );
}

function PageSearch({ permissions }: { permissions: readonly string[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const results = useMemo(() => searchNav(query, permissions).slice(0, 8), [query, permissions]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (item: AdminNavItem) => {
    setQuery('');
    setOpen(false);
    input.current?.blur();
    router.push(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === 'Enter' && results[cursor]) {
      event.preventDefault();
      go(results[cursor]!);
    } else if (event.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    }
  };

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-md">
      <label className="flex items-center gap-2 rounded-full border border-ved-green-900/10 bg-[#FAF8F3] px-3.5 py-2 text-sm focus-within:border-ved-green-600/40 focus-within:ring-2 focus-within:ring-ved-green-600/15">
        <AdminIcon name="search" className="h-4 w-4 shrink-0 text-ved-green-800/50" />
        <span className="sr-only">Search admin pages</span>
        <input
          ref={input}
          role="combobox"
          aria-expanded={open && query.length > 0}
          aria-controls="admin-search-results"
          aria-autocomplete="list"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Search pages: providers, orders, banners…"
          className="min-w-0 flex-1 bg-transparent text-ved-green-900 outline-none placeholder:text-ved-green-800/45"
        />
        <kbd className="hidden rounded-md border border-ved-green-900/15 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ved-green-800/60 md:inline">Ctrl + K</kbd>
      </label>
      {open && query.length > 0 && (
        <ul id="admin-search-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-ved-green-900/10 bg-white p-1.5 shadow-xl">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ved-green-800/60">No matching pages</li>
          ) : (
            results.map((item, index) => (
              <li key={item.href} role="option" aria-selected={index === cursor}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${
                    index === cursor ? 'bg-ved-green-50 text-ved-green-900' : 'text-ved-green-800 hover:bg-ved-cream-100'
                  }`}
                >
                  <AdminIcon name={item.icon} className="h-4 w-4 text-ved-green-700" />
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function ProfileMenu({ name, roleLabel, onSignOut }: { name: string; roleLabel: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-ved-cream-100"
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-ved-green-700 to-ved-green-900 text-xs font-bold text-ved-gold-200 ring-2 ring-ved-gold-400/40">
          {initialsOf(name)}
        </span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[10rem] truncate text-sm font-semibold text-ved-green-900">{name}</span>
          <span className="block text-[11px] text-ved-green-800/60">{roleLabel}</span>
        </span>
        <AdminIcon name="chevronDown" className="hidden h-4 w-4 text-ved-green-800/50 md:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl border border-ved-green-900/10 bg-white p-1.5 shadow-xl">
          <Link href="/" role="menuitem" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ved-green-800 hover:bg-ved-cream-100">
            <AdminIcon name="external" className="h-4 w-4" /> View website
          </Link>
          <Link href="/profile" role="menuitem" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ved-green-800 hover:bg-ved-cream-100">
            <AdminIcon name="users" className="h-4 w-4" /> My profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
          >
            <AdminIcon name="logout" className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminGate({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/admin';
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('ssa.admin.collapsed') === '1');
  }, []);

  useEffect(() => setDrawerOpen(false), [pathname]);

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
  const displayName = state.me.name && state.me.name !== 'Devotee' ? state.me.name : session.profile?.name || state.me.phone;
  const toggleSidebar = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setCollapsed((value) => {
        window.localStorage.setItem('ssa.admin.collapsed', value ? '0' : '1');
        return !value;
      });
    } else {
      setDrawerOpen((open) => !open);
    }
  };
  const signOut = () => {
    session.clear();
    router.replace('/');
  };
  const narrow = collapsed && !drawerOpen;

  return (
    <AdminAccessContext.Provider value={state.me}>
      <div className="flex min-h-screen bg-[#F6F2EA]">
        {drawerOpen && <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawerOpen(false)} />}
        <aside
          id="admin-sidebar"
          className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-gradient-to-b from-[#08302a] via-[#06231e] to-[#041a16] text-white shadow-2xl transition-all duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          } ${narrow ? 'w-[76px]' : 'w-[264px]'}`}
        >
          <Link href="/admin" className={`flex items-center gap-3 border-b border-white/[0.07] px-5 py-5 ${narrow ? 'justify-center px-2' : ''}`}>
            <LotusMark className="h-9 w-9 shrink-0 text-ved-gold-300" />
            {!narrow && (
              <span className="leading-none">
                <span className="block font-display text-2xl font-semibold text-white">Vedsutra</span>
                <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.32em] text-ved-gold-300/90">Admin Panel</span>
              </span>
            )}
          </Link>
          <nav aria-label="Admin" className="scrollbar-none flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {groups.map((group) => (
              <div key={group.label ?? 'top'}>
                {group.label &&
                  (narrow ? (
                    <div className="mx-3 mb-2 border-t border-white/10" />
                  ) : (
                    <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-100/45">{group.label}</p>
                  ))}
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink item={item} active={current?.href === item.href} collapsed={narrow} badge={item.badge ? state.me.badges[item.badge] : 0} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="border-t border-white/[0.07] p-3">
            <Link
              href="/"
              title={narrow ? 'Back to website' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-emerald-50/70 hover:bg-white/[0.06] hover:text-white ${narrow ? 'justify-center' : ''}`}
            >
              <AdminIcon name="external" className="h-[18px] w-[18px]" />
              {!narrow && 'Back to website'}
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ved-green-900/[0.06] bg-white/90 px-4 py-3 backdrop-blur sm:gap-4 sm:px-6">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-controls="admin-sidebar"
              aria-expanded={drawerOpen || !collapsed}
              aria-label="Toggle navigation"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ved-green-900 hover:bg-ved-cream-100"
            >
              <AdminIcon name="menu" />
            </button>
            <PageSearch permissions={state.me.permissions} />
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {toolbar}
              <NotificationBell />
              <ProfileMenu name={displayName} roleLabel={state.me.roleLabel} onSignOut={signOut} />
            </div>
          </header>

          <main className="admin-light min-w-0 flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            {current && current.href !== '/admin' && (
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <Link href="/admin" className="text-ved-green-800/60 hover:text-ved-green-900">
                  Dashboard
                </Link>
                <AdminIcon name="chevronRight" className="h-3.5 w-3.5 text-ved-green-800/40" />
                <span className="font-medium text-ved-green-900">{current.label}</span>
                <h1 className="w-full font-display text-3xl font-semibold text-ved-green-900">{current.label}</h1>
              </div>
            )}
            {allowed ? (
              children
            ) : (
              <div role="alert" className="card">
                <h2 className="font-semibold text-ved-green-900">Access restricted</h2>
                <p className="mt-1 text-sm text-ved-green-800/70">
                  Your role ({state.me.roleLabel}) does not include this section. Ask a Super Admin if you need access.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </AdminAccessContext.Provider>
  );
}
