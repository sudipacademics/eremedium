import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useApi, useCare } from '../../store';
import type { Appointment, Plan } from '../../types';
import { addDays, inr, todayIst } from '../../format';
import { Field, Modal } from '../ui';
import { ReferralInput, referralBody, referralFrom, referralReady } from './ReferralInput';
import { AES, F } from '../../flavor';

const LOCKED = new Set(['Completed', 'Cancelled', 'Reported', 'No Show']);

type Row = { key: string; id?: number; no: number; date: string; time: string; status: string; locked: boolean };

function weekdayUtc(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function nextSuggestedDay(date: string) {
  const next = addDays(date || todayIst(), 1);
  return weekdayUtc(next) === 0 ? addDays(next, 1) : next;
}

function rowsFrom(sessions: Appointment[]): Row[] {
  return sessions
    .filter((s) => s.status !== 'Cancelled')
    .sort((a, b) => (a.session_no || 0) - (b.session_no || 0))
    .map((s) => ({
      key: `s-${s.id}`,
      id: s.id,
      no: s.session_no || 0,
      date: s.date,
      time: (s.time || '').slice(0, 5),
      status: s.status,
      locked: LOCKED.has(s.status),
    }));
}

function resizeRows(rows: Row[], count: number): Row[] {
  const locked = rows.filter((r) => r.locked).length;
  const n = Math.max(locked, Math.min(100, count));
  const next = rows.slice(0, n);
  while (next.length < n) {
    const prev = next[next.length - 1];
    next.push({
      key: `new-${next.length}-${prev?.date || 'd'}`,
      no: next.length + 1,
      date: prev ? nextSuggestedDay(prev.date) : todayIst(),
      time: prev?.time || '10:00',
      status: 'Scheduled',
      locked: false,
    });
  }
  return next.map((r, i) => ({ ...r, no: i + 1 }));
}

export function PlanEditForm({ planId, onClose }: { planId: number; onClose: () => void }) {
  const { meta, mutate } = useCare();
  const { data, error } = useApi<{ plan: Plan; sessions: Appointment[] }>(`/plans/${planId}`);
  const therapists = (meta?.practitioners || []).filter((p) => p.active && p.role === 'Physiotherapist');
  const [ready, setReady] = useState(false);
  const [condition, setCondition] = useState('');
  const [therapist, setTherapist] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('Active');
  const [referral, setReferral] = useState(referralFrom({}));
  const [packageName, setPackageName] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data || ready) return;
    const plan = data.plan;
    setCondition(plan.condition || '');
    setTherapist(plan.practitioner_id ? String(plan.practitioner_id) : '');
    setNotes(plan.notes || '');
    setStatus(plan.status);
    setReferral(referralFrom(plan));
    setPackageName(plan.package_name || '');
    setPrice(plan.package_price != null ? String(plan.package_price) : '');
    setFee(String(plan.fee ?? 0));
    setRows(rowsFrom(data.sessions));
    setReady(true);
  }, [data, ready]);

  const plan = data?.plan;
  const lockedCount = rows.filter((r) => r.locked).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!plan) return;
    if (status === 'Discontinued' && plan.status !== 'Discontinued' && !window.confirm(`Discontinue ${plan.code}? Remaining scheduled sessions will be cancelled.`)) return;
    if (!referralReady(referral)) return;
    if (rows.some((r) => !r.locked && !/^\d{4}-\d{2}-\d{2}$/.test(r.date))) return;
    setBusy(true);
    const saved = await mutate(
      () =>
        api<Plan>(`/plans/${plan.id}`, {
          method: 'PATCH',
          body: {
            condition,
            notes,
            status,
            practitioner_id: therapist || null,
            ...referralBody(referral),
            total_sessions: rows.length,
            sessions: rows.filter((r) => r.id).map((r) => ({ id: r.id, date: r.date, time: r.time })),
            new_sessions: rows.filter((r) => !r.id).map((r) => ({ date: r.date, time: r.time })),
            ...(plan.billing === 'package'
              ? { package_name: packageName, package_price: Number(price) || 0 }
              : { fee: Number(fee) || 0 }),
          },
        }),
      (p) => `${p.code} updated. Sessions and the invoice now match this plan.`,
    );
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <Modal
      title="Edit treatment plan"
      subtitle={plan ? `${plan.patient} · ${plan.code}` : 'Loading the plan'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="plan-edit-form" className="btn btn-primary" disabled={busy || !plan || !referralReady(referral)}>
            {busy ? 'Saving…' : 'Save plan'}
          </button>
        </>
      }
    >
      <form id="plan-edit-form" onSubmit={submit} className="stack">
        {error && <p className="neg">{error}</p>}
        {!plan && !error && <p className="muted">Loading the plan…</p>}
        {plan && (
          <>
            <p className="muted small">Changes here update the booked sessions in Session Management{plan.billing === 'package' ? ' and the package invoice' : ''}.</p>
            <div className="grid-2">
              <Field label={AES ? 'Concern / area' : 'Condition / diagnosis'}>
                <input value={condition} onChange={(e) => setCondition(e.target.value)} />
              </Field>
              <Field label={F.therapist}>
                <select value={therapist} onChange={(e) => setTherapist(e.target.value)}>
                  <option value="">Not assigned</option>
                  {therapists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid-2">
              <Field label="Plan status">
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="Active">Active</option>
                  <option value="On Hold">On hold</option>
                  <option value="Completed">Completed</option>
                  <option value="Discontinued">Discontinued</option>
                </select>
              </Field>
              <Field label="Referred by *" group>
                <ReferralInput value={referral} onChange={setReferral} onNavigate={onClose} />
              </Field>
            </div>
            {plan.billing === 'package' ? (
              <div className="grid-2">
                <Field label="Package name">
                  <input value={packageName} onChange={(e) => setPackageName(e.target.value)} />
                </Field>
                <Field label="Package price (₹)" hint="The invoice total follows this price. GST, if included, stays inside it.">
                  <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} required />
                </Field>
              </div>
            ) : (
              <Field label="Fee per visit (₹)">
                <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
              </Field>
            )}
            <Field label="Sessions *" hint={lockedCount ? `${lockedCount} completed session${lockedCount === 1 ? '' : 's'} stay as they are.` : 'Set the date and time for every session.'} group>
              <div className="session-count-line">
                <input
                  type="number"
                  min={Math.max(1, lockedCount)}
                  max={100}
                  value={rows.length}
                  aria-label="Number of sessions"
                  onChange={(e) => setRows((prev) => resizeRows(prev, Math.floor(Number(e.target.value)) || prev.length))}
                />
                {plan.billing === 'package' && <span className="muted small">{inr((Number(price) || 0) / Math.max(rows.length, 1), true)} per session</span>}
              </div>
              <div className="session-dates edit-sessions">
                {rows.map((r, i) => (
                  <div key={r.key} className="session-date-row edit">
                    <span>Session {r.no}</span>
                    <input
                      type="date"
                      value={r.date}
                      required
                      disabled={r.locked}
                      aria-label={`Session ${r.no} date`}
                      onChange={(e) => setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, date: e.target.value } : row)))}
                    />
                    <input
                      type="time"
                      value={r.time}
                      required
                      disabled={r.locked}
                      aria-label={`Session ${r.no} time`}
                      onChange={(e) => setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, time: e.target.value } : row)))}
                    />
                    <small className="muted">{r.locked ? r.status : 'Scheduled'}</small>
                  </div>
                ))}
              </div>
            </Field>
            <Field label="Notes">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
