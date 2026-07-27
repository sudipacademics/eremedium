'use client';

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RFMS_API_BASE, RFMS_MARKETING_ORIGIN, adminPagesForRole, clearOfficerAuthHandoffFromUrl, clearOfficerSessionStorage, logoutOfficer, persistOfficerSession, peekNotificationEntity, clearNotificationEntity, readOfficerAuthHandoff, type AdminPage } from '@rfms/utils';
import { AdminLogin } from './admin-login';
import { NotificationBell, ProfileMenu } from './notification-bell';
import './notification-bell.css';
import { ContentStudio } from './content-studio';
import { TerritorySetup } from './territory-setup';
import { LeadDirectory as CrmLeadDirectory } from './lead-directory';
import { AppointmentDirectory } from './appointment-directory';
import './modules.css';
import './content-studio.css';
import './company-settings.css';
import './hero-slider-manager.css';
import './admin-login.css';
import './territory-setup.css';
import './territory-map.css';
import './territory-sidebar-reset.css';
import './territory-pin-capacities.css';
import './google-territory-map.css';
import './lead-directory.css';
import './application-review.css';
import './training-studio.css';
import { AgreementQueueModule } from './agreement-queue';
import { AgreementChangeRequestBox, correctionWorkflowActive } from './agreement-change-request';
import { TrainingStudio } from './training-studio';
import { FranchiseWebpageIndex } from './franchise-webpage-index';
import './franchise-webpage-index.css';
import { FranchiseeDirectory } from './franchisee-directory';
import { OverviewTerritoryAvailability } from './overview-territory-availability';
import './franchisee-directory.css';
import { SupportDesk } from './support-desk';
import './support-desk.css';
import './support-settings.css';
import { UserManagementPanel } from './user-management';
import './user-management.css';
import { PaymentOperationsModule } from './payment-operations';
import './payment-operations.css';

type Page = AdminPage;
type OperationalPage = Exclude<Page, 'Overview' | 'Content CMS' | 'Leads' | 'Appointments' | 'Applicants' | 'Video KYC' | 'Training' | 'Franchisee Webpage Index' | 'Franchisee Directory' | 'Support' | 'User Management' | 'Payments'>;
type AdminSession = { token: string; name: string; role: string; allowedPages: Page[] };
type LeadRecord = { id: string; name: string; email: string; mobile: string; franchise_model: string; territory_query: string; stage: string; created_at: string };
type AppointmentRecord = { id: string; name: string; email: string; mobile: string; preferred_date: string; preferred_time: string; topic: string; status: string; created_at: string };
type ApplicationPayment = { key: string; label: string; amount: number; purpose: string; status: string; receipt_number?: string; paid_at?: string };
type ApplicationDocument = { name: string; url: string };
type ApplicationDocumentVerification = { status: 'verified' | 'pending' | 'upload_requested'; verified_at?: string; verified_by?: string };
type ApplicationReviewActivity = { id: string; type: string; message: string; actor: string; created_at: string };
type VideoKycEvidence = { id: string; url: string; name: string; captured_at: string; captured_by: string };
type VideoKycSession = { id: string; attempt: number; status: 'assigned' | 'in_progress' | 'completed' | 'reassigned'; assigned_at: string; assigned_by: string; started_at: string; started_by: string; applicant_joined_at: string; completed_at: string; completed_by: string; remarks: string; reassigned_from: string; screenshots: VideoKycEvidence[]; history: ApplicationReviewActivity[]; application_id?: string; application_number?: string; applicant_name?: string; applicant_email?: string; applicant_mobile?: string; franchise_model?: 'FOFO' | 'FOCO'; preferred_location?: string; pincode?: string };
type OnboardingDocumentFile = { id: string; slot: number; name: string; url: string; status: 'pending' | 'verified' | 'reupload_requested' | 'rejected' | 'superseded'; remarks?: string; submitted_at?: string; reviewed_at?: string; reviewed_by?: string; history?: ApplicationReviewActivity[] };
type OnboardingDocument = { id: string; title: string; description?: string; required_count: number; requested_at?: string; requested_by?: string; files: OnboardingDocumentFile[] };
type FieldVisitReport = { visit_date?: string; site_address?: string; google_maps_url?: string; inspection_summary?: string; property_condition?: string; documents_observed?: string; recommendation?: string; officer_remarks?: string; submitted_at?: string; submitted_by?: string };
type FieldVisit = { id: string; status: 'assigned' | 'submitted' | 'approved' | 'rejected'; officer_name: string; officer_phone: string; assigned_at?: string; assigned_by?: string; submitted_at?: string; approved_at?: string; approved_by?: string; manager_remarks?: string; report?: FieldVisitReport | null; history?: ApplicationReviewActivity[] };
type WorkflowUpload = { id?: string; name: string; title?: string; url: string; uploaded_at?: string };
type BrandingSignage = { status: 'not_started' | 'vendor_assigned' | 'submitted' | 'approved' | 'rejected' | 'revision_requested'; vendor?: { name: string; shop_name: string; address: string; phone: string } | null; materials?: WorkflowUpload[]; completion_details?: string; photographs?: WorkflowUpload[]; submitted_at?: string; submitted_by?: string; manager_remarks?: string; approved_at?: string; approved_by?: string; installation_cost?: number; invoice?: WorkflowUpload | null; history?: ApplicationReviewActivity[] };
type HrEmployee = { id: string; name: string; designation: string; phone: string; joining_date: string; details?: string; offer_letter?: WorkflowUpload | null };
type HrProcess = { status: 'not_started' | 'assigned' | 'submitted' | 'approved' | 'rejected' | 'revision_requested'; employees?: HrEmployee[]; submitted_at?: string; submitted_by?: string; manager_remarks?: string; approved_at?: string; approved_by?: string; history?: ApplicationReviewActivity[] };
type TerritoryAllotment = { id: string; version: number; letter_number: string; territory_id: string; registered_territory_label: string; final_territory: string; radius_km: number; franchise_address: string; district: string; subdivision?: string; state: string; pincode: string; preferred_location?: string; latitude?: number | null; longitude?: number | null; google_maps_url: string; effective_date: string; conflict_override?: boolean; issued_at: string; issued_by: string; status: string; history?: ApplicationReviewActivity[] };
type TerritoryPinCapacity = { pincode: string; status: string; fofo: { available: number; capacity?: number }; foco: { available: number; capacity?: number } };
type TerritoryOption = { id: string; label: string; state: string; district: string; subdivision?: string; area?: string; pincode: string; pincodes: string[]; available_units: number; status?: string; registered_pin?: string; registered_pin_status?: string; registered_pin_capacity?: TerritoryPinCapacity | null; pin_capacities?: TerritoryPinCapacity[]; fofo: { available: number }; foco: { available: number } };
type NearbyFranchise = { application_id: string; application_number: string; applicant_name: string; franchise_name: string; franchise_model: 'FOFO' | 'FOCO'; pincode: string; subdivision: string; district: string; state: string; status: string; latitude: number | null; longitude: number | null; radius_km: number; coordinates_available: boolean };
type AgreementWorkflow = { id?: string; status: string; status_label?: string; reference_number?: string; initiated_at?: string; initiated_by?: string; estamp?: { state?: string; stamp_duty_value?: number; purpose?: string; execution_date?: string; certificate_number?: string; uin?: string; vendor?: string; certificate?: WorkflowUpload | null; verified_at?: string; verified_by?: string } | null; document?: { template_key?: string; version?: number; body?: string; draft_body?: string; generated_at?: string; sent_to_applicant_at?: string } | null; applicant?: { terms_accepted_at?: string; correction_request?: string; esign_completed_at?: string; esign_reference?: string } | null; company?: { dsc_signed_at?: string; dsc_signed_by?: string; dsc_reference?: string } | null; executed?: { agreement_url?: string; executed_at?: string; qr_reference?: string } | null; history?: ApplicationReviewActivity[] };
type TrainingVideoSummary = { id: string; title: string; description: string; video_url: string; mime: string; duration_minutes: number; sort_order: number; sequence: number; accessible: boolean; locked_reason: string; completed: boolean; completed_at: string };
type TrainingSummary = { unlocked: boolean; unlocked_at: string; unlocked_by: string; business_name: string; franchise_address: string; completed_at: string; progress: { total: number; completed: number; percent: number }; can_unlock: boolean; can_issue_certificate: boolean; can_regenerate_certificate: boolean; certificate: { certificate_number: string; business_name: string; franchise_address: string; issued_at: string; verification_url: string; qr_reference: string; pdf: { name: string; url: string; mime: string } | null } | null; videos: TrainingVideoSummary[] };
type OnboardingCertificateSummary = { can_issue: boolean; can_download: boolean; can_mark_onboarded: boolean; is_onboarded: boolean; certificate: { certificate_number: string; business_name: string; franchise_model: string; franchise_model_label: string; issued_at: string; verification_url: string; qr_reference: string; pdf: { name: string; url: string; mime: string } | null } | null };
type ApplicationRecord = { id: string; application_number: string; franchisee_id?: string; franchisee_id_issued_at?: string; full_name: string; email: string; mobile: string; date_of_birth?: string; pan_number?: string; aadhaar_number?: string; address?: string; city?: string; district?: string; pincode?: string; business_experience?: string; user_id?: string; franchise_model: 'FOFO' | 'FOCO'; preferred_location: string; territory_id?: string; territory_label?: string; territory_pincode?: string; territory_allotment?: TerritoryAllotment | null; territory_allotments?: TerritoryAllotment[]; stage: string; terms_accepted?: boolean; payment_terms?: Record<string, { terms_text?: string; accepted_at?: string; accepted_by?: string }>; documents: Record<string, ApplicationDocument>; document_verifications?: Record<string, ApplicationDocumentVerification>; review_notes?: string; review_history?: ApplicationReviewActivity[]; video_kyc_sessions?: VideoKycSession[]; video_kyc_current_session_id?: string; field_visit?: FieldVisit | null; onboarding_documents?: OnboardingDocument[]; branding_signage?: BrandingSignage | null; hr_process?: HrProcess | null; agreement_workflow?: AgreementWorkflow | null; training?: TrainingSummary | null; onboarding_certificate?: OnboardingCertificateSummary | null; franchise_webpage?: { id: string; public_url: string; enabled: boolean; settings: { business_name: string } } | null; payments: ApplicationPayment[]; created_at: string; updated_at: string };

const API_BASE = RFMS_API_BASE;
const API_ORIGIN = new URL(API_BASE).origin;
function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    if (typeof window !== 'undefined') {
      const port = Number(window.location.port);
      if (port >= 4000 && port <= 4002) return 'Unable to reach the RFMS API at http://localhost:9080. Keep the RFMS Isolated Services window open and hard-refresh this page.';
    }
    return 'The local RFMS API is not running. Start run-api.cmd or start-isolated.cmd and try again.';
  }
  return error instanceof Error ? error.message : fallback;
}
async function compressImageFile(file: File, maxEdge = 1600, quality = 0.82): Promise<{ name: string; data_url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare photographs for upload.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const mime = file.type === 'image/png' ? 'image/jpeg' : (file.type || 'image/jpeg');
  const dataUrl = canvas.toDataURL(mime, quality);
  const extension = mime === 'image/png' ? 'png' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return { name: `${baseName}.${extension}`, data_url: dataUrl };
}
function resolveUploadUrl(url?: string | null) {
  const value = (url ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}
function asDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read this file.')); reader.onerror = () => reject(new Error('Unable to read this file.')); reader.readAsDataURL(file); }); }
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';
const pages: Page[] = ['Overview', 'Leads', 'Appointments', 'Applicants', 'Territory', 'Video KYC', 'Agreements', 'Payments', 'Training', 'Franchisee Webpage Index', 'Franchisee Directory', 'Support', 'Content CMS', 'User Management'];
const applicants = [
  ['Ananya Ghosh', 'RFMS-2026-0148', 'FOFO', 'Document review', 'Arindam Das'],
  ['Sourav Banerjee', 'RFMS-2026-0149', 'FOCO', 'Video KYC', 'R. Saha'],
  ['Dipanwita Pal', 'RFMS-2026-0150', 'FOFO', 'Territory review', 'Arindam Das'],
];

const data: Record<OperationalPage, { title: string; note: string; action: string; headers: string[]; rows: string[][] }> = {
  Territory: { title: 'Territory availability', note: 'West Bengal territory controls with exclusive-allocation safeguards.', action: 'Create territory', headers: ['Territory', 'District', 'Model', 'Status', 'Reservation'], rows: [['Kolkata - Ward 114', 'Kolkata', 'FOFO', 'Available', '-'], ['Siliguri North', 'Darjeeling', 'FOCO', 'Reserved', 'Expires 19 Jul'], ['Bardhaman Central', 'Purba Bardhaman', 'FOFO', 'Occupied', 'Medilife Diagnostics']] },
  Agreements: { title: 'Agreement workflow', note: 'Track legal review, compliant signing and immutable issued copies.', action: 'Create draft', headers: ['Applicant', 'Template version', 'Signing stage', 'Last update', 'Owner'], rows: [['Ritika Mondal', 'FOFO v3.2', 'Legal review', 'Today, 09:20', 'Legal team'], ['Pranay Sen', 'FOCO v2.8', 'Applicant eSign', 'Yesterday', 'Arindam Das'], ['Sushmita Paul', 'FOFO v3.2', 'Final issued', '14 Jul', 'Legal team']] },
};

export default function Dashboard() {
  const [page, setPage] = useState<Page>('Overview');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [leadCreateRequest, setLeadCreateRequest] = useState(0);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [ready, setReady] = useState(false);
  const [fieldVisitToken, setFieldVisitToken] = useState('');
  const [brandingVendorToken, setBrandingVendorToken] = useState('');
  const [hrProcessToken, setHrProcessToken] = useState('');

  const clearSession = useCallback(() => {
    clearOfficerSessionStorage();
    setPage('Overview');
    setSession(null);
    window.location.replace(RFMS_MARKETING_ORIGIN);
  }, []);

  useEffect(() => {
    const handoff = readOfficerAuthHandoff();
    if (handoff) {
      persistOfficerSession(handoff);
      clearOfficerAuthHandoffFromUrl();
      setSession({
        token: handoff.token,
        name: handoff.name,
        role: handoff.role,
        allowedPages: (handoff.allowedPages.length ? handoff.allowedPages : adminPagesForRole(handoff.role)) as Page[],
      });
      setReady(true);
      const query = new URLSearchParams(window.location.search);
      setFieldVisitToken(query.get('field-visit') ?? '');
      setBrandingVendorToken(query.get('branding-vendor') ?? '');
      setHrProcessToken(query.get('hr-process') ?? '');
      return;
    }
    const token = sessionStorage.getItem('rfms_auth_token');
    const name = sessionStorage.getItem('rfms_user_name');
    const role = sessionStorage.getItem('rfms_user_role');
    const storedPages = sessionStorage.getItem('rfms_allowed_pages');
    const allowedPages = storedPages ? (JSON.parse(storedPages) as Page[]) : adminPagesForRole(role ?? '');
    if (token && name && role) setSession({ token, name, role, allowedPages });
    setReady(true);
    const query = new URLSearchParams(window.location.search);
    setFieldVisitToken(query.get('field-visit') ?? '');
    setBrandingVendorToken(query.get('branding-vendor') ?? '');
    setHrProcessToken(query.get('hr-process') ?? '');
  }, []);

  useEffect(() => {
    window.addEventListener('rfms-session-expired', clearSession);
    return () => window.removeEventListener('rfms-session-expired', clearSession);
  }, [clearSession]);

  const visiblePages = useMemo(() => {
    if (!session) return [] as Page[];
    const source = session.allowedPages.length ? session.allowedPages : adminPagesForRole(session.role);
    return source.filter((item) => pages.includes(item as Page)) as Page[];
  }, [session]);

  useEffect(() => {
    if (!session || !visiblePages.length) return;
    if ((page as string) === 'Support Settings') setPage('Support');
    else if (!visiblePages.includes(page)) setPage(visiblePages[0] ?? 'Overview');
  }, [page, session, visiblePages]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  };

  if (!ready) return <main className="admin-login-page" aria-label="Loading RFMS" />;
  if (fieldVisitToken) return <FieldVisitOfficerPortal secureToken={fieldVisitToken} />;
  if (brandingVendorToken) return <BrandingVendorPortal secureToken={brandingVendorToken} />;
  if (hrProcessToken) return <HrSubmissionPortal secureToken={hrProcessToken} />;
  if (!session) return <AdminLogin onAuthenticated={setSession} />;

  const isSuperAdmin = session.role === 'super_admin';
  const initials = session.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const signOut = () => { void logoutOfficer(session.token); };
  const navigateFromNotification = (target: { page: string; entityId?: string }) => {
    if (visiblePages.includes(target.page as Page)) setPage(target.page as Page);
    else if (visiblePages.length) setPage(visiblePages[0]);
    if (target.entityId) sessionStorage.setItem('rfms_notification_entity', target.entityId);
  };

  return (
    <main className="app-shell">
      <aside>
        <div className="brand"><span className="brand-mark">R</span><div><strong>Remedium Lab</strong><small>Franchise Management</small></div></div>
        <nav>{visiblePages.map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}>{item}</button>)}</nav>
        <div className="side-card"><b>Quick actions</b>{visiblePages.includes('Leads') ? <button onClick={() => { setPage('Leads'); setLeadCreateRequest((value) => value + 1); }}>Add new lead</button> : null}{visiblePages.includes('Territory') ? <button onClick={() => setPage('Territory')}>Assign territory</button> : null}{visiblePages.includes('Content CMS') ? <button onClick={() => setPage('Content CMS')}>Manage website content</button> : null}</div>
        <small className="copyright">(c) 2026 Remedium Lab</small>
      </aside>
      <section className="workspace">
        <header>
          <div className="crumb"><span>Operations</span><b> / {page}</b></div>
          <label className="search">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applicants, territories, leads..." /></label>
          <NotificationBell token={session.token} onNavigate={navigateFromNotification} />
          <ProfileMenu initials={initials} onLogout={signOut} />
        </header>
        <div className="content">
          {page === 'Overview' ? <Overview userName={session.name} token={session.token} go={setPage} notify={notify} /> : page === 'Leads' ? <CrmLeadDirectory token={session.token} search={search} notify={notify} createRequest={leadCreateRequest} viewer={{ name: session.name, role: session.role }} /> : page === 'Appointments' ? <AppointmentDirectory token={session.token} search={search} viewer={{ name: session.name, role: session.role }} /> : page === 'Applicants' ? <ApplicationDirectory token={session.token} search={search} notify={notify} /> : page === 'Territory' ? <TerritorySetup token={session.token} search={search} notify={notify} /> : page === 'Video KYC' ? <VideoKycDashboard token={session.token} search={search} notify={notify} /> : page === 'Agreements' ? <AgreementQueueModule token={session.token} search={search} notify={notify} /> : page === 'Payments' ? <PaymentOperationsModule token={session.token} search={search} notify={notify} viewerRole={session.role} /> : page === 'Training' ? <TrainingStudio token={session.token} notify={notify} /> : page === 'Franchisee Webpage Index' ? <FranchiseWebpageIndex token={session.token} search={search} notify={notify} /> : page === 'Franchisee Directory' ? <FranchiseeDirectory token={session.token} search={search} notify={notify} viewerRole={session.role} /> : page === 'Support' ? <SupportDesk token={session.token} search={search} notify={notify} viewerRole={session.role} /> : page === 'Content CMS' ? <ContentStudio notify={notify} /> : page === 'User Management' ? <UserManagementPanel notify={notify} /> : <Module page={page as OperationalPage} search={search} notify={notify} />}
        </div>
      </section>
      {toast ? <div className="toast">Saved: {toast}</div> : null}
    </main>
  );
}

