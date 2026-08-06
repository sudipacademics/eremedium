'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE, adminCanHardDelete, adminCanManageAppointments, clearNotificationEntity, peekNotificationEntity } from '@rfms/utils';
import { HardDeleteButton } from './hard-delete-button';
import './appointment-directory.css';

const API_BASE = RFMS_API_BASE;
const STATUS_FILTERS = ['all', 'requested', 'scheduled', 'completed', 'converted_to_lead', 'no_show', 'cancelled'] as const;
const REQUESTED_TIME_SLOTS = ['10:00 AM – 12:00 PM', '12:00 PM – 2:00 PM', '2:00 PM – 4:00 PM', '4:00 PM – 6:00 PM'];

type AppointmentStatus = Exclude<typeof STATUS_FILTERS[number], 'all'>;
type AppointmentHistory = { id: string; type: string; message: string; actor: string; created_at: string };
type Appointment = {
  id: string; name: string; email: string; mobile: string; preferred_date: string; preferred_time: string; topic: string; territory_query: string; notes: string; source: string;
  status: AppointmentStatus; assigned_to: string; meeting_mode: 'virtual_google_meet' | 'office_visit'; confirmed_date: string; confirmed_time: string; meeting_link: string; meeting_location: string;
  franchise_model_discussed: 'FOFO' | 'FOCO' | 'both' | 'not_discussed'; interest_level: 'high' | 'warm' | 'low' | 'not_interested'; outcome: string; converted_lead_id: string; converted_at: string;
  activity_history: AppointmentHistory[]; created_at: string; updated_at: string;
};
type AppointmentDraft = Pick<Appointment, 'assigned_to' | 'meeting_mode' | 'confirmed_date' | 'confirmed_time' | 'meeting_link' | 'meeting_location' | 'territory_query' | 'franchise_model_discussed' | 'interest_level' | 'outcome' | 'status'>;
type ManualAppointmentDraft = Pick<Appointment, 'name' | 'email' | 'mobile' | 'preferred_date' | 'preferred_time' | 'topic' | 'territory_query' | 'notes'>;
type Viewer = { name: string; role: string };
type CrmTeamMember = { id?: string; name: string; role: string; role_label?: string; employee_id?: string };
type Envelope<T> = { success?: boolean; data?: T; error?: { message?: string } };

const readable = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const appointmentModeName = (value: Appointment['meeting_mode']) => value === 'virtual_google_meet' ? 'Google Meet' : 'Office visit';
const dateTime = (date: string, time: string) => date ? `${new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${time ? ` · ${time}` : ''}` : 'Not scheduled';
const isManager = (viewer: Viewer) => adminCanManageAppointments(viewer.role);
const teamMemberLabel = (member: CrmTeamMember) => member.role_label ? `${member.name} · ${member.role_label}` : member.name;
const isUnassigned = (appointment: Appointment) => !appointment.assigned_to || appointment.assigned_to === 'Unassigned';
const isExactTime = (value: string) => /^\d{2}:\d{2}$/.test(value);
const isOfficerSessionExpired = (response: Response) => {
  if (response.status !== 401) return false;
  window.dispatchEvent(new Event('rfms-session-expired'));
  return true;
};
const emptyManualAppointment = (): ManualAppointmentDraft => ({ name: '', email: '', mobile: '', preferred_date: '', preferred_time: REQUESTED_TIME_SLOTS[0], topic: 'Franchise consultation', territory_query: '', notes: '' });

