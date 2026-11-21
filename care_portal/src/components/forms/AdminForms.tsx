import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../../api';
import { useApi, useCare } from '../../store';
import type { Asset, Branch, Practitioner, Service } from '../../types';
import { addDays, fmtStamp, todayIst, TYPE_LABEL } from '../../format';
import { Empty, Field, Loading, Modal } from '../ui';
import { AES, roleLabel } from '../../flavor';

const AES_ROLES = ['Physiotherapist', 'Doctor', 'Cosmetologist', 'Nurse', 'Receptionist', 'Manager'];

function FormModal({ id, title, subtitle, busy, onClose, children, extra }: { id: string; title: string; subtitle?: string; busy: boolean; onClose: () => void; children: ReactNode; extra?: ReactNode }) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          {extra}
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={id} className="btn btn-primary" disabled={busy}>
            Save
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

function useForm<T extends Record<string, string | boolean>>(initial: T) {
  const [f, setF] = useState(initial);
  const set = (key: keyof T) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [key]: e.target.value }));
  return { f, setF, set };
}

export function AssetForm({ asset, onClose }: { asset?: Asset; onClose: () => void }) {
  const { meta, branch, mutate } = useCare();
  const { f, set } = useForm({
    name: asset?.name || '',
    tag: asset?.tag || '',
    category: asset?.category || '',
    status: asset?.status || 'Working',
    purchase_date: asset?.purchase_date || '',
    cost: asset?.cost == null ? '' : String(asset.cost),
    vendor: asset?.vendor || '',
    next_service: asset?.next_service || addDays(todayIst(), 90),
    notes: asset?.notes || '',
    branch_id: String(asset?.branch_id || branch || meta?.branches[0]?.id || ''),
  });
  const [busy, setBusy] = useState(false);
  const branches = (meta?.branches || []).filter((b) => b.active);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(() => api<Asset>(asset ? `/assets/${asset.id}` : '/assets', { method: asset ? 'PATCH' : 'POST', body: f }), asset ? 'Asset updated' : `${f.name} added`);
    setBusy(false);
    if (r) onClose();
  };

  return (
    <FormModal id="asset-form" title={asset ? `Edit ${asset.name}` : 'Add Asset'} subtitle={asset?.tag} busy={busy} onClose={onClose}>
      <form id="asset-form" onSubmit={submit} className="grid-2">
        <Field label="Asset name *" span={2}>
          <input value={f.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Category">
          <input value={f.category} onChange={set('category')} list="asset-cats" placeholder="Electrotherapy, Exercise, IT…" />
          <datalist id="asset-cats">
            {['Electrotherapy', 'Traction', 'Rehabilitation', 'Exercise', 'Thermotherapy', 'Laboratory', 'Pharmacy', 'Furniture', 'IT'].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {(meta?.enums.assetStatuses || []).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Asset tag" hint={asset ? undefined : 'Generated when left blank'}>
          <input value={f.tag} onChange={set('tag')} />
        </Field>
        {branches.length > 1 && (
          <Field label="Branch">
            <select value={f.branch_id} onChange={set('branch_id')}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Purchase date">
          <input type="date" value={f.purchase_date} onChange={set('purchase_date')} />
        </Field>
        <Field label="Cost (₹)">
          <input type="number" min={0} value={f.cost} onChange={set('cost')} />
        </Field>
        <Field label="Vendor / service partner">
          <input value={f.vendor} onChange={set('vendor')} />
        </Field>
        <Field label="Next service due">
          <input type="date" value={f.next_service} onChange={set('next_service')} />
        </Field>
        <Field label="Notes" span={2}>
          <textarea rows={2} value={f.notes} onChange={set('notes')} />
        </Field>
      </form>
    </FormModal>
  );
}

export function AssetServiceForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { mutate } = useCare();
  const { f, set } = useForm({ date: todayIst(), next_service: addDays(todayIst(), 90), note: '', status: 'Working' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(() => api(`/assets/${asset.id}/service`, { method: 'POST', body: f }), `Service logged for ${asset.name}`);
    setBusy(false);
    if (r) onClose();
  };
  return (
    <FormModal id="svc-form" title="Log service" subtitle={`${asset.tag} · ${asset.name}`} busy={busy} onClose={onClose}>
      <form id="svc-form" onSubmit={submit} className="grid-2">
        <Field label="Serviced on">
          <input type="date" value={f.date} onChange={set('date')} max={todayIst()} required />
        </Field>
        <Field label="Next service due">
          <input type="date" value={f.next_service} onChange={set('next_service')} />
        </Field>
        <Field label="Status after service">
          <select value={f.status} onChange={set('status')}>
            <option>Working</option>
            <option>Under Maintenance</option>
            <option>Out of Order</option>
          </select>
        </Field>
        <Field label="Work done" span={2}>
          <textarea rows={3} value={f.note} onChange={set('note')} placeholder="Calibration, parts replaced, engineer name…" />
        </Field>
      </form>
    </FormModal>
  );
}

type AssetLog = { id: number; at: string; kind: string; note: string | null; by: string };

export function AssetLogsView({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { data } = useApi<{ logs: AssetLog[] }>(`/assets/${asset.id}/logs`);
  return (
    <Modal title={asset.name} subtitle={`${asset.tag} · service history`} onClose={onClose}>
      {!data && <Loading />}
      {data && data.logs.length === 0 && <Empty text="No history yet." icon="wrench" />}
      <ul className="timeline">
        {data?.logs.map((l) => (
          <li key={l.id}>
            <strong>{l.kind}</strong> <span className="muted small">{fmtStamp(l.at)} · {l.by}</span>
            {l.note && <p>{l.note}</p>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function BranchForm({ branch, onClose }: { branch?: Branch; onClose: () => void }) {
  const { mutate } = useCare();
  const { f, setF, set } = useForm({
    name: branch?.name || '',
    code: branch?.code || '',
    city: branch?.city || '',
    address: branch?.address || '',
    phone: branch?.phone || '',
    email: branch?.email || '',
    manager: branch?.manager || '',
    gst_registered: Boolean(branch?.gst_registered),
    gstin: branch?.gstin || '',
    state: branch?.state || 'West Bengal',
    state_code: branch?.state_code || '',
    active: branch ? Boolean(branch.active) : true,
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = f.gst_registered ? f : { ...f, gstin: '', state_code: '' };
    const r = await mutate(() => api(branch ? `/branches/${branch.id}` : '/branches', { method: branch ? 'PATCH' : 'POST', body }), branch ? 'Branch updated' : `${f.name} added`);
    setBusy(false);
    if (r) onClose();
  };
  return (
    <FormModal id="branch-form" title={branch ? `Edit ${branch.name}` : 'Add Branch'} busy={busy} onClose={onClose}>
      <form id="branch-form" onSubmit={submit} className="grid-2">
        <Field label="Branch name *" span={2}>
          <input value={f.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Code">
          <input value={f.code} onChange={set('code')} maxLength={12} />
        </Field>
        <Field label="City">
          <input value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Address" span={2}>
          <input value={f.address} onChange={set('address')} />
        </Field>
        <Field label="Contact number" hint="Printed on this branch's invoices">
          <input value={f.phone} onChange={set('phone')} inputMode="tel" />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Branch manager">
          <input value={f.manager} onChange={set('manager')} />
        </Field>
        <Field label="State">
          <input value={f.state} onChange={set('state')} />
        </Field>
        <p className="form-section">GST</p>
        <label className="check span-2">
          <input type="checkbox" checked={f.gst_registered} onChange={(e) => setF({ ...f, gst_registered: e.target.checked })} /> This branch is GST registered (print GSTIN and
          “Tax Invoice” on its invoices)
        </label>
        {f.gst_registered && (
          <>
            <Field label="GSTIN *" hint="15 characters, e.g. 19ABCDE1234F1Z5">
              <input
                value={f.gstin}
                onChange={(e) => {
                  const gstin = e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 15);
                  setF({ ...f, gstin, state_code: /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : f.state_code });
                }}
                required
                pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]"
                title="15-character GSTIN, e.g. 19ABCDE1234F1Z5"
              />
            </Field>
            <Field label="State code" hint="First two digits of the GSTIN (West Bengal = 19)">
              <input value={f.state_code} onChange={set('state_code')} maxLength={2} />
            </Field>
          </>
        )}
        <label className="check span-2">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Branch is active
        </label>
      </form>
    </FormModal>
  );
}

export function PractitionerForm({ practitioner, onClose }: { practitioner?: Practitioner; onClose: () => void }) {
  const { meta, branch, mutate } = useCare();
  const { f, setF, set } = useForm({
    name: practitioner?.name || '',
    role: practitioner?.role || (AES ? 'Physiotherapist' : 'Doctor'),
    specialty: practitioner?.specialty || '',
    phone: practitioner?.phone || '',
    email: practitioner?.email || '',
    fee: String(practitioner?.fee ?? ''),
    branch_id: String(practitioner?.branch_id || branch || meta?.branches[0]?.id || ''),
    active: practitioner ? Boolean(practitioner.active) : true,
  });
  const [busy, setBusy] = useState(false);
  const branches = (meta?.branches || []).filter((b) => b.active);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(
      () => api(practitioner ? `/practitioners/${practitioner.id}` : '/practitioners', { method: practitioner ? 'PATCH' : 'POST', body: f }),
      practitioner ? 'Staff details saved' : `${f.name} added`,
    );
    setBusy(false);
    if (r) onClose();
  };
  return (
    <FormModal id="staff-form" title={practitioner ? `Edit ${practitioner.name}` : 'Add Clinical Staff'} busy={busy} onClose={onClose}>
      <form id="staff-form" onSubmit={submit} className="grid-2">
        <Field label="Full name *" span={2}>
          <input value={f.name} onChange={set('name')} required autoFocus placeholder="Dr. … / therapist name" />
        </Field>
        <Field label="Role">
          <select value={f.role} onChange={set('role')}>
            {(meta?.enums.roles || []).filter((r) => !AES || AES_ROLES.includes(r)).map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Speciality / qualification">
          <input value={f.specialty} onChange={set('specialty')} />
        </Field>
        <Field label="Phone">
          <input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Default fee (₹)">
          <input type="number" min={0} value={f.fee} onChange={set('fee')} />
        </Field>
        {branches.length > 1 && (
          <Field label="Branch">
            <select value={f.branch_id} onChange={set('branch_id')}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label className="check span-2">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (shows in booking forms)
        </label>
      </form>
    </FormModal>
  );
}

export function ServiceForm({ service, category, onClose }: { service?: Service; category?: string; onClose: () => void }) {
  const { mutate } = useCare();
  const erp = service?.source === 'erp';
  const { f, setF, set } = useForm({
    category: service?.category || category || 'consultation',
    name: service?.name || '',
    price: String(service?.price ?? ''),
    duration: String(service?.duration ?? 30),
    active: service ? Boolean(service.active) : true,
    price_override: Boolean(service?.price_override),
    description: service?.description || '',
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const priceChanged = erp && Number(f.price) !== service!.price;
    const body = erp ? { ...f, price_override: f.price_override || priceChanged } : f;
    const r = await mutate(() => api(service ? `/services/${service.id}` : '/services', { method: service ? 'PATCH' : 'POST', body }), service ? 'Price list updated' : `${f.name} added`);
    setBusy(false);
    if (r) onClose();
  };
  return (
    <FormModal id="service-form" title={service ? `Edit ${service.name}` : category === 'lab' ? 'Add Clinic-only Test' : 'Add Service'} subtitle={erp ? `ERP test ${service!.code}` : undefined} busy={busy} onClose={onClose}>
      <form id="service-form" onSubmit={submit} className="grid-2">
        {erp ? (
          <p className="muted small span-2">
            Name, MRP, sample and report time come from the Remedium Labs ERP{service!.mrp ? ` (MRP ${service!.mrp.toLocaleString('en-IN')})` : ''}. You can set the clinic price and hide the test here.
          </p>
        ) : (
          <>
            <Field label="Category">
              <select value={f.category} onChange={set('category')}>
                {['consultation', 'physiotherapy', 'lab'].map((c) => (
                  <option key={c} value={c}>
                    {TYPE_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Service name *">
              <input value={f.name} onChange={set('name')} required autoFocus />
            </Field>
          </>
        )}
        <Field label="Price (₹)">
          <input type="number" min={0} value={f.price} onChange={set('price')} required autoFocus={erp} />
        </Field>
        {f.category !== 'lab' && (
          <Field label="Duration (minutes)">
            <input type="number" min={0} value={f.duration} onChange={set('duration')} />
          </Field>
        )}
        {f.category === 'physiotherapy' && (
          <Field label="Description" span={2}>
            <input value={f.description} onChange={set('description')} placeholder="What the therapy involves" />
          </Field>
        )}
        {erp && (
          <label className="check span-2">
            <input type="checkbox" checked={f.price_override} onChange={(e) => setF({ ...f, price_override: e.target.checked })} /> Keep this price when the ERP catalogue syncs
            (untick to go back to the ERP rate on the next import)
          </label>
        )}
        <label className="check span-2">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Available for booking
        </label>
      </form>
    </FormModal>
  );
}