function FieldVisitOfficerPortal({ secureToken }: { secureToken: string }) {
  const [record, setRecord] = useState<{ application_number: string; applicant_name: string; franchise_model: string; preferred_location: string; pincode: string; field_visit: FieldVisit } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ visit_date: new Date().toISOString().slice(0, 10), site_address: '', google_maps_url: '', inspection_summary: '', property_condition: '', documents_observed: '', recommendation: '', officer_remarks: '' });
  useEffect(() => { let current = true; void (async () => { try { const response = await fetch(`${API_BASE}/field-visits/${secureToken}`); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application_number: string; applicant_name: string; franchise_model: string; preferred_location: string; pincode: string; field_visit: FieldVisit }; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to open this Field Visit link.'); if (current) { setRecord(payload.data); if (payload.data.field_visit.report) setForm((state) => ({ ...state, ...payload.data!.field_visit.report })); } } catch (loadError) { if (current) setError(loadError instanceof Error ? loadError.message : 'Unable to open this Field Visit link.'); } finally { if (current) setLoading(false); } })(); return () => { current = false; }; }, [secureToken]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const response = await fetch(`${API_BASE}/field-visits/${secureToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { message?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to submit the Field Visit report.'); setMessage(payload.data?.message ?? 'Field Visit report submitted to the franchise manager.'); } catch (submitError) { setError(networkErrorMessage(submitError, 'Unable to submit the Field Visit report.')); } finally { setBusy(false); } }
  function createLinkFromAddress() {
    const query = [form.site_address, record?.preferred_location, record?.pincode].filter(Boolean).join(', ');
    if (!query) { setError('Enter the site address or use the proposed location before creating a Google Maps link.'); return; }
    setError('');
    setForm((current) => ({ ...current, google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` }));
  }
  function useCurrentLocation() {
    if (!navigator.geolocation) { setError('This device does not support location services. Use the site address to create a Google Maps link instead.'); return; }
    setError(''); setMessage('Requesting your current location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setForm((current) => ({ ...current, google_maps_url: `https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}` }));
        setMessage('Current location added as a Google Maps link. Review it before submitting the report.');
      },
      () => { setMessage(''); setError('Location permission was not granted. You can paste a Google Maps link or create one from the site address.'); },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }
  if (loading) return <main className="field-visit-portal"><section><p>Secure Field Visit</p><h1>Opening assigned visit...</h1></section></main>;
  if (!record) return <main className="field-visit-portal"><section><p>Secure Field Visit</p><h1>Link unavailable</h1><span>{error || 'This report link is invalid or no longer available.'}</span></section></main>;
  const locked = record.field_visit.status === 'approved';
  return <main className="field-visit-portal"><section className="field-visit-portal-card">
    <header><div><p>Secure Field Visit report</p><h1>{locked ? 'Final report locked' : 'Submit your inspection report'}</h1><span>Assigned to {record.field_visit.officer_name} · {record.field_visit.officer_phone}</span></div><b>{record.field_visit.status.replace('_', ' ')}</b></header>
    <div className="field-visit-application"><div><small>Applicant</small><b>{record.applicant_name}</b></div><div><small>Application</small><b>{record.application_number}</b></div><div><small>Franchise model</small><b>{record.franchise_model}</b></div><div><small>Proposed location</small><b>{record.preferred_location}{record.pincode ? ` · ${record.pincode}` : ''}</b></div></div>
    {locked ? <p className="field-visit-success">The manager has approved this Field Visit report. It is now locked as the final application record.</p> : <form onSubmit={submit}>
      <label>Visit date<input required type="date" value={form.visit_date} onChange={(event) => setForm((current) => ({ ...current, visit_date: event.target.value }))} /></label>
      <label>Site address<textarea value={form.site_address} onChange={(event) => setForm((current) => ({ ...current, site_address: event.target.value }))} placeholder="Address inspected during the visit" /></label>
      <label className="field-visit-full">Google Maps location link<input type="url" value={form.google_maps_url} onChange={(event) => setForm((current) => ({ ...current, google_maps_url: event.target.value }))} placeholder="Paste a Google Maps link, fetch your location, or create one from the site address" /><span className="field-visit-location-tools"><button type="button" onClick={useCurrentLocation}>Use current device location</button><button type="button" className="secondary" onClick={createLinkFromAddress}>Create link from site address</button>{form.google_maps_url ? <a href={form.google_maps_url} target="_blank" rel="noreferrer">Open Google Maps</a> : null}</span><small>Location access is requested only when you choose to use this device. Only a Google Maps link is saved with the report.</small></label>
      <label className="field-visit-full">Inspection summary<textarea required value={form.inspection_summary} onChange={(event) => setForm((current) => ({ ...current, inspection_summary: event.target.value }))} placeholder="Describe the location, franchise readiness and key verification findings" /></label>
      <label>Property condition<textarea value={form.property_condition} onChange={(event) => setForm((current) => ({ ...current, property_condition: event.target.value }))} placeholder="Condition, access, space and facilities" /></label>
      <label>Documents observed<textarea value={form.documents_observed} onChange={(event) => setForm((current) => ({ ...current, documents_observed: event.target.value }))} placeholder="Property or local documents seen" /></label>
      <label>Recommendation<textarea value={form.recommendation} onChange={(event) => setForm((current) => ({ ...current, recommendation: event.target.value }))} placeholder="Recommendation for the franchise manager" /></label>
      <label>Officer remarks<textarea value={form.officer_remarks} onChange={(event) => setForm((current) => ({ ...current, officer_remarks: event.target.value }))} placeholder="Additional observations" /></label>
      <div className="field-visit-full"><button disabled={busy}>{busy ? 'Submitting report...' : 'Submit Field Visit report'}</button></div>
    </form>}
    {message ? <p className="field-visit-success">{message}</p> : null}{error ? <p className="field-visit-error" role="alert">{error}</p> : null}
  </section></main>;
}

function BrandingVendorPortal({ secureToken }: { secureToken: string }) {
  const [record, setRecord] = useState<{ application_number: string; applicant_name: string; franchise_model: string; preferred_location: string; branding_signage: BrandingSignage } | null>(null);
  const [details, setDetails] = useState(''); const [photos, setPhotos] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let active = true; void (async () => { try { const response = await fetch(`${API_BASE}/branding-vendor/${secureToken}`); const payload = await response.json().catch(() => null) as { success?: boolean; data?: typeof record; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to open this secure vendor link.'); if (active) { setRecord(payload.data); setDetails(payload.data.branding_signage.completion_details ?? ''); } } catch (loadError) { if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to open this secure vendor link.'); } })(); return () => { active = false; }; }, [secureToken]);
  function choosePhotos(event: ChangeEvent<HTMLInputElement>) { const selected = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/')).slice(0, 6); if (!selected.length) { setError('Choose PNG, JPG or WEBP photographs.'); return; } setPhotos(selected); setError(''); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); try { const response = await fetch(`${API_BASE}/branding-vendor/${secureToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completion_details: details, photographs: await Promise.all(photos.map((file) => compressImageFile(file))) }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { message?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to submit branding evidence.'); setMessage(payload.data?.message ?? 'Branding evidence submitted for manager review.'); setPhotos([]); } catch (submitError) { setError(networkErrorMessage(submitError, 'Unable to submit branding evidence.')); } finally { setBusy(false); } }
  if (!record) return <main className="secure-submission-page"><section><p>Secure Branding Signage</p><h1>{error ? 'Link unavailable' : 'Opening vendor workspace...'}</h1>{error ? <span>{error}</span> : null}</section></main>;
  const locked = record.branding_signage.status === 'approved'; const vendor = record.branding_signage.vendor;
  return <main className="secure-submission-page"><section className="secure-submission-card"><header><div><p>Secure Branding Signage</p><h1>{locked ? 'Branding installation approved' : 'Submit completed branding work'}</h1><span>{vendor?.shop_name || 'Approved branding vendor'} · {record.application_number}</span></div><b>{record.branding_signage.status.replaceAll('_', ' ')}</b></header><div className="secure-application-grid"><div><small>Applicant</small><b>{record.applicant_name}</b></div><div><small>Franchise model</small><b>{record.franchise_model}</b></div><div><small>Proposed location</small><b>{record.preferred_location}</b></div></div>{record.branding_signage.materials?.length ? <section className="secure-assets"><b>Approved branding materials</b>{record.branding_signage.materials.map((asset) => <a key={asset.id || asset.url} href={resolveUploadUrl(asset.url)} target="_blank" rel="noreferrer">{asset.title}</a>)}</section> : null}{locked ? <p className="field-visit-success">The manager has approved this installation. The record is now locked and available to the applicant.</p> : <form onSubmit={submit}><label className="secure-full">Completion details<textarea required value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Describe completed signage, wall branding, vinyl work and installation notes" /></label><label className="secure-full">Installation photographs (maximum 6)<input required type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={choosePhotos} /><small>{photos.length ? `${photos.length} photograph${photos.length === 1 ? '' : 's'} selected` : 'Upload clear completed-work photographs.'}</small></label><button disabled={busy || !photos.length}>{busy ? 'Submitting...' : 'Submit branding work for review'}</button></form>}{message ? <p className="field-visit-success">{message}</p> : null}{error ? <p className="field-visit-error">{error}</p> : null}</section></main>;
}

type HrDraftEmployee = { name: string; designation: string; phone: string; joining_date: string; details: string; offer_letter: File | null };
function HrSubmissionPortal({ secureToken }: { secureToken: string }) {
  const [record, setRecord] = useState<{ application_number: string; applicant_name: string; franchise_model: string; preferred_location: string; hr_process: HrProcess } | null>(null);
  const [employees, setEmployees] = useState<HrDraftEmployee[]>([{ name: '', designation: '', phone: '', joining_date: '', details: '', offer_letter: null }]); const [submittedBy, setSubmittedBy] = useState('HR Department'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let active = true; void (async () => { try { const response = await fetch(`${API_BASE}/hr-process/${secureToken}`); const payload = await response.json().catch(() => null) as { success?: boolean; data?: typeof record; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to open this secure HR link.'); if (active) setRecord(payload.data); } catch (loadError) { if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to open this secure HR link.'); } })(); return () => { active = false; }; }, [secureToken]);
  const updateEmployee = (index: number, field: keyof HrDraftEmployee, value: string | File | null) => setEmployees((current) => current.map((employee, position) => position === index ? { ...employee, [field]: value } : employee));
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); try { const payloadEmployees = await Promise.all(employees.map(async (employee) => ({ ...employee, offer_letter: employee.offer_letter ? { name: employee.offer_letter.name, data_url: await asDataUrl(employee.offer_letter) } : null }))); const response = await fetch(`${API_BASE}/hr-process/${secureToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submitted_by: submittedBy, employees: payloadEmployees }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { message?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to submit employee onboarding details.'); setMessage(payload.data?.message ?? 'HR submission sent to the franchise manager for review.'); } catch (submitError) { setError(networkErrorMessage(submitError, 'Unable to submit employee onboarding details.')); } finally { setBusy(false); } }
  if (!record) return <main className="secure-submission-page"><section><p>Secure HR Process</p><h1>{error ? 'Link unavailable' : 'Opening HR workspace...'}</h1>{error ? <span>{error}</span> : null}</section></main>;
  const locked = record.hr_process.status === 'approved';
  return <main className="secure-submission-page"><section className="secure-submission-card"><header><div><p>Secure HR Process</p><h1>{locked ? 'Employee onboarding approved' : 'Submit employee onboarding'}</h1><span>{record.application_number} · FOCO franchise · {record.preferred_location}</span></div><b>{record.hr_process.status.replaceAll('_', ' ')}</b></header><div className="secure-application-grid"><div><small>Applicant</small><b>{record.applicant_name}</b></div><div><small>Maximum team size</small><b>2 employees</b></div><div><small>Required evidence</small><b>Offer Letter per employee</b></div></div>{locked ? <p className="field-visit-success">This HR record has been approved and is locked as part of the franchise onboarding history.</p> : <form onSubmit={submit}><label className="secure-full">Submitted by<input value={submittedBy} onChange={(event) => setSubmittedBy(event.target.value)} placeholder="HR representative or department" /></label>{employees.map((employee, index) => <fieldset className="hr-employee-form" key={index}><legend>Employee {index + 1}</legend><label>Employee name<input required value={employee.name} onChange={(event) => updateEmployee(index, 'name', event.target.value)} /></label><label>Designation<input required value={employee.designation} onChange={(event) => updateEmployee(index, 'designation', event.target.value)} placeholder="Receptionist or Phlebotomist" /></label><label>Contact number<input required value={employee.phone} inputMode="tel" onChange={(event) => updateEmployee(index, 'phone', event.target.value)} /></label><label>Joining date<input required type="date" value={employee.joining_date} onChange={(event) => updateEmployee(index, 'joining_date', event.target.value)} /></label><label className="secure-full">Other onboarding details<textarea value={employee.details} onChange={(event) => updateEmployee(index, 'details', event.target.value)} /></label><label className="secure-full">Offer Letter<input required type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => updateEmployee(index, 'offer_letter', event.target.files?.[0] ?? null)} /></label>{employees.length > 1 ? <button type="button" className="secondary" onClick={() => setEmployees((current) => current.filter((_, position) => position !== index))}>Remove employee</button> : null}</fieldset>)}{employees.length < 2 ? <button className="secondary" type="button" onClick={() => setEmployees((current) => [...current, { name: '', designation: '', phone: '', joining_date: '', details: '', offer_letter: null }])}>Add second employee</button> : null}<button disabled={busy}>{busy ? 'Submitting...' : 'Submit HR onboarding for review'}</button></form>}{message ? <p className="field-visit-success">{message}</p> : null}{error ? <p className="field-visit-error">{error}</p> : null}</section></main>;
}

function Overview({ userName, token, go, notify }: { userName: string; token: string; go: (page: Page) => void; notify: (message: string) => void }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const displayName = userName.trim() || 'there';
  return <>
    <div className="title-row"><div><h1>{greeting}, {displayName}</h1><p>Here is the operational pulse of your franchise network.</p></div><button className="date" onClick={() => notify('Date filter set to July 2026')}>July 2026</button></div>
    <div className="metrics"><Metric label="New leads" value="128" delta="18.7%" icon="Lead" /><Metric label="Applications in review" value="36" delta="8 pending action" icon="App" /><Metric label="Territories available" value="28" delta="across West Bengal" icon="Map" /><Metric label="Collections this month" value="INR 18.2L" delta="12.4%" icon="Pay" /></div>
    <div className="grid top"><section className="panel pipeline"><Header title="Application pipeline" text="Conversion from qualified lead to franchise partner" action="Export" onClick={() => notify('Pipeline export queued')} /><div className="funnel"><div style={{ width: '100%' }}><b>128</b><span>Qualified leads</span></div><div style={{ width: '82%' }}><b>62</b><span>Applications started</span></div><div style={{ width: '64%' }}><b>36</b><span>Under review</span></div><div style={{ width: '46%' }}><b>14</b><span>Approved</span></div></div><div className="funnel-note"><span>12.5% conversion</span><span>Up 2.1% vs last month</span></div></section></div>
    <OverviewTerritoryAvailability token={token} onOpenTerritory={() => go('Territory')} />
    <section className="panel data-panel"><Header title="Priority approvals" text="Requests that need a decision this week" action="Review all" onClick={() => go('Applicants')} /><div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Application ID</th><th>Model</th><th>Stage</th><th>Manager</th><th /></tr></thead><tbody>{applicants.map((row) => <tr key={row[1]}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <b>{cell}</b> : cell}</td>)}<td><button className="row-action" onClick={() => notify(`${row[0]} opened`)}>Review</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function recordsFrom<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) return (data as { data: T[] }).data;
  return [];
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOfficerSessionExpired(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false;
  window.dispatchEvent(new Event('rfms-session-expired'));
  return true;
}

function LeadDirectory({ token, search }: { token: string; search: string }) {
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    void (async () => {
      setLoading(true); setError('');
      try {
        const response = await fetch(`${API_BASE}/leads`, { headers: { Authorization: `Bearer ${token}` } });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error('Unable to load website enquiries.');
        if (current) setLeads(recordsFrom<LeadRecord>(result));
      } catch (requestError) {
        if (current) setError(requestError instanceof Error ? requestError.message : 'Unable to load website enquiries.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [token, reload]);

  const visibleLeads = useMemo(() => leads.filter((lead) => `${lead.name} ${lead.email} ${lead.mobile} ${lead.territory_query}`.toLowerCase().includes(search.toLowerCase())), [leads, search]);
  return <section>
    <div className="title-row"><div><h1>Lead directory</h1><p>Franchise queries submitted from the Remedium Lab website.</p></div><button className="date" onClick={() => setReload((current) => current + 1)}>Refresh</button></div>
    <div className="module-summary"><section><span>Website leads</span><b>{leads.length}</b><small>Saved franchise enquiries</small></section><section><span>Visible results</span><b>{visibleLeads.length}</b><small>Matched to your search</small></section><section><span>New stage</span><b>{leads.filter((lead) => lead.stage === 'new').length}</b><small>Awaiting first follow-up</small></section></div>
    <section className="panel data-panel"><Header title="Franchisee queries" text={loading ? 'Loading saved website enquiries…' : `${visibleLeads.length} enquiry records`} action="Refresh" onClick={() => setReload((current) => current + 1)} /><div className="table-wrap"><table><thead><tr><th>Lead</th><th>Contact</th><th>Model</th><th>Preferred territory</th><th>Received</th><th>Stage</th></tr></thead><tbody>{error ? <tr><td className="empty" colSpan={6}>{error}</td></tr> : visibleLeads.map((lead) => <tr key={lead.id}><td><b>{lead.name}</b></td><td>{lead.email}<br /><small>{lead.mobile}</small></td><td>{lead.franchise_model}</td><td>{lead.territory_query}</td><td>{displayDate(lead.created_at)}</td><td>{lead.stage.replace('_', ' ')}</td></tr>)}{!loading && !error && visibleLeads.length === 0 ? <tr><td className="empty" colSpan={6}>No franchisee queries have been received yet.</td></tr> : null}</tbody></table></div></section>
  </section>;
}

function LegacyAppointmentDirectory({ token, search }: { token: string; search: string }) {
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    void (async () => {
      setLoading(true); setError('');
      try {
        const response = await fetch(`${API_BASE}/appointments`, { headers: { Authorization: `Bearer ${token}` } });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error('Unable to load consultation appointments.');
        if (current) setAppointments(recordsFrom<AppointmentRecord>(result));
      } catch (requestError) {
        if (current) setError(requestError instanceof Error ? requestError.message : 'Unable to load consultation appointments.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [token, reload]);

  const visibleAppointments = useMemo(() => appointments.filter((appointment) => `${appointment.name} ${appointment.email} ${appointment.mobile} ${appointment.topic}`.toLowerCase().includes(search.toLowerCase())), [appointments, search]);
  return <section>
    <div className="title-row"><div><h1>Consultation appointments</h1><p>Business-opportunity consultations booked from the public website.</p></div><button className="date" onClick={() => setReload((current) => current + 1)}>Refresh</button></div>
    <div className="module-summary"><section><span>Appointment requests</span><b>{appointments.length}</b><small>Saved consultation requests</small></section><section><span>Visible results</span><b>{visibleAppointments.length}</b><small>Matched to your search</small></section><section><span>Awaiting confirmation</span><b>{appointments.filter((appointment) => appointment.status === 'requested').length}</b><small>Contact these guests first</small></section></div>
    <section className="panel data-panel"><Header title="Consultation bookings" text={loading ? 'Loading saved consultation requests…' : `${visibleAppointments.length} appointment records`} action="Refresh" onClick={() => setReload((current) => current + 1)} /><div className="table-wrap"><table><thead><tr><th>Guest</th><th>Contact</th><th>Requested slot</th><th>Topic</th><th>Booked</th><th>Status</th></tr></thead><tbody>{error ? <tr><td className="empty" colSpan={6}>{error}</td></tr> : visibleAppointments.map((appointment) => <tr key={appointment.id}><td><b>{appointment.name}</b></td><td>{appointment.email}<br /><small>{appointment.mobile}</small></td><td>{displayDate(appointment.preferred_date)}<br /><small>{appointment.preferred_time}</small></td><td>{appointment.topic}</td><td>{displayDate(appointment.created_at)}</td><td>{appointment.status}</td></tr>)}{!loading && !error && visibleAppointments.length === 0 ? <tr><td className="empty" colSpan={6}>No consultation appointments have been booked yet.</td></tr> : null}</tbody></table></div></section>
  </section>;
}

function applicationStage(stage: string) {
  return stage.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paymentIsPaid(application: ApplicationRecord, key: string) {
  return application.payments.some((payment) => payment.key === key && payment.status === 'paid');
}

function canProceedToFinalAgreement(application: ApplicationRecord) {
  const status = application.agreement_workflow?.status ?? 'not_started';
  if (status !== 'not_started') return false;
  if (application.franchise_model === 'FOCO') return paymentIsPaid(application, 'security_deposit');
  return application.branding_signage?.status === 'approved' && paymentIsPaid(application, 'fofo_one_time_fee');
}

function showProceedForFinalAgreement(application: ApplicationRecord) {
  const status = application.agreement_workflow?.status ?? 'not_started';
  if (status !== 'not_started') return false;
  if (application.franchise_model === 'FOCO') {
    return paymentIsPaid(application, 'security_deposit') || application.payments.some((payment) => payment.key === 'security_deposit' && payment.status === 'due');
  }
  return application.branding_signage?.status === 'approved';
}

function agreementInProcess(application: ApplicationRecord) {
  const status = application.agreement_workflow?.status ?? 'not_started';
  return status !== 'not_started' && status !== 'executed';
}

function nextApplicationAction(application: ApplicationRecord) {
  if (canProceedToFinalAgreement(application)) return '';
  if (application.franchise_model === 'FOFO' && application.stage === 'payment_1_received') return 'Verify documents and start onboarding';
  if (application.franchise_model === 'FOCO' && application.stage === 'payment_1_received') return 'Verify documents and allot location';
  if (application.franchise_model === 'FOCO' && application.stage === 'payment_2_received') return 'Approve onboarding and request security deposit';
  return '';
}

const requiredApplicationDocuments = [
  { key: 'photo', label: 'Applicant photograph', shortLabel: 'Photo' },
  { key: 'pan', label: 'PAN card', shortLabel: 'PAN' },
  { key: 'aadhaar', label: 'Aadhaar card', shortLabel: 'Aadhaar' },
  { key: 'voter', label: 'Voter ID card', shortLabel: 'Voter ID' },
] as const;

function reviewActivityLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ApplicationDirectory({ token, search, notify }: { token: string; search: string; notify: (message: string) => void }) {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState('');
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  const [reviewError, setReviewError] = useState('');

  useEffect(() => {
    let current = true;
    void (async () => {
      setLoading(true); setError('');
      try {
        const response = await fetch(`${API_BASE}/applications`, { headers: { Authorization: `Bearer ${token}` } });
        if (isOfficerSessionExpired(response)) return;
        const result: unknown = await response.json();
        if (!response.ok) throw new Error('Unable to load paid franchise applications.');
        if (current) setApplications(recordsFrom<ApplicationRecord>(result));
      } catch (requestError) {
        if (current) setError(requestError instanceof Error ? requestError.message : 'Unable to load paid franchise applications.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [token, reload]);

  useEffect(() => {
    if (!applications.length) return;
    const entityId = peekNotificationEntity();
    if (!entityId) return;
    const application = applications.find((item) => item.id === entityId);
    if (!application) return;
    clearNotificationEntity();
    setSelectedApplicationId(application.id);
  }, [applications]);

  const visibleApplications = useMemo(() => applications.filter((application) => `${application.full_name} ${application.email} ${application.mobile} ${application.application_number} ${application.preferred_location}`.toLowerCase().includes(search.toLowerCase())), [applications, search]);
  const phaseOneReady = applications.filter((application) => application.stage === 'payment_1_received').length;
  const finalising = applications.filter((application) => ['payment_2_received', 'payment_3_received', 'agreement_in_process', 'agreement_and_onboarding', 'onboarding_initiated'].includes(application.stage) || agreementInProcess(application)).length;
  const selectedApplication = applications.find((application) => application.id === selectedApplicationId) ?? null;

  function replaceApplication(updated: ApplicationRecord) {
    setApplications((items) => items.map((item) => item.id === updated.id ? updated : item));
  }

  async function verifyDocument(application: ApplicationRecord, kind: string, verified: boolean) {
    setBusyId(`document:${application.id}:${kind}`); setReviewError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/documents/${kind}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ verified }) });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error?.message ?? 'Unable to update this document review.');
      replaceApplication(result.data);
      notify(`${kind === 'photo' ? 'Applicant photograph' : kind === 'pan' ? 'PAN card' : kind === 'aadhaar' ? 'Aadhaar card' : 'Voter ID card'} ${verified ? 'verified' : 'marked for upload again'}.`);
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : 'Unable to update this document review.');
    } finally {
      setBusyId('');
    }
  }

  async function proceedAgreement(application: ApplicationRecord, reviewNotes: string) {
    setBusyId(`agreement-proceed:${application.id}`); setReviewError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/agreement/proceed`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ review_notes: reviewNotes }) });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord }; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || !result.data?.application) throw new Error(result?.error?.message ?? 'Unable to proceed to final agreement.');
      replaceApplication(result.data.application);
      notify('Agreement process started. Continue in Manager → Agreement Queue.');
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : 'Unable to proceed to final agreement.');
    } finally {
      setBusyId('');
    }
  }

  async function advance(application: ApplicationRecord, reviewNotes: string) {
    setBusyId(`advance:${application.id}`); setReviewError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/advance`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ review_notes: reviewNotes }) });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; action?: string }; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || !result.data?.application) throw new Error(result?.error?.message ?? 'Unable to move this application forward.');
      replaceApplication(result.data.application);
      notify(result.data.action ?? 'Application workflow advanced.');
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : 'Unable to move this application forward.');
    } finally {
      setBusyId('');
    }
  }

  async function assignVideoKyc(application: ApplicationRecord) {
    setBusyId(`video-kyc:${application.id}`); setReviewError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/video-kyc`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; session?: VideoKycSession }; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || !result.data?.application) throw new Error(result?.error?.message ?? 'Unable to assign Video KYC.');
      replaceApplication(result.data.application);
      notify(`Video KYC attempt ${result.data.session?.attempt ?? ''} assigned to the applicant.`.trim());
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : 'Unable to assign Video KYC.');
    } finally {
      setBusyId('');
    }
  }

  return <section>
    <div className="title-row"><div><h1>Franchise applications</h1><p>Applications appear here after the first payment is received. Review KYC and unlock each next step.</p></div><button className="date" onClick={() => setReload((current) => current + 1)}>Refresh</button></div>
    <div className="module-summary"><section><span>Paid applications</span><b>{applications.length}</b><small>Visible to the franchise team</small></section><section><span>Ready for review</span><b>{phaseOneReady}</b><small>First payment received</small></section><section><span>Finalising</span><b>{finalising}</b><small>Onboarding or agreement work</small></section></div>
    <section className="panel data-panel"><Header title="Applicant workflow" text={loading ? 'Loading paid applications...' : `${visibleApplications.length} application records`} action="Refresh" onClick={() => setReload((current) => current + 1)} /><div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Application</th><th>Model and territory</th><th>KYC</th><th>Payments and stage</th><th>Next phase</th><th /></tr></thead><tbody>{error ? <tr><td className="empty" colSpan={7}>{error}</td></tr> : visibleApplications.map((application) => { const paidPayments = application.payments.filter((payment) => payment.status === 'paid'); const duePayment = application.payments.find((payment) => payment.status === 'due'); const action = nextApplicationAction(application); const verifiedCount = requiredApplicationDocuments.filter((document) => application.document_verifications?.[document.key]?.status === 'verified').length; return <tr key={application.id}><td><b>{application.full_name}</b><br /><small>{application.email}<br />{application.mobile}</small></td><td><b>{application.application_number}</b><br /><small>Received {displayDate(application.created_at)}</small></td><td>{application.franchise_model}<br /><small>{application.preferred_location}</small></td><td><b>{Object.keys(application.documents ?? {}).length}/4 uploaded</b><br /><small>{verifiedCount}/4 verified</small></td><td><b>{paidPayments.length}/{application.payments.length} paid</b><br /><small>{duePayment ? `Due: ${duePayment.label}` : applicationStage(application.stage)}</small></td><td><small className="application-next-step">{action || applicationStage(application.stage)}</small></td><td><button className="row-action" type="button" onClick={() => { setReviewError(''); setSelectedApplicationId(application.id); }}>Open review</button></td></tr>; })}{!loading && !error && visibleApplications.length === 0 ? <tr><td className="empty" colSpan={7}>No paid franchise applications have been received yet.</td></tr> : null}</tbody></table></div></section>
    {selectedApplication ? <ApplicationReviewModal application={selectedApplication} token={token} busyId={busyId} error={reviewError} onClose={() => { setReviewError(''); setSelectedApplicationId(''); }} onDocumentVerification={(kind, verified) => void verifyDocument(selectedApplication, kind, verified)} onAssignVideoKyc={() => void assignVideoKyc(selectedApplication)} onAdvance={(notes) => void advance(selectedApplication, notes)} onProceedAgreement={(notes) => void proceedAgreement(selectedApplication, notes)} onApplicationUpdated={replaceApplication} notify={notify} /> : null}
  </section>;
}

