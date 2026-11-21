import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useServiceSearch } from './ServiceSearch';
import { moduleForType } from '../pages/Appointments';
import { billPlanAsPackage } from './planBilling';
import { LOGO_URL } from '../../invoicePrint';
import { AES, F, roleLabel } from '../../flavor';
import { useCare } from '../../store';
import type { Appointment, ApptType, LabTest, Plan } from '../../types';
import { apptLabel, fmtDate, fmtTime, inr, nowTimeIst, todayIst, TYPE_LABEL } from '../../format';
import { DiscountInput, discountAmount, Field, Modal, Pill, type DiscountType } from '../ui';
import { Icon } from '../../icons';
import { loadPatientChoice, PatientPicker, resolvePatient, type PatientChoice, type PatientDraft } from './PatientForm';
import { planReferral, ReferralInput, referralBody, referralFrom, referralLabel, referralReady } from './ReferralInput';
import { extractCrmTag, stripCrmMeta } from '../../crmTag';

export function nextSlot() {
  const [h, m] = nowTimeIst().split(':').map(Number);
  const mins = Math.min(h * 60 + m + 15, 20 * 60);
  const rounded = Math.ceil(mins / 15) * 15;
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

export function PaymentFields({
  collect,
  setCollect,
  amount,
  discount,
  discountType,
  setDiscount,
  paid,
  setPaid,
  mode,
  setMode,
}: {
  collect: boolean;
  setCollect: (v: boolean) => void;
  amount: number;
  discount: string;
  discountType: DiscountType;
  setDiscount: (value: string, type: DiscountType) => void;
  paid: string;
  setPaid: (v: string) => void;
  mode: string;
  setMode: (v: string) => void;
}) {
  const { meta, can } = useCare();
  if (!can('Billing & Invoice', 'create')) return null;
  const net = Math.max(Math.round((amount - discountAmount(amount, discount, discountType)) * 100) / 100, 0);
  return (
    <div className="pay-box">
      <label className="check">
        <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} /> Generate invoice now ({inr(net, true)}
        {net !== amount ? ` after discount, bill ${inr(amount)}` : ''})
      </label>
      {collect && (
        <div className="grid-3">
          <Field label={discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'} group>
            <DiscountInput value={discount} type={discountType} subtotal={amount} onChange={setDiscount} />
          </Field>
          <Field label="Amount received">
            <input type="number" min={0} max={net} value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
          <Field label="Payment mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {(meta?.enums.payModes || ['Cash', 'UPI']).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

function TestChooser({ category, tests, onChange }: { category: 'lab' | 'diagnostic'; tests: LabTest[]; onChange: (t: LabTest[]) => void }) {
  const [q, setQ] = useState('');
  const { items, total, loading, term } = useServiceSearch(category, q);

  const has = (name: string) => tests.some((t) => t.name === name);
  const toggle = (t: LabTest) => onChange(has(t.name) ? tests.filter((x) => x.name !== t.name) : [...tests, t]);

  return (
    <div className="test-chooser">
      <div className="searchbox">
        <Icon name="search" size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={category === 'lab' ? 'Search the test catalogue, e.g. thyroid, vitamin, CBC' : 'Search diagnostic tests, e.g. x-ray knee, USG, ECG, NCV'}
        />
      </div>
      <div className="test-options">
        {category === 'diagnostic' && !loading && total === 0 && !term && (
          <span className="muted small">No diagnostic tests in the master yet. Add them in Diagnostics → Diagnostic Test Master.</span>
        )}
        {items.map((s) => (
          <button
            type="button"
            key={s.id}
            className={`chip ${s.source === 'erp' ? 'chip-lab' : ''} ${has(s.name) ? 'on' : ''}`}
            title={[s.modality, s.sample_type && `Sample: ${s.sample_type}`, s.preparation && `Prep: ${s.preparation}`].filter(Boolean).join(' · ')}
            onClick={() => toggle({ code: s.code, name: s.name, price: s.price })}
          >
            {has(s.name) && <Icon name="check" size={13} />} {s.name} <b>{inr(s.price)}</b>
          </button>
        ))}
        {!loading && items.length === 0 && term && <span className="muted small">No tests match “{term}”.</span>}
        {total > items.length && <span className="muted small">Showing {items.length} of {total} — type to narrow down.</span>}
      </div>
      {tests.length > 0 && (
        <ul className="test-picked">
          {tests.map((t) => (
            <li key={t.name}>
              <span>{t.name}</span>
              <input
                type="number"
                min={0}
                value={t.price}
                aria-label={`Price for ${t.name}`}
                onChange={(e) => onChange(tests.map((x) => (x.name === t.name ? { ...x, price: Number(e.target.value) } : x)))}
              />
              <button type="button" className="icon-btn sm" onClick={() => toggle(t)} aria-label={`Remove ${t.name}`}>
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AppointmentForm({ type, patientId, planId, onClose, page }: { type: ApptType; patientId?: number; planId?: number; onClose: () => void; page?: boolean }) {
  const { meta, branch, mutate } = useCare();
  const [patient, setPatient] = useState<PatientChoice>(null);
  const [draft, setDraft] = useState<PatientDraft | null>(null);
  const services = (meta?.services || []).filter((s) => s.category === type && s.active);
  const testBooking = type === 'lab' || type === 'diagnostic';
  const staff = staffFor(type, meta?.practitioners || []);
  const staffLabel = type === 'consultation' ? (AES ? 'Doctor / Cosmetologist *' : 'Doctor *') : roleLabel(STAFF_ROLE[type][0]);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? 0);
  const [serviceQuery, setServiceQuery] = useState('');
  const [fee, setFee] = useState(String(services[0]?.price ?? 0));
  const [practitioner, setPractitioner] = useState('');
  const [date, setDate] = useState(todayIst());
  const [time, setTime] = useState(nextSlot());
  const [notes, setNotes] = useState('');
  const [tests, setTests] = useState<LabTest[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState(planId ? String(planId) : '');
  const [collect, setCollect] = useState(testBooking);
  const [paid, setPaid] = useState('');
  const [mode, setMode] = useState('UPI');
  const [discount, setDiscount] = useState('0');
  const [discountType, setDiscountType] = useState<DiscountType>('flat');
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<{ ok: boolean; reason?: string; from?: string; to?: string } | null>(null);
  const [override, setOverride] = useState(false);

  useEffect(() => {
    if (patientId) loadPatientChoice(patientId).then(setPatient).catch(() => undefined);
  }, [patientId]);

  useEffect(() => {
    setOverride(false);
    if (type !== 'consultation' || !practitioner || !date) {
      setAvailability(null);
      return;
    }
    let alive = true;
    api<{ ok: boolean; reason?: string; from?: string; to?: string }>(`/doctors/check?id=${practitioner}&date=${date}&time=${time}`)
      .then((r) => alive && setAvailability(r))
      .catch(() => alive && setAvailability(null));
    return () => {
      alive = false;
    };
  }, [type, practitioner, date, time]);

  const pickPractitioner = (id: string) => {
    setPractitioner(id);
    const doc = staff.find((p) => String(p.id) === id);
    if (type === 'consultation' && doc && doc.fee > 0) setFee(String(doc.fee));
  };

  useEffect(() => {
    if (type !== 'physiotherapy' || !patient) {
      setPlans([]);
      return;
    }
    api<{ plans: Plan[] }>(`/patients/${patient.id}`)
      .then((r) => setPlans(r.plans.filter((p) => p.status === 'Active' && p.booked < p.total_sessions)))
      .catch(() => setPlans([]));
  }, [type, patient]);

  const amount = testBooking ? tests.reduce((s, t) => s + (Number(t.price) || 0), 0) : Number(fee) || 0;
  const net = Math.max(Math.round((amount - discountAmount(amount, discount, discountType)) * 100) / 100, 0);
  useEffect(() => setPaid(String(net)), [net]);

  const chosenPlan = plans.find((p) => String(p.id) === plan);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const service = services.find((s) => s.id === Number(serviceId));
    const result = await mutate(
      async () => {
        const pid = await resolvePatient(patient, draft);
        return api<Appointment>('/appointments', {
          method: 'POST',
          body: {
            type,
            patient_id: pid,
            service: service?.name,
            fee: amount,
            practitioner_id: practitioner || chosenPlan?.practitioner_id || null,
            plan_id: chosenPlan?.id ?? null,
            date,
            time,
            notes,
            tests: testBooking ? tests : undefined,
            branch_id: branch || undefined,
            collect,
            override_availability: override,
            discount: Number(discount) || 0,
            discount_type: discountType,
            paid: Number(paid) || 0,
            mode,
          },
        });
      },
      (a) => `${TYPE_LABEL[type]} booked for ${a.patient} on ${fmtDate(a.date)} at ${fmtTime(a.time)}`,
    );
    setBusy(false);
    if (result) onClose();
  };

  const title = page && type === 'physiotherapy' ? 'New Booking' : { consultation: 'Book Consultation', physiotherapy: `Book ${F.service} Session`, lab: 'Book Lab Test', diagnostic: 'Book Diagnostic Test' }[type];
  const shownServices = services.filter((s) => !serviceQuery.trim() || s.name.toLowerCase().includes(serviceQuery.trim().toLowerCase()) || s.id === Number(serviceId));

  const form = (
      <form id="appt-form" onSubmit={submit} className="stack">
        <Field label="Patient *" group>
          <PatientPicker value={patient} onChange={setPatient} newDraft={draft} onNewDraft={setDraft} />
        </Field>
        {testBooking ? (
          <Field label="Tests *" group>
            <TestChooser category={type as 'lab' | 'diagnostic'} tests={tests} onChange={setTests} />
          </Field>
        ) : (
          <div className="grid-2">
            <Field label="Service *">
              <input className="therapy-search" value={serviceQuery} onChange={(e) => setServiceQuery(e.target.value)} placeholder="Search treatments" aria-label="Search treatments" />
              <select
                value={serviceId}
                onChange={(e) => {
                  setServiceId(Number(e.target.value));
                  setFee(String(services.find((s) => s.id === Number(e.target.value))?.price ?? 0));
                }}
              >
                {shownServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {inr(s.price)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fee (₹)">
              <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
          </div>
        )}
        {type === 'physiotherapy' && plans.length > 0 && (
          <Field label={F.Plan} hint="Link this session to the patient's active plan to track session numbers.">
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">Single session (no plan)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.condition || F.item} · session {p.booked + 1} of {p.total_sessions}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid-3">
          <Field label={type === 'lab' ? 'Collection date' : 'Date'}>
            <input type="date" value={date} min={todayIst()} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Time">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
          <Field label={staffLabel}>
            <select value={practitioner} onChange={(e) => pickPractitioner(e.target.value)} required={type === 'consultation'}>
              <option value="">
                {chosenPlan?.practitioner ? `Plan therapist (${chosenPlan.practitioner})` : type === 'consultation' ? 'Choose doctor' : 'Not assigned'}
              </option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {type === 'consultation' ? `${p.specialty ? ` — ${p.specialty}` : ''}${p.fee ? ` — ${inr(p.fee)}` : ''}` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {availability && (
          <div className={`avail-note ${availability.ok ? 'ok' : 'no'}`}>
            {availability.ok ? (
              availability.from ? (
                `Available on this date ${availability.from}–${availability.to}`
              ) : (
                'No schedule set for this doctor'
              )
            ) : (
              <>
                Doctor is {availability.reason} on this date/time.{' '}
                <label className="check inline">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Book anyway
                </label>
              </>
            )}
          </div>
        )}
        <Field label="Notes">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={type === 'lab' ? 'Fasting, home collection, etc.' : type === 'diagnostic' ? 'Clinical history / referring doctor' : 'Reason for visit'}
          />
        </Field>
        <PaymentFields
          collect={collect}
          setCollect={setCollect}
          amount={amount}
          discount={discount}
          discountType={discountType}
          setDiscount={(v, t) => {
            setDiscount(v);
            setDiscountType(t);
          }}
          paid={paid}
          setPaid={setPaid}
          mode={mode}
          setMode={setMode}
        />
      </form>
  );

  const actions = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        {page ? 'Clear' : 'Cancel'}
      </button>
      <button type="submit" form="appt-form" className="btn btn-primary" disabled={busy || (testBooking && !tests.length) || (availability !== null && !availability.ok && !override)}>
        {busy ? 'Booking…' : 'Confirm booking'}
      </button>
    </>
  );

  if (page) {
    return (
      <div className="page booking-page">
        <header className="page-head">
          <div>
            <h1>{title}</h1>
            <p>Choose the patient, treatment, date and therapist. The visit is saved with the treatment plan and shows on the booking calendar.</p>
          </div>
        </header>
        <div className="card booking-card">
          {form}
          <div className="booking-actions">{actions}</div>
        </div>
      </div>
    );
  }

  return (
    <Modal title={title} onClose={onClose} wide={testBooking} footer={actions}>
      {form}
    </Modal>
  );
}

const FLOW: Record<ApptType, { from: string[]; to: string; label: string }[]> = {
  consultation: [
    { from: ['Scheduled'], to: 'Checked In', label: 'Check in' },
    { from: ['Checked In', 'Waiting'], to: 'In Session', label: 'Start consultation' },
    { from: ['Checked In', 'In Session', 'Waiting'], to: 'Completed', label: 'Mark completed' },
  ],
  physiotherapy: [
    { from: ['Scheduled'], to: 'Checked In', label: 'Check in' },
    { from: ['Checked In', 'Waiting'], to: 'In Session', label: 'Start session' },
    { from: ['Checked In', 'In Session', 'Waiting'], to: 'Completed', label: 'Session completed' },
  ],
  lab: [
    { from: ['Scheduled'], to: 'Waiting', label: 'Patient arrived' },
    { from: ['Scheduled', 'Waiting'], to: 'Sample Collected', label: 'Sample collected' },
    { from: ['Sample Collected'], to: 'Reported', label: 'Report ready' },
  ],
  diagnostic: [
    { from: ['Scheduled'], to: 'Checked In', label: 'Check in' },
    { from: ['Checked In'], to: 'In Session', label: 'Start test' },
    { from: ['Checked In', 'In Session'], to: 'Report Pending', label: 'Test done — awaiting report' },
  ],
};

const STAFF_ROLE: Record<ApptType, string[]> = {
  consultation: AES ? ['Doctor', 'Cosmetologist'] : ['Doctor'],
  physiotherapy: AES ? ['Physiotherapist', 'Cosmetologist', 'Doctor'] : ['Physiotherapist'],
  lab: ['Lab Technician'],
  diagnostic: ['Diagnostic Technician'],
};

function staffFor<T extends { active: number | boolean; role: string }>(type: ApptType, practitioners: T[]) {
  const roles = STAFF_ROLE[type];
  return practitioners.filter((p) => p.active && roles.includes(p.role));
}

export function AppointmentEdit({ appointment, onClose }: { appointment: Appointment; onClose: () => void }) {
  const { can, mutate, openModal, meta } = useCare();
  const [a, setA] = useState(appointment);
  const [date, setDate] = useState(a.date);
  const [time, setTime] = useState(a.time);
  const [notes, setNotes] = useState(stripCrmMeta(a.notes) || '');
  const [result, setResult] = useState(a.result || '');
  const [practitioner, setPractitioner] = useState(a.practitioner_id ? String(a.practitioner_id) : '');
  const [reportedBy, setReportedBy] = useState(a.reported_by || '');
  const [allowUnpaid, setAllowUnpaid] = useState(false);
  const [fee, setFee] = useState(String(a.fee ?? ''));
  const [planSessions, setPlanSessions] = useState(String(a.total_sessions ?? ''));
  const priceEditable = a.status !== 'Cancelled' && (!a.invoice_id || a.plan_billing === 'package');
  const [referral, setReferral] = useState(() => referralFrom(planReferral(a)));
  const [editRef, setEditRef] = useState(false);
  const crmTag = extractCrmTag(a.notes, a.patient_referred_by);

  const savePlan = async (body: Record<string, unknown>, text: string) => {
    if (!a.plan_id) return;
    const next = await mutate(() => api(`/plans/${a.plan_id}`, { method: 'PATCH', body }), text);
    if (next) {
      const fresh = await api<{ items: Appointment[] }>(`/appointments?q=${encodeURIComponent(a.code)}&limit=1`).catch(() => null);
      if (fresh?.items[0]) {
        setA(fresh.items[0]);
        setReferral(referralFrom(planReferral(fresh.items[0])));
      }
      setEditRef(false);
    }
  };
  const savePlanSessions = () =>
    Number(planSessions) !== a.total_sessions &&
    savePlan({ total_sessions: Number(planSessions) }, `${a.plan_code}: now ${planSessions} sessions${a.plan_billing === 'package' ? ' (package total updated)' : ''}`);
  const editable = can(moduleForType(a.type), 'edit') && a.type !== 'lab';
  const closed = ['Completed', 'Reported', 'Cancelled', 'No Show'].includes(a.status);
  const staff = staffFor(a.type, meta?.practitioners || []);
  const staffLabel = roleLabel(STAFF_ROLE[a.type][0]);
  const reporters = (meta?.practitioners || []).filter((p) => p.active && ['Radiologist', 'Doctor'].includes(p.role));
  const hasReport = a.type === 'lab' || a.type === 'diagnostic';
  const tests: LabTest[] = useMemo(() => {
    try {
      return a.tests ? JSON.parse(a.tests) : [];
    } catch {
      return [];
    }
  }, [a.tests]);

  useEffect(() => {
    api<{ items: Appointment[] }>(`/appointments?q=${encodeURIComponent(appointment.code)}&limit=1`)
      .then((r) => {
        if (!r.items[0]) return;
        setA(r.items[0]);
        setNotes(stripCrmMeta(r.items[0].notes) || '');
        setResult(r.items[0].result || '');
        setReportedBy(r.items[0].reported_by || '');
        setFee(String(r.items[0].fee ?? ''));
        setPlanSessions(String(r.items[0].total_sessions ?? ''));
        setReferral(referralFrom(planReferral(r.items[0])));
      })
      .catch(() => undefined);
  }, [appointment.code]);

  const patch = async (body: Record<string, unknown>, text: string) => {
    const next = await mutate(() => api<Appointment>(`/appointments/${a.id}`, { method: 'PATCH', body }), text);
    if (next) setA(next);
    return next;
  };

  const steps = FLOW[a.type].filter((s) => s.from.includes(a.status));

  return (
    <Modal title={`${a.patient}`} subtitle={`${a.code} · ${apptLabel(a)}`} onClose={onClose} wide>
      <div className="detail-grid">
        <div className="detail">
          <dl>
            <dt>Status</dt>
            <dd>
              <Pill status={a.status} />
            </dd>
            <dt>When</dt>
            <dd>
              {fmtDate(a.date)} · {fmtTime(a.time)}
            </dd>
            <dt>{staffLabel}</dt>
            <dd>{a.practitioner || 'Not assigned'}</dd>
            <dt>Fee</dt>
            <dd>{inr(a.fee)}</dd>
            {crmTag ? (
              <>
                <dt>CRM Tag</dt>
                <dd>
                  <code className="crm-tag">{crmTag}</code>
                </dd>
              </>
            ) : null}
            {a.patient_condition ? (
              <>
                <dt>{AES ? 'Concern' : 'Condition'}</dt>
                <dd>{stripCrmMeta(a.patient_condition) || a.patient_condition}</dd>
              </>
            ) : null}
            {a.plan_code && (
              <>
                <dt>{F.Plan}</dt>
                <dd>
                  {a.plan_code} · session {a.session_no} of {a.total_sessions}
                </dd>
                <dt>Referred by</dt>
                <dd>{referralLabel(planReferral(a))}</dd>
              </>
            )}
            <dt>Invoice</dt>
            <dd>
              {a.invoice_id ? (
                <button type="button" className="link" onClick={() => openModal({ kind: 'viewInvoice', id: a.invoice_id! })}>
                  {a.invoice_number} ({a.invoice_status})
                </button>
              ) : (
                'Not billed'
              )}
            </dd>
            {a.mobile && (
              <>
                <dt>Mobile</dt>
                <dd>
                  <a href={`tel:${a.mobile}`}>{a.mobile}</a>
                </dd>
              </>
            )}
          </dl>
          {tests.length > 0 && (
            <ul className="test-picked readonly">
              {tests.map((t) => (
                <li key={t.name}>
                  <span>{t.name}</span>
                  <b>{inr(t.price)}</b>
                </li>
              ))}
            </ul>
          )}
          <div className="action-row">
            {editable &&
              steps.map((s) => (
                <button
                  key={s.to}
                  type="button"
                  className="btn btn-primary"
                  onClick={() => patch({ status: s.to, ...(s.to === 'Completed' && allowUnpaid ? { allow_unpaid: true } : {}) }, `${a.patient}: ${s.to}`)}
                >
                  <Icon name="check" size={16} /> {s.label}
                </button>
              ))}
            {editable && a.type === 'physiotherapy' && steps.some((s) => s.to === 'Completed') && can('Billing & Invoice', 'approve') && (
              <label className="check small">
                <input type="checkbox" checked={allowUnpaid} onChange={(e) => setAllowUnpaid(e.target.checked)} /> Complete without payment (approved)
              </label>
            )}
            {editable && a.type === 'diagnostic' && ['Report Pending', 'In Session', 'Checked In'].includes(a.status) && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!result.trim()) {
                    window.alert('Write the report findings first (Report section on the right), then mark it reported.');
                    return;
                  }
                  patch({ status: 'Reported', result, reported_by: reportedBy }, `${a.patient}: report finalised`);
                }}
              >
                <Icon name="check" size={16} /> Finalise report
              </button>
            )}
            {hasReport && a.status === 'Reported' && a.result && (
              <button type="button" className="btn btn-soft" onClick={() => printReport(a, tests, meta?.settings || {})}>
                <Icon name="printer" size={16} /> Print report
              </button>
            )}
            {a.plan_id && a.plan_billing === 'per_session' && a.status !== 'Cancelled' && can('Billing & Invoice', 'create') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const r = await billPlanAsPackage(
                    { id: a.plan_id!, code: a.plan_code || 'this plan', fee: a.fee, total_sessions: a.total_sessions || 1 },
                    mutate,
                  );
                  if (r) openModal({ kind: 'viewInvoice', id: r.invoice_id });
                }}
              >
                <Icon name="invoice" size={16} /> Bill full plan as package ({inr(a.fee * (a.total_sessions || 1))})
              </button>
            )}
            {!a.invoice_id && a.status !== 'Cancelled' && a.type !== 'lab' && can('Billing & Invoice', 'create') && (
              <button type="button" className="btn btn-soft" onClick={() => openModal({ kind: 'invoice', type: a.type, patientId: a.patient_id, appointment: a })}>
                <Icon name="invoice" size={16} /> {a.plan_billing === 'per_session' ? 'Bill this session only' : 'Generate invoice'}
              </button>
            )}
            {editable && !closed && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => patch({ status: 'No Show' }, 'Marked as no show')}>
                  No show
                </button>
                <button type="button" className="btn btn-danger-ghost" onClick={() => window.confirm('Cancel this appointment?') && patch({ status: 'Cancelled' }, 'Appointment cancelled')}>
                  Cancel
                </button>
              </>
            )}
          </div>
          {a.plan_id && editable && (
            <div className="plan-edit-box">
              <strong className="small">
                Plan {a.plan_code} · {a.plan_billing === 'package' ? 'package' : 'pay per visit'}
              </strong>
              <div className="row">
                <label className="inline-field">
                  Total sessions
                  <input type="number" min={1} max={100} value={planSessions} onChange={(e) => setPlanSessions(e.target.value)} />
                </label>
                <button type="button" className="btn btn-soft sm" disabled={!planSessions || Number(planSessions) === a.total_sessions} onClick={savePlanSessions}>
                  Update sessions
                </button>
              </div>
              <span className="muted small">
                Adding continues the schedule after the last session; reducing removes the last upcoming sessions
                {a.plan_billing === 'package' ? ' and updates the package total.' : '.'}
              </span>
              {editRef ? (
                <>
                  <ReferralInput value={referral} onChange={setReferral} onNavigate={onClose} />
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-soft sm"
                      disabled={!referralReady(referral)}
                      onClick={() => savePlan(referralBody(referral), `${a.plan_code}: referral updated`)}
                    >
                      Save referral
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost sm"
                      onClick={() => {
                        setReferral(referralFrom(planReferral(a)));
                        setEditRef(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="row">
                  <span className="small">
                    Referred by: <b>{referralLabel(planReferral(a))}</b>
                  </span>
                  <button type="button" className="btn btn-ghost sm" onClick={() => setEditRef(true)}>
                    Change
                  </button>
                </div>
              )}
            </div>
          )}
          {a.plan_billing === 'package' && a.status !== 'Cancelled' && <SessionBillBox a={a} onIssued={(next) => setA(next)} />}
        </div>
        {editable && (
          <form
            className="stack side-form"
            onSubmit={(e) => {
              e.preventDefault();
              patch(
                {
                  date,
                  time,
                  notes: [crmTag ? `[CRM_TAG:${crmTag}]` : '', notes.trim()].filter(Boolean).join(' · ').slice(0, 500),
                  practitioner_id: practitioner || null,
                  ...(hasReport ? { result, reported_by: reportedBy } : {}),
                  ...(priceEditable && fee !== '' && Number(fee) !== a.fee ? { fee: Number(fee) } : {}),
                },
                'Appointment updated',
              );
            }}
          >
            <h3>{a.type === 'physiotherapy' ? 'Session details' : 'Reschedule & notes'}</h3>
            <div className="grid-2">
              <Field label="Date">
                <input type="date" value={date} min={a.date < todayIst() ? undefined : todayIst()} onChange={(e) => setDate(e.target.value)} disabled={closed} />
              </Field>
              <Field label="Time">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={closed} />
              </Field>
            </div>
            {a.type === 'physiotherapy' && (
              <Field
                label="Session price (₹)"
                hint={
                  !priceEditable
                    ? `Billed on ${a.invoice_number}; cancel that bill to change the price`
                    : a.plan_billing === 'package'
                      ? 'Changing it updates the package total and balance'
                      : 'Used when this session is billed'
                }
              >
                <input type="number" min={0} step="any" value={fee} onChange={(e) => setFee(e.target.value)} disabled={!priceEditable} />
              </Field>
            )}
            <Field label={staffLabel}>
              <select value={practitioner} onChange={(e) => setPractitioner(e.target.value)}>
                <option value="">Not assigned</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {a.type === 'lab' && (
              <Field label="Result / report summary">
                <textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} placeholder="Key findings or report reference" />
              </Field>
            )}
            {a.type === 'diagnostic' && (
              <>
                <h3>Report</h3>
                <Field label="Findings & impression">
                  <textarea
                    rows={7}
                    value={result}
                    onChange={(e) => setResult(e.target.value)}
                    placeholder={'FINDINGS:\n…\n\nIMPRESSION:\n…'}
                  />
                </Field>
                <Field label="Reported by">
                  <input value={reportedBy} onChange={(e) => setReportedBy(e.target.value)} list="care-reporters" placeholder="Radiologist / doctor name" />
                  <datalist id="care-reporters">
                    {reporters.map((p) => (
                      <option key={p.id} value={`${p.name}${p.specialty ? `, ${p.specialty}` : ''}`} />
                    ))}
                  </datalist>
                </Field>
              </>
            )}
            <button type="submit" className="btn btn-soft">
              Save changes
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

/* Package sessions: each session gets its own session invoice carrying the package's payment history. */
function SessionBillBox({ a, onIssued }: { a: Appointment; onIssued: (a: Appointment) => void }) {
  const { can, mutate, openModal, meta } = useCare();
  const pending = !['Completed', 'Cancelled', 'No Show'].includes(a.status);
  const [paid, setPaid] = useState(pending ? String(a.fee || '') : '');
  const [mode, setMode] = useState('UPI');
  const [busy, setBusy] = useState(false);
  const canIssue = can('Appointments', 'edit') || can('Billing & Invoice', 'edit');
  const canCollect = can('Billing & Invoice', 'edit');

  /* Records the payment on the package, then completes the session (which issues its session invoice). */
  const collectAndComplete = async () => {
    setBusy(true);
    const done = await mutate(async () => {
      if (Number(paid) > 0) {
        await api(`/appointments/${a.id}/session-bill`, { method: 'POST', body: { paid: Number(paid), mode } }).catch((err: Error) => {
          if (!/package plans/.test(err.message)) throw err;
        });
      }
      return api<Appointment>(`/appointments/${a.id}`, { method: 'PATCH', body: { status: 'Completed' } });
    }, `${a.patient}: payment recorded and session ${a.session_no} completed`);
    setBusy(false);
    if (done) {
      setPaid('');
      onIssued(done);
    }
  };

  const issue = async () => {
    setBusy(true);
    const r = await mutate(
      () => api<{ bill: { id: number; number: string } }>(`/appointments/${a.id}/session-bill`, { method: 'POST', body: { paid: Number(paid) || 0, mode } }),
      (x) => `Session invoice ${x.bill.number} ${a.session_bill_id ? 'updated' : 'issued'}`,
    );
    setBusy(false);
    if (r) {
      setPaid('');
      onIssued({ ...a, session_bill_id: r.bill.id, session_bill_number: r.bill.number });
      openModal({ kind: 'sessionBill', id: r.bill.id });
    }
  };

  return (
    <div className="session-bill-box">
      <strong className="small">Session invoice</strong>
      <div className="row">
        {a.session_bill_id ? (
          <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'sessionBill', id: a.session_bill_id! })}>
            <Icon name="invoice" size={14} /> {a.session_bill_number}
          </button>
        ) : (
          <span className="muted small">Issued automatically when the session is completed.</span>
        )}
        {a.invoice_id && (
          <button type="button" className="link small" onClick={() => openModal({ kind: 'viewInvoice', id: a.invoice_id! })}>
            Package invoice {a.invoice_number}
          </button>
        )}
      </div>
      {canIssue && (
        <div className="row">
          {canCollect && (
            <>
              <input type="number" min={0} placeholder="Collect ₹ now" value={paid} onChange={(e) => setPaid(e.target.value)} aria-label="Amount received now" />
              <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Payment mode">
                {(meta?.enums.payModes || ['Cash', 'UPI']).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </>
          )}
          {pending && canCollect && can('Appointments', 'edit') ? (
            <button type="button" className="btn btn-primary sm" disabled={busy} onClick={collectAndComplete}>
              Collect &amp; complete session
            </button>
          ) : (
            <button type="button" className="btn btn-primary sm" disabled={busy} onClick={issue}>
              {Number(paid) > 0 ? 'Collect & issue session invoice' : a.session_bill_id ? 'Refresh with latest payments' : 'Issue session invoice'}
            </button>
          )}
        </div>
      )}
      {pending && <span className="muted small">A session can be completed only after its payment is recorded.</span>}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/* Opens a clean, printable report page (clinic header, patient, tests, findings, signature line). */
function printReport(a: Appointment, tests: LabTest[], settings: Record<string, string>) {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return;
  const title = a.type === 'diagnostic' ? 'DIAGNOSTIC REPORT' : 'LABORATORY REPORT';
  const reported = a.reported_at ? `${fmtDate(a.reported_at)}, ${fmtTime(a.reported_at.slice(11, 16))}` : fmtDate(a.date);
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(a.code)} — ${escapeHtml(a.patient)}</title>
<style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#0f2a2c;margin:32px 40px;font-size:13px}
.head{display:flex;justify-content:space-between;border-bottom:2px solid #17a37a;padding-bottom:10px}
.head h1{margin:0;font-size:20px;color:#0b3a3b}.head p{margin:2px 0;color:#475569}.head img{display:block;height:64px;width:auto;margin-bottom:4px}
h2{letter-spacing:.12em;font-size:14px;color:#0f7f5e;text-align:center;margin:18px 0}
table{width:100%;border-collapse:collapse;margin-bottom:16px}td{padding:5px 8px;border:1px solid #e3ecee}td.k{width:22%;color:#64748b}
.tests{margin:6px 0 16px;font-weight:600}.body{white-space:pre-wrap;line-height:1.6;font-size:13.5px;min-height:200px}
.sign{margin-top:60px;text-align:right}.sign b{display:block;border-top:1px solid #94a3b8;padding-top:6px;margin-left:auto;width:260px}
.foot{margin-top:30px;font-size:11px;color:#64748b;text-align:center}
</style></head><body>
<div class="head"><div><img src="${escapeHtml(window.location.origin + LOGO_URL)}" alt="${escapeHtml(settings.clinic_name || 'Remedium Care')}"><p>${escapeHtml(settings.address || '')}</p></div>
<div style="text-align:right"><p>${escapeHtml(settings.phone || '')}</p><p>${escapeHtml(settings.support_email || '')}</p></div></div>
<h2>${title}</h2>
<table><tr><td class="k">Patient</td><td>${escapeHtml(a.patient)}</td><td class="k">Patient ID</td><td>${escapeHtml(a.patient_code || '')}</td></tr>
<tr><td class="k">Booking</td><td>${escapeHtml(a.code)}</td><td class="k">Test date</td><td>${escapeHtml(fmtDate(a.date))}</td></tr>
<tr><td class="k">Reported</td><td>${escapeHtml(reported)}</td><td class="k">Technician</td><td>${escapeHtml(a.practitioner || '—')}</td></tr></table>
<div class="tests">${tests.map((t) => escapeHtml(t.name)).join(' · ') || escapeHtml(a.service)}</div>
<div class="body">${escapeHtml(a.result || '')}</div>
<div class="sign"><b>${escapeHtml(a.reported_by || 'Reporting doctor')}</b></div>
<p class="foot">${escapeHtml(settings.invoice_footer || '')}</p>
<script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}
