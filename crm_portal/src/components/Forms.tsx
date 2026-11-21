import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AESTHETIC_BRANCHES,
  CARE_BRANCHES,
  FOLLOW_UP_TYPES,
  FRANCHISE_UNITS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  WINGS,
  executiveCodeFromName,
  formatCrmTagNote,
  makeTrackingTag,
  nextId,
  type CrmActivity,
  type CrmLead,
  type FollowUpType,
  type LeadSource,
  type LeadStatus,
  type WingId,
} from '../data';
import {
  assignCrmLeadToReach,
  createAestheticBooking,
  createCareBooking,
  createPartnerUnitBooking,
  createRfmsLead,
  getCrmReachLead,
  listAestheticBranches,
  listCareBranches,
  listCareDoctors,
  listCarePhysios,
  listCrmPortalAssignees,
  listCrmReachReps,
  syncCrmLeadStatusToReach,
  type CareDoctor,
  type ClinicBranch,
  type ReachRep,
} from '../crmApi';
import { useCrm } from '../store';
import { Field, Modal } from './ui';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextSlot() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + ((30 - (d.getMinutes() % 30)) % 30 || 30), 0, 0);
  return d.toTimeString().slice(0, 5);
}

export function AddLeadModal({ onClose }: { onClose: () => void }) {
  const crm = useCrm();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    email: '',
    wing: 'aesthetic' as WingId,
    source: 'Telecaller' as LeadSource,
    city: '',
    notes: '',
    franchiseModel: '' as '' | 'FOFO' | 'FOCO',
    territory: '',
    pushRfms: true,
  });

  const set =
    (key: keyof typeof form) =>
    (e: { target: { value: string; checked?: boolean; type?: string } }) => {
      if (key === 'pushRfms') {
        setForm((f) => ({ ...f, pushRfms: Boolean(e.target.checked) }));
        return;
      }
      const value = e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
    };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(mobile)) {
      crm.pushToast('Enter a valid 10-digit mobile number', 'err');
      return;
    }
    setBusy(true);
    let rfmsLeadId = '';
    if (form.wing === 'franchise' && form.pushRfms) {
      if (!form.email || !form.franchiseModel || !form.territory.trim()) {
        crm.pushToast('Franchise leads need email, FOFO/FOCO and territory for FFMS/RFMS', 'err');
        setBusy(false);
        return;
      }
      try {
        const res = await createRfmsLead({
          name: form.name.trim(),
          email: form.email.trim(),
          mobile,
          franchise_model: form.franchiseModel,
          territory_query: form.territory.trim(),
          notes: form.notes.trim() || 'Added by Smilecure CRM telecaller',
        });
        rfmsLeadId = res.leadId;
        crm.pushToast(res.message);
      } catch (err) {
        crm.pushToast(err instanceof Error ? err.message : 'FFMS/RFMS lead failed', 'err');
        setBusy(false);
        return;
      }
    }
    const lead = crm.addLead({
      name: form.name.trim(),
      mobile,
      email: form.email.trim(),
      wing: form.wing,
      source: form.source,
      status: 'New',
      owner: crm.userName,
      city: form.city.trim(),
      notes: form.notes.trim(),
      franchiseModel: form.franchiseModel,
      territory: form.territory.trim(),
      rfmsLeadId,
    });
    if (form.wing === 'franchise') {
      crm.addDeal({
        title: `${form.franchiseModel || 'Franchise'} — ${lead.name}`,
        leadId: lead.id,
        wing: 'franchise',
        stage: 'Opportunity Created',
        value: form.franchiseModel === 'FOCO' ? 350000 : 550000,
        owner: crm.userName,
        closeDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      });
      crm.addActivity({
        type: 'Franchise',
        title: `Follow up franchise lead — ${lead.name}`,
        leadName: lead.name,
        wing: 'franchise',
        dueAt: new Date(Date.now() + 2 * 3600000).toISOString(),
        done: false,
        owner: crm.userName,
      });
    }
    if (!rfmsLeadId) crm.pushToast(`Lead ${lead.id} created`);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      title="Add Lead"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-lead-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save Lead'}
          </button>
        </>
      }
    >
      <form id="add-lead-form" className="form-grid" onSubmit={submit}>
        <Field label="Full name *">
          <input value={form.name} onChange={set('name')} required autoFocus placeholder="Lead name" />
        </Field>
        <Field label="Mobile *">
          <input value={form.mobile} onChange={set('mobile')} required inputMode="tel" placeholder="10-digit mobile" />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={set('email')} placeholder="email@example.com" />
        </Field>
        <Field label="City">
          <input value={form.city} onChange={set('city')} placeholder="City / locality" />
        </Field>
        <Field label="Business wing *">
          <select value={form.wing} onChange={set('wing')}>
            {WINGS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <select value={form.source} onChange={set('source')}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        {form.wing === 'franchise' ? (
          <>
            <Field label="Franchise model *">
              <select value={form.franchiseModel} onChange={set('franchiseModel')} required>
                <option value="">Select FOFO / FOCO</option>
                <option value="FOFO">FOFO</option>
                <option value="FOCO">FOCO</option>
              </select>
            </Field>
            <Field label="Preferred territory *">
              <input value={form.territory} onChange={set('territory')} required placeholder="e.g. North 24 Parganas" />
            </Field>
            <Field label="Push to FFMS / RFMS" span={2}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <input type="checkbox" checked={form.pushRfms} onChange={set('pushRfms')} />
                Create lead in franchise admin CRM (FFMS/RFMS)
              </label>
            </Field>
          </>
        ) : null}
        <Field label="Notes" span={2}>
          <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Call notes, interest, budget…" />
        </Field>
      </form>
    </Modal>
  );
}

