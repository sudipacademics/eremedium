import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useApi, useCare } from '../../store';
import type { PhysioPackage, Plan } from '../../types';
import { addDays, inr, todayIst } from '../../format';
import { DiscountInput, discountAmount, Field, Modal, type DiscountType } from '../ui';
import { loadPatientChoice, PatientPicker, resolvePatient, type PatientChoice, type PatientDraft } from './PatientForm';
import { nextSlot } from './AppointmentForms';
import { listValue, TherapyPicker, usePhysioTherapies } from './PackageForm';
import { ReferralInput, referralBody, referralReady, SELF_REFERRAL } from './ReferralInput';
import { AES, F } from '../../flavor';

type Mode = 'package' | 'custom' | 'per_session';

function weekdayUtc(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/* Next calendar day, skipping Sunday only as a starting suggestion. */
function nextSuggestedDay(date: string) {
  const next = addDays(date, 1);
  return weekdayUtc(next) === 0 ? addDays(next, 1) : next;
}

function firstSuggestedDay() {
  const today = todayIst();
  return weekdayUtc(today) === 0 ? addDays(today, 1) : today;
}

function buildSessionDates(count: number, existing: string[]) {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (existing[i]) out.push(existing[i]);
    else out.push(i === 0 ? firstSuggestedDay() : nextSuggestedDay(out[i - 1] || firstSuggestedDay()));
  }
  return out;
}

