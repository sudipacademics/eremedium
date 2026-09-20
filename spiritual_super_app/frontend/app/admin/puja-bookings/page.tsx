'use client';

import { useCallback, useEffect, useState } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, type PujaBooking, type PujaBookingStatus } from '@/lib/api';

type AdminBooking = PujaBooking & {
  userId: string;
  userPhone: string;
  userName: string | null;
};

const NEXT: Partial<Record<PujaBookingStatus, PujaBookingStatus>> = {
  CONFIRMED: 'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
  COMPLETED: 'PRASAD_DISPATCHED',
};

const NEXT_LABEL: Partial<Record<PujaBookingStatus, string>> = {
  CONFIRMED: 'Mark in progress',
  IN_PROGRESS: 'Mark completed',
  COMPLETED: 'Dispatch prasad',
};

export default function AdminPujaBookingsPage() {
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<
    Record<string, { videoProofUrl: string; prasadAwb: string; prasadCourier: string; scheduledFor: string }>
  >({});

  const load = useCallback(() => {
    void api
      .get<{ bookings: AdminBooking[] }>('pujas/admin/fulfilment')
      .then((res) => setBookings(res.bookings))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load bookings'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function fields(id: string) {
    return (
      evidence[id] ?? {
        videoProofUrl: '',
        prasadAwb: '',
        prasadCourier: '',
        scheduledFor: '',
      }
    );
  }

  function patchFields(
    id: string,
    patch: Partial<{ videoProofUrl: string; prasadAwb: string; prasadCourier: string; scheduledFor: string }>,
  ) {
    setEvidence((prev) => ({ ...prev, [id]: { ...fields(id), ...patch } }));
  }

  async function schedule(booking: AdminBooking) {
    const scheduledFor = fields(booking.id).scheduledFor;
    if (!scheduledFor) {
      setError('Pick a schedule date/time first');
      return;
    }
    setBusyId(booking.id);
    setError(null);
    try {
      await api.post(`pujas/admin/bookings/${booking.id}/schedule`, {
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Schedule failed');
    } finally {
      setBusyId(null);
    }
  }

  async function advance(booking: AdminBooking) {
    const next = NEXT[booking.status];
    if (!next) return;
    const f = fields(booking.id);
    setBusyId(booking.id);
    setError(null);
    try {
      await api.post(`pujas/admin/bookings/${booking.id}/advance`, {
        status: next,
        ...(next === 'COMPLETED' ? { videoProofUrl: f.videoProofUrl } : {}),
        ...(next === 'PRASAD_DISPATCHED'
          ? { prasadAwb: f.prasadAwb, prasadCourier: f.prasadCourier || undefined }
          : {}),
      });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Advance failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <p className="text-sm text-slate-400">
        Live E-Puja queue — oldest first. Stages are one-way: confirmed → in progress → completed
        (needs video URL) → prasad dispatched (needs AWB).
      </p>

      {bookings.length === 0 ? (
        <p className="text-sm text-slate-500">No open bookings.</p>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const f = fields(b.id);
            const next = NEXT[b.status];
            const busy = busyId === b.id;
            return (
              <article key={b.id} className="card space-y-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {b.pujaName}{' '}
                      <span className="text-sm font-normal text-saffron-300">· {b.status}</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {b.templeName} ({b.templeLocation}) · ₹{b.packagePrice} ·{' '}
                      {new Date(b.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-1 text-sm">
                      Sankalp: <strong>{b.sankalpName}</strong>
                      {b.sankalpGotra ? ` · ${b.sankalpGotra}` : ''}
                      {b.sankalpWish ? ` — ${b.sankalpWish}` : ''}
                    </p>
                    <p className="text-xs text-slate-400">
                      Devotee: {b.userName ?? '—'} · {b.userPhone}
                      {b.scheduledFor
                        ? ` · scheduled ${new Date(b.scheduledFor).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                </div>

                {b.status === 'CONFIRMED' && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-slate-400">
                      Schedule
                      <input
                        type="datetime-local"
                        className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                        value={f.scheduledFor}
                        onChange={(e) => patchFields(b.id, { scheduledFor: e.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15 disabled:opacity-50"
                      onClick={() => void schedule(b)}
                    >
                      Save schedule
                    </button>
                  </div>
                )}

                {next === 'COMPLETED' && (
                  <label className="block text-xs text-slate-400">
                    Video proof URL (required)
                    <input
                      type="url"
                      placeholder="https://…"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                      value={f.videoProofUrl}
                      onChange={(e) => patchFields(b.id, { videoProofUrl: e.target.value })}
                    />
                  </label>
                )}

                {next === 'PRASAD_DISPATCHED' && (
                  <div className="flex flex-wrap gap-2">
                    <label className="grow text-xs text-slate-400">
                      Prasad AWB (required)
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                        value={f.prasadAwb}
                        onChange={(e) => patchFields(b.id, { prasadAwb: e.target.value })}
                      />
                    </label>
                    <label className="grow text-xs text-slate-400">
                      Courier
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                        value={f.prasadCourier}
                        onChange={(e) => patchFields(b.id, { prasadCourier: e.target.value })}
                      />
                    </label>
                  </div>
                )}

                {next && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-saffron-500/90 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-saffron-400 disabled:opacity-50"
                    onClick={() => void advance(b)}
                  >
                    {NEXT_LABEL[b.status] ?? `Advance to ${next}`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </AdminGate>
  );
}
