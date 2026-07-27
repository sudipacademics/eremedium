'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE, adminCanManageSupportSettings, clearNotificationEntity, peekNotificationEntity } from '@rfms/utils';
import { SupportSettingsPanel } from './support-settings';

const API_BASE = RFMS_API_BASE;
const STATUSES = ['all', 'open', 'pending', 'replied', 'resolved', 'closed'] as const;

type SupportMessage = { id: string; author_type: string; author_name: string; body: string; is_internal: boolean; attachments: { id: string; name: string; url: string }[]; created_at: string };
type SupportTicket = { id: string; ticket_number: string; application_number: string; applicant_name: string; category: string; subject: string; status: string; assigned_to: string; priority: string; messages: SupportMessage[]; applicant_unread_count: number; updated_at: string };
type TeamMember = { id?: string; name: string; role: string; role_label?: string; employee_id?: string };

const readable = (value?: string) => (value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value?: string) => { const date = new Date(value ?? ''); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const teamMemberLabel = (member: TeamMember) => member.role_label ? `${member.name} · ${member.role_label}` : member.name;

export function SupportDesk({ token, search, notify, viewerRole }: { token: string; search: string; notify: (message: string) => void; viewerRole: string }) {
  const canManageSettings = adminCanManageSupportSettings(viewerRole);
  const [activeTab, setActiveTab] = useState<'desk' | 'settings'>('desk');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>('all');
  const [selectedId, setSelectedId] = useState('');
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [nextStatus, setNextStatus] = useState('replied');
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/support/team`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: TeamMember[] } | null;
      if (response.ok && payload?.success && Array.isArray(payload.data)) setTeam(payload.data);
    } catch {
      /* Keep the last loaded roster if the refresh fails. */
    }
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
      const [ticketResponse, teamResponse] = await Promise.all([
        fetch(`${API_BASE}/support/tickets${query}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/support/team`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const ticketPayload = await ticketResponse.json().catch(() => null) as { success?: boolean; data?: SupportTicket[]; error?: { message?: string } } | null;
      const teamPayload = await teamResponse.json().catch(() => null) as { success?: boolean; data?: TeamMember[] } | null;
      if (!ticketResponse.ok || !ticketPayload?.success || !Array.isArray(ticketPayload.data)) throw new Error(ticketPayload?.error?.message ?? 'Unable to load support tickets.');
      setTickets(ticketPayload.data);
      setTeam(teamResponse.ok && teamPayload?.success && Array.isArray(teamPayload.data) ? teamPayload.data : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load support tickets.');
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const visibleTickets = useMemo(() => {
    const haystack = search.trim().toLowerCase();
    return tickets.filter((ticket) => !haystack || `${ticket.ticket_number} ${ticket.subject} ${ticket.applicant_name} ${ticket.application_number} ${ticket.assigned_to}`.toLowerCase().includes(haystack));
  }, [tickets, search]);

  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;
  const openCount = tickets.filter((ticket) => ticket.status === 'open').length;
  const pendingCount = tickets.filter((ticket) => ticket.status === 'pending').length;
  const repliedCount = tickets.filter((ticket) => ticket.status === 'replied').length;

  async function runAction(type: string, payload: Record<string, string>) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/support/tickets/${selected.id}/actions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...payload }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; data?: SupportTicket; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error?.message ?? 'Unable to update this support ticket.');
      setTickets((items) => items.map((item) => item.id === result.data!.id ? result.data! : item));
      if (type === 'reply') setReply('');
      if (type === 'internal_note') setInternalNote('');
      notify(type === 'close' ? 'Support ticket closed.' : 'Support ticket updated.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update this support ticket.');
    } finally {
      setBusy(false);
    }
  }

  function openTicket(ticket: SupportTicket) {
    setSelectedId(ticket.id);
    setReply('');
    setInternalNote('');
    setAssignTo(ticket.assigned_to || '');
    setNextStatus(ticket.status === 'open' ? 'replied' : ticket.status);
    void loadTeam();
  }

  useEffect(() => {
    if (!tickets.length) return;
    const entityId = peekNotificationEntity();
    if (!entityId) return;
    const ticket = tickets.find((item) => item.id === entityId);
    if (!ticket) return;
    clearNotificationEntity();
    openTicket(ticket);
  }, [tickets]);

  return <section className="support-desk">
    <div className="title-row"><div><h1>Support</h1><p>{canManageSettings ? 'Manage applicant tickets and configure public support contact settings.' : 'Manage applicant support tickets, reply in conversation threads, assign ownership and close resolved issues.'}</p></div>{activeTab === 'desk' ? <button className="date" type="button" onClick={() => void load()}>Refresh queue</button> : null}</div>
    <div className="support-module-tabs" role="tablist" aria-label="Support module views">
      <button type="button" role="tab" aria-selected={activeTab === 'desk'} className={activeTab === 'desk' ? 'active' : ''} onClick={() => setActiveTab('desk')}>Support desk</button>
      {canManageSettings ? <button type="button" role="tab" aria-selected={activeTab === 'settings'} className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>Support settings</button> : null}
    </div>
    {activeTab === 'settings' && canManageSettings ? <SupportSettingsPanel notify={notify} embedded /> : <>
    <div className="module-summary"><section><span>Open tickets</span><b>{openCount}</b><small>Awaiting first response</small></section><section><span>Pending</span><b>{pendingCount}</b><small>Assigned to support staff</small></section><section><span>Replied</span><b>{repliedCount}</b><small>Waiting for applicant follow-up</small></section></div>
    {error ? <p className="application-review-error">{error}</p> : null}
    <div className="support-filter-row">{STATUSES.map((status) => <button key={status} type="button" className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status === 'all' ? 'All statuses' : readable(status)}</button>)}</div>
    <section className="panel data-panel"><div className="table-wrap"><table><thead><tr><th>Ticket</th><th>Applicant</th><th>Category</th><th>Status</th><th>Owner</th><th>Updated</th><th /></tr></thead><tbody>
      {!loading && !visibleTickets.length ? <tr><td colSpan={7} className="empty">No support tickets match this view.</td></tr> : null}
      {visibleTickets.map((ticket) => <tr key={ticket.id} className={selectedId === ticket.id ? 'selected' : ''}><td><b>{ticket.ticket_number}</b><br /><small>{ticket.subject}</small></td><td><b>{ticket.applicant_name}</b><br /><small>{ticket.application_number}</small></td><td>{readable(ticket.category)}</td><td><span className={`support-status ${ticket.status}`}>{readable(ticket.status)}</span></td><td>{ticket.assigned_to || 'Unassigned'}</td><td>{dateTime(ticket.updated_at)}</td><td><button type="button" className="row-action" onClick={() => openTicket(ticket)}>Open</button></td></tr>)}
    </tbody></table></div></section>
    {selected ? <div className="application-review-backdrop" role="presentation" onMouseDown={() => setSelectedId('')}><section className="application-review-modal support-ticket-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="application-review-head"><div><p>Support ticket</p><h2>{selected.subject}</h2><span>{selected.ticket_number} · {selected.applicant_name} · {selected.application_number}</span></div><button type="button" onClick={() => setSelectedId('')}>Close</button></header>
      <section className="application-review-state"><div><span>Ticket status</span><b>{readable(selected.status)}</b></div><span className={`support-status ${selected.status}`}>{selected.assigned_to ? `Assigned to ${selected.assigned_to}` : 'Unassigned'}</span></section>
      <section className="application-review-section support-thread"><div className="application-review-section-head"><div><h3>Conversation</h3><p>Applicant-visible replies appear in the portal thread. Internal notes stay on the backend only.</p></div><span>{selected.messages.length} message{selected.messages.length === 1 ? '' : 's'}</span></div>
        <div className="support-thread-list">{selected.messages.map((message) => <article key={message.id} className={`support-thread-message ${message.author_type} ${message.is_internal ? 'internal' : ''}`}><header><b>{message.author_name}</b><span>{readable(message.author_type)}{message.is_internal ? ' · Internal note' : ''}</span><small>{dateTime(message.created_at)}</small></header><p>{message.body}</p>{message.attachments?.length ? <div className="support-thread-attachments">{message.attachments.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.name}</a>)}</div> : null}</article>)}</div>
      </section>
      <section className="application-review-section"><form className="support-reply-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void runAction('reply', { message: reply }); }}><label>Reply to applicant<textarea required value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write your reply to the applicant." /></label><button type="submit" className="application-review-advance" disabled={busy || selected.status === 'closed'}>{busy ? 'Sending…' : 'Send reply'}</button></form></section>
      <section className="application-review-section support-admin-tools"><div className="support-admin-grid"><label>Assign to<select value={assignTo} onChange={(event) => setAssignTo(event.target.value)}><option value="">{team.length ? 'Choose team member' : 'No active team members found'}</option>{team.map((member) => <option key={member.id ?? member.name} value={member.name}>{teamMemberLabel(member)}</option>)}</select></label><label>Update status<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>{STATUSES.filter((status) => status !== 'all').map((status) => <option key={status} value={status}>{readable(status)}</option>)}</select></label></div><div className="support-admin-actions"><button type="button" disabled={busy || !assignTo} onClick={() => void runAction('assign', { assigned_to: assignTo, message: `Assigned to ${assignTo}.` })}>Assign ticket</button><button type="button" disabled={busy} onClick={() => void runAction('status', { status: nextStatus, message: `Status updated to ${readable(nextStatus)}.` })}>Update status</button><button type="button" disabled={busy || selected.status === 'closed'} onClick={() => void runAction('close', { message: 'Your support ticket has been closed. Open a new ticket if you need further assistance.' })}>Close ticket</button></div><label>Internal note<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Add a private note visible only to support staff." /></label><button type="button" disabled={busy || !internalNote.trim()} onClick={() => void runAction('internal_note', { message: internalNote })}>Save internal note</button></section>
    </section></div> : null}
    </>}
  </section>;
}
