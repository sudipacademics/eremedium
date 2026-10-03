'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

interface SubscriberList {
  total: number;
  subscribers: { id: string; email: string; createdAt: string }[];
}

export function NewsletterSubscribers() {
  const [data, setData] = useState<SubscriberList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<SubscriberList>('content/admin/newsletter?limit=200')
      .then(setData)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load subscribers'));
  }, []);

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Newsletter subscribers</h2>
        <p className="mt-1 text-sm text-slate-400">
          Sign-ups from the homepage &ldquo;Stay Connected&rdquo; form{data && ` — ${data.total.toLocaleString('en-IN')} in total`}.
        </p>
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {data && data.subscribers.length === 0 && <p className="text-sm text-slate-400">No subscribers yet.</p>}
      {data && data.subscribers.length > 0 && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 font-medium">Subscribed</th>
              </tr>
            </thead>
            <tbody>
              {data.subscribers.map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="py-2 pr-4">{row.email}</td>
                  <td className="whitespace-nowrap py-2">{new Date(row.createdAt).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