function FieldVisitReviewSection({ application, token, eligible, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; eligible: boolean; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const visit = application.field_visit ?? null;
  const [officerName, setOfficerName] = useState('');
  const [officerPhone, setOfficerPhone] = useState('');
  const [secureLink, setSecureLink] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [managerRemarks, setManagerRemarks] = useState('');
  const [report, setReport] = useState<FieldVisitReport>({});
  useEffect(() => { setManagerRemarks(visit?.manager_remarks ?? ''); setReport(visit?.report ?? {}); setError(''); }, [visit?.id, visit?.submitted_at]);
  useEffect(() => { let current = true; if (!visit || visit.status === 'approved') { setSecureLink(''); return () => { current = false; }; } void (async () => { try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/field-visit`, { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { officer_submission_url?: string } } | null; if (response.ok && payload?.success && current) setSecureLink(payload.data?.officer_submission_url ?? ''); } catch { /* Keeping the existing link or placeholder is safe if the refresh fails. */ } })(); return () => { current = false; }; }, [application.id, token, visit?.id, visit?.status]);
  async function assign() { setBusy('assign'); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/field-visit`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ officer_name: officerName, officer_phone: officerPhone }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; officer_submission_url?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to assign a Field Visit.'); onApplicationUpdated(payload.data.application); setSecureLink(payload.data.officer_submission_url ?? ''); notify('Field Visit assigned. Share the secure officer link.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to assign a Field Visit.'); } finally { setBusy(''); } }
  async function save(action: 'save' | 'approve' | 'reject') { if (!visit) return; setBusy(action); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/field-visit`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, manager_remarks: managerRemarks, report }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; officer_submission_url?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to save the Field Visit review.'); onApplicationUpdated(payload.data.application); setSecureLink(payload.data.officer_submission_url ?? secureLink); notify(action === 'approve' ? 'Final Field Visit report approved and locked.' : action === 'reject' ? 'Officer was asked to correct the Field Visit report.' : 'Field Visit report review saved.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the Field Visit review.'); } finally { setBusy(''); } }
  async function downloadReport() { setBusy('download'); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/field-visit/report`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message ?? 'Unable to create the final Field Visit PDF.'); } const file = await response.blob(); const url = window.URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = `Remedium-Lab-Field-Visit-${application.application_number}.pdf`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000); } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : 'Unable to create the final Field Visit PDF.'); } finally { setBusy(''); } }
  async function copyGoogleMapsLink() {
    const location = report.google_maps_url?.trim();
    if (!location) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(location);
      else { const input = document.createElement('textarea'); input.value = location; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove(); }
      notify('Google Maps location link copied.');
    } catch { setError('Unable to copy the Google Maps link. Select and copy the link manually.'); }
  }
  if (!eligible && !visit) return <section className="application-review-section field-visit-review"><div className="application-review-section-head"><div><h3>Field Visit</h3><p>Complete Video KYC before a Field Visit Officer can be assigned.</p></div><span>Video KYC required</span></div></section>;
  if (!visit) return <section className="application-review-section field-visit-review"><div className="application-review-section-head"><div><h3>Field Visit</h3><p>Video KYC is complete. Assign an officer and give them the secure report link; no manager account is needed for the submission.</p></div><span>Ready to assign</span></div><div className="field-visit-assign-grid"><label>Field Visit Officer name<input value={officerName} onChange={(event) => setOfficerName(event.target.value)} placeholder="Officer full name" /></label><label>Officer contact number<input value={officerPhone} onChange={(event) => setOfficerPhone(event.target.value)} placeholder="10-digit mobile number" /></label><button type="button" disabled={busy === 'assign'} onClick={() => void assign()}>{busy === 'assign' ? 'Assigning...' : 'Assign Field Visit'}</button></div>{error ? <p className="application-review-error">{error}</p> : null}</section>;
  const field = (key: keyof FieldVisitReport, label: string, large = false) => <label className={large ? 'field-visit-report-wide' : ''}>{label}<textarea value={report[key] ?? ''} disabled={visit.status === 'approved'} onChange={(event) => setReport((current) => ({ ...current, [key]: event.target.value }))} /></label>;
  const googleMapsUrl = report.google_maps_url?.trim() ?? '';
  return <section className={`application-review-section field-visit-review ${visit.status}`}>
    <div className="application-review-section-head"><div><h3>Field Visit</h3><p>Officer: <b>{visit.officer_name}</b> · {visit.officer_phone}. {visit.status === 'approved' ? 'Final report is locked and available to the applicant.' : 'Review, edit and approve the submitted report or ask the officer to submit a corrected version.'}</p></div><span>{applicationStage(visit.status)}</span></div>
    {secureLink || visit.status !== 'approved' ? <div className="field-visit-link"><b>Secure officer submission link</b><input readOnly value={secureLink || 'Link is stored securely. Reassign or save review to show the shareable link in this session.'} /><small>Share only with the assigned Field Visit Officer. The link does not require Manager Panel access.</small></div> : null}
    {visit.report ? <div className="field-visit-report-grid">
      <label>Visit date<input type="date" value={report.visit_date ?? ''} disabled={visit.status === 'approved'} onChange={(event) => setReport((current) => ({ ...current, visit_date: event.target.value }))} /></label>
      <label>Site address<textarea value={report.site_address ?? ''} disabled={visit.status === 'approved'} onChange={(event) => setReport((current) => ({ ...current, site_address: event.target.value }))} /></label>
      <label className="field-visit-report-wide">Google Maps location link<input type="url" value={googleMapsUrl} disabled={visit.status === 'approved'} onChange={(event) => setReport((current) => ({ ...current, google_maps_url: event.target.value }))} placeholder="No Google Maps location was submitted" /><span className="field-visit-map-actions">{googleMapsUrl ? <><a href={googleMapsUrl} target="_blank" rel="noreferrer">Open Google Maps</a><button type="button" onClick={() => void copyGoogleMapsLink()}>Copy Google Maps link</button></> : <small>No location link was submitted by the officer.</small>}</span></label>
      {field('inspection_summary', 'Inspection summary', true)}{field('property_condition', 'Property condition')}{field('documents_observed', 'Documents observed')}{field('recommendation', 'Officer recommendation')}{field('officer_remarks', 'Officer remarks')}
    </div> : <div className="field-visit-awaiting">Awaiting the assigned officer's Field Visit report.</div>}
    <label className="field-visit-manager-note">Manager remarks<textarea value={managerRemarks} disabled={visit.status === 'approved'} onChange={(event) => setManagerRemarks(event.target.value)} placeholder="Add review notes, correction instructions or approval remarks." /></label>
    {visit.status === 'approved' ? <button type="button" className="field-visit-final-pdf" disabled={busy === 'download'} onClick={() => void downloadReport()}>{busy === 'download' ? 'Preparing PDF...' : 'Download final Field Visit PDF'}</button> : visit.report ? <div className="field-visit-review-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void save('save')}>{busy === 'save' ? 'Saving...' : 'Save review edits'}</button><button type="button" className="warning" disabled={Boolean(busy)} onClick={() => void save('reject')}>{busy === 'reject' ? 'Saving...' : 'Request corrected report'}</button><button type="button" disabled={Boolean(busy)} onClick={() => void save('approve')}>{busy === 'approve' ? 'Approving...' : 'Approve final report'}</button></div> : null}
    {error ? <p className="application-review-error">{error}</p> : null}
  </section>;
}

function TerritoryAllotmentDialogPortal({ open, children }: { open: boolean; children: ReactNode }) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

function TerritoryAllotmentSection({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const current = application.territory_allotment ?? null;
  const savedRadius = Number(current?.radius_km ?? 5);
  const savedRadiusChoice = [2, 5, 10].includes(savedRadius) ? String(savedRadius) : 'custom';
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<TerritoryOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ territory_id: current?.territory_id ?? application.territory_id ?? '', final_territory: current?.final_territory ?? application.territory_label ?? application.preferred_location, radius_choice: savedRadiusChoice, custom_radius: savedRadiusChoice === 'custom' ? String(savedRadius) : '', effective_date: current?.effective_date ?? new Date().toISOString().slice(0, 10), google_maps_url: current?.google_maps_url ?? application.field_visit?.report?.google_maps_url ?? '' });

  useEffect(() => {
    setForm({ territory_id: current?.territory_id ?? application.territory_id ?? '', final_territory: current?.final_territory ?? application.territory_label ?? application.preferred_location, radius_choice: savedRadiusChoice, custom_radius: savedRadiusChoice === 'custom' ? String(savedRadius) : '', effective_date: current?.effective_date ?? new Date().toISOString().slice(0, 10), google_maps_url: current?.google_maps_url ?? application.field_visit?.report?.google_maps_url ?? '' });
  }, [application.id, application.territory_id, application.territory_label, application.preferred_location, application.field_visit?.report?.google_maps_url, current?.id, current?.effective_date, current?.final_territory, current?.google_maps_url, current?.radius_km, current?.territory_id]);

  async function openAllocation() {
    setOpen(true); setLoadingOptions(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/territory-allotment`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { territories?: TerritoryOption[] }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to load territory options.');
      const territories = payload.data?.territories ?? [];
      setOptions(territories);
      if (!form.territory_id && territories[0]) setForm((value) => ({ ...value, territory_id: territories[0].id, final_territory: value.final_territory || territories[0].label }));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load territory options.'); } finally { setLoadingOptions(false); }
  }

  async function saveAllotment() {
    const radius = form.radius_choice === 'custom' ? Number(form.custom_radius) : Number(form.radius_choice);
    if (!form.territory_id || !form.final_territory.trim() || !form.effective_date || !Number.isFinite(radius) || radius < 1 || radius > 100) { setError('Choose a registered territory, final territory name, effective date and a radius from 1 to 100 km.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/territory-allotment`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ territory_id: form.territory_id, final_territory: form.final_territory.trim(), radius_km: radius, effective_date: form.effective_date, google_maps_url: form.google_maps_url.trim() }) });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to issue the Territory Allotment Letter.');
      onApplicationUpdated(payload.data.application); setOpen(false); notify(current ? 'Updated Territory Allotment Letter issued and archived.' : 'Territory allotted and official letter issued.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to issue the Territory Allotment Letter.'); } finally { setBusy(false); }
  }

  async function downloadLetter() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/territory-allotment/report`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message ?? 'Unable to generate the Territory Allotment Letter.'); }
      const file = await response.blob(); const url = window.URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = `Remedium-Lab-Territory-Allotment-${application.application_number}.pdf`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : 'Unable to generate the Territory Allotment Letter.'); } finally { setBusy(false); }
  }

  function createGoogleMapsLink() {
    const query = [application.address, application.city, application.district, application.pincode, 'West Bengal'].filter(Boolean).join(', ');
    if (!query) { setError('The application does not have enough address information to create a Google Maps location link.'); return; }
    setForm((value) => ({ ...value, google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` }));
    setError('');
  }

  const approved = application.field_visit?.status === 'approved';
  const selected = options.find((item) => item.id === form.territory_id);
  const history = [...(application.territory_allotments ?? [])].reverse();
  if (!approved) return <section className="application-review-section territory-allotment-review"><div className="application-review-section-head"><div><h3>Territory allotment</h3><p>Approve the final Field Visit report to unlock territory allocation and the official allotment letter.</p></div><span>Field Visit approval required</span></div></section>;

  return <section className="application-review-section territory-allotment-review">
    <div className="application-review-section-head"><div><h3>Territory allotment</h3><p>Issue the final franchise territory after the approved Field Visit. Issued letters remain on the applicant portal; onboarded franchise records are archived in Franchisee Directory.</p></div><span>{current ? `Version ${current.version}` : 'Ready to allot'}</span></div>
    {current ? <div className="territory-allotment-current"><div><small>Allotted territory</small><b>{current.final_territory}</b><span>{current.radius_km} km radius · effective {displayDate(current.effective_date)}</span></div><div><small>Official letter</small><b>{current.letter_number}</b><span>Issued by {current.issued_by || 'RFMS Officer'}</span></div><button type="button" className="secondary" disabled={busy} onClick={() => void downloadLetter()}>{busy ? 'Preparing PDF...' : 'Download letter'}</button></div> : <div className="territory-allotment-intro"><b>Field Visit Approved — Ready to Allot the Franchise Territory.</b><span>Confirm the registered PIN-code territory, radius and final territory wording before the applicant sees the official letter.</span></div>}
      <div className="territory-allotment-actions"><button type="button" onClick={() => void openAllocation()}>{current ? 'Update / reissue Territory Allotment' : 'Allot Territory'}</button></div>
    {history.length ? <div className="territory-allotment-history"><b>Allotment history</b>{history.map((item) => <span key={item.id}>Version {item.version} · {item.letter_number} · issued {displayDate(item.issued_at)}</span>)}</div> : null}
    {error && !open ? <p className="application-review-error">{error}</p> : null}
    <TerritoryAllotmentDialogPortal open={open}>
      <div className="territory-allotment-dialog-backdrop" role="presentation" onMouseDown={() => !busy && setOpen(false)}><section className="territory-allotment-dialog" role="dialog" aria-modal="true" aria-labelledby="territory-allotment-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>Territory Allocation</p><h3 id="territory-allotment-title">Allot franchise territory</h3><span>Set the final territory before issuing the official letter.</span></div><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Close</button></header>
      <div className="territory-allotment-location"><div><small>Franchise address</small><b>{[application.address, application.city, application.district, application.pincode].filter(Boolean).join(', ') || 'Not recorded'}</b></div><div><small>District / State</small><b>{application.district || 'Not recorded'}, West Bengal</b></div><div><small>Applicant PIN code</small><b>{application.pincode || 'Not recorded'}</b></div><div><small>Franchise model</small><b>{application.franchise_model}</b></div></div>
      {loadingOptions ? <p className="territory-allotment-loading">Loading registered territories for this PIN code...</p> : <div className="territory-allotment-form"><label>Registered PIN-code territory<select value={form.territory_id} onChange={(event) => { const next = options.find((item) => item.id === event.target.value); setForm((value) => ({ ...value, territory_id: event.target.value, final_territory: value.final_territory || next?.label || '' })); }}><option value="">Choose a territory</option>{options.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.available_units} {application.franchise_model} slot{item.available_units === 1 ? '' : 's'} available</option>)}</select></label>
        {!options.length ? <p className="application-review-error">No registered territory currently covers applicant PIN code {application.pincode || '—'}. Create PIN-wise capacity in Territory first.</p> : null}
        <label>Final territory name<input value={form.final_territory} onChange={(event) => setForm((value) => ({ ...value, final_territory: event.target.value }))} placeholder="e.g. New Town / Salt Lake" /></label>
        <label>Territory radius<select value={form.radius_choice} onChange={(event) => setForm((value) => ({ ...value, radius_choice: event.target.value }))}><option value="2">2 km</option><option value="5">5 km</option><option value="10">10 km</option><option value="custom">Custom radius</option></select></label>
        {form.radius_choice === 'custom' ? <label>Custom radius (km)<input min="1" max="100" type="number" value={form.custom_radius} onChange={(event) => setForm((value) => ({ ...value, custom_radius: event.target.value }))} /></label> : null}
        <label>Effective date<input type="date" value={form.effective_date} onChange={(event) => setForm((value) => ({ ...value, effective_date: event.target.value }))} /></label>
        <label className="territory-allotment-map">Google Maps location link<input type="url" value={form.google_maps_url} onChange={(event) => setForm((value) => ({ ...value, google_maps_url: event.target.value }))} placeholder="Paste or confirm the approved site Google Maps link" /><span><button type="button" className="secondary" onClick={createGoogleMapsLink}>Create link from franchise address</button>{form.google_maps_url ? <a href={form.google_maps_url} target="_blank" rel="noreferrer">Open selected Google Maps location</a> : null}</span></label>
        {selected ? <div className="territory-allotment-capacity"><b>{selected.label}</b><span>PINs: {selected.pincodes.join(', ')} · Available for {application.franchise_model}: {selected.available_units}</span></div> : null}
      </div>}
      <footer><p>The official letter includes the company performance, compliance and operational-requirements territory-change clause.</p><div><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" disabled={busy || loadingOptions || !options.length} onClick={() => void saveAllotment()}>{busy ? 'Issuing letter...' : current ? 'Issue updated letter' : 'Confirm allocation and issue letter'}</button></div></footer>
      {error ? <p className="application-review-error">{error}</p> : null}
    </section></div>
    </TerritoryAllotmentDialogPortal>
  </section>;
}

