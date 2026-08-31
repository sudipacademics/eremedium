'use client';

import { useState } from 'react';

import { KundaliView } from '@/components/KundaliView';
import { ApiError, api, type Kundali } from '@/lib/api';

/**
 * The client's chart, for the astrologer during a consultation.
 *
 * Loaded on demand rather than with the call, because most of the payload is only wanted if the
 * astrologer actually opens it, and the gateway authorises the read against the live call anyway.
 */
export function ClientKundali({ userId, clientName }: { userId: string; clientName: string }) {
  const [kundali, setKundali] = useState<Kundali | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const open = async () => {
    setState('loading');
    setMessage(null);
    try {
      setKundali(await api.get<Kundali>(`vedic/kundali/consultation/${userId}?depth=2`));
      setState('idle');
    } catch (caught) {
      setState('error');
      setMessage(
        caught instanceof ApiError && caught.status === 428
          ? `${clientName} has not entered their birth details yet.`
          : caught instanceof Error
            ? caught.message
            : 'Could not load the chart',
      );
    }
  };

  if (kundali) {
    return <KundaliView kundali={kundali} heading={`${clientName}'s kundali`} />;
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{clientName}&apos;s kundali</p>
          <p className="text-xs text-slate-400">Chart, nakshatras and running dasha</p>
        </div>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-sm"
          onClick={() => void open()}
          disabled={state === 'loading'}
        >
          {state === 'loading' ? 'Opening…' : 'Open'}
        </button>
      </div>
      {state === 'error' && message && <p className="mt-2 text-xs text-amber-200">{message}</p>}
    </div>
  );
}