function normaliseAppointment(value: Partial<Appointment>): Appointment {
  const status = ['requested', 'scheduled', 'completed', 'converted_to_lead', 'no_show', 'cancelled'].includes(value.status ?? '') ? value.status as AppointmentStatus : 'requested';
  const model = ['FOFO', 'FOCO', 'both', 'not_discussed'].includes(value.franchise_model_discussed ?? '') ? value.franchise_model_discussed as Appointment['franchise_model_discussed'] : 'not_discussed';
  const interest = ['high', 'warm', 'low', 'not_interested'].includes(value.interest_level ?? '') ? value.interest_level as Appointment['interest_level'] : 'warm';
  return {
    id: value.id ?? `appointment-${value.email ?? value.mobile ?? value.name ?? Math.random().toString(36).slice(2)}`,
    name: value.name ?? 'Unnamed guest', email: value.email ?? '', mobile: value.mobile ?? '', preferred_date: value.preferred_date ?? '', preferred_time: value.preferred_time ?? '', topic: value.topic ?? '', territory_query: value.territory_query ?? '', notes: value.notes ?? '', source: value.source ?? 'website',
    status, assigned_to: value.assigned_to ?? 'Unassigned', meeting_mode: value.meeting_mode === 'virtual_google_meet' ? 'virtual_google_meet' : 'office_visit', confirmed_date: value.confirmed_date ?? '', confirmed_time: value.confirmed_time ?? '', meeting_link: value.meeting_link ?? '', meeting_location: value.meeting_location ?? '', franchise_model_discussed: model, interest_level: interest, outcome: value.outcome ?? '', converted_lead_id: value.converted_lead_id ?? '', converted_at: value.converted_at ?? '', activity_history: Array.isArray(value.activity_history) ? value.activity_history : [], created_at: value.created_at ?? '', updated_at: value.updated_at ?? '',
  };
}

const draftFrom = (appointment: Appointment): AppointmentDraft => ({
  assigned_to: isUnassigned(appointment) ? '' : appointment.assigned_to,
  meeting_mode: appointment.meeting_mode,
  confirmed_date: appointment.confirmed_date || appointment.preferred_date,
  confirmed_time: isExactTime(appointment.confirmed_time) ? appointment.confirmed_time : '',
  meeting_link: appointment.meeting_link,
  meeting_location: appointment.meeting_location,
  territory_query: appointment.territory_query,
  franchise_model_discussed: appointment.franchise_model_discussed,
  interest_level: appointment.interest_level,
  outcome: appointment.outcome,
  status: appointment.status,
});

