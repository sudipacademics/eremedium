'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { api } from '@/lib/api';
import { PAYOUT_BADGE, todayIst, type PayoutRecord, type PayoutSummary, type ProviderItem } from '@/lib/providers';

import { Modal, Pill, errorText, ghostButton, inputClass, inr, labelClass, primaryButton, shortDate } from './Overlay';

export function usePayouts(providerId: string) {
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api
      .get<PayoutSummary>(`admin/providers/${providerId}/payouts`)
      .then(setSummary)
      .catch((caught: unknown) => setError(errorText(caught, 'Could not load payouts')));
  }, [providerId]);
  useEffect(load, [load]);
  return { summary, error, reload: load, setSummary };
}

function Stat({ label, value, tone = 'text-ved-green-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-ved-green-900/[0.07] bg-white px-3.5 py-3">
      <p className="text-xs text-ved-green-800/60">{label}</p>
      <p className={`mt-0.5 font-display text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function AccountForm({ providerId, current, onSaved, onCancel }: { providerId: string; current: PayoutSummary['account']; onSaved: (next: PayoutSummary) => void; onCancel: () => void }) {
  const [type, setType] = useState<'BANK' | 'UPI'>(current?.accountType ?? 'BANK');
  const [name, setName] = useState(current?.accountName ?? '');
  const [number, setNumber] = useState('');
  const [ifsc, setIfsc] = useState(current?.ifsc ?? '');
  const [vpa, setVpa] = useState(current?.vpa ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = type === 'BANK' ? { accountType: type, accountName: name, accountNumber: number, ifsc } : { accountType: type, accountName: name, vpa };
      onSaved(await api.put<PayoutSummary>(`admin/providers/${providerId}/payout-account`, body));
    } catch (caught) {
      setError(errorText(caught, 'Could not save the payout account'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-ved-green-900/10 bg-white p-4">
      <div className="flex gap-2" role="radiogroup" aria-label="Account type">
        {(['BANK', 'UPI'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={type === value}
            onClick={() => setType(value)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ${type === value ? 'bg-ved-green-800 text-ved-cream-50 ring-ved-green-800' : 'bg-white text-ved-green-900 ring-ved-green-900/15'}`}
          >
            {value === 'BANK' ? 'Bank account' : 'UPI ID'}
          </button>
        ))}
      </div>
      <label className="block">
        <span className={labelClass}>Account holder name</span>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} />
      </label>
      {type === 'BANK' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Account number</span>
            <input
              className={inputClass}
              inputMode="numeric"
              autoComplete="off"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
              placeholder={current?.accountNumberMasked ?? '9–18 digits'}
              required
            />
          </label>
          <label className="block">
            <span className={labelClass}>IFSC</span>
            <input className={`${inputClass} uppercase`} value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="HDFC0001234" required maxLength={11} />
          </label>
        </div>
      ) : (
        <label className="block">
          <span className={labelClass}>UPI ID</span>
          <input className={inputClass} value={vpa} onChange={(e) => setVpa(e.target.value.trim())} placeholder="name@okhdfc" required />
        </label>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={ghostButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Saving…' : 'Save account'}
        </button>
      </div>
    </form>
  );
}

