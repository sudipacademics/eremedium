import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useCare } from '../../store';
import type { PhysioPackage, Service } from '../../types';
import { inr } from '../../format';
import { Field, Modal } from '../ui';
import { AES, F } from '../../flavor';

export function usePhysioTherapies(includeIds: number[] = []): Service[] {
  const { meta } = useCare();
  return (meta?.services || []).filter((s) => {
    if (s.category !== 'physiotherapy') return false;
    const kept = includeIds.includes(s.id);
    /* Booking/plan pickers: only Available treatments (active). Keep already-picked hidden ones editable. */
    if (!(Number(s.active) === 1 || kept)) return false;
    /* Aesthetic: skip ₹0 catalogue placeholders unless already selected on this form. */
    if (AES && !(Number(s.price) > 0 || kept)) return false;
    return true;
  });
}

/* Tick the therapies a package (or a custom package) includes in every session. */
export function TherapyPicker({ therapies, value, onChange }: { therapies: Service[]; value: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term ? therapies.filter((s) => s.name.toLowerCase().includes(term)) : therapies;
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  if (!therapies.length) return <p className="muted small">No {F.items.toLowerCase()} yet. Add them in {F.master}.</p>;
  return (
    <div className="test-chooser">
      <input className="therapy-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${F.items.toLowerCase()}`} aria-label={`Search ${F.items.toLowerCase()}`} />
      <p className="muted small">{value.length} selected{term ? ` · ${shown.length} match` : ''}</p>
      {shown.length === 0 ? (
        <p className="muted small">No {F.items.toLowerCase()} match “{q.trim()}”.</p>
      ) : (
        <div className="test-options">
          {shown.map((s) => (
            <button type="button" key={s.id} className={`chip ${value.includes(s.id) ? 'on' : ''}`} onClick={() => toggle(s.id)}>
              {value.includes(s.id) && <Icon name="check" size={13} />} {s.name} <b>{inr(s.price)}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function listValue(therapies: Service[], ids: number[], sessions: number) {
  return therapies.filter((s) => ids.includes(s.id)).reduce((sum, s) => sum + s.price, 0) * (sessions || 0);
}

export function PackageForm({ pkg, onClose }: { pkg?: PhysioPackage; onClose: () => void }) {
  const { mutate } = useCare();
  const [name, setName] = useState(pkg?.name || '');
  const [sessions, setSessions] = useState(String(pkg?.sessions ?? 10));
  const [ids, setIds] = useState<number[]>(pkg?.therapies.map((t) => t.service_id) || []);
  const [price, setPrice] = useState(pkg ? String(pkg.price) : '');
  const [validity, setValidity] = useState(pkg?.validity_days ? String(pkg.validity_days) : '45');
  const [description, setDescription] = useState(pkg?.description || '');
  const [active, setActive] = useState(pkg ? Boolean(pkg.active) : true);
  const [busy, setBusy] = useState(false);
  const therapies = usePhysioTherapies(ids);
  const value = listValue(therapies, ids, Number(sessions));
  const saving = value > 0 && Number(price) > 0 ? Math.round(((value - Number(price)) / value) * 100) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { name, sessions: Number(sessions), therapy_ids: ids, price: Number(price), validity_days: validity, description, active };
    const r = await mutate(
      () => api(pkg ? `/physio/packages/${pkg.id}` : '/physio/packages', { method: pkg ? 'PATCH' : 'POST', body }),
      pkg ? `${name} updated` : `${name} added to packages`,
    );
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Modal
      title={pkg ? `Edit ${pkg.name}` : `New ${F.service} Package`}
      subtitle={pkg?.code}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="foot-total">
            {value > 0 && (
              <>
                List value {inr(value)}
                {saving > 0 ? ` · patient saves ${saving}%` : ''}
              </>
            )}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="package-form" className="btn btn-primary" disabled={busy || !ids.length}>
            Save package
          </button>
        </>
      }
    >
      <form id="package-form" onSubmit={submit} className="stack">
        <div className="grid-3">
          <Field label="Package name *">
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. Back Pain Relief — 10 sessions" />
          </Field>
          <Field label="Number of sessions *">
            <input type="number" min={1} max={100} value={sessions} onChange={(e) => setSessions(e.target.value)} required />
          </Field>
          <Field label="Valid for (days)" hint="Sessions must be used within this period">
            <input type="number" min={1} max={730} value={validity} onChange={(e) => setValidity(e.target.value)} />
          </Field>
        </div>
        <Field label={`${F.items} included in every session *`} group>
          <TherapyPicker therapies={therapies} value={ids} onChange={setIds} />
        </Field>
        <div className="grid-3">
          <Field label="Package price (₹) *" hint={value ? `List value ${inr(value)}` : undefined}>
            <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
          <Field label="Per session">
            <input value={Number(sessions) > 0 && Number(price) > 0 ? inr(Number(price) / Number(sessions), true) : '—'} readOnly />
          </Field>
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it is for, what is included" />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Offered for booking
        </label>
      </form>
    </Modal>
  );
}