export function PlanForm({ patientId, packageId, onClose }: { patientId?: number; packageId?: number; onClose: () => void }) {
  const { meta, branch, mutate, can } = useCare();
  const therapies = usePhysioTherapies();
  const therapists = (meta?.practitioners || []).filter((p) => p.active && p.role === 'Physiotherapist');
  const { data: packages } = useApi<PhysioPackage[]>('/physio/packages');
  const [mode, setMode] = useState<Mode>('package');
  const [patient, setPatient] = useState<PatientChoice>(null);
  const [draft, setDraft] = useState<PatientDraft | null>(null);
  const [pkgId, setPkgId] = useState(packageId ? String(packageId) : '');
  const [ids, setIds] = useState<number[]>([]);
  const [customName, setCustomName] = useState('');
  const [saveAsPackage, setSaveAsPackage] = useState(false);
  const [validity, setValidity] = useState('45');
  const [serviceId, setServiceId] = useState(therapies[0]?.id ?? 0);
  const [fee, setFee] = useState(String(therapies[0]?.price ?? 0));
  const [sessions, setSessions] = useState('10');
  const [sessionDates, setSessionDates] = useState<string[]>(() => buildSessionDates(10, []));
  const [price, setPrice] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);
  const [time, setTime] = useState(nextSlot());
  const [therapist, setTherapist] = useState(therapists[0] ? String(therapists[0].id) : '');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [referral, setReferral] = useState(SELF_REFERRAL);
  const [discount, setDiscount] = useState('0');
  const [discountType, setDiscountType] = useState<DiscountType>('flat');
  const [paid, setPaid] = useState('0');
  const [payMode, setPayMode] = useState('UPI');
  const [includeGst, setIncludeGst] = useState(false);
  const [serviceQuery, setServiceQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const offered = (packages || []).filter((p) => p.active);
  const pkg = offered.find((p) => String(p.id) === pkgId);
  const customValue = listValue(therapies, ids, Number(sessions));

  useEffect(() => {
    if (patientId) loadPatientChoice(patientId).then(setPatient).catch(() => undefined);
  }, [patientId]);

  const initialMode = useRef(false);
  useEffect(() => {
    if (!packages || initialMode.current) return;
    initialMode.current = true;
    if (!packages.some((p) => p.active) && !packageId) setMode('custom');
  }, [packages, packageId]);

  useEffect(() => {
    if (mode === 'package' && pkg) {
      setSessions(String(pkg.sessions));
      setPrice(String(pkg.price));
    }
  }, [mode, pkg]);

  useEffect(() => {
    if (mode === 'custom' && !priceTouched) setPrice(String(customValue || ''));
  }, [mode, customValue, priceTouched]);

  useEffect(() => {
    const n = Math.floor(Number(sessions));
    if (!Number.isFinite(n) || n < 1) {
      setSessionDates([]);
      return;
    }
    const count = Math.min(100, n);
    setSessionDates((prev) => (prev.length === count ? prev : buildSessionDates(count, prev)));
  }, [sessions]);

  const packagePrice = Number(price) || 0;
  const discountRs = discountAmount(packagePrice, discount, discountType);
  const net = Math.max(Math.round((packagePrice - discountRs) * 100) / 100, 0);
  const billedAsPackage = mode !== 'per_session';
  const canBill = can('Billing & Invoice', 'create') || can('Appointments', 'create');
  const datesReady = sessionDates.length === Number(sessions) && sessionDates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const ready =
    (billedAsPackage ? (mode === 'package' ? Boolean(pkg) : ids.length > 0) && Number(sessions) > 0 : Number(sessions) > 0) && datesReady && referralReady(referral);

  const gstAmount = includeGst && billedAsPackage ? Math.round(((net * 5) / 105) * 100) / 100 : 0;
  const summary = useMemo(() => {
    if (mode === 'per_session') return `Pay per visit: ${inr(Number(fee) || 0)} × ${sessions || 0} sessions = ${inr((Number(fee) || 0) * (Number(sessions) || 0))}, billed visit by visit (no invoice is created now).`;
    const per = Number(sessions) > 0 ? packagePrice / Number(sessions) : 0;
    const gst = includeGst ? ` GST 5% ${inr(gstAmount, true)} is included in ${inr(net, true)}.` : '';
    return `Package billed now: ${inr(packagePrice)} for ${sessions || 0} sessions (${inr(per, true)} per session)${discountRs ? `, less ${inr(discountRs, true)} discount = ${inr(net, true)}` : ''}.${gst}`;
  }, [mode, fee, sessions, packagePrice, discountRs, net, includeGst, gstAmount]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const service = therapies.find((s) => s.id === Number(serviceId));
    const base = {
      total_sessions: Number(sessions),
      session_dates: sessionDates,
      start_date: sessionDates[0],
      time,
      practitioner_id: therapist || null,
      condition,
      notes,
      branch_id: branch || undefined,
      ...referralBody(referral),
    };
    const body =
      mode === 'per_session'
        ? { ...base, billing: 'per_session', service: service?.name, fee: Number(fee) || 0 }
        : {
            ...base,
            billing: 'package',
            package_id: mode === 'package' ? Number(pkgId) : undefined,
            therapy_ids: mode === 'custom' ? ids : undefined,
            package_name: mode === 'custom' ? customName : undefined,
            save_package: mode === 'custom' && saveAsPackage,
            validity_days: mode === 'custom' ? validity : undefined,
            package_price: packagePrice,
            discount: Number(discount) || 0,
            discount_type: discountType,
            paid: Number(paid) || 0,
            mode: payMode,
            include_gst: includeGst,
          };
    const plan = await mutate(
      async () => {
        const pid = await resolvePatient(patient, draft);
        return api<Plan>('/plans', { method: 'POST', body: { ...body, patient_id: pid } });
      },
      (p) => `${p.code}: ${p.total_sessions} sessions scheduled for ${p.patient}${p.invoice_number ? ` · invoice ${p.invoice_number}` : ''}`,
    );
    setBusy(false);
    if (plan) onClose();
  };

  return (
    <Modal
      title={AES ? 'New Treatment Plan' : 'Book Physiotherapy'}
      subtitle="Choose a package, build a custom package or pay per session; all sessions are scheduled at once"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="foot-total">{billedAsPackage ? <>Bill <strong>{inr(net, true)}</strong></> : null}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="plan-form" className="btn btn-primary" disabled={busy || !ready}>
            {busy ? 'Scheduling…' : `Schedule ${sessions || 0} sessions`}
          </button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="stack">
        <Field label="Patient *" group>
          <PatientPicker value={patient} onChange={setPatient} newDraft={draft} onNewDraft={setDraft} />
        </Field>

        <Field label="Referred by *" group>
          <ReferralInput value={referral} onChange={setReferral} onNavigate={onClose} />
        </Field>

        <div className="seg plan-mode" role="group" aria-label="Plan type">
          <button type="button" className={mode === 'package' ? 'on' : ''} onClick={() => setMode('package')}>
            Package ({offered.length})
          </button>
          <button type="button" className={mode === 'custom' ? 'on' : ''} onClick={() => { setMode('custom'); setPriceTouched(false); }}>
            Custom package
          </button>
          <button type="button" className={mode === 'per_session' ? 'on' : ''} onClick={() => setMode('per_session')}>
            Pay per visit
          </button>
        </div>
        <p className="muted small mode-hint">
          {mode === 'per_session'
            ? 'Each visit is billed separately. To bill the whole course at once (e.g. ₹700 for 7 sessions), use Custom package.'
            : 'One invoice for the full package amount is created now; part payment is allowed and the balance stays due.'}
        </p>

        {mode === 'package' && packages && offered.length === 0 && (
          <div className="info-box">
            <div>
              <p>No packages have been created yet.</p>
              <p className="small">
                Create them in{' '}
                <Link to="/physio/packages" className="link" onClick={onClose}>
                  {F.packages}
                </Link>
                , or use <b>Custom package</b> and tick “Save to package list” to add one while booking.
              </p>
              <button type="button" className="btn btn-soft sm" onClick={() => setMode('custom')}>
                Use custom package
              </button>
            </div>
          </div>
        )}
        {mode === 'package' && offered.length > 0 && (
          <>
            <Field label="Package *">
              <select value={pkgId} onChange={(e) => setPkgId(e.target.value)} required>
                <option value="">{offered.length ? 'Choose a package' : 'No packages yet — use Custom package'}</option>
                {offered.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.sessions} sessions — {inr(p.price)}
                    {p.saving_pct > 0 ? ` (save ${p.saving_pct}%)` : ''}
                  </option>
                ))}
              </select>
            </Field>
            {pkg && (
              <div className="test-options">
                {pkg.therapies.map((t) => (
                  <span key={t.service_id} className="chip">
                    {t.name}
                  </span>
                ))}
                {pkg.validity_days ? <span className="muted small">Valid {pkg.validity_days} days from start</span> : null}
              </div>
            )}
          </>
        )}

        {mode === 'custom' && (
          <>
            <Field label={`${F.items} in every session *`} group>
              <TherapyPicker therapies={therapies} value={ids} onChange={setIds} />
            </Field>
            <div className="grid-3">
              <Field label="Package name" hint={`Leave blank to name it after the ${F.items.toLowerCase()}`}>
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={AES ? 'e.g. Laser Hair Removal — 6 sessions' : 'e.g. Knee Rehab — 12 sessions'} />
              </Field>
              <Field label="Valid for (days)">
                <input type="number" min={1} max={730} value={validity} onChange={(e) => setValidity(e.target.value)} />
              </Field>
              <label className="check align-end">
                <input type="checkbox" checked={saveAsPackage} onChange={(e) => setSaveAsPackage(e.target.checked)} /> Save to package list for future bookings
              </label>
            </div>
          </>
        )}

        {mode === 'per_session' && (
          <div className="grid-2">
            <Field label={F.item}>
              <input className="therapy-search" value={serviceQuery} onChange={(e) => setServiceQuery(e.target.value)} placeholder={`Search ${F.items.toLowerCase()}`} aria-label={`Search ${F.items.toLowerCase()}`} />
              <select
                value={serviceId}
                onChange={(e) => {
                  setServiceId(Number(e.target.value));
                  setFee(String(therapies.find((s) => s.id === Number(e.target.value))?.price ?? 0));
                }}
              >
                {therapies
                  .filter((s) => !serviceQuery.trim() || s.name.toLowerCase().includes(serviceQuery.trim().toLowerCase()) || s.id === Number(serviceId))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {inr(s.price)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Fee per visit (₹)">
              <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid-2">
          <Field label="Sessions *">
            <input type="number" min={1} max={100} value={sessions} onChange={(e) => setSessions(e.target.value)} required readOnly={mode === 'package' && Boolean(pkg)} />
          </Field>
          <Field label="Session time">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
        </div>

        <Field label="Session dates *" hint="Set a date for every session. Each visit is booked on the date you choose." group>
          {sessionDates.length === 0 ? (
            <p className="muted small">Enter the number of sessions to set their dates.</p>
          ) : (
            <div className="session-dates">
              {sessionDates.map((date, i) => (
                <label key={i} className="session-date-row">
                  <span>Session {i + 1}</span>
                  <input
                    type="date"
                    value={date}
                    min={todayIst()}
                    required
                    aria-label={`Session ${i + 1} date`}
                    onChange={(e) => setSessionDates((prev) => prev.map((d, idx) => (idx === i ? e.target.value : d)))}
                  />
                </label>
              ))}
            </div>
          )}
        </Field>

        <div className="grid-2">
          <Field label={AES ? 'Concern / area' : 'Condition / diagnosis'}>
            <input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder={AES ? 'e.g. Acne scars, full face' : 'e.g. Frozen shoulder'} />
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

        {billedAsPackage && canBill && (
          <div className="pay-box">
            <strong className="small">Package invoice (created with this booking)</strong>
            <div className="grid-4">
              <Field label="Package price (₹) *" hint={mode === 'custom' ? (customValue ? `List value ${inr(customValue)}` : undefined) : pkg ? `List value ${inr(pkg.list_value)}` : undefined}>
                <input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceTouched(true);
                  }}
                  required
                />
              </Field>
              <Field label={discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'} group>
                <DiscountInput
                  value={discount}
                  type={discountType}
                  subtotal={packagePrice}
                  onChange={(v, t) => {
                    setDiscount(v);
                    setDiscountType(t);
                  }}
                />
              </Field>
              <Field label="Amount received (₹)">
                <input type="number" min={0} max={net} value={paid} onChange={(e) => setPaid(e.target.value)} />
              </Field>
              <Field label="Payment mode">
                <select value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  {(meta?.enums.payModes || ['Cash', 'UPI']).map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={includeGst} onChange={(e) => setIncludeGst(e.target.checked)} /> Include GST
            </label>
            <p className="muted small">
              {includeGst
                ? `5% GST stays inside the same price: taxable ${inr(net - gstAmount, true)}, GST ${inr(gstAmount, true)}, total ${inr(net, true)}.`
                : 'Tick to show 5% GST inside the same price. The bill total does not increase.'}
            </p>
          </div>
        )}

        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="muted small">{summary}</p>
      </form>
    </Modal>
  );
}
