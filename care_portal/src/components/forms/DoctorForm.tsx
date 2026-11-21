import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useCare } from '../../store';
import type { Availability, Practitioner, Slot } from '../../types';
import { fmtDate, todayIst } from '../../format';
import { Field, Modal } from '../ui';
import { AES, AES_SPECIALITIES } from '../../flavor';

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function parseAvailability(raw: Practitioner['availability']): Availability {
  let v: Partial<Availability> | null = null;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  } else if (raw) v = raw;
  return { weekly: v?.weekly || {}, extra: v?.extra || [], leave: v?.leave || [] };
}

/* "Mon–Sat 10:00–14:00 · Sun 17:00–19:00" style summary of the weekly schedule. */
export function weeklySummary(av: Availability) {
  const groups: { days: number[]; slot: string }[] = [];
  for (const d of ORDER) {
    const s = av.weekly[d];
    if (!s) continue;
    const slot = `${s.from}–${s.to}`;
    const last = groups[groups.length - 1];
    const prevDay = last ? last.days[last.days.length - 1] : -9;
    if (last && last.slot === slot && ORDER.indexOf(d) === ORDER.indexOf(prevDay) + 1) last.days.push(d);
    else groups.push({ days: [d], slot });
  }
  if (!groups.length) return '';
  return groups
    .map((g) => `${g.days.length > 2 ? `${DAY_SHORT[g.days[0]]}–${DAY_SHORT[g.days[g.days.length - 1]]}` : g.days.map((d) => DAY_SHORT[d]).join(', ')} ${g.slot}`)
    .join(' · ');
}

const CARE_SPECIALITIES = [
  'General Physician',
  'Orthopaedics',
  'Pain Medicine',
  'Physical Medicine & Rehabilitation',
  'Neurology',
  'Rheumatology',
  'Sports Medicine',
  'Cardiology',
  'Diabetology',
  'Gynaecology',
  'Paediatrics',
  'Dermatology',
  'ENT',
  'Radiology',
];

