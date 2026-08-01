'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE, adminCanManageCrm } from '@rfms/utils';
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
  visit_date?: string;
  visit_time?: string;
  purpose?: string;
  outcome?: string;
  duration_minutes?: number;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string;
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
  updated_at?: string;
};

type Stats = { total_visits: number; visits_today: number; reach_leads: number; open_leads: number };
type Viewer = { name: string; role: string };
type TeamMember = { name: string; role?: string; role_label?: string };

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
  const [stats, setStats] = useState<Stats>({ total_visits: 0, visits_today: 0, reach_leads: 0, open_leads: 0 });
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignLeadId, setAssignLeadId] = useState('');
  const [assignUser, setAssignUser] = useState('');
  const [saving, setSaving] = useState(false);
  const canManage = adminCanManageCrm(viewer.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [visitRes, teamRes] = await Promise.all([
        fetch(`${API_BASE}/sales-visits`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/crm/team`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!visitRes.ok) throw new Error('Unable to load Log Visit data.');
      const visitPayload = await visitRes.json();
      const data = visitPayload?.data || {};
      setVisits(Array.isArray(data.visits) ? data.visits : []);
      setLeads(Array.isArray(data.reach_leads) ? data.reach_leads : []);
      setStats(data.stats || { total_visits: 0, visits_today: 0, reach_leads: 0, open_leads: 0 });
      if (teamRes.ok) {
        const teamPayload = await teamRes.json();
        const members = Array.isArray(teamPayload?.data) ? teamPayload.data : [];
        setTeam(members);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Log Visit module.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredVisits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter((visit) =>
      `${visit.lead_name} ${visit.reach_user} ${visit.purpose} ${visit.outcome} ${visit.notes}`.toLowerCase().includes(q),
    );
  }, [visits, search]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) =>
      `${lead.name} ${lead.mobile} ${lead.assigned_to} ${lead.territory_query} ${lead.stage}`.toLowerCase().includes(q),
    );
  }, [leads, search]);

  const assignOptions = useMemo(() => {
    const names = new Set<string>();
    team.forEach((member) => { if (member.name) names.add(member.name); });
    leads.forEach((lead) => { if (lead.assigned_to && lead.assigned_to !== 'Unassigned') names.add(lead.assigned_to); });
    visits.forEach((visit) => { if (visit.reach_user) names.add(visit.reach_user); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [team, leads, visits]);

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !assignLeadId || !assignUser) return;
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/sales-visits/assign-lead`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: assignLeadId, reach_user: assignUser }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error?.message || 'Assignment failed.');
      }
      notify(`Assigned ${assignUser} to lead.`, 'ok');
      setAssignLeadId('');
      setAssignUser('');
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
        <section><span>REACH visits</span><b>{stats.total_visits}</b><small>All submitted visit reports</small></section>
        <section><span>Today</span><b>{stats.visits_today}</b><small>Logged today from REACH</small></section>
        <section><span>REACH leads</span><b>{stats.reach_leads}</b><small>Synced from REACH Portal</small></section>
        <section><span>Open pipeline</span><b>{stats.open_leads}</b><small>Active REACH leads</small></section>
      </div>

      {error ? <p className="log-visit-error">{error}</p> : null}

      {canManage ? (
        <section className="panel data-panel log-visit-assign">
          <header className="panel-head">
            <div>
              <h2>Assign REACH user</h2>
              <p>Route a REACH / CRM lead to a field user so visit progress is tracked against the right owner.</p>
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
              REACH / CRM user
              <select required value={assignUser} onChange={(event) => setAssignUser(event.target.value)}>
                <option value="">Choose user</option>
                {assignOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <button className="lead-primary" type="submit" disabled={saving || !assignLeadId || !assignUser}>
              {saving ? 'Assigning…' : 'Assign user'}
            </button>
          </form>
        </section>
      ) : null}

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
              <tr><th>Lead</th><th>Contact</th><th>Territory</th><th>Assigned REACH user</th><th>Status</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.id}>
                  <td><b>{lead.name}</b><br /><small>{lead.hec_lead_id || lead.id}</small></td>
                  <td>{lead.mobile}<br /><small>{lead.email}</small></td>
                  <td>{lead.territory_query || '—'}</td>
                  <td>{lead.assigned_to || 'Unassigned'}</td>
                  <td><span className={`lead-stage ${lead.stage}`}>{readable(lead.stage)}</span></td>
                  <td>{dateTime(lead.updated_at)}</td>
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
            <h2>Visit reports</h2>
            <p>{loading ? 'Loading visit reports…' : `${filteredVisits.length} submitted report${filteredVisits.length === 1 ? '' : 's'} from REACH Log Visit`}</p>
          </div>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Lead</th><th>REACH user</th><th>Purpose / outcome</th><th>GPS</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {filteredVisits.map((visit) => (
                <tr key={visit.id}>
                  <td>{visit.visit_date || dateTime(visit.created_at)}{visit.visit_time ? <><br /><small>{visit.visit_time}</small></> : null}</td>
                  <td><b>{visit.lead_name || 'General visit'}</b><br /><small>{visit.lead_phone || visit.hec_lead_id || '—'}</small></td>
                  <td>{visit.reach_user || '—'}</td>
                  <td><b>{visit.purpose || 'Meet Lead'}</b><br /><small>{visit.outcome || 'No outcome'}{visit.duration_minutes ? ` · ${visit.duration_minutes} min` : ''}</small></td>
                  <td>{visit.latitude != null && visit.longitude != null ? `${Number(visit.latitude).toFixed(4)}, ${Number(visit.longitude).toFixed(4)}` : '—'}</td>
                  <td>{visit.notes || '—'}</td>
                </tr>
              ))}
              {!loading && filteredVisits.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No REACH visit reports yet. Field users log visits from reach.e-remedium.in/sales/visit.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
