'use client';

import { useEffect, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

export interface PujaRemedyCardPayload {
  cardId: string;
  callSessionId: string;
  templeId: string;
  templeName: string;
  templeLocation: string;
  primaryDeity: string;
  liveStreamUrl: string | null;
  pujaOfferingId: string;
  pujaName: string;
  packagePrice: string;
  sankalpName: string;
  sankalpGotra: string | null;
  sankalpWish: string | null;
  expiresAt: string;
  authorizationEndpoint: string;
}

interface AuthorizationResult {
  cardId: string;
  pujaBookingId: string;
  amountDebited: string;
  walletBalanceAfter: string;
}

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/**
 * The in-call puja upsell, from the devotee's side.
 *
 * The backend has pushed this card since Sprint 3 and nothing rendered it, so the astrologer could
 * prescribe a remedy that the user never saw. The price shown here comes from the platform's catalog,
 * not from the astrologer on the call, and authorising it debits the wallet in one tap.
 */
export function RemedyCard({ callSessionId }: { callSessionId: string }) {
  const [card, setCard] = useState<PujaRemedyCardPayload | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuthorizationResult | null>(null);

  useSocketEvent<PujaRemedyCardPayload>('PUJA_REMEDY_CARD', (payload) => {
    // A card belongs to one call; ignore anything arriving for a different session.
    if (payload.callSessionId !== callSessionId) return;
    setCard(payload);
    setResult(null);
    setError(null);
    setRemaining(secondsLeft(payload.expiresAt));
  });

  useEffect(() => {
    if (!card || result) return;
    const timer = setInterval(() => {
      const left = secondsLeft(card.expiresAt);
      setRemaining(left);
      // The server has forgotten the card by now, so stop offering something that cannot be paid.
      if (left === 0) setCard(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [card, result]);

  if (!card) return null;

  const authorize = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<AuthorizationResult>(`remedies/${card.cardId}/authorize`));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        setError('Your wallet does not cover this puja. Top up from the wallet screen.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not authorise the puja');
      }
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="card border-emerald-400/30 bg-emerald-500/10 space-y-1">
        <p className="text-sm font-semibold text-emerald-100">Puja booked</p>
        <p className="text-xs text-emerald-200/80">
          {card.pujaName} at {card.templeName}. ₹{result.amountDebited} debited, balance ₹
          {result.walletBalanceAfter}. Track it under E-Puja.
        </p>
      </div>
    );
  }

  return (
    <div className="card border-saffron-400/40 bg-saffron-500/10 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-saffron-300">Recommended remedy</p>
          <p className="mt-0.5 font-semibold">{card.pujaName}</p>
          <p className="text-xs text-slate-300">
            {card.templeName} · {card.templeLocation}
          </p>
        </div>
        <p className="tabular shrink-0 text-sm font-semibold">₹{card.packagePrice}</p>
      </div>

      <div className="rounded-lg bg-black/20 px-3 py-2 text-xs text-slate-300">
        <p>
          Sankalp for <span className="font-medium text-slate-100">{card.sankalpName}</span>
          {card.sankalpGotra ? `, ${card.sankalpGotra} gotra` : ''}
        </p>
        {card.sankalpWish && <p className="mt-0.5 italic">“{card.sankalpWish}”</p>}
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-primary flex-1 py-2 text-sm"
          onClick={() => void authorize()}
          disabled={busy}
        >
          {busy ? 'Authorising…' : `Authorise ₹${card.packagePrice}`}
        </button>
        <button
          type="button"
          className="btn border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"
          onClick={() => setCard(null)}
          disabled={busy}
        >
          Not now
        </button>
      </div>

      <p className="text-center text-[11px] text-slate-400">
        Offer expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
      </p>
    </div>
  );
}
