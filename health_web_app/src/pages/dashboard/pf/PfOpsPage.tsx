import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../../api';
import type { ApiClientRow, ApiClientSecret, LabelFormat, LabelOutput } from '../../../types/foundations';
import type {
  PfAccount,
  PfBarcodeRow,
  PfHub,
  PfJobBoard,
  PfKitRow,
  PfLabInbox,
  PfLabSettings,
  PfRiderRow,
} from '../../../types/phlebofirst';
import './pf-ops.css';

type Tab = 'jobs' | 'requests' | 'accounts' | 'labs' | 'hubs' | 'barcodes' | 'kits' | 'riders';
type Printer = (codes: string[]) => Promise<void>;
type PrintProps = { print: Printer; printing: boolean };

const TABS: Array<[Tab, string]> = [
  ['jobs', 'Jobs board'],
  ['requests', 'Requests'],
  ['accounts', 'Accounts'],
  ['labs', 'Lab settings'],
  ['hubs', 'Drop hubs'],
  ['barcodes', 'Barcodes'],
  ['kits', 'Kits'],
  ['riders', 'Riders'],
];
const TUBE_CODES = ['BLU', 'RED', 'SST', 'GRN', 'LAV', 'GRY', 'RBL'] as const;
const LABEL_SIZES = ['50x25', '38x25', '50x30'];
const JOB_STATUSES = ['Open', 'Accepted', 'Started', 'Collected', 'Dropped', 'Received', 'Expired', 'Cancelled'];
const BARCODE_STATUSES: PfBarcodeRow['status'][] = ['Issued', 'Bound', 'Dropped', 'Received', 'Rejected', 'Void'];
const ACCOUNT_TYPES: PfAccount['account_type'][] = ['Doctor', 'Pharmacy', 'Small Lab', 'Franchisee'];
const BARCODE_PAGE = 50;

function errText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function money(n?: number | null) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('en-IN');
}

