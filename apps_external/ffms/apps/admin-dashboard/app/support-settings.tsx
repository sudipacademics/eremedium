'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';

const API_BASE = RFMS_API_BASE;

type SupportSettings = {
  whatsapp_number: string;
  ivr_call_number: string;
  technical_support_number: string;
  technical_whatsapp_number: string;
  support_email: string;
  support_hours: string;
  sla_response_hours: number;
};

const emptySettings: SupportSettings = {
  whatsapp_number: '',
  ivr_call_number: '',
  technical_support_number: '',
  technical_whatsapp_number: '',
  support_email: '',
  support_hours: 'Monday to Saturday: 9:00 AM - 6:00 PM IST',
  sla_response_hours: 24,
};

export function SupportSettingsPanel({ notify, embedded = false }: { notify: (message: string) => void; embedded?: boolean }) {
  const [settings, setSettings] = useState<SupportSettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = sessionStorage.getItem('rfms_auth_token') ?? '';
      const response = await fetch(`${API_BASE}/admin/support/settings`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: SupportSettings; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to load support settings.');
      setSettings({ ...emptySettings, ...payload.data });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load support settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const token = sessionStorage.getItem('rfms_auth_token') ?? '';
      const response = await fetch(`${API_BASE}/admin/support/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: settings }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: SupportSettings; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to save support settings.');
      setSettings({ ...emptySettings, ...payload.data });
      notify('Support contact settings updated across the website and applicant portal.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save support settings.');
    } finally {
      setSaving(false);
    }
  }

  return <section className={`support-settings-panel${embedded ? ' embedded' : ''}`}>
    {!embedded ? <div className="title-row"><div><h1>Support settings</h1><p>Manage separate business and technical contact numbers. These values power the floating WhatsApp/call buttons, Contact Us page and applicant portal shortcuts.</p></div></div> : null}
    {error ? <p className="application-review-error">{error}</p> : null}
    <form className="panel support-settings-form" onSubmit={save}>
      <fieldset className="support-settings-group span-two">
        <legend>Business contact (franchise enquiries)</legend>
        <p>Used on the public website floating buttons and the franchise hub contact cards.</p>
        <div className="support-settings-group-grid">
          <label>Business WhatsApp<input value={settings.whatsapp_number} onChange={(event) => setSettings((current) => ({ ...current, whatsapp_number: event.target.value }))} placeholder="e.g. 91932398173" /></label>
          <label>Business call / IVR<input value={settings.ivr_call_number} onChange={(event) => setSettings((current) => ({ ...current, ivr_call_number: event.target.value }))} placeholder="e.g. 03369029634" /></label>
        </div>
      </fieldset>
      <fieldset className="support-settings-group span-two">
        <legend>Technical support</legend>
        <p>Used for portal, application and technical troubleshooting on the Contact Us page.</p>
        <div className="support-settings-group-grid">
          <label>Technical WhatsApp<input value={settings.technical_whatsapp_number} onChange={(event) => setSettings((current) => ({ ...current, technical_whatsapp_number: event.target.value }))} placeholder="Technical WhatsApp number" /></label>
          <label>Technical support call<input value={settings.technical_support_number} onChange={(event) => setSettings((current) => ({ ...current, technical_support_number: event.target.value }))} placeholder="Technical support hotline" /></label>
        </div>
      </fieldset>
      <label>Support email<input type="email" value={settings.support_email} onChange={(event) => setSettings((current) => ({ ...current, support_email: event.target.value }))} placeholder="support@remediumlab.com" /></label>
      <label>SLA response target (hours)<input type="number" min={1} max={168} value={settings.sla_response_hours} onChange={(event) => setSettings((current) => ({ ...current, sla_response_hours: Number(event.target.value) || 24 }))} /></label>
      <label className="span-two">Support hours<textarea value={settings.support_hours} onChange={(event) => setSettings((current) => ({ ...current, support_hours: event.target.value }))} /></label>
      <button type="submit" className="lead-primary" disabled={loading || saving}>{saving ? 'Saving…' : 'Save support settings'}</button>
    </form>
  </section>;
}
