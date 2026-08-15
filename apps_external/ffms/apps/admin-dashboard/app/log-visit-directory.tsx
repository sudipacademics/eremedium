'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE, adminCanHardDelete, adminCanManageCrm } from '@rfms/utils';
import { HardDeleteButton } from './hard-delete-button';
import './log-visit-directory.css';

const API_BASE = RFMS_API_BASE;

type Visit = {
  id: string;
  hec_visit_id?: string;
  hec_lead_id?: string;
  rfms_lead_id?: string;
  lead_name?: string;
  lead_phone?: string;
  reach_user?: string;
  sales_rep_id?: string;
  visit_date?: string;
  visit_time?: string;
  purpose?: string;
  outcome?: string;
  visit_status?: string;
  duration_minutes?: number;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string;
  photo_url?: string;
  photo_data_url?: string;
  assigned_from?: string;
  created_at?: string;
};

type ReachLead = {
  id: string;
  name: string;
  email: string;
  mobile: string;
  stage: string;
  assigned_to: string;
  territory_query?: string;
  hec_lead_id?: string;
  reach_lead_source?: string;
  reach_user_name?: string;
  reach_user_email?: string;
  assignee_role?: string;
  created_at?: string;
  updated_at?: string;
};

type PerformanceRow = {
  reach_user: string;
  sales_rep_id?: string;
  total_visits: number;
  completed: number;
  assigned: number;
  positive: number;
  with_photo: number;
  with_gps: number;
};

type Stats = {
  total_visits: number;
  visits_today: number;
  reach_leads: number;
  open_leads: number;
  assigned_visits?: number;
  completed_visits?: number;
};
type Viewer = { name: string; role: string };
type TeamMember = { name: string; role?: string; role_label?: string };
type ReachRep = {
  name: string;
  full_name?: string;
  display_name?: string;
  rep_code?: string;
  territory_region?: string;
  linked_user?: string;
  user?: string;
  reach_user_id?: string;
  employee_id?: string;
  employee_number?: string;
};

