'use client';

import { useCallback, useEffect, useState } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api } from '@/lib/api';

interface AdminAstrologer {
  id: string;
  displayName: string;
  perMinuteRate: string;
  commissionSplit: string;
  status: string;
  languages: string[];
  phone: string;
  userName: string | null;
  createdAt: string;
}

export default function AdminAstrologersPage() {
  const [rows, setRows] = useState<AdminAstrologer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .get<{ astrologers: AdminAstrologer[] }>('astrologers/admin/roster')
      .then((res) => setRows(res.astrologers))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load roster'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveRate(row: AdminAstrologer, perMinuteRate: string) {
    try {
      await api.patch(`astrologers/admin/${row.id}`, { perMinuteRate });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rate update failed');
    }
  }

  async function saveCommission(row: AdminAstrologer, commissionSplit: string) {
    try {
      await api.patch(`astrologers/admin/${row.id}`, { commissionSplit });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Commission update failed');
    }
  }

  async function setOnline(row: AdminAstrologer, online: boolean) {
    try {
      await api.patch(`astrologers/admin/${row.id}`, { online });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Availability update failed');
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <p className="text-sm text-slate-400">
        New astrologers still apply from <strong>My console</strong>. Here you set rates, commission,
        and online status. Busy / in-call cannot be forced offline mid-session.
      </p>

      <div className="space-y-2">
        {rows.map((row) => (
          <article key={row.id} className="card space-y-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{row.displayName}</p>
                <p className="text-xs text-slate-400">
                  {row.phone} · {row.languages.join(', ') || '—'} · status{' '}
                  <span className="text-saffron-300">{row.status}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={row.status === 'BUSY' || row.status === 'IN_CALL'}
                  onClick={() => void setOnline(row, true)}
                >
                  Go online
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={row.status === 'BUSY' || row.status === 'IN_CALL'}
                  onClick={() => void setOnline(row, false)}
                >
                  Go offline
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                ₹/min
                <input
                  className="input w-24 py-1.5"
                  defaultValue={row.perMinuteRate}
                  onBlur={(e) => {
                    if (e.target.value !== row.perMinuteRate) {
                      void saveRate(row, e.target.value);
                    }
                  }}
                />
              </label>
              <label className="flex items-center gap-2">
                Commission (0–1)
                <input
                  className="input w-24 py-1.5"
                  defaultValue={row.commissionSplit}
                  onBlur={(e) => {
                    if (e.target.value !== row.commissionSplit) {
                      void saveCommission(row, e.target.value);
                    }
                  }}
                />
              </label>
            </div>
          </article>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-slate-500">No astrologer profiles yet.</p>
        )}
      </div>
    </AdminGate>
  );
}
