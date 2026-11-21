import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useCare } from '../../store';
import type { Patient } from '../../types';
import { Field, Modal, useDebounced } from '../ui';
import { Icon } from '../../icons';

type PatientDraft = { name: string; mobile: string; gender: string; age: string; email: string; address: string; condition: string; referred_by: string; branch_id: string };

const blank = (branch: number): PatientDraft => ({ name: '', mobile: '', gender: '', age: '', email: '', address: '', condition: '', referred_by: '', branch_id: branch ? String(branch) : '' });

export function PatientFields({ value, onChange, compact }: { value: PatientDraft; onChange: (v: PatientDraft) => void; compact?: boolean }) {
  const set = (key: keyof PatientDraft) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid-2">
      <Field label="Full name *">
        <input value={value.name} onChange={set('name')} required autoFocus />
      </Field>
      <Field label="Mobile">
        <input value={value.mobile} onChange={set('mobile')} inputMode="tel" placeholder="10-digit mobile" />
      </Field>
      <Field label="Gender">
        <select value={value.gender} onChange={set('gender')}>
          <option value="">—</option>
          <option>Male</option>
          <option>Female</option>
          <option>Other</option>
        </select>
      </Field>
      <Field label="Age">
        <input value={value.age} onChange={set('age')} type="number" min={0} max={120} />
      </Field>
      {!compact && (
        <>
          <Field label="Email">
            <input value={value.email} onChange={set('email')} type="email" />
          </Field>
          <Field label="Referred by">
            <input value={value.referred_by} onChange={set('referred_by')} />
          </Field>
        </>
      )}
      <Field label="Full address" span={2}>
        <textarea
          rows={2}
          value={value.address}
          onChange={set('address')}
          placeholder="House / flat, street, locality, city, PIN code"
        />
      </Field>
    </div>
  );
}

export function PatientForm({ patient, then, onClose }: { patient?: Patient; then?: (p: Patient) => void; onClose: () => void }) {
  const { branch, mutate, meta } = useCare();
  const [draft, setDraft] = useState<PatientDraft>(() =>
    patient
      ? {
          name: patient.name,
          mobile: patient.mobile || '',
          gender: patient.gender || '',
          age: patient.age == null ? '' : String(patient.age),
          email: patient.email || '',
          address: patient.address || '',
          condition: patient.condition || '',
          referred_by: patient.referred_by || '',
          branch_id: patient.branch_id ? String(patient.branch_id) : '',
        }
      : blank(branch),
  );
  const [busy, setBusy] = useState(false);
  const branches = (meta?.branches || []).filter((b) => b.active);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const saved = await mutate(
      () => api<Patient>(patient ? `/patients/${patient.id}` : '/patients', { method: patient ? 'PATCH' : 'POST', body: draft }),
      (p) => (patient ? 'Patient details saved' : `${p.name} registered as ${p.code}`),
    );
    setBusy(false);
    if (saved) {
      onClose();
      then?.(saved);
    }
  };

  return (
    <Modal
      title={patient ? `Edit ${patient.name}` : 'New Patient'}
      subtitle={patient ? patient.code : 'Register a patient for consultation, physiotherapy, lab or pharmacy'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="patient-form" className="btn btn-primary" disabled={busy}>
            {patient ? 'Save changes' : 'Register patient'}
          </button>
        </>
      }
    >
      <form id="patient-form" onSubmit={submit}>
        <PatientFields value={draft} onChange={setDraft} />
        {branches.length > 1 && (
          <Field label="Branch">
            <select value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}

export type PatientChoice = { id: number; name: string; code: string; mobile: string | null } | null;

/* Search an existing patient or switch to registering a new one in place. */
export function PatientPicker({
  value,
  onChange,
  newDraft,
  onNewDraft,
  allowNew = true,
}: {
  value: PatientChoice;
  onChange: (p: PatientChoice) => void;
  newDraft: PatientDraft | null;
  onNewDraft: (d: PatientDraft | null) => void;
  allowNew?: boolean;
}) {
  const { branch, can } = useCare();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Patient[]>([]);
  const [open, setOpen] = useState(false);
  const term = useDebounced(q.trim(), 250);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<{ items: Patient[] }>(`/patients?limit=8${term ? `&q=${encodeURIComponent(term)}` : ''}`)
      .then((r) => alive && setList(r.items))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [term, open]);

  if (newDraft) {
    return (
      <div className="picker-new">
        <div className="picker-new-head">
          <strong>New patient</strong>
          <button type="button" className="link" onClick={() => onNewDraft(null)}>
            Search existing instead
          </button>
        </div>
        <PatientFields value={newDraft} onChange={onNewDraft} compact />
      </div>
    );
  }

  if (value) {
    return (
      <div className="picker-chosen">
        <span className="avatar sm">{value.name.slice(0, 1)}</span>
        <span>
          <strong>{value.name}</strong>
          <small>
            {value.code}
            {value.mobile ? ` · ${value.mobile}` : ''}
          </small>
        </span>
        <button type="button" className="link" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="picker">
      <div className="searchbox">
        <Icon name="search" size={16} />
        <input
          value={q}
          placeholder="Search patient by name, mobile or ID"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {open && (
        <div className="picker-list">
          {list.map((p) => (
            <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange({ id: p.id, name: p.name, code: p.code, mobile: p.mobile })}>
              <strong>{p.name}</strong>
              <small>
                {p.code}
                {p.mobile ? ` · ${p.mobile}` : ''}
                {p.age ? ` · ${p.age} yrs` : ''}
              </small>
            </button>
          ))}
          {list.length === 0 && <p className="muted small pad">No matching patients.</p>}
        </div>
      )}
      {allowNew && can('Patients', 'create') && (
        <button type="button" className="link picker-add" onClick={() => onNewDraft({ ...blank(branch), name: /\d/.test(q) ? '' : q, mobile: /\d/.test(q) ? q : '' })}>
          <Icon name="userPlus" size={15} /> Register new patient
        </button>
      )}
    </div>
  );
}

export async function resolvePatient(choice: PatientChoice, draft: PatientDraft | null): Promise<number> {
  if (draft) {
    const p = await api<Patient>('/patients', { method: 'POST', body: draft });
    return p.id;
  }
  if (!choice) throw new Error('Choose a patient');
  return choice.id;
}

export async function loadPatientChoice(id: number): Promise<PatientChoice> {
  const r = await api<{ patient: Patient }>(`/patients/${id}`);
  return { id: r.patient.id, name: r.patient.name, code: r.patient.code, mobile: r.patient.mobile };
}

export type { PatientDraft };
