'use client';

import { useEffect, useState } from 'react';

import { api, type CallSessionView } from '@/lib/api';

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** Shown to the devotee once a call that actually connected has ended. */
export function RateCall({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<CallSessionView | null>(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The call can take a moment to be marked ended after hang-up.
    const fetchView = (attempt: number) =>
      api
        .get<CallSessionView>(`calls/sessions/${sessionId}`)
        .then((next) => {
          if (cancelled) return;
          if ((next.status === 'INITIATED' || next.status === 'ACTIVE') && attempt < 3) {
            window.setTimeout(() => void fetchView(attempt + 1), 1500);
            return;
          }
          setView(next);
          if (next.review) {
            setRating(next.review.rating);
            setComment(next.review.comment ?? '');
          }
        })
        .catch(() => undefined);
    void fetchView(0);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!view || !view.startTime || view.status === 'INITIATED' || view.status === 'ACTIVE') return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`calls/sessions/${sessionId}/review`, { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your rating');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card text-center">
        <p className="font-semibold">Thank you for your feedback</p>
        <p className="mt-1 text-sm text-slate-400">It helps other devotees choose the right expert.</p>
      </div>
    );
  }

  const shown = hover || rating;
  return (
    <div className="card space-y-3 text-center">
      <p className="font-semibold">{view.review ? 'Update your rating' : `How was your consultation with ${view.astrologer.displayName}?`}</p>
      <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="p-0.5 text-ved-gold-400 transition-transform hover:scale-110"
          >
            <svg viewBox="0 0 24 24" className="h-9 w-9" fill={n <= shown ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
            </svg>
          </button>
        ))}
      </div>
      <p className="h-5 text-sm text-slate-400">{LABELS[shown]}</p>
      {rating > 0 && (
        <textarea
          className="input min-h-20 text-left"
          placeholder="Share a few words about your experience (optional)"
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <button type="button" className="btn-primary w-full" disabled={rating === 0 || busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : 'Submit rating'}
      </button>
    </div>
  );
}
