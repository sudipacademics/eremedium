import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useCare } from '../../store';
import type { Service } from '../../types';
import { inr } from '../../format';
import { Field, Modal } from '../ui';

/* Same modality → department map as clinical_care_catalog.MODALITIES on the ERP. */
export const MODALITIES: Record<string, string> = {
  'X-Ray': 'Radiology & Imaging',
  'Ultrasound (USG)': 'Radiology & Imaging',
  Doppler: 'Radiology & Imaging',
  'CT Scan': 'Radiology & Imaging',
  MRI: 'Radiology & Imaging',
  Mammography: 'Radiology & Imaging',
  'DEXA / BMD': 'Radiology & Imaging',
  'OPG / Dental X-Ray': 'Radiology & Imaging',
  ECG: 'Cardiology',
  '2D Echo': 'Cardiology',
  TMT: 'Cardiology',
  Holter: 'Cardiology',
  ABPM: 'Cardiology',
  NCV: 'Neurology',
  EMG: 'Neurology',
  EEG: 'Neurology',
  'Evoked Potentials (VEP / BERA)': 'Neurology',
  'PFT / Spirometry': 'Pulmonology',
  Audiometry: 'Other Diagnostics',
  Other: 'Other Diagnostics',
};

type Draft = {
  code?: string;
  test_name: string;
  modality: string;
  body_part: string;
  rate: string;
  mrp: string;
  tat_hours: string;
  duration_min: string;
  needs_reporting_doctor: boolean;
  preparation: string;
  disabled: boolean;
};

