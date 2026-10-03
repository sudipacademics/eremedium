'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

/**
 * Shared list state for the review managers: load, run an action with busy/message/error, and
 * reorder by sending the full id list.
 */
export function useAdminList<T extends { id: string }>(path: string, key: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Record<string, T[]>>(path);
      setItems(res[key] ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load');
    }
  }, [path, key]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>, done: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(done);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    if (!items) return;
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    void run(async () => {
      const res = await api.put<Record<string, T[]>>(`${path}/order`, { ids });
      setItems(res[key] ?? []);
    }, 'Order saved.');
  }

  function clearNotices() {
    setMessage(null);
    setError(null);
  }

  return { items, busy, message, error, load, run, move, clearNotices };
}

export function Badge({ on, onLabel, offLabel, tone = 'emerald' }: { on: boolean; onLabel: string; offLabel?: string; tone?: 'emerald' | 'amber' }) {
  if (!on && !offLabel) return null;
  const onClass = tone === 'amber' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? onClass : 'bg-rose-500/15 text-rose-300'}`}>
      {on ? onLabel : offLabel}
    </span>
  );
}