type AllocationPoint = { lat: number; lng: number };

let allocationGoogleMapsLoader: Promise<void> | null = null;

function loadAllocationGoogleMaps() {
  if (typeof window === 'undefined' || (window as any).google?.maps) return Promise.resolve();
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error('Google Maps is not configured. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to .env.local and restart run-admin.cmd.'));
  if (allocationGoogleMapsLoader) return allocationGoogleMapsLoader;
  allocationGoogleMapsLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps could not be loaded. Check the browser-restricted key and Maps JavaScript API configuration.'));
    document.head.appendChild(script);
  });
  return allocationGoogleMapsLoader;
}

function coordinateValue(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function allocationDistanceKm(first: AllocationPoint, second: AllocationPoint) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDistance = radians(second.lat - first.lat);
  const longitudeDistance = radians(second.lng - first.lng);
  const value = Math.sin(latitudeDistance / 2) ** 2 + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(longitudeDistance / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function allocationMapLink(point: AllocationPoint) {
  return `https://www.google.com/maps?q=${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

function kilometresToMetres(value: number) {
  return Number.isFinite(value) && value > 0 ? value * 1000 : 0;
}

function TerritoryAllocationMap({ point, radiusKm, franchises, onPointChange }: { point: AllocationPoint | null; radiusKm: number; franchises: NearbyFranchise[]; onPointChange: (point: AllocationPoint) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const clickListenerRef = useRef<any>(null);
  const artifactsRef = useRef<any[]>([]);
  const proposedCircleRef = useRef<any>(null);
  const onPointChangeRef = useRef(onPointChange);
  const [mapError, setMapError] = useState('');
  const [ready, setReady] = useState(false);
  const radiusMetres = kilometresToMetres(radiusKm);

  useEffect(() => { onPointChangeRef.current = onPointChange; }, [onPointChange]);
  useEffect(() => {
    let cancelled = false;
    void loadAllocationGoogleMaps().then(() => {
      if (cancelled || !canvasRef.current || mapRef.current) return;
      const google = (window as any).google;
      const map = new google.maps.Map(canvasRef.current, {
        center: point ?? { lat: 22.5726, lng: 88.3639 }, zoom: point ? 13 : 7,
        mapTypeControl: true, streetViewControl: false, fullscreenControl: true, zoomControl: true, scaleControl: true, gestureHandling: 'greedy', clickableIcons: true,
      });
      clickListenerRef.current = map.addListener('click', (event: any) => {
        if (event.latLng) onPointChangeRef.current({ lat: event.latLng.lat(), lng: event.latLng.lng() });
      });
      mapRef.current = map; setReady(true);
    }).catch((loadError: unknown) => { if (!cancelled) setMapError(loadError instanceof Error ? loadError.message : 'Google Maps could not be loaded.'); });
    return () => { cancelled = true; clickListenerRef.current?.remove?.(); artifactsRef.current.forEach((artifact) => artifact.setMap?.(null)); artifactsRef.current = []; proposedCircleRef.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const google = (window as any).google;
    artifactsRef.current.forEach((artifact) => artifact.setMap?.(null)); artifactsRef.current = []; proposedCircleRef.current = null;
    const map = mapRef.current; const infoWindow = new google.maps.InfoWindow(); const bounds = new google.maps.LatLngBounds();
    franchises.filter((franchise) => franchise.coordinates_available && franchise.latitude !== null && franchise.longitude !== null).forEach((franchise) => {
      const position = { lat: Number(franchise.latitude), lng: Number(franchise.longitude) };
      const occupied = franchise.status === 'occupied'; const colour = occupied ? '#d94b47' : '#dd921b';
      const marker = new google.maps.Marker({ map, position, title: `${franchise.franchise_name} — ${franchise.pincode}`, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: colour, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 } });
      marker.addListener('click', () => {
        const node = document.createElement('div'); node.className = 'allocation-map-info';
        const name = document.createElement('strong'); name.textContent = franchise.franchise_name;
        const place = document.createElement('span'); place.textContent = `${franchise.subdivision || 'Subdivision not recorded'}, ${franchise.district || 'District not recorded'}`;
        const state = document.createElement('b'); state.textContent = `${occupied ? 'Occupied' : 'Reserved'} · PIN ${franchise.pincode}`;
        const coverage = document.createElement('small'); coverage.textContent = `${franchise.radius_km} km coverage radius`;
        node.append(name, place, state, coverage);
        infoWindow.setContent(node); infoWindow.open({ map, anchor: marker });
      });
      const circle = new google.maps.Circle({ map, center: position, radius: kilometresToMetres(Number(franchise.radius_km)), strokeColor: colour, strokeOpacity: 0.75, strokeWeight: 1.5, fillColor: colour, fillOpacity: 0.09, clickable: false });
      artifactsRef.current.push(marker, circle); bounds.extend(position);
    });
    if (point) {
      const marker = new google.maps.Marker({ map, position: point, draggable: true, title: 'Proposed franchise location', icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#078b91', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 } });
      marker.addListener('dragend', (event: any) => { if (event.latLng) onPointChangeRef.current({ lat: event.latLng.lat(), lng: event.latLng.lng() }); });
      const radiusMetres = kilometresToMetres(radiusKm);
      const circle = radiusMetres ? new google.maps.Circle({ map, center: point, radius: radiusMetres, strokeColor: '#078b91', strokeOpacity: 0.92, strokeWeight: 2, fillColor: '#078b91', fillOpacity: 0.12, clickable: false }) : null;
      proposedCircleRef.current = circle;
      artifactsRef.current.push(marker, ...(circle ? [circle] : [])); map.panTo(point); map.setZoom(Math.max(map.getZoom() ?? 0, 12));
    } else if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
  }, [franchises, point, radiusKm, ready]);

  useEffect(() => {
    const radiusMetres = kilometresToMetres(radiusKm);
    if (!ready || !point || !radiusMetres) return;
    // Google Maps Circle stores its radius in metres. Updating the native object
    // keeps the boundary centred on the selected pin and removes screen-scale math.
    proposedCircleRef.current?.setCenter?.(point);
    proposedCircleRef.current?.setRadius?.(radiusMetres);
  }, [point, radiusKm, ready]);

  return <section className="territory-allocation-map-panel">
    <div className="territory-allocation-map-head"><div><b>Exact location and coverage map</b><span>Click the map or drag the teal pin to set the proposed franchise location. Google Maps calculates every circle from its real metre radius; red and amber circles are existing occupied or reserved coverage.</span></div><span className={mapError ? 'map-state error' : 'map-state'}>{mapError ? 'Map unavailable' : point && radiusMetres ? `${radiusKm} km / ${radiusMetres.toLocaleString()} m` : point ? 'Enter a valid radius' : 'Pin required for map conflict check'}</span></div>
    <div ref={canvasRef} className="territory-allocation-map-canvas" data-radius-metres={kilometresToMetres(radiusKm) || undefined} aria-label="Google Maps territory allocation map. Click to place the proposed franchise location." />
    {mapError ? <p className="territory-allocation-map-error" role="alert">{mapError}</p> : null}
    <div className="territory-allocation-map-legend"><span><i className="proposed" /> Proposed coverage</span><span><i className="occupied" /> Occupied territory</span><span><i className="reserved" /> Reserved / partly occupied</span><small>Circle radii are calculated in metres from the selected kilometre value. Roads, localities and landmarks are supplied by Google Maps. PIN and district boundaries appear when Google Maps has that data for the current zoom.</small></div>
  </section>;
}

function EnhancedTerritoryAllotmentSection({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const current = application.territory_allotment ?? null;
  const savedRadius = Number(current?.radius_km ?? 6);
  const savedRadiusChoice = [3, 6, 10].includes(savedRadius) ? String(savedRadius) : 'custom';
  const initialForm = () => ({ territory_id: current?.territory_id ?? application.territory_id ?? '', final_territory: current?.final_territory ?? application.territory_label ?? application.preferred_location, franchise_address: current?.franchise_address ?? application.field_visit?.report?.site_address ?? application.address ?? '', district: current?.district ?? application.district ?? '', state: current?.state ?? 'West Bengal', subdivision: current?.subdivision ?? '', pincode: current?.pincode ?? application.pincode ?? '', preferred_location: current?.preferred_location ?? application.preferred_location, latitude: current?.latitude === null || current?.latitude === undefined ? '' : String(current.latitude), longitude: current?.longitude === null || current?.longitude === undefined ? '' : String(current.longitude), radius_choice: savedRadiusChoice, custom_radius: savedRadiusChoice === 'custom' ? String(savedRadius) : '', effective_date: current?.effective_date ?? new Date().toISOString().slice(0, 10), google_maps_url: current?.google_maps_url ?? application.field_visit?.report?.google_maps_url ?? '', conflict_override: false });
  const [open, setOpen] = useState(false); const [options, setOptions] = useState<TerritoryOption[]>([]); const [nearbyFranchises, setNearbyFranchises] = useState<NearbyFranchise[]>([]); const [loadingOptions, setLoadingOptions] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [form, setForm] = useState(initialForm);
  useEffect(() => { setForm(initialForm()); }, [application.id, current?.id]);

  async function openAllocation() {
    setOpen(true); setLoadingOptions(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/territory-allotment`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { territories?: TerritoryOption[]; nearby_franchises?: NearbyFranchise[] }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to load territory options.');
      const territories = payload.data?.territories ?? []; setOptions(territories); setNearbyFranchises(payload.data?.nearby_franchises ?? []);
      if (!form.territory_id && territories[0]) setForm((value) => ({ ...value, territory_id: territories[0].id, final_territory: value.final_territory || territories[0].label, subdivision: value.subdivision || territories[0].subdivision || '' }));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load territory options.'); } finally { setLoadingOptions(false); }
  }

  const radius = form.radius_choice === 'custom' ? Number(form.custom_radius) : Number(form.radius_choice);
  const mapPoint = useMemo<AllocationPoint | null>(() => { const latitude = coordinateValue(form.latitude); const longitude = coordinateValue(form.longitude); return latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? { lat: latitude, lng: longitude } : null; }, [form.latitude, form.longitude]);
  const conflicts = useMemo(() => !mapPoint || !Number.isFinite(radius) ? [] : nearbyFranchises.filter((franchise) => franchise.coordinates_available && franchise.latitude !== null && franchise.longitude !== null && allocationDistanceKm(mapPoint, { lat: Number(franchise.latitude), lng: Number(franchise.longitude) }) < radius + Number(franchise.radius_km || 0)).map((franchise) => ({ ...franchise, distance_km: allocationDistanceKm(mapPoint, { lat: Number(franchise.latitude), lng: Number(franchise.longitude) }) })), [mapPoint, nearbyFranchises, radius]);
  const registeredFranchises = useMemo(() => nearbyFranchises.filter((franchise) => franchise.pincode === form.pincode), [form.pincode, nearbyFranchises]);
  const selected = options.find((item) => item.id === form.territory_id);

  async function saveAllotment() {
    if (!form.territory_id || !form.final_territory.trim() || !form.franchise_address.trim() || !form.district.trim() || !form.subdivision.trim() || !form.pincode.trim() || !form.effective_date || !Number.isFinite(radius) || radius < 0.1 || radius > 100) { setError('Complete the franchise address, district, subdivision, registered PIN code, final territory name, effective date and a radius from 0.1 to 100 km.'); return; }
    if ((form.latitude || form.longitude) && !mapPoint) { setError('GPS latitude and longitude must both be valid before you issue the letter.'); return; }
    if (conflicts.length && !form.conflict_override) { setError('The proposed coverage overlaps an existing franchise territory. Adjust the map pin or radius, or record a manager-approved overlap exception.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/territory-allotment`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ territory_id: form.territory_id, final_territory: form.final_territory.trim(), franchise_address: form.franchise_address.trim(), district: form.district.trim(), state: form.state.trim(), subdivision: form.subdivision.trim(), pincode: form.pincode.trim(), preferred_location: form.preferred_location.trim(), latitude: mapPoint?.lat ?? null, longitude: mapPoint?.lng ?? null, radius_km: radius, effective_date: form.effective_date, google_maps_url: form.google_maps_url.trim() || (mapPoint ? allocationMapLink(mapPoint) : ''), conflict_override: form.conflict_override }) });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to issue the Territory Allotment Letter.');
      onApplicationUpdated(payload.data.application); setOpen(false); notify(current ? 'Updated Territory Allotment Letter issued and archived.' : 'Territory allotted and official letter issued.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to issue the Territory Allotment Letter.'); } finally { setBusy(false); }
  }

  async function downloadLetter() {
    setBusy(true); setError('');
    try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/territory-allotment/report`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message ?? 'Unable to generate the Territory Allotment Letter.'); } const file = await response.blob(); const url = window.URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = `Remedium-Lab-Territory-Allotment-${application.application_number}.pdf`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000); } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : 'Unable to generate the Territory Allotment Letter.'); } finally { setBusy(false); }
  }

  function createGoogleMapsLink() { const query = [form.franchise_address, form.preferred_location, form.subdivision, form.district, form.pincode, form.state].filter(Boolean).join(', '); if (!query) { setError('Enter the franchise address before creating a Google Maps location link.'); return; } setForm((value) => ({ ...value, google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` })); setError(''); }

  const approved = application.field_visit?.status === 'approved'; const history = [...(application.territory_allotments ?? [])].reverse();
  if (!approved) return <section className="application-review-section territory-allotment-review"><div className="application-review-section-head"><div><h3>Territory allotment</h3><p>Approve the final Field Visit report to unlock territory allocation and the official allotment letter.</p></div><span>Field Visit approval required</span></div></section>;
  return <section className="application-review-section territory-allotment-review">
    <div className="application-review-section-head"><div><h3>Territory allotment</h3><p>Issue the final franchise territory after the approved Field Visit. Issued letters remain on the applicant portal; onboarded franchise records are archived in Franchisee Directory.</p></div><span>{current ? `Version ${current.version}` : 'Ready to allot'}</span></div>
    {current ? <div className="territory-allotment-current"><div><small>Allotted territory</small><b>{current.final_territory}</b><span>{current.radius_km} km radius · effective {displayDate(current.effective_date)}</span></div><div><small>Official letter</small><b>{current.letter_number}</b><span>Issued by {current.issued_by || 'RFMS Officer'}</span></div><button type="button" className="secondary" disabled={busy} onClick={() => void downloadLetter()}>{busy ? 'Preparing PDF...' : 'Download letter'}</button></div> : <div className="territory-allotment-intro"><b>Field Visit Approved — Ready to Allot the Franchise Territory.</b><span>Confirm the registered PIN-code territory, exact map point, coverage radius and final territory wording before the applicant sees the official letter.</span></div>}
    <div className="territory-allotment-actions"><button type="button" onClick={() => void openAllocation()}>{current ? 'Update / reissue Territory Allotment' : 'Allot Territory'}</button></div>
    {history.length ? <div className="territory-allotment-history"><b>Allotment history</b>{history.map((item) => <span key={item.id}>Version {item.version} · {item.letter_number} · issued {displayDate(item.issued_at)}</span>)}</div> : null}
    {error && !open ? <p className="application-review-error">{error}</p> : null}
    <TerritoryAllotmentDialogPortal open={open}>
      <div className="territory-allotment-dialog-backdrop" role="presentation" onMouseDown={() => !busy && setOpen(false)}><section className="territory-allotment-dialog territory-allotment-dialog-expanded" role="dialog" aria-modal="true" aria-labelledby="territory-allotment-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>Territory Allocation</p><h3 id="territory-allotment-title">Allot franchise territory</h3><span>Pin the verified franchise site, inspect existing coverage and issue the official letter only after any overlap is resolved or approved.</span></div><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Close</button></header>
      <div className="territory-allotment-location"><div><small>Applicant</small><b>{application.full_name}</b></div><div><small>Franchise model</small><b>{application.franchise_model}</b></div><div><small>Application</small><b>{application.application_number}</b></div><div><small>Registered PIN code</small><b>{application.pincode || 'Not recorded'}</b></div></div>
      {loadingOptions ? <p className="territory-allotment-loading">Loading registered PIN-code capacity and existing franchise coverage...</p> : <div className="territory-allotment-form territory-allotment-form-expanded">
        <label className="territory-field-wide">Franchise address<textarea value={form.franchise_address} onChange={(event) => setForm((value) => ({ ...value, franchise_address: event.target.value }))} placeholder="Verified franchise site address" /></label>
        <label>District<input value={form.district} onChange={(event) => setForm((value) => ({ ...value, district: event.target.value }))} /></label><label>State<input value={form.state} onChange={(event) => setForm((value) => ({ ...value, state: event.target.value }))} /></label><label>Subdivision<input value={form.subdivision} onChange={(event) => setForm((value) => ({ ...value, subdivision: event.target.value }))} placeholder="e.g. Barasat" /></label><label>Registered PIN code<input value={form.pincode} readOnly aria-readonly="true" title="Capacity is tied to the applicant's registered PIN code" /></label>
        <label>Preferred franchise location<input value={form.preferred_location} onChange={(event) => setForm((value) => ({ ...value, preferred_location: event.target.value }))} /></label><label>Final territory name<input value={form.final_territory} onChange={(event) => setForm((value) => ({ ...value, final_territory: event.target.value }))} placeholder="e.g. New Town / Salt Lake" /></label><label>Territory radius<select value={form.radius_choice} onChange={(event) => setForm((value) => ({ ...value, radius_choice: event.target.value }))}><option value="3">3 km</option><option value="6">6 km</option><option value="10">10 km</option><option value="custom">Custom radius</option></select></label>{form.radius_choice === 'custom' ? <label>Custom radius (km)<input min="0.1" max="100" step="0.1" type="number" value={form.custom_radius} onChange={(event) => setForm((value) => ({ ...value, custom_radius: event.target.value }))} /></label> : null}<label>Effective date<input type="date" value={form.effective_date} onChange={(event) => setForm((value) => ({ ...value, effective_date: event.target.value }))} /></label>
        <label>GPS latitude (optional)<input inputMode="decimal" value={form.latitude} onChange={(event) => setForm((value) => ({ ...value, latitude: event.target.value }))} placeholder="Set by map pin" /></label><label>GPS longitude (optional)<input inputMode="decimal" value={form.longitude} onChange={(event) => setForm((value) => ({ ...value, longitude: event.target.value }))} placeholder="Set by map pin" /></label>
        <label className="territory-allotment-map">Google Maps location link<input type="url" value={form.google_maps_url} onChange={(event) => setForm((value) => ({ ...value, google_maps_url: event.target.value }))} placeholder="Created automatically when you pin the location, or paste an approved link" /><span><button type="button" className="secondary" onClick={createGoogleMapsLink}>Create link from franchise address</button>{form.google_maps_url ? <a href={form.google_maps_url} target="_blank" rel="noreferrer">Open selected Google Maps location</a> : null}</span></label>
        {!options.length ? <p className="application-review-error territory-field-wide">No registered territory currently covers applicant PIN code {application.pincode || '—'}. Create PIN-wise capacity in Territory first.</p> : null}{selected ? <section className="territory-allotment-capacity territory-field-wide"><b>{selected.label}</b><span>Registered PIN {form.pincode}: {selected.available_units} {application.franchise_model} unit{selected.available_units === 1 ? '' : 's'} currently available · {selected.subdivision || 'Subdivision not recorded'}, {selected.district}</span></section> : null}
        <section className="registered-pin-territories territory-field-wide"><header><div><b>Registered PIN Code Territory</b><span>RFMS capacity is calculated from the applicant’s registered PIN. Select the coverage record that will reserve the next {application.franchise_model} unit.</span></div><span>{options.length} matching record{options.length === 1 ? '' : 's'}</span></header><div className="registered-pin-grid">{options.map((item) => <button type="button" key={item.id} className={`registered-pin-card ${item.id === form.territory_id ? 'selected' : ''} ${item.registered_pin_status || item.status || 'available'}`} onClick={() => setForm((value) => ({ ...value, territory_id: item.id, final_territory: value.final_territory || item.label, subdivision: value.subdivision || item.subdivision || '' }))}><span>{item.registered_pin_status === 'occupied' ? 'Occupied' : item.available_units > 0 ? 'Available' : 'No capacity'}</span><b>{item.label}</b><small>{item.subdivision || 'Subdivision not recorded'} · {item.district}</small><em>PIN {form.pincode} · {item.available_units} {application.franchise_model} available</em></button>)}</div><div className="registered-franchise-list">{registeredFranchises.length ? registeredFranchises.map((franchise) => <article key={franchise.application_id}><span className={franchise.status === 'occupied' ? 'occupied' : 'reserved'}>{franchise.status === 'occupied' ? 'Occupied' : 'Reserved'}</span><b>{franchise.franchise_name}</b><small>{franchise.subdivision || 'Subdivision not recorded'}, {franchise.district || 'District not recorded'} · PIN {franchise.pincode}{franchise.coordinates_available ? ` · ${franchise.radius_km} km mapped coverage` : ' · exact map point not yet recorded'}</small></article>) : <p>No issued franchise territory is recorded for this PIN code yet.</p>}</div></section>
        <div className="territory-field-wide"><TerritoryAllocationMap point={mapPoint} radiusKm={Number.isFinite(radius) && radius >= 0.1 ? radius : 0} franchises={nearbyFranchises} onPointChange={(point) => setForm((value) => ({ ...value, latitude: point.lat.toFixed(6), longitude: point.lng.toFixed(6), google_maps_url: allocationMapLink(point) }))} /></div>
        {conflicts.length ? <section className="territory-conflict-warning territory-field-wide"><div><b>Coverage conflict detected</b><span>The proposed {radius} km radius overlaps {conflicts.length} active franchise territory{conflicts.length === 1 ? '' : 'ies'}.</span></div><ul>{conflicts.map((franchise) => <li key={franchise.application_id}><b>{franchise.franchise_name}</b> · {franchise.distance_km.toFixed(2)} km away · {franchise.radius_km} km existing radius · {franchise.subdivision || franchise.district}</li>)}</ul><label><input type="checkbox" checked={form.conflict_override} onChange={(event) => setForm((value) => ({ ...value, conflict_override: event.target.checked }))} /> I confirm that company policy permits this recorded overlap exception.</label></section> : mapPoint ? <section className="territory-conflict-clear territory-field-wide"><b>No map conflict detected</b><span>The selected point and {radius} km coverage do not overlap any existing allocation with a recorded GPS point.</span></section> : <section className="territory-conflict-neutral territory-field-wide"><b>Set an exact map pin for live conflict validation</b><span>You can click the Google Map or enter GPS coordinates. The official letter can still record an approved address if coordinates are not available.</span></section>}
      </div>}
      <footer><p>The official letter includes the company performance, compliance and operational-requirements territory-change clause. Any permitted overlap is saved in the application audit history.</p><div><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" disabled={busy || loadingOptions || !options.length} onClick={() => void saveAllotment()}>{busy ? 'Issuing letter...' : current ? 'Issue updated letter' : 'Confirm allocation and issue letter'}</button></div></footer>{error ? <p className="application-review-error">{error}</p> : null}
    </section></div>
    </TerritoryAllotmentDialogPortal>
  </section>;
}

