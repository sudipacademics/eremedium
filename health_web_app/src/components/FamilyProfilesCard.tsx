import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AddDependantPayload, IamMe } from '../types/foundations';

const RELATIONS: AddDependantPayload['relation'][] = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

/** Universal Patient ID + family profiles managed by this login (Patient Account Link). */
export function FamilyProfilesCard() {
  const [me, setMe] = useState<IamMe | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<AddDependantPayload['relation']>('Child');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Female');
  const [dob, setDob] = useState('');
  const [consent, setConsent] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.iamMe();
      setMe(res.data);
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!consent) {
      setError('Please confirm you may manage this person’s health records.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.iamAddDependant({
        patient_name: name.trim(),
        relation,
        gender,
        ...(dob ? { dob } : {}),
        consent: 1,
      });
      setNotice(`${res.data.patient_name} added (${res.data.universal_patient_id || res.data.patient}).`);
      setName('');
      setDob('');
      setConsent(false);
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the profile');
    } finally {
      setBusy(false);
    }
  }

  if (unavailable || !me) return null;

  return (
    <section style={{ marginTop: 16 }}>
      <h3>Family profiles</h3>
      {me.universal_patient_id ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Your Universal Patient ID: <strong style={{ letterSpacing: '0.04em' }}>{me.universal_patient_id}</strong>
        </p>
      ) : null}
      {notice ? <p className="success">{notice}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
        {me.profiles.map((p) => (
          <li key={p.patient} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #e2e8f0' }}>
            <span>
              <strong>{p.patient_name}</strong> <span className="badge">{p.relation === 'Self' ? 'You' : p.relation}</span>
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              {p.universal_patient_id || p.patient}
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <form onSubmit={add}>
          {error ? <p className="error">{error}</p> : null}
          <label>
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={140} />
          </label>
          <label>
            Relation
            <select value={relation} onChange={(e) => setRelation(e.target.value as AddDependantPayload['relation'])}>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Gender
            <select value={gender} onChange={(e) => setGender(e.target.value as 'Male' | 'Female' | 'Other')}>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>
            Date of birth (optional)
            <input type="date" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 'auto' }} />
            <span>I am allowed to book tests and view health records for this person.</span>
          </label>
          <div className="toolbar">
            <button className="btn" type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Adding…' : 'Add profile'}
            </button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn secondary" type="button" onClick={() => setAdding(true)}>
          Add family member
        </button>
      )}
    </section>
  );
}
