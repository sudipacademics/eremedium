'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type NotificationList } from '@/lib/api';

/** Dispatch on `window` after marking notifications read so the bell refreshes its count. */
export const NOTIFICATIONS_EVENT = 'ssa:notifications';

const POLL_MS = 120_000;

export function NotificationBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      api
        .get<NotificationList>('notifications')
        .then((list) => {
          if (!cancelled) setUnread(list.unread);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener(NOTIFICATIONS_EVENT, load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_EVENT, load);
    };
  }, [pathname]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="relative grid h-9 w-9 place-items-center rounded-full text-ved-green-800 hover:bg-ved-cream-200"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