function OnboardingDocumentsReviewSection({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const [draft, setDraft] = useState({ title: '', description: '', required_count: '1' });
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function requestDocument() { setBusy('request'); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/onboarding-documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: draft.title, description: draft.description, required_count: Number(draft.required_count) }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to request this onboarding document.'); onApplicationUpdated(payload.data); setDraft({ title: '', description: '', required_count: '1' }); notify('Onboarding document request sent to the applicant.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to request this onboarding document.'); } finally { setBusy(''); } }
  async function review(document: OnboardingDocument, file: OnboardingDocumentFile, action: 'verify' | 'reupload' | 'reject') { const id = `${document.id}:${file.id}:${action}`; setBusy(id); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/onboarding-documents/${document.id}/files/${file.id}/review`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, remarks: remarks[file.id] ?? '' }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to review this onboarding document.'); onApplicationUpdated(payload.data); notify(action === 'verify' ? 'Onboarding document verified.' : action === 'reupload' ? 'Applicant notified to upload the document again.' : 'Onboarding document rejected.'); } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : 'Unable to review this onboarding document.'); } finally { setBusy(''); } }
  return <section className="application-review-section onboarding-review"><div className="application-review-section-head"><div><h3>Franchisee onboarding documents</h3><p>Create as many application-specific document requirements as needed. The applicant sees each request in their Documents page immediately.</p></div><span>{(application.onboarding_documents ?? []).length} request{(application.onboarding_documents ?? []).length === 1 ? '' : 's'}</span></div><div className="onboarding-request-form"><label>Document title<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Municipality NOC" /></label><label>Required files<input type="number" min="1" max="100" value={draft.required_count} onChange={(event) => setDraft((current) => ({ ...current, required_count: event.target.value }))} /></label><label className="onboarding-request-description">Description for applicant<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Explain exactly what the applicant needs to upload." /></label><button type="button" disabled={busy === 'request'} onClick={() => void requestDocument()}>{busy === 'request' ? 'Sending...' : 'Request onboarding document'}</button></div><div className="onboarding-review-list">{!(application.onboarding_documents ?? []).length ? <p>No additional onboarding documents are required yet.</p> : (application.onboarding_documents ?? []).map((document) => <article key={document.id}><header><div><b>{document.title}</b><small>{document.description || 'No additional applicant instruction recorded.'}</small></div><span>{document.required_count} file{document.required_count === 1 ? '' : 's'} required</span></header>{Array.from({ length: document.required_count }, (_, index) => index + 1).map((slot) => { const file = [...document.files].reverse().find((item) => item.slot === slot && item.status !== 'superseded'); if (!file) return <div key={slot} className="onboarding-review-file pending"><b>File {slot}</b><span>Awaiting applicant upload</span></div>; const locked = file.status === 'verified'; return <div key={file.id} className={`onboarding-review-file ${file.status}`}><div><b>File {slot}: {file.name}</b><small>{file.status.replaceAll('_', ' ')}{file.submitted_at ? ` · submitted ${displayDate(file.submitted_at)}` : ''}</small></div><a href={resolveUploadUrl(file.url)} target="_blank" rel="noreferrer">View file</a><label><span>Manager remarks</span><input value={remarks[file.id] ?? file.remarks ?? ''} disabled={locked} onChange={(event) => setRemarks((current) => ({ ...current, [file.id]: event.target.value }))} placeholder="Optional review note" /></label><div className="onboarding-review-actions"><button type="button" disabled={locked || Boolean(busy)} onClick={() => void review(document, file, 'reupload')}>{busy === `${document.id}:${file.id}:reupload` ? 'Saving...' : 'Upload again'}</button><button type="button" disabled={locked || Boolean(busy)} onClick={() => void review(document, file, 'reject')}>{busy === `${document.id}:${file.id}:reject` ? 'Saving...' : 'Reject'}</button><button type="button" disabled={locked || Boolean(busy)} onClick={() => void review(document, file, 'verify')}>{locked ? 'Verified' : busy === `${document.id}:${file.id}:verify` ? 'Saving...' : 'Verify'}</button></div></div>; })}</article>)}</div>{error ? <p className="application-review-error">{error}</p> : null}</section>;
}

function BrandingSignageReviewSection({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const branding = application.branding_signage; const unlocked = Boolean(application.territory_allotment?.letter_number) && (application.franchise_model === 'FOFO' ? application.payments.some((payment) => payment.key === 'fofo_one_time_fee' && payment.status === 'paid') : application.payments.some((payment) => payment.key === 'franchise_fee' && payment.status === 'paid'));
  const [vendor, setVendor] = useState({ name: branding?.vendor?.name ?? '', shop_name: branding?.vendor?.shop_name ?? '', address: branding?.vendor?.address ?? '', phone: branding?.vendor?.phone ?? '' }); const [asset, setAsset] = useState({ title: '', url: '' }); const [materialFile, setMaterialFile] = useState<File | null>(null); const [link, setLink] = useState(''); const [remarks, setRemarks] = useState(branding?.manager_remarks ?? ''); const [cost, setCost] = useState(String(branding?.installation_cost ?? '')); const [invoice, setInvoice] = useState<File | null>(null); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (!branding || branding.status === 'approved') return; let active = true; void (async () => { try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/branding-signage`, { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { vendor_submission_url?: string } } | null; if (active && response.ok && payload?.success) setLink(payload.data?.vendor_submission_url ?? ''); } catch { /* A manager can regenerate the link below. */ } })(); return () => { active = false; }; }, [application.id, branding?.status, token]);
  async function saveSetup() { setBusy('setup'); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/branding-signage`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor_name: vendor.name, vendor_shop_name: vendor.shop_name, vendor_address: vendor.address, vendor_phone: vendor.phone, materials: asset.title && asset.url ? [asset] : [], material_title: materialFile?.name ?? '', material_name: materialFile?.name ?? '', material_data_url: materialFile ? await asDataUrl(materialFile) : '' }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; vendor_submission_url?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to save Branding Signage details.'); onApplicationUpdated(payload.data.application); setLink(payload.data.vendor_submission_url ?? ''); setAsset({ title: '', url: '' }); setMaterialFile(null); notify('Branding vendor workspace saved. Share the secure vendor link.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save Branding Signage details.'); } finally { setBusy(''); } }
  async function review(action: 'save' | 'approve' | 'reject' | 'request_correction') { setBusy(action); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/branding-signage`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, manager_remarks: remarks, installation_cost: cost === '' ? undefined : Number(cost), invoice_name: invoice?.name ?? '', invoice_data_url: invoice ? await asDataUrl(invoice) : '' }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; vendor_submission_url?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to save the Branding Signage review.'); onApplicationUpdated(payload.data.application); setLink(payload.data.vendor_submission_url ?? link); setInvoice(null); notify(action === 'approve' ? 'Branding Signage approved and published to the applicant portal.' : action === 'request_correction' ? 'Vendor was asked to correct the branding evidence.' : 'Branding Signage review saved.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the Branding Signage review.'); } finally { setBusy(''); } }
  if (!unlocked) return <section className="application-review-section workflow-module locked"><div className="application-review-section-head"><div><h3>Branding Signage</h3><p>Available after Territory Allotment and the required payment. FOFO unlocks after its one-time payment; FOCO unlocks after Phase 2.</p></div><span>Payment gate</span></div></section>;
  const submitted = branding?.status === 'submitted' || branding?.status === 'revision_requested' || branding?.status === 'rejected';
  return <section className="application-review-section workflow-module branding-module"><div className="application-review-section-head"><div><h3>Branding Signage</h3><p>Share approved assets, assign a vendor, verify completed installation evidence and retain the final invoice.</p></div><span>{branding ? branding.status.replaceAll('_', ' ') : 'Ready to set up'}</span></div>{!branding || !branding.vendor ? <div className="workflow-setup-grid"><label>Vendor name<input value={vendor.name} onChange={(event) => setVendor((current) => ({ ...current, name: event.target.value }))} /></label><label>Shop name<input value={vendor.shop_name} onChange={(event) => setVendor((current) => ({ ...current, shop_name: event.target.value }))} /></label><label>Contact number<input value={vendor.phone} onChange={(event) => setVendor((current) => ({ ...current, phone: event.target.value }))} /></label><label className="workflow-wide">Vendor address<textarea value={vendor.address} onChange={(event) => setVendor((current) => ({ ...current, address: event.target.value }))} /></label><label>Material title<input value={asset.title} onChange={(event) => setAsset((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Exterior signage artwork" /></label><label>Material link<input type="url" value={asset.url} onChange={(event) => setAsset((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." /></label><label className="workflow-wide">Or upload approved material<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setMaterialFile(event.target.files?.[0] ?? null)} /></label><button type="button" disabled={busy === 'setup'} onClick={() => void saveSetup()}>{busy === 'setup' ? 'Saving...' : 'Assign vendor and create secure link'}</button></div> : <><div className="workflow-assignment"><div><b>{branding.vendor.name} · {branding.vendor.shop_name}</b><small>{branding.vendor.phone} · {branding.vendor.address}</small></div>{branding.status !== 'approved' ? <button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(link).then(() => notify('Secure vendor link copied.')).catch(() => setError('Copy the secure link manually.'))}>Copy secure vendor link</button> : null}</div>{link ? <label className="secure-link-field">Vendor submission link<input readOnly value={link} /></label> : null}{branding.materials?.length ? <div className="workflow-assets">{branding.materials.map((item) => <a key={item.id || item.url} href={resolveUploadUrl(item.url)} target="_blank" rel="noreferrer">{item.title}</a>)}</div> : null}{branding.photographs?.length ? <div className="branding-photo-grid">{branding.photographs.map((photo) => <a key={photo.id || photo.url} href={resolveUploadUrl(photo.url)} target="_blank" rel="noreferrer"><img src={resolveUploadUrl(photo.url)} alt={photo.name} /><span>{photo.name}</span></a>)}</div> : null}{submitted ? <><label className="workflow-wide">Manager remarks<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Approval note or correction instructions" /></label><div className="workflow-review-grid"><label>Installation cost (INR)<input type="number" min="0" value={cost} onChange={(event) => setCost(event.target.value)} /></label><label>Final invoice<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setInvoice(event.target.files?.[0] ?? null)} /></label></div><div className="workflow-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void review('save')}>Save review</button><button type="button" className="warning" disabled={Boolean(busy)} onClick={() => void review('request_correction')}>Request correction</button><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void review('reject')}>Reject</button><button type="button" disabled={Boolean(busy)} onClick={() => void review('approve')}>{busy === 'approve' ? 'Approving...' : 'Approve branding work'}</button></div></> : branding.status === 'approved' ? <p className="workflow-final">Approved {branding.approved_at ? displayDate(branding.approved_at) : ''}. Branding evidence, invoice and cost are now visible to the applicant.</p> : <p className="workflow-awaiting">Awaiting the vendor’s completed-installation submission through the secure link.</p>}</>}{error ? <p className="application-review-error">{error}</p> : null}</section>;
}

