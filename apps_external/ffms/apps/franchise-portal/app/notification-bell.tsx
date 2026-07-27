'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RFMS_API_BASE, parsePortalNotificationHref } from '@rfms/utils';

export type NotificationItem = {
  id: string;
  status: 'unread' | 'read' | 'archived';
  module: string;
  action: string;
  title: string;
  message: string;
  actor_name: string;
  actor_role: string;
  href: string;
  created_at: string;
  read_at?: string;
};

const API_BASE = RFMS_API_BASE;
const readable = (value?: string) => (value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value?: string) => {
  const date = new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function ApplicantNotificationBell({
  token,
  onNavigate,
}: {
  token: string;
  onNavigate: (section: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read' | 'archived'>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [listResponse, countResponse] = await Promise.all([
        fetch(`${API_BASE}/notifications?status=${encodeURIComponent(filter === 'all' ? 'all' : filter)}`, { headers }),
        fetch(`${API_BASE}/notifications/unread-count`, { headers }),
      ]);
      const listPayload = await listResponse.json().catch(() => null) as { success?: boolean; data?: NotificationItem[]; error?: { message?: string } } | null;
      const countPayload = await countResponse.json().catch(() => null) as { success?: boolean; data?: { unread_count?: number } } | null;

      if (listResponse.ok && listPayload?.success && Array.isArray(listPayload.data)) {
        setItems(listPayload.data);
      } else {
        setItems([]);
        if (!listResponse.ok) setError(listPayload?.error?.message ?? 'Unable to load notifications.');
      }

      if (countResponse.ok && countPayload?.success) {
        setUnreadCount(Number(countPayload.data?.unread_count ?? 0));
      }
    } finally {
      setLoading(false);
    }
  }, [filter, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 20000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  async function markStatus(id: string, status: 'read' | 'archived') {
    const previousItems = items;
    const previousUnread = unreadCount;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    if (status === 'read') {
      setUnreadCount((count) => Math.max(0, count - (previousItems.some((item) => item.id === id && item.status === 'unread') ? 1 : 0)));
    }

    const response = await fetch(`${API_BASE}/notifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      setItems(previousItems);
      setUnreadCount(previousUnread);
      setError('Unable to update this notification.');
      return;
    }

    if (filter !== 'all' && filter !== status) {
      setItems((current) => current.filter((item) => item.id !== id));
    }
    void load();
  }

  async function markAllRead() {
    const previousItems = items;
    const previousUnread = unreadCount;
    setItems((current) => current.map((item) => (item.status === 'unread' ? { ...item, status: 'read' as const } : item)));
    setUnreadCount(0);

    const response = await fetch(`${API_BASE}/notifications/read-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      setItems(previousItems);
      setUnreadCount(previousUnread);
      setError('Unable to mark all notifications as read.');
      return;
    }

    void load();
  }

  async function openItem(item: NotificationItem) {
    if (item.status === 'unread') await markStatus(item.id, 'read');
    const target = parsePortalNotificationHref(item.href);
    if (target) onNavigate(target.section);
    setOpen(false);
  }

  return (
    <div className="notification-shell" ref={rootRef}>
      <button type="button" className="dashboard-notification-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Notifications{unreadCount ? <i>{unreadCount}</i> : null}
      </button>
      {open ? (
        <section className="notification-panel applicant-notification-panel" aria-label="Notification panel">
          <header>
            <div>
              <b>Notifications</b>
              <small>{unreadCount} unread</small>
            </div>
            <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount}>Mark all read</button>
          </header>
          <div className="notification-filters">
            {(['all', 'unread', 'read', 'archived'] as const).map((value) => (
              <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{readable(value)}</button>
            ))}
          </div>
          <div className="notification-list">
            {loading && !items.length ? <p className="notification-empty">Loading notifications...</p> : null}
            {error ? <p className="notification-empty notification-error">{error}</p> : null}
            {!loading && !error && !items.length ? <p className="notification-empty">No notifications in this view.</p> : null}
            {items.map((item) => (
              <article key={item.id} className={`notification-item ${item.status}`}>
                <button type="button" className="notification-item-body" onClick={() => void openItem(item)}>
                  <span className="notification-meta">{readable(item.module)} · {readable(item.action)}</span>
                  <span className="notification-title">{item.title}</span>
                  {item.message.trim() && item.message.trim() !== item.title.trim() ? (
                    <p className="notification-message">{item.message}</p>
                  ) : null}
                  <small>{item.actor_name} · {dateTime(item.created_at)}</small>
                </button>
                <div className="notification-actions">
                  <span className={`notification-status ${item.status}`}>{item.status === 'unread' ? 'Unread' : item.status === 'archived' ? 'Archived' : 'Read'}</span>
                  {item.status === 'unread' ? (
                    <label className="notification-read-toggle">
                      <input type="checkbox" checked={false} onChange={() => void markStatus(item.id, 'read')} />
                      <span>Mark read</span>
                    </label>
                  ) : null}
                  <button type="button" onClick={() => void openItem(item)}>Open</button>
                  {item.status !== 'archived' ? <button type="button" onClick={() => void markStatus(item.id, 'archived')}>Archive</button> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DefaultAvatarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.01 0-9 1.51-9 4.5v1.5h18v-1.5c0-2.99-5.99-4.5-9-4.5Z" fill="currentColor" />
    </svg>
  );
}

export function ApplicantProfileMenu({
  photoUrl,
  name,
  onUpdateProfile,
  onLogout,
}: {
  photoUrl?: string;
  name: string;
  onUpdateProfile: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div className="profile-menu-shell" ref={rootRef}>
      <button type="button" className="dashboard-profile-button" aria-expanded={open} aria-label={`${name} account menu`} onClick={() => setOpen((value) => !value)}>
        {photoUrl ? <img src={photoUrl} alt="" /> : <span className="profile-avatar-fallback"><DefaultAvatarIcon /></span>}
      </button>
      {open ? (
        <menu className="profile-menu applicant-profile-menu">
          <button type="button" onClick={() => { setOpen(false); onUpdateProfile(); }}>Update Profile</button>
          <button type="button" onClick={() => { setOpen(false); void onLogout(); }}>Logout</button>
        </menu>
      ) : null}
    </div>
  );
}
