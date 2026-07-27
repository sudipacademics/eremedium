'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RFMS_API_BASE, adminCanManageFranchiseeDirectoryApi } from '@rfms/utils';
import { printFranchiseeRecord } from './franchisee-print';

const API_BASE = RFMS_API_BASE;
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '');
const EXPORT_FIELDS = ['identifiers', 'basic_details', 'google_map_location_url', 'territory', 'payments', 'agreement', 'field_visit', 'branding', 'hr', 'training', 'certificates', 'webpage', 'onboarding_journey'] as const;
const EXPORT_FIELD_LABELS: Record<(typeof EXPORT_FIELDS)[number], string> = {
  identifiers: 'Identifiers',
  basic_details: 'Basic details',
  google_map_location_url: 'Google Maps location link',
  territory: 'Territory',
  payments: 'Payments',
  agreement: 'Agreement',
  field_visit: 'Field visit',
  branding: 'Branding',
  hr: 'HR',
  training: 'Training',
  certificates: 'Certificates',
  webpage: 'Webpage',
  onboarding_journey: 'Onboarding journey',
};

type ListItem = {
  franchisee_id: string;
  application_id: string;
  application_number: string;
  business_id: string;
  business_name: string;
  franchisee_name: string;
  applicant_name: string;
  franchise_model: 'FOFO' | 'FOCO';
  location: string;
  district: string;
  pincode: string;
  territory: string;
  onboarding_date: string;
  current_status: string;
  webpage_url: string;
};

type JourneyStage = { stage_name: string; completed_by: string; status: string; completion_date_time: string; remarks: string };
type FileAsset = { id?: string; name: string; url: string; mime?: string; uploaded_at?: string };
type DetailRecord = {
  identifiers: { franchisee_id: string; application_id: string; application_number: string; business_id: string; webpage_id: string };
  basic_details: Record<string, string>;
  google_map_location_url?: string;
  territory: Record<string, unknown> | null;
  payments: { items: { key: string; label: string; amount: number; status: string; receipt_number?: string; paid_at?: string; receipt?: FileAsset | null }[] };
  agreement: Record<string, unknown> | null;
  field_visit: Record<string, unknown> | null;
  branding: Record<string, unknown> | null;
  hr: { staff?: { name: string; designation: string; phone: string; joining_date: string; offer_letter?: FileAsset | null }[] } | null;
  training: Record<string, unknown> | null;
  certificates: { training_completion?: Record<string, unknown> | null; onboarding_welcome?: Record<string, unknown> | null };
  webpage: { id?: string; public_url?: string; preview_image?: string; settings?: Record<string, string> } | null;
  onboarding_journey: { application_submitted_at?: string; onboarding_completed_at?: string; timeline?: { id: string; type: string; label: string; at: string; actor?: string }[]; stages?: JourneyStage[] };
  version_history: { id: string; version: number; summary: string; actor: string; recorded_at: string }[];
};

type ApiSettings = {
  enabled: boolean;
  has_token: boolean;
  api_token_prefix: string;
  rate_limit_per_minute: number;
  allowed_fields: string[];
  version: string;
  updated_at: string;
  updated_by: string;
  available_fields?: string[];
  recent_audit?: { id: string; route: string; status: string; franchisee_id?: string; created_at: string }[];
};

