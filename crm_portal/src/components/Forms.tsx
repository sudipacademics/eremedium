import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AESTHETIC_BRANCHES,
  CARE_BRANCHES,
  DEAL_STAGES,
  FOLLOW_UP_TYPES,
  FRANCHISE_UNITS,
  FRANCHISE_VERTICALS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  WINGS,
  executiveCodeFromName,
  formatCrmTagNote,
  makeTrackingTag,
  nextId,
  type CrmActivity,
  type CrmLead,
  type FranchiseVerticalId,
  type DealStage,
  type FollowUpType,
  type LeadSource,
  type LeadStatus,
  type WingId,
} from '../data';
import { leadMatchesModule, leadModulePath, parseModuleParams, wingIdForModule } from '../crmModules';
import { DISTRICTS_BY_STATE, INDIA_STATES, subdivisionsForDistrict } from '../indiaGeo';

export type FranchiseModel = 'FOFO' | 'FOCO' | 'Other' | '';
export type FranchiseVertical = FranchiseVerticalId;

function FranchiseVerticalSelect({
  value,
  onChange,
  disabled,
  required = true,
}: {
  value: FranchiseVertical;
  onChange: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <select value={value} onChange={onChange} required={required} disabled={disabled}>
      {FRANCHISE_VERTICALS.map((v) => (
        <option key={v.id} value={v.id}>
          {v.label}
        </option>
      ))}
    </select>
  );
}

/** Business wing options for lead create/edit (service wings + Franchise + NexiLab). */
function businessWingOptions(opts?: { moduleWing?: WingId | null; allowFranchise?: boolean }) {
  const allowFranchise = opts?.allowFranchise !== false;
  if (opts?.moduleWing === 'lab') {
    return WINGS.filter((w) => w.id === 'lab' || w.id === 'nexilab' || (allowFranchise && w.id === 'franchise'));
  }
  if (opts?.moduleWing) {
    return WINGS.filter((w) => w.id === opts.moduleWing || (allowFranchise && w.id === 'franchise' && opts.moduleWing !== 'nexilab'));
  }
  return allowFranchise ? [...WINGS] : WINGS.filter((w) => w.id !== 'franchise');
}

function verticalFromWing(wing: WingId, fallback: FranchiseVertical = 'lab'): FranchiseVertical {
  if (wing === 'lab' || wing === 'care' || wing === 'aesthetic') return wing;
  return fallback;
}

export type FranchiseFormFields = {
  alternateMobile: string;
  franchiseVertical: FranchiseVertical;
  franchiseModel: FranchiseModel;
  propertyOwnership: string;
  investmentCapacity: string;
  timeline: string;
  owner: string;
  state: string;
  district: string;
  subdivision: string;
  village: string;
  pinCode: string;
  preferredLocation: string;
  googleMapUrl: string;
  territory: string;
};