function HistoryRow({ payout, providerId, canRefresh, onUpdated }: { payout: PayoutRecord; providerId: string; canRefresh: boolean; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = PAYOUT_BADGE[payout.status];
  const inFlight = payout.method === 'RAZORPAYX' && ['PROCESSING', 'QUEUED', 'PENDING'].includes(payout.status);
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`admin/providers/${providerId}/payouts/${payout.id}/refresh`);
      onUpdated();
    } catch (caught) {
      setError(errorText(caught, 'Could not refresh'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold tabular-nums text-ved-green-900">{inr(payout.amount)}</p>
          <p className="text-xs text-ved-green-800/60">
            {shortDate(payout.processedAt ?? payout.createdAt)} · {payout.method === 'RAZORPAYX' ? `RazorpayX ${payout.mode ?? ''}` : payout.mode ?? 'Manual'}
            {payout.destination ? ` · ${payout.destination}` : ''}
          </p>
          {payout.reference && <p className="text-xs text-ved-green-800/60">Ref: {payout.reference}</p>}
          {payout.note && <p className="text-xs text-ved-green-800/60">{payout.note}</p>}
          {payout.failureReason && <p className="text-xs text-rose-600">{payout.failureReason}</p>}
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={badge.tone}>{badge.label}</Pill>
          {inFlight && canRefresh && (
            <button type="button" onClick={() => void refresh()} disabled={busy} className="text-xs font-semibold text-ved-green-700 hover:underline disabled:opacity-50">
              {busy ? 'Checking…' : 'Refresh status'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function PayoutPanel({ provider, canFinance, onPay, refreshKey }: { provider: ProviderItem; canFinance: boolean; onPay: () => void; refreshKey: number }) {
  const { summary, error, reload, setSummary } = usePayouts(provider.id);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (refreshKey > 0) reload();
  }, [refreshKey, reload]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!summary) return <p className="text-sm text-ved-green-800/60">Loading payouts…</p>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Total earnings" value={inr(summary.totalEarnings)} />
        <Stat label="This month" value={inr(summary.monthEarnings)} />
        <Stat label="Pending payout" value={inr(summary.pendingPayout)} tone={Number(summary.pendingPayout) > 0 ? 'text-rose-600' : 'text-ved-green-900'} />
        <Stat label="Paid out" value={inr(summary.paidOut)} />
      </div>
      {Number(summary.inFlight) > 0 && <p className="text-xs text-sky-700">{inr(summary.inFlight)} is on its way through RazorpayX.</p>}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ved-green-900">Payout account</h3>
          {canFinance && !editing && (
            <button type="button" className="text-xs font-semibold text-ved-green-700 hover:underline" onClick={() => setEditing(true)}>
              {summary.account ? 'Change' : 'Add account'}
            </button>
          )}
        </div>
        {editing ? (
          <AccountForm
            providerId={provider.id}
            current={summary.account}
            onCancel={() => setEditing(false)}
            onSaved={(next) => {
              setSummary(next);
              setEditing(false);
            }}
          />
        ) : summary.account ? (
          <p className="rounded-2xl border border-ved-green-900/[0.07] bg-white px-4 py-3 text-sm text-ved-green-900">
            <span className="font-medium">{summary.account.accountName}</span>
            <span className="block text-xs text-ved-green-800/60">
              {summary.account.accountType === 'UPI' ? `UPI · ${summary.account.vpa}` : `Bank · ${summary.account.accountNumberMasked} · ${summary.account.ifsc}`}
            </span>
          </p>
        ) : (
          <p className="rounded-2xl border border-dashed border-ved-green-900/20 px-4 py-3 text-sm text-ved-green-800/60">
            No bank account or UPI ID on file. RazorpayX payouts need one.
          </p>
        )}
        {!summary.payoutsEnabled && (
          <p className="mt-2 text-xs text-amber-700">
            RazorpayX isn’t configured on this server yet, so only manual payout records are available.
          </p>
        )}
      </section>

      {canFinance && (
        <button type="button" className={`${primaryButton} w-full py-3`} onClick={onPay} disabled={Number(summary.pendingPayout) <= 0}>
          Make Payout
        </button>
      )}

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ved-green-900">Payout history</h3>
        {summary.history.length === 0 ? (
          <p className="text-sm text-ved-green-800/60">No payouts yet.</p>
        ) : (
          <ul className="divide-y divide-ved-green-900/[0.07]">
            {summary.history.map((payout) => (
              <HistoryRow key={payout.id} payout={payout} providerId={provider.id} canRefresh={canFinance} onUpdated={reload} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const MANUAL_MODES = ['Bank transfer (NEFT/IMPS)', 'UPI', 'Cheque', 'Cash'];

export function MakePayoutDialog({ provider, onClose, onDone }: { provider: ProviderItem; onClose: () => void; onDone: (payout: PayoutRecord) => void }) {
  const { summary, error: loadError } = usePayouts(provider.id);
  const [method, setMethod] = useState<'RAZORPAYX' | 'MANUAL'>('RAZORPAYX');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState(MANUAL_MODES[0]!);
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIst());
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const razorpayReady = Boolean(summary?.payoutsEnabled && summary.account);
  useEffect(() => {
    if (!summary) return;
    setAmount(summary.pendingPayout);
    if (!summary.payoutsEnabled || !summary.account) setMethod('MANUAL');
  }, [summary]);

  const pending = Number(summary?.pendingPayout ?? 0);
  const value = Number(amount);
  const amountError = !amount ? null : !/^\d{1,9}(\.\d{1,2})?$/.test(amount) || value <= 0 ? 'Enter a valid amount' : value > pending ? `Cannot exceed the pending ${inr(pending)}` : null;
  const canContinue = summary !== null && !amountError && value > 0 && (method === 'RAZORPAYX' ? razorpayReady : reference.trim().length >= 3);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        method === 'RAZORPAYX'
          ? { method, amount, ...(note.trim() ? { note: note.trim() } : {}) }
          : { method, amount, mode, reference: reference.trim(), paidOn, ...(note.trim() ? { note: note.trim() } : {}) };
      onDone(await api.post<PayoutRecord>(`admin/providers/${provider.id}/payouts`, body));
    } catch (caught) {
      setError(errorText(caught, 'Payout failed'));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={confirming ? 'Confirm payout' : 'Make payout'}
      subtitle={provider.displayName}
      onClose={busy ? () => undefined : onClose}
      size="sm"
      footer={
        confirming ? (
          <>
            <button type="button" className={ghostButton} onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </button>
            <button type="button" className={primaryButton} onClick={() => void submit()} disabled={busy}>
              {busy ? 'Processing…' : method === 'RAZORPAYX' ? `Pay ${inr(amount)}` : 'Record payout'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={ghostButton} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={primaryButton} onClick={() => setConfirming(true)} disabled={!canContinue}>
              Continue
            </button>
          </>
        )
      }
    >
      {loadError && <p className="text-sm text-rose-600">{loadError}</p>}
      {!summary && !loadError && <p className="text-sm text-ved-green-800/60">Loading balance…</p>}
      {summary && !confirming && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#f6eed8] px-4 py-3">
            <p className="text-xs text-[#7a5a22]">Pending payout</p>
            <p className="font-display text-2xl font-semibold text-ved-green-900">{inr(summary.pendingPayout)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payout method">
            {(
              [
                ['RAZORPAYX', 'RazorpayX', razorpayReady ? summary.account!.destination : !summary.payoutsEnabled ? 'Not configured' : 'Add an account first'],
                ['MANUAL', 'Record manual', 'Already paid outside'],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                disabled={value === 'RAZORPAYX' && !razorpayReady}
                onClick={() => setMethod(value)}
                className={`rounded-2xl px-3 py-2.5 text-left ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                  method === value ? 'bg-ved-green-50 ring-2 ring-ved-green-700' : 'bg-white ring-ved-green-900/15'
                }`}
              >
                <span className="block text-sm font-semibold text-ved-green-900">{label}</span>
                <span className="block truncate text-xs text-ved-green-800/60">{hint}</span>
              </button>
            ))}
          </div>
          <label className="block">
            <span className={labelClass}>Amount (₹)</span>
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
            {amountError && <span className="mt-1 block text-xs text-rose-600">{amountError}</span>}
          </label>
          {method === 'MANUAL' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={labelClass}>Paid via</span>
                  <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}>
                    {MANUAL_MODES.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelClass}>Paid on</span>
                  <input type="date" className={inputClass} value={paidOn} max={todayIst()} onChange={(e) => setPaidOn(e.target.value)} />
                </label>
              </div>
              <label className="block">
                <span className={labelClass}>Transaction reference / UTR</span>
                <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="e.g. UTR 4321…" />
              </label>
            </>
          )}
          <label className="block">
            <span className={labelClass}>Note (optional)</span>
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. September earnings" />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      )}
      {summary && confirming && (
        <div className="space-y-3 text-sm text-ved-green-900">
          <p>
            {method === 'RAZORPAYX' ? (
              <>
                Send <strong>{inr(amount)}</strong> to <strong>{provider.displayName}</strong> at <strong>{summary.account?.destination}</strong> through RazorpayX?
                The money leaves your RazorpayX balance immediately.
              </>
            ) : (
              <>
                Record that <strong>{inr(amount)}</strong> was paid to <strong>{provider.displayName}</strong> via {mode} on {paidOn} (ref {reference.trim()})?
              </>
            )}
          </p>
          <p className="text-xs text-ved-green-800/60">This is logged in the audit trail and reduces the provider’s pending payout.</p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
