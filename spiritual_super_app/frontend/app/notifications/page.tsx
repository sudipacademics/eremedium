'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { NOTIFICATIONS_EVENT } from '@/components/NotificationBell';
import { api, notificationHref, type AppNotification, type NotificationList } from '@/lib/api';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<NotificationList>('notifications')
      .then((list) => {
        setData(list);
        setError(null);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load notifications'));
  }, []);

  useEffect(load, [load]);

  async function markRead(item: AppNotification) {
    if (item.read) return;
    await api.post(`notifications/${item.id}/read`).catch(() => undefined);
    window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
    load();
  }

  async function markAll() {
    await api.post('notifications/read-all').catch(() => undefined);
    window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-semibold text-ved-green-900">Notifications</h1>
          <p className="text-sm text-ved-green-800/70">{data ? `${data.unread} unread` : 'Updates about your account and applications'}</p>
        </div>
        {data && data.unread > 0 && (
          <button type="button" className="btn-ghost text-sm" onClick={() => void markAll()}>
            Mark all as read
          </button>
        )}
      </div>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {!data && !error && <p className="text-sm text-ved-green-800/60">Loading…</p>}
      {data && data.notifications.length === 0 && (
        <div className="card text-center text-ved-green-800/70">You have no notifications yet.</div>
      )}

      {data && data.notifications.length > 0 && (
        <ul className="space-y-3">
          {data.notifications.map((item) => (
            <li
              key={item.id}
              className={`card flex gap-3 ${item.read ? 'opacity-75' : 'ring-1 ring-ved-gold-400/50'}`}
            >
              <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.read ? 'bg-ved-green-900/15' : 'bg-ved-gold-500'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-ved-green-900">{item.title}</h2>
                  <time className="text-xs text-ved-green-800/60" dateTime={item.createdAt}>
                    {when(item.createdAt)}
                  </time>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-ved-green-800/80">{item.body}</p>
                <div className="mt-2 flex gap-4 text-sm">
                  {item.link && (
                    <Link href={notificationHref(item.link)} className="font-medium text-ved-green-700 underline" onClick={() => void markRead(item)}>
                      Open
                    </Link>
                  )}
                  {!item.read && (
                    <button type="button" className="text-ved-green-800/70 hover:underline" onClick={() => void markRead(item)}>
                      Mark as read
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
