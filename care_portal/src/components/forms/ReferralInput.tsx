import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useCare } from '../../store';
import type { Appointment, PlanReferral, RefType } from '../../types';

export type Referral = { ref_type: RefType; ref_doctor_id: string; referred_by: string; ref_contact: string };

export const SELF_REFERRAL: Referral = { ref_type: 'self', ref_doctor_id: '', referred_by: '', ref_contact: '' };

export function referralFrom(r: PlanReferral): Referral {
  const type = r.ref_type || 'self';
  return {
    ref_type: type,
    ref_doctor_id: type === 'doctor' && r.ref_doctor_id ? String(r.ref_doctor_id) : '',
    referred_by: type === 'outside' ? r.referred_by || '' : '',
    ref_contact: type === 'outside' ? r.ref_contact || '' : '',
  };
}

export const planReferral = (a: Appointment): PlanReferral => ({
  ref_type: a.plan_ref_type,
  ref_doctor_id: a.plan_ref_doctor_id,
  referred_by: a.plan_referred_by,
  ref_contact: a.plan_ref_contact,
});

export const referralReady = (r: Referral) =>
  r.ref_type === 'self' || (r.ref_type === 'doctor' ? Boolean(r.ref_doctor_id) : Boolean(r.referred_by.trim()));

export function referralBody(r: Referral) {
  if (r.ref_type === 'doctor') return { ref_type: r.ref_type, ref_doctor_id: Number(r.ref_doctor_id) };
  if (r.ref_type === 'outside') return { ref_type: r.ref_type, referred_by: r.referred_by.trim(), ref_contact: r.ref_contact.trim() };
  return { ref_type: 'self' as const };
}

export function referralLabel(r: PlanReferral) {
  if (!r.ref_type || r.ref_type === 'self') return 'Self';
  const name = [r.referred_by, r.ref_contact].filter(Boolean).join(', ');
  return r.ref_type === 'outside' ? `${name} (outside)` : name;
}

type OutsideDoctor = { name: string; contact: string | null; bookings: number };

export function ReferralInput({ value, onChange, onNavigate }: { value: Referral; onChange: (r: Referral) => void; onNavigate?: () => void }) {
  const { meta } = useCare();
  const listId = useId();
  const doctors = (meta?.practitioners || []).filter((p) => p.active && p.role === 'Doctor');
  const { data: outside } = useApi<OutsideDoctor[]>(value.ref_type === 'outside' ? '/plans/referrers' : null);
  const set = (patch: Partial<Referral>) => onChange({ ...value, ...patch });

  return (
    <div className="referral">
      <div className="seg" role="group" aria-label="Referred by">
        {(
          [
            ['self', 'Self'],
            ['doctor', 'Ref. by doctor'],
            ['outside', 'Outside doctor'],
          ] as [RefType, string][]
        ).map(([type, label]) => (
          <button key={type} type="button" className={value.ref_type === type ? 'on' : ''} onClick={() => set({ ref_type: type })}>
            {label}
          </button>
        ))}
      </div>

      {value.ref_type === 'doctor' &&
        (doctors.length ? (
          <select value={value.ref_doctor_id} onChange={(e) => set({ ref_doctor_id: e.target.value })} required aria-label="Referring doctor">
            <option value="">Choose from the doctor directory</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.specialty ? ` — ${d.specialty}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted small">
            No doctors in the directory yet. Add them in{' '}
            <Link to="/doctors" className="link" onClick={onNavigate}>
              Doctors
            </Link>{' '}
            or use <b>Outside doctor</b>.
          </p>
        ))}

      {value.ref_type === 'outside' && (
        <div className="grid-2">
          <input
            value={value.referred_by}
            list={listId}
            onChange={(e) => {
              const name = e.target.value;
              const known = (outside || []).find((d) => d.name === name);
              set({ referred_by: name, ...(known && !value.ref_contact ? { ref_contact: known.contact || '' } : {}) });
            }}
            placeholder="Doctor name, e.g. Dr. A. Sharma"
            aria-label="Outside doctor name"
            maxLength={120}
            required
          />
          <input
            value={value.ref_contact}
            onChange={(e) => set({ ref_contact: e.target.value })}
            placeholder="Hospital / clinic / phone (optional)"
            aria-label="Outside doctor hospital or contact"
            maxLength={160}
          />
          <datalist id={listId}>
            {(outside || []).map((d) => (
              <option key={d.name} value={d.name}>
                {d.contact || ''}
              </option>
            ))}
          </datalist>
        </div>
      )}
    </div>
  );
}