function HrProcessReviewSection({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const hr = application.hr_process; const unlocked = application.franchise_model === 'FOCO' && Boolean(application.territory_allotment?.letter_number) && application.payments.some((payment) => payment.key === 'franchise_fee' && payment.status === 'paid'); const [link, setLink] = useState(''); const [remarks, setRemarks] = useState(hr?.manager_remarks ?? ''); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (!hr || hr.status === 'approved') return; let active = true; void (async () => { try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/hr-process`, { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { hr_submission_url?: string } } | null; if (active && response.ok && payload?.success) setLink(payload.data?.hr_submission_url ?? ''); } catch { /* Regenerate below if needed. */ } })(); return () => { active = false; }; }, [application.id, hr?.status, token]);
  async function assign() { setBusy('assign'); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/hr-process`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; hr_submission_url?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to generate the secure HR link.'); onApplicationUpdated(payload.data.application); setLink(payload.data.hr_submission_url ?? ''); notify('Secure HR submission link created.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to generate the secure HR link.'); } finally { setBusy(''); } }
  async function review(action: 'save' | 'approve' | 'reject' | 'request_correction') { setBusy(action); setError(''); try { const response = await fetch(`${API_BASE}/admin/applications/${application.id}/hr-process`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, manager_remarks: remarks }) }); const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; hr_submission_url?: string }; error?: { message?: string } } | null; if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to save HR review.'); onApplicationUpdated(payload.data.application); setLink(payload.data.hr_submission_url ?? link); notify(action === 'approve' ? 'HR employee onboarding approved and published to the applicant portal.' : action === 'request_correction' ? 'HR was asked to correct the employee submission.' : 'HR review saved.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save HR review.'); } finally { setBusy(''); } }
  if (application.franchise_model !== 'FOCO') return null;
  if (!unlocked) return <section className="application-review-section workflow-module locked"><div className="application-review-section-head"><div><h3>HR Process</h3><p>FOCO HR onboarding unlocks after Territory Allotment and verified Phase 2 payment.</p></div><span>Phase 2 required</span></div></section>;
  return <section className="application-review-section workflow-module hr-module"><div className="application-review-section-head"><div><h3>HR Process</h3><p>Generate a secure HR link for up to two employee assignments and review the submitted Offer Letters.</p></div><span>{hr ? hr.status.replaceAll('_', ' ') : 'Ready to assign'}</span></div>{!hr ? <button type="button" disabled={busy === 'assign'} onClick={() => void assign()}>{busy === 'assign' ? 'Generating...' : 'Generate secure HR submission link'}</button> : <>{hr.status !== 'approved' && link ? <div className="workflow-assignment"><label className="secure-link-field">HR submission link<input readOnly value={link} /></label><button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(link).then(() => notify('Secure HR link copied.')).catch(() => setError('Copy the secure link manually.'))}>Copy link</button></div> : null}{hr.employees?.length ? <div className="hr-employee-cards">{hr.employees.map((employee) => <article key={employee.id}><b>{employee.name}</b><span>{employee.designation} · {employee.phone}</span><small>Joining {employee.joining_date}</small>{employee.details ? <p>{employee.details}</p> : null}{employee.offer_letter ? <a href={resolveUploadUrl(employee.offer_letter.url)} target="_blank" rel="noreferrer">View Offer Letter</a> : null}</article>)}</div> : <p className="workflow-awaiting">Awaiting HR’s employee assignments and Offer Letters.</p>}{['submitted', 'revision_requested', 'rejected'].includes(hr.status) ? <><label className="workflow-wide">Manager remarks<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Approval note or correction instructions" /></label><div className="workflow-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void review('save')}>Save review</button><button type="button" className="warning" disabled={Boolean(busy)} onClick={() => void review('request_correction')}>Request correction</button><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void review('reject')}>Reject</button><button type="button" disabled={Boolean(busy)} onClick={() => void review('approve')}>{busy === 'approve' ? 'Approving...' : 'Approve HR onboarding'}</button></div></> : hr.status === 'approved' ? <p className="workflow-final">Approved employee records and Offer Letters are now visible to the applicant.</p> : null}</>}{error ? <p className="application-review-error">{error}</p> : null}</section>;
}

function FocoPhaseTwoUnlock({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const phaseOnePaid = application.payments.some((payment) => payment.key === 'application_fee' && payment.status === 'paid');
  const phaseTwo = application.payments.find((payment) => payment.key === 'franchise_fee');
  const territoryIssued = Boolean(application.territory_allotment?.letter_number);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (application.franchise_model !== 'FOCO' || !phaseTwo) return null;

  async function unlock() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/payments/franchise_fee/unlock`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to unlock the FOCO Phase 2 payment.');
      onApplicationUpdated(payload.data);
      notify('FOCO Phase 2 payment released. The applicant must accept the current Phase 2 terms before payment.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to unlock the FOCO Phase 2 payment.'); }
    finally { setBusy(false); }
  }

  if (phaseTwo.status === 'paid') return <div className="phase-two-unlock released"><div><b>FOCO Phase 2 payment received</b><span>The franchise fee has been paid and the Phase 2 consent is retained in the application audit trail.</span></div><span className="phase-two-status">Paid</span></div>;
  if (phaseTwo.status === 'due') return <div className="phase-two-unlock released"><div><b>FOCO Phase 2 payment released</b><span>The applicant can now read and accept the latest Phase 2 payment terms before paying the franchise fee.</span></div><span className="phase-two-status">Awaiting applicant</span></div>;

  return <div className="phase-two-unlock"><div><b>Release FOCO Phase 2 payment</b><span>{!phaseOnePaid ? 'Phase 1 payment must be received first.' : !territoryIssued ? 'Issue the Territory Allotment Letter before releasing this payment.' : 'The Territory Allotment Letter is issued. Release the franchise fee only when management is ready for the applicant to proceed.'}</span></div><button type="button" disabled={busy || !phaseOnePaid || !territoryIssued} onClick={() => void unlock()}>{busy ? 'Unlocking...' : 'Unlock Phase 2 payment'}</button>{error ? <p className="application-review-error">{error}</p> : null}</div>;
}

function FocoSecurityDepositUnlock({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const phaseTwoPaid = application.payments.some((payment) => payment.key === 'franchise_fee' && payment.status === 'paid');
  const brandingApproved = application.branding_signage?.status === 'approved';
  const hrApproved = application.hr_process?.status === 'approved';
  const phaseThree = application.payments.find((payment) => payment.key === 'security_deposit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (application.franchise_model !== 'FOCO' || !phaseThree) return null;

  async function unlock() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/payments/security_deposit/unlock`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to unlock the FOCO Phase 3 payment.');
      onApplicationUpdated(payload.data);
      notify('FOCO Phase 3 security deposit released. The applicant must accept the published Phase 3 terms before payment.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to unlock the FOCO Phase 3 payment.'); }
    finally { setBusy(false); }
  }

  if (phaseThree.status === 'paid') return <div className="phase-two-unlock released"><div><b>FOCO Phase 3 payment received</b><span>The security deposit has been paid and the final onboarding record is retained in the audit trail.</span></div><span className="phase-two-status">Paid</span></div>;
  if (phaseThree.status === 'due') return <div className="phase-two-unlock released"><div><b>FOCO Phase 3 payment released</b><span>The applicant can now read and accept the latest Phase 3 security deposit terms before paying.</span></div><span className="phase-two-status">Awaiting applicant</span></div>;

  return <div className="phase-two-unlock"><div><b>Unlock Third Payment Phase (Security Deposit)</b><span>{!phaseTwoPaid ? 'Phase 2 payment must be received first.' : !brandingApproved ? 'Branding Signage must be approved before releasing this payment.' : !hrApproved ? 'HR Process must be approved before releasing this payment.' : 'Branding and HR are approved. Release the security deposit only when management is ready for the applicant to proceed.'}</span></div><button type="button" disabled={busy || !phaseTwoPaid || !brandingApproved || !hrApproved} onClick={() => void unlock()}>{busy ? 'Unlocking...' : 'Unlock Phase 3 payment'}</button>{error ? <p className="application-review-error">{error}</p> : null}</div>;
}