function FranchiseApplicantFields({
  form,
  set,
  onStateChange,
  onDistrictChange,
  ownerDisabled,
  owners,
  verticalLocked,
  hideVertical,
  entryDate,
  onEntryDate,
  source,
  onSource,
  name,
  onName,
  mobile,
  onMobile,
  email,
  onEmail,
  includeIdentity = true,
}: {
  form: FranchiseFormFields;
  set: (key: keyof FranchiseFormFields) => (e: { target: { value: string } }) => void;
  onStateChange: (state: string) => void;
  onDistrictChange: (district: string) => void;
  ownerDisabled?: boolean;
  owners: string[];
  verticalLocked?: boolean;
  /** When true, vertical is shown beside Business wing instead. */
  hideVertical?: boolean;
  entryDate?: string;
  onEntryDate?: (e: { target: { value: string } }) => void;
  source?: string;
  onSource?: (e: { target: { value: string } }) => void;
  name?: string;
  onName?: (e: { target: { value: string } }) => void;
  mobile?: string;
  onMobile?: (e: { target: { value: string } }) => void;
  email?: string;
  onEmail?: (e: { target: { value: string } }) => void;
  /** When false, only business + location fields (edit form already has identity). */
  includeIdentity?: boolean;
}) {
  const districts = form.state ? DISTRICTS_BY_STATE[form.state] || [] : [];
  const subdivisions = form.district ? subdivisionsForDistrict(form.district) : [];
  return (
    <>
      {includeIdentity ? (
        <>
          <Field label="Applicant name *">
            <input value={name || ''} onChange={onName} required autoFocus placeholder="Applicant name" />
          </Field>
          <Field label="Mobile number *">
            <input value={mobile || ''} onChange={onMobile} required inputMode="tel" placeholder="10-digit mobile" />
          </Field>
          <Field label="Alternate mobile">
            <input
              value={form.alternateMobile}
              onChange={set('alternateMobile')}
              inputMode="tel"
              placeholder="Optional 10-digit"
            />
          </Field>
          <Field label="Email">
            <input type="email" value={email || ''} onChange={onEmail} placeholder="email@example.com" />
          </Field>
          <Field label="Lead source *">
            <select value={source || ''} onChange={onSource} required>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          {!hideVertical ? (
            <Field label="Which franchise *">
              <FranchiseVerticalSelect
                value={form.franchiseVertical}
                onChange={set('franchiseVertical')}
                disabled={verticalLocked}
              />
            </Field>
          ) : null}
          <Field label="Franchise model *">
            <select value={form.franchiseModel} onChange={set('franchiseModel')} required>
              <option value="">Select model</option>
              <option value="FOFO">FOFO</option>
              <option value="FOCO">FOCO</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Property ownership">
            <select value={form.propertyOwnership} onChange={set('propertyOwnership')}>
              <option value="">Select</option>
              <option value="own_shop">Own shop</option>
              <option value="rental_shop">Rental shop</option>
            </select>
          </Field>
          <Field label="Investment capacity">
            <input
              value={form.investmentCapacity}
              onChange={set('investmentCapacity')}
              placeholder="e.g. 2,00,000"
            />
          </Field>
          <Field label="Timeline">
            <select value={form.timeline} onChange={set('timeline')}>
              <option value="">Select</option>
              <option value="7_days">7 days</option>
              <option value="15_days">15 days</option>
              <option value="30_days">30 days</option>
              <option value="6_month">6 months</option>
            </select>
          </Field>
          <Field label="Lead owner *">
            <input
              list="franchise-lead-owners"
              value={form.owner}
              onChange={set('owner')}
              required
              disabled={ownerDisabled}
              title={ownerDisabled ? 'Auto-assigned to you — managers can transfer later' : undefined}
            />
            <datalist id="franchise-lead-owners">
              {owners.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>
        </>
      ) : (
        <>
          {!hideVertical ? (
            <Field label="Which franchise *">
              <FranchiseVerticalSelect
                value={form.franchiseVertical}
                onChange={set('franchiseVertical')}
                disabled={verticalLocked}
              />
            </Field>
          ) : null}
          <Field label="Franchise model *">
            <select value={form.franchiseModel} onChange={set('franchiseModel')} required>
              <option value="">Select model</option>
              <option value="FOFO">FOFO</option>
              <option value="FOCO">FOCO</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Property ownership">
            <select value={form.propertyOwnership} onChange={set('propertyOwnership')}>
              <option value="">Select</option>
              <option value="own_shop">Own shop</option>
              <option value="rental_shop">Rental shop</option>
            </select>
          </Field>
          <Field label="Investment capacity">
            <input
              value={form.investmentCapacity}
              onChange={set('investmentCapacity')}
              placeholder="e.g. 2,00,000"
            />
          </Field>
          <Field label="Timeline">
            <select value={form.timeline} onChange={set('timeline')}>
              <option value="">Select</option>
              <option value="7_days">7 days</option>
              <option value="15_days">15 days</option>
              <option value="30_days">30 days</option>
              <option value="6_month">6 months</option>
            </select>
          </Field>
          <Field label="Lead owner *">
            <input
              list="franchise-lead-owners-edit"
              value={form.owner}
              onChange={set('owner')}
              required
              disabled={ownerDisabled}
            />
            <datalist id="franchise-lead-owners-edit">
              {owners.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>
        </>
      )}
      <Field label="State *">
        <select value={form.state} onChange={(e) => onStateChange(e.target.value)} required>
          <option value="">Select state</option>
          {INDIA_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="District *">
        <select
          value={form.district}
          onChange={(e) => onDistrictChange(e.target.value)}
          required
          disabled={!form.state}
        >
          <option value="">{form.state ? 'Select district' : 'Select state first'}</option>
          {districts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subdivision">
        <input
          list={`subdiv-${form.district || 'none'}`}
          value={form.subdivision}
          onChange={set('subdivision')}
          placeholder="Select or type subdivision"
          disabled={!form.district}
        />
        <datalist id={`subdiv-${form.district || 'none'}`}>
          {subdivisions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label="City / Village">
        <input value={form.village} onChange={set('village')} placeholder="City or village" />
      </Field>
      <Field label="PIN code">
        <input
          value={form.pinCode}
          onChange={set('pinCode')}
          inputMode="numeric"
          maxLength={6}
          pattern="\d{6}"
          placeholder="6 digits"
        />
      </Field>
      {includeIdentity && entryDate != null && onEntryDate ? (
        <Field label="Entry date *">
          <input type="date" value={entryDate} onChange={onEntryDate} required />
        </Field>
      ) : null}
      <Field label="Preferred location *" span={2}>
        <textarea
          rows={2}
          value={form.preferredLocation}
          onChange={set('preferredLocation')}
          required
          placeholder="Full address / preferred site"
        />
      </Field>
      <Field label="Google Map location" span={2}>
        <input
          value={form.googleMapUrl}
          onChange={set('googleMapUrl')}
          placeholder="Optional maps URL or pin link"
        />
      </Field>
    </>
  );
}
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
  sendCrmWhatsApp,
  syncCrmLeadStatusToReach,
  type CareDoctor,
  type ClinicBranch,
  type ReachRep,
} from '../crmApi';
import { loadMessageTemplates } from '../settingsData';
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

function todayInputDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse CSV / form entry dates → ISO. Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. */
export function parseEntryDate(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function AddLeadModal({
  onClose,
  defaults,
}: {
  onClose: () => void;
  defaults?: Partial<{
    name: string;
    mobile: string;
    email: string;
    wing: WingId;
    city: string;
    notes: string;
  }>;
}) {
  const crm = useCrm();
  const location = useLocation();
  const navigate = useNavigate();
  const moduleFromRoute = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'leads' || parts[0] === 'activities') {
      return parseModuleParams(parts[1], parts[2]);
    }
    return null;
  }, [location.pathname]);
  const defaultWing =
    defaults?.wing ||
    (moduleFromRoute
      ? wingIdForModule(moduleFromRoute.domain, moduleFromRoute.wing)
      : ('aesthetic' as WingId));

  const owners = useMemo(() => {
    const set = new Set<string>([crm.userName, ...crm.leads.map((l) => l.owner)].filter(Boolean));
    return Array.from(set);
  }, [crm.leads, crm.userName]);

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: defaults?.name || '',
    mobile: defaults?.mobile || '',
    email: defaults?.email || '',
    wing: defaultWing,
    source: 'Telecaller' as LeadSource,
    city: defaults?.city || '',
    notes: defaults?.notes || '',
    entryDate: todayInputDate(),
    franchiseModel: '' as FranchiseModel,
    franchiseVertical: (moduleFromRoute?.domain === 'franchise' &&
    moduleFromRoute.wing !== 'nexilab'
      ? moduleFromRoute.wing
      : 'lab') as FranchiseVertical,
    propertyOwnership: '',
    investmentCapacity: '',
    timeline: '',
    alternateMobile: '',
    owner: crm.userName,
    state: 'West Bengal',
    district: '',
    subdivision: '',
    village: '',
    pinCode: '',
    preferredLocation: '',
    googleMapUrl: '',
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

  const onFranchiseState = (state: string) => {
    setForm((f) => ({ ...f, state, district: '', subdivision: '', territory: state }));
  };
  const onFranchiseDistrict = (district: string) => {
    setForm((f) => ({
      ...f,
      district,
      subdivision: '',
      territory: [f.state, district].filter(Boolean).join(' · '),
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(mobile)) {
      crm.pushToast('Enter a valid 10-digit mobile number', 'err');
      return;
    }
    const alt = form.alternateMobile.replace(/\D/g, '').slice(-10);
    if (form.alternateMobile.trim() && !/^\d{10}$/.test(alt)) {
      crm.pushToast('Alternate mobile must be 10 digits', 'err');
      return;
    }
    if (!form.source) {
      crm.pushToast('Lead source is mandatory', 'err');
      return;
    }
    const createdAt = parseEntryDate(form.entryDate);
    if (!createdAt) {
      crm.pushToast('Entry date is required', 'err');
      return;
    }
    if (form.wing === 'franchise') {
      if (!form.franchiseModel || !form.franchiseVertical) {
        crm.pushToast('Which franchise and franchise model are required', 'err');
        return;
      }
      if (!form.state || !form.district || !form.preferredLocation.trim()) {
        crm.pushToast('State, district and preferred location are required', 'err');
        return;
      }
      if (form.pinCode.trim() && !/^\d{6}$/.test(form.pinCode.trim())) {
        crm.pushToast('PIN code must be 6 digits', 'err');
        return;
      }
    }
    const territory =
      form.wing === 'franchise'
        ? [form.state, form.district, form.subdivision, form.village].filter(Boolean).join(' · ') ||
          form.preferredLocation.trim()
        : form.city.trim();
    setBusy(true);
    let rfmsLeadId = '';
    if (form.wing === 'franchise' && form.pushRfms) {
      if (!form.email.trim()) {
        crm.pushToast('Email is required to push to FFMS/RFMS', 'err');
        setBusy(false);
        return;
      }
      try {
        const res = await createRfmsLead({
          name: form.name.trim(),
          email: form.email.trim(),
          mobile,
          franchise_model: form.franchiseModel === 'Other' ? 'FOFO' : form.franchiseModel || 'FOFO',
          territory_query: territory,
          notes:
            form.notes.trim() ||
            `CRM franchise · ${form.franchiseVertical} · ${form.franchiseModel} · ${form.preferredLocation.trim()}`,
        });
        rfmsLeadId = res.leadId;
        crm.pushToast(res.message);
      } catch (err) {
        crm.pushToast(err instanceof Error ? err.message : 'FFMS/RFMS lead failed', 'err');
        setBusy(false);
        return;
      }
    }
    const owner = form.owner.trim() || crm.userName;
    const lead = crm.addLead({
      name: form.name.trim(),
      mobile,
      email: form.email.trim(),
      wing: form.wing,
      source: form.source,
      status: 'New',
      owner,
      city: form.wing === 'franchise' ? form.village.trim() || form.district : form.city.trim(),
      notes: form.notes.trim(),
      franchiseModel: form.wing === 'franchise' ? form.franchiseModel : '',
      franchiseVertical: form.wing === 'franchise' ? form.franchiseVertical : undefined,
      propertyOwnership: form.wing === 'franchise' ? form.propertyOwnership.trim() || undefined : undefined,
      investmentCapacity: form.wing === 'franchise' ? form.investmentCapacity.trim() || undefined : undefined,
      timeline: form.wing === 'franchise' ? form.timeline.trim() || undefined : undefined,
      alternateMobile: form.wing === 'franchise' && alt ? alt : undefined,
      state: form.wing === 'franchise' ? form.state : undefined,
      district: form.wing === 'franchise' ? form.district : undefined,
      subdivision: form.wing === 'franchise' ? form.subdivision.trim() : undefined,
      village: form.wing === 'franchise' ? form.village.trim() : undefined,
      pinCode: form.wing === 'franchise' ? form.pinCode.trim() : undefined,
      preferredLocation: form.wing === 'franchise' ? form.preferredLocation.trim() : undefined,
      googleMapUrl:
        form.wing === 'franchise'
          ? (() => {
              const raw = form.googleMapUrl.trim();
              if (!raw) return undefined;
              try {
                const u = new URL(raw);
                return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
              } catch {
                return undefined;
              }
            })()
          : undefined,
      territory,
      rfmsLeadId,
      createdAt,
    });
    if (form.wing === 'franchise') {
      crm.addDeal({
        title: `${form.franchiseModel || 'Franchise'} — ${lead.name}`,
        leadId: lead.id,
        wing: 'franchise',
        stage: 'Opportunity Created',
        value: form.franchiseModel === 'FOCO' ? 350000 : 550000,
        owner,
        closeDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      });
      crm.addActivity({
        type: 'Franchise',
        title: `Follow up franchise lead — ${lead.name}`,
        leadName: lead.name,
        leadId: lead.id,
        mobile,
        wing: 'franchise',
        dueAt: new Date(Date.now() + 2 * 3600000).toISOString(),
        done: false,
        owner,
        leadStage: 'New',
      });
    }
    if (!rfmsLeadId) crm.pushToast(`Lead ${lead.id} saved · synced to Leads`);
    setBusy(false);
    onClose();
    /* Land in the Franchise submodule that matches Which franchise. */
    navigate(leadModulePath({ wing: form.wing, franchiseVertical: form.franchiseVertical }));
  };

  const isFranchise = form.wing === 'franchise';

  return (
    <Modal
      title={isFranchise ? 'Add Franchise Lead' : 'Add Lead'}
      onClose={onClose}
      size={isFranchise ? 'lg' : 'md'}
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
        {isFranchise ? (
          <>
            <Field label="Business wing *">
              <select
                value={form.wing}
                disabled={moduleFromRoute?.domain === 'franchise' && moduleFromRoute.wing !== 'nexilab'}
                title={
                  moduleFromRoute?.domain === 'franchise' && moduleFromRoute.wing !== 'nexilab'
                    ? 'Wing locked to Franchise for this module'
                    : undefined
                }
                onChange={(e) => {
                  const wing = e.target.value as WingId;
                  setForm((f) => ({
                    ...f,
                    wing,
                    franchiseVertical:
                      wing === 'franchise'
                        ? verticalFromWing(f.wing, f.franchiseVertical || 'lab')
                        : f.franchiseVertical,
                    franchiseModel: wing === 'franchise' && !f.franchiseModel ? 'FOFO' : f.franchiseModel,
                  }));
                }}
              >
                {(moduleFromRoute?.domain === 'franchise' && moduleFromRoute.wing !== 'nexilab'
                  ? WINGS.filter((w) => w.id === 'franchise')
                  : businessWingOptions({
                      moduleWing: moduleFromRoute ? wingIdForModule(moduleFromRoute.domain, moduleFromRoute.wing) : null,
                      allowFranchise: true,
                    })
                ).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Which franchise *">
              <FranchiseVerticalSelect
                value={form.franchiseVertical}
                onChange={set('franchiseVertical')}
                disabled={moduleFromRoute?.domain === 'franchise' && moduleFromRoute.wing !== 'nexilab'}
              />
            </Field>
            <FranchiseApplicantFields
              form={form}
              set={set as (key: keyof FranchiseFormFields) => (e: { target: { value: string } }) => void}
              onStateChange={onFranchiseState}
              onDistrictChange={onFranchiseDistrict}
              owners={owners}
              ownerDisabled={!crm.isManager}
              verticalLocked={moduleFromRoute?.domain === 'franchise'}
              hideVertical
              entryDate={form.entryDate}
              onEntryDate={set('entryDate')}
              source={form.source}
              onSource={set('source')}
              name={form.name}
              onName={set('name')}
              mobile={form.mobile}
              onMobile={set('mobile')}
              email={form.email}
              onEmail={set('email')}
            />
            <Field label="Push to FFMS / RFMS" span={2}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <input type="checkbox" checked={form.pushRfms} onChange={set('pushRfms')} />
                Create lead in franchise admin CRM (FFMS/RFMS)
              </label>
            </Field>
            <Field label="Notes" span={2}>
              <textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Call notes, interest, budget…" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Full name *">
              <input value={form.name} onChange={set('name')} required autoFocus placeholder="Lead name" />
            </Field>
            <Field label="Mobile number *">
              <input value={form.mobile} onChange={set('mobile')} required inputMode="tel" placeholder="10-digit mobile" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={set('email')} placeholder="email@example.com" />
            </Field>
            <Field label="City">
              <input value={form.city} onChange={set('city')} placeholder="City / locality" />
            </Field>
            <Field label="Business wing *">
              <select
                value={form.wing}
                disabled={Boolean(moduleFromRoute) && moduleFromRoute?.domain === 'service'}
                title={moduleFromRoute?.domain === 'service' ? 'Wing locked to current module' : undefined}
                onChange={(e) => {
                  const wing = e.target.value as WingId;
                  setForm((f) => ({
                    ...f,
                    wing,
                    franchiseVertical:
                      wing === 'franchise'
                        ? verticalFromWing(f.wing, f.franchiseVertical || 'lab')
                        : f.franchiseVertical,
                    franchiseModel: wing === 'franchise' && !f.franchiseModel ? 'FOFO' : f.franchiseModel,
                  }));
                }}
              >
                {businessWingOptions({
                  moduleWing:
                    moduleFromRoute?.domain === 'service'
                      ? wingIdForModule(moduleFromRoute.domain, moduleFromRoute.wing)
                      : null,
                  allowFranchise: true,
                }).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lead source *">
              <select value={form.source} onChange={set('source')} required>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Entry date *">
              <input type="date" value={form.entryDate} onChange={set('entryDate')} required />
            </Field>
            <Field label="Notes" span={2}>
              <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Call notes, interest, budget…" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

export function EditLeadModal({ lead, onClose }: { lead: CrmLead; onClose: () => void }) {
  const crm = useCrm();
  const navigate = useNavigate();
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
    owner: lead.owner,
    notes: lead.notes || '',
    value: lead.value != null ? String(lead.value) : '',
    nextFollowUp: lead.nextFollowUp ? lead.nextFollowUp.slice(0, 16) : '',
    franchiseModel: (lead.franchiseModel || '') as FranchiseModel,
    franchiseVertical: (lead.franchiseVertical || 'lab') as FranchiseVertical,
    propertyOwnership: lead.propertyOwnership || '',
    investmentCapacity: lead.investmentCapacity || '',
    timeline: lead.timeline || '',
    alternateMobile: lead.alternateMobile || '',
    state: lead.state || '',
    district: lead.district || '',
    subdivision: lead.subdivision || '',
    village: lead.village || lead.city || '',
    pinCode: lead.pinCode || '',
    preferredLocation: lead.preferredLocation || '',
    googleMapUrl: lead.googleMapUrl || '',
    territory: lead.territory || '',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onFranchiseState = (state: string) => {
    setForm((f) => ({ ...f, state, district: '', subdivision: '' }));
  };
  const onFranchiseDistrict = (district: string) => {
    setForm((f) => ({ ...f, district, subdivision: '' }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(mobile)) {
      crm.pushToast('Enter a valid 10-digit mobile number', 'err');
      return;
    }
    const alt = form.alternateMobile.replace(/\D/g, '').slice(-10);
    if (form.alternateMobile.trim() && !/^\d{10}$/.test(alt)) {
      crm.pushToast('Alternate mobile must be 10 digits', 'err');
      return;
    }
    if (form.wing === 'franchise') {
      if (!form.source || !form.franchiseModel || !form.franchiseVertical) {
        crm.pushToast('Source, which franchise and franchise model are required', 'err');
        return;
      }
      if (!form.state || !form.district || !form.preferredLocation.trim()) {
        crm.pushToast('State, district and preferred location are required for Franchise leads', 'err');
        return;
      }
      if (form.pinCode.trim() && !/^\d{6}$/.test(form.pinCode.trim())) {
        crm.pushToast('PIN code must be 6 digits', 'err');
        return;
      }
    }
    setBusy(true);
    const territory =
      form.wing === 'franchise'
        ? [form.state, form.district, form.subdivision, form.village].filter(Boolean).join(' · ')
        : form.territory.trim();
    const patch: Partial<CrmLead> = {
      name: form.name.trim(),
      mobile,
      email: form.email.trim(),
      city: form.wing === 'franchise' ? form.village.trim() || form.district : form.city.trim(),
      wing: form.wing,
      source: form.source,
      owner: form.owner.trim() || crm.userName,
      notes: form.notes.trim(),
      value: form.value ? Number(form.value) || undefined : undefined,
      nextFollowUp: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : undefined,
      franchiseModel: form.wing === 'franchise' ? form.franchiseModel : '',
      franchiseVertical: form.wing === 'franchise' ? form.franchiseVertical : undefined,
      propertyOwnership: form.wing === 'franchise' ? form.propertyOwnership.trim() || undefined : undefined,
      investmentCapacity: form.wing === 'franchise' ? form.investmentCapacity.trim() || undefined : undefined,
      timeline: form.wing === 'franchise' ? form.timeline.trim() || undefined : undefined,
      alternateMobile: form.wing === 'franchise' && alt ? alt : undefined,
      state: form.wing === 'franchise' ? form.state : undefined,
      district: form.wing === 'franchise' ? form.district : undefined,
      subdivision: form.wing === 'franchise' ? form.subdivision.trim() : undefined,
      village: form.wing === 'franchise' ? form.village.trim() : undefined,
      pinCode: form.wing === 'franchise' ? form.pinCode.trim() : undefined,
      preferredLocation: form.wing === 'franchise' ? form.preferredLocation.trim() : undefined,
      googleMapUrl:
        form.wing === 'franchise'
          ? (() => {
              const raw = form.googleMapUrl.trim();
              if (!raw) return undefined;
              try {
                const u = new URL(raw);
                return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
              } catch {
                return undefined;
              }
            })()
          : undefined,
      territory: form.wing === 'franchise' ? territory : '',
    };
    crm.updateLead(lead.id, patch, logNote.trim() || undefined);
    if (form.nextFollowUp) {
      crm.addActivity({
        type: 'Follow-up',
        title: `Follow up — ${patch.name}`,
        leadId: lead.id,
        leadName: patch.name || lead.name,
        mobile: patch.mobile || lead.mobile,
        wing: patch.wing || lead.wing,
        dueAt: new Date(form.nextFollowUp).toISOString(),
        done: false,
        owner: patch.owner || crm.userName,
        leadStage: patch.status || lead.status,
      });
    }
    crm.pushToast(`${lead.id} updated · synced to Leads`);
    setBusy(false);
    onClose();
    /* Distribute into Franchise submodule from Which franchise (or Service / NexiLab wing). */
    navigate(
      leadModulePath({
        wing: patch.wing || lead.wing,
        franchiseVertical: patch.franchiseVertical ?? lead.franchiseVertical,
      }),
    );
  };

  const history = lead.history || [];

  return (
    <Modal
      title={form.wing === 'franchise' ? `Edit Franchise Lead · ${lead.id}` : `Manage lead · ${lead.id}`}
      onClose={onClose}
      size={form.wing === 'franchise' ? 'lg' : 'md'}
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
      <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: '0.78rem' }}>
        Status: <strong style={{ color: 'var(--ink)' }}>{lead.status}</strong>
        {' · '}
        Change from Follow-up Check → open the lead panel
      </p>
      <form id="edit-lead-form" className="form-grid" onSubmit={submit}>
        <Field label={form.wing === 'franchise' ? 'Applicant name *' : 'Full name *'}>
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Mobile number *">
          <input value={form.mobile} onChange={set('mobile')} required inputMode="tel" />
        </Field>
        {form.wing === 'franchise' ? (
          <Field label="Alternate mobile">
            <input value={form.alternateMobile} onChange={set('alternateMobile')} inputMode="tel" placeholder="Optional 10-digit" />
          </Field>
        ) : null}
        <Field label="Email">
          <input type="email" value={form.email} onChange={set('email')} />
        </Field>
        {form.wing !== 'franchise' ? (
          <Field label="City">
            <input value={form.city} onChange={set('city')} />
          </Field>
        ) : null}
        <Field label="Business wing *">
          <select
            value={form.wing}
            onChange={(e) => {
              const wing = e.target.value as WingId;
              setForm((f) => ({
                ...f,
                wing,
                franchiseVertical:
                  wing === 'franchise'
                    ? f.wing === 'franchise'
                      ? f.franchiseVertical
                      : verticalFromWing(f.wing, f.franchiseVertical || 'lab')
                    : f.franchiseVertical,
                franchiseModel: wing === 'franchise' && !f.franchiseModel ? 'FOFO' : f.franchiseModel,
                state: wing === 'franchise' ? f.state || 'West Bengal' : f.state,
                preferredLocation:
                  wing === 'franchise' && !f.preferredLocation.trim() ? f.city.trim() : f.preferredLocation,
                village: wing === 'franchise' && !f.village.trim() ? f.city.trim() : f.village,
              }));
            }}
          >
            {WINGS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        {form.wing === 'franchise' ? (
          <Field label="Which franchise *">
            <FranchiseVerticalSelect value={form.franchiseVertical} onChange={set('franchiseVertical')} />
          </Field>
        ) : null}
        <Field label="Lead source *">
          <select value={form.source} onChange={set('source')} required>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {!LEAD_SOURCES.includes(form.source as LeadSource) ? <option value={form.source}>{form.source}</option> : null}
          </select>
        </Field>
        {form.wing !== 'franchise' ? (
          <>
            <Field label="Owner *">
              <input
                list="crm-owners"
                value={form.owner}
                onChange={set('owner')}
                required
                disabled={!crm.isManager}
                title={crm.isManager ? undefined : 'Only CRM Managers can change lead ownership — use Transfer Lead'}
              />
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
          </>
        ) : (
          <FranchiseApplicantFields
            form={form}
            set={set as (key: keyof FranchiseFormFields) => (e: { target: { value: string } }) => void}
            onStateChange={onFranchiseState}
            onDistrictChange={onFranchiseDistrict}
            owners={owners}
            ownerDisabled={!crm.isManager}
            includeIdentity={false}
            hideVertical
          />
        )}
        {form.wing === 'franchise' ? (
          <>
            <Field label="Deal value (₹)">
              <input type="number" min={0} value={form.value} onChange={set('value')} placeholder="Optional" />
            </Field>
            <Field label="Next follow-up">
              <input type="datetime-local" value={form.nextFollowUp} onChange={set('nextFollowUp')} />
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
  const location = useLocation();
  const moduleFromRoute = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'leads' || parts[0] === 'activities') {
      return parseModuleParams(parts[1], parts[2]);
    }
    return null;
  }, [location.pathname]);
  const editing = Boolean(initial?.id);
  const defaultFuWing = lockedLead?.wing || initial?.wing || (moduleFromRoute
    ? wingIdForModule(moduleFromRoute.domain, moduleFromRoute.wing)
    : 'aesthetic');
  const [form, setForm] = useState({
    leadId: lockedLead?.id || initial?.leadId || '',
    leadName: lockedLead?.name || initial?.leadName || '',
    mobile: lockedLead?.mobile || initial?.mobile || '',
    wing: defaultFuWing as WingId,
    branch:
      (lockedLead?.wing || initial?.wing) === 'franchise'
        ? ''
        : lockedLead?.city || initial?.branch || '',
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
      branch: lead.wing === 'franchise' ? '' : lead.city || f.branch,
    }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.leadName.trim()) {
      crm.pushToast('Enter lead / patient name', 'err');
      return;
    }
    const dueAt = new Date(form.dueAt).toISOString();
    const franchise = form.wing === 'franchise';
    const payload = {
      type: form.type,
      title: `${form.type} — ${form.leadName.trim()}`,
      leadName: form.leadName.trim(),
      leadId: form.leadId || undefined,
      mobile: form.mobile.replace(/\D/g, '').slice(-10) || undefined,
      wing: form.wing,
      branch: franchise ? undefined : form.branch.trim() || undefined,
      dueAt,
      done: false,
      owner: form.owner.trim() || crm.userName,
      notes: form.notes.trim(),
      leadStage: form.leadStage,
    };
    if (editing && initial) {
      crm.updateActivity(initial.id, payload);
      if (form.leadStage) {
        crm.setLeadStatusFromFollowUp(initial.id, form.leadStage as LeadStatus);
      }
      crm.pushToast(`Follow-up ${initial.id} updated · synced to Follow-ups`);
    } else {
      const created = crm.addActivity(payload);
      if (form.leadStage) {
        crm.setLeadStatusFromFollowUp(created.id, form.leadStage as LeadStatus);
      }
      crm.pushToast(`Follow-up ${created.id} scheduled · synced to Follow-ups`);
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
        : form.wing === 'nexilab'
          ? ['Central Hub', 'Barasat', 'Howrah']
          : form.wing === 'lab'
            ? FRANCHISE_UNITS.map((u) => u.name)
            : [];
  const showBranch = form.wing !== 'franchise';

  return (
    <form id={formId} className={`form-grid${compact ? ' form-grid-compact' : ''}`} onSubmit={submit}>
      {!lockedLead ? (
        <Field label="Link to lead">
          <select value={form.leadId} onChange={(e) => pickLead(e.target.value)}>
            <option value="">Manual entry</option>
            {crm.leads
              .filter((l) =>
                moduleFromRoute ? leadMatchesModule(l, moduleFromRoute.domain, moduleFromRoute.wing) : true,
              )
              .map((l) => (
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
            <select
              value={form.wing}
              onChange={(e) => {
                const wing = e.target.value as WingId;
                setForm((f) => ({
                  ...f,
                  wing,
                  branch: wing === 'franchise' ? '' : f.branch,
                }));
              }}
            >
              {WINGS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      {showBranch ? (
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
      ) : (
        <Field label="Territory / area">
          <input
            value={lockedLead?.territory || lockedLead?.city || form.branch || '—'}
            readOnly
            title="Franchise leads use territory, not clinic branch"
          />
        </Field>
      )}
      <Field label="Date & time *">
        <input type="datetime-local" value={form.dueAt} onChange={set('dueAt')} required autoFocus={Boolean(lockedLead)} />
      </Field>
      <Field label="Assigned to *">
        <input value={form.owner} onChange={set('owner')} required />
      </Field>
      <Field label="Lead status">
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
  lockedLead,
  onClose,
}: {
  initial?: CrmActivity | null;
  lockedLead?: CrmLead | null;
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
      <ScheduleFollowUpForm initial={initial} lockedLead={lockedLead} onClose={onClose} />
    </Modal>
  );
}

export function CreateDealModal({
  lead,
  onClose,
}: {
  lead?: CrmLead | null;
  onClose: () => void;
}) {
  const crm = useCrm();
  const [form, setForm] = useState({
    title: lead ? `${lead.name} · opportunity` : '',
    leadId: lead?.id || '',
    leadName: lead?.name || '',
    wing: (lead?.wing || 'aesthetic') as WingId,
    stage: 'Opportunity Created' as DealStage,
    value: lead?.value ? String(lead.value) : '',
    owner: lead?.owner || crm.userName,
    closeDate: todayInputDate(),
    product: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      crm.pushToast('Enter deal title', 'err');
      return;
    }
    const deal = crm.addDeal({
      title: form.title.trim(),
      leadId: form.leadId || undefined,
      leadName: form.leadName.trim() || undefined,
      wing: form.wing,
      stage: form.stage,
      value: Number(form.value) || 0,
      owner: form.owner.trim() || crm.userName,
      closeDate: form.closeDate || todayInputDate(),
      product: form.product.trim() || undefined,
    });
    if (form.leadId) {
      crm.updateLead(form.leadId, {}, `Deal ${deal.id} created`);
    }
    crm.pushToast(`Deal ${deal.id} saved · synced to Deals`);
    onClose();
  };

  return (
    <Modal
      title="Create Deal"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="wa-create-deal-form" className="btn btn-primary">
            Save deal
          </button>
        </>
      }
    >
      <form id="wa-create-deal-form" className="form-grid" onSubmit={submit}>
        <Field label="Title *">
          <input value={form.title} onChange={set('title')} required autoFocus placeholder="Deal title" />
        </Field>
        <Field label="Lead">
          <input value={form.leadName || '—'} readOnly />
        </Field>
        <Field label="Wing *">
          <select value={form.wing} onChange={set('wing')}>
            {WINGS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stage *">
          <select value={form.stage} onChange={set('stage')}>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Value (₹)">
          <input type="number" min={0} value={form.value} onChange={set('value')} placeholder="0" />
        </Field>
        <Field label="Expected close">
          <input type="date" value={form.closeDate} onChange={set('closeDate')} />
        </Field>
        <Field label="Owner *">
          <input value={form.owner} onChange={set('owner')} required />
        </Field>
        <Field label="Product / package">
          <input value={form.product} onChange={set('product')} placeholder="Optional" />
        </Field>
      </form>
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
  const iEntry = idx(['entry_date', 'entrydate', 'created_at', 'createdat', 'date', 'lead_date']);
  if (iName < 0 || iMobile < 0 || iEntry < 0) return [];

  return rows
    .map((cells) => {
      const statusRaw = iStatus >= 0 ? cells[iStatus] || 'New' : 'New';
      const status = (LEAD_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as (typeof LEAD_STATUSES)[number])
        : 'New';
      const sourceRaw = iSource >= 0 ? cells[iSource] || 'Telecaller' : 'Telecaller';
      const valueRaw = iValue >= 0 ? Number(String(cells[iValue] || '').replace(/,/g, '')) : undefined;
      const createdAt = parseEntryDate(cells[iEntry] || '');
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
        createdAt: createdAt || undefined,
      };
    })
    .filter((r) => Boolean(r.createdAt));
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
      setError(
        'Could not read rows. Entry date is required. Use headers: name, mobile, entry_date, email, wing, source, status, city, owner, notes, value',
      );
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

  const sampleCsv = `name,mobile,entry_date,email,wing,source,status,city,owner,notes,value
Riya Sen,9876501234,2026-11-21,riya.sen@example.com,aesthetic,Meta Ads,New,Barasat,Snehasish Ganguly,HydraFacial interest,45000
Amit Pal,9830012345,21/11/2026,amit.pal@example.com,lab,Website,Qualified,Kolkata,Priya Sen,Corporate package,18500`;

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
          Upload a CSV with columns{' '}
          <code>name, mobile, entry_date, email, wing, source, status, city, owner, notes, value</code>.{' '}
          <strong>entry_date</strong> is required (YYYY-MM-DD or DD/MM/YYYY). Duplicate name + mobile rows are skipped.
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
                  <th>Entry date</th>
                  <th>Wing</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={`${r.mobile}-${i}`}>
                    <td>{r.name}</td>
                    <td>{r.mobile}</td>
                    <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB') : '—'}</td>
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

  const derivedLeadIds = useMemo(() => {
    const ids = new Set<string>(presetLeadIds || []);
    for (const aid of presetActivityIds || []) {
      const a = crm.activities.find((x) => x.id === aid);
      const lid = a?.leadId?.trim();
      if (lid) ids.add(lid);
      else if (a?.leadName) {
        const hit = crm.leads.find(
          (l) =>
            l.name === a.leadName &&
            (!a.mobile || String(l.mobile || '').replace(/\D/g, '').slice(-10) === String(a.mobile).replace(/\D/g, '').slice(-10)),
        );
        if (hit) ids.add(hit.id);
      }
    }
    return Array.from(ids);
  }, [presetLeadIds, presetActivityIds, crm.activities, crm.leads]);

  const presetFrom =
    (derivedLeadIds.length
      ? crm.leads.find((l) => l.id === derivedLeadIds[0])?.owner
      : undefined) ||
    (presetActivityIds?.length
      ? crm.activities.find((a) => a.id === presetActivityIds[0])?.owner
      : undefined) ||
    '';

  const [fromOwner, setFromOwner] = useState('');
  const [toOwner, setToOwner] = useState('');
  const [scope, setScope] = useState<'leads' | 'followups' | 'both'>(
    derivedLeadIds.length ? 'both' : defaultScope,
  );
  const [note, setNote] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>(derivedLeadIds);
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>(presetActivityIds || []);

  useEffect(() => {
    if (!owners.length && !presetFrom) return;
    const preferredFrom =
      presetFrom ||
      (owners.includes(crm.userName) ? crm.userName : owners[0] || '');
    setFromOwner((cur) => (presetFrom ? presetFrom : cur && (owners.includes(cur) || cur === preferredFrom) ? cur : preferredFrom));
    setToOwner((cur) => {
      if (cur && owners.includes(cur) && cur !== preferredFrom) return cur;
      return owners.find((o) => o !== preferredFrom) || '';
    });
  }, [owners, presetFrom, crm.userName]);

  const fromLeads = useMemo(() => {
    if (derivedLeadIds.length) {
      const preset = crm.leads.filter((l) => derivedLeadIds.includes(l.id));
      if (preset.length) return preset;
    }
    return crm.leads.filter((l) => l.owner === fromOwner);
  }, [crm.leads, fromOwner, derivedLeadIds]);
  const fromFollowups = useMemo(() => {
    const open = crm.activities.filter((a) => a.owner === fromOwner && !a.done);
    if (derivedLeadIds.length) {
      const linked = open.filter((a) => a.leadId && derivedLeadIds.includes(a.leadId));
      if (linked.length || (presetActivityIds?.length && !open.length)) return linked;
    }
    return open;
  }, [crm.activities, fromOwner, derivedLeadIds, presetActivityIds]);

  useEffect(() => {
    if (derivedLeadIds.length) {
      setSelectedLeadIds(derivedLeadIds);
      setScope('both');
    } else if (!presetLeadIds?.length) {
      setSelectedLeadIds([]);
    }
    if (presetActivityIds?.length) {
      setSelectedActivityIds(presetActivityIds.filter((id) => crm.activities.some((a) => a.id === id && !a.done)));
    } else {
      setSelectedActivityIds([]);
    }
  }, [fromOwner, derivedLeadIds, presetLeadIds, presetActivityIds, crm.activities]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!crm.isManager) {
      crm.pushToast('Only CRM Managers can transfer ownership', 'err');
      return;
    }
    if (!fromOwner || !toOwner) {
      crm.pushToast('Select the new CRM executive', 'err');
      return;
    }
    if (!owners.includes(toOwner)) {
      crm.pushToast('Destination must have CRM Portal access (People → Portal Access)', 'err');
      return;
    }
    if (fromOwner === toOwner) {
      crm.pushToast('Choose a different destination owner', 'err');
      return;
    }
    if (!note.trim()) {
      crm.pushToast('Transfer remarks are required', 'err');
      return;
    }
    const result = await crm.transferOwnership({
      fromOwner,
      toOwner,
      scope,
      leadIds: selectedLeadIds.length ? selectedLeadIds : undefined,
      activityIds: selectedActivityIds.length ? selectedActivityIds : undefined,
      note: note.trim(),
    });
    if (!result) {
      crm.pushToast('Transfer failed', 'err');
      return;
    }
    crm.pushToast(
      `Transferred ${result.leads} lead(s), ${result.followups} pending follow-up(s)${result.deals ? `, ${result.deals} deal(s)` : ''} → ${toOwner}`,
    );
    onClose();
  };

  const toggleLead = (id: string) =>
    setSelectedLeadIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleActivity = (id: string) =>
    setSelectedActivityIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const singleLead = presetLeadIds?.length === 1;
  const title = singleLead || (presetLeadIds?.length || 0) > 0 ? 'Transfer Lead' : 'Transfer ownership';

  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="transfer-owner-form" className="btn btn-primary" disabled={ownersLoading || !owners.length}>
            Confirm transfer
          </button>
        </>
      }
    >
      <form id="transfer-owner-form" className="form-grid" onSubmit={submit}>
        <p className="span-2" style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>
          Select a CRM executive with active <strong>People → Portal Access → CRM Portal</strong>. Pending follow-ups
          move with the lead; completed follow-ups stay, but the linked lead still transfers.
          {ownersLoading ? ' · loading…' : ownersError ? ` · ${ownersError}` : ` · ${owners.length} assigned`}.
          {derivedLeadIds.length
            ? ` · ${derivedLeadIds.length} lead(s) selected from follow-up.`
            : ''}
        </p>
        <Field label="Current owner *">
          <select value={fromOwner} onChange={(e) => setFromOwner(e.target.value)} required disabled={ownersLoading || !owners.length || !!presetLeadIds?.length}>
            <option value="">{ownersLoading ? 'Loading CRM assignees…' : 'Select owner'}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {fromOwner && !owners.includes(fromOwner) ? <option value={fromOwner}>{fromOwner}</option> : null}
          </select>
        </Field>
        <Field label="New employee (CRM executive) *">
          <select value={toOwner} onChange={(e) => setToOwner(e.target.value)} required disabled={ownersLoading || !owners.length}>
            <option value="">{ownersLoading ? 'Loading CRM assignees…' : 'Select employee'}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        {!presetLeadIds?.length && !presetActivityIds?.length ? (
          <Field label="Transfer scope *" span={2}>
            <select value={scope} onChange={(e) => setScope(e.target.value as 'leads' | 'followups' | 'both')}>
              <option value="both">Leads + pending follow-ups</option>
              <option value="leads">Leads (pending follow-ups move too)</option>
              <option value="followups">Pending follow-ups only</option>
            </select>
          </Field>
        ) : null}
        <Field label="Transfer remarks *" span={2}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            rows={3}
            placeholder="Why is this lead being transferred?"
          />
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

/** Service-channel WhatsApp compose (separate Meta number from Franchise WA Centre). */
export function ServiceWhatsAppModal({ lead, onClose }: { lead: CrmLead; onClose: () => void }) {
  const crm = useCrm();
  const templates = useMemo(
    () => loadMessageTemplates().filter((t) => t.status === 'active' && (t.wing === 'all' || t.wing === lead.wing)),
    [lead.wing],
  );
  const defaultBody = useMemo(() => {
    const name = lead.name.split(' ')[0] || lead.name;
    const service =
      lead.serviceRequired?.trim() ||
      (lead.wing === 'aesthetic'
        ? 'aesthetic consultation'
        : lead.wing === 'care'
          ? 'care consultation'
          : lead.wing === 'lab'
            ? 'lab enquiry'
            : 'consultation');
    return `Hi ${name}, this is Smilecure following up on your ${service}. When is a good time to connect?`;
  }, [lead.name, lead.serviceRequired, lead.wing]);
  const [body, setBody] = useState(defaultBody);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const phone = (lead.mobile || '').trim();
    if (!phone) {
      crm.pushToast('No mobile number on this lead', 'err');
      return;
    }
    const message = body.trim();
    if (!message) {
      crm.pushToast('Enter a WhatsApp message', 'err');
      return;
    }
    setBusy(true);
    try {
      await sendCrmWhatsApp({
        phone,
        message,
        contactName: lead.name,
        crmLeadId: lead.id,
        wing: lead.wing || 'lab',
        channel: 'service',
      });
      crm.pushToast(`Service WhatsApp sent to ${lead.name}`);
      onClose();
    } catch (err) {
      crm.pushToast(err instanceof Error ? err.message : 'WhatsApp send failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Service WhatsApp"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy}>
            {busy ? 'Sending…' : 'Send WhatsApp'}
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: '0.82rem' }}>
        Uses the Service Meta number (Settings → WhatsApp API → Service). To:{' '}
        <strong style={{ color: 'var(--ink)' }}>{lead.mobile || '—'}</strong>
      </p>
      {templates.length ? (
        <Field label="Template">
          <select
            defaultValue=""
            onChange={(e) => {
              const tpl = templates.find((t) => t.id === e.target.value);
              if (!tpl) return;
              const name = lead.name.split(' ')[0] || lead.name;
              setBody(
                tpl.body
                  .replace(/\{\{\s*name\s*\}\}/gi, name)
                  .replace(/\{\{\s*service\s*\}\}/gi, lead.serviceRequired || 'enquiry')
                  .replace(/\{\{\s*branch\s*\}\}/gi, lead.city || 'our team'),
              );
            }}
          >
            <option value="">Choose a message template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Message *">
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