const readable = (value?: string | null) => (value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export function LogVisitDirectory({
  token,
  search,
  notify,
  viewer,
}: {
  token: string;
  search: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  viewer: Viewer;
}) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [leads, setLeads] = useState<ReachLead[]>([]);
  const [performance, setPerformance] = useState<PerformanceRow[]>([]);
  const [stats, setStats] = useState<Stats>({ total_visits: 0, visits_today: 0, reach_leads: 0, open_leads: 0 });
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [reachReps, setReachReps] = useState<ReachRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignLeadId, setAssignLeadId] = useState('');
  const [assigneeRole, setAssigneeRole] = useState<'reach' | 'crm' | 'business_consultant'>('reach');
  const [assignUser, setAssignUser] = useState('');
  const [assignRepId, setAssignRepId] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const canManage = adminCanManageCrm(viewer.role);

  async function hardDeleteSelectedVisit() {
    if (!selectedVisit || !adminCanHardDelete(viewer.role)) throw new Error('Only a Super Admin can permanently delete visits.');
    const response = await fetch(`${API_BASE}/sales-visits/${selectedVisit.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? 'Unable to permanently delete this visit.');
    setVisits((current) => current.filter((item) => item.id !== selectedVisit.id));
    setSelectedVisit(null);
    notify('Visit permanently deleted from FFMS and linked portals.');
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [visitRes, teamRes, repsRes] = await Promise.all([
        fetch(`${API_BASE}/sales-visits`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/crm/team`, { headers: { Authorization: `Bearer ${token}` } }),
        canManage
          ? fetch(`${API_BASE}/sales-visits/reach-reps`, { headers: { Authorization: `Bearer ${token}` } })
          : Promise.resolve(null),
      ]);
      if (!visitRes.ok) throw new Error('Unable to load Log Visit data.');
      const visitPayload = await visitRes.json();
      const data = visitPayload?.data || {};
      setVisits(Array.isArray(data.visits) ? data.visits : []);
      setLeads(Array.isArray(data.reach_leads) ? data.reach_leads : []);
      setPerformance(Array.isArray(data.performance) ? data.performance : []);
      setStats(data.stats || { total_visits: 0, visits_today: 0, reach_leads: 0, open_leads: 0 });
      if (teamRes.ok) {
        const teamPayload = await teamRes.json();
        const members = Array.isArray(teamPayload?.data) ? teamPayload.data : [];
        setTeam(members);
      }
      if (repsRes && repsRes.ok) {
        const repsPayload = await repsRes.json();
        setReachReps(Array.isArray(repsPayload?.data?.reps) ? repsPayload.data.reps : []);
      } else if (repsRes && !repsRes.ok) {
        const repsPayload = await repsRes.json().catch(() => null);
        setReachReps([]);
        setError(repsPayload?.error?.message || 'Unable to load REACH users from ERP.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Log Visit module.');
    } finally {
      setLoading(false);
    }
  }, [token, canManage]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredVisits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter((visit) =>
      `${visit.lead_name} ${visit.reach_user} ${visit.purpose} ${visit.outcome} ${visit.notes} ${visit.visit_status}`.toLowerCase().includes(q),
    );
  }, [visits, search]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) =>
      `${lead.name} ${lead.mobile} ${lead.assigned_to} ${lead.territory_query} ${lead.stage} ${lead.reach_user_name}`.toLowerCase().includes(q),
    );
  }, [leads, search]);

  const crmOptions = useMemo(() => {
    return team
      .filter((member) => {
        const role = String(member.role || '').toLowerCase();
        if (assigneeRole === 'crm') return role === 'crm' || role === 'manager' || role === 'super_admin' || !role;
        if (assigneeRole === 'business_consultant') return role.includes('business') || role === 'business_consultant' || role === 'manager' || role === 'super_admin';
        return true;
      })
      .map((member) => member.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [team, assigneeRole]);

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !assignLeadId) return;
    if (assigneeRole === 'reach' && !assignRepId) {
      notify('Choose a REACH user.', 'err');
      return;
    }
    if (assigneeRole !== 'reach' && !assignUser) {
      notify('Choose a CRM / BC assignee.', 'err');
      return;
    }
    setSaving(true);
    try {
      const reachRep = reachReps.find((rep) => rep.name === assignRepId);
      const displayName = assigneeRole === 'reach'
        ? (reachRep?.full_name || assignRepId)
        : assignUser;
      const response = await fetch(`${API_BASE}/sales-visits/assign-lead`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: assignLeadId,
          assignee_role: assigneeRole,
          sales_rep_id: assigneeRole === 'reach' ? assignRepId : '',
          reach_user: displayName,
          assigned_to_name: displayName,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error?.message || 'Assignment failed.');
      }
      notify(
        assigneeRole === 'reach'
          ? `Log Visit assigned to ${displayName} — synced to REACH.`
          : `Lead assigned to ${displayName} (${readable(assigneeRole)}).`,
        'ok',
      );
      setAssignLeadId('');
      setAssignUser('');
      setAssignRepId('');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Assignment failed.', 'err');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="log-visit-module">
      <div className="module-summary">
        <section><span>REACH visits</span><b>{stats.total_visits}</b><small>Submitted + assigned</small></section>
        <section><span>Assigned</span><b>{stats.assigned_visits ?? 0}</b><small>Pending field Log Visits</small></section>
        <section><span>Completed</span><b>{stats.completed_visits ?? 0}</b><small>Reports with GPS / notes</small></section>
        <section><span>Open pipeline</span><b>{stats.open_leads}</b><small>Active assignable leads</small></section>
      </div>

      {error ? <p className="log-visit-error">{error}</p> : null}

      {canManage ? (
        <section className="panel data-panel log-visit-assign">
          <header className="panel-head">
            <div>
              <h2>Assign lead</h2>
              <p>Route any active FFMS or REACH lead to CRM, Business Consultant, or a REACH user for Log Visit. REACH assignments sync immediately to the field portal.</p>
            </div>
            <button className="date" type="button" onClick={() => void load()}>Refresh</button>
          </header>
          <form className="log-visit-assign-form" onSubmit={onAssign}>
            <label>
              Lead
              <select required value={assignLeadId} onChange={(event) => setAssignLeadId(event.target.value)}>
                <option value="">Choose lead</option>
                {filteredLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} · {readable(lead.stage)} · {lead.assigned_to || 'Unassigned'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assign to
              <select value={assigneeRole} onChange={(event) => {
                setAssigneeRole(event.target.value as typeof assigneeRole);
                setAssignUser('');
                setAssignRepId('');
              }}>
                <option value="reach">REACH user (Log Visit)</option>
                <option value="crm">CRM</option>
                <option value="business_consultant">Business Consultant</option>
              </select>
            </label>
            {assigneeRole === 'reach' ? (
              <label>
                REACH user
                <select required value={assignRepId} onChange={(event) => setAssignRepId(event.target.value)}>
                  <option value="">{reachReps.length ? 'Choose REACH user' : 'No REACH users loaded'}</option>
                  {reachReps.map((rep) => (
                    <option key={rep.name} value={rep.name}>
                      {rep.full_name || rep.display_name || rep.name}
                      {rep.territory_region ? ` · ${rep.territory_region}` : ''}
                      {rep.rep_code || rep.reach_user_id ? ` (${rep.rep_code || rep.reach_user_id})` : ''}
                      {rep.employee_number || rep.employee_id
                        ? ` · Emp ${rep.employee_number || rep.employee_id}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                {assigneeRole === 'crm' ? 'CRM user' : 'Business Consultant'}
                <select required value={assignUser} onChange={(event) => setAssignUser(event.target.value)}>
                  <option value="">Choose user</option>
                  {crmOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            )}
            <button className="lead-primary" type="submit" disabled={saving || !assignLeadId}>
              {saving ? 'Assigning…' : 'Assign'}
            </button>
          </form>
        </section>
      ) : null}

      <section className="panel data-panel">
        <header className="panel-head">
          <div>
            <h2>REACH user performance</h2>
            <p>Visit completion, GPS capture, photos and positive outcomes by field user.</p>
          </div>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>REACH user</th><th>Total</th><th>Assigned</th><th>Completed</th><th>Positive</th><th>GPS</th><th>Photos</th></tr>
            </thead>
            <tbody>
              {performance.map((row) => (
                <tr key={row.reach_user}>
                  <td><b>{row.reach_user}</b><br /><small>{row.sales_rep_id || '—'}</small></td>
                  <td>{row.total_visits}</td>
                  <td>{row.assigned}</td>
                  <td>{row.completed}</td>
                  <td>{row.positive}</td>
                  <td>{row.with_gps}</td>
                  <td>{row.with_photo}</td>
                </tr>
              ))}
              {!loading && performance.length === 0 ? (
                <tr><td className="empty" colSpan={7}>No visit activity yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-panel">
        <header className="panel-head">
          <div>
            <h2>REACH lead status</h2>
            <p>{loading ? 'Loading synced REACH leads…' : `${filteredLeads.length} lead${filteredLeads.length === 1 ? '' : 's'} from REACH Portal`}</p>
          </div>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lead</th><th>Source / REACH user</th><th>Territory</th><th>Assigned</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.id}>
                  <td><b>{lead.name}</b><br /><small>{lead.mobile} · {lead.hec_lead_id || lead.id}</small></td>
                  <td>
                    {lead.reach_lead_source || 'REACH'}
                    <br />
                    <small>{lead.reach_user_name || lead.reach_user_email || '—'}</small>
                  </td>
                  <td>{lead.territory_query || '—'}</td>
                  <td>
                    {lead.assigned_to || 'Unassigned'}
                    <br />
                    <small>{lead.assignee_role ? readable(lead.assignee_role) : '—'}</small>
                  </td>
                  <td><span className={`lead-stage ${lead.stage}`}>{readable(lead.stage)}</span></td>
                  <td>{dateTime(lead.created_at || lead.updated_at)}</td>
                </tr>
              ))}
              {!loading && filteredLeads.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No REACH leads yet. Create a lead in REACH Portal to sync it here.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-panel">
        <header className="panel-head">
          <div>
            <h2>Visit reports & history</h2>
            <p>{loading ? 'Loading visit reports…' : `${filteredVisits.length} record${filteredVisits.length === 1 ? '' : 's'} — open a row for GPS, photos and remarks`}</p>
          </div>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Lead</th><th>REACH user</th><th>Status / outcome</th><th>GPS</th><th>Evidence</th><th /></tr>
            </thead>
            <tbody>
              {filteredVisits.map((visit) => (
                <tr key={visit.id}>
                  <td>{visit.visit_date || dateTime(visit.created_at)}{visit.visit_time ? <><br /><small>{visit.visit_time}</small></> : null}</td>
                  <td><b>{visit.lead_name || 'General visit'}</b><br /><small>{visit.lead_phone || visit.hec_lead_id || '—'}</small></td>
                  <td>{visit.reach_user || '—'}{visit.assigned_from ? <><br /><small>via {visit.assigned_from}</small></> : null}</td>
                  <td>
                    <b>{readable(visit.visit_status || 'completed')}</b>
                    <br />
                    <small>{visit.purpose || 'Meet Lead'} · {visit.outcome || 'No outcome'}{visit.duration_minutes ? ` · ${visit.duration_minutes} min` : ''}</small>
                  </td>
                  <td>{visit.latitude != null && visit.longitude != null && (Number(visit.latitude) || Number(visit.longitude)) ? `${Number(visit.latitude).toFixed(4)}, ${Number(visit.longitude).toFixed(4)}` : '—'}</td>
                  <td>{visit.photo_data_url || visit.photo_url ? 'Photo' : '—'}{visit.notes ? <><br /><small>{visit.notes.slice(0, 60)}{visit.notes.length > 60 ? '…' : ''}</small></> : null}</td>
                  <td><button className="row-action" type="button" onClick={() => setSelectedVisit(visit)}>Open</button></td>
                </tr>
              ))}
              {!loading && filteredVisits.length === 0 ? (
                <tr><td className="empty" colSpan={7}>No REACH visit reports yet. Field users log visits from reach.e-remedium.in/sales/visit.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedVisit ? (
        <div className="log-visit-modal-backdrop" role="presentation" onMouseDown={() => setSelectedVisit(null)}>
          <section className="log-visit-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="lead-kicker">Visit detail</p>
                <h2>{selectedVisit.lead_name || 'Field visit'}</h2>
                <p>{selectedVisit.reach_user || '—'} · {readable(selectedVisit.visit_status || 'completed')}</p>
              </div>
              <div className="log-visit-modal-actions">
                {adminCanHardDelete(viewer.role) ? <HardDeleteButton onConfirm={hardDeleteSelectedVisit} /> : null}
                <button type="button" onClick={() => setSelectedVisit(null)}>Close</button>
              </div>
            </header>
            <div className="log-visit-modal-grid">
              <span><small>Date / time</small><b>{selectedVisit.visit_date || dateTime(selectedVisit.created_at)} {selectedVisit.visit_time || ''}</b></span>
              <span><small>Purpose</small><b>{selectedVisit.purpose || '—'}</b></span>
              <span><small>Outcome</small><b>{selectedVisit.outcome || '—'}</b></span>
              <span><small>Duration</small><b>{selectedVisit.duration_minutes ? `${selectedVisit.duration_minutes} min` : '—'}</b></span>
              <span><small>GPS</small><b>{selectedVisit.latitude != null && selectedVisit.longitude != null ? `${selectedVisit.latitude}, ${selectedVisit.longitude}` : '—'}</b></span>
              <span><small>Assigned from</small><b>{selectedVisit.assigned_from || '—'}</b></span>
            </div>
            <p className="log-visit-remarks"><small>Remarks</small>{selectedVisit.notes || 'No remarks submitted.'}</p>
            {(selectedVisit.photo_data_url || selectedVisit.photo_url) ? (
              <figure className="log-visit-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedVisit.photo_data_url || selectedVisit.photo_url} alt="Visit photo evidence" />
              </figure>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