function TrainingReviewSection({ application, token, agreementExecuted, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; agreementExecuted: boolean; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const training = application.training;
  const defaultBusinessName = training?.business_name || application.branding_signage?.vendor?.shop_name || '';
  const franchiseAddress = training?.franchise_address || [application.territory_allotment?.franchise_address, application.address, application.city, application.district, application.pincode].filter(Boolean).join(', ');
  const [businessName, setBusinessName] = useState(defaultBusinessName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setBusinessName(training?.business_name || application.branding_signage?.vendor?.shop_name || '');
  }, [application.branding_signage?.vendor?.shop_name, training?.business_name]);

  if (!agreementExecuted) return null;

  async function unlockTraining() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/training/unlock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_name: businessName }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to unlock applicant training.');
      onApplicationUpdated(payload.data);
      notify('Mandatory franchise training unlocked for the applicant portal.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to unlock applicant training.');
    } finally {
      setBusy(false);
    }
  }

  async function issueCertificate() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/training/certificate/issue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_name: businessName }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to issue the training completion certificate.');
      onApplicationUpdated(payload.data);
      notify('Training completion certificate issued and stored in the franchise record.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to issue the training completion certificate.');
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCertificate() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/training/certificate/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to regenerate the training completion certificate.');
      onApplicationUpdated(payload.data);
      notify('Training completion certificate PDF regenerated with the latest layout.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to regenerate the training completion certificate.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadCertificate() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/training/certificate`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('The training completion certificate is not available yet.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = training?.certificate?.pdf?.name || `Training-Certificate-${application.application_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to download the training certificate.');
    } finally {
      setBusy(false);
    }
  }

  const progress = training?.progress ?? { total: 0, completed: 0, percent: 0 };
  const certificate = training?.certificate ?? null;

  return <section className="application-review-section training-review-section"><div className="application-review-section-head"><div><h3>Franchise training</h3><p>After the final agreement is executed, enter the business name, unlock training for the applicant, then issue the completion certificate once every module is finished.</p></div><span>{training?.unlocked ? `${progress.completed}/${progress.total} complete` : 'Locked'}</span></div>
    {!training?.unlocked ? <div className="training-unlock-panel"><div className="training-unlock-copy"><b>Unlock training for applicant portal</b><span>{training?.can_unlock ? 'Confirm the franchise business name and address below, then unlock the sequential training modules for this applicant.' : 'Training unlocks only after the final agreement is executed and delivered.'}</span><label className="training-unlock-field">Business name<input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Enter the franchise business name for the certificate" disabled={!training?.can_unlock || busy} /></label><label className="training-unlock-field">Franchise address<textarea readOnly value={franchiseAddress || 'Franchise address will be fetched from the Territory Allotment Letter.'} /></label></div><button type="button" className="training-unlock-button" disabled={busy || !training?.can_unlock || !businessName.trim() || !franchiseAddress.trim()} onClick={() => void unlockTraining()}>{busy ? 'Unlocking…' : 'Unlock Training'}</button></div> : <>
      <div className="training-progress-summary"><div><span>Overall progress</span><b>{progress.percent}%</b></div><div className="training-progress-bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress.percent}%` }} /></div><small>{training.unlocked_at ? `Unlocked ${displayDate(training.unlocked_at)} by ${training.unlocked_by || 'RFMS Officer'}` : 'Training unlocked for applicant portal.'}{training.business_name ? ` · ${training.business_name}` : ''}</small></div>
      <div className="training-review-list">{training.videos.map((video) => <article key={video.id} className={video.completed ? 'completed' : video.accessible ? 'active' : 'locked'}><div><span>Module {video.sequence}</span><b>{video.title}</b><small>{video.completed ? `Finished ${video.completed_at ? displayDate(video.completed_at) : ''}` : video.accessible ? 'Available to applicant' : video.locked_reason || 'Locked'}</small></div><span>{video.completed ? 'Finished' : video.accessible ? 'In progress' : 'Locked'}</span></article>)}</div>
      {certificate?.pdf?.url ? <div className="training-certificate-panel"><div><b>Training completion certificate issued</b><span>{certificate.certificate_number} · {displayDate(certificate.issued_at)} · {certificate.business_name}</span><small>{certificate.franchise_address}</small><a href={certificate.verification_url} target="_blank" rel="noreferrer">Open verification page</a></div><div className="training-certificate-actions"><button type="button" disabled={busy} onClick={() => void downloadCertificate()}>{busy ? 'Preparing…' : 'Download certificate'}</button>{training?.can_regenerate_certificate ? <button type="button" disabled={busy} onClick={() => void regenerateCertificate()}>{busy ? 'Updating…' : 'Regenerate PDF'}</button> : null}</div></div> : training?.can_issue_certificate ? <div className="training-issue-panel"><div className="training-unlock-copy"><b>Issue training completion certificate</b><span>The applicant has finished every assigned module. Confirm the business name and issued franchise address before generating the certificate.</span><label className="training-unlock-field">Business name<input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Franchise business name for the certificate" disabled={busy} /></label><label className="training-unlock-field">Franchise address<textarea readOnly value={training.franchise_address || franchiseAddress} /></label></div><button type="button" className="training-unlock-button" disabled={busy || !businessName.trim()} onClick={() => void issueCertificate()}>{busy ? 'Issuing…' : 'Issue certificate'}</button></div> : progress.total > 0 && progress.completed === progress.total ? <p className="training-awaiting-certificate">All assigned videos are finished. Confirm the business name above and issue the completion certificate when ready.</p> : null}
    </>}
    {error ? <p className="application-review-error">{error}</p> : null}
  </section>;
}

function OnboardingCertificateReviewSection({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const trainingCertificate = application.training?.certificate ?? null;
  const onboarding = application.onboarding_certificate;
  const certificate = onboarding?.certificate ?? null;
  const defaultBusinessName = certificate?.business_name || trainingCertificate?.business_name || application.training?.business_name || application.branding_signage?.vendor?.shop_name || '';
  const [businessName, setBusinessName] = useState(defaultBusinessName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setBusinessName(certificate?.business_name || trainingCertificate?.business_name || application.training?.business_name || application.branding_signage?.vendor?.shop_name || '');
  }, [application.branding_signage?.vendor?.shop_name, application.training?.business_name, certificate?.business_name, trainingCertificate?.business_name]);

  if (!trainingCertificate?.pdf?.url) return null;

  async function generateCertificate() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/onboarding-certificate/issue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_name: businessName }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to generate the onboarding welcome certificate.');
      onApplicationUpdated(payload.data);
      notify('Onboarding welcome certificate generated and linked to the franchise application.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to generate the onboarding welcome certificate.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadCertificate() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/onboarding-certificate`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('The onboarding welcome certificate is not available yet.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = certificate?.pdf?.name || `Onboarding-Certificate-${application.application_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to download the onboarding certificate.');
    } finally {
      setBusy(false);
    }
  }

  async function markOnboarded() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/onboard`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: ApplicationRecord; franchise_webpage?: { public_url?: string } | null }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Unable to mark this application onboarded.');
      onApplicationUpdated(payload.data.application);
      notify(application.franchise_model === 'FOCO'
        ? `Application marked onboarded. FOCO franchise webpage${payload.data.franchise_webpage?.public_url ? ` published at ${payload.data.franchise_webpage.public_url}` : ' generated'}.`
        : 'Application marked onboarded and franchise onboarding completed.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to mark this application onboarded.');
    } finally {
      setBusy(false);
    }
  }

  const isOnboarded = onboarding?.is_onboarded || application.stage === 'onboarding_completed';
  const franchiseWebpage = application.franchise_webpage ?? null;

  return <section className="application-review-section onboarding-certificate-review-section"><div className="application-review-section-head"><div><h3>Onboarding welcome certificate</h3><p>After the training completion certificate is issued, enter the franchise business name and generate the welcome certificate for the applicant dashboard.</p></div><span>{isOnboarded ? 'Onboarded' : certificate?.pdf?.url ? 'Issued' : 'Ready'}</span></div>
    {certificate?.pdf?.url ? <div className="onboarding-certificate-panel"><div><b>Onboarding welcome certificate issued</b><span>{certificate.certificate_number} · {displayDate(certificate.issued_at)} · {certificate.business_name}</span><small>{certificate.franchise_model_label} partner · {application.full_name}</small><a href={certificate.verification_url} target="_blank" rel="noreferrer">Open verification page</a></div><button type="button" disabled={busy} onClick={() => void downloadCertificate()}>{busy ? 'Preparing…' : 'Download certificate'}</button></div> : onboarding?.can_issue ? <div className="onboarding-certificate-issue-panel"><div className="training-unlock-copy"><b>Generate onboarding certificate</b><span>Confirm the franchise business name below. The franchise model ({application.franchise_model}) is added automatically to the certificate.</span><label className="training-unlock-field">Business name<input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Enter the franchise business name for the welcome certificate" disabled={busy} /></label></div><button type="button" className="onboarding-certificate-generate-button" disabled={busy || !businessName.trim()} onClick={() => void generateCertificate()}>{busy ? 'Generating…' : 'Generate Onboarding Certificate'}</button></div> : null}
    {certificate?.pdf?.url && onboarding?.can_mark_onboarded ? <div className="onboarding-complete-panel"><div><b>Complete franchise onboarding</b><span>{application.franchise_model === 'FOCO' ? 'Mark this application onboarded and automatically generate the dedicated FOCO franchise portfolio webpage.' : 'Mark this application onboarded and complete the franchise onboarding workflow.'}</span></div><button type="button" className="onboarding-complete-button" disabled={busy} onClick={() => void markOnboarded()}>{busy ? 'Completing…' : 'Onboarded'}</button></div> : null}
    {isOnboarded ? <div className="onboarding-complete-status"><b>Franchise onboarding completed</b>{application.franchisee_id ? <span>Franchisee ID <b>{application.franchisee_id}</b>{application.franchisee_id_issued_at ? ` · issued ${displayDate(application.franchisee_id_issued_at)}` : ''}</span> : null}<span>{application.franchise_model === 'FOCO' && franchiseWebpage?.public_url ? <>Portfolio webpage: <a href={franchiseWebpage.public_url} target="_blank" rel="noreferrer">{franchiseWebpage.public_url}</a></> : application.franchise_model === 'FOCO' ? 'FOCO franchise webpage generated.' : 'This FOFO franchise application is now marked onboarded.'}</span></div> : null}
    {error ? <p className="application-review-error">{error}</p> : null}
  </section>;
}

function ApplicationContactEditor({ application, token, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const [email, setEmail] = useState(application.email);
  const [mobile, setMobile] = useState(application.mobile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEmail(application.email);
    setMobile(application.mobile);
  }, [application.email, application.mobile]);

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/contact-details`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, mobile }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to update applicant contact details.');
      onApplicationUpdated(payload.data);
      notify('Applicant contact details updated and synced to the applicant profile.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update applicant contact details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="application-review-section application-contact-editor">
      <div className="application-review-section-head">
        <div>
          <h3>Registered contact details</h3>
          <p>Applicants cannot change email or mobile directly. Updates here sync immediately to the applicant profile and are recorded in the audit log.</p>
        </div>
      </div>
      <form className="application-contact-form" onSubmit={(event) => void saveContact(event)}>
        <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Mobile number<input required inputMode="tel" value={mobile} onChange={(event) => setMobile(event.target.value)} /></label>
        {error ? <p className="application-review-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? 'Saving contact details...' : 'Save contact details'}</button>
      </form>
    </section>
  );
}

function ApplicationReviewModal({ application, token, busyId, error, onClose, onDocumentVerification, onAssignVideoKyc, onAdvance, onProceedAgreement, onApplicationUpdated, notify }: { application: ApplicationRecord; token: string; busyId: string; error: string; onClose: () => void; onDocumentVerification: (kind: string, verified: boolean) => void; onAssignVideoKyc: () => void; onAdvance: (notes: string) => void; onProceedAgreement: (notes: string) => void; onApplicationUpdated: (application: ApplicationRecord) => void; notify: (message: string) => void }) {
  const [notes, setNotes] = useState(application.review_notes ?? '');
  const action = nextApplicationAction(application);
  const proceedEligible = canProceedToFinalAgreement(application);
  const showProceed = showProceedForFinalAgreement(application);
  const agreementActive = agreementInProcess(application);
  const agreementExecuted = application.agreement_workflow?.status === 'executed';
  const uploadedCount = requiredApplicationDocuments.filter((document) => Boolean(application.documents?.[document.key]?.url)).length;
  const verifiedCount = requiredApplicationDocuments.filter((document) => application.document_verifications?.[document.key]?.status === 'verified').length;
  const allDocumentsVerified = uploadedCount === requiredApplicationDocuments.length && verifiedCount === requiredApplicationDocuments.length;
  const history = [...(application.review_history ?? [])].reverse().slice(0, 6);
  const territory = application.territory_label || application.territory_pincode || 'Not assigned yet';
  const videoKycSessions = [...(application.video_kyc_sessions ?? [])].sort((first, second) => second.attempt - first.attempt);
  const activeVideoKyc = videoKycSessions.find((session) => ['assigned', 'in_progress'].includes(session.status));
  const completedVideoKyc = videoKycSessions.find((session) => session.status === 'completed');
  const canAssignVideoKyc = allDocumentsVerified && videoKycSessions.length === 0;

  return <div className="application-review-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="application-review-modal" role="dialog" aria-modal="true" aria-labelledby="application-review-heading" onMouseDown={(event) => event.stopPropagation()}>
      <header className="application-review-head"><div><p>Manual application review</p><h2 id="application-review-heading">{application.full_name}</h2><span className="application-review-head-meta">{application.application_number}{application.franchisee_id ? ` · ${application.franchisee_id}` : ''} · {application.franchise_model} · received {displayDate(application.created_at)}</span></div><button type="button" onClick={onClose} aria-label="Close application review">Close</button></header>

      <section className="application-review-state"><div><span>Review progress</span><b>{verifiedCount}/4 documents verified</b></div><span className={allDocumentsVerified ? 'application-review-ready' : 'application-review-pending'}>{allDocumentsVerified ? 'Ready for manager decision' : `${4 - verifiedCount} document${4 - verifiedCount === 1 ? '' : 's'} still need verification`}</span></section>

      <section className="application-review-section"><div className="application-review-section-head"><div><h3>Applicant and franchise request</h3><p>Check the submitted details against the supporting KYC files.</p></div><span>{application.terms_accepted ? 'Terms accepted' : 'Terms not recorded'}</span></div><div className="application-details-grid"><div><small>Date of birth</small><b>{application.date_of_birth || '—'}</b></div><div><small>Applicant user ID</small><b>{application.user_id || '—'}</b></div><div><small>PAN number</small><b>{application.pan_number || '—'}</b></div><div><small>Aadhaar number</small><b>{application.aadhaar_number || '—'}</b></div><div><small>Franchise model</small><b>{application.franchise_model}</b></div><div><small>Preferred location</small><b>{application.preferred_location}</b></div><div><small>PIN code</small><b>{application.pincode || '—'}</b></div><div><small>Assigned territory</small><b>{territory}</b></div><div className="application-detail-full"><small>Residential address</small><b>{[application.address, application.city, application.district, application.pincode].filter(Boolean).join(', ') || '—'}</b></div><div className="application-detail-full"><small>Business experience</small><b>{application.business_experience || 'Not provided'}</b></div></div></section>

      <ApplicationContactEditor application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} />

      <section className="application-review-section"><div className="application-review-section-head"><div><h3>KYC document verification</h3><p>Open each file, then choose <b>Upload again</b> for a correction or <b>Verified</b> when it is accepted. Both choices are available until the manager saves a decision.</p></div><span>{uploadedCount}/4 uploaded</span></div><div className="application-document-grid">{requiredApplicationDocuments.map((document) => { const file = application.documents?.[document.key]; const verification = application.document_verifications?.[document.key]; const verified = verification?.status === 'verified'; const uploadAgainRequested = verification?.status === 'upload_requested'; const reviewDecisionSaved = verified || uploadAgainRequested; const documentBusy = busyId === `document:${application.id}:${document.key}`; return <article key={document.key} className={verified ? 'application-document verified' : uploadAgainRequested ? 'application-document upload-requested' : 'application-document'}><div><span>{document.shortLabel}</span><h4>{document.label}</h4><p>{file?.name || 'Not uploaded'}</p>{verified ? <small>Verified by {verification?.verified_by || 'RFMS Officer'}{verification?.verified_at ? ` · ${displayDate(verification.verified_at)}` : ''}</small> : uploadAgainRequested ? <small>Upload again requested. The applicant has been notified.</small> : <small>Ready for manager review.</small>}</div><div className="application-document-actions">{file?.url ? <a href={resolveUploadUrl(file.url)} target="_blank" rel="noreferrer">View file</a> : <span className="application-document-missing">Missing</span>}<div className="application-document-review-actions"><button className={`document-upload-again${uploadAgainRequested ? ' selected' : ''}`} type="button" disabled={!file?.url || documentBusy || reviewDecisionSaved} onClick={() => onDocumentVerification(document.key, false)}>{documentBusy ? 'Saving…' : 'Upload again'}</button><button className={`document-verified${verified ? ' selected' : ''}`} type="button" disabled={!file?.url || documentBusy || reviewDecisionSaved} onClick={() => onDocumentVerification(document.key, true)}>{documentBusy ? 'Saving…' : 'Verified'}</button></div></div></article>; })}</div></section>

      <section className="application-review-section video-kyc-review"><div className="application-review-section-head"><div><h3>Video KYC</h3><p>After all four documents are verified, assign the applicant to the secure Video KYC queue. Reassignment creates the next attempt automatically; a completed verification is permanently locked.</p></div><span>{videoKycSessions.length ? `${videoKycSessions.length} attempt${videoKycSessions.length === 1 ? '' : 's'}` : 'Not assigned'}</span></div>{allDocumentsVerified ? <div className="video-kyc-assignment"><div><b>{activeVideoKyc ? `Attempt ${activeVideoKyc.attempt} is ${applicationStage(activeVideoKyc.status)}` : completedVideoKyc ? `Video KYC completed in attempt ${completedVideoKyc.attempt}` : videoKycSessions.length ? 'Video KYC reassignment history retained' : 'Documents verified — ready to assign Video KYC'}</b><small>{activeVideoKyc ? `Assigned ${displayDate(activeVideoKyc.assigned_at)} by ${activeVideoKyc.assigned_by || 'RFMS Officer'}. The applicant can see this request in their portal.` : completedVideoKyc ? 'Verification is complete. No additional assignment or reassignment can be created for this application.' : videoKycSessions.length ? 'The next attempt is created only when a manager selects Reassign on the active Video KYC session.' : 'Assigning creates a synchronized request in the applicant portal and the manager Video KYC queue.'}</small></div>{canAssignVideoKyc ? <button type="button" className="application-review-video-kyc" disabled={busyId === `video-kyc:${application.id}`} onClick={onAssignVideoKyc}>{busyId === `video-kyc:${application.id}` ? 'Assigning…' : 'Assign Video KYC'}</button> : <span className={`video-kyc-status ${completedVideoKyc ? 'completed' : activeVideoKyc?.status || 'reassigned'}`}>{completedVideoKyc ? 'Verification complete' : activeVideoKyc ? 'Request active' : 'Reassignment only'}</span>}</div> : <p className="video-kyc-waiting">Verify all four KYC documents to unlock Video KYC assignment.</p>}{videoKycSessions.length ? <div className="video-kyc-history-list">{videoKycSessions.map((session) => <article key={session.id}><div><b>Attempt {session.attempt} · {applicationStage(session.status)}</b><small>{session.started_at ? `Started ${displayDate(session.started_at)}` : `Assigned ${displayDate(session.assigned_at)}`} · {session.screenshots.length} screenshot{session.screenshots.length === 1 ? '' : 's'}</small>{session.remarks ? <p>{session.remarks}</p> : null}</div><div className="video-kyc-evidence-links">{session.screenshots.map((shot, index) => <a key={shot.id} href={shot.url} target="_blank" rel="noreferrer">Evidence {index + 1}</a>)}</div></article>)}</div> : null}</section>

      <FieldVisitReviewSection application={application} token={token} eligible={Boolean(completedVideoKyc)} onApplicationUpdated={onApplicationUpdated} notify={notify} />
      <OnboardingDocumentsReviewSection application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} />
      <EnhancedTerritoryAllotmentSection application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} />
      <BrandingSignageReviewSection application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} />
      <HrProcessReviewSection application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} />
      {agreementExecuted ? <section className="application-review-section agreement-process-banner executed"><div><b>Agreement executed</b><span>Download the executed agreement from Agreement Queue. After onboarding, the complete franchise record is available in Franchisee Directory.</span></div>{application.agreement_workflow?.executed?.agreement_url ? <a href={resolveUploadUrl(application.agreement_workflow.executed.agreement_url)} target="_blank" rel="noreferrer">Download executed agreement</a> : null}</section> : null}
      <TrainingReviewSection application={application} token={token} agreementExecuted={agreementExecuted} onApplicationUpdated={onApplicationUpdated} notify={notify} />
      <OnboardingCertificateReviewSection application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} />
      <section className="application-review-section application-payment-review"><div className="application-review-section-head"><div><h3>Payment and workflow</h3><p>Payment release is controlled by the manager. FOCO Phase 2 requires a Territory Allotment Letter, manager unlock and separate applicant acceptance of the current Phase 2 terms. FOCO Phase 3 unlocks only after Branding Signage and HR Process are approved.</p></div><span>{applicationStage(application.stage)}</span></div><div className="application-payment-list">{application.payments.map((payment) => <article key={payment.key}><div><b>{payment.label}</b><small>{payment.purpose}</small></div><div><b>₹{payment.amount.toLocaleString('en-IN')}</b><small className={`application-payment-status ${payment.status}`}>{applicationStage(payment.status)}</small></div></article>)}</div><FocoPhaseTwoUnlock application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} /><FocoSecurityDepositUnlock application={application} token={token} onApplicationUpdated={onApplicationUpdated} notify={notify} /></section>

      <section className="application-review-section"><label className="application-review-notes">Manager review note <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record any document check, clarification or approval note for the applicant file." /></label><div className="application-review-history"><div><h3>Review history</h3><span>{history.length} recorded action{history.length === 1 ? '' : 's'}</span></div>{history.length ? history.map((entry) => <article key={entry.id}><b>{reviewActivityLabel(entry.type)}</b><p>{entry.message}</p><small>{entry.actor} · {displayDate(entry.created_at)}</small></article>) : <p>No manager review actions have been recorded yet.</p>}</div></section>

      {error ? <p className="application-review-error" role="alert">{error}</p> : null}
      {agreementActive && correctionWorkflowActive(application.agreement_workflow) ? <section className="application-review-section"><AgreementChangeRequestBox token={token} applicationId={application.id} workflow={application.agreement_workflow} onApplicationUpdated={(record) => onApplicationUpdated(record as ApplicationRecord)} notify={notify} displayDate={displayDate} /></section> : null}
      {agreementActive && !application.agreement_workflow?.applicant?.correction_request?.trim() ? <section className="application-review-section agreement-process-banner"><div><b>Agreement in process</b><span>{`${application.agreement_workflow?.status_label ?? 'Agreement process started'}. Open Manager → Agreements to continue e-Stamp, generation and signing.`}</span></div></section> : null}
      <footer className="application-review-footer">
        {showProceed ? <><div><b>Final agreement</b><span>{proceedEligible ? (application.franchise_model === 'FOCO' ? 'FOCO Phase 3 security deposit is verified. Proceed to start the Agreement Module.' : 'FOFO branding signage is approved. Proceed to start the Agreement Module.') : application.franchise_model === 'FOCO' ? 'Proceed for Final Agreement unlocks after Phase 3 security deposit payment is verified.' : 'Proceed for Final Agreement unlocks after the FOFO franchise fee is verified.'}</span></div><button className="application-review-advance" type="button" disabled={!proceedEligible || busyId === `agreement-proceed:${application.id}`} onClick={() => onProceedAgreement(notes)}>{busyId === `agreement-proceed:${application.id}` ? 'Proceeding…' : 'Proceed for Final Agreement'}</button></> : agreementActive ? <div><b>Agreement module</b><span>Agreement in process — open Manager → Agreement Queue to continue e-Stamp, generation and signing.</span></div> : action ? <><div><b>Next phase</b><span>{action}</span></div><button className="application-review-advance" type="button" disabled={!allDocumentsVerified || busyId === `advance:${application.id}`} onClick={() => onAdvance(notes)}>{busyId === `advance:${application.id}` ? 'Proceeding…' : action}</button></> : <div><b>Current workflow</b><span>No additional manager action is due at this stage.</span></div>}
      </footer>
    </section>
  </div>;
}

function VideoKycDashboard({ token, search, notify }: { token: string; search: string; notify: (message: string) => void }) {
  const [sessions, setSessions] = useState<VideoKycSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const visibleSessions = useMemo(() => sessions.filter((session) => `${session.applicant_name} ${session.application_number} ${session.preferred_location} ${session.status}`.toLowerCase().includes(search.toLowerCase())), [sessions, search]);
  const selected = sessions.find((session) => session.id === selectedId) ?? null;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/video-kyc`, { headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: VideoKycSession[]; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to load the Video KYC queue.');
      setSessions(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load the Video KYC queue.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load, reload]);

  const activeCount = sessions.filter((session) => session.status === 'in_progress').length;
  const awaitingCount = sessions.filter((session) => session.status === 'assigned').length;
  const completedCount = sessions.filter((session) => session.status === 'completed').length;
  return <section className="video-kyc-dashboard">
    <div className="title-row"><div><h1>Video KYC dashboard</h1><p>Authenticated identity-verification sessions, evidence capture and auditable outcomes.</p></div><button className="date" type="button" onClick={() => setReload((value) => value + 1)}>Refresh queue</button></div>
    <div className="module-summary"><section><span>Awaiting manager</span><b>{awaitingCount}</b><small>Assigned applicants ready to be called</small></section><section><span>Live sessions</span><b>{activeCount}</b><small>Video KYC currently in progress</small></section><section><span>Completed history</span><b>{completedCount}</b><small>Immutable review evidence retained</small></section></div>
    <section className="panel data-panel video-kyc-queue"><Header title="Pending Video KYC queue" text={loading ? 'Loading secure Video KYC requests…' : `${visibleSessions.filter((session) => ['assigned', 'in_progress'].includes(session.status)).length} active request${visibleSessions.filter((session) => ['assigned', 'in_progress'].includes(session.status)).length === 1 ? '' : 's'}`} action="Refresh" onClick={() => setReload((value) => value + 1)} /><div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Application</th><th>Attempt</th><th>Assigned</th><th>Applicant status</th><th>Evidence</th><th /></tr></thead><tbody>{error ? <tr><td colSpan={7} className="empty">{error}</td></tr> : visibleSessions.filter((session) => ['assigned', 'in_progress'].includes(session.status)).map((session) => <tr key={session.id}><td><b>{session.applicant_name}</b><br /><small>{session.applicant_email}<br />{session.applicant_mobile}</small></td><td><b>{session.application_number}</b><br /><small>{session.franchise_model} · {session.preferred_location}</small></td><td>Attempt {session.attempt}</td><td>{displayDate(session.assigned_at)}<br /><small>{session.assigned_by}</small></td><td><span className={`video-kyc-status ${session.status}`}>{session.status === 'in_progress' ? session.applicant_joined_at ? 'Applicant joined' : 'Waiting for applicant' : 'Assigned'}</span></td><td>{session.screenshots.length} screenshot{session.screenshots.length === 1 ? '' : 's'}</td><td><button className="row-action" type="button" onClick={() => setSelectedId(session.id)}>{session.status === 'assigned' ? 'Start Video KYC' : 'Open live session'}</button></td></tr>)}{!loading && !error && !visibleSessions.some((session) => ['assigned', 'in_progress'].includes(session.status)) ? <tr><td colSpan={7} className="empty">No active Video KYC requests. Assign Video KYC after all applicant KYC documents are verified.</td></tr> : null}</tbody></table></div></section>
    <section className="panel data-panel video-kyc-history"><Header title="Completed and reassigned attempts" text="A preserved audit trail for every completed or reassigned verification." action="Refresh" onClick={() => setReload((value) => value + 1)} /><div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Attempt</th><th>Outcome</th><th>Completed</th><th>Evidence</th><th>Remarks</th></tr></thead><tbody>{visibleSessions.filter((session) => ['completed', 'reassigned'].includes(session.status)).map((session) => <tr key={session.id}><td><b>{session.applicant_name}</b><br /><small>{session.application_number}</small></td><td>Attempt {session.attempt}</td><td><span className={`video-kyc-status ${session.status}`}>{applicationStage(session.status)}</span></td><td>{session.completed_at ? displayDate(session.completed_at) : '—'}<br /><small>{session.completed_by || '—'}</small></td><td>{session.screenshots.length ? <div className="video-kyc-evidence-links"><b>{session.screenshots.length} screenshot{session.screenshots.length === 1 ? '' : 's'}</b>{session.screenshots.map((shot, index) => <a key={shot.id} href={shot.url} target="_blank" rel="noreferrer">View {index + 1}</a>)}</div> : 'No evidence'}</td><td>{session.remarks || 'No remarks recorded'}</td></tr>)}{!loading && !error && !visibleSessions.some((session) => ['completed', 'reassigned'].includes(session.status)) ? <tr><td colSpan={6} className="empty">Completed Video KYC records will appear here with their preserved evidence.</td></tr> : null}</tbody></table></div></section>
    {selected ? <VideoKycManagerRoom token={token} session={selected} onClose={() => setSelectedId('')} onChanged={(changed) => { setSessions((items) => { const existing = items.find((item) => item.id === changed.id); return existing ? items.map((item) => item.id === changed.id ? { ...item, ...changed } : item) : [changed, ...items]; }); setReload((value) => value + 1); }} notify={notify} /> : null}
  </section>;
}

