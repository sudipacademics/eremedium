'use client';

import { useCallback, useEffect, useState } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api } from '@/lib/api';

interface SupportCallRow {
  id: string;
  status: string;
  channelId: string;
  ratePerMinute: string;
  totalMinutes: number;
  totalDeducted: string;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
  ageSeconds: number;
  stuckReason: 'STALE_INITIATED' | 'STALE_ACTIVE' | null;
  user: { id: string; name: string | null; phone: string; walletBalance: string | null };
  astrologer: { id: string; displayName: string; status: string; phone: string };
}

interface SupportDebitRow {
  id: string;
  amount: string;
  referenceType: string;
  referenceId: string;
  balanceAfter: string;
  createdAt: string;
  userId: string;
  userPhone: string;
  userName: string | null;
}

interface SupportOverview {
  summary: { open: number; stuck: number; dropped24h: number };
  openCalls: SupportCallRow[];
  stuckCalls: SupportCallRow[];
  recentDrops: SupportCallRow[];
  recentDebits: SupportDebitRow[];
  cutoffs: { staleInitiatedSeconds: number; staleActiveSeconds: number };
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function CallCard({
  row,
  busyId,
  onForceEnd,
}: {
  row: SupportCallRow;
  busyId: string | null;
  onForceEnd: (id: string) => void;
}) {
  return (
    <article className="card space-y-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {row.status}
            {row.stuckReason ? (
              <span className="ml-2 text-sm font-normal text-rose-300">· {row.stuckReason}</span>
            ) : null}
          </p>
          <p className="text-xs text-slate-400">
            age {formatAge(row.ageSeconds)} · ₹{row.ratePerMinute}/min · {row.totalMinutes} min billed ·
            deducted ₹{row.totalDeducted}
          </p>
          <p className="mt-1 text-sm">
            Devotee: <strong>{row.user.name ?? '—'}</strong> · {row.user.phone}
            {row.user.walletBalance != null ? ` · wallet ₹${row.user.walletBalance}` : ''}
          </p>
          <p className="text-sm text-slate-400">
            Astrologer: {row.astrologer.displayName} ({row.astrologer.status}) · {row.astrologer.phone}
          </p>
          <p className="font-mono text-[11px] text-slate-500">{row.id}</p>
        </div>
        {(row.status === 'INITIATED' || row.status === 'ACTIVE') && (
          <button
            type="button"
            disabled={busyId === row.id}
            className="rounded-lg bg-rose-500/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-400 disabled:opacity-50"
            onClick={() => onForceEnd(row.id)}
          >
            Force end
          </button>
        )}
      </div>
    </article>
  );
}

export default function AdminSupportPage() {
  const [data, setData] = useState<SupportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .get<SupportOverview>('calls/admin/support')
      .then(setData)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load support board'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function forceEnd(callSessionId: string) {
    setBusyId(callSessionId);
    setError(null);
    try {
      await api.post(`calls/admin/sessions/${callSessionId}/end`, { reason: 'ADMIN_FORCE_END' });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Force end failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Open calls, sessions past reaper cutoffs, fund-drops, and recent wallet debits.
          {data
            ? ` Cutoffs: initiated ${data.cutoffs.staleInitiatedSeconds}s · active ${data.cutoffs.staleActiveSeconds}s.`
            : ''}
        </p>
        <button
          type="button"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card py-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Open</p>
              <p className="font-display text-2xl">{data.summary.open}</p>
            </div>
            <div className="card py-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Stuck</p>
              <p className="font-display text-2xl text-rose-300">{data.summary.stuck}</p>
            </div>
            <div className="card py-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Drops (24h)</p>
              <p className="font-display text-2xl">{data.summary.dropped24h}</p>
            </div>
          </div>

          <section className="space-y-2">
            <h2 className="font-semibold">Stuck sessions</h2>
            {data.stuckCalls.length === 0 ? (
              <p className="text-sm text-slate-500">None past cutoff.</p>
            ) : (
              data.stuckCalls.map((row) => (
                <CallCard key={row.id} row={row} busyId={busyId} onForceEnd={(id) => void forceEnd(id)} />
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Open calls</h2>
            {data.openCalls.length === 0 ? (
              <p className="text-sm text-slate-500">No open sessions.</p>
            ) : (
              data.openCalls.map((row) => (
                <CallCard key={row.id} row={row} busyId={busyId} onForceEnd={(id) => void forceEnd(id)} />
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Recent fund-drops</h2>
            {data.recentDrops.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              data.recentDrops.map((row) => (
                <article key={row.id} className="card space-y-1 py-3">
                  <p className="font-medium">
                    {row.user.name ?? '—'} · {row.user.phone}
                    <span className="ml-2 text-sm font-normal text-saffron-300">DROPPED</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    with {row.astrologer.displayName} · ₹{row.totalDeducted} ·{' '}
                    {row.endTime ? new Date(row.endTime).toLocaleString() : '—'}
                  </p>
                </article>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Recent wallet debits</h2>
            {data.recentDebits.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">User</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2 pr-3">Ref</th>
                      <th className="py-2">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentDebits.map((tx: SupportDebitRow) => (
                      <tr key={tx.id} className="border-t border-white/5">
                        <td className="py-2 pr-3 text-xs text-slate-400">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">
                          {tx.userName ?? '—'}
                          <span className="block text-xs text-slate-500">{tx.userPhone}</span>
                        </td>
                        <td className="py-2 pr-3">₹{tx.amount}</td>
                        <td className="py-2 pr-3 text-xs">
                          {tx.referenceType}
                          <span className="block font-mono text-[10px] text-slate-500">
                            {tx.referenceId.slice(0, 8)}…
                          </span>
                        </td>
                        <td className="py-2">₹{tx.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </AdminGate>
  );
}