export function DoctorForm({ doctor, onClose }: { doctor?: Practitioner; onClose: () => void }) {
  const { meta, branch, mutate, can } = useCare();
  const av0 = parseAvailability(doctor?.availability);
  const [f, setF] = useState({
    name: doctor?.name || (AES ? '' : 'Dr. '),
    role: doctor?.role === 'Cosmetologist' ? 'Cosmetologist' : 'Doctor',
    specialty: doctor?.specialty || '',
    qualification: doctor?.qualification || '',
    registration_no: doctor?.registration_no || '',
    phone: doctor?.phone || '',
    email: doctor?.email || '',
    fee: doctor ? String(doctor.fee ?? '') : '',
    slot_minutes: doctor?.slot_minutes ? String(doctor.slot_minutes) : '15',
    branch_id: String(doctor?.branch_id || branch || meta?.branches.find((b) => b.active)?.id || ''),
    active: doctor ? Boolean(doctor.active) : true,
  });
  const [weekly, setWeekly] = useState<Record<string, Slot>>(av0.weekly);
  const [extra, setExtra] = useState(av0.extra);
  const [leave, setLeave] = useState(av0.leave);
  const [newExtra, setNewExtra] = useState({ date: '', from: '17:00', to: '19:00' });
  const [newLeave, setNewLeave] = useState('');
  const [busy, setBusy] = useState(false);
  const branches = (meta?.branches || []).filter((b) => b.active);
  const today = todayIst();
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const toggleDay = (d: number) =>
    setWeekly((w) => {
      const next = { ...w };
      if (next[d]) delete next[d];
      else next[d] = Object.values(w)[0] || { from: '10:00', to: '14:00' };
      return next;
    });
  const setSlot = (d: number, key: keyof Slot, value: string) => setWeekly((w) => ({ ...w, [d]: { ...w[d], [key]: value } }));
  const copyToAll = (d: number) => setWeekly((w) => Object.fromEntries(Object.keys(w).map((k) => [k, { ...w[d] }])));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { ...f, availability: { weekly, extra, leave } };
    const r = await mutate(
      () => api(doctor ? `/doctors/${doctor.id}` : '/doctors', { method: doctor ? 'PATCH' : 'POST', body }),
      doctor ? `${f.name} updated` : `${f.name} added`,
    );
    setBusy(false);
    if (r) onClose();
  };

  const person = f.role === 'Cosmetologist' ? 'cosmetologist' : 'doctor';
  const specialities = AES ? AES_SPECIALITIES : CARE_SPECIALITIES;

  return (
    <Modal
      title={doctor ? `Edit ${doctor.name}` : AES ? 'Add doctor or cosmetologist' : 'Add Doctor'}
      subtitle={
        AES
          ? 'Profile, fee and availability used for aesthetic sessions and billing'
          : 'Profile, consultation fee and availability used for booking and billing'
      }
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="doctor-form" className="btn btn-primary" disabled={busy || !can('Doctors', doctor ? 'edit' : 'create')}>
            {busy ? 'Saving…' : AES ? 'Save' : 'Save doctor'}
          </button>
        </>
      }
    >
      <form id="doctor-form" onSubmit={submit} className="doctor-form">
        <div className="grid-3">
          <Field label={AES ? 'Name *' : 'Doctor name *'}>
            <input value={f.name} onChange={set('name')} required autoFocus placeholder={AES ? 'e.g. Dr. Priya Sen' : undefined} />
          </Field>
          {AES ? (
            <Field label="Role *">
              <select value={f.role} onChange={set('role')} required>
                <option value="Doctor">Doctor</option>
                <option value="Cosmetologist">Cosmetologist</option>
              </select>
            </Field>
          ) : null}
          <Field label="Specialist in *">
            <input
              value={f.specialty}
              onChange={set('specialty')}
              required
              list="doctor-specialities"
              placeholder={AES ? 'e.g. Dermatology' : 'e.g. Orthopaedics'}
            />
            <datalist id="doctor-specialities">
              {specialities.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label={AES ? 'Fee (₹) *' : 'Consultation fee (₹) *'}>
            <input type="number" min={0} value={f.fee} onChange={set('fee')} required />
          </Field>
          <Field label="Qualification">
            <input value={f.qualification} onChange={set('qualification')} placeholder="MBBS, MS (Ortho)" />
          </Field>
          <Field label="Registration no.">
            <input value={f.registration_no} onChange={set('registration_no')} placeholder="WBMC 12345" />
          </Field>
          <Field label="Minutes per patient">
            <input type="number" min={5} max={240} value={f.slot_minutes} onChange={set('slot_minutes')} />
          </Field>
          <Field label="Phone">
            <input value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <input type="email" value={f.email} onChange={set('email')} />
          </Field>
          {branches.length > 1 ? (
            <Field label="Branch">
              <select value={f.branch_id} onChange={set('branch_id')}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <span />
          )}
        </div>

        <h3 className="form-title">Weekly availability</h3>
        <div className="week-grid">
          {ORDER.map((d) => {
            const s = weekly[d];
            return (
              <div key={d} className={`week-row ${s ? 'on' : ''}`}>
                <label className="check">
                  <input type="checkbox" checked={Boolean(s)} onChange={() => toggleDay(d)} /> {DAY_SHORT[d]}
                </label>
                {s ? (
                  <>
                    <input type="time" value={s.from} onChange={(e) => setSlot(d, 'from', e.target.value)} aria-label={`${DAY_SHORT[d]} from`} />
                    <span className="muted">to</span>
                    <input type="time" value={s.to} onChange={(e) => setSlot(d, 'to', e.target.value)} aria-label={`${DAY_SHORT[d]} to`} />
                    <button type="button" className="link small" onClick={() => copyToAll(d)}>
                      Same for all days
                    </button>
                  </>
                ) : (
                  <span className="muted small">Not available</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid-2 date-lists">
          <div>
            <h3 className="form-title">Extra available dates</h3>
            <div className="inline-add">
              <input type="date" min={today} value={newExtra.date} onChange={(e) => setNewExtra({ ...newExtra, date: e.target.value })} aria-label="Extra date" />
              <input type="time" value={newExtra.from} onChange={(e) => setNewExtra({ ...newExtra, from: e.target.value })} aria-label="From" />
              <input type="time" value={newExtra.to} onChange={(e) => setNewExtra({ ...newExtra, to: e.target.value })} aria-label="To" />
              <button
                type="button"
                className="btn btn-soft sm"
                disabled={!newExtra.date}
                onClick={() => {
                  setExtra((x) => [...x.filter((e) => e.date !== newExtra.date), { ...newExtra }].sort((a, b) => a.date.localeCompare(b.date)));
                  setNewExtra({ ...newExtra, date: '' });
                }}
              >
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
            <div className="date-chips">
              {extra.length === 0 && <span className="muted small">None</span>}
              {extra.map((e) => (
                <span key={e.date} className={`date-chip ${e.date < today ? 'past' : ''}`}>
                  {fmtDate(e.date)} · {e.from}–{e.to}
                  <button type="button" onClick={() => setExtra((x) => x.filter((y) => y.date !== e.date))} aria-label={`Remove ${e.date}`}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div>
            <h3 className="form-title">Leave / not available</h3>
            <div className="inline-add">
              <input type="date" min={today} value={newLeave} onChange={(e) => setNewLeave(e.target.value)} aria-label="Leave date" />
              <button
                type="button"
                className="btn btn-soft sm"
                disabled={!newLeave}
                onClick={() => {
                  setLeave((l) => [...new Set([...l, newLeave])].sort());
                  setNewLeave('');
                }}
              >
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
            <div className="date-chips">
              {leave.length === 0 && <span className="muted small">None</span>}
              {leave.map((d) => (
                <span key={d} className={`date-chip leave ${d < today ? 'past' : ''}`}>
                  {fmtDate(d)}
                  <button type="button" onClick={() => setLeave((l) => l.filter((x) => x !== d))} aria-label={`Remove ${d}`}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (available for booking and billing)
          {AES ? <span className="muted small"> — this {person}</span> : null}
        </label>
      </form>
    </Modal>
  );
}
