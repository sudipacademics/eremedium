import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, api } from '../../api';
import { nextSlot } from '../forms/AppointmentForms';
import { fmtDate, fmtTime, todayIst } from '../../format';
import { useCare } from '../../store';
import type { Appointment, Patient } from '../../types';
import { Field } from '../ui';

const blank = () => ({
  name: '',
  age: '',
  mobile: '',
  address: '',
  referred_by: '',
  concern: '',
  date: todayIst(),
  time: nextSlot(),
});

function parentOrigin() {
  try {
    return new URL(document.referrer).origin;
  } catch {
    return 'https://aesthetics.e-remedium.in';
  }
}

/* Consultation intake. The booked-patient list is the All Bookings page; this form only collects the visit. */
export function NewBookingPage() {
  const popup = new URLSearchParams(useLocation().search).get('popup') === '1';
  const { mutate } = useCare();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/[^\d]/g, '');
    if (!/^\d{10}$/.test(mobile)) {
      await mutate(async () => {
        throw new ApiError(400, 'Contact number must be 10 digits');
      });
      return;
    }
    const body = {
      name: form.name.trim(),
      age: form.age,
      mobile,
      address: form.address.trim(),
      referred_by: form.referred_by.trim(),
      condition: form.concern.trim(),
    };
    setBusy(true);
    const saved = await mutate(async () => {
      let patient: Patient;
      try {
        patient = await api<Patient>('/patients', { method: 'POST', body });
      } catch (err) {
        if (!(err instanceof ApiError) || !/already registered/i.test(err.message)) throw err;
        const found = await api<{ items: Patient[] }>(`/patients?q=${encodeURIComponent(mobile)}&limit=8`);
        const match = found.items.find((p) => (p.mobile || '').replace(/[^\d]/g, '') === mobile && p.name.trim().toLowerCase() === body.name.toLowerCase());
        if (!match) throw err;
        patient = await api<Patient>(`/patients/${match.id}`, { method: 'PATCH', body });
      }
      return api<Appointment>('/appointments', {
        method: 'POST',
        body: {
          type: 'consultation',
          patient_id: patient.id,
          service: 'Consultation',
          fee: 0,
          date: form.date,
          time: form.time,
          notes: form.concern.trim(),
        },
      });
    }, (visit) => `Consultation booked for ${visit.patient} on ${fmtDate(visit.date)} at ${fmtTime(visit.time)}`);
    setBusy(false);
    if (!saved) return;
    setForm(blank());
    if (popup && window.parent !== window) window.parent.postMessage({ type: 'aes-booking-saved' }, parentOrigin());
  };

  return (
    <div className={`page booking-page${popup ? ' booking-popup' : ''}`}>
      {!popup && (
        <header className="page-head">
          <div>
            <h1>New Booking</h1>
            <p>Book a consultation. It is listed on All Bookings, where procedure taken or not follows the treatment plan.</p>
          </div>
        </header>
      )}
      <form className="card booking-card" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Patient name *">
            <input value={form.name} onChange={set('name')} required autoFocus placeholder="Full name" />
          </Field>
          <Field label="Age">
            <input value={form.age} onChange={set('age')} type="number" min={0} max={120} placeholder="Years" />
          </Field>
          <Field label="Contact no *">
            <input value={form.mobile} onChange={set('mobile')} inputMode="tel" required placeholder="10-digit mobile" />
          </Field>
          <Field label="Referred by">
            <input value={form.referred_by} onChange={set('referred_by')} placeholder="Doctor or person, if any" />
          </Field>
          <Field label="Address" span={2}>
            <textarea rows={2} value={form.address} onChange={set('address')} placeholder="House, street, locality, city" />
          </Field>
          <Field label="Concern about" span={2}>
            <textarea rows={2} value={form.concern} onChange={set('concern')} placeholder="What the patient wants to discuss" />
          </Field>
          <Field label="Consultation date *">
            <input type="date" value={form.date} onChange={set('date')} required />
          </Field>
          <Field label="Consultation time *">
            <input type="time" value={form.time} onChange={set('time')} required />
          </Field>
        </div>
        <div className="booking-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setForm(blank())}>
            Clear
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </form>
    </div>
  );
}
