'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { SESSION_EVENT, loginHref, session } from './api';

/**
 * Account areas. Everything else is browsable by guests; pages ask for login only when the visitor
 * starts a transaction (see useAuthGate).
 */
const PROTECTED_PREFIXES = ['/wallet', '/profile', '/call', '/astrologer', '/admin'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isSignedIn(): boolean {
  return Boolean(session.token && session.profile);
}

/** Tracks sign-in state for this tab (and other tabs, via `storage`). */
export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(isSignedIn);
  useEffect(() => {
    const sync = () => setSignedIn(isSignedIn());
    sync();
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return signedIn;
}

/**
 * Browsing is open to guests; transactions are not. `requireLogin(next)` returns true when the user
 * is signed in, otherwise sends them to login and back to `next` (default: this page) afterwards.
 * Pages put the intended action in `next` (e.g. `/pujas?book=<id>`) and resume it on return.
 */
export function useAuthGate(): { signedIn: boolean; requireLogin: (next?: string) => boolean } {
  const router = useRouter();
  const signedIn = useSignedIn();
  const requireLogin = useCallback(
    (next?: string) => {
      if (isSignedIn()) return true;
      router.push(loginHref(next ?? window.location.pathname + window.location.search));
      return false;
    },
    [router],
  );
  return { signedIn, requireLogin };
}

/** Reads and removes one resume-intent query parameter (e.g. `?book=<id>`) from the address bar. */
export function takeIntentParam(name: string): string | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (value === null) return null;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return value;
}