function resolveAssetUrl(url?: string) {
  const value = (url ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

function displayDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function readable(value?: string) {
  return (value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || '—';
}

function DocumentLinks({ files }: { files: (FileAsset | null | undefined)[] }) {
  const items = files.filter(Boolean) as FileAsset[];
  if (!items.length) return <p className="franchisee-empty-note">No documents uploaded.</p>;
  return <div className="franchisee-doc-links">{items.map((file) => <a key={`${file.name}-${file.url}`} href={resolveAssetUrl(file.url)} target="_blank" rel="noreferrer">View / download {file.name}</a>)}</div>;
}

function DetailSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="franchisee-detail-section"><div className="franchisee-detail-section-head"><div><h3>{title}</h3>{description ? <p>{description}</p> : null}</div></div>{children}</section>;
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  return <dl className="franchisee-detail-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>;
}

function FranchiseeDetailModal({ record, token, onClose, onRecordUpdated }: { record: DetailRecord; token: string; onClose: () => void; onRecordUpdated: (record: DetailRecord) => void }) {
  const basic = record.basic_details;
  const territory = record.territory as Record<string, string | number> | null;
  const branding = record.branding as Record<string, unknown> | null;
  const fieldVisit = record.field_visit as Record<string, unknown> | null;
  const agreement = record.agreement as Record<string, unknown> | null;
  const trainingCert = record.certificates.training_completion as { pdf?: FileAsset | null; certificate_number?: string } | null | undefined;
  const onboardingCert = record.certificates.onboarding_welcome as { pdf?: FileAsset | null; certificate_number?: string } | null | undefined;
  const executedAgreement = agreement?.executed_agreement as FileAsset | null | undefined;
  const paymentReceipts = record.payments.items.map((item) => item.receipt).filter(Boolean) as FileAsset[];
  const hrStaff = record.hr?.staff ?? [];
  const brandingPhotos = Array.isArray(branding?.photographs) ? branding.photographs as FileAsset[] : [];
  const brandingMaterials = Array.isArray(branding?.materials) ? branding.materials as FileAsset[] : [];
  const [mapUrl, setMapUrl] = useState(record.google_map_location_url || basic.google_maps_location || '');
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapMessage, setMapMessage] = useState('');

  useEffect(() => {
    setMapUrl(record.google_map_location_url || basic.google_maps_location || '');
  }, [record, basic.google_maps_location]);

  async function saveMapLocation() {
    setMapBusy(true);
    setMapError('');
    setMapMessage('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchisees/${encodeURIComponent(record.identifiers.franchisee_id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_map_location_url: mapUrl.trim() }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: DetailRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to save the Google Maps location link.');
      onRecordUpdated(payload.data);
      setMapMessage('Google Maps location link saved to the franchisee directory and partner API export.');
    } catch (requestError) {
      setMapError(requestError instanceof Error ? requestError.message : 'Unable to save the Google Maps location link.');
    } finally {
      setMapBusy(false);
    }
  }

  function printRecord() {
    void printFranchiseeRecord(record);
  }

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  return <div className="franchisee-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="franchisee-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="franchisee-modal-header">
        <div><p className="franchisee-kicker">Franchisee profile</p><h2>{basic.business_name || basic.franchisee_name}</h2><span>{record.identifiers.application_number} · {readable(basic.franchise_model)} · {readable(basic.current_status)}</span></div>
        <div className="franchisee-modal-actions"><button type="button" onClick={printRecord}>Print record</button><button type="button" className="franchisee-modal-close" onClick={onClose}>Close</button></div>
      </header>
      <div className="franchisee-modal-summary"><span><small>Franchisee ID</small><b>{record.identifiers.franchisee_id}</b></span><span><small>Business ID</small><b>{record.identifiers.business_id}</b></span><span><small>Onboarded</small><b>{displayDate(basic.onboarding_completed_at)}</b></span><span><small>Application submitted</small><b>{displayDate(basic.application_submitted_at)}</b></span></div>

      <DetailSection title="Basic details" description="Core franchise identity and contact information.">
        <DetailGrid rows={[['Franchisee name', basic.franchisee_name], ['Applicant name', basic.applicant_name], ['Business name', basic.business_name], ['Franchise model', readable(basic.franchise_model)], ['Registered address', basic.registered_address], ['Contact number', basic.contact_number], ['Email address', basic.email_address], ['District / PIN', `${basic.district || '—'} · ${basic.pincode || '—'}`], ['Current status', readable(basic.current_status)]]} />
        <div className="franchisee-map-link-editor">
          <label>Google Maps location link<input type="url" value={mapUrl} onChange={(event) => setMapUrl(event.target.value)} placeholder="https://www.google.com/maps/..." /></label>
          <div className="franchisee-map-link-actions">
            {mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer">Open in Google Maps</a> : null}
            <button type="button" disabled={mapBusy} onClick={() => void saveMapLocation()}>{mapBusy ? 'Saving…' : 'Save location link'}</button>
          </div>
          <small>Validated Google Maps links are stored on this franchisee record and exported to partner APIs as <code>google_map_location_url</code> when enabled in Partner API settings.</small>
          {mapError ? <p className="application-review-error">{mapError}</p> : null}
          {mapMessage ? <p className="franchisee-map-link-success">{mapMessage}</p> : null}
        </div>
      </DetailSection>

      <DetailSection title="Territory" description="Allotted territory, radius and allotment letter reference.">
        {territory ? <DetailGrid rows={[['Allotted territory', String(territory.allotted_territory ?? territory.final_territory ?? '')], ['Territory allotment letter', String(territory.letter_number ?? territory.territory_allotment_letter ?? '')], ['Radius (km)', String(territory.radius_km ?? '—')], ['Registered address', String(territory.franchise_address ?? '')], ['Effective date', displayDate(String(territory.effective_date ?? ''))], ['Issued by', String(territory.issued_by ?? '')]]} /> : <p className="franchisee-empty-note">Territory allotment details are not available.</p>}
      </DetailSection>

      <DetailSection title="Payments" description="Verified payment receipts retained as immutable records.">
        <div className="table-wrap"><table><thead><tr><th>Payment</th><th>Amount</th><th>Status</th><th>Paid at</th><th>Receipt</th></tr></thead><tbody>
          {record.payments.items.map((payment) => <tr key={payment.key}><td><b>{payment.label}</b><br /><small>{payment.key}</small></td><td>₹{payment.amount.toLocaleString('en-IN')}</td><td>{readable(payment.status)}</td><td>{displayDate(payment.paid_at)}</td><td>{payment.receipt ? <a href={resolveAssetUrl(payment.receipt.url)} target="_blank" rel="noreferrer">Download receipt</a> : '—'}</td></tr>)}
        </tbody></table></div>
      </DetailSection>

      <DetailSection title="Agreement" description="Manager-executed agreement copy and execution metadata.">
        {agreement ? <><DetailGrid rows={[['Status', readable(String(agreement.status_label ?? agreement.status ?? ''))], ['Reference number', String(agreement.reference_number ?? '—')], ['Executed at', displayDate(String(agreement.executed_at ?? ''))], ['Applicant eSign reference', String(agreement.applicant_esign_reference ?? '—')], ['Company DSC signed by', String(agreement.company_dsc_signed_by ?? '—')]]} /><DocumentLinks files={[executedAgreement ?? null]} /></> : <p className="franchisee-empty-note">Agreement workflow data is not available.</p>}
      </DetailSection>

      <DetailSection title="Field visit" description="Approved field visit report and assigned field officer details.">
        {fieldVisit ? <><DetailGrid rows={[['Field officer', String(fieldVisit.field_officer_name ?? '—')], ['Officer contact', String(fieldVisit.field_officer_contact ?? '—')], ['Approved at', displayDate(String(fieldVisit.approved_at ?? ''))], ['Approved by', String(fieldVisit.approved_by ?? '—')]]} />{(fieldVisit.report as Record<string, string> | undefined) ? <DetailGrid rows={[['Visit date', String((fieldVisit.report as Record<string, string>).visit_date ?? '—')], ['Site address', String((fieldVisit.report as Record<string, string>).site_address ?? '—')], ['Inspection summary', String((fieldVisit.report as Record<string, string>).inspection_summary ?? '—')], ['Recommendation', String((fieldVisit.report as Record<string, string>).recommendation ?? '—')]]} /> : null}</> : <p className="franchisee-empty-note">Field visit report is not available.</p>}
      </DetailSection>

      <DetailSection title="Branding" description="Vendor details, materials, installation cost and approved photographs.">
        {branding ? <><DetailGrid rows={[['Vendor name', String(branding.vendor_name ?? '—')], ['Vendor contact', String(branding.vendor_contact_number ?? '—')], ['Vendor address', String(branding.vendor_address ?? '—')], ['Installation cost', branding.installation_cost ? `₹${Number(branding.installation_cost).toLocaleString('en-IN')}` : '—'], ['Completion details', String(branding.completion_details ?? '—')]]} /><DocumentLinks files={[...(brandingMaterials ?? []), ...(brandingPhotos ?? []), branding.invoice as FileAsset | null]} />{brandingPhotos.length ? <div className="franchisee-photo-grid">{brandingPhotos.map((photo) => <figure key={photo.url}><img src={resolveAssetUrl(photo.url)} alt={photo.name} /><figcaption>{photo.name}</figcaption></figure>)}</div> : null}</> : <p className="franchisee-empty-note">Branding signage records are not available.</p>}
      </DetailSection>

      <DetailSection title="HR" description="Assigned HR staff and offer letters.">
        {hrStaff.length ? hrStaff.map((employee) => <article key={`${employee.name}-${employee.phone}`} className="franchisee-staff-card"><DetailGrid rows={[['Name', employee.name], ['Designation', employee.designation], ['Phone', employee.phone], ['Joining date', employee.joining_date]]} /><DocumentLinks files={[employee.offer_letter ?? null]} /></article>) : <p className="franchisee-empty-note">HR staffing records are not available.</p>}
      </DetailSection>

      <DetailSection title="Training" description="Training completion journey and certificate.">
        <DetailGrid rows={[['Training unlocked', displayDate(String((record.training as Record<string, string> | null)?.unlocked_at ?? ''))], ['Training completed', displayDate(String((record.training as Record<string, string> | null)?.completed_at ?? ''))], ['Business name', String((record.training as Record<string, string> | null)?.business_name ?? basic.business_name)]]} />
        <DocumentLinks files={[trainingCert?.pdf ?? null]} />
      </DetailSection>

      <DetailSection title="Certificates" description="Training completion and onboarding welcome certificates.">
        <DetailGrid rows={[['Training certificate', trainingCert?.certificate_number ?? '—'], ['Onboarding certificate', onboardingCert?.certificate_number ?? '—']]} />
        <DocumentLinks files={[trainingCert?.pdf ?? null, onboardingCert?.pdf ?? null]} />
      </DetailSection>

      <DetailSection title="Webpage" description="Generated franchisee webpage link and preview image.">
        {record.webpage?.public_url ? <><DetailGrid rows={[['Webpage ID', record.identifiers.webpage_id || record.webpage.id || '—'], ['Public URL', record.webpage.public_url], ['Branch address', record.webpage.settings?.branch_address ?? basic.registered_address]]} /><a className="franchisee-web-link" href={resolveAssetUrl(record.webpage.public_url)} target="_blank" rel="noreferrer">Open franchisee webpage</a>{record.webpage.preview_image ? <figure className="franchisee-web-preview"><img src={resolveAssetUrl(record.webpage.preview_image)} alt="Franchisee webpage preview" /><figcaption>Generated webpage preview</figcaption></figure> : null}</> : <p className="franchisee-empty-note">No dedicated franchise webpage is linked to this record.</p>}
      </DetailSection>

      <DetailSection title="Complete onboarding journey" description="Application-to-onboarding timeline with immutable audit events.">
        <DetailGrid rows={[['Application submitted', displayDate(record.onboarding_journey.application_submitted_at)], ['Onboarding completed', displayDate(record.onboarding_journey.onboarding_completed_at)]]} />
        {record.onboarding_journey.stages?.length ? <div className="table-wrap franchisee-journey-table"><table><thead><tr><th>Stage name</th><th>Completed by</th><th>Status</th><th>Completion date &amp; time</th><th>Remarks</th></tr></thead><tbody>{record.onboarding_journey.stages.map((stage) => <tr key={stage.stage_name}><td><b>{stage.stage_name}</b></td><td>{stage.completed_by}</td><td><span className={`franchisee-journey-status ${stage.status.toLowerCase().replace(/\s+/g, '-')}`}>{stage.status}</span></td><td>{displayDate(stage.completion_date_time)}</td><td>{stage.remarks}</td></tr>)}</tbody></table></div> : <div className="franchisee-timeline">{(record.onboarding_journey.timeline ?? []).map((event) => <article key={event.id}><header><b>{event.label}</b><span>{displayDate(event.at)}</span></header>{event.actor ? <small>{event.actor}</small> : null}</article>)}</div>}
      </DetailSection>

      <DetailSection title="Version history" description="Directory snapshots recorded when onboarding completed or when approved records changed.">
        {record.version_history.length ? <div className="franchisee-version-list">{record.version_history.slice().reverse().map((entry) => <article key={entry.id}><b>Version {entry.version}</b><p>{entry.summary}</p><small>{entry.actor} · {displayDate(entry.recorded_at)}</small></article>)}</div> : <p className="franchisee-empty-note">No version history recorded yet.</p>}
      </DetailSection>
    </section>
  </div>;
}

function FranchiseeApiSettingsPanel({ token, notify }: { token: string; notify: (message: string) => void }) {
  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [generatedToken, setGeneratedToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchisee-directory/api-settings`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApiSettings; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to load partner API settings.');
      setSettings(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load partner API settings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>, regenerateToken = false) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchisee-directory/api-settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: settings.enabled, rate_limit_per_minute: settings.rate_limit_per_minute, allowed_fields: settings.allowed_fields, regenerate_token: regenerateToken }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApiSettings & { generated_token?: string }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to save partner API settings.');
      setSettings(payload.data);
      setGeneratedToken(payload.data.generated_token ?? '');
      notify(regenerateToken ? 'Partner API token regenerated.' : 'Partner API settings updated.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save partner API settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="franchisee-empty-note">Loading partner API settings…</p>;
  if (!settings) return <p className="application-review-error">{error || 'Partner API settings unavailable.'}</p>;

  return <form className="panel franchisee-api-settings" onSubmit={(event) => void save(event)}>
    {error ? <p className="application-review-error">{error}</p> : null}
    <label className="franchisee-toggle"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => current ? { ...current, enabled: event.target.checked } : current)} /> Enable secure partner API access</label>
    <label>Rate limit (requests per minute)<input type="number" min={1} max={600} value={settings.rate_limit_per_minute} onChange={(event) => setSettings((current) => current ? { ...current, rate_limit_per_minute: Number(event.target.value) || 60 } : current)} /></label>
    <fieldset><legend>Exportable data sections</legend><div className="franchisee-field-grid">{EXPORT_FIELDS.map((field) => <label key={field}><input type="checkbox" checked={settings.allowed_fields.includes(field)} onChange={(event) => setSettings((current) => { if (!current) return current; const next = event.target.checked ? [...new Set([...current.allowed_fields, field])] : current.allowed_fields.filter((item) => item !== field); return { ...current, allowed_fields: next.length ? next : [...EXPORT_FIELDS] }; })} /> {EXPORT_FIELD_LABELS[field]}</label>)}</div></fieldset>
    <div className="franchisee-api-meta"><p><b>API version:</b> {settings.version}</p><p><b>Current token prefix:</b> {settings.has_token ? `${settings.api_token_prefix}…` : 'No token generated yet'}</p><p><b>Location field:</b> When enabled, partner responses include <code>google_map_location_url</code> with the validated Google Maps link for each franchisee.</p><p><b>Endpoints:</b> GET /api/v1/partner/franchisees · GET /api/v1/partner/franchisees/:franchiseeId · GET /api/v1/partner/franchisees/files/:token</p></div>
    {generatedToken ? <div className="franchisee-token-box"><b>New partner API token</b><code>{generatedToken}</code><small>Copy this token now. It will not be shown again.</small></div> : null}
    <div className="franchisee-api-actions"><button type="submit" className="lead-primary" disabled={saving}>{saving ? 'Saving…' : 'Save API settings'}</button><button type="button" disabled={saving} onClick={(event) => void save(event as unknown as FormEvent<HTMLFormElement>, true)}>Regenerate API token</button></div>
    {settings.recent_audit?.length ? <section className="franchisee-api-audit"><h3>Recent partner API audit log</h3>{settings.recent_audit.map((entry) => <article key={entry.id}><b>{readable(entry.status)}</b><span>{entry.route}</span><small>{displayDate(entry.created_at)}{entry.franchisee_id ? ` · ${entry.franchisee_id}` : ''}</small></article>)}</section> : null}
  </form>;
}

export function FranchiseeDirectory({ token, search, notify, viewerRole }: { token: string; search: string; notify: (message: string) => void; viewerRole: string }) {
  const canManageApi = adminCanManageFranchiseeDirectoryApi(viewerRole);
  const [activeTab, setActiveTab] = useState<'directory' | 'api'>('directory');
  const [records, setRecords] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelFilter, setModelFilter] = useState<'all' | 'FOFO' | 'FOCO'>('all');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<DetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchisees?page_size=100`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { items: ListItem[] }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data?.items)) throw new Error(payload?.error?.message ?? 'Unable to load franchisee directory.');
      setRecords(payload.data.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load franchisee directory.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const visibleRecords = useMemo(() => {
    const haystack = search.trim().toLowerCase();
    return records.filter((record) => {
      if (modelFilter !== 'all' && record.franchise_model !== modelFilter) return false;
      if (!haystack) return true;
      return `${record.application_number} ${record.business_name} ${record.applicant_name} ${record.location} ${record.territory} ${record.franchisee_id}`.toLowerCase().includes(haystack);
    });
  }, [records, search, modelFilter]);

  async function openRecord(record: ListItem) {
    setSelectedId(record.franchisee_id);
    setDetail(null);
    setDetailLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchisees/${encodeURIComponent(record.franchisee_id)}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: DetailRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to open franchisee record.');
      setDetail(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to open franchisee record.');
      setSelectedId('');
    } finally {
      setDetailLoading(false);
    }
  }

  const fofoCount = records.filter((record) => record.franchise_model === 'FOFO').length;
  const focoCount = records.filter((record) => record.franchise_model === 'FOCO').length;

  return <section className="franchisee-directory">
    <div className="title-row"><div><p className="franchisee-kicker">Operations archive</p><h1>Franchisee Directory</h1><p>Automatically stores complete records for every successfully onboarded franchisee with immutable documents, version history and secure partner API export controls.</p></div><button className="date" type="button" onClick={() => void load()}>Refresh directory</button></div>
    <div className="support-module-tabs" role="tablist" aria-label="Franchisee directory views">
      <button type="button" role="tab" aria-selected={activeTab === 'directory'} className={activeTab === 'directory' ? 'active' : ''} onClick={() => setActiveTab('directory')}>Directory</button>
      {canManageApi ? <button type="button" role="tab" aria-selected={activeTab === 'api'} className={activeTab === 'api' ? 'active' : ''} onClick={() => setActiveTab('api')}>Partner API settings</button> : null}
    </div>
    {activeTab === 'api' && canManageApi ? <FranchiseeApiSettingsPanel token={token} notify={notify} /> : <>
      <div className="module-summary"><section><span>Onboarded franchisees</span><b>{records.length}</b><small>Automatically added after onboarding completion</small></section><section><span>FOFO partners</span><b>{fofoCount}</b><small>One-time franchise onboarding records</small></section><section><span>FOCO partners</span><b>{focoCount}</b><small>Includes generated branch webpages</small></section></div>
      <div className="franchisee-filter-row"><button type="button" className={modelFilter === 'all' ? 'active' : ''} onClick={() => setModelFilter('all')}>All models</button><button type="button" className={modelFilter === 'FOFO' ? 'active' : ''} onClick={() => setModelFilter('FOFO')}>FOFO</button><button type="button" className={modelFilter === 'FOCO' ? 'active' : ''} onClick={() => setModelFilter('FOCO')}>FOCO</button></div>
      {error ? <p className="application-review-error">{error}</p> : null}
      <section className="panel data-panel"><div className="table-wrap"><table><thead><tr><th>Business</th><th>Applicant</th><th>Model</th><th>Location</th><th>Onboarded</th><th>Status</th><th /></tr></thead><tbody>
        {!loading && !visibleRecords.length ? <tr><td colSpan={7} className="empty">No onboarded franchisees match this view yet. Records appear here automatically when an application is marked onboarded.</td></tr> : null}
        {visibleRecords.map((record) => <tr key={record.franchisee_id} className={selectedId === record.franchisee_id ? 'selected' : ''}><td><b>{record.business_name || record.franchisee_name}</b><br /><small>{record.franchisee_id}</small></td><td><b>{record.applicant_name}</b><br /><small>{record.application_number}</small></td><td>{record.franchise_model}</td><td>{record.location || record.territory || '—'}</td><td>{displayDate(record.onboarding_date)}</td><td><span className="franchisee-status">{readable(record.current_status)}</span></td><td><button type="button" className="row-action" onClick={() => void openRecord(record)}>{detailLoading && selectedId === record.franchisee_id ? 'Opening…' : 'Open record'}</button></td></tr>)}
      </tbody></table></div></section>
    </>}
    {detail ? <FranchiseeDetailModal record={detail} token={token} onClose={() => { setDetail(null); setSelectedId(''); }} onRecordUpdated={(next) => setDetail(next)} /> : null}
  </section>;
}