function VideoKycManagerRoom({ token, session, onClose, onChanged, notify }: { token: string; session: VideoKycSession; onClose: () => void; onChanged: (session: VideoKycSession) => void; notify: (message: string) => void }) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const processedSignals = useRef(new Set<string>());
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [remarks, setRemarks] = useState(session.remarks || '');
  const [error, setError] = useState('');
  const [currentSession, setCurrentSession] = useState(session);

  const request = useCallback(async (path: string, method = 'POST', body?: unknown) => {
    const response = await fetch(`${API_BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => null) as { success?: boolean; data?: { session?: VideoKycSession; application?: ApplicationRecord }; error?: { message?: string } } | null;
    if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Video KYC request failed.');
    return payload.data;
  }, [token]);

  const sendSignal = useCallback(async (type: 'offer' | 'answer' | 'candidate', signal: object) => {
    await request(`/video-kyc/${currentSession.id}/signals`, 'POST', { type, signal });
  }, [currentSession.id, request]);

  const stopRoom = useCallback(() => {
    peerRef.current?.close(); peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setLive(false);
  }, []);

  const applySignal = useCallback(async (entry: { id: string; type: string; signal: unknown }) => {
    if (processedSignals.current.has(entry.id) || !peerRef.current) return;
    processedSignals.current.add(entry.id);
    const peer = peerRef.current;
    if (entry.type === 'answer') {
      await peer.setRemoteDescription(entry.signal as RTCSessionDescriptionInit);
      for (const candidate of pendingCandidates.current.splice(0)) await peer.addIceCandidate(candidate);
    } else if (entry.type === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(entry.signal as RTCIceCandidateInit); else pendingCandidates.current.push(entry.signal as RTCIceCandidateInit);
    }
  }, []);

  useEffect(() => () => stopRoom(), [stopRoom]);
  useEffect(() => {
    if (!live || currentSession.status !== 'in_progress') return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/video-kyc/${currentSession.id}/signals`, { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => null) as { success?: boolean; data?: { signals?: { id: string; type: string; signal: unknown }[] } } | null;
        if (active && response.ok && payload?.success) for (const signal of payload.data?.signals ?? []) await applySignal(signal);
      } catch { /* The next poll retries while the room is open. */ }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [applySignal, currentSession.id, currentSession.status, live, token]);

  async function startRoom() {
    setBusy(true); setError('');
    try {
      const started = await request(`/admin/video-kyc/${currentSession.id}/start`);
      if (!started?.session) throw new Error('Video KYC session could not be started.');
      const mergedSession = { ...currentSession, ...started.session };
      setCurrentSession(mergedSession); onChanged(mergedSession);
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = media;
      if (localVideoRef.current) localVideoRef.current.srcObject = media;
      const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerRef.current = peer;
      media.getTracks().forEach((track) => peer.addTrack(track, media));
      peer.ontrack = (event) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0]; };
      peer.onicecandidate = (event) => { if (event.candidate) void sendSignal('candidate', event.candidate.toJSON()).catch(() => undefined); };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await sendSignal('offer', offer);
      setLive(true); notify('Video KYC is live. The applicant can now join from their portal.');
    } catch (roomError) {
      stopRoom(); setError(roomError instanceof Error ? roomError.message : 'Unable to start the camera or Video KYC room.');
    } finally { setBusy(false); }
  }

  async function captureEvidence() {
    const source = remoteVideoRef.current?.readyState && remoteVideoRef.current.videoWidth ? remoteVideoRef.current : localVideoRef.current;
    if (!source?.videoWidth || !source.videoHeight) { setError('Wait until a live camera stream is visible before capturing evidence.'); return; }
    setCaptureBusy(true); setError('');
    try {
      const canvas = document.createElement('canvas'); canvas.width = source.videoWidth; canvas.height = source.videoHeight;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser cannot capture this Video KYC image.');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const result = await request(`/admin/video-kyc/${currentSession.id}/screenshots`, 'POST', { name: `Video-KYC-attempt-${currentSession.attempt}-${Date.now()}.jpg`, data_url: canvas.toDataURL('image/jpeg', 0.88) });
      if (result?.session) { const mergedSession = { ...currentSession, ...result.session }; setCurrentSession(mergedSession); onChanged(mergedSession); }
      notify('Timestamped Video KYC evidence screenshot saved.');
    } catch (captureError) { setError(captureError instanceof Error ? captureError.message : 'Unable to save Video KYC evidence.'); }
    finally { setCaptureBusy(false); }
  }

  async function finish(action: 'complete' | 'reassign') {
    setBusy(true); setError('');
    try {
      const result = await request(`/admin/video-kyc/${currentSession.id}/finish`, 'POST', { action, remarks });
      if (!result?.session) throw new Error('Unable to save the Video KYC outcome.');
      onChanged(result.session); stopRoom(); notify(action === 'complete' ? 'Video KYC completed and evidence saved to the application review.' : 'Video KYC reassigned. The previous attempt and evidence remain in history.'); onClose();
    } catch (finishError) { setError(finishError instanceof Error ? finishError.message : 'Unable to save the Video KYC outcome.'); }
    finally { setBusy(false); }
  }

  return <div className="video-kyc-overlay" role="presentation" onMouseDown={onClose}><section className="video-kyc-room" role="dialog" aria-modal="true" aria-labelledby="video-kyc-room-title" onMouseDown={(event) => event.stopPropagation()}><header><div><p>Secure Video KYC workspace</p><h2 id="video-kyc-room-title">{currentSession.applicant_name} · Attempt {currentSession.attempt}</h2><span>{currentSession.application_number} · {currentSession.franchise_model} · {currentSession.preferred_location}</span></div><button type="button" onClick={onClose}>Close</button></header><div className="video-kyc-room-status"><span className={`video-kyc-status ${currentSession.status}`}>{applicationStage(currentSession.status)}</span><b>{currentSession.applicant_joined_at ? 'Applicant camera joined' : live ? 'Waiting for applicant to join' : 'Manager has not started the session'}</b></div><div className="video-kyc-video-grid"><figure><video ref={localVideoRef} autoPlay muted playsInline /><figcaption>Manager camera</figcaption></figure><figure><video ref={remoteVideoRef} autoPlay playsInline /><figcaption>{currentSession.applicant_joined_at ? 'Applicant camera' : 'Applicant camera will appear when they join'}</figcaption></figure></div><div className="video-kyc-room-actions">{!live ? <button className="video-kyc-primary" type="button" disabled={busy} onClick={() => void startRoom()}>{busy ? 'Starting…' : 'Start Video KYC'}</button> : <button className="video-kyc-capture" type="button" disabled={captureBusy} onClick={() => void captureEvidence()}>{captureBusy ? 'Saving evidence…' : 'Capture screenshot evidence'}</button>}<span>{currentSession.screenshots.length} timestamped screenshot{currentSession.screenshots.length === 1 ? '' : 's'} saved</span></div><label className="video-kyc-remarks">Manager remarks<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Record identity checks, applicant response or any reason for reassignment." /></label>{currentSession.screenshots.length ? <div className="video-kyc-shot-list">{currentSession.screenshots.map((shot, index) => <a key={shot.id} href={shot.url} target="_blank" rel="noreferrer">Evidence {index + 1} · {displayDate(shot.captured_at)}</a>)}</div> : null}{error ? <p className="application-review-error" role="alert">{error}</p> : null}<footer><button type="button" className="video-kyc-reassign" disabled={busy} onClick={() => void finish('reassign')}>Reassign Video KYC</button><button type="button" className="video-kyc-primary" disabled={busy || !live} onClick={() => void finish('complete')}>{busy ? 'Saving…' : 'Complete Video KYC'}</button></footer></section></div>;
}

function Module({ page, search, notify }: { page: OperationalPage; search: string; notify: (message: string) => void }) {
  const item = data[page];
  const rows = useMemo(() => item.rows.filter((row) => row.join(' ').toLowerCase().includes(search.toLowerCase())), [item, search]);
  return <>
    <div className="title-row"><div><h1>{item.title}</h1><p>{item.note}</p></div><button className="date" onClick={() => notify(`${item.action} workflow started`)}>Add: {item.action}</button></div>
    <div className="module-summary"><section><span>Open items</span><b>{rows.length + 4}</b><small>Requires team attention</small></section><section><span>Completed this month</span><b>24</b><small>Up 12% from last month</small></section><section><span>Team SLA</span><b>96%</b><small>Within target response time</small></section></div>
    <section className="panel data-panel"><Header title="Work queue" text={`Showing ${rows.length} relevant records`} action="Export" onClick={() => notify(`${page} export prepared`)} /><div className="table-wrap"><table><thead><tr>{item.headers.map((header) => <th key={header}>{header}</th>)}<th /></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <b>{cell}</b> : cell}</td>)}<td><button className="row-action" onClick={() => notify(`${row[0]} opened`)}>Open</button></td></tr>)}{rows.length === 0 ? <tr><td className="empty" colSpan={item.headers.length + 1}>No records match this search.</td></tr> : null}</tbody></table></div></section>
  </>;
}

function Header({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) {
  return <div className="panel-head"><div><h2>{title}</h2><p>{text}</p></div><button onClick={onClick}>{action}</button></div>;
}

function Metric({ label, value, delta, icon }: { label: string; value: string; delta: string; icon: string }) {
  return <section className="metric"><div className="metric-icon">{icon}</div><div><p>{label}</p><h2>{value}</h2><small>Up {delta}</small></div></section>;
}

