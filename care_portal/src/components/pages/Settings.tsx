import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useApi, useCare } from '../../store';
import type { ApptType, Settings } from '../../types';
import { fmtStamp, inr, TYPE_LABEL } from '../../format';
import { Field, PageHeader, Pill, Tabs } from '../ui';

const FIELDS: { key: string; label: string; span?: 2; hint?: string }[] = [
  { key: 'clinic_name', label: 'Clinic name' },
  { key: 'tagline', label: 'Tagline' },
  { key: 'phone', label: 'Phone' },
  { key: 'support_email', label: 'Support email' },
  { key: 'address', label: 'Address', span: 2 },
  { key: 'gstin', label: 'Company GSTIN', hint: 'Used when a branch has no GSTIN of its own' },
  { key: 'invoice_prefix', label: 'Invoice prefix', hint: 'e.g. RC/INV → RC/INV/261105-0001' },
  { key: 'invoice_footer', label: 'Invoice footer note', span: 2 },
];

/* Scales an uploaded signature down (max 600 × 200 px) and returns it as a PNG data URL. */
function readSignature(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        const scale = Math.min(1, 600 / img.width, 200 / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Profile() {
  const { me, can, mutate, toast } = useCare();
  const { data } = useApi<Settings>('/settings');
  const [f, setF] = useState<Settings>({});
  const editable = can('Settings', 'manage') && !me.branches;
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutate(() => api('/settings', { method: 'PUT', body: f }), 'Settings saved');
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readSignature(file);
      if (dataUrl.length > 400000) throw new Error('Signature image is too large; crop it closer to the signature');
      setF((cur) => ({ ...cur, invoice_signature: dataUrl }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not use that image', 'error');
    }
  };
  return (
    <form onSubmit={submit} className="grid-2 pad-top">
      {FIELDS.map((x) => (
        <Field key={x.key} label={x.label} span={x.span} hint={x.hint}>
          <input value={f[x.key] || ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} disabled={!editable} />
        </Field>
      ))}
      <p className="form-section">Authorised signatory (printed on invoices)</p>
      <Field label="Signatory name">
        <input value={f.signatory_name || ''} onChange={(e) => setF({ ...f, signatory_name: e.target.value })} disabled={!editable} placeholder="e.g. Snehasish Ganguly" />
      </Field>
      <Field label="Designation">
        <input value={f.signatory_title || ''} onChange={(e) => setF({ ...f, signatory_title: e.target.value })} disabled={!editable} placeholder="e.g. Centre Manager" />
      </Field>
      <Field label="Signature image" span={2} group hint="Scan or photo of the signature on white paper (PNG/JPG). It is resized automatically.">
        <div className="signature-box">
          {f.invoice_signature ? <img src={f.invoice_signature} alt="Signature" /> : <span className="muted small">No signature uploaded — invoices show a blank signature line.</span>}
          {editable && (
            <>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
              {f.invoice_signature && (
                <button type="button" className="btn btn-ghost sm" onClick={() => setF({ ...f, invoice_signature: '' })}>
                  Remove
                </button>
              )}
            </>
          )}
        </div>
      </Field>
      <p className="muted small span-2">
        Branch address, contact number and GSTIN are set per branch in Branch Management and printed on that branch's invoices.
      </p>
      {editable && (
        <div className="span-2">
          <button type="submit" className="btn btn-primary">
            Save settings
          </button>
        </div>
      )}
    </form>
  );
}

function PriceList() {
  const { meta, can, openModal } = useCare();
  const editable = can('Settings', 'edit');
  return (
    <div className="pad-top">
      {(['consultation', 'physiotherapy', 'lab'] as ApptType[]).map((cat) => (
        <div key={cat} className="price-group">
          <div className="card-head">
            <h3>{TYPE_LABEL[cat]}</h3>
            {editable && (
              <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'service', category: cat })}>
                <Icon name="plus" size={14} /> Add
              </button>
            )}
          </div>
          {cat !== 'lab' && (meta?.services || []).some((s) => s.category === cat && s.source === 'erp') && (
            <p className="muted small pad">Items tagged ERP come from the main ERP and re-sync daily; a price you change here is kept as a custom price.</p>
          )}
          {cat === 'lab' && (
            <p className="muted small pad">
              Diagnostic tests (X-ray, USG, ECG, NCV…) are kept in the ERP and managed in{' '}
              <Link to="/diagnostics/master" className="link">
                Diagnostics → Diagnostic Test Master
              </Link>
              .
            </p>
          )}
          {cat === 'lab' && (
            <p className="muted small pad">
              {meta?.lab_catalog.erp_tests || 0} lab tests come from the Remedium Labs ERP and are managed in{' '}
              <Link to="/lab/catalog" className="link">
                Test &amp; Lab → Test Catalog
              </Link>
              . Clinic-only tests are listed below.
            </p>
          )}
          <table className="table compact">
            <tbody>
              {(meta?.services || [])
                .filter((s) => s.category === cat)
                .map((s) => (
                  <tr key={s.id} className={s.active ? '' : 'dim'}>
                    <td>{s.name}</td>
                    <td className="muted">{s.duration ? `${s.duration} min` : ''}</td>
                    <td className="num">{inr(s.price)}</td>
                    <td>
                      {s.source === 'erp' && <Pill tone="blue">ERP</Pill>}
                      {s.price_override ? <Pill tone="orange">Custom price</Pill> : null}
                      {!s.active && <Pill tone="grey">Hidden</Pill>}
                    </td>
                    <td className="row-actions">
                      {editable && (
                        <button type="button" className="icon-btn sm" onClick={() => openModal({ kind: 'service', service: s })} aria-label={`Edit ${s.name}`}>
                          <Icon name="edit" size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

type Audit = { id: number; at: string; user: string; action: string; entity: string; ref: string };

function Activity() {
  const { data } = useApi<{ items: Audit[] }>('/activity?limit=100');
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>When</th>
          <th>User</th>
          <th>Action</th>
          <th>Record</th>
        </tr>
      </thead>
      <tbody>
        {data?.items.map((a) => (
          <tr key={a.id}>
            <td className="nowrap">{fmtStamp(a.at)}</td>
            <td>{a.user}</td>
            <td>
              {a.action} {a.entity}
            </td>
            <td className="mono wrap">{a.ref}</td>
          </tr>
        ))}
        {data && data.items.length === 0 && (
          <tr>
            <td colSpan={4} className="muted">
              No changes recorded yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function SampleData() {
  const { me, meta, can, mutate } = useCare();
  const [confirm, setConfirm] = useState('');
  if (!meta?.has_demo) return <p className="pad-top muted">This portal holds only real records. There is no sample data to remove.</p>;
  const allowed = can('Settings', 'manage') && !me.branches;
  return (
    <div className="pad-top stack narrow">
      <p>
        The portal was set up with <b>sample patients, bookings, invoices, staff, stock and equipment</b> so every screen can be tried out. Remove them before the clinic starts using
        the portal for real. The branch, price list and settings are kept; anything recorded against sample patients is removed with them.
      </p>
      {allowed ? (
        <>
          <Field label='Type "REMOVE" to confirm'>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <button
            type="button"
            className="btn btn-danger"
            disabled={confirm !== 'REMOVE'}
            onClick={() => mutate(() => api('/settings/clear-sample-data', { method: 'POST' }), 'Sample data removed')}
          >
            Remove sample data
          </button>
        </>
      ) : (
        <p className="muted small">Only users with Manage access to Settings can remove sample data.</p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { me, meta } = useCare();
  const [tab, setTab] = useState<'profile' | 'prices' | 'activity' | 'data'>('profile');
  const allBranches = !me.branches;
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Clinic profile, price list and audit trail" icon="settings" />
      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'profile', label: 'Clinic profile' },
            { value: 'prices', label: 'Services & pricing' },
            ...(allBranches ? [{ value: 'activity' as const, label: 'Activity log' }] : []),
            { value: 'data', label: meta?.has_demo ? 'Sample data •' : 'Sample data' },
          ]}
        />
        {tab === 'profile' && <Profile />}
        {tab === 'prices' && <PriceList />}
        {tab === 'activity' && allBranches && <Activity />}
        {tab === 'data' && <SampleData />}
      </div>
    </div>
  );
}