export function EditLeadModal({ lead, onClose }: { lead: CrmLead; onClose: () => void }) {
  const crm = useCrm();
  const owners = useMemo(() => {
    const set = new Set<string>([crm.userName, ...crm.leads.map((l) => l.owner)].filter(Boolean));
    return Array.from(set);
  }, [crm.leads, crm.userName]);

  const [busy, setBusy] = useState(false);
  const [logNote, setLogNote] = useState('');
  const [form, setForm] = useState({
    name: lead.name,
    mobile: lead.mobile,
    email: lead.email || '',
    city: lead.city || '',
    wing: lead.wing,
    source: lead.source,
    status: lead.status,
    owner: lead.owner,
    notes: lead.notes || '',
    value: lead.value != null ? String(lead.value) : '',
    nextFollowUp: lead.nextFollowUp ? lead.nextFollowUp.slice(0, 16) : '',
    franchiseModel: (lead.franchiseModel || '') as '' | 'FOFO' | 'FOCO',
    territory: lead.territory || '',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const quickStatus = (status: LeadStatus) => {
    crm.updateLead(lead.id, { status }, `Quick status → ${status}`);
    if (status === 'Won' || status === 'Qualified') {
      crm.addActivity({
        type: 'Follow-up',
        title: `${status}: follow up — ${lead.name}`,
        leadName: lead.name,
        wing: lead.wing,
        dueAt: new Date(Date.now() + 24 * 3600000).toISOString(),
        done: false,
        owner: crm.userName,
      });
    }
    crm.pushToast(`${lead.id} marked ${status}`);
    setForm((f) => ({ ...f, status }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(mobile)) {
      crm.pushToast('Enter a valid 10-digit mobile number', 'err');
      return;
    }
    setBusy(true);
    const patch: Partial<CrmLead> = {
      name: form.name.trim(),
      mobile,
      email: form.email.trim(),
      city: form.city.trim(),
      wing: form.wing,
      source: form.source,
      status: form.status as LeadStatus,
      owner: form.owner.trim() || crm.userName,
      notes: form.notes.trim(),
      value: form.value ? Number(form.value) || undefined : undefined,
      nextFollowUp: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : undefined,
      franchiseModel: form.wing === 'franchise' ? form.franchiseModel : '',
      territory: form.wing === 'franchise' ? form.territory.trim() : '',
    };
    crm.updateLead(lead.id, patch, logNote.trim() || undefined);
    if (form.nextFollowUp) {
      crm.addActivity({
        type: 'Follow-up',
        title: `Follow up — ${patch.name}`,
        leadName: patch.name || lead.name,
        wing: patch.wing || lead.wing,
        dueAt: new Date(form.nextFollowUp).toISOString(),
        done: false,
        owner: patch.owner || crm.userName,
      });
    }
    crm.pushToast(`${lead.id} updated`);
    setBusy(false);
    onClose();
  };

  const history = lead.history || [];

  return (
    <Modal
      title={`Manage lead · ${lead.id}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="submit" form="edit-lead-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Update lead'}
          </button>
        </>
      }
    >
      <div className="chip-row" style={{ marginBottom: 4 }}>
        {LEAD_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${form.status === s ? ' active' : ''}`}
            onClick={() => quickStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <form id="edit-lead-form" className="form-grid" onSubmit={submit}>
        <Field label="Full name *">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Mobile *">
          <input value={form.mobile} onChange={set('mobile')} required inputMode="tel" />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="City">
          <input value={form.city} onChange={set('city')} />
        </Field>
        <Field label="Business wing *">
          <select value={form.wing} onChange={set('wing')}>
            {WINGS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <select value={form.source} onChange={set('source')}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {!LEAD_SOURCES.includes(form.source as LeadSource) ? <option value={form.source}>{form.source}</option> : null}
          </select>
        </Field>
        <Field label="Status *">
          <select value={form.status} onChange={set('status')}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner *">
          <input list="crm-owners" value={form.owner} onChange={set('owner')} required />
          <datalist id="crm-owners">
            {owners.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </Field>
        <Field label="Deal value (₹)">
          <input type="number" min={0} value={form.value} onChange={set('value')} placeholder="Optional" />
        </Field>
        <Field label="Next follow-up">
          <input type="datetime-local" value={form.nextFollowUp} onChange={set('nextFollowUp')} />
        </Field>
        {form.wing === 'franchise' ? (
          <>
            <Field label="Franchise model">
              <select value={form.franchiseModel} onChange={set('franchiseModel')}>
                <option value="">Select</option>
                <option value="FOFO">FOFO</option>
                <option value="FOCO">FOCO</option>
              </select>
            </Field>
            <Field label="Territory">
              <input value={form.territory} onChange={set('territory')} />
            </Field>
          </>
        ) : null}
        <Field label="Notes" span={2}>
          <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Latest call notes, interest, objections…" />
        </Field>
        <Field label="Update log (optional)" span={2}>
          <input value={logNote} onChange={(e) => setLogNote(e.target.value)} placeholder="e.g. Called — interested in HydraFacial package" />
        </Field>
      </form>
      <div className="card" style={{ boxShadow: 'none', padding: '12px 0 0', border: 0 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Activity history</h3>
        {history.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.82rem' }}>No updates logged yet.</p>
        ) : (
          <div className="timeline">
            {history.slice(0, 8).map((h, i) => (
              <div key={`${h.at}-${i}`} className="tl-item">
                <span>
                  {new Date(h.at).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · {h.actor}
                </span>
                <strong>{h.message}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ScheduleFollowUpForm({
  initial,
  onClose,
  formId = 'schedule-fu-form',
  lockedLead,
  compact,
}: {
  initial?: CrmActivity | null;
  onClose: () => void;
  formId?: string;
  lockedLead?: CrmLead | null;
  compact?: boolean;
}) {
  const crm = useCrm();
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState({
    leadId: lockedLead?.id || initial?.leadId || '',
    leadName: lockedLead?.name || initial?.leadName || '',
    mobile: lockedLead?.mobile || initial?.mobile || '',
    wing: (lockedLead?.wing || initial?.wing || 'aesthetic') as WingId,
    branch: lockedLead?.city || initial?.branch || '',
    type: (initial?.type && FOLLOW_UP_TYPES.includes(initial.type as FollowUpType)
      ? initial.type
      : 'Call') as FollowUpType,
    dueAt: initial?.dueAt
      ? initial.dueAt.slice(0, 16)
      : lockedLead?.nextFollowUp
        ? lockedLead.nextFollowUp.slice(0, 16)
        : `${today()}T${nextSlot()}`,
    owner: initial?.owner || crm.userName,
    notes: initial?.notes || '',
    leadStage: lockedLead?.status || initial?.leadStage || 'New',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const pickLead = (id: string) => {
    const lead = crm.leads.find((l) => l.id === id);
    if (!lead) {
      setForm((f) => ({ ...f, leadId: id }));
      return;
    }
    setForm((f) => ({
      ...f,
      leadId: lead.id,
      leadName: lead.name,
      mobile: lead.mobile,
      wing: lead.wing,
      leadStage: lead.status,
      branch: lead.city || f.branch,
    }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.leadName.trim()) {
      crm.pushToast('Enter lead / patient name', 'err');
      return;
    }
    const dueAt = new Date(form.dueAt).toISOString();
    const payload = {
      type: form.type,
      title: `${form.type} — ${form.leadName.trim()}`,
      leadName: form.leadName.trim(),
      leadId: form.leadId || undefined,
      mobile: form.mobile.replace(/\D/g, '').slice(-10) || undefined,
      wing: form.wing,
      branch: form.branch.trim() || undefined,
      dueAt,
      done: false,
      owner: form.owner.trim() || crm.userName,
      notes: form.notes.trim(),
      leadStage: form.leadStage,
    };
    if (editing && initial) {
      crm.updateActivity(initial.id, payload);
      crm.pushToast(`Follow-up ${initial.id} updated`);
    } else {
      const created = crm.addActivity(payload);
      crm.pushToast(`Follow-up ${created.id} scheduled`);
    }
    if (form.leadId) {
      crm.updateLead(form.leadId, { nextFollowUp: dueAt }, `Follow-up scheduled (${form.type})`);
    }
    onClose();
  };

  const branchOptions =
    form.wing === 'care'
      ? CARE_BRANCHES
      : form.wing === 'aesthetic'
        ? AESTHETIC_BRANCHES
        : form.wing === 'franchise'
          ? ['Bongaon', 'Barasat', 'Hasnabad']
          : ['Central Hub', 'Barasat', 'Howrah'];

  return (
    <form id={formId} className={`form-grid${compact ? ' form-grid-compact' : ''}`} onSubmit={submit}>
      {!lockedLead ? (
        <Field label="Link to lead">
          <select value={form.leadId} onChange={(e) => pickLead(e.target.value)}>
            <option value="">Manual entry</option>
            {crm.leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id} · {l.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Follow-up type *">
        <select value={form.type} onChange={set('type')}>
          {FOLLOW_UP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      {!lockedLead ? (
        <>
          <Field label="Lead / patient name *">
            <input value={form.leadName} onChange={set('leadName')} required autoFocus placeholder="Full name" />
          </Field>
          <Field label="Mobile">
            <input value={form.mobile} onChange={set('mobile')} inputMode="tel" placeholder="10-digit mobile" />
          </Field>
          <Field label="Business wing *">
            <select value={form.wing} onChange={set('wing')}>
              {WINGS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      <Field label="Branch">
        <select value={form.branch} onChange={set('branch')}>
          <option value="">Select branch</option>
          {branchOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Date & time *">
        <input type="datetime-local" value={form.dueAt} onChange={set('dueAt')} required autoFocus={Boolean(lockedLead)} />
      </Field>
      <Field label="Assigned to *">
        <input value={form.owner} onChange={set('owner')} required />
      </Field>
      <Field label="Lead stage">
        <select value={form.leadStage} onChange={set('leadStage')}>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes" span={compact ? undefined : 2}>
        <textarea rows={compact ? 2 : 3} value={form.notes} onChange={set('notes')} placeholder="Purpose of this follow-up…" />
      </Field>
    </form>
  );
}

export function ScheduleFollowUpModal({
  initial,
  onClose,
}: {
  initial?: CrmActivity | null;
  onClose: () => void;
}) {
  const editing = Boolean(initial?.id);
  return (
    <Modal
      title={editing ? `Edit follow-up · ${initial?.id}` : 'Schedule Follow-up'}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="schedule-fu-form" className="btn btn-primary">
            {editing ? 'Save changes' : 'Schedule'}
          </button>
        </>
      }
    >
      <ScheduleFollowUpForm initial={initial} onClose={onClose} />
    </Modal>
  );
}

const CONTACT_ROLES = [
  'Patient',
  'Lead',
  'Referring Doctor',
  'Franchise Applicant',
  'Clinic Contact',
  'Corporate Contact',
  'Partner Contact',
  'Other',
];

export function AddContactModal({ onClose }: { onClose: () => void }) {
  const crm = useCrm();
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    email: '',
    wing: 'aesthetic' as WingId,
    role: 'Patient',
    account: '',
    owner: crm.userName,
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!form.name.trim()) {
      crm.pushToast('Enter contact name', 'err');
      return;
    }
    if (!/^\d{10}$/.test(mobile)) {
      crm.pushToast('Enter a valid 10-digit mobile number', 'err');
      return;
    }
    const contact = crm.addContact({
      name: form.name.trim(),
      mobile,
      email: form.email.trim(),
      wing: form.wing,
      role: form.role,
      account: form.account.trim() || undefined,
      owner: form.owner.trim() || crm.userName,
    });
    crm.pushToast(`Contact ${contact.id} added`);
    onClose();
  };

  return (
    <Modal
      title="Add Contact"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-contact-form" className="btn btn-primary">
            Save contact
          </button>
        </>
      }
    >
      <form id="add-contact-form" className="form-grid" onSubmit={submit}>
        <Field label="Full name *">
          <input value={form.name} onChange={set('name')} required autoFocus placeholder="Contact name" />
        </Field>
        <Field label="Mobile *">
          <input value={form.mobile} onChange={set('mobile')} inputMode="tel" required placeholder="10-digit mobile" />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={set('email')} placeholder="email@example.com" />
        </Field>
        <Field label="Business wing *">
          <select value={form.wing} onChange={set('wing')}>
            {WINGS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role">
          <select value={form.role} onChange={set('role')}>
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Account / organization">
          <input value={form.account} onChange={set('account')} placeholder="Clinic, hub or company" />
        </Field>
        <Field label="Owner *" span={2}>
          <input value={form.owner} onChange={set('owner')} required />
        </Field>
      </form>
    </Modal>
  );
}

function parseContactCsv(text: string) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        q = !q;
        continue;
      }
      if (ch === ',' && !q) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const idx = (names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iName = idx(['name', 'full_name', 'contact_name']);
  const iMobile = idx(['mobile', 'phone', 'contact', 'mobile_no']);
  const iEmail = idx(['email', 'email_id']);
  const iWing = idx(['wing', 'business_wing']);
  const iRole = idx(['role', 'designation']);
  const iAccount = idx(['account', 'organization', 'org']);
  const iOwner = idx(['owner', 'assigned_to']);
  if (iName < 0 || iMobile < 0) return [];

  const wingMap: Record<string, WingId> = {
    lab: 'lab',
    aesthetic: 'aesthetic',
    care: 'care',
    nexilab: 'nexilab',
    franchise: 'franchise',
    'remedium lab': 'lab',
    'remedium aesthetic': 'aesthetic',
    'remedium care': 'care',
  };

  return lines.slice(1).map((line) => {
    const cells = split(line);
    const wingRaw = (iWing >= 0 ? cells[iWing] : 'lab').toLowerCase();
    return {
      name: cells[iName] || '',
      mobile: cells[iMobile] || '',
      email: iEmail >= 0 ? cells[iEmail] || '' : '',
      wing: (wingMap[wingRaw] || 'lab') as WingId,
      role: iRole >= 0 ? cells[iRole] || 'Contact' : 'Contact',
      account: iAccount >= 0 ? cells[iAccount] || undefined : undefined,
      owner: iOwner >= 0 ? cells[iOwner] || undefined : undefined,
    };
  });
}

function parseCsvLines(text: string) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { headers: [] as string[], rows: [] as string[][] };
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        q = !q;
        continue;
      }
      if (ch === ',' && !q) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function wingFromCsv(raw: string): WingId {
  const key = raw.toLowerCase().trim();
  const wingMap: Record<string, WingId> = {
    lab: 'lab',
    aesthetic: 'aesthetic',
    care: 'care',
    nexilab: 'nexilab',
    franchise: 'franchise',
    'remedium lab': 'lab',
    'remedium aesthetic': 'aesthetic',
    'remedium care': 'care',
  };
  return wingMap[key] || 'lab';
}

function parseLeadCsv(text: string) {
  const { headers, rows } = parseCsvLines(text);
  if (!headers.length) return [];
  const idx = (names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iName = idx(['name', 'full_name', 'lead_name']);
  const iMobile = idx(['mobile', 'phone', 'contact', 'mobile_no']);
  const iEmail = idx(['email', 'email_id']);
  const iWing = idx(['wing', 'business_wing']);
  const iSource = idx(['source', 'lead_source']);
  const iStatus = idx(['status', 'stage', 'lead_status']);
  const iCity = idx(['city', 'location', 'branch']);
  const iOwner = idx(['owner', 'assigned_to']);
  const iNotes = idx(['notes', 'remark', 'comments']);
  const iValue = idx(['value', 'deal_value', 'amount']);
  if (iName < 0 || iMobile < 0) return [];

  return rows.map((cells) => {
    const statusRaw = iStatus >= 0 ? cells[iStatus] || 'New' : 'New';
    const status = (LEAD_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as (typeof LEAD_STATUSES)[number]) : 'New';
    const sourceRaw = iSource >= 0 ? cells[iSource] || 'Telecaller' : 'Telecaller';
    const valueRaw = iValue >= 0 ? Number(String(cells[iValue] || '').replace(/,/g, '')) : undefined;
    return {
      name: cells[iName] || '',
      mobile: cells[iMobile] || '',
      email: iEmail >= 0 ? cells[iEmail] || '' : '',
      wing: wingFromCsv(iWing >= 0 ? cells[iWing] || 'lab' : 'lab'),
      source: sourceRaw,
      status,
      city: iCity >= 0 ? cells[iCity] || undefined : undefined,
      owner: iOwner >= 0 ? cells[iOwner] || undefined : undefined,
      notes: iNotes >= 0 ? cells[iNotes] || undefined : undefined,
      value: valueRaw !== undefined && Number.isFinite(valueRaw) ? valueRaw : undefined,
    };
  });
}

export function ImportLeadsModal({ onClose }: { onClose: () => void }) {
  const crm = useCrm();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ReturnType<typeof parseLeadCsv>>([]);
  const [error, setError] = useState('');

  const onFile = async (file: File | null) => {
    setError('');
    setRows([]);
    setFileName(file?.name || '');
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Upload a .csv file');
      return;
    }
    const text = await file.text();
    const parsed = parseLeadCsv(text);
    if (!parsed.length) {
      setError('Could not read rows. Use headers: name, mobile, email, wing, source, status, city, owner, notes, value');
      return;
    }
    setRows(parsed);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!rows.length) {
      crm.pushToast('Choose a CSV file first', 'err');
      return;
    }
    const { added, skipped } = crm.importLeads(rows);
    crm.pushToast(`Imported ${added} lead${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped` : ''}`);
    onClose();
  };

  const sampleCsv = `name,mobile,email,wing,source,status,city,owner,notes,value
Riya Sen,9876501234,riya.sen@example.com,aesthetic,Meta Ads,New,Barasat,Snehasish Ganguly,HydraFacial interest,45000
Amit Pal,9830012345,amit.pal@example.com,lab,Website,Qualified,Kolkata,Priya Sen,Corporate package,18500`;

  return (
    <Modal
      title="Import Leads"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="import-leads-form" className="btn btn-primary" disabled={!rows.length}>
            Import {rows.length ? `(${rows.length})` : ''}
          </button>
        </>
      }
    >
      <form id="import-leads-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
          Upload a CSV with columns <code>name, mobile, email, wing, source, status, city, owner, notes, value</code>. Duplicate name + mobile rows are skipped.
        </p>
        <label className="field">
          <span>CSV file *</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] || null)} />
        </label>
        {fileName ? (
          <p style={{ margin: 0, fontSize: '0.82rem' }}>
            Selected: <strong>{fileName}</strong>
            {rows.length ? ` · ${rows.length} rows ready` : ''}
          </p>
        ) : null}
        {error ? <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p> : null}
        {rows.length ? (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Wing</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={`${r.mobile}-${i}`}>
                    <td>{r.name}</td>
                    <td>{r.mobile}</td>
                    <td>{r.wing}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'leads-import-sample.csv';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download sample CSV
        </button>
      </form>
    </Modal>
  );
}

export function ImportContactsModal({ onClose }: { onClose: () => void }) {
  const crm = useCrm();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ReturnType<typeof parseContactCsv>>([]);
  const [error, setError] = useState('');

  const onFile = async (file: File | null) => {
    setError('');
    setRows([]);
    setFileName(file?.name || '');
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Upload a .csv file');
      return;
    }
    const text = await file.text();
    const parsed = parseContactCsv(text);
    if (!parsed.length) {
      setError('Could not read rows. Use headers: name, mobile, email, wing, role, account, owner');
      return;
    }
    setRows(parsed);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!rows.length) {
      crm.pushToast('Choose a CSV file first', 'err');
      return;
    }
    const { added, skipped } = crm.importContacts(rows);
    crm.pushToast(`Imported ${added} contact${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped` : ''}`);
    onClose();
  };

  const sampleCsv = `name,mobile,email,wing,role,account,owner
Riya Sen,9876501234,riya.sen@example.com,aesthetic,Patient,Riya Sen,Snehasish Ganguly
Dr. Pal,9830012345,pal@clinic.in,lab,Referring Doctor,Pal Clinic,Priya Sen`;

  return (
    <Modal
      title="Import Contacts"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="import-contacts-form" className="btn btn-primary" disabled={!rows.length}>
            Import {rows.length ? `(${rows.length})` : ''}
          </button>
        </>
      }
    >
      <form id="import-contacts-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
          Upload a CSV with columns <code>name, mobile, email, wing, role, account, owner</code>. Duplicate name + mobile rows are skipped.
        </p>
        <label className="field">
          <span>CSV file *</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
        </label>
        {fileName ? (
          <p style={{ margin: 0, fontSize: '0.82rem' }}>
            Selected: <strong>{fileName}</strong>
            {rows.length ? ` · ${rows.length} rows ready` : ''}
          </p>
        ) : null}
        {error ? <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p> : null}
        {rows.length ? (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Wing</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={`${r.mobile}-${i}`}>
                    <td>{r.name}</td>
                    <td>{r.mobile}</td>
                    <td>{r.wing}</td>
                    <td>{r.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'contacts-import-sample.csv';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download sample CSV
        </button>
      </form>
    </Modal>
  );
}

export function TransferOwnershipModal({
  onClose,
  presetLeadIds,
  presetActivityIds,
  defaultScope = 'both',
}: {
  onClose: () => void;
  presetLeadIds?: string[];
  presetActivityIds?: string[];
  defaultScope?: 'leads' | 'followups' | 'both';
}) {
  const crm = useCrm();
  const [portalOwners, setPortalOwners] = useState<string[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(true);
  const [ownersError, setOwnersError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setOwnersLoading(true);
    setOwnersError('');
    listCrmPortalAssignees()
      .then((rows) => {
        if (cancelled) return;
        const names = Array.from(
          new Set(
            rows
              .map((r) => String(r.employee_name || r.full_name || '').trim())
              .filter(Boolean),
          ),
        ).sort((a, b) => a.localeCompare(b));
        if (!names.length) {
          setOwnersError('No employees have CRM Portal access yet — ask HR to grant it in People → Portal Access.');
        }
        setPortalOwners(names);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPortalOwners([]);
        setOwnersError(err.message || 'Could not load CRM portal assignees');
      })
      .finally(() => {
        if (!cancelled) setOwnersLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owners = useMemo(() => {
    /* Prefer People → Portal Access → CRM Portal assignees. */
    const names = new Set(portalOwners);
    if (crm.userName && names.size === 0 && !ownersLoading) names.add(crm.userName);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [portalOwners, crm.userName, ownersLoading]);

  const presetFrom =
    (presetLeadIds?.length
      ? crm.leads.find((l) => l.id === presetLeadIds[0])?.owner
      : undefined) ||
    (presetActivityIds?.length
      ? crm.activities.find((a) => a.id === presetActivityIds[0])?.owner
      : undefined) ||
    '';

  const [fromOwner, setFromOwner] = useState('');
  const [toOwner, setToOwner] = useState('');
  const [scope, setScope] = useState<'leads' | 'followups' | 'both'>(defaultScope);
  const [note, setNote] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>(presetLeadIds || []);
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>(presetActivityIds || []);

  useEffect(() => {
    if (!owners.length) return;
    const preferredFrom = owners.includes(presetFrom) ? presetFrom : owners.find((o) => o === crm.userName) || owners[0];
    setFromOwner((cur) => (cur && owners.includes(cur) ? cur : preferredFrom));
    setToOwner((cur) => {
      if (cur && owners.includes(cur) && cur !== preferredFrom) return cur;
      return owners.find((o) => o !== preferredFrom) || '';
    });
  }, [owners, presetFrom, crm.userName]);

  const fromLeads = useMemo(
    () => crm.leads.filter((l) => l.owner === fromOwner),
    [crm.leads, fromOwner],
  );
  const fromFollowups = useMemo(
    () => crm.activities.filter((a) => a.owner === fromOwner && !a.done),
    [crm.activities, fromOwner],
  );

  useEffect(() => {
    if (!presetLeadIds?.length) setSelectedLeadIds([]);
    if (!presetActivityIds?.length) setSelectedActivityIds([]);
  }, [fromOwner, presetLeadIds, presetActivityIds]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!crm.isManager) {
      crm.pushToast('Only CRM Managers can transfer ownership', 'err');
      return;
    }
    if (!fromOwner || !toOwner) {
      crm.pushToast('Select from and to CRM owners', 'err');
      return;
    }
    if (!owners.includes(fromOwner) || !owners.includes(toOwner)) {
      crm.pushToast('Both owners must have CRM Portal access (People → Portal Access)', 'err');
      return;
    }
    if (fromOwner === toOwner) {
      crm.pushToast('Choose a different destination owner', 'err');
      return;
    }
    const result = await crm.transferOwnership({
      fromOwner,
      toOwner,
      scope,
      leadIds: selectedLeadIds.length ? selectedLeadIds : undefined,
      activityIds: selectedActivityIds.length ? selectedActivityIds : undefined,
      note,
    });
    if (!result) {
      crm.pushToast('Transfer failed', 'err');
      return;
    }
    crm.pushToast(
      `Transferred ${result.leads} lead(s), ${result.followups} follow-up(s)${result.deals ? `, ${result.deals} deal(s)` : ''} → ${toOwner}`,
    );
    onClose();
  };

  const toggleLead = (id: string) =>
    setSelectedLeadIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleActivity = (id: string) =>
    setSelectedActivityIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Modal
      title="Transfer ownership"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="transfer-owner-form" className="btn btn-primary">
            Transfer
          </button>
        </>
      }
    >
      <form id="transfer-owner-form" className="form-grid" onSubmit={submit}>
        <p className="span-2" style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>
          Owners are employees with active <strong>People → Portal Access → CRM Portal</strong>
          {ownersLoading ? ' · loading…' : ownersError ? ` · ${ownersError}` : ` · ${owners.length} assigned`}.
        </p>
        <Field label="From CRM owner *">
          <select value={fromOwner} onChange={(e) => setFromOwner(e.target.value)} required disabled={ownersLoading || !owners.length}>
            <option value="">{ownersLoading ? 'Loading CRM assignees…' : 'Select owner'}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To CRM owner *">
          <select value={toOwner} onChange={(e) => setToOwner(e.target.value)} required disabled={ownersLoading || !owners.length}>
            <option value="">{ownersLoading ? 'Loading CRM assignees…' : 'Select owner'}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Transfer scope *" span={2}>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'leads' | 'followups' | 'both')}>
            <option value="both">Leads + Follow-ups</option>
            <option value="leads">Leads only (linked follow-ups move too)</option>
            <option value="followups">Follow-ups only</option>
          </select>
        </Field>
        <Field label="Reason / note" span={2}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Workload balance · territory handoff" />
        </Field>
        {(scope === 'leads' || scope === 'both') && fromLeads.length ? (
          <div className="span-2" style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.85rem' }}>Leads from {fromOwner}</strong>
              <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setSelectedLeadIds(fromLeads.map((l) => l.id))}>
                Select all
              </button>
            </div>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.78rem' }}>
              Leave unchecked to transfer all {fromLeads.length} lead(s). Or pick specific ones.
            </p>
            <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 8 }}>
              {fromLeads.map((l) => (
                <label key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={selectedLeadIds.includes(l.id)} onChange={() => toggleLead(l.id)} />
                  <span>
                    <strong>{l.id}</strong> · {l.name} · {l.status}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        {(scope === 'followups' || scope === 'both') && fromFollowups.length ? (
          <div className="span-2" style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.85rem' }}>Open follow-ups from {fromOwner}</strong>
              <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setSelectedActivityIds(fromFollowups.map((a) => a.id))}>
                Select all
              </button>
            </div>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.78rem' }}>
              Leave unchecked to transfer all open follow-ups for this owner.
            </p>
            <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 8 }}>
              {fromFollowups.map((a) => (
                <label key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={selectedActivityIds.includes(a.id)} onChange={() => toggleActivity(a.id)} />
                  <span>
                    <strong>{a.id}</strong> · {a.leadName} · {a.type}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

export function BookingModal({
  mode,
  onClose,
}: {
  mode: 'aesthetic' | 'care' | 'partner';
  onClose: () => void;
}) {
  const crm = useCrm();
  const [busy, setBusy] = useState(false);
  const [branchLoad, setBranchLoad] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [doctors, setDoctors] = useState<CareDoctor[]>([]);
  const [doctorLoad, setDoctorLoad] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    age: '',
    address: '',
    referredBy: '',
    concern: '',
    date: today(),
    time: nextSlot(),
    branchId: '',
    doctorId: '',
    careType: 'consultation' as 'consultation' | 'physiotherapy',
    franchiseUnit: FRANCHISE_UNITS[0].name,
    tests: 'Full Body Checkup',
  });

  const clearAestheticForm = () =>
    setForm((f) => ({
      ...f,
      name: '',
      mobile: '',
      age: '',
      address: '',
      referredBy: '',
      concern: '',
      date: today(),
      time: nextSlot(),
      doctorId: '',
    }));

  useEffect(() => {
    if (mode !== 'care' && mode !== 'aesthetic') return;
    let cancelled = false;
    setBranchLoad('loading');
    const fallback =
      mode === 'aesthetic'
        ? AESTHETIC_BRANCHES.map((name, i) => ({ id: i + 1, name }))
        : CARE_BRANCHES.map((name, i) => ({ id: i + 1, name }));
    (mode === 'aesthetic' ? listAestheticBranches() : listCareBranches())
      .then((rows) => {
        if (cancelled) return;
        const list = rows.length ? rows : fallback;
        setBranches(list);
        setForm((f) => ({ ...f, branchId: String(list[0]?.id || ''), doctorId: '' }));
        setBranchLoad(rows.length ? 'ok' : 'err');
      })
      .catch(() => {
        if (cancelled) return;
        setBranches(fallback);
        setForm((f) => ({ ...f, branchId: String(fallback[0]?.id || ''), doctorId: '' }));
        setBranchLoad('err');
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'care') {
      setDoctors([]);
      setDoctorLoad('idle');
      setForm((f) => (f.doctorId ? { ...f, doctorId: '' } : f));
      return;
    }
    let cancelled = false;
    setDoctorLoad('loading');
    const branchId = Number(form.branchId) || undefined;
    const load = form.careType === 'physiotherapy' ? listCarePhysios(branchId) : listCareDoctors(branchId);
    load
      .then((rows) => {
        if (cancelled) return;
        setDoctors(rows);
        setForm((f) => {
          const keep = rows.some((d) => String(d.id) === f.doctorId);
          /* Doctor consultation requires a clinician; physio therapist is optional. */
          if (f.careType === 'physiotherapy') {
            return { ...f, doctorId: keep ? f.doctorId : '' };
          }
          return { ...f, doctorId: keep ? f.doctorId : rows[0] ? String(rows[0].id) : '' };
        });
        setDoctorLoad(rows.length ? 'ok' : 'err');
      })
      .catch(() => {
        if (cancelled) return;
        setDoctors([]);
        setForm((f) => ({ ...f, doctorId: '' }));
        setDoctorLoad('err');
      });
    return () => {
      cancelled = true;
    };
  }, [mode, form.careType, form.branchId]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const selectedBranch = branches.find((b) => String(b.id) === form.branchId);
  const selectedDoctor = doctors.find((d) => String(d.id) === form.doctorId);
  const branchLabel = selectedBranch
    ? selectedBranch.city
      ? `${selectedBranch.name} (${selectedBranch.city})`
      : selectedBranch.name
    : '';

  const title =
    mode === 'aesthetic'
      ? 'Book Aesthetic appointment'
      : mode === 'care'
        ? 'Book Care appointment'
        : 'Book for franchise unit';
  const careHint =
    form.careType === 'physiotherapy'
      ? 'Creates a Care physiotherapy visit — open Care → Physiotherapy Booking at the same branch/date.'
      : 'Creates a Care doctor consultation — open Care → Doctor Consultation at the same branch/date.';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(mobile)) {
      crm.pushToast('Enter a valid 10-digit mobile number', 'err');
      return;
    }
    if ((mode === 'care' || mode === 'aesthetic') && !form.branchId) {
      crm.pushToast('Select a branch', 'err');
      return;
    }
    if (mode === 'care' && form.careType === 'consultation' && !form.doctorId) {
      crm.pushToast('Select a doctor for the Care consultation', 'err');
      return;
    }
    setBusy(true);
    let externalId = '';
    let softNote = '';
    const branchId = Number(form.branchId) || undefined;
    const doctorId = Number(form.doctorId) || undefined;
    const bookingId = nextId('BK', crm.bookings);
    const executive = crm.userName;
    const executiveCode = executiveCodeFromName(executive);
    const trackingTag = makeTrackingTag(executive, bookingId);
    try {
      if (mode === 'aesthetic') {
        const res = await createAestheticBooking({
          name: form.name,
          mobile,
          age: form.age,
          address: form.address,
          referred_by: form.referredBy,
          concern: form.concern,
          tracking_tag: trackingTag,
          executive,
          date: form.date,
          time: form.time,
          branch: selectedBranch?.name,
          branch_id: branchId,
        });
        externalId = String(res.code || res.id || '');
        if (!externalId) throw new Error('Aesthetic portal did not return a booking reference');
      } else if (mode === 'care') {
        const res = await createCareBooking({
          name: form.name,
          mobile,
          age: form.age,
          address: form.address,
          concern: form.concern,
          tracking_tag: trackingTag,
          executive,
          date: form.date,
          time: form.time,
          type: form.careType,
          branch: selectedBranch?.name,
          branch_id: branchId,
          practitioner_id: doctorId || undefined,
        });
        externalId = String(res.code || res.id || '');
        if (!externalId) throw new Error('Care portal did not return a booking reference');
      } else {
        const res = await createPartnerUnitBooking({
          patient_name: form.name,
          mobile,
          tests: form.tests,
          franchise_unit: form.franchiseUnit,
          preferred_date: form.date,
          notes: form.concern,
          tracking_tag: trackingTag,
          executive,
        });
        externalId = res.externalId;
        if ('soft' in res && res.soft) softNote = res.message;
      }
    } catch (err) {
      crm.pushToast(
        err instanceof Error
          ? err.message
          : mode === 'aesthetic'
            ? 'Aesthetic portal booking failed'
            : mode === 'care'
              ? 'Care portal booking failed'
              : 'Booking failed',
        'err',
      );
      setBusy(false);
      return;
    }

    const serviceLabel =
      mode === 'partner'
        ? form.tests
        : mode === 'care'
          ? form.careType === 'physiotherapy'
            ? selectedDoctor
              ? `Physiotherapy Consultation · ${selectedDoctor.name}`
              : 'Physiotherapy Consultation'
            : selectedDoctor
              ? `Consultation · ${selectedDoctor.name}`
              : 'Consultation'
          : 'Consultation';

    const booking = crm.addBooking({
      id: bookingId,
      patient: form.name.trim(),
      mobile,
      wing: mode === 'partner' ? 'franchise' : mode,
      service: serviceLabel,
      branch: mode === 'partner' ? form.franchiseUnit : selectedBranch?.name || branchLabel,
      franchiseUnit: mode === 'partner' ? form.franchiseUnit : undefined,
      date: form.date,
      time: form.time,
      status: 'Scheduled',
      channel: mode === 'partner' ? 'Partner Portal' : 'CRM Telecaller',
      notes: [
        formatCrmTagNote(trackingTag),
        form.concern.trim(),
        form.referredBy.trim() ? `Referred by: ${form.referredBy.trim()}` : '',
        selectedDoctor ? `Doctor: ${selectedDoctor.name}` : '',
        softNote,
      ]
        .filter(Boolean)
        .join(' · '),
      externalId,
      owner: executive,
      trackingTag,
      executive,
      executiveCode,
      salesStatus: 'Open',
    });

    crm.addLead({
      name: form.name.trim(),
      mobile,
      email: '',
      wing: mode === 'partner' ? 'lab' : mode,
      source: 'Telecaller',
      status: 'Qualified',
      owner: executive,
      notes: `Booking ${booking.id} · ${booking.trackingTag} · ${booking.service}`,
    });

    crm.pushToast(
      softNote && !externalId
        ? `${booking.id} · ${trackingTag} saved in CRM (${softNote})`
        : `${booking.id} booked on portal · ${externalId || trackingTag}`,
      softNote && !externalId ? 'err' : 'ok',
    );
    setBusy(false);
    onClose();
  };

  const branchField = (
    <Field label={mode === 'aesthetic' ? 'Aesthetic branch *' : 'Care branch *'} span={2}>
      <select value={form.branchId} onChange={set('branchId')} required disabled={branchLoad === 'loading' || branches.length === 0}>
        {branchLoad === 'loading' ? <option value="">Loading branches…</option> : null}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.city ? `${b.name} — ${b.city}` : b.name}
            {b.code ? ` (${b.code})` : ''}
          </option>
        ))}
      </select>
      {branchLoad === 'err' ? (
        <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Live list unavailable — showing fallback branches</span>
      ) : null}
    </Field>
  );

  return (
    <Modal
      title={mode === 'aesthetic' ? 'New Booking' : title}
      onClose={onClose}
      actions={
        mode === 'aesthetic' ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={clearAestheticForm} disabled={busy}>
              Clear
            </button>
            <button type="submit" form="booking-form" className="btn btn-primary" disabled={busy || !form.branchId}>
              {busy ? 'Booking…' : 'Confirm booking'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="booking-form" className="btn btn-primary" disabled={busy || (mode !== 'partner' && !form.branchId)}>
              {busy ? 'Booking…' : 'Create booking'}
            </button>
          </>
        )
      }
    >
      <form id="booking-form" className="form-grid" onSubmit={submit}>
        {mode === 'aesthetic' ? (
          <>
            <Field label="Patient name *">
              <input value={form.name} onChange={set('name')} required autoFocus placeholder="Full name" />
            </Field>
            <Field label="Age">
              <input value={form.age} onChange={set('age')} type="number" min={0} max={120} placeholder="Years" />
            </Field>
            <Field label="Contact no *">
              <input value={form.mobile} onChange={set('mobile')} required inputMode="tel" placeholder="10-digit mobile" />
            </Field>
            <Field label="Referred by">
              <input value={form.referredBy} onChange={set('referredBy')} placeholder="Doctor or person, if any" />
            </Field>
            <Field label="Address" span={2}>
              <textarea rows={2} value={form.address} onChange={set('address')} placeholder="House, street, locality, city" />
            </Field>
            <Field label="Concern about" span={2}>
              <textarea rows={2} value={form.concern} onChange={set('concern')} placeholder="What the patient wants to discuss" />
            </Field>
            {branchField}
            <Field label="Consultation date *">
              <input type="date" value={form.date} onChange={set('date')} required />
            </Field>
            <Field label="Consultation time *">
              <input type="time" value={form.time} onChange={set('time')} required />
            </Field>
          </>
        ) : (
          <>
            <Field label="Patient name *">
              <input value={form.name} onChange={set('name')} required autoFocus />
            </Field>
            <Field label="Mobile *">
              <input value={form.mobile} onChange={set('mobile')} required inputMode="tel" />
            </Field>
            {mode !== 'partner' ? (
              <Field label="Age">
                <input value={form.age} onChange={set('age')} type="number" min={0} max={120} />
              </Field>
            ) : (
              <Field label="Tests / package *">
                <input value={form.tests} onChange={set('tests')} required />
              </Field>
            )}
            {mode === 'care' ? (
              <Field label="Visit type" span={2}>
                <select value={form.careType} onChange={set('careType')}>
                  <option value="consultation">Doctor consultation → Care Doctor Consultation</option>
                  <option value="physiotherapy">Physiotherapy → Care Physiotherapy Booking</option>
                </select>
                <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{careHint}</span>
              </Field>
            ) : null}
            {mode === 'care' ? branchField : null}
            {mode === 'care' ? (
              <Field
                label={form.careType === 'physiotherapy' ? 'Physiotherapist (optional)' : 'Doctor *'}
                span={2}
              >
                <select
                  value={form.doctorId}
                  onChange={set('doctorId')}
                  required={form.careType === 'consultation'}
                  disabled={doctorLoad === 'loading' || (form.careType === 'consultation' && doctors.length === 0)}
                >
                  {doctorLoad === 'loading' ? (
                    <option value="">{form.careType === 'physiotherapy' ? 'Loading physiotherapists…' : 'Loading doctors…'}</option>
                  ) : null}
                  {form.careType === 'physiotherapy' ? <option value="">Unassigned</option> : null}
                  {doctorLoad !== 'loading' && doctors.length === 0 && form.careType === 'consultation' ? (
                    <option value="">No doctors found for this branch</option>
                  ) : null}
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.specialty ? ` — ${d.specialty}` : ''}
                      {d.branch ? ` · ${d.branch}` : ''}
                      {d.fee ? ` · ₹${d.fee}` : ''}
                    </option>
                  ))}
                </select>
                {doctorLoad === 'err' ? (
                  <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                    Could not load Care clinicians. Ask HR for Care Backend → Appointments access, then reopen this form.
                  </span>
                ) : null}
              </Field>
            ) : null}
            {mode === 'partner' ? (
              <Field label="Franchise unit *">
                <select value={form.franchiseUnit} onChange={set('franchiseUnit')}>
                  {FRANCHISE_UNITS.map((u) => (
                    <option key={u.id} value={u.name}>
                      {u.name} ({u.model})
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Date *">
              <input type="date" value={form.date} onChange={set('date')} required />
            </Field>
            <Field label="Time *">
              <input type="time" value={form.time} onChange={set('time')} required />
            </Field>
            <Field label={mode === 'partner' ? 'Notes' : 'Concern / notes'} span={2}>
              <textarea rows={2} value={form.concern} onChange={set('concern')} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

export function StartFranchiseModal({ onClose }: { onClose: () => void }) {
  const crm = useCrm();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    email: '',
    model: 'FOFO' as 'FOFO' | 'FOCO',
    territory: '',
    notes: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(mobile) || !form.email.trim() || !form.territory.trim()) {
      crm.pushToast('Name, email, mobile and territory are required', 'err');
      return;
    }
    setBusy(true);
    try {
      const res = await createRfmsLead({
        name: form.name.trim(),
        email: form.email.trim(),
        mobile,
        franchise_model: form.model,
        territory_query: form.territory.trim(),
        notes: form.notes.trim() || 'Franchise creation started from Smilecure CRM',
      });
      const lead = crm.addLead({
        name: form.name.trim(),
        mobile,
        email: form.email.trim(),
        wing: 'franchise',
        source: 'Telecaller',
        status: 'Qualified',
        owner: crm.userName,
        franchiseModel: form.model,
        territory: form.territory.trim(),
        notes: form.notes.trim(),
        rfmsLeadId: res.leadId,
        value: form.model === 'FOCO' ? 350000 : 550000,
      });
      crm.addDeal({
        title: `${form.model} franchise — ${lead.name}`,
        leadId: lead.id,
        wing: 'franchise',
        stage: 'Opportunity Created',
        value: lead.value || 0,
        owner: crm.userName,
        closeDate: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
      });
      crm.pushToast(res.message || 'Franchise lead created in FFMS/RFMS');
      window.open('https://www.e-remedium.in/franchise/', '_blank', 'noopener,noreferrer');
      onClose();
    } catch (err) {
      crm.pushToast(err instanceof Error ? err.message : 'Could not start franchise in FFMS/RFMS', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Create Franchise (FFMS / RFMS)"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="franchise-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Create & open FFMS'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.88rem' }}>
        Adds the applicant to RFMS CRM and opens the franchise marketing / onboard path for payment and KYC.
      </p>
      <form id="franchise-form" className="form-grid" onSubmit={submit}>
        <Field label="Applicant name *">
          <input value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Mobile *">
          <input value={form.mobile} onChange={set('mobile')} required inputMode="tel" />
        </Field>
        <Field label="Email *">
          <input type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Model *">
          <select value={form.model} onChange={set('model')}>
            <option value="FOFO">FOFO</option>
            <option value="FOCO">FOCO</option>
          </select>
        </Field>
        <Field label="Preferred territory *" span={2}>
          <input value={form.territory} onChange={set('territory')} required placeholder="District / city cluster" />
        </Field>
        <Field label="Notes" span={2}>
          <textarea rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </form>
    </Modal>
  );
}

function activityMatchesLead(a: { leadId?: string; leadName: string; mobile?: string }, lead: CrmLead) {
  if (a.leadId && a.leadId === lead.id) return true;
  return a.leadName === lead.name && (!a.mobile || a.mobile === lead.mobile);
}

/** Assign a Smilecure CRM lead (+ follow-up details) to a REACH manager / portal user (inline in lead slider). */
export function AssignReachForm({
  lead,
  onClose,
  formId = 'assign-reach-form',
  compact,
}: {
  lead: CrmLead;
  onClose: () => void;
  formId?: string;
  compact?: boolean;
}) {
  const crm = useCrm();
  const [reps, setReps] = useState<ReachRep[]>([]);
  const [salesRepId, setSalesRepId] = useState(lead.reachRepId || '');
  const [createVisit, setCreateVisit] = useState(true);
  const [extraNote, setExtraNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingReps, setLoadingReps] = useState(true);
  const [loadError, setLoadError] = useState('');

  const followups = useMemo(
    () =>
      crm.activities
        .filter((a) => activityMatchesLead(a, lead))
        .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime())
        .slice(0, 12),
    [crm.activities, lead],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingReps(true);
      setLoadError('');
      try {
        const rows = await listCrmReachReps();
        if (cancelled) return;
        setReps(rows);
        if (!salesRepId && rows[0]) {
          setSalesRepId(rows[0].reach_user_id || rows[0].name);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load REACH users');
      } finally {
        if (!cancelled) setLoadingReps(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const selectedRep = reps.find((r) => (r.reach_user_id || r.name) === salesRepId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!salesRepId) {
      crm.pushToast('Select a REACH manager or portal user', 'err');
      return;
    }
    setBusy(true);
    try {
      const notes = [lead.notes, extraNote.trim()].filter(Boolean).join('\n');
      const result = await assignCrmLeadToReach({
        crmLeadId: lead.id,
        salesRepId,
        assignedToName: selectedRep?.display_name || selectedRep?.full_name || salesRepId,
        createVisit,
        lead: {
          name: lead.name,
          lead_name: lead.name,
          phone: lead.mobile,
          mobile: lead.mobile,
          email: lead.email,
          city: lead.city,
          territory: lead.territory || lead.city,
          address: lead.territory || lead.city,
          notes,
          status: lead.status,
          source: lead.source || 'smilecure_crm',
          franchise_model: lead.franchiseModel,
        },
        followups: followups.map((a) => ({
          title: a.title,
          type: a.type,
          dueAt: a.dueAt,
          owner: a.owner,
          done: a.done,
          outcome: a.outcome || a.notes,
          notes: a.notes,
        })),
      });

      const repName =
        result.assigned_rep_name ||
        result.reach?.assigned_rep_name ||
        selectedRep?.display_name ||
        selectedRep?.full_name ||
        salesRepId;
      const reachLeadId = result.lead_id || result.reach?.lead_id || '';
      const visitId = result.visit_id || '';

      crm.updateLead(
        lead.id,
        {
          reachLeadId,
          reachRepId: result.assigned_rep || salesRepId,
          reachRepName: repName,
          reachVisitId: visitId || lead.reachVisitId,
          reachAssignedAt: new Date().toISOString(),
          owner: repName,
          source: lead.source === 'Reach' ? lead.source : lead.source || 'Reach',
        },
        `Assigned to REACH · ${repName}${visitId ? ` · visit ${visitId}` : ''}`,
      );

      for (const a of followups.filter((f) => !f.done)) {
        crm.updateActivity(a.id, { owner: repName });
      }

      crm.pushToast(`Sent to REACH · ${repName}`);
      onClose();
    } catch (err) {
      crm.pushToast(err instanceof Error ? err.message : 'REACH assign failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const syncFromReach = async () => {
    setBusy(true);
    try {
      const snap = await getCrmReachLead(lead.id);
      const patch: Partial<CrmLead> = {
        reachLeadId: snap.lead_id,
        reachRepId: snap.assigned_rep || lead.reachRepId,
        reachRepName: snap.assigned_rep_name || lead.reachRepName,
      };
      if (snap.crm_status) patch.status = snap.crm_status as CrmLead['status'];
      crm.updateLead(lead.id, patch, `Synced from REACH · ${snap.status || 'ok'}`);
      crm.pushToast(`Pulled REACH status: ${snap.status || 'updated'}`);
    } catch (err) {
      crm.pushToast(err instanceof Error ? err.message : 'Sync from REACH failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const pushStatus = async () => {
    if (!lead.reachLeadId && !lead.reachAssignedAt) {
      crm.pushToast('Assign to REACH first', 'err');
      return;
    }
    setBusy(true);
    try {
      await syncCrmLeadStatusToReach(lead.id, lead.status);
      crm.pushToast(`Pushed status ${lead.status} to REACH`);
    } catch (err) {
      crm.pushToast(err instanceof Error ? err.message : 'Status push failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id={formId} className={`form-grid${compact ? ' form-grid-compact' : ''}`} onSubmit={submit}>
      <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
        Sends this lead and follow-ups to REACH sales &amp; marketing, then assigns a REACH portal user.
      </p>

      {lead.reachLeadId ? (
        <div style={{ gridColumn: '1 / -1', padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
          <strong style={{ fontSize: '0.85rem' }}>Already on REACH</strong>
          <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
            Lead {lead.reachLeadId}
            {lead.reachRepName ? ` · ${lead.reachRepName}` : ''}
            {lead.reachVisitId ? ` · visit ${lead.reachVisitId}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={syncFromReach} disabled={busy}>
              Pull from REACH
            </button>
            <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={pushStatus} disabled={busy}>
              Push status
            </button>
          </div>
        </div>
      ) : null}

      <Field label="REACH manager / portal user *" span={compact ? undefined : 2}>
        {loadingReps ? (
          <div className="empty">Loading REACH users…</div>
        ) : loadError ? (
          <div className="empty">{loadError}</div>
        ) : (
          <select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)} required disabled={busy}>
            <option value="">Select REACH user</option>
            {reps.map((r) => {
              const id = r.reach_user_id || r.name;
              const label = r.display_name || r.full_name || id;
              const meta = [r.designation, r.territory_region, r.employee_number || r.employee_id]
                .filter(Boolean)
                .join(' · ');
              return (
                <option key={id} value={id}>
                  {label}
                  {meta ? ` (${meta})` : ''}
                </option>
              );
            })}
          </select>
        )}
      </Field>

      <Field label="Follow-ups to include" span={compact ? undefined : 2}>
        <div style={{ fontSize: '0.85rem' }}>
          {followups.length === 0
            ? 'No follow-ups linked — lead notes only will sync.'
            : `${followups.length} follow-up(s) stamped into REACH notes.`}
        </div>
        {followups.slice(0, 5).map((a) => (
          <div key={a.id} style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
            [{a.done ? 'done' : 'open'}] {a.title} · {new Date(a.dueAt).toLocaleString('en-IN')}
          </div>
        ))}
      </Field>

      <Field label="Extra note for REACH" span={compact ? undefined : 2}>
        <textarea
          rows={compact ? 2 : 3}
          value={extraNote}
          onChange={(e) => setExtraNote(e.target.value)}
          placeholder="Intent, branch preference, objections…"
          disabled={busy}
        />
      </Field>

      <label className={`field${compact ? '' : ' span-2'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={createVisit} onChange={(e) => setCreateVisit(e.target.checked)} disabled={busy} />
        <span>Create Assigned Log Visit on REACH</span>
      </label>

      {/* Footer actions live in the slider when compact; keep submit available for form= */}
      {!compact ? (
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || loadingReps || !salesRepId}>
            {busy ? 'Sending…' : lead.reachLeadId ? 'Re-assign' : 'Send to REACH'}
          </button>
        </div>
      ) : null}
    </form>
  );
}