function numOrNull(value: string) {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function num(value: string, fallback = 0) {
  return numOrNull(value) ?? fallback;
}

function str(value?: number | string | null) {
  return value == null ? '' : String(value);
}

function splitList(value: string) {
  return value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function deliverLabels(out: LabelOutput) {
  if (out.fmt === 'pdf') {
    if (!out.content_base64) throw new Error('The label PDF was empty');
    const bytes = Uint8Array.from(atob(out.content_base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) saveBlob(blob, out.filename || 'labels.pdf');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const text = out.content ?? (out.content_base64 ? atob(out.content_base64) : '');
  saveBlob(new Blob([text], { type: 'text/plain' }), out.filename || `labels.${out.fmt}`);
}

function useForm<T extends object>(initial: T) {
  const [form, setForm] = useState<T>(initial);
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => setForm((f) => ({ ...f, [key]: value })), []);
  return [form, setForm, set] as const;
}

function useRiders() {
  const [rows, setRows] = useState<PfRiderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .pfRidersList('')
      .then((res) => {
        if (!cancelled) setRows(res.data.rows || []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errText(e, 'Could not load riders'));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const riders = useMemo(() => rows.filter((r) => r.is_rider && r.provider), [rows]);
  return { riders, error };
}

function riderLabel(r: PfRiderRow) {
  return `${r.full_name || r.user} (${r.provider})`;
}

function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: ReactNode }) {
  return (
    <label className={`pfo-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Alerts({ error, notice }: { error: string | null; notice?: string | null }) {
  return (
    <>
      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="pfo-notice">{notice}</div> : null}
    </>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`pfo-counter${tone ? ` ${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/* ---------------- Jobs board ---------------- */

function JobsTab() {
  const [status, setStatus] = useState('');
  const [data, setData] = useState<PfJobBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfOpsDashboard(status ? { status } : {});
      setData(res.data);
    } catch (e) {
      setError(errText(e, 'Could not load the jobs board'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="pfo-section">
      {data ? (
        <div className="pfo-counters">
          {Object.entries(data.job_counts).map(([k, v]) => (
            <Counter key={`j-${k}`} label={`Jobs · ${k}`} value={v} />
          ))}
          {Object.entries(data.request_counts).map(([k, v]) => (
            <Counter key={`r-${k}`} label={`Requests · ${k}`} value={v} tone="soft" />
          ))}
          <Counter label="Unassigned requests" value={data.unassigned_requests} tone={data.unassigned_requests ? 'warn' : undefined} />
        </div>
      ) : null}
      <div className="pfo-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Job status">
          <option value="">Any status</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {data ? <span className="muted">{data.total} job(s)</span> : null}
      </div>
      <Alerts error={error} />
      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Lab</th>
              <th>Area</th>
              <th>Window</th>
              <th>Rider</th>
              <th>Offers</th>
              <th>Broadcast</th>
              <th>SLA due</th>
              <th>Drop hub</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.name} className={r.overdue ? 'is-overdue' : ''}>
                <td>
                  <b>{r.name}</b>
                  <small>{r.request}</small>
                </td>
                <td>
                  <span className={`pfo-pill s-${r.status.toLowerCase()}`}>{r.status}</span>
                </td>
                <td>{r.lab_name || r.lab || '—'}</td>
                <td>{r.pickup_area || '—'}</td>
                <td>
                  {fmtDateTime(r.window_start)}
                  {r.window_end ? <small>to {fmtDateTime(r.window_end)}</small> : null}
                </td>
                <td>{r.rider_name || r.rider || '—'}</td>
                <td>{r.offers}</td>
                <td>
                  R{r.broadcast_round} · {r.broadcast_radius_km} km
                </td>
                <td>
                  {fmtDateTime(r.sla_due)}
                  {r.overdue ? <span className="pfo-pill bad">Overdue</span> : null}
                </td>
                <td>
                  {r.dropped_hub || '—'}
                  {r.drop_geofence_warning ? <span className="pfo-pill warn">Geofence</span> : null}
                </td>
              </tr>
            ))}
            {data && !data.rows.length ? (
              <tr>
                <td colSpan={10} className="pfo-empty">
                  No jobs for this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Requests ---------------- */

function RequestsTab({ labs }: { labs: PfLabSettings[] }) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<PfLabInbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const acceptingLabs = labs.filter((l) => l.accepts_pf);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfOpsRequests(status, q);
      setData(res.data);
    } catch (e) {
      setError(errText(e, 'Could not load requests'));
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assignLab(name: string) {
    const lab = assign[name];
    if (!lab) return;
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await api.pfAssignLab(name, lab);
      setNotice(`${name} assigned to ${acceptingLabs.find((l) => l.lab === lab)?.lab_name || lab}.`);
      await load();
    } catch (e) {
      setError(errText(e, 'Could not assign the lab'));
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setQ(query.trim());
  }

  return (
    <section className="pfo-section">
      <form className="pfo-filters" onSubmit={submit}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Request status">
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Patient, request, account…" />
        <button type="submit" className="btn secondary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        {data ? (
          <span className="muted">
            {data.total} request(s) · pending {data.counts.pending ?? 0} · active {data.counts.active ?? 0}
          </span>
        ) : null}
      </form>
      <Alerts error={error} notice={notice} />
      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Status</th>
              <th>Patient</th>
              <th>Account</th>
              <th>Area</th>
              <th>Lab</th>
              <th>Submitted</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => {
              const canAssign = r.status === 'Uploaded' || r.status === 'Under Review';
              return (
                <tr key={r.name}>
                  <td>
                    <b>{r.name}</b>
                    {r.job ? <small>Job {r.job}</small> : null}
                  </td>
                  <td>
                    <span className="pfo-pill">{r.status}</span>
                    {r.job_status ? <small>Job: {r.job_status}</small> : null}
                  </td>
                  <td>
                    {r.patient_name}
                    <small>{[r.patient_age != null ? `${r.patient_age} y` : '', r.patient_gender].filter(Boolean).join(' · ')}</small>
                  </td>
                  <td>
                    {r.account_name || r.account || '—'}
                    {r.account_type ? <small>{r.account_type}</small> : null}
                  </td>
                  <td>{r.pickup_area || '—'}</td>
                  <td>
                    {canAssign ? (
                      <div className="pfo-inline">
                        <select
                          value={assign[r.name] ?? r.assigned_lab ?? ''}
                          onChange={(e) => setAssign((cur) => ({ ...cur, [r.name]: e.target.value }))}
                          aria-label={`Lab for ${r.name}`}
                        >
                          <option value="">Choose lab…</option>
                          {acceptingLabs.map((l) => (
                            <option key={l.lab} value={l.lab}>
                              {l.lab_name || l.lab}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy !== null || !assign[r.name] || assign[r.name] === r.assigned_lab}
                          onClick={() => void assignLab(r.name)}
                        >
                          {busy === r.name ? 'Assigning…' : 'Assign'}
                        </button>
                      </div>
                    ) : (
                      r.lab_name || r.assigned_lab || '—'
                    )}
                  </td>
                  <td>{fmtDateTime(r.submitted_on)}</td>
                  <td>{r.grand_total != null ? money(r.grand_total) : '—'}</td>
                </tr>
              );
            })}
            {data && !data.rows.length ? (
              <tr>
                <td colSpan={8} className="pfo-empty">
                  No requests match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!acceptingLabs.length ? <p className="muted">No lab accepts PhleboFirst yet — enable one under Lab settings to assign requests.</p> : null}
    </section>
  );
}

/* ---------------- Accounts ---------------- */

type AccountForm = {
  name: string;
  display_name: string;
  account_type: PfAccount['account_type'];
  status: PfAccount['status'];
  mobile: string;
  email: string;
  address: string;
  lat: string;
  lng: string;
  default_lab: string;
  franchisee: string;
  referring_doctor: string;
  doctor: string;
  add_users: string;
};

const EMPTY_ACCOUNT: AccountForm = {
  name: '',
  display_name: '',
  account_type: 'Doctor',
  status: 'Active',
  mobile: '',
  email: '',
  address: '',
  lat: '',
  lng: '',
  default_lab: '',
  franchisee: '',
  referring_doctor: '',
  doctor: '',
  add_users: '',
};

function accountToForm(a: PfAccount): AccountForm {
  return {
    name: a.name,
    display_name: a.display_name || '',
    account_type: a.account_type,
    status: a.status,
    mobile: a.mobile || '',
    email: a.email || '',
    address: a.address || '',
    lat: str(a.lat),
    lng: str(a.lng),
    default_lab: a.default_lab || '',
    franchisee: a.franchisee || '',
    referring_doctor: a.referring_doctor || '',
    doctor: a.doctor || '',
    add_users: '',
  };
}

function AccountsTab({ labs }: { labs: PfLabSettings[] }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PfAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm, set] = useForm<AccountForm>(EMPTY_ACCOUNT);
  const [users, setUsers] = useState<PfAccount['users']>([]);
  const [removeUsers, setRemoveUsers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfAccountsList(q);
      setRows(res.data.rows || []);
    } catch (e) {
      setError(errText(e, 'Could not load accounts'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  function edit(a: PfAccount | null) {
    setForm(a ? accountToForm(a) : EMPTY_ACCOUNT);
    setUsers(a?.users || []);
    setRemoveUsers([]);
    setNotice(null);
    setError(null);
    setShowForm(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.display_name.trim()) {
      setError('Display name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.pfAccountSave({
        ...(form.name ? { name: form.name } : {}),
        display_name: form.display_name.trim(),
        account_type: form.account_type,
        status: form.status,
        mobile: form.mobile.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        lat: numOrNull(form.lat),
        lng: numOrNull(form.lng),
        default_lab: form.default_lab || null,
        franchisee: form.franchisee.trim() || null,
        referring_doctor: form.referring_doctor.trim() || null,
        doctor: form.doctor.trim() || null,
        add_users: splitList(form.add_users),
        remove_users: removeUsers,
      });
      const saved = res.data;
      setForm(accountToForm(saved));
      setUsers(saved.users || []);
      setRemoveUsers([]);
      setNotice(
        `Saved ${saved.display_name}.${
          saved.granted_role_to?.length ? ` PhleboFirst customer role granted to ${saved.granted_role_to.join(', ')}.` : ''
        }`,
      );
      await load(query.trim());
    } catch (err) {
      setError(errText(err, 'Could not save the account'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pfo-section">
      <form
        className="pfo-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load(query.trim());
        }}
      >
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search accounts…" />
        <button type="submit" className="btn secondary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button type="button" className="btn" onClick={() => edit(null)}>
          New account
        </button>
      </form>
      <Alerts error={error} notice={notice} />

      {showForm ? (
        <form className="pfo-form" onSubmit={(e) => void save(e)}>
          <h3>{form.name ? `Edit ${form.name}` : 'New account'}</h3>
          <div className="pfo-grid">
            <Field label="Display name">
              <input value={form.display_name} onChange={(e) => set('display_name', e.target.value)} required />
            </Field>
            <Field label="Account type">
              <select value={form.account_type} onChange={(e) => set('account_type', e.target.value as PfAccount['account_type'])}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => set('status', e.target.value as PfAccount['status'])}>
                <option value="Active">Active</option>
                <option value="Suspended">Suspended</option>
              </select>
            </Field>
            <Field label="Mobile">
              <input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Default lab">
              <select value={form.default_lab} onChange={(e) => set('default_lab', e.target.value)}>
                <option value="">None</option>
                {labs.map((l) => (
                  <option key={l.lab} value={l.lab}>
                    {l.lab_name || l.lab}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Address" wide>
              <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="Latitude">
              <input value={form.lat} onChange={(e) => set('lat', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Longitude">
              <input value={form.lng} onChange={(e) => set('lng', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Franchisee ID">
              <input value={form.franchisee} onChange={(e) => set('franchisee', e.target.value)} />
            </Field>
            <Field label="Referring doctor ID">
              <input value={form.referring_doctor} onChange={(e) => set('referring_doctor', e.target.value)} />
            </Field>
            <Field label="Doctor ID">
              <input value={form.doctor} onChange={(e) => set('doctor', e.target.value)} />
            </Field>
            <Field label="Add users (emails or mobiles, comma separated)" wide>
              <input value={form.add_users} onChange={(e) => set('add_users', e.target.value)} placeholder="dr.rao@example.com, 9876543210" />
            </Field>
          </div>
          {users.length ? (
            <div className="pfo-users">
              <b>Users</b>
              <ul>
                {users.map((u) => {
                  const removing = removeUsers.includes(u.user);
                  return (
                    <li key={u.user} className={removing ? 'is-removing' : ''}>
                      <span>
                        {u.full_name || u.user}
                        <small>
                          {u.user}
                          {u.account_role ? ` · ${u.account_role}` : ''}
                          {u.active ? '' : ' · inactive'}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() =>
                          setRemoveUsers((cur) => (removing ? cur.filter((x) => x !== u.user) : [...cur, u.user]))
                        }
                      >
                        {removing ? 'Undo' : 'Remove'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="pfo-form-actions">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Saving…' : 'Save account'}
            </button>
            <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>
              Close
            </button>
          </div>
        </form>
      ) : null}

      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th>Status</th>
              <th>Contact</th>
              <th>Default lab</th>
              <th>Users</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.name}>
                <td>
                  <b>{a.display_name}</b>
                  <small>{a.name}</small>
                </td>
                <td>{a.account_type}</td>
                <td>
                  <span className={`pfo-pill ${a.status === 'Active' ? 'ok' : 'bad'}`}>{a.status}</span>
                </td>
                <td>
                  {a.mobile || '—'}
                  {a.email ? <small>{a.email}</small> : null}
                </td>
                <td>{a.default_lab_name || a.default_lab || '—'}</td>
                <td>{a.users?.length ?? 0}</td>
                <td>
                  <button type="button" className="btn secondary" onClick={() => edit(a)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading ? (
              <tr>
                <td colSpan={7} className="pfo-empty">
                  No accounts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Lab settings ---------------- */

type LabForm = {
  lab: string;
  accepts_pf: boolean;
  catchment_radius_km: string;
  lat: string;
  lng: string;
  default_collection_fee: string;
  rider_payout_pct: string;
  quote_validity_hours: string;
  broadcast_radii_km: string;
  rebroadcast_minutes: string;
  sla_minutes: string;
  allow_unkitted_codes: boolean;
  lis_barcode_format: string;
  lis_prefix: string;
  api_client: string;
  outbound_webhook_url: string;
  authorisers: string;
  notes: string;
};

const EMPTY_LAB: LabForm = {
  lab: '',
  accepts_pf: true,
  catchment_radius_km: '15',
  lat: '',
  lng: '',
  default_collection_fee: '0',
  rider_payout_pct: '0',
  quote_validity_hours: '24',
  broadcast_radii_km: '5,10,20',
  rebroadcast_minutes: '10',
  sla_minutes: '120',
  allow_unkitted_codes: false,
  lis_barcode_format: '',
  lis_prefix: '',
  api_client: '',
  outbound_webhook_url: '',
  authorisers: '',
  notes: '',
};

function labToForm(s: PfLabSettings): LabForm {
  return {
    lab: s.lab,
    accepts_pf: Boolean(s.accepts_pf),
    catchment_radius_km: str(s.catchment_radius_km),
    lat: str(s.lat ?? s.lab_lat),
    lng: str(s.lng ?? s.lab_lng),
    default_collection_fee: str(s.default_collection_fee),
    rider_payout_pct: str(s.rider_payout_pct),
    quote_validity_hours: str(s.quote_validity_hours),
    broadcast_radii_km: s.broadcast_radii_km || '',
    rebroadcast_minutes: str(s.rebroadcast_minutes),
    sla_minutes: str(s.sla_minutes),
    allow_unkitted_codes: Boolean(s.allow_unkitted_codes),
    lis_barcode_format: s.lis_barcode_format || '',
    lis_prefix: s.lis_prefix || '',
    api_client: s.api_client || '',
    outbound_webhook_url: s.outbound_webhook_url || '',
    authorisers: (s.authorisers || []).join(', '),
    notes: s.notes || '',
  };
}

function LabsTab({ labs, reload, labsError }: { labs: PfLabSettings[]; reload: () => Promise<void>; labsError: string | null }) {
  const [form, setForm, set] = useForm<LabForm>(EMPTY_LAB);
  const [editing, setEditing] = useState(false);
  const [clients, setClients] = useState<ApiClientRow[]>([]);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [secret, setSecret] = useState<ApiClientSecret | null>(null);
  const [busy, setBusy] = useState<'save' | 'client' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    try {
      const res = await api.listApiClients();
      setClients(res.data.clients || []);
      setClientsError(null);
    } catch (e) {
      setClientsError(errText(e, 'Could not load API clients'));
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const labClients = clients.filter((c) => form.lab && c.linked_lab === form.lab);
  const selectedEditing = labs.find((l) => l.lab === form.lab);

  function open(s: PfLabSettings | null) {
    setForm(s ? labToForm(s) : EMPTY_LAB);
    setSecret(null);
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  async function createClient() {
    const lab = form.lab.trim();
    if (!lab) {
      setError('Enter the lab ID first.');
      return;
    }
    setBusy('client');
    setError(null);
    try {
      const res = await api.createApiClient(`${lab} converter`, 'Partner Lab', ['barcode:convert', 'barcode:webhook'], lab);
      setSecret(res.data);
      set('api_client', res.data.name);
      await loadClients();
    } catch (e) {
      setError(errText(e, 'Could not create the API client'));
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const lab = form.lab.trim();
    if (!lab) {
      setError('Lab ID is required.');
      return;
    }
    if (form.broadcast_radii_km.trim() && !/^\s*\d+(\.\d+)?(\s*,\s*\d+(\.\d+)?)*\s*$/.test(form.broadcast_radii_km)) {
      setError('Broadcast radii must be comma separated numbers, e.g. 5,10,20.');
      return;
    }
    const hook = form.outbound_webhook_url.trim();
    if (hook && !/^https:\/\//i.test(hook)) {
      setError('Outbound webhook URL must start with https://');
      return;
    }
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const res = await api.pfLabSettingsSave({
        lab,
        accepts_pf: form.accepts_pf ? 1 : 0,
        catchment_radius_km: num(form.catchment_radius_km),
        lat: numOrNull(form.lat),
        lng: numOrNull(form.lng),
        default_collection_fee: num(form.default_collection_fee),
        rider_payout_pct: num(form.rider_payout_pct),
        quote_validity_hours: num(form.quote_validity_hours),
        broadcast_radii_km: form.broadcast_radii_km.replace(/\s+/g, ''),
        rebroadcast_minutes: num(form.rebroadcast_minutes),
        sla_minutes: num(form.sla_minutes),
        allow_unkitted_codes: form.allow_unkitted_codes ? 1 : 0,
        lis_barcode_format: form.lis_barcode_format.trim() || null,
        lis_prefix: form.lis_prefix.trim() || null,
        api_client: form.api_client || null,
        outbound_webhook_url: hook || null,
        authorisers: splitList(form.authorisers),
        notes: form.notes.trim() || null,
      });
      setForm(labToForm(res.data));
      setNotice(`Saved PhleboFirst settings for ${res.data.lab_name || res.data.lab}.`);
      await reload();
    } catch (err) {
      setError(errText(err, 'Could not save lab settings'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pfo-section">
      <div className="pfo-filters">
        <button type="button" className="btn" onClick={() => open(null)}>
          Configure a lab
        </button>
        <button type="button" className="btn secondary" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      <Alerts error={error || labsError} notice={notice} />

      {editing ? (
        <form className="pfo-form" onSubmit={(e) => void save(e)}>
          <h3>{selectedEditing ? `Settings · ${selectedEditing.lab_name || selectedEditing.lab}` : 'New lab settings'}</h3>
          <div className="pfo-grid">
            <Field label="Lab ID">
              <input value={form.lab} onChange={(e) => set('lab', e.target.value)} required placeholder="Lab / company ID" />
            </Field>
            <label className="pfo-check">
              <input type="checkbox" checked={form.accepts_pf} onChange={(e) => set('accepts_pf', e.target.checked)} />
              Accepts PhleboFirst requests
            </label>
            <label className="pfo-check">
              <input type="checkbox" checked={form.allow_unkitted_codes} onChange={(e) => set('allow_unkitted_codes', e.target.checked)} />
              Allow codes not issued in a kit
            </label>
            <Field label="Catchment radius (km)">
              <input value={form.catchment_radius_km} onChange={(e) => set('catchment_radius_km', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Latitude">
              <input value={form.lat} onChange={(e) => set('lat', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Longitude">
              <input value={form.lng} onChange={(e) => set('lng', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Default collection fee (₹)">
              <input value={form.default_collection_fee} onChange={(e) => set('default_collection_fee', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Rider payout (% of fee)">
              <input value={form.rider_payout_pct} onChange={(e) => set('rider_payout_pct', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Quote validity (hours)">
              <input value={form.quote_validity_hours} onChange={(e) => set('quote_validity_hours', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Broadcast radii (km)" hint="Comma separated rings, e.g. 5,10,20">
              <input value={form.broadcast_radii_km} onChange={(e) => set('broadcast_radii_km', e.target.value)} />
            </Field>
            <Field label="Re-broadcast after (minutes)">
              <input value={form.rebroadcast_minutes} onChange={(e) => set('rebroadcast_minutes', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="SLA (minutes)">
              <input value={form.sla_minutes} onChange={(e) => set('sla_minutes', e.target.value)} inputMode="numeric" />
            </Field>
            <Field
              label="LIS barcode format"
              hint={
                <>
                  Tokens: <code>{'{prefix} {seq} {seq:8} {yyyy} {yy} {mm} {dd} {tube}'}</code>
                  {selectedEditing?.lis_next_seq != null ? ` · next seq ${selectedEditing.lis_next_seq}` : ''}
                </>
              }
            >
              <input value={form.lis_barcode_format} onChange={(e) => set('lis_barcode_format', e.target.value)} placeholder="{prefix}{yy}{mm}{seq:6}" />
            </Field>
            <Field label="LIS prefix">
              <input value={form.lis_prefix} onChange={(e) => set('lis_prefix', e.target.value)} />
            </Field>
            <Field label="Converter API client" hint={clientsError || (form.lab && !labClients.length ? 'No API client linked to this lab yet.' : undefined)}>
              <select value={form.api_client} onChange={(e) => set('api_client', e.target.value)}>
                <option value="">None</option>
                {form.api_client && !labClients.some((c) => c.name === form.api_client) ? (
                  <option value={form.api_client}>{form.api_client}</option>
                ) : null}
                {labClients.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.client_name} ({c.api_key}){c.active ? '' : ' · inactive'}
                  </option>
                ))}
              </select>
            </Field>
            <div className="pfo-field">
              <span>&nbsp;</span>
              <button type="button" className="btn secondary" disabled={busy !== null || !form.lab.trim()} onClick={() => void createClient()}>
                {busy === 'client' ? 'Creating…' : 'Create converter API client'}
              </button>
            </div>
            <Field label="Outbound webhook URL (https)" wide>
              <input
                type="url"
                value={form.outbound_webhook_url}
                onChange={(e) => set('outbound_webhook_url', e.target.value)}
                placeholder="https://lis.partner-lab.example/phlebofirst"
              />
            </Field>
            <Field label="Authorisers (emails, comma separated)" wide>
              <input value={form.authorisers} onChange={(e) => set('authorisers', e.target.value)} />
            </Field>
            <Field label="Notes" wide>
              <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>

          {secret ? (
            <div className="pfo-secret">
              <b>Copy these credentials now — the secret is shown only once.</b>
              <div className="pfo-secret-row">
                <span>API key</span>
                <code>{secret.api_key}</code>
                <button type="button" className="btn secondary" onClick={() => void navigator.clipboard?.writeText(secret.api_key)}>
                  Copy
                </button>
              </div>
              <div className="pfo-secret-row">
                <span>API secret</span>
                <code>{secret.api_secret}</code>
                <button type="button" className="btn secondary" onClick={() => void navigator.clipboard?.writeText(secret.api_secret)}>
                  Copy
                </button>
              </div>
              <small>Linked as this lab&apos;s converter client. Save the settings to keep the link.</small>
            </div>
          ) : null}

          <p className="pfo-help">
            Partner LIS integrations call <code>/api/v1/barcode/convert</code> (PF code → lab accession) and{' '}
            <code>/api/v1/barcode/webhook</code> (receipt / rejection events) with the converter client&apos;s key and secret. See{' '}
            <code>docs/PHLEBOFIRST_CONVERTER_API.md</code>.
          </p>

          <div className="pfo-form-actions">
            <button type="submit" className="btn" disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save settings'}
            </button>
            <button type="button" className="btn secondary" onClick={() => setEditing(false)}>
              Close
            </button>
          </div>
        </form>
      ) : null}

      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>Lab</th>
              <th>Accepts PF</th>
              <th>Catchment</th>
              <th>Fee / payout</th>
              <th>Broadcast</th>
              <th>SLA</th>
              <th>LIS format</th>
              <th>API client</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {labs.map((s) => (
              <tr key={s.lab}>
                <td>
                  <b>{s.lab_name || s.lab}</b>
                  <small>{s.lab}</small>
                </td>
                <td>
                  <span className={`pfo-pill ${s.accepts_pf ? 'ok' : ''}`}>{s.accepts_pf ? 'Yes' : 'No'}</span>
                </td>
                <td>{s.catchment_radius_km} km</td>
                <td>
                  {money(s.default_collection_fee)}
                  <small>{s.rider_payout_pct}% to rider</small>
                </td>
                <td>
                  {s.broadcast_radii_km || '—'} km
                  <small>every {s.rebroadcast_minutes} min</small>
                </td>
                <td>{s.sla_minutes} min</td>
                <td>
                  <code>{s.lis_barcode_format || '—'}</code>
                </td>
                <td>{s.api_client || '—'}</td>
                <td>
                  <button type="button" className="btn secondary" onClick={() => open(s)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {!labs.length ? (
              <tr>
                <td colSpan={9} className="pfo-empty">
                  No labs configured for PhleboFirst yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Drop hubs ---------------- */

type HubForm = {
  name: string;
  hub_code: string;
  hub_name: string;
  active: boolean;
  address: string;
  lat: string;
  lng: string;
  geofence_m: string;
  hours: string;
  receiving_lab: string;
  franchisee: string;
  collection_centre: string;
};

const EMPTY_HUB: HubForm = {
  name: '',
  hub_code: '',
  hub_name: '',
  active: true,
  address: '',
  lat: '',
  lng: '',
  geofence_m: '200',
  hours: '',
  receiving_lab: '',
  franchisee: '',
  collection_centre: '',
};

function hubToForm(h: PfHub): HubForm {
  return {
    name: h.name || '',
    hub_code: h.hub_code,
    hub_name: h.hub_name,
    active: h.active == null ? true : Boolean(h.active),
    address: h.address || '',
    lat: str(h.lat),
    lng: str(h.lng),
    geofence_m: str(h.geofence_m),
    hours: h.hours || '',
    receiving_lab: h.receiving_lab || '',
    franchisee: h.franchisee || '',
    collection_centre: h.collection_centre || '',
  };
}

function HubsTab({ labs, print, printing }: PrintProps & { labs: PfLabSettings[] }) {
  const [rows, setRows] = useState<PfHub[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm, set] = useForm<HubForm>(EMPTY_HUB);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfHubsList(true);
      setRows(res.data.rows || []);
    } catch (e) {
      setError(errText(e, 'Could not load hubs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function open(h: PfHub | null) {
    setForm(h ? hubToForm(h) : EMPTY_HUB);
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.hub_name.trim()) {
      setError('Hub name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.pfHubSave({
        ...(form.hub_code ? { hub_code: form.hub_code } : {}),
        ...(form.name ? { name: form.name } : {}),
        hub_name: form.hub_name.trim(),
        active: form.active ? 1 : 0,
        address: form.address.trim() || null,
        lat: numOrNull(form.lat),
        lng: numOrNull(form.lng),
        geofence_m: num(form.geofence_m, 200),
        hours: form.hours.trim() || null,
        receiving_lab: form.receiving_lab || null,
        franchisee: form.franchisee.trim() || null,
        collection_centre: form.collection_centre.trim() || null,
      });
      setForm(hubToForm(res.data));
      setNotice(`Saved hub ${res.data.hub_name} (${res.data.hub_code}).`);
      await load();
    } catch (err) {
      setError(errText(err, 'Could not save the hub'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pfo-section">
      <div className="pfo-filters">
        <button type="button" className="btn" onClick={() => open(null)}>
          New hub
        </button>
        <button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <Alerts error={error} notice={notice} />

      {editing ? (
        <form className="pfo-form" onSubmit={(e) => void save(e)}>
          <h3>{form.hub_code ? `Edit ${form.hub_code}` : 'New hub (code is generated on save)'}</h3>
          <div className="pfo-grid">
            <Field label="Hub name">
              <input value={form.hub_name} onChange={(e) => set('hub_name', e.target.value)} required />
            </Field>
            <label className="pfo-check">
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active
            </label>
            <Field label="Receiving lab">
              <select value={form.receiving_lab} onChange={(e) => set('receiving_lab', e.target.value)}>
                <option value="">None</option>
                {form.receiving_lab && !labs.some((l) => l.lab === form.receiving_lab) ? (
                  <option value={form.receiving_lab}>{form.receiving_lab}</option>
                ) : null}
                {labs.map((l) => (
                  <option key={l.lab} value={l.lab}>
                    {l.lab_name || l.lab}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Address" wide>
              <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="Latitude">
              <input value={form.lat} onChange={(e) => set('lat', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Longitude">
              <input value={form.lng} onChange={(e) => set('lng', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Geofence (m)">
              <input value={form.geofence_m} onChange={(e) => set('geofence_m', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Hours">
              <input value={form.hours} onChange={(e) => set('hours', e.target.value)} placeholder="Mon–Sat 7am–8pm" />
            </Field>
            <Field label="Franchisee ID">
              <input value={form.franchisee} onChange={(e) => set('franchisee', e.target.value)} />
            </Field>
            <Field label="Collection centre ID">
              <input value={form.collection_centre} onChange={(e) => set('collection_centre', e.target.value)} />
            </Field>
          </div>
          <div className="pfo-form-actions">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Saving…' : 'Save hub'}
            </button>
            {form.hub_code ? (
              <button type="button" className="btn secondary" disabled={printing} onClick={() => void print([form.hub_code])}>
                Print label
              </button>
            ) : null}
            <button type="button" className="btn secondary" onClick={() => setEditing(false)}>
              Close
            </button>
          </div>
        </form>
      ) : null}

      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>Hub</th>
              <th>Active</th>
              <th>Address</th>
              <th>Receiving lab</th>
              <th>Geofence</th>
              <th>Hours</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.hub_code}>
                <td>
                  <b>{h.hub_name}</b>
                  <small>{h.hub_code}</small>
                </td>
                <td>
                  <span className={`pfo-pill ${h.active ? 'ok' : ''}`}>{h.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td>
                  {h.address || '—'}
                  {h.lat != null && h.lng != null ? (
                    <small>
                      {h.lat}, {h.lng}
                    </small>
                  ) : null}
                </td>
                <td>{h.receiving_lab_name || h.receiving_lab || '—'}</td>
                <td>{h.geofence_m != null ? `${h.geofence_m} m` : '—'}</td>
                <td>{h.hours || '—'}</td>
                <td className="pfo-row-actions">
                  <button type="button" className="btn secondary" onClick={() => open(h)}>
                    Edit
                  </button>
                  <button type="button" className="btn secondary" disabled={printing} onClick={() => void print([h.hub_code])}>
                    Print label
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading ? (
              <tr>
                <td colSpan={7} className="pfo-empty">
                  No drop hubs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Barcodes ---------------- */

type BarcodeFilters = { status: string; tube_code: string; kit: string; rider: string; q: string };
const EMPTY_FILTERS: BarcodeFilters = { status: '', tube_code: '', kit: '', rider: '', q: '' };

function compactFilters(f: BarcodeFilters) {
  const out: Partial<BarcodeFilters> = {};
  (Object.keys(f) as Array<keyof BarcodeFilters>).forEach((k) => {
    const v = f[k].trim();
    if (v) out[k] = v;
  });
  return out;
}

function CodesBox({ title, codes, print, printing, onClose }: PrintProps & { title: string; codes: string[]; onClose: () => void }) {
  return (
    <div className="pfo-codes">
      <div className="pfo-codes-head">
        <b>{title}</b>
        <div className="pfo-row-actions">
          <button type="button" className="btn" disabled={printing || !codes.length} onClick={() => void print(codes)}>
            {printing ? 'Preparing…' : `Print ${codes.length} label(s)`}
          </button>
          <button type="button" className="btn secondary" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
            Copy
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
      <div className="pfo-code-list">
        {codes.map((c) => (
          <code key={c}>{c}</code>
        ))}
      </div>
    </div>
  );
}

function BarcodesTab({ print, printing }: PrintProps) {
  const { riders, error: ridersError } = useRiders();
  const [issue, , setIssue] = useForm({ tube_code: 'LAV', count: '20', kit: '', rider: '' });
  const [issued, setIssued] = useState<{ codes: string[]; tube_code: string; batch: string } | null>(null);
  const [filters, setFilters, setFilter] = useForm<BarcodeFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<BarcodeFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: PfBarcodeRow[]; total: number; counts: Record<string, number> } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfBarcodesList(compactFilters(applied), page, BARCODE_PAGE);
      setData(res.data);
    } catch (e) {
      setError(errText(e, 'Could not load barcodes'));
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issueCodes(e: FormEvent) {
    e.preventDefault();
    const count = Math.floor(num(issue.count));
    if (count < 1 || count > 500) {
      setError('Count must be between 1 and 500.');
      return;
    }
    setBusy('issue');
    setError(null);
    setNotice(null);
    try {
      const res = await api.pfIssueBarcodes(issue.tube_code, count, issue.kit.trim(), issue.rider);
      setIssued(res.data);
      setNotice(`Issued ${res.data.codes.length} ${res.data.tube_code} code(s) in batch ${res.data.batch}.`);
      await load();
    } catch (err) {
      setError(errText(err, 'Could not issue barcodes'));
    } finally {
      setBusy(null);
    }
  }

  async function voidCode(code: string) {
    const reason = window.prompt(`Reason for voiding ${code}?`);
    if (reason == null) return;
    if (reason.trim().length < 3) {
      setError('Enter a reason of at least 3 characters.');
      return;
    }
    setBusy(code);
    setError(null);
    setNotice(null);
    try {
      await api.pfVoidBarcode(code, reason.trim());
      setNotice(`${code} voided.`);
      setSelected((cur) => cur.filter((c) => c !== code));
      await load();
    } catch (err) {
      setError(errText(err, 'Could not void the code'));
    } finally {
      setBusy(null);
    }
  }

  function applyFilters(e?: FormEvent) {
    e?.preventDefault();
    setPage(1);
    setApplied({ ...filters });
  }

  function quickStatus(status: string) {
    const next = { ...filters, status };
    setFilters(next);
    setPage(1);
    setApplied(next);
  }

  const rows = data?.rows || [];
  const pageCodes = rows.map((r) => r.name);
  const allOnPage = pageCodes.length > 0 && pageCodes.every((c) => selected.includes(c));
  const pages = data ? Math.max(1, Math.ceil(data.total / BARCODE_PAGE)) : 1;

  return (
    <section className="pfo-section">
      <form className="pfo-form" onSubmit={(e) => void issueCodes(e)}>
        <h3>Issue PF barcodes</h3>
        <div className="pfo-grid">
          <Field label="Tube type">
            <select value={issue.tube_code} onChange={(e) => setIssue('tube_code', e.target.value)}>
              {TUBE_CODES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Count (1–500)">
            <input type="number" min={1} max={500} value={issue.count} onChange={(e) => setIssue('count', e.target.value)} />
          </Field>
          <Field label="Kit (optional)">
            <input value={issue.kit} onChange={(e) => setIssue('kit', e.target.value)} placeholder="KIT-…" />
          </Field>
          <Field label="Rider (optional)" hint={ridersError || undefined}>
            <select value={issue.rider} onChange={(e) => setIssue('rider', e.target.value)}>
              <option value="">Unassigned stock</option>
              {riders.map((r) => (
                <option key={r.provider || r.user} value={r.provider || ''}>
                  {riderLabel(r)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="pfo-form-actions">
          <button type="submit" className="btn" disabled={busy !== null}>
            {busy === 'issue' ? 'Issuing…' : 'Issue codes'}
          </button>
        </div>
      </form>

      <Alerts error={error} notice={notice} />

      {issued ? (
        <CodesBox
          title={`Batch ${issued.batch} · ${issued.tube_code}`}
          codes={issued.codes}
          print={print}
          printing={printing}
          onClose={() => setIssued(null)}
        />
      ) : null}

      {data ? (
        <div className="pfo-chips">
          <button type="button" className={`pfo-chip${!applied.status ? ' is-on' : ''}`} onClick={() => quickStatus('')}>
            All
          </button>
          {BARCODE_STATUSES.map((s) => (
            <button key={s} type="button" className={`pfo-chip${applied.status === s ? ' is-on' : ''}`} onClick={() => quickStatus(s)}>
              {s} <b>{data.counts[s] ?? 0}</b>
            </button>
          ))}
        </div>
      ) : null}

      <form className="pfo-filters" onSubmit={applyFilters}>
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {BARCODE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={filters.tube_code} onChange={(e) => setFilter('tube_code', e.target.value)} aria-label="Tube type">
          <option value="">Any tube</option>
          {TUBE_CODES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input value={filters.kit} onChange={(e) => setFilter('kit', e.target.value)} placeholder="Kit" aria-label="Kit" />
        <select value={filters.rider} onChange={(e) => setFilter('rider', e.target.value)} aria-label="Rider">
          <option value="">Any rider</option>
          {riders.map((r) => (
            <option key={r.provider || r.user} value={r.provider || ''}>
              {riderLabel(r)}
            </option>
          ))}
        </select>
        <input type="search" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Code, TRF, job…" />
        <button type="submit" className="btn secondary" disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={printing || !selected.length}
          onClick={() => void print(selected)}
        >
          Print selected ({selected.length})
        </button>
        {selected.length ? (
          <button type="button" className="btn secondary" onClick={() => setSelected([])}>
            Clear selection
          </button>
        ) : null}
      </form>

      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allOnPage}
                  onChange={(e) =>
                    setSelected((cur) =>
                      e.target.checked ? Array.from(new Set([...cur, ...pageCodes])) : cur.filter((c) => !pageCodes.includes(c)),
                    )
                  }
                  aria-label="Select all on this page"
                />
              </th>
              <th>Code</th>
              <th>Status</th>
              <th>Tube</th>
              <th>Kit / rider</th>
              <th>Bound to</th>
              <th>Hub</th>
              <th>Issued</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.name)}
                    onChange={(e) =>
                      setSelected((cur) => (e.target.checked ? [...cur, r.name] : cur.filter((c) => c !== r.name)))
                    }
                    aria-label={`Select ${r.name}`}
                  />
                </td>
                <td>
                  <code>{r.name}</code>
                </td>
                <td>
                  <span className={`pfo-pill b-${r.status.toLowerCase()}`}>{r.status}</span>
                </td>
                <td>{r.tube_code}</td>
                <td>
                  {r.kit || '—'}
                  {r.rider ? <small>{r.rider}</small> : null}
                </td>
                <td>
                  {r.bound_trf || r.bound_job || '—'}
                  {r.bound_on ? <small>{fmtDateTime(r.bound_on)}</small> : null}
                </td>
                <td>
                  {r.drop_hub || '—'}
                  {r.dropped_on ? <small>{fmtDateTime(r.dropped_on)}</small> : null}
                </td>
                <td>{fmtDateTime(r.issued_on)}</td>
                <td>
                  {r.status === 'Issued' ? (
                    <button type="button" className="btn secondary" disabled={busy !== null} onClick={() => void voidCode(r.name)}>
                      {busy === r.name ? 'Voiding…' : 'Void'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {data && !rows.length ? (
              <tr>
                <td colSpan={9} className="pfo-empty">
                  No barcodes match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {data && pages > 1 ? (
        <div className="pfo-pager">
          <button type="button" className="btn secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
            ‹ Prev
          </button>
          <span>
            Page {page} of {pages} · {data.total} codes
          </span>
          <button type="button" className="btn secondary" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
            Next ›
          </button>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- Kits ---------------- */

function KitsTab({ print, printing }: PrintProps) {
  const { riders, error: ridersError } = useRiders();
  const [rider, setRider] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({ LAV: '5', SST: '5', BLU: '2', GRY: '2' });
  const [notes, setNotes] = useState('');
  const [issued, setIssued] = useState<{ kit: string; rider: string; contents: Record<string, number>; codes: string[] } | null>(null);
  const [kitCodes, setKitCodes] = useState<{ kit: string; codes: string[] } | null>(null);
  const [rows, setRows] = useState<PfKitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfKitsList();
      setRows(res.data.rows || []);
    } catch (e) {
      setError(errText(e, 'Could not load kits'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function issueKit(e: FormEvent) {
    e.preventDefault();
    const tubes: Record<string, number> = {};
    for (const t of TUBE_CODES) {
      const n = Math.floor(num(counts[t] || ''));
      if (n > 0) tubes[t] = n;
    }
    if (!rider) {
      setError('Choose a rider.');
      return;
    }
    if (!Object.keys(tubes).length) {
      setError('Enter at least one tube count.');
      return;
    }
    setBusy('issue');
    setError(null);
    setNotice(null);
    try {
      const res = await api.pfIssueKit(rider, tubes, notes.trim());
      setIssued(res.data);
      setNotice(`Kit ${res.data.kit} issued with ${res.data.codes.length} labels.`);
      await load();
    } catch (err) {
      setError(errText(err, 'Could not issue the kit'));
    } finally {
      setBusy(null);
    }
  }

  async function printKit(kit: string) {
    setBusy(kit);
    setError(null);
    try {
      const res = await api.pfBarcodesList({ kit }, 1, 500);
      const codes = res.data.rows.map((r) => r.name);
      if (!codes.length) {
        setError(`Kit ${kit} has no codes.`);
        return;
      }
      setKitCodes({ kit, codes });
      await print(codes);
    } catch (err) {
      setError(errText(err, 'Could not load the kit labels'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pfo-section">
      <form className="pfo-form" onSubmit={(e) => void issueKit(e)}>
        <h3>Issue a kit to a rider</h3>
        <div className="pfo-grid">
          <Field label="Rider" hint={ridersError || (!riders.length ? 'Enable riders under the Riders tab first.' : undefined)}>
            <select value={rider} onChange={(e) => setRider(e.target.value)}>
              <option value="">Choose rider…</option>
              {riders.map((r) => (
                <option key={r.provider || r.user} value={r.provider || ''}>
                  {riderLabel(r)} · {r.unused_barcodes} unused
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="pfo-tube-counts">
          {TUBE_CODES.map((t) => (
            <label key={t}>
              <i className={`pfo-cap cap-${t}`} aria-hidden />
              {t}
              <input
                type="number"
                min={0}
                max={200}
                value={counts[t] ?? ''}
                onChange={(e) => setCounts((cur) => ({ ...cur, [t]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="pfo-form-actions">
          <button type="submit" className="btn" disabled={busy !== null}>
            {busy === 'issue' ? 'Issuing…' : 'Issue kit'}
          </button>
        </div>
      </form>

      <Alerts error={error} notice={notice} />

      {issued ? (
        <CodesBox
          title={`Kit ${issued.kit} · ${Object.entries(issued.contents)
            .map(([t, n]) => `${t}×${n}`)
            .join(', ')}`}
          codes={issued.codes}
          print={print}
          printing={printing}
          onClose={() => setIssued(null)}
        />
      ) : null}
      {kitCodes && kitCodes.kit !== issued?.kit ? (
        <CodesBox title={`Kit ${kitCodes.kit}`} codes={kitCodes.codes} print={print} printing={printing} onClose={() => setKitCodes(null)} />
      ) : null}

      <div className="pfo-filters">
        <button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading…' : 'Refresh kits'}
        </button>
      </div>
      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>Kit</th>
              <th>Rider</th>
              <th>Status</th>
              <th>Contents</th>
              <th>Unused</th>
              <th>Issued</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.name}>
                <td>
                  <code>{k.name}</code>
                </td>
                <td>
                  {k.rider_name || k.rider || '—'}
                  {k.rider_name && k.rider ? <small>{k.rider}</small> : null}
                </td>
                <td>
                  <span className="pfo-pill">{k.status}</span>
                </td>
                <td>
                  {Object.entries(k.contents || {})
                    .map(([t, n]) => `${t}×${n}`)
                    .join(', ') || '—'}
                </td>
                <td>{k.unused}</td>
                <td>{fmtDateTime(k.issued_on)}</td>
                <td>
                  <button type="button" className="btn secondary" disabled={busy !== null || printing} onClick={() => void printKit(k.name)}>
                    {busy === k.name ? 'Loading…' : 'Print kit labels'}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading ? (
              <tr>
                <td colSpan={7} className="pfo-empty">
                  No kits issued yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Riders ---------------- */

type RiderDraft = { home_lat: string; home_lng: string; radius: string; mobile: string };

function RidersTab() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PfRiderRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RiderDraft>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfRidersList(q);
      setRows(res.data.rows || []);
    } catch (e) {
      setError(errText(e, 'Could not load riders'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  function draftFor(r: PfRiderRow): RiderDraft {
    return (
      drafts[r.user] ?? {
        home_lat: str(r.home_lat),
        home_lng: str(r.home_lng),
        radius: str(r.service_radius_km),
        mobile: r.mobile || '',
      }
    );
  }

  function setDraft(r: PfRiderRow, key: keyof RiderDraft, value: string) {
    setDrafts((cur) => ({ ...cur, [r.user]: { ...draftFor(r), [key]: value } }));
  }

  async function toggle(r: PfRiderRow, enable: boolean) {
    const d = draftFor(r);
    setBusy(r.user);
    setError(null);
    setNotice(null);
    try {
      await api.pfRiderEnable(
        r.user,
        enable,
        enable
          ? {
              home_lat: numOrNull(d.home_lat),
              home_lng: numOrNull(d.home_lng),
              service_radius_km: numOrNull(d.radius),
              mobile: d.mobile.trim(),
            }
          : {},
      );
      setNotice(`${r.full_name || r.user} ${enable ? 'enabled' : 'disabled'} for PhleboFirst.`);
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[r.user];
        return next;
      });
      await load(query.trim());
    } catch (e) {
      setError(errText(e, 'Could not update the rider'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pfo-section">
      <form
        className="pfo-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load(query.trim());
        }}
      >
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search phlebotomists…" />
        <button type="submit" className="btn secondary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      <Alerts error={error} notice={notice} />
      <div className="pfo-table-wrap">
        <table className="pfo-table">
          <thead>
            <tr>
              <th>Phlebotomist</th>
              <th>Provider</th>
              <th>PF rider</th>
              <th>Home lat</th>
              <th>Home lng</th>
              <th>Radius km</th>
              <th>Mobile</th>
              <th>Active jobs</th>
              <th>Unused codes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = draftFor(r);
              return (
                <tr key={r.user}>
                  <td>
                    <b>{r.full_name || r.user}</b>
                    <small>{r.user}</small>
                  </td>
                  <td>
                    {r.provider || '—'}
                    {r.status ? <small>{r.status}</small> : null}
                  </td>
                  <td>
                    <span className={`pfo-pill ${r.is_rider ? 'ok' : ''}`}>{r.is_rider ? 'Enabled' : 'Off'}</span>
                  </td>
                  <td>
                    <input className="pfo-cell-input" value={d.home_lat} onChange={(e) => setDraft(r, 'home_lat', e.target.value)} inputMode="decimal" />
                  </td>
                  <td>
                    <input className="pfo-cell-input" value={d.home_lng} onChange={(e) => setDraft(r, 'home_lng', e.target.value)} inputMode="decimal" />
                  </td>
                  <td>
                    <input className="pfo-cell-input sm" value={d.radius} onChange={(e) => setDraft(r, 'radius', e.target.value)} inputMode="decimal" />
                  </td>
                  <td>
                    <input className="pfo-cell-input" value={d.mobile} onChange={(e) => setDraft(r, 'mobile', e.target.value)} inputMode="tel" />
                  </td>
                  <td>{r.active_jobs}</td>
                  <td>{r.unused_barcodes}</td>
                  <td className="pfo-row-actions">
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => void toggle(r, true)}>
                      {busy === r.user ? '…' : r.is_rider ? 'Update' : 'Enable'}
                    </button>
                    {r.is_rider ? (
                      <button type="button" className="btn secondary" disabled={busy !== null} onClick={() => void toggle(r, false)}>
                        Disable
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading ? (
              <tr>
                <td colSpan={10} className="pfo-empty">
                  No phlebotomists found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Page ---------------- */

export function PfOpsPage() {
  const [tab, setTab] = useState<Tab>('jobs');
  const [fmt, setFmt] = useState<LabelFormat>('pdf');
  const [size, setSize] = useState('50x25');
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [labs, setLabs] = useState<PfLabSettings[]>([]);
  const [labsError, setLabsError] = useState<string | null>(null);

  const loadLabs = useCallback(async () => {
    try {
      const res = await api.pfLabSettingsList();
      setLabs(res.data.rows || []);
      setLabsError(null);
    } catch (e) {
      setLabsError(errText(e, 'Could not load lab settings'));
    }
  }, []);

  useEffect(() => {
    void loadLabs();
  }, [loadLabs]);

  const print = useCallback<Printer>(
    async (codes) => {
      if (!codes.length) return;
      setPrinting(true);
      setPrintError(null);
      try {
        const res = await api.pfPrintCodes(codes, fmt, size);
        deliverLabels(res.data);
      } catch (e) {
        setPrintError(errText(e, 'Could not generate labels'));
      } finally {
        setPrinting(false);
      }
    },
    [fmt, size],
  );

  const showPrinter = tab === 'hubs' || tab === 'barcodes' || tab === 'kits';

  return (
    <div className="pfo-page">
      <header className="pfo-head">
        <div>
          <h1>PhleboFirst operations</h1>
          <p>Jobs, requests, partner accounts, lab rules, drop hubs, barcode stock and riders for the PhleboFirst network.</p>
        </div>
        {showPrinter ? (
          <div className="pfo-printer">
            <label>
              Label format
              <select value={fmt} onChange={(e) => setFmt(e.target.value as LabelFormat)}>
                <option value="pdf">PDF</option>
                <option value="zpl">ZPL (Zebra)</option>
                <option value="tspl">TSPL (TSC)</option>
              </select>
            </label>
            <label>
              Size (mm)
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                {LABEL_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {printing ? <span className="muted">Preparing labels…</span> : null}
          </div>
        ) : null}
      </header>

      {printError ? <div className="error">{printError}</div> : null}

      <nav className="pfo-tabs" aria-label="PhleboFirst operations sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={`pfo-tab${tab === key ? ' is-on' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'jobs' ? <JobsTab /> : null}
      {tab === 'requests' ? <RequestsTab labs={labs} /> : null}
      {tab === 'accounts' ? <AccountsTab labs={labs} /> : null}
      {tab === 'labs' ? <LabsTab labs={labs} reload={loadLabs} labsError={labsError} /> : null}
      {tab === 'hubs' ? <HubsTab labs={labs} print={print} printing={printing} /> : null}
      {tab === 'barcodes' ? <BarcodesTab print={print} printing={printing} /> : null}
      {tab === 'kits' ? <KitsTab print={print} printing={printing} /> : null}
      {tab === 'riders' ? <RidersTab /> : null}
    </div>
  );
}
