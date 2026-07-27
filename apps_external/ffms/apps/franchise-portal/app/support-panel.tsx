'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';

const API_BASE = RFMS_API_BASE;
const CATEGORIES = [
  { value: 'documents', label: 'Documents & KYC' },
  { value: 'payments', label: 'Payments & receipts' },
  { value: 'territory', label: 'Territory allotment' },
  { value: 'training', label: 'Training' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'technical', label: 'Technical issue' },
  { value: 'general', label: 'General enquiry' },
] as const;

type SupportMessage = { id: string; author_type: string; author_name: string; body: string; attachments: { id: string; name: string; url: string }[]; created_at: string };
type SupportTicket = { id: string; ticket_number: string; category: string; subject: string; status: string; messages: SupportMessage[]; applicant_unread_count: number; updated_at: string };
type SupportSettings = { whatsapp_number: string; ivr_call_number: string; technical_support_number: string; support_email: string; support_hours: string };
type SupportApplication = { application_number: string; support?: { unread_replies?: number; open_tickets?: number } };

function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read this file.'));
    reader.onerror = () => reject(new Error('Unable to read this file.'));
    reader.readAsDataURL(file);
  });
}

const readable = (value?: string) => (value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value?: string) => { const date = new Date(value ?? ''); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };

export function ApplicantSupportPanel<T extends SupportApplication>({ application, token, onApplicationUpdated, notify }: { application: T; token: string; onApplicationUpdated: (application: T) => void; notify: (message: string) => void }) {
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);

  const loadTickets = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [ticketResponse, settingsResponse, profileResponse] = await Promise.all([
        fetch(`${API_BASE}/applicant/support/tickets`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/content/support-settings`),
        fetch(`${API_BASE}/applicant/profile`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const ticketPayload = await ticketResponse.json().catch(() => null) as { success?: boolean; data?: SupportTicket[]; error?: { message?: string } } | null;
      const settingsPayload = await settingsResponse.json().catch(() => null) as { success?: boolean; data?: SupportSettings } | null;
      const profilePayload = await profileResponse.json().catch(() => null) as { success?: boolean; data?: T } | null;
      if (!ticketResponse.ok || !ticketPayload?.success || !Array.isArray(ticketPayload.data)) throw new Error(ticketPayload?.error?.message ?? 'Unable to load your support tickets.');
      setTickets(ticketPayload.data);
      if (settingsResponse.ok && settingsPayload?.success && settingsPayload.data) setSettings(settingsPayload.data);
      if (profileResponse.ok && profilePayload?.success && profilePayload.data) {
        const unread = profilePayload.data.support?.unread_replies ?? 0;
        if (unread > (application.support?.unread_replies ?? 0)) setNotice('You have a new reply from the Remedium support team.');
        onApplicationUpdated(profilePayload.data);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load support tickets.');
    } finally {
      setLoading(false);
    }
  }, [token, application.support?.unread_replies, onApplicationUpdated]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);
  useEffect(() => {
    const interval = window.setInterval(() => { void loadTickets(); }, 15000);
    return () => window.clearInterval(interval);
  }, [loadTickets]);

  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;

  async function openTicket(ticketId: string) {
    setSelectedId(ticketId);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/support/tickets/${ticketId}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: SupportTicket; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to open this support ticket.');
      setTickets((items) => items.map((item) => item.id === payload.data!.id ? payload.data! : item));
      const profileResponse = await fetch(`${API_BASE}/applicant/profile`, { headers: { Authorization: `Bearer ${token}` } });
      const profilePayload = await profileResponse.json().catch(() => null) as { success?: boolean; data?: T } | null;
      if (profileResponse.ok && profilePayload?.success && profilePayload.data) onApplicationUpdated(profilePayload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to open this support ticket.');
    }
  }

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const uploaded = await Promise.all(attachments.map(async (file) => ({ name: file.name, data_url: await asDataUrl(file) })));
      const response = await fetch(`${API_BASE}/applicant/support/tickets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subject, message, attachments: uploaded }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: SupportTicket; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to create support ticket.');
      setTickets((items) => [payload.data!, ...items]);
      setSelectedId(payload.data!.id);
      setSubject(''); setMessage(''); setAttachments([]); setCategory('general');
      notify('Support ticket created. Our team will reply here.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create support ticket.');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const uploaded = await Promise.all(replyFiles.map(async (file) => ({ name: file.name, data_url: await asDataUrl(file) })));
      const response = await fetch(`${API_BASE}/applicant/support/tickets/${selected.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply, attachments: uploaded }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: SupportTicket; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to send your reply.');
      setTickets((items) => items.map((item) => item.id === payload.data!.id ? payload.data! : item));
      setReply(''); setReplyFiles([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send your reply.');
    } finally {
      setBusy(false);
    }
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>, mode: 'create' | 'reply') {
    const files = Array.from(event.target.files ?? []).slice(0, 3);
    if (mode === 'create') setAttachments(files);
    else setReplyFiles(files);
    event.target.value = '';
  }

  return <div className="applicant-support-panel">
    {notice ? <p className="portal-message success" role="status">{notice}</p> : null}
    {error ? <p className="portal-message error" role="alert">{error}</p> : null}
    <section className="support-contact-shortcuts">
      <div><p>Need immediate help?</p><b>Contact the Remedium franchise support desk</b><span>{settings?.support_hours || 'Support hours are configured by the administrator.'}</span></div>
      <div className="support-contact-actions">
        {settings?.ivr_call_number ? <a className="support-shortcut call" href={`tel:${settings.ivr_call_number.replace(/\s+/g, '')}`}>Call support</a> : null}
        {settings?.whatsapp_number ? <a className="support-shortcut whatsapp" href={`https://wa.me/${settings.whatsapp_number.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a> : null}
        {settings?.support_email ? <a className="support-shortcut email" href={`mailto:${settings.support_email}`}>Email support</a> : null}
      </div>
    </section>
    <div className="support-layout">
      <section className="dashboard-panel support-ticket-list-panel">
        <h2>Your support tickets</h2>
        {loading ? <p>Loading tickets…</p> : null}
        {!loading && !tickets.length ? <p className="support-empty">No support tickets yet. Create one below and our team will reply in this thread.</p> : null}
        <div className="support-ticket-list">{tickets.map((ticket) => <button type="button" key={ticket.id} className={`support-ticket-item ${selectedId === ticket.id ? 'active' : ''}`} onClick={() => { void openTicket(ticket.id); }}><b>{ticket.subject}</b><span>{ticket.ticket_number} · {readable(ticket.status)}</span>{ticket.applicant_unread_count ? <em>{ticket.applicant_unread_count} new repl{ticket.applicant_unread_count === 1 ? 'y' : 'ies'}</em> : null}<small>{dateTime(ticket.updated_at)}</small></button>)}</div>
        <form className="support-create-form" onSubmit={createTicket}>
          <h3>Open a new ticket</h3>
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Subject<input required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Brief summary of your issue" /></label>
          <label>Message<textarea required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe your issue in detail." /></label>
          <label className="support-upload">Attachments<input type="file" accept="image/*,.pdf" multiple onChange={(event) => chooseFiles(event, 'create')} /><small>{attachments.length ? `${attachments.length} file(s) selected` : 'Optional screenshots or PDFs (max 3)'}</small></label>
          <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit support ticket'}</button>
        </form>
      </section>
      {selected ? <section className="dashboard-panel support-thread-panel">
        <header><div><h2>{selected.subject}</h2><span>{selected.ticket_number} · {readable(selected.category)} · {readable(selected.status)}</span></div></header>
        <div className="support-thread-list">{selected.messages.map((item) => <article key={item.id} className={`support-thread-message ${item.author_type}`}><header><b>{item.author_name}</b><small>{dateTime(item.created_at)}</small></header><p>{item.body}</p>{item.attachments?.length ? <div className="support-thread-attachments">{item.attachments.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.name}</a>)}</div> : null}</article>)}</div>
        {selected.status === 'closed' ? <p className="support-closed-note">This ticket is closed. Open a new ticket if you need further help.</p> : <form className="support-reply-form" onSubmit={sendReply}><label>Continue the conversation<textarea required value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write your follow-up message." /></label><label className="support-upload">Attachments<input type="file" accept="image/*,.pdf" multiple onChange={(event) => chooseFiles(event, 'reply')} /><small>{replyFiles.length ? `${replyFiles.length} file(s) selected` : 'Optional screenshots or PDFs (max 3)'}</small></label><button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button></form>}
      </section> : null}
    </div>
  </div>;
}
