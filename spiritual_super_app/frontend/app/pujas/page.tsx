'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { PujaStatusTrail } from '@/components/PujaStatusTrail';
import {
  ApiError,
  api,
  session,
  type PujaBooking,
  type PujaBookingResult,
  type PujaOffering,
  type PujaTemple,
} from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

type Tab = 'book' | 'mine';

interface Selection {
  temple: PujaTemple;
  offering: PujaOffering;
}

export default function PujasPage() {
  const [tab, setTab] = useState<Tab>('book');
  const [temples, setTemples] = useState<PujaTemple[]>([]);
  const [bookings, setBookings] = useState<PujaBooking[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBookings = useCallback(() => {
    void api
      .get<{ bookings: PujaBooking[] }>('pujas/bookings')
      .then((result) => setBookings(result.bookings))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void api
      .get<{ temples: PujaTemple[] }>('pujas/temples')
      .then((result) => setTemples(result.temples))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the temples'),
      )
      .finally(() => setLoading(false));
    loadBookings();
  }, [loadBookings]);

  // The temple advances the puja hours or days later, so the list must update without a reload.
  useSocketEvent<PujaBooking>('PUJA_BOOKING_UPDATED', (updated) => {
    setBookings((current) => {
      const known = current.some((booking) => booking.id === updated.id);
      return known
        ? current.map((booking) => (booking.id === updated.id ? updated : booking))
        : [updated, ...current];
    });
  });

  const pending = useMemo(
    () => bookings.filter((booking) => booking.status !== 'PRASAD_DISPATCHED').length,
    [bookings],
  );

  return (
    <div className="space-y-5">
      <div className="card bg-gradient-to-br from-saffron-500/15 to-transparent">
        <h1 className="text-xl font-semibold">E-Puja</h1>
        <p className="mt-1 text-sm text-slate-400">
          Have a puja performed in your name at a temple you cannot travel to. You receive a recording
          of the rite and the prasad by post.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl bg-white/5 p-1">
        <button
          type="button"
          onClick={() => setTab('book')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
            tab === 'book' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          Book a puja
        </button>
        <button
          type="button"
          onClick={() => setTab('mine')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
            tab === 'mine' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          My pujas
          {pending > 0 && (
            <span className="ml-2 rounded-full bg-saffron-500/20 px-1.5 text-xs text-saffron-200">
              {pending}
            </span>
          )}
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {tab === 'book' ? (
        loading ? (
          <p className="text-sm text-slate-400">Loading temples…</p>
        ) : temples.length === 0 ? (
          <div className="card">
            <p className="text-sm text-slate-400">
              No temples are listed yet. They are added by the platform, not by users.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {temples.map((temple) => (
              <TempleCard
                key={temple.id}
                temple={temple}
                onSelect={(offering) => setSelection({ temple, offering })}
              />
            ))}
          </div>
        )
      ) : (
        <MyPujas bookings={bookings} onBookNow={() => setTab('book')} />
      )}

      {selection && (
        <SankalpDialog
          selection={selection}
          onClose={() => setSelection(null)}
          onBooked={() => {
            setSelection(null);
            loadBookings();
            setTab('mine');
          }}
        />
      )}
    </div>
  );
}

function TempleCard({
  temple,
  onSelect,
}: {
  temple: PujaTemple;
  onSelect: (offering: PujaOffering) => void;
}) {
  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-semibold">{temple.name}</h2>
        <p className="text-xs text-slate-400">
          {temple.location} · {temple.primaryDeity}
        </p>
      </div>

      {temple.offerings.length === 0 ? (
        <p className="text-sm text-slate-500">No pujas are open for booking here right now.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {temple.offerings.map((offering) => (
            <li key={offering.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{offering.name}</p>
                {offering.description && (
                  <p className="mt-0.5 text-xs text-slate-400">{offering.description}</p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {[offering.durationLabel, offering.prasadIncluded].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-sm font-semibold">₹{offering.price}</p>
                <button
                  type="button"
                  className="btn-primary mt-1.5 px-3 py-1.5 text-xs"
                  onClick={() => onSelect(offering)}
                >
                  Book
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MyPujas({ bookings, onBookNow }: { bookings: PujaBooking[]; onBookNow: () => void }) {
  if (bookings.length === 0) {
    return (
      <div className="card space-y-3">
        <p className="text-sm text-slate-400">You have not booked a puja yet.</p>
        <button type="button" className="btn-primary" onClick={onBookNow}>
          Browse temples
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {bookings.map((booking) => (
        <div key={booking.id} className="card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{booking.pujaName}</p>
              <p className="text-xs text-slate-400">
                {booking.templeName} · {booking.templeLocation}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Sankalp for {booking.sankalpName}
                {booking.sankalpGotra ? `, ${booking.sankalpGotra} gotra` : ''}
              </p>
              {booking.sankalpWish && (
                <p className="mt-1 text-xs italic text-slate-400">“{booking.sankalpWish}”</p>
              )}
            </div>
            <p className="tabular shrink-0 text-sm font-semibold">₹{booking.packagePrice}</p>
          </div>

          <PujaStatusTrail booking={booking} />

          <p className="text-[11px] text-slate-600">
            Booked {new Date(booking.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </p>
        </div>
      ))}
    </div>
  );
}

function SankalpDialog({
  selection,
  onClose,
  onBooked,
}: {
  selection: Selection;
  onClose: () => void;
  onBooked: () => void;
}) {
  const profile = session.profile;
  const [sankalpName, setSankalpName] = useState(profile?.name ?? '');
  const [sankalpGotra, setSankalpGotra] = useState('');
  const [sankalpWish, setSankalpWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PujaBookingResult | null>(null);

  /*
   * Generated once per dialog, not per click. The server books at most one puja per key, so a second
   * tap on a slow connection reaches the same booking instead of buying the puja twice.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const booked = await api.post<PujaBookingResult>('pujas/bookings', {
        pujaOfferingId: selection.offering.id,
        idempotencyKey,
        ...(sankalpName.trim() ? { sankalpName: sankalpName.trim() } : {}),
        ...(sankalpGotra.trim() ? { sankalpGotra: sankalpGotra.trim() } : {}),
        ...(sankalpWish.trim() ? { sankalpWish: sankalpWish.trim() } : {}),
      });
      setResult(booked);
    } catch (caught) {
      // 402 is the wallet being short, which is a top-up prompt rather than an error.
      if (caught instanceof ApiError && caught.status === 402) {
        setError('Your wallet does not cover this puja. Add money and try again.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not complete the booking');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-night-950/80 p-4 backdrop-blur sm:items-center">
      <div className="card w-full max-w-md space-y-4">
        {result ? (
          <>
            <div>
              <h2 className="font-semibold">Sankalp accepted</h2>
              <p className="mt-1 text-sm text-slate-400">
                {result.booking.pujaName} at {result.booking.templeName}. ₹{result.amountDebited} was
                debited; your balance is now ₹{result.walletBalanceAfter}.
              </p>
            </div>
            <PujaStatusTrail booking={result.booking} />
            <button type="button" className="btn-primary w-full" onClick={onBooked}>
              Done
            </button>
          </>
        ) : (
          <>
            <div>
              <h2 className="font-semibold">{selection.offering.name}</h2>
              <p className="text-xs text-slate-400">
                {selection.temple.name} · {selection.temple.location}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="sankalpName">
                Name for the sankalp
              </label>
              <input
                id="sankalpName"
                className="input"
                value={sankalpName}
                onChange={(event) => setSankalpName(event.target.value)}
                placeholder="Whose name should be offered"
              />
              <p className="mt-1 text-xs text-slate-500">
                Often a parent or child rather than your own name.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="sankalpGotra">
                Gotra (optional)
              </label>
              <input
                id="sankalpGotra"
                className="input"
                value={sankalpGotra}
                onChange={(event) => setSankalpGotra(event.target.value)}
                placeholder="Bharadwaja"
              />
            </div>

            <div>
              <label className="label" htmlFor="sankalpWish">
                Your prayer (optional)
              </label>
              <textarea
                id="sankalpWish"
                className="input min-h-20"
                value={sankalpWish}
                onChange={(event) => setSankalpWish(event.target.value)}
                placeholder="What you are seeking"
              />
            </div>

            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                className="btn flex-1 border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={() => void confirm()}
                disabled={busy}
              >
                {busy ? 'Booking…' : `Pay ₹${selection.offering.price}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
