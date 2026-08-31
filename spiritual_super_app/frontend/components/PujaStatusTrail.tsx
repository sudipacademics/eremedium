'use client';

import type { PujaBooking, PujaBookingStatus } from '@/lib/api';

const STAGES: ReadonlyArray<{ status: PujaBookingStatus; label: string; blurb: string }> = [
  { status: 'CONFIRMED', label: 'Booked', blurb: 'Your sankalp has reached the temple' },
  { status: 'IN_PROGRESS', label: 'Being performed', blurb: 'The pandits have begun the puja' },
  { status: 'COMPLETED', label: 'Performed', blurb: 'Recording available to watch' },
  { status: 'PRASAD_DISPATCHED', label: 'Prasad posted', blurb: 'On its way to you' },
];

function formatDate(iso: string | null): string | null {
  return iso === null ? null : new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The devotee cannot see the puja happen, so this trail is the product they actually receive: it is
 * the only evidence that something was done with the money they paid. Reached stages carry their own
 * proof -- the recording, the courier tracking number -- rather than just a tick.
 */
export function PujaStatusTrail({ booking }: { booking: PujaBooking }) {
  const currentIndex = STAGES.findIndex((stage) => stage.status === booking.status);

  return (
    <ol className="space-y-3">
      {STAGES.map((stage, index) => {
        const reached = index <= currentIndex;
        const current = index === currentIndex;

        return (
          <li key={stage.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                  reached ? 'bg-saffron-500 text-night-950' : 'border border-white/15 text-slate-500'
                }`}
                aria-hidden
              >
                {reached ? '✓' : index + 1}
              </span>
              {index < STAGES.length - 1 && (
                <span className={`mt-1 w-px grow ${index < currentIndex ? 'bg-saffron-500/60' : 'bg-white/10'}`} />
              )}
            </div>

            <div className="pb-1">
              <p className={`text-sm font-medium ${reached ? 'text-slate-100' : 'text-slate-500'}`}>
                {stage.label}
                {current && <span className="ml-2 text-xs font-normal text-saffron-300">now</span>}
              </p>
              <p className="text-xs text-slate-500">{stage.blurb}</p>

              {stage.status === 'CONFIRMED' && booking.scheduledFor && (
                <p className="mt-1 text-xs text-slate-400">
                  Scheduled for {formatDate(booking.scheduledFor)}
                </p>
              )}

              {stage.status === 'COMPLETED' && reached && (
                <div className="mt-1 space-y-1">
                  {booking.performedAt && (
                    <p className="text-xs text-slate-400">Performed {formatDate(booking.performedAt)}</p>
                  )}
                  {booking.videoProofUrl && (
                    <a
                      href={booking.videoProofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs font-medium text-saffron-300 underline decoration-saffron-500/40 hover:text-saffron-200"
                    >
                      Watch the recording
                    </a>
                  )}
                </div>
              )}

              {stage.status === 'PRASAD_DISPATCHED' && reached && booking.prasadAwb && (
                <p className="mt-1 text-xs text-slate-400">
                  {booking.prasadCourier ? `${booking.prasadCourier} · ` : ''}
                  <span className="tabular">{booking.prasadAwb}</span>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
