'use client';

import { useState } from 'react';

import { api } from '@/lib/api';
import { DEBOARD_REASONS, todayIst, type ProviderItem } from '@/lib/providers';

import { Modal, dangerButton, errorText, ghostButton, inputClass, labelClass, primaryButton } from './Overlay';

type Done = (message: string) => void;

function useSubmit(onDone: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(message);
    } catch (caught) {
      setError(errorText(caught, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function SuspendDialog({ provider, onClose, onDone }: { provider: ProviderItem; onClose: () => void; onDone: Done }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit(onDone);
  return (
    <Modal
      title="Suspend provider"
      subtitle={provider.displayName}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={dangerButton}
            disabled={busy || reason.trim().length < 3}
            onClick={() => void run(() => api.post(`admin/providers/${provider.id}/suspend`, { reason: reason.trim() }), `${provider.displayName} suspended`)}
          >
            {busy ? 'Suspending…' : 'Suspend'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ved-green-900">
        <p>
          They’ll be taken offline, hidden from the website and unable to receive consultations until you lift the suspension. A call in
          progress is not cut off, and their earnings stay payable.
        </p>
        <label className="block">
          <span className={labelClass}>Reason (shown in the audit log)</span>
          <textarea className={`${inputClass} min-h-24`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        {error && <p className="text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

export function ReinstateDialog({ provider, onClose, onDone }: { provider: ProviderItem; onClose: () => void; onDone: Done }) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useSubmit(onDone);
  const verb = provider.accountStatus === 'SUSPENDED' ? 'Lift suspension' : 'Reinstate provider';
  return (
    <Modal
      title={verb}
      subtitle={provider.displayName}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() =>
              void run(
                () => api.post(`admin/providers/${provider.id}/reinstate`, note.trim() ? { note: note.trim() } : {}),
                `${provider.displayName} is active again`,
              )
            }
          >
            {busy ? 'Saving…' : verb}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ved-green-900">
        <p>
          {provider.accountStatus === 'SUSPENDED'
            ? `Suspended for: ${provider.suspensionReason ?? 'no reason recorded'}.`
            : `Deboarding (${provider.deboardReason ?? 'no reason'}) will be cancelled.`}{' '}
          The provider becomes active and can go online again; they stay offline until they (or you) switch them online.
        </p>
        <label className="block">
          <span className={labelClass}>Note (optional)</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        {error && <p className="text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

export function DeboardDialog({ provider, onClose, onDone }: { provider: ProviderItem; onClose: () => void; onDone: Done }) {
  const [reason, setReason] = useState<(typeof DEBOARD_REASONS)[number]>(DEBOARD_REASONS[0]);
  const [effectiveDate, setEffectiveDate] = useState(todayIst());
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, run } = useSubmit(onDone);
  const immediate = effectiveDate <= todayIst();
  return (
    <Modal
      title="Deboard provider"
      subtitle={provider.displayName}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={dangerButton}
            disabled={busy || !confirmed || !effectiveDate || (reason === 'Other' && notes.trim().length < 3)}
            onClick={() =>
              void run(
                () => api.post(`admin/providers/${provider.id}/deboard`, { reason, effectiveDate, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
                immediate ? `${provider.displayName} deboarded` : `${provider.displayName} will be deboarded on ${effectiveDate}`,
              )
            }
          >
            {busy ? 'Saving…' : immediate ? 'Deboard now' : 'Schedule deboarding'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ved-green-900">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Reason</span>
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as (typeof DEBOARD_REASONS)[number])}>
              {DEBOARD_REASONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Effective date</span>
            <input type="date" className={inputClass} value={effectiveDate} min={todayIst()} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>Notes {reason === 'Other' ? '(required)' : '(optional)'}</span>
          <textarea className={`${inputClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Handover details, final settlement, etc." />
        </label>
        <ul className="list-disc space-y-1 rounded-2xl bg-orange-50 px-6 py-3 text-[13px] text-orange-900">
          <li>{immediate ? 'Immediately' : `From ${effectiveDate}`}, they’re removed from the website and can’t receive consultations.</li>
          {!immediate && <li>Until then they show as “Deboarding” and stay bookable.</li>}
          <li>Consultation history, earnings and payouts are kept; settle any pending payout separately.</li>
          <li>The change is recorded in the provider’s audit history and can be reversed with “Reinstate”.</li>
        </ul>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-rose-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I confirm {provider.displayName} should be deboarded.</span>
        </label>
        {error && <p className="text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

export function DeleteDialog({ provider, onClose, onDone }: { provider: ProviderItem; onClose: () => void; onDone: Done }) {
  const [typed, setTyped] = useState('');
  const { busy, error, run } = useSubmit(onDone);
  const hasHistory = provider.sessions > 0 || Number(provider.totalEarnings) > 0;
  return (
    <Modal
      title="Delete provider"
      subtitle={provider.displayName}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={dangerButton}
            disabled={busy || hasHistory || typed.trim() !== provider.displayName.trim()}
            onClick={() => void run(() => api.del(`admin/providers/${provider.id}`), `${provider.displayName} deleted`)}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ved-green-900">
        {hasHistory ? (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
            This provider has consultation or earnings history, which has to be kept for accounting. Use <strong>Deboard</strong> to remove them
            from the website instead.
          </p>
        ) : (
          <>
            <p>
              This permanently removes the provider profile. Their user account stays, so they can still sign in as a regular user. This can’t
              be undone.
            </p>
            <label className="block">
              <span className={labelClass}>Type “{provider.displayName}” to confirm</span>
              <input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
          </>
        )}
        {error && <p className="text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