export function DiagnosticTestForm({ test, onClose }: { test?: Service; onClose: () => void }) {
  const { mutate } = useCare();
  const [f, setF] = useState<Draft>({
    code: test?.code || undefined,
    test_name: test?.name || '',
    modality: test?.modality || 'X-Ray',
    body_part: test?.body_part || '',
    rate: test ? String(test.price) : '',
    mrp: test?.mrp ? String(test.mrp) : '',
    tat_hours: test?.tat_hours ? String(test.tat_hours) : '',
    duration_min: test?.duration ? String(test.duration) : '',
    needs_reporting_doctor: test ? Boolean(test.needs_report) : true,
    preparation: test?.preparation || '',
    disabled: test ? !test.active : false,
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const saved = await mutate(
      () => api<Service>('/diagnostics/tests', { method: 'POST', body: { ...f, department: MODALITIES[f.modality] } }),
      (s) => `${s.name} saved in the ERP test master (${s.code})`,
    );
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <Modal
      title={test ? `Edit ${test.name}` : 'Add Diagnostic Test'}
      subtitle={test ? `ERP code ${test.code}` : 'Created in the main ERP as a billable item, then available here for booking'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="diag-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving to ERP…' : 'Save to ERP'}
          </button>
        </>
      }
    >
      <form id="diag-form" onSubmit={submit} className="grid-2">
        <Field label="Test name *" span={2}>
          <input value={f.test_name} onChange={set('test_name')} required autoFocus placeholder="e.g. X-Ray Chest PA View" />
        </Field>
        <Field label="Modality *" hint={`Department: ${MODALITIES[f.modality]}`}>
          <select value={f.modality} onChange={set('modality')}>
            {Object.keys(MODALITIES).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Body part / region">
          <input value={f.body_part} onChange={set('body_part')} placeholder="Chest, Lumbar spine, Both upper limbs…" />
        </Field>
        <Field label="Rate (₹) *">
          <input type="number" min={0} value={f.rate} onChange={set('rate')} required />
        </Field>
        <Field label="MRP (₹)">
          <input type="number" min={0} value={f.mrp} onChange={set('mrp')} />
        </Field>
        <Field label="Report turnaround (hours)">
          <input type="number" min={0} value={f.tat_hours} onChange={set('tat_hours')} />
        </Field>
        <Field label="Procedure time (minutes)">
          <input type="number" min={0} value={f.duration_min} onChange={set('duration_min')} />
        </Field>
        <Field label="Patient preparation" span={2}>
          <input value={f.preparation} onChange={set('preparation')} placeholder="e.g. 6 hours fasting, full bladder, remove metal objects" />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={f.needs_reporting_doctor} onChange={(e) => setF({ ...f, needs_reporting_doctor: e.target.checked })} /> Reported by a doctor / radiologist
        </label>
        {test && (
          <label className="check span-2">
            <input type="checkbox" checked={f.disabled} onChange={(e) => setF({ ...f, disabled: e.target.checked })} /> Disabled (hidden from booking and billing everywhere)
          </label>
        )}
      </form>
    </Modal>
  );
}

const STARTER: [string, string, string][] = [
  ['X-Ray Chest PA View', 'X-Ray', 'Chest'],
  ['X-Ray Cervical Spine AP / Lateral', 'X-Ray', 'Cervical spine'],
  ['X-Ray Dorsal Spine AP / Lateral', 'X-Ray', 'Dorsal spine'],
  ['X-Ray Lumbosacral Spine AP / Lateral', 'X-Ray', 'Lumbosacral spine'],
  ['X-Ray Knee AP / Lateral (Single)', 'X-Ray', 'Knee'],
  ['X-Ray Both Knees Standing AP', 'X-Ray', 'Both knees'],
  ['X-Ray Shoulder AP', 'X-Ray', 'Shoulder'],
  ['X-Ray Pelvis with Both Hips AP', 'X-Ray', 'Pelvis'],
  ['X-Ray Ankle AP / Lateral', 'X-Ray', 'Ankle'],
  ['X-Ray Wrist AP / Lateral', 'X-Ray', 'Wrist'],
  ['X-Ray Heel Lateral (Calcaneum)', 'X-Ray', 'Heel'],
  ['X-Ray PNS (Waters View)', 'X-Ray', 'Paranasal sinuses'],
  ['USG Whole Abdomen', 'Ultrasound (USG)', 'Abdomen & pelvis'],
  ['USG Upper Abdomen', 'Ultrasound (USG)', 'Upper abdomen'],
  ['USG KUB', 'Ultrasound (USG)', 'Kidneys, ureters, bladder'],
  ['USG Thyroid / Neck', 'Ultrasound (USG)', 'Neck'],
  ['USG Shoulder (Musculoskeletal)', 'Ultrasound (USG)', 'Shoulder'],
  ['USG Knee (Musculoskeletal)', 'Ultrasound (USG)', 'Knee'],
  ['USG Soft Tissue / Swelling', 'Ultrasound (USG)', 'Local part'],
  ['Venous Doppler Both Lower Limbs', 'Doppler', 'Both lower limbs'],
  ['Arterial Doppler Both Lower Limbs', 'Doppler', 'Both lower limbs'],
  ['Carotid Doppler', 'Doppler', 'Neck'],
  ['ECG (12 Lead)', 'ECG', 'Heart'],
  ['2D Echo with Colour Doppler', '2D Echo', 'Heart'],
  ['TMT (Treadmill Test)', 'TMT', 'Heart'],
  ['Holter Monitoring (24 Hours)', 'Holter', 'Heart'],
  ['ABPM (24 Hours)', 'ABPM', 'Blood pressure'],
  ['NCV Both Upper Limbs', 'NCV', 'Both upper limbs'],
  ['NCV Both Lower Limbs', 'NCV', 'Both lower limbs'],
  ['NCV All Four Limbs', 'NCV', 'All four limbs'],
  ['EMG (Single Limb)', 'EMG', 'Single limb'],
  ['EMG with NCV (Both Upper Limbs)', 'EMG', 'Both upper limbs'],
  ['EEG (Routine)', 'EEG', 'Brain'],
  ['VEP (Visual Evoked Potential)', 'Evoked Potentials (VEP / BERA)', 'Visual pathway'],
  ['BERA (Brainstem Evoked Response)', 'Evoked Potentials (VEP / BERA)', 'Auditory pathway'],
  ['PFT / Spirometry', 'PFT / Spirometry', 'Lungs'],
  ['Pure Tone Audiometry (PTA)', 'Audiometry', 'Ears'],
  ['Impedance Audiometry (Tympanometry)', 'Audiometry', 'Ears'],
  ['DEXA Scan (Bone Mineral Density)', 'DEXA / BMD', 'Spine & hip'],
  ['OPG (Dental Panoramic X-Ray)', 'OPG / Dental X-Ray', 'Jaw'],
];

export function DiagnosticStarterForm({ onClose }: { onClose: () => void }) {
  const { toast, refresh } = useCare();
  const [rows, setRows] = useState(() => STARTER.map(([name, modality, body]) => ({ name, modality, body, pick: false, rate: '' })));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const picked = rows.filter((r) => r.pick);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = picked.filter((r) => !(Number(r.rate) > 0));
    if (missing.length) {
      toast(`Enter a rate for ${missing[0].name}${missing.length > 1 ? ` and ${missing.length - 1} more` : ''}`, 'error');
      return;
    }
    setBusy(true);
    let done = 0;
    const failed: string[] = [];
    for (const r of picked) {
      setProgress(`Creating ${done + 1} of ${picked.length}: ${r.name}`);
      try {
        await api('/diagnostics/tests', { method: 'POST', body: { test_name: r.name, modality: r.modality, department: MODALITIES[r.modality], body_part: r.body, rate: Number(r.rate) } });
        done += 1;
      } catch (err) {
        failed.push(`${r.name}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    setBusy(false);
    setProgress('');
    refresh();
    if (failed.length) toast(`${done} created, ${failed.length} failed. ${failed[0]}`, 'error');
    else {
      toast(`${done} diagnostic tests created in the ERP`);
      onClose();
    }
  };

  return (
    <Modal
      title="Add Common Diagnostic Tests"
      subtitle="Tick the tests this centre offers and enter its rate. Each one is created in the ERP test master."
      onClose={onClose}
      wide
      footer={
        <>
          <span className="foot-total">{progress || `${picked.length} selected · ${inr(picked.reduce((s, r) => s + (Number(r.rate) || 0), 0))}`}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="starter-form" className="btn btn-primary" disabled={busy || picked.length === 0}>
            {busy ? 'Creating…' : `Create ${picked.length} in ERP`}
          </button>
        </>
      }
    >
      <form id="starter-form" onSubmit={submit}>
        <table className="table compact">
          <thead>
            <tr>
              <th />
              <th>Test</th>
              <th>Modality</th>
              <th className="num">Rate (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className={r.pick ? '' : 'dim'}>
                <td>
                  <input
                    type="checkbox"
                    checked={r.pick}
                    aria-label={`Add ${r.name}`}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))}
                  />
                </td>
                <td>{r.name}</td>
                <td>{r.modality}</td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    className="rate-input"
                    value={r.rate}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value, pick: x.pick || e.target.value !== '' } : x)))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </form>
    </Modal>
  );
}