function AppointmentModal({ appointment, viewer, team, draft, saving, error, onChange, onSave, onConvert, onClose, onHardDelete }: { appointment: Appointment; viewer: Viewer; team: CrmTeamMember[]; draft: AppointmentDraft; saving: boolean; error: string; onChange: <K extends keyof AppointmentDraft>(key: K, value: AppointmentDraft[K]) => void; onSave: (action: 'assignment' | 'schedule' | 'outcome' | 'status') => void; onConvert: (model: 'FOFO' | 'FOCO') => void; onClose: () => void; onHardDelete?: () => Promise<void> }) {
  const manager = isManager(viewer);
  const unassigned = isUnassigned(appointment);
  const canWork = manager || appointment.assigned_to === viewer.name;
  const [conversionModel, setConversionModel] = useState<'FOFO' | 'FOCO'>(appointment.franchise_model_discussed === 'FOCO' ? 'FOCO' : 'FOFO');
  const converted = appointment.status === 'converted_to_lead' || Boolean(appointment.converted_lead_id);
  const locationLabel = draft.meeting_mode === 'virtual_google_meet' ? 'Google Meet link' : 'Office meeting address';
  const plannedDate = appointment.confirmed_date || appointment.preferred_date;
  const plannedTime = appointment.confirmed_time || appointment.preferred_time;

  return <div className="appointment-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="appointment-modal" role="dialog" aria-modal="true" aria-labelledby="appointment-workspace-heading" onMouseDown={(event) => event.stopPropagation()}>
    <header className="appointment-modal-head"><div><p>Appointment workspace</p><h2 id="appointment-workspace-heading">{appointment.name}</h2><span>{appointment.email} · {appointment.mobile}</span></div><div className="appointment-modal-head-actions">{adminCanHardDelete(viewer.role) && onHardDelete ? <HardDeleteButton onConfirm={onHardDelete} /> : null}<button type="button" onClick={onClose}>Close</button></div></header>
    <div className="appointment-person-summary"><span><small>Requested slot</small><b>{dateTime(appointment.preferred_date, appointment.preferred_time)}</b></span><span><small>Discussion topic</small><b>{appointment.topic}</b></span><span><small>Current owner</small><b>{unassigned ? 'Awaiting assignment' : appointment.assigned_to}</b></span><span><small>Workflow status</small><b className={`appointment-status ${appointment.status}`}>{readable(appointment.status)}</b></span></div>
    {converted ? <section className="appointment-converted-notice"><b>CRM lead created</b><p>This appointment has been transferred to Lead Management. The lead keeps the appointment outcome, model discussion, meeting details and activity history.</p><span>Lead reference: {appointment.converted_lead_id}</span></section> : !canWork ? <section className="appointment-assignment-notice"><b>Waiting for manager assignment</b><p>A CRM Manager or Super Admin must assign this appointment before an employee can work on it.</p></section> : <div className="appointment-workflow">
      <section className="appointment-flow-card"><div className="appointment-flow-heading"><span>1</span><div><h3>Assign the consultation</h3><p>Set one accountable CRM employee before scheduling the guest.</p></div></div>{manager ? <div className="appointment-form-grid"><label className="appointment-full">Assigned business consultant<select value={draft.assigned_to} onChange={(event) => onChange('assigned_to', event.target.value)}><option value="">{team.length ? 'Choose a business consultant' : 'No active consultants found'}</option>{team.map((member) => <option key={member.id ?? member.name} value={member.name}>{teamMemberLabel(member)}</option>)}</select></label><button className="appointment-outline" type="button" disabled={saving} onClick={() => onSave('assignment')}>{saving ? 'Saving…' : 'Save assignment'}</button></div> : <p className="appointment-owner-note">You are the assigned CRM employee for this consultation. Only you, a manager, or an administrator can access this appointment.</p>}</section>
      <section className="appointment-flow-card"><div className="appointment-flow-heading"><span>2</span><div><h3>Confirm meeting plan</h3><p>Managers set the exact time and meeting details. Assigned employees can view the plan and join the meeting.</p></div></div>{manager ? <div className="appointment-form-grid"><label>Meeting type<select value={draft.meeting_mode} onChange={(event) => onChange('meeting_mode', event.target.value as Appointment['meeting_mode'])}><option value="virtual_google_meet">Virtual — Google Meet</option><option value="office_visit">Office visit</option></select></label><label>Confirmed date<input type="date" value={draft.confirmed_date} onChange={(event) => onChange('confirmed_date', event.target.value)} /></label><label>Exact meeting time<input type="time" value={draft.confirmed_time} onChange={(event) => onChange('confirmed_time', event.target.value)} /></label><label className="appointment-full">{locationLabel}<input value={draft.meeting_mode === 'virtual_google_meet' ? draft.meeting_link : draft.meeting_location} placeholder={draft.meeting_mode === 'virtual_google_meet' ? 'https://meet.google.com/...' : 'Remedium Lab Franchisee Hub, Newtown'} onChange={(event) => onChange(draft.meeting_mode === 'virtual_google_meet' ? 'meeting_link' : 'meeting_location', event.target.value)} /></label><button className="appointment-primary" type="button" disabled={saving} onClick={() => onSave('schedule')}>{saving ? 'Saving…' : 'Confirm appointment plan'}</button></div> : <div className="appointment-plan-readonly"><div><span>Meeting type</span><b>{appointmentModeName(appointment.meeting_mode)}</b></div><div><span>Confirmed slot</span><b>{dateTime(plannedDate, plannedTime)}</b></div>{appointment.meeting_mode === 'virtual_google_meet' ? <div className="appointment-full"><span>Google Meet</span>{appointment.meeting_link ? <a className="appointment-join-link" href={appointment.meeting_link} target="_blank" rel="noreferrer">Join Google Meet ↗</a> : <b>Meeting link will be added by the manager.</b>}</div> : <div className="appointment-full"><span>Office visit location</span><b>{appointment.meeting_location || 'Meeting location will be confirmed by the manager.'}</b></div>}</div>}</section>
      <section className="appointment-flow-card"><div className="appointment-flow-heading"><span>3</span><div><h3>Record consultation outcome</h3><p>Keep the model discussion, preferred location, guest interest and follow-up context ready for the CRM team.</p></div></div><div className="appointment-form-grid"><label>Franchise model discussed<select value={draft.franchise_model_discussed} onChange={(event) => onChange('franchise_model_discussed', event.target.value as Appointment['franchise_model_discussed'])}><option value="not_discussed">Not discussed</option><option value="FOFO">FOFO</option><option value="FOCO">FOCO</option><option value="both">Both FOFO and FOCO</option></select></label><label>Opportunity interest<select value={draft.interest_level} onChange={(event) => onChange('interest_level', event.target.value as Appointment['interest_level'])}><option value="high">High — ready to progress</option><option value="warm">Warm — needs follow-up</option><option value="low">Low — nurture</option><option value="not_interested">Not interested</option></select></label><label className="appointment-full">Preferred franchise location<input value={draft.territory_query} placeholder="e.g. Newtown, Kolkata" onChange={(event) => onChange('territory_query', event.target.value)} /></label><label className="appointment-full">Consultation outcome<textarea value={draft.outcome} placeholder="Summarise the discussion, questions, decision and agreed next action." onChange={(event) => onChange('outcome', event.target.value)} /></label><button className="appointment-primary" type="button" disabled={saving} onClick={() => onSave('outcome')}>{saving ? 'Saving…' : 'Complete and save outcome'}</button></div></section>
      <section className="appointment-flow-card appointment-conversion"><div className="appointment-flow-heading"><span>4</span><div><h3>Transfer valuable opportunity to CRM</h3><p>Available after the appointment is completed. The new lead receives all consultation information and its assigned employee.</p></div></div>{appointment.status === 'completed' ? <div className="appointment-convert-row"><label>CRM lead model<select value={conversionModel} onChange={(event) => setConversionModel(event.target.value as 'FOFO' | 'FOCO')}><option value="FOFO">FOFO</option><option value="FOCO">FOCO</option></select></label><button className="appointment-convert" type="button" disabled={saving} onClick={() => onConvert(conversionModel)}>{saving ? 'Creating lead…' : 'Create CRM lead from appointment'}</button></div> : <p className="appointment-lock-note">Complete and save the consultation outcome to unlock lead conversion.</p>}</section>
      <section className="appointment-close-card"><label>Close as<select value={draft.status} onChange={(event) => onChange('status', event.target.value as AppointmentStatus)}><option value="requested">Requested</option><option value="scheduled">Scheduled</option><option value="no_show">No show</option><option value="cancelled">Cancelled</option></select></label><button className="appointment-text-button" type="button" disabled={saving} onClick={() => onSave('status')}>Save status</button></section>
    </div>}
    {error ? <p className="appointment-error" role="alert">{error}</p> : null}
    <section className="appointment-history"><div><h3>Appointment activity</h3><span>{appointment.activity_history.length} entries</span></div>{appointment.activity_history.length ? [...appointment.activity_history].reverse().map((item) => <article key={item.id}><b>{readable(item.type)}</b><p>{item.message}</p><small>{item.actor} · {new Date(item.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></article>) : <p>No appointment activity has been recorded.</p>}</section>
  </section></div>;
}

export function AppointmentDirectory({ token, search, viewer }: { token: string; search: string; viewer: Viewer }) {
  const manager = isManager(viewer);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [team, setTeam] = useState<CrmTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]>('all');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualAppointmentDraft>(emptyManualAppointment);

  const loadTeam = useCallback(async () => {
    if (!manager) return;
    try {
      const response = await fetch(`${API_BASE}/appointments/team`, { headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json() as Envelope<CrmTeamMember[]>;
      if (response.ok && result.success && Array.isArray(result.data)) setTeam(result.data);
    } catch {
      /* Keep the last loaded roster if the refresh fails. */
    }
  }, [manager, token]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const teamRequest = manager ? fetch(`${API_BASE}/appointments/team`, { headers }) : Promise.resolve(null);
      const [appointmentsResponse, teamResponse] = await Promise.all([fetch(`${API_BASE}/appointments`, { headers }), teamRequest]);
      if (isOfficerSessionExpired(appointmentsResponse) || (teamResponse && isOfficerSessionExpired(teamResponse))) return;
      const appointmentResult = await appointmentsResponse.json() as Envelope<Appointment[]>;
      const teamResult = teamResponse ? await teamResponse.json() as Envelope<CrmTeamMember[]> : null;
      if (!appointmentsResponse.ok || !appointmentResult.success || !Array.isArray(appointmentResult.data)) throw new Error(appointmentResult.error?.message ?? 'Unable to load appointments.');
      setAppointments(appointmentResult.data.map(normaliseAppointment));
      setTeam(teamResponse?.ok && teamResult?.success && Array.isArray(teamResult.data) ? teamResult.data : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load appointments.');
    } finally { setLoading(false); }
  }, [manager, token]);

  useEffect(() => { void load(); }, [load]);
  const selected = appointments.find((appointment) => appointment.id === selectedId) ?? null;
  const visibleAppointments = useMemo(() => appointments.filter((appointment) => {
    const matchesFilter = filter === 'all' || appointment.status === filter;
    const value = `${appointment.name} ${appointment.email} ${appointment.mobile} ${appointment.topic} ${appointment.assigned_to} ${appointment.status}`.toLowerCase();
    return matchesFilter && value.includes(search.trim().toLowerCase());
  }), [appointments, filter, search]);
  const setDraftField = <K extends keyof AppointmentDraft>(key: K, value: AppointmentDraft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const setManualField = <K extends keyof ManualAppointmentDraft>(key: K, value: ManualAppointmentDraft[K]) => setManualDraft((current) => ({ ...current, [key]: value }));
  const open = (appointment: Appointment) => { setSelectedId(appointment.id); setDraft(draftFrom(appointment)); setError(''); if (manager) void loadTeam(); };
  const replaceAppointment = (value: Appointment) => setAppointments((current) => current.map((appointment) => appointment.id === value.id ? normaliseAppointment(value) : appointment));

  useEffect(() => {
    if (!appointments.length) return;
    const entityId = peekNotificationEntity();
    if (!entityId) return;
    const appointment = appointments.find((item) => item.id === entityId);
    if (!appointment) return;
    clearNotificationEntity();
    open(appointment);
  }, [appointments]);

  async function save(action: 'assignment' | 'schedule' | 'outcome' | 'status') {
    if (!selected || !draft) return;
    setSaving(true); setError('');
    const payload: Record<string, string> = { action };
    if (action === 'assignment') payload.assigned_to = draft.assigned_to;
    if (action === 'schedule' && manager) Object.assign(payload, { meeting_mode: draft.meeting_mode, confirmed_date: draft.confirmed_date, confirmed_time: draft.confirmed_time, meeting_link: draft.meeting_link, meeting_location: draft.meeting_location });
    if (action === 'outcome') Object.assign(payload, { territory_query: draft.territory_query, franchise_model_discussed: draft.franchise_model_discussed, interest_level: draft.interest_level, outcome: draft.outcome });
    if (action === 'status') payload.status = draft.status;
    try {
      const response = await fetch(`${API_BASE}/appointments/${selected.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json() as Envelope<Appointment>;
      if (!response.ok || !result.success || !result.data) throw new Error(result.error?.message ?? 'Unable to save appointment.');
      const next = normaliseAppointment(result.data); replaceAppointment(next); setDraft(draftFrom(next));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save appointment.'); } finally { setSaving(false); }
  }

  async function convert(model: 'FOFO' | 'FOCO') {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/appointments/${selected.id}/convert-to-lead`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ franchise_model: model, territory_query: draft?.territory_query ?? '' }) });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json() as Envelope<{ appointment: Appointment }>;
      if (!response.ok || !result.success || !result.data?.appointment) throw new Error(result.error?.message ?? 'Unable to create CRM lead from this appointment.');
      const next = normaliseAppointment(result.data.appointment); replaceAppointment(next); setDraft(draftFrom(next));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to create CRM lead from this appointment.'); } finally { setSaving(false); }
  }

  async function createManualAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manager) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/appointments`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(manualDraft) });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json() as Envelope<Appointment>;
      if (!response.ok || !result.success || !result.data) throw new Error(result.error?.message ?? 'Unable to add appointment.');
      const next = normaliseAppointment(result.data);
      setAppointments((current) => [next, ...current]);
      setManualDraft(emptyManualAppointment());
      setManualOpen(false);
      open(next);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to add appointment.'); } finally { setSaving(false); }
  }

  async function hardDeleteSelectedAppointment() {
    if (!selected || !adminCanHardDelete(viewer.role)) throw new Error('Only a Super Admin can permanently delete appointments.');
    const response = await fetch(`${API_BASE}/appointments/${selected.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (isOfficerSessionExpired(response)) return;
    const result = await response.json() as Envelope<{ deleted?: boolean }>;
    if (!response.ok || !result.success) throw new Error(result.error?.message ?? 'Unable to permanently delete this appointment.');
    setAppointments((current) => current.filter((item) => item.id !== selected.id));
    setSelectedId('');
    setDraft(null);
    setError('');
  }

  const requested = appointments.filter((appointment) => appointment.status === 'requested').length;
  const scheduled = appointments.filter((appointment) => appointment.status === 'scheduled').length;
  const readyToConvert = appointments.filter((appointment) => appointment.status === 'completed' && !appointment.converted_lead_id).length;

  return <section className="appointment-directory">
    <div className="title-row"><div><p className="appointment-kicker">Consultation workflow</p><h1>Appointment management</h1><p>Website consultation requests arrive here. Managers assign, schedule and oversee each consultation; the assigned employee records the outcome.</p></div><div className="appointment-title-actions">{manager ? <button className="appointment-primary" type="button" onClick={() => { setManualOpen(true); setError(''); }}>+ Add appointment</button> : null}<button className="date" type="button" onClick={() => void load()}>Refresh</button></div></div>
    <div className="appointment-flow-strip"><span className="active">1. Request received</span><i /> <span>2. Assign owner</span><i /> <span>3. Manager schedules meeting</span><i /> <span>4. Employee outcome</span><i /> <span>5. CRM lead</span></div>
    {manualOpen ? <section className="panel appointment-create-card"><div className="panel-head"><div><h2>Add consultation appointment</h2><p>Create an appointment entered by the manager. It follows the same assignment, scheduling and CRM workflow as website requests.</p></div><button className="appointment-text-button" type="button" onClick={() => setManualOpen(false)}>Cancel</button></div><form className="appointment-form-grid" onSubmit={(event) => void createManualAppointment(event)}><label>Guest name<input required value={manualDraft.name} onChange={(event) => setManualField('name', event.target.value)} /></label><label>Mobile number<input required inputMode="numeric" value={manualDraft.mobile} onChange={(event) => setManualField('mobile', event.target.value)} /></label><label>Email address<input required type="email" value={manualDraft.email} onChange={(event) => setManualField('email', event.target.value)} /></label><label>Requested date<input required type="date" value={manualDraft.preferred_date} onChange={(event) => setManualField('preferred_date', event.target.value)} /></label><label>Requested time window<select value={manualDraft.preferred_time} onChange={(event) => setManualField('preferred_time', event.target.value)}>{REQUESTED_TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label><label>Consultation topic<input required value={manualDraft.topic} onChange={(event) => setManualField('topic', event.target.value)} placeholder="e.g. FOCO franchise consultation" /></label><label className="appointment-full">Preferred franchise location<input value={manualDraft.territory_query} onChange={(event) => setManualField('territory_query', event.target.value)} placeholder="e.g. Newtown, Kolkata" /></label><label className="appointment-full">Manager notes<textarea value={manualDraft.notes} onChange={(event) => setManualField('notes', event.target.value)} placeholder="Any context for the CRM employee." /></label><button className="appointment-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create appointment'}</button></form></section> : null}
    <div className="appointment-metrics"><article><span>All appointments</span><b>{appointments.length}</b><small>Consultation requests in this workspace</small></article><article><span>Needs assignment</span><b>{requested}</b><small>Manager attention required</small></article><article><span>Scheduled</span><b>{scheduled}</b><small>Confirmed virtual and office meetings</small></article><article><span>Ready for CRM</span><b>{readyToConvert}</b><small>Completed consultations awaiting lead conversion</small></article></div>
    <div className="appointment-filter-row"><div>{STATUS_FILTERS.map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All appointments' : readable(item)} <span>{item === 'all' ? appointments.length : appointments.filter((appointment) => appointment.status === item).length}</span></button>)}</div><p>{manager ? 'Managers can assign any employee and set exact meeting details.' : 'You can see and manage only the appointments assigned to you.'}</p></div>
    {error && !selected ? <p className="appointment-error" role="alert">{error}</p> : null}
    <section className="panel appointment-table-card"><div className="panel-head"><div><h2>Consultation queue</h2><p>{loading ? 'Loading appointment workflow…' : `${visibleAppointments.length} appointment record${visibleAppointments.length === 1 ? '' : 's'} in this view.`}</p></div><p className="appointment-table-note">Open a record to assign the employee, confirm the meeting plan, record its outcome and convert it to a CRM lead.</p></div><div className="table-wrap"><table><thead><tr><th>Guest</th><th>Requested slot</th><th>Assigned owner</th><th>Meeting plan</th><th>Outcome</th><th>Status</th><th /></tr></thead><tbody>{visibleAppointments.map((appointment) => <tr key={appointment.id}><td><b>{appointment.name}</b><small>{appointment.email}<br />{appointment.mobile}</small></td><td>{dateTime(appointment.preferred_date, appointment.preferred_time)}</td><td>{isUnassigned(appointment) ? <span className="appointment-unassigned">Unassigned</span> : appointment.assigned_to}</td><td><b>{appointmentModeName(appointment.meeting_mode)}</b><small>{dateTime(appointment.confirmed_date, appointment.confirmed_time)}</small></td><td>{appointment.outcome ? <small>{appointment.outcome.slice(0, 78)}{appointment.outcome.length > 78 ? '…' : ''}</small> : <span className="appointment-pending">Awaiting consultation</span>}</td><td><span className={`appointment-status ${appointment.status}`}>{readable(appointment.status)}</span></td><td><button className="row-action" type="button" onClick={() => open(appointment)}>{appointment.status === 'converted_to_lead' ? 'View record' : 'Manage'}</button></td></tr>)}{!loading && !visibleAppointments.length ? <tr><td className="empty" colSpan={7}>No appointments match this workflow view.</td></tr> : null}</tbody></table></div></section>
    {selected && draft ? <AppointmentModal appointment={selected} viewer={viewer} team={team} draft={draft} saving={saving} error={error} onChange={setDraftField} onSave={(action) => void save(action)} onConvert={(model) => void convert(model)} onClose={() => { setSelectedId(''); setDraft(null); setError(''); }} onHardDelete={hardDeleteSelectedAppointment} /> : null}
  </section>;
}
