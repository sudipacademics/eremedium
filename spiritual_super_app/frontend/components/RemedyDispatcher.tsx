'use client';

import { useEffect, useState } from 'react';

import { api, type PujaTemple } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

/**
 * The astrologer's side of the in-call puja recommendation.
 *
 * Note there is no price field: the astrologer chooses a puja from the platform's catalog and the
 * price travels with it. They previously typed the amount themselves, which meant the person selling
 * the remedy set what the devotee paid.
 */
export function RemedyDispatcher({ callSessionId }: { callSessionId: string }) {
  const [open, setOpen] = useState(false);
  const [temples, setTemples] = useState<PujaTemple[]>([]);
  const [offeringId, setOfferingId] = useState('');
  const [sankalpWish, setSankalpWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || temples.length > 0) return;
    void api
      .get<{ temples: PujaTemple[] }>('pujas/temples')
      .then((result) => setTemples(result.temples))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the catalog'),
      );
  }, [open, temples.length]);

  useSocketEvent<{ cardId: string; amountDebited: string }>('PUJA_REMEDY_RESULT', (payload) => {
    setNotice(`Accepted — ₹${payload.amountDebited} booked.`);
    setOpen(false);
  });

  const dispatch = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('remedies/dispatch', {
        callSessionId,
        pujaOfferingId: offeringId,
        ...(sankalpWish.trim() ? { sankalpWish: sankalpWish.trim() } : {}),
      });
      setNotice('Sent. They will see the card on their screen.');
      setSankalpWish('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the recommendation');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-ghost w-full" onClick={() => setOpen(true)}>
          Prescribe a puja
        </button>
        {notice && <p className="text-center text-xs text-emerald-300">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Prescribe a puja</p>
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-slate-200"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>

      <div>
        <label className="label" htmlFor="offering">
          Puja
        </label>
        <select
          id="offering"
          className="input"
          value={offeringId}
          onChange={(event) => setOfferingId(event.target.value)}
        >
          <option value="">Select a puja…</option>
          {temples.map((temple) => (
            <optgroup key={temple.id} label={`${temple.name} · ${temple.location}`}>
              {temple.offerings.map((offering) => (
                <option key={offering.id} value={offering.id}>
                  {offering.name} — ₹{offering.price}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          The price is set by the platform and shown to them as it appears here.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="wish">
          Note on the sankalp (optional)
        </label>
        <input
          id="wish"
          className="input"
          value={sankalpWish}
          onChange={(event) => setSankalpWish(event.target.value)}
          placeholder="For relief from Shani dasha"
        />
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">{notice}</p>}

      <button
        type="button"
        className="btn-primary w-full"
        disabled={busy || !offeringId}
        onClick={() => void dispatch()}
      >
        {busy ? 'Sending…' : 'Send recommendation'}
      </button>
    </div>
  );
}
