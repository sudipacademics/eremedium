'use client';

import { ChangeEvent, FormEvent, MouseEvent, SyntheticEvent, useCallback, useEffect, useRef, useState } from 'react';
import { RFMS_API_BASE, RFMS_MARKETING_ORIGIN, appPath, logoutApplicant as secureLogoutApplicant } from '@rfms/utils';
import './portal.css';
import './responsive.css';
import { ApplicantSupportPanel } from './support-panel';
import { ApplicantNotificationBell, ApplicantProfileMenu } from './notification-bell';

const API_BASE = RFMS_API_BASE;
const API_ORIGIN = new URL(API_BASE).origin;
const STORAGE_KEY = 'rfms_public_application_id';
const AUTH_TOKEN_KEY = 'rfms_applicant_auth_token';
const DEFAULT_COMPANY = {
  company_name: 'Remedium Lab', logo_url: `${RFMS_MARKETING_ORIGIN}/remedium-lab-logo.png`,
  fofo_terms: 'FOFO franchise terms and conditions\n\nTerritory allocation, application approval and launch timelines are subject to Remedium Lab review and the final franchise agreement. The one-time FOFO franchise fee is payable after application processing. Business outcomes are not guaranteed.',
  foco_terms: 'FOCO franchise terms and conditions\n\nThe FOCO payment plan includes the application fee, franchise fee and security deposit at the stages shown in the application. Location allotment, onboarding and final agreement are subject to Remedium Lab review. Business outcomes are not guaranteed.',
  foco_phase_2_terms: 'FOCO Phase 2 payment terms and conditions\n\nThe franchise fee becomes payable only after Remedium Lab issues the Territory Allotment Letter and a manager releases this payment stage. Payment confirms acceptance of the allotted territory and approved onboarding plan. Read and accept these Phase 2 terms before payment.',
  foco_phase_3_terms: 'FOCO Phase 3 security deposit terms and conditions\n\nThe security deposit becomes payable only after Remedium Lab approves Branding Signage and HR Process and a manager releases this payment stage. Payment confirms acceptance of the final onboarding review and the franchise agreement process. Read and accept these Phase 3 terms before payment.',
};
const DOCUMENTS = [
  { key: 'photo', title: 'Applicant photograph', hint: 'PNG, JPG or WEBP image, maximum 5 MB', accept: 'image/png,image/jpeg,image/webp' },
  { key: 'pan', title: 'PAN card', hint: 'PDF, PNG, JPG or WEBP, maximum 5 MB', accept: 'application/pdf,image/png,image/jpeg,image/webp' },
  { key: 'aadhaar', title: 'Aadhaar card', hint: 'PDF, PNG, JPG or WEBP, maximum 5 MB', accept: 'application/pdf,image/png,image/jpeg,image/webp' },
  { key: 'voter', title: 'Voter ID card', hint: 'PDF, PNG, JPG or WEBP, maximum 5 MB', accept: 'application/pdf,image/png,image/jpeg,image/webp' },
] as const;

type DocumentKey = typeof DOCUMENTS[number]['key'];
type UploadedDocument = { kind: DocumentKey; name: string; url: string };
type DocumentVerification = { status?: 'pending' | 'upload_requested' | 'verified'; verified_at?: string; verified_by?: string };
type Payment = { key: string; label: string; amount: number; purpose: string; status: 'locked' | 'due' | 'paid' | 'under_verification'; paid_at?: string; receipt_number?: string; transaction_number?: string; gateway_reference?: string; payment_method?: string; original_amount?: number; discount_amount?: number; coupon_code?: string };
type PaymentMethodKey = 'cheque' | 'gateway' | 'bank_transfer';
type AppliedCoupon = { code: string; original_amount: number; discount_amount: number; final_amount: number; foco_full?: boolean };
type VideoKycEvidence = { id: string; url: string; name: string; captured_at: string; captured_by: string };
type VideoKycActivity = { id: string; type: string; message: string; actor: string; created_at: string };
type VideoKycSession = { id: string; attempt: number; status: 'assigned' | 'in_progress' | 'completed' | 'reassigned'; assigned_at: string; assigned_by: string; started_at: string; started_by: string; applicant_joined_at: string; completed_at: string; completed_by: string; remarks: string; reassigned_from: string; screenshots: VideoKycEvidence[]; history: VideoKycActivity[] };
type OnboardingDocumentFile = { id: string; slot: number; name: string; url: string; status: 'pending' | 'verified' | 'reupload_requested' | 'rejected' | 'superseded'; remarks?: string; submitted_at?: string; reviewed_at?: string; reviewed_by?: string };
type OnboardingDocument = { id: string; title: string; description?: string; required_count: number; requested_at?: string; requested_by?: string; files: OnboardingDocumentFile[] };
type FieldVisitReport = { visit_date?: string; site_address?: string; google_maps_url?: string; inspection_summary?: string; property_condition?: string; documents_observed?: string; recommendation?: string; officer_remarks?: string; site_photos?: { id?: string; url: string; name: string; uploaded_at?: string }[]; submitted_at?: string; submitted_by?: string };
type FieldVisit = { id: string; status: 'assigned' | 'submitted' | 'approved' | 'rejected'; officer_name: string; officer_phone: string; assigned_at?: string; assigned_by?: string; submitted_at?: string; approved_at?: string; approved_by?: string; manager_remarks?: string; report?: FieldVisitReport | null };
type WorkflowUpload = { id?: string; name: string; url: string; uploaded_at?: string };
type BrandingSignage = { status: string; completion_details?: string; photographs?: WorkflowUpload[]; submitted_at?: string; manager_remarks?: string; approved_at?: string; installation_cost?: number; invoice?: WorkflowUpload | null };
type HrEmployee = { id: string; name: string; designation: string; phone: string; joining_date: string; details?: string; offer_letter?: WorkflowUpload | null };
type HrProcess = { status: string; employees?: HrEmployee[]; approved_at?: string; manager_remarks?: string };
type TerritoryAllotment = { id: string; version: number; letter_number: string; territory_id: string; registered_territory_label: string; final_territory: string; radius_km: number; franchise_address: string; district: string; state: string; pincode: string; google_maps_url: string; effective_date: string; issued_at: string; issued_by: string; status: string };
type TrainingVideoSummary = { id: string; title: string; description: string; video_url: string; mime: string; duration_minutes: number; sort_order: number; sequence: number; accessible: boolean; locked_reason: string; completed: boolean; completed_at: string };
type TrainingSummary = { unlocked: boolean; unlocked_at: string; unlocked_by: string; business_name: string; franchise_address: string; completed_at: string; progress: { total: number; completed: number; percent: number }; can_unlock: boolean; can_issue_certificate: boolean; certificate: { certificate_number: string; business_name: string; franchise_address: string; issued_at: string; verification_url: string; qr_reference: string; pdf: { name: string; url: string; mime: string } | null } | null; videos: TrainingVideoSummary[] };
type OnboardingCertificateSummary = { can_issue: boolean; can_download: boolean; can_mark_onboarded: boolean; is_onboarded: boolean; certificate: { certificate_number: string; business_name: string; franchise_model: string; franchise_model_label: string; issued_at: string; verification_url: string; qr_reference: string; pdf: { name: string; url: string; mime: string } | null } | null };
type FranchiseWebpageSummary = { id: string; slug: string; enabled: boolean; public_url: string; settings: { business_name: string; branch_address?: string; hero_subtitle?: string } };
type Application = { id: string; application_number: string; franchisee_id?: string; franchisee_id_issued_at?: string; full_name: string; email: string; mobile: string; user_id?: string; address?: string; city?: string; district?: string; pincode?: string; franchise_model: 'FOFO' | 'FOCO'; preferred_location: string; territory_label?: string; territory_pincode?: string; territory_allotment?: TerritoryAllotment | null; territory_allotments?: TerritoryAllotment[]; stage: string; terms_accepted?: boolean; payment_terms?: Record<string, { terms_text?: string; terms_version?: number; accepted_at?: string; accepted_by?: string }>; documents: Partial<Record<DocumentKey, UploadedDocument>>; document_verifications?: Partial<Record<DocumentKey, DocumentVerification>>; video_kyc_sessions?: VideoKycSession[]; video_kyc_current_session_id?: string; field_visit?: FieldVisit | null; onboarding_documents?: OnboardingDocument[]; branding_signage?: BrandingSignage | null; hr_process?: HrProcess | null; agreement_workflow?: AgreementWorkflow | null; training?: TrainingSummary | null; onboarding_certificate?: OnboardingCertificateSummary | null; franchise_webpage?: FranchiseWebpageSummary | null; support?: { unread_replies: number; open_tickets: number }; payments: Payment[] };
type AgreementWorkflow = { status: string; status_label?: string; reference_number?: string; view_document?: { name: string; url: string; mime?: string } | null; permissions?: { can_view?: boolean; can_download?: boolean; can_accept_esign?: boolean; can_request_corrections?: boolean; view_only?: boolean }; document?: { draft_body?: string; body?: string; sent_to_applicant_at?: string; uploaded_file?: { url: string; name: string } | null; aadhaar_signed_file?: { url: string; name: string } | null; executed_file?: { url: string; name: string } | null } | null; applicant?: { terms_accepted_at?: string; correction_request?: string; correction_requested_at?: string; correction_decision?: string; correction_decision_at?: string; correction_response?: string; esign_completed_at?: string; esign_reference?: string } | null; executed?: { agreement_url?: string; executed_at?: string; qr_reference?: string } | null };
type TerritoryPin = { pincode: string; area: string; subdivision: string; district: string; state: string; fofo: { available: number }; foco: { available: number } };
type Draft = { full_name: string; mobile: string; email: string; date_of_birth: string; pan_number: string; aadhaar_number: string; address: string; city: string; district: string; pincode: string; franchise_model: '' | 'FOFO' | 'FOCO'; preferred_location: string; business_experience: string; user_id: string; account_password: string; account_password_confirmation: string; hec_lead_id?: string; hec_franchisee_profile?: string };
type ContactChannel = 'mobile' | 'email';
type ContactVerification = { mobileToken: string; emailToken: string; termsAccepted?: boolean };
type PortalView = 'application' | 'payment' | 'profile-login' | 'profile';

const EMPTY_DRAFT: Draft = { full_name: '', mobile: '', email: '', date_of_birth: '', pan_number: '', aadhaar_number: '', address: '', city: '', district: '', pincode: '', franchise_model: '', preferred_location: '', business_experience: '', user_id: '', account_password: '', account_password_confirmation: '' };

function money(value: number) { return `₹${value.toLocaleString('en-IN')}`; }
function paymentReceiptUrl(applicationId: string, paymentKey: string) { return `${API_BASE}/applications/public/${encodeURIComponent(applicationId)}/payments/${encodeURIComponent(paymentKey)}/receipt`; }
function paymentStatusCopy(status: Payment['status']) {
  if (status === 'paid') return 'Paid';
  if (status === 'under_verification') return 'Under verification';
  if (status === 'due') return 'Due now';
  return 'Locked';
}
function focoFullPaymentEligible(application: Application) {
  if (application.franchise_model !== 'FOCO') return false;
  const phaseOne = application.payments.find((payment) => payment.key === 'application_fee');
  const phaseTwo = application.payments.find((payment) => payment.key === 'franchise_fee');
  const phaseThree = application.payments.find((payment) => payment.key === 'security_deposit');
  return phaseOne?.status === 'due' && phaseTwo?.status === 'locked' && phaseThree?.status === 'locked';
}
function focoFullPaymentTotal(application: Application) {
  return application.payments
    .filter((payment) => ['application_fee', 'franchise_fee', 'security_deposit'].includes(payment.key))
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
}
const PAYMENT_METHOD_OPTIONS: { key: PaymentMethodKey; label: string; description: string }[] = [
  { key: 'cheque', label: 'Cheque', description: 'Submit cheque details and upload a cheque image for RFMS verification.' },
  { key: 'gateway', label: 'UPI / Credit Card / Debit Card', description: 'Pay instantly through the integrated payment gateway.' },
  { key: 'bank_transfer', label: 'Bank Transfer (NEFT / RTGS / IMPS)', description: 'Submit the UTR and upload the payment receipt for verification.' },
];
function resolveUploadUrl(url?: string | null) {
  const value = (url ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}
function asDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read this file.')); reader.onerror = () => reject(new Error('Unable to read this file.')); reader.readAsDataURL(file); }); }
function normaliseCompany(value: unknown) { const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}; const savedLogo = typeof source.logo_url === 'string' && source.logo_url.trim() ? source.logo_url.trim() : DEFAULT_COMPANY.logo_url; return { company_name: typeof source.company_name === 'string' && source.company_name.trim() ? source.company_name.trim() : DEFAULT_COMPANY.company_name, logo_url: savedLogo.startsWith('/') ? `${RFMS_MARKETING_ORIGIN}${savedLogo}` : savedLogo, fofo_terms: typeof source.fofo_terms === 'string' && source.fofo_terms.trim() ? source.fofo_terms.trim() : DEFAULT_COMPANY.fofo_terms, foco_terms: typeof source.foco_terms === 'string' && source.foco_terms.trim() ? source.foco_terms.trim() : DEFAULT_COMPANY.foco_terms, foco_phase_2_terms: typeof source.foco_phase_2_terms === 'string' && source.foco_phase_2_terms.trim() ? source.foco_phase_2_terms.trim() : DEFAULT_COMPANY.foco_phase_2_terms, foco_phase_3_terms: typeof source.foco_phase_3_terms === 'string' && source.foco_phase_3_terms.trim() ? source.foco_phase_3_terms.trim() : DEFAULT_COMPANY.foco_phase_3_terms }; }
function isLegacyCanvasLogo(logoUrl: string) {
  const value = logoUrl.trim().toLowerCase();
  return value.includes('remedium-lab-logo.png')
    || value.includes('/uploads/company-logo-')
    || /company-logo-[a-z0-9.-]+\.(png|jpe?g|webp)(?:\?|$)/i.test(value);
}
function portalLogoImageProps(logoUrl: string) {
  return {
    className: isLegacyCanvasLogo(logoUrl) ? 'legacy-canvas-logo' : undefined,
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      if (image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth / image.naturalHeight >= 1.7) {
        image.classList.add('legacy-canvas-logo');
      }
    },
    onError: (event: SyntheticEvent<HTMLImageElement>) => {
      event.currentTarget.src = DEFAULT_COMPANY.logo_url;
      event.currentTarget.classList.add('legacy-canvas-logo');
    },
  };
}
function stageLabel(stage: string) { return ({ payment_1_due: 'Complete the first payment to submit your application', payment_1_received: 'Payment received — Remedium team review in progress', territory_allotted_payment_locked: 'Territory Allotment Letter issued — waiting for manager to release Phase 2 payment', franchise_fee_due: 'Territory allotted and Phase 2 released — read the current terms and pay the franchise fee', payment_2_received: 'Franchise fee received — onboarding review in progress', security_deposit_due: 'Onboarding approved — security deposit is due', payment_3_received: 'Security deposit received — final agreement and onboarding review', agreement_in_process: 'Agreement process started', agreement_and_onboarding: 'Agreement executed — training and onboarding in progress', onboarding_initiated: 'Documents verified — onboarding has started', branding_signage_unlocked: 'Territory allotted — branding signage in progress', onboarding_completed: 'Onboarding complete — welcome to the Remedium franchise network' } as Record<string, string>)[stage] ?? 'Your application is being reviewed.'; }
function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    if (typeof window !== 'undefined') {
      const port = Number(window.location.port);
      if (port >= 4000 && port <= 4002) return 'Unable to reach the RFMS API at http://localhost:9080. Run start-isolated.cmd and keep the RFMS Isolated Services window open.';
    }
    return 'The local RFMS API is not running. Start it with run-api.cmd or start-local.cmd.';
  }
  return error instanceof Error ? error.message : fallback;
}

type OnboardingTimelineStatus = 'completed' | 'in_progress' | 'pending';
type OnboardingTimelineStep = { id: string; label: string; status: OnboardingTimelineStatus; statusText: string; paymentKey?: string };

function paymentIsVerified(application: Application, key: string) {
  return application.payments.some((payment) => payment.key === key && payment.status === 'paid');
}

function allKycDocumentsUploaded(application: Application) {
  return DOCUMENTS.every((document) => Boolean(application.documents[document.key]));
}

function allKycDocumentsVerified(application: Application) {
  return DOCUMENTS.every((document) => Boolean(application.documents[document.key]) && application.document_verifications?.[document.key]?.status === 'verified');
}

function kycReuploadRequested(application: Application) {
  return DOCUMENTS.some((document) => application.document_verifications?.[document.key]?.status === 'upload_requested');
}

function kycTimelineStatusText(application: Application, status: OnboardingTimelineStatus) {
  if (status === 'completed') return 'Verified';
  if (status === 'pending') return 'Pending';
  if (kycReuploadRequested(application)) return 'Re-upload required';
  if (allKycDocumentsUploaded(application)) {
    const verifiedCount = DOCUMENTS.filter((document) => application.document_verifications?.[document.key]?.status === 'verified').length;
    if (verifiedCount > 0 && verifiedCount < DOCUMENTS.length) return `Under verification (${verifiedCount}/${DOCUMENTS.length} verified)`;
    return 'Under verification';
  }
  const uploadedCount = DOCUMENTS.filter((document) => Boolean(application.documents[document.key])).length;
  return uploadedCount > 0 ? `Upload in progress (${uploadedCount}/${DOCUMENTS.length})` : 'Upload pending';
}

function videoKycTimelineStatusText(application: Application, status: OnboardingTimelineStatus) {
  if (status === 'completed') return 'Completed';
  if (status === 'pending') return 'Pending';
  const activeSession = (application.video_kyc_sessions ?? []).find((session) => session.id === application.video_kyc_current_session_id)
    ?? (application.video_kyc_sessions ?? []).find((session) => ['assigned', 'in_progress'].includes(session.status));
  if (activeSession?.status === 'in_progress') return 'Join your call';
  if (activeSession?.status === 'assigned') return 'Assigned — waiting to start';
  return 'Awaiting assignment';
}

function timelineStatusText(application: Application, step: { id: string; status: OnboardingTimelineStatus }) {
  if (step.id === 'kyc_documents') return kycTimelineStatusText(application, step.status);
  if (step.id === 'video_kyc') return videoKycTimelineStatusText(application, step.status);
  if (step.status === 'completed') return 'Completed';
  if (step.status === 'in_progress') return 'In progress';
  return 'Pending';
}

function videoKycCompleted(application: Application) {
  return (application.video_kyc_sessions ?? []).some((session) => session.status === 'completed');
}

function fieldOfficerAssigned(application: Application) {
  const visit = application.field_visit;
  return Boolean(visit && ['assigned', 'submitted', 'approved'].includes(visit.status));
}

function agreementStatusForApplicant(application: Application) {
  const status = application.agreement_workflow?.status ?? 'not_started';
  if (status === 'not_started') return 'Locked until final approval';
  if (status === 'in_process' || status === 'estamp_verified' || status === 'draft_ready') return 'Agreement process started';
  if (status === 'sent_to_applicant') {
    const decision = application.agreement_workflow?.applicant?.correction_decision;
    if (decision === 'denied') return 'Change request declined — continue review';
    return 'Agreement ready for review';
  }
  if (status === 'correction_requested') {
    const decision = application.agreement_workflow?.applicant?.correction_decision;
    if (decision === 'approved') return 'Change request approved — revised agreement coming';
    if (decision === 'denied') return 'Change request declined';
    return 'Correction request submitted';
  }
  if (status === 'applicant_esign_completed') return 'Applicant Aadhaar eSign completed — awaiting company execution';
  if (status === 'company_execution_pending') return 'Company signed copy uploaded — awaiting final save';
  if (status === 'company_dsc_completed') return 'Company signature completed — finalising agreement';
  if (status === 'executed') return 'Agreement executed';
  return application.agreement_workflow?.status_label ?? 'Agreement in process';
}

function agreementStepComplete(application: Application) {
  return application.agreement_workflow?.status === 'executed' || ['agreement_and_onboarding', 'onboarding_initiated', 'onboarding_completed'].includes(application.stage);
}

function brandingSignageApproved(application: Application) {
  return application.branding_signage?.status === 'approved';
}

function hrProcessApproved(application: Application) {
  return application.hr_process?.status === 'approved';
}

function onboardingCertificateComplete(application: Application) {
  return Boolean(application.onboarding_certificate?.certificate?.pdf?.url);
}

function trainingStepComplete(application: Application) {
  const training = application.training;
  if (training?.certificate?.pdf?.url) return true;
  if (training?.completed_at && training?.certificate?.certificate_number) return true;
  return application.stage === 'onboarding_completed';
}

function buildOnboardingTimeline(application: Application): { steps: OnboardingTimelineStep[]; completionPercent: number; currentStageLabel: string; modelLabel: string } {
  const focoSteps: { id: string; label: string; paymentKey?: string; complete: () => boolean }[] = [
    { id: 'application_submitted', label: 'Application Submitted', complete: () => true },
    { id: 'application_payment', label: 'Application Payment Complete', paymentKey: 'application_fee', complete: () => paymentIsVerified(application, 'application_fee') },
    { id: 'kyc_documents', label: 'KYC Document Verification', complete: () => allKycDocumentsVerified(application) },
    { id: 'video_kyc', label: 'Video KYC', complete: () => videoKycCompleted(application) },
    { id: 'field_officer', label: 'Field Officer Assigned', complete: () => fieldOfficerAssigned(application) },
    { id: 'second_phase_payment', label: 'Second Phase Payment', paymentKey: 'franchise_fee', complete: () => paymentIsVerified(application, 'franchise_fee') },
    { id: 'branding_signage', label: 'Branding Signage', complete: () => brandingSignageApproved(application) },
    { id: 'hr_process', label: 'HR Process', complete: () => hrProcessApproved(application) },
    { id: 'third_phase_payment', label: 'Third Phase Payment', paymentKey: 'security_deposit', complete: () => paymentIsVerified(application, 'security_deposit') },
    { id: 'agreement', label: 'Agreement', complete: () => agreementStepComplete(application) },
    { id: 'training', label: 'Training', complete: () => trainingStepComplete(application) },
    { id: 'onboarding_certificate', label: 'Onboarding Certificate', complete: () => onboardingCertificateComplete(application) },
    { id: 'onboarded', label: 'Onboarded', complete: () => application.stage === 'onboarding_completed' },
  ];
  const fofoSteps: { id: string; label: string; paymentKey?: string; complete: () => boolean }[] = [
    { id: 'application_submitted', label: 'Application Submitted', complete: () => true },
    { id: 'franchise_fee_payment', label: 'Franchise Fee Payment', paymentKey: 'fofo_one_time_fee', complete: () => paymentIsVerified(application, 'fofo_one_time_fee') },
    { id: 'kyc_documents', label: 'KYC Document Verification', complete: () => allKycDocumentsVerified(application) },
    { id: 'video_kyc', label: 'Video KYC', complete: () => videoKycCompleted(application) },
    { id: 'field_officer', label: 'Field Officer Assigned', complete: () => fieldOfficerAssigned(application) },
    { id: 'branding_signage', label: 'Branding Signage', complete: () => brandingSignageApproved(application) },
    { id: 'agreement', label: 'Agreement', complete: () => agreementStepComplete(application) },
    { id: 'training', label: 'Training', complete: () => trainingStepComplete(application) },
    { id: 'onboarding_certificate', label: 'Onboarding Certificate', complete: () => onboardingCertificateComplete(application) },
    { id: 'onboarded', label: 'Onboarded', complete: () => application.stage === 'onboarding_completed' },
  ];
  const definitions = application.franchise_model === 'FOCO' ? focoSteps : fofoSteps;
  const rawCompletedFlags = definitions.map((step) => step.complete());
  const effectiveCompletedFlags = rawCompletedFlags.map((complete, index) => complete && (index === 0 || rawCompletedFlags.slice(0, index).every(Boolean)));
  const firstIncompleteIndex = effectiveCompletedFlags.findIndex((complete) => !complete);
  const steps: OnboardingTimelineStep[] = definitions.map((step, index) => {
    const status: OnboardingTimelineStatus = effectiveCompletedFlags[index]
      ? 'completed'
      : firstIncompleteIndex === -1
        ? 'completed'
        : index === firstIncompleteIndex
          ? 'in_progress'
          : 'pending';
    return {
      id: step.id,
      label: step.label,
      paymentKey: step.paymentKey,
      status,
      statusText: timelineStatusText(application, { id: step.id, status }),
    };
  });
  const completedCount = effectiveCompletedFlags.filter(Boolean).length;
  const inProgressStep = steps.find((step) => step.status === 'in_progress');
  const completionPercent = steps.length ? Math.max(8, Math.round((completedCount / steps.length) * 100)) : 0;
  const currentStageLabel = inProgressStep?.label ?? steps.at(-1)?.label ?? 'Application Submitted';
  return { steps, completionPercent, currentStageLabel, modelLabel: application.franchise_model };
}

function ApplicationOnboardingTimeline({ application }: { application: Application }) {
  const timeline = buildOnboardingTimeline(application);
  return (
    <section className="dashboard-progress onboarding-timeline" aria-labelledby="onboarding-timeline-title">
      <div className="dashboard-progress-heading">
        <div>
          <h2 id="onboarding-timeline-title">Application progress</h2>
          <p className="onboarding-timeline-model">{timeline.modelLabel} onboarding workflow</p>
        </div>
        <span>{timeline.completionPercent}% complete</span>
      </div>
      <div className="dashboard-progress-bar" role="progressbar" aria-valuenow={timeline.completionPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding progress">
        <span style={{ width: `${timeline.completionPercent}%` }} />
      </div>
      <p className="onboarding-timeline-current"><strong>Current stage:</strong> {timeline.currentStageLabel}</p>
      <div className="onboarding-timeline-track" role="list" aria-label={`${timeline.modelLabel} onboarding timeline`}>
        {timeline.steps.map((step, index) => (
          <article className={`onboarding-timeline-step onboarding-timeline-step--${step.status}`} key={step.id} role="listitem" aria-current={step.status === 'in_progress' ? 'step' : undefined} title={step.label}>
            <div className="onboarding-timeline-node" aria-hidden="true">
              <span className="onboarding-timeline-icon">{step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '…' : index + 1}</span>
              {index < timeline.steps.length - 1 ? <span className="onboarding-timeline-connector" /> : null}
            </div>
            <div className="onboarding-timeline-copy">
              <b>{step.label}</b>
              <small>{step.statusText}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function profileSteps(application: Application) {
  const paid = new Set(application.payments.filter((payment) => payment.status === 'paid').map((payment) => payment.key));
  if (application.franchise_model === 'FOFO') return [
    { label: 'Application and KYC', complete: true },
    { label: 'One-time franchise payment', complete: paid.has('fofo_one_time_fee') },
    { label: 'Document verification', complete: ['onboarding_initiated', 'agreement_and_onboarding'].includes(application.stage) },
    { label: 'Onboarding', complete: application.stage === 'agreement_and_onboarding', active: application.stage === 'onboarding_initiated' },
  ];
  return [
    { label: 'Application and KYC', complete: true },
    { label: 'Phase 1 application fee', complete: paid.has('application_fee') },
    { label: 'Verification and location allotment', complete: ['territory_allotted_payment_locked', 'franchise_fee_due', 'payment_2_received', 'security_deposit_due', 'payment_3_received', 'agreement_and_onboarding'].includes(application.stage) },
    { label: 'Phase 2 franchise fee', complete: paid.has('franchise_fee') },
    { label: 'Onboarding and security deposit', complete: paid.has('security_deposit'), active: application.stage === 'security_deposit_due' },
    { label: 'Final agreement and onboarding', complete: application.stage === 'agreement_and_onboarding', active: application.stage === 'payment_3_received' },
  ];
}

function BrandHeader({ company, application, onProfile }: { company: typeof DEFAULT_COMPANY; application: Application | null; onProfile: () => void }) {
  const marketingHome = RFMS_MARKETING_ORIGIN.replace(/\/$/, '');
  return (
    <header className="application-header">
      <a href={marketingHome} className="app-brand" aria-label={`${company.company_name} home`}>
        <span className="portal-logo-frame">
          <img src={company.logo_url} alt={`${company.company_name} logo`} {...portalLogoImageProps(company.logo_url)} />
        </span>
      </a>
      <div className="application-header-actions">
        <span className="header-chip">Franchise applicant portal</span>
        <span className="header-chip header-chip-muted">{application?.application_number ?? 'Secure franchise application'}</span>
        {application ? <button className="profile-link" type="button" onClick={onProfile}>My application profile</button> : null}
      </div>
    </header>
  );
}

function DocumentUpload({ item, document, busy, onUpload }: { item: typeof DOCUMENTS[number]; document?: UploadedDocument; busy: boolean; onUpload: (key: DocumentKey, event: ChangeEvent<HTMLInputElement>) => void }) {
  return <article className={`document-upload ${document ? 'uploaded' : ''}`}><div className="document-icon">{document ? '✓' : '↑'}</div><div><b>{item.title}</b><span>{document ? document.name : item.hint}</span></div><label>{busy ? 'Uploading...' : document ? 'Replace file' : 'Choose file'}<input type="file" accept={item.accept} disabled={busy} onChange={(event) => onUpload(item.key, event)} /></label></article>;
}

function LegacyPaymentSchedule({ application, paying, onPay }: { application: Application; paying: string; onPay: (payment: Payment) => void }) {
  return <section className="payment-plan"><h2>{application.franchise_model} payment schedule</h2>{application.payments.map((payment, index) => <article className={`payment-card ${payment.status}`} key={payment.key}><span className="payment-phase">{index + 1}</span><div><h3>{payment.label}</h3><p>{payment.purpose}</p>{payment.status === 'paid' ? <small>Paid {payment.receipt_number ? `• Receipt ${payment.receipt_number}` : ''}</small> : payment.status === 'locked' ? <small>Unlocks after the previous RFMS review step.</small> : <small>Payment is due now.</small>}</div><div className="payment-action"><b>{money(payment.amount)}</b>{payment.status === 'due' ? <button onClick={() => onPay(payment)} disabled={paying === payment.key}>{paying === payment.key ? 'Processing...' : `Pay ${money(payment.amount)}`}</button> : <span>{payment.status === 'paid' ? 'Paid' : 'Locked'}</span>}</div></article>)}</section>;
}

function PaymentMethodModal({
  payment,
  focoFull,
  focoFullEligible,
  focoFullTotal,
  pricing,
  busy,
  error,
  onClose,
  onSelect,
  onToggleFocoFull,
}: {
  payment: Payment;
  focoFull: boolean;
  focoFullEligible: boolean;
  focoFullTotal: number;
  pricing: { original_amount: number; discount_amount: number; final_amount: number };
  busy: boolean;
  error: string;
  onClose: () => void;
  onSelect: (method: PaymentMethodKey) => void;
  onToggleFocoFull: (next: boolean) => void;
}) {
  return <div className="payment-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="payment-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="payment-modal-head">
        <div>
          <p>Choose payment method</p>
          <h2>{focoFull ? 'Complete FOCO franchise amount' : payment.label}</h2>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="payment-pricing-summary">
        <span>Original amount</span><b>{money(pricing.original_amount)}</b>
        {pricing.discount_amount > 0 ? <><span>Discount</span><b>-{money(pricing.discount_amount)}</b></> : null}
        <span>Final payable</span><strong>{money(pricing.final_amount)}</strong>
      </div>
      {payment.key === 'application_fee' && focoFullEligible ? <label className="payment-foco-full-option">
        <input type="checkbox" checked={focoFull} onChange={(event) => onToggleFocoFull(event.target.checked)} />
        <span><b>Pay the complete FOCO franchise amount in one transaction</b><small>{money(focoFullTotal)} across application fee, franchise fee and security deposit.</small></span>
      </label> : null}
      <div className="payment-method-list">
        {PAYMENT_METHOD_OPTIONS.map((method) => <button key={method.key} type="button" disabled={busy} onClick={() => onSelect(method.key)}>
          <b>{method.label}</b>
          <span>{method.description}</span>
        </button>)}
      </div>
      {error ? <p className="portal-message error" role="alert">{error}</p> : null}
    </section>
  </div>;
}

function OfflinePaymentModal({
  method,
  payment,
  focoFull,
  couponCode,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  method: 'cheque' | 'bank_transfer';
  payment: Payment;
  focoFull: boolean;
  couponCode?: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: Record<string, string>) => Promise<void>;
}) {
  const [chequeNumber, setChequeNumber] = useState('');
  const [transactionReference, setTransactionReference] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [proofName, setProofName] = useState('');
  const [proofDataUrl, setProofDataUrl] = useState('');
  const [localError, setLocalError] = useState('');

  async function handleProofChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setLocalError('Upload a file smaller than 5 MB.');
      return;
    }
    setLocalError('');
    setProofName(file.name);
    setProofDataUrl(await asDataUrl(file));
  }

  return <div className="payment-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="payment-modal payment-modal-form" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="payment-modal-head">
        <div>
          <p>{method === 'cheque' ? 'Cheque payment' : 'Bank transfer payment'}</p>
          <h2>{focoFull ? 'Complete FOCO franchise amount' : payment.label}</h2>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <form className="payment-offline-form" onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          method,
          payment_key: payment.key,
          foco_full: focoFull ? '1' : '',
          coupon_code: couponCode ?? '',
          cheque_number: chequeNumber,
          transaction_reference: transactionReference,
          account_number: accountNumber,
          ifsc_code: ifscCode,
          account_holder_name: accountHolderName,
          proof_data_url: proofDataUrl,
          proof_name: proofName,
        });
      }}>
        {method === 'cheque' ? <label>Cheque number<input value={chequeNumber} onChange={(event) => setChequeNumber(event.target.value)} required /></label> : <label>Transaction ID / UTR number<input value={transactionReference} onChange={(event) => setTransactionReference(event.target.value.toUpperCase())} required /></label>}
        <label>Account number<input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} required /></label>
        <label>IFSC code<input value={ifscCode} onChange={(event) => setIfscCode(event.target.value.toUpperCase())} required /></label>
        <label>Account holder name<input value={accountHolderName} onChange={(event) => setAccountHolderName(event.target.value)} required /></label>
        <label>{method === 'cheque' ? 'Upload cheque image' : 'Upload payment receipt'}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => void handleProofChange(event)} required={!proofDataUrl} /></label>
        {proofName ? <small>{proofName} selected</small> : null}
        {(localError || error) ? <p className="portal-message error" role="alert">{localError || error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for verification'}</button>
      </form>
    </section>
  </div>;
}

function GatewayCheckoutModal({
  orderNumber,
  amount,
  busy,
  error,
  simulate,
  onCancel,
  onComplete,
}: {
  orderNumber: string;
  amount: number;
  busy: boolean;
  error: string;
  simulate?: boolean;
  onCancel: () => void;
  onComplete: () => void;
}) {
  return <div className="payment-modal-backdrop" role="presentation">
    <section className="payment-modal payment-modal-gateway" role="dialog" aria-modal="true">
      <header className="payment-modal-head">
        <div>
          <p>Payment gateway</p>
          <h2>Secure checkout</h2>
        </div>
      </header>
      <p className="payment-gateway-copy">
        {simulate
          ? 'Local testing gateway: no real money is charged. Complete this simulated checkout to return to your payment page with an instant Paid status.'
          : 'Opening Razorpay Checkout. Complete payment in the Razorpay window to finish this franchise fee.'}
      </p>
      <dl className="payment-gateway-details">
        <div><dt>Order</dt><dd>{orderNumber}</dd></div>
        <div><dt>Payable amount</dt><dd>{money(amount)}</dd></div>
      </dl>
      {error ? <p className="portal-message error" role="alert">{error}</p> : null}
      <div className="payment-gateway-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        {simulate ? (
          <button type="button" onClick={onComplete} disabled={busy}>{busy ? 'Processing…' : 'Pay now'}</button>
        ) : (
          <button type="button" onClick={onComplete} disabled={busy}>{busy ? 'Opening Razorpay…' : 'Continue to Razorpay'}</button>
        )}
      </div>
    </section>
  </div>;
}

function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Razorpay is only available in the browser.'));
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-rfms-razorpay="1"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Razorpay Checkout failed to load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.rfmsRazorpay = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Razorpay Checkout failed to load.'));
    document.body.appendChild(script);
  });
}

function PaymentSchedule({ application, company = DEFAULT_COMPANY, onApplicationUpdated, onMessage, onError }: { application: Application; company?: typeof DEFAULT_COMPANY; onApplicationUpdated?: (application: Application) => void; onMessage?: (message: string) => void; onError?: (message: string) => void }) {
  const termsAccepted = application.terms_accepted === true;
  const phaseTwo = application.payments.find((payment) => payment.key === 'franchise_fee');
  const phaseThree = application.payments.find((payment) => payment.key === 'security_deposit');
  const phaseTwoTermsAccepted = Boolean(application.payment_terms?.franchise_fee?.accepted_at);
  const phaseThreeTermsAccepted = Boolean(application.payment_terms?.security_deposit?.accepted_at);
  const [franchiseTermsRecorded, setFranchiseTermsRecorded] = useState(false);
  const [franchiseTermsOpen, setFranchiseTermsOpen] = useState(false);
  const [franchiseTermsBusy, setFranchiseTermsBusy] = useState(false);
  const [franchiseTermsError, setFranchiseTermsError] = useState('');
  const [franchiseTermsText, setFranchiseTermsText] = useState(application.franchise_model === 'FOCO' ? company.foco_terms : company.fofo_terms);
  const [franchisePendingPayment, setFranchisePendingPayment] = useState<Payment | null>(null);
  const [phaseTwoTermsRecorded, setPhaseTwoTermsRecorded] = useState(false);
  const [phaseTwoPendingPayment, setPhaseTwoPendingPayment] = useState<Payment | null>(null);
  const [phaseTwoTermsOpen, setPhaseTwoTermsOpen] = useState(false);
  const [phaseTwoTermsBusy, setPhaseTwoTermsBusy] = useState(false);
  const [phaseTwoTermsError, setPhaseTwoTermsError] = useState('');
  const [phaseTwoTermsText, setPhaseTwoTermsText] = useState(company.foco_phase_2_terms);
  const [phaseThreeTermsRecorded, setPhaseThreeTermsRecorded] = useState(false);
  const [phaseThreePendingPayment, setPhaseThreePendingPayment] = useState<Payment | null>(null);
  const [phaseThreeTermsOpen, setPhaseThreeTermsOpen] = useState(false);
  const [phaseThreeTermsBusy, setPhaseThreeTermsBusy] = useState(false);
  const [phaseThreeTermsError, setPhaseThreeTermsError] = useState('');
  const [phaseThreeTermsText, setPhaseThreeTermsText] = useState(company.foco_phase_3_terms);
  const [couponInputs, setCouponInputs] = useState<Record<string, string>>({});
  const [appliedCoupons, setAppliedCoupons] = useState<Record<string, AppliedCoupon>>({});
  const [couponErrors, setCouponErrors] = useState<Record<string, string>>({});
  const [couponBusy, setCouponBusy] = useState<Record<string, boolean>>({});
  const [paymentBusy, setPaymentBusy] = useState('');
  const [paymentFlowError, setPaymentFlowError] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [methodModalOpen, setMethodModalOpen] = useState(false);
  const [offlineMethod, setOfflineMethod] = useState<PaymentMethodKey | ''>('');
  const [focoFullSelected, setFocoFullSelected] = useState(false);
  const [gatewayOrder, setGatewayOrder] = useState<{
    id: string;
    order_number: string;
    amount: number;
    simulate?: boolean;
    key_id?: string;
    razorpay_order_id?: string;
    currency?: string;
  } | null>(null);

  useEffect(() => {
    if (phaseTwoTermsAccepted && phaseTwoTermsError) setPhaseTwoTermsError('');
  }, [phaseTwoTermsAccepted, phaseTwoTermsError]);

  useEffect(() => {
    if (franchiseTermsRecorded && franchiseTermsError) setFranchiseTermsError('');
  }, [franchiseTermsRecorded, franchiseTermsError]);

  useEffect(() => {
    if (phaseThreeTermsAccepted && phaseThreeTermsError) setPhaseThreeTermsError('');
  }, [phaseThreeTermsAccepted, phaseThreeTermsError]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('rfms_gateway');
    if (!orderId) return;
    params.delete('rfms_gateway');
    params.delete('application');
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', next || '/');
    setGatewayOrder({ id: orderId, order_number: orderId.slice(-8).toUpperCase(), amount: 0 });
  }, [application.id]);

  async function openFranchiseTerms(pendingPayment?: Payment | null) {
    setFranchiseTermsError('');
    if (pendingPayment) setFranchisePendingPayment(pendingPayment);
    try {
      const response = await fetch(`${API_BASE}/content/settings`);
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: unknown } | null;
      if (response.ok && payload?.success) {
        const settings = normaliseCompany(payload.data);
        setFranchiseTermsText(application.franchise_model === 'FOCO' ? settings.foco_terms : settings.fofo_terms);
      }
    } catch {
      /* Keep the most recent terms copy if offline. */
    }
    setFranchiseTermsOpen(true);
  }

  async function acceptFranchiseTerms() {
    setFranchiseTermsBusy(true);
    setFranchiseTermsError('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/${application.id}/terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to record your franchise terms acceptance.');
      onApplicationUpdated?.(payload.data);
      setFranchiseTermsRecorded(true);
      setFranchiseTermsOpen(false);
      const pendingPayment = franchisePendingPayment;
      setFranchisePendingPayment(null);
      if (pendingPayment) window.setTimeout(() => { openPaymentFlow(pendingPayment); }, 0);
    } catch (requestError) {
      setFranchiseTermsError(requestError instanceof Error ? requestError.message : 'Unable to record your franchise terms acceptance.');
    } finally {
      setFranchiseTermsBusy(false);
    }
  }

  async function openPhaseTwoTerms(pendingPayment?: Payment | null) {
    setPhaseTwoTermsError('');
    if (pendingPayment) setPhaseTwoPendingPayment(pendingPayment);
    try {
      const response = await fetch(`${API_BASE}/content/settings`);
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: unknown } | null;
      if (response.ok && payload?.success) setPhaseTwoTermsText(normaliseCompany(payload.data).foco_phase_2_terms);
    } catch {
      /* The last loaded company terms remain available offline. */
    }
    setPhaseTwoTermsOpen(true);
  }

  async function acceptPhaseTwoTerms() {
    setPhaseTwoTermsBusy(true);
    setPhaseTwoTermsError('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/${application.id}/payment-terms/franchise_fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to record your Phase 2 terms acceptance.');
      onApplicationUpdated?.(payload.data);
      setPhaseTwoTermsRecorded(true);
      setPhaseTwoTermsOpen(false);
      const pendingPayment = phaseTwoPendingPayment;
      setPhaseTwoPendingPayment(null);
      if (pendingPayment) window.setTimeout(() => { openPaymentFlow(pendingPayment); }, 0);
    } catch (requestError) {
      setPhaseTwoTermsError(requestError instanceof Error ? requestError.message : 'Unable to record your Phase 2 terms acceptance.');
    } finally {
      setPhaseTwoTermsBusy(false);
    }
  }

  async function openPhaseThreeTerms(pendingPayment?: Payment | null) {
    setPhaseThreeTermsError('');
    if (pendingPayment) setPhaseThreePendingPayment(pendingPayment);
    try {
      const response = await fetch(`${API_BASE}/content/settings`);
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: unknown } | null;
      if (response.ok && payload?.success) setPhaseThreeTermsText(normaliseCompany(payload.data).foco_phase_3_terms);
    } catch {
      /* Keep the latest cached Phase 3 terms when offline. */
    }
    setPhaseThreeTermsOpen(true);
  }

  async function acceptPhaseThreeTerms() {
    setPhaseThreeTermsBusy(true);
    setPhaseThreeTermsError('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/${application.id}/payment-terms/security_deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to record your Phase 3 terms acceptance.');
      onApplicationUpdated?.(payload.data);
      setPhaseThreeTermsRecorded(true);
      setPhaseThreeTermsOpen(false);
      const pendingPayment = phaseThreePendingPayment;
      setPhaseThreePendingPayment(null);
      if (pendingPayment) window.setTimeout(() => { openPaymentFlow(pendingPayment); }, 0);
    } catch (requestError) {
      setPhaseThreeTermsError(requestError instanceof Error ? requestError.message : 'Unable to record your Phase 3 terms acceptance.');
    } finally {
      setPhaseThreeTermsBusy(false);
    }
  }

  const franchiseTermsReady = termsAccepted || franchiseTermsRecorded;
  const phaseTwoTermsReady = phaseTwoTermsAccepted || phaseTwoTermsRecorded;
  const phaseThreeTermsReady = phaseThreeTermsAccepted || phaseThreeTermsRecorded;
  const duePayment = application.payments.find((payment) => payment.status === 'due');

  async function applyCoupon(payment: Payment) {
    const code = (couponInputs[payment.key] ?? '').trim();
    if (!code) {
      setCouponErrors((current) => ({ ...current, [payment.key]: 'Enter a coupon code before applying.' }));
      return;
    }
    setCouponBusy((current) => ({ ...current, [payment.key]: true }));
    setCouponErrors((current) => ({ ...current, [payment.key]: '' }));
    try {
      const response = await fetch(`${API_BASE}/applications/public/${application.id}/payments/validate-coupon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_key: payment.key, coupon_code: code }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { coupon_code?: string; original_amount: number; discount_amount: number; final_amount: number; message?: string }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'This coupon could not be applied.');
      const quote = payload.data;
      setAppliedCoupons((current) => ({ ...current, [payment.key]: {
        code: quote.coupon_code || code,
        original_amount: quote.original_amount,
        discount_amount: quote.discount_amount,
        final_amount: quote.final_amount,
      } }));
    } catch (requestError) {
      setAppliedCoupons((current) => { const next = { ...current }; delete next[payment.key]; return next; });
      setCouponErrors((current) => ({ ...current, [payment.key]: requestError instanceof Error ? requestError.message : 'This coupon could not be applied.' }));
    } finally {
      setCouponBusy((current) => ({ ...current, [payment.key]: false }));
    }
  }

  function clearCoupon(paymentKey: string) {
    setAppliedCoupons((current) => { const next = { ...current }; delete next[paymentKey]; return next; });
    setCouponErrors((current) => ({ ...current, [paymentKey]: '' }));
  }

  function payableAmount(payment: Payment) {
    return appliedCoupons[payment.key]?.final_amount ?? payment.amount;
  }

  function currentPricing(payment: Payment) {
    const coupon = appliedCoupons[payment.key];
    if (focoFullSelected && payment.key === 'application_fee') {
      return {
        original_amount: coupon?.original_amount ?? focoFullPaymentTotal(application),
        discount_amount: coupon?.discount_amount ?? 0,
        final_amount: coupon?.final_amount ?? focoFullPaymentTotal(application),
      };
    }
    return {
      original_amount: coupon?.original_amount ?? payment.amount,
      discount_amount: coupon?.discount_amount ?? 0,
      final_amount: coupon?.final_amount ?? payment.amount,
    };
  }

  function openPaymentFlow(payment: Payment) {
    setPaymentFlowError('');
    setSelectedPayment(payment);
    setFocoFullSelected(false);
    setMethodModalOpen(true);
  }

  async function refreshFocoFullCoupon(payment: Payment, enabled: boolean, couponCode?: string) {
    if (!enabled || !couponCode) return;
    const response = await fetch(`${API_BASE}/applications/public/${application.id}/payments/validate-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_key: payment.key, coupon_code: couponCode, foco_full: true }),
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; data?: AppliedCoupon & { coupon_code?: string }; error?: { message?: string } } | null;
    if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'This coupon could not be applied to the complete franchise amount.');
    const quote = payload.data;
    setAppliedCoupons((current) => ({ ...current, [payment.key]: {
      code: quote.coupon_code || couponCode,
      original_amount: quote.original_amount,
      discount_amount: quote.discount_amount,
      final_amount: quote.final_amount,
      foco_full: true,
    } }));
  }

  async function handleToggleFocoFull(enabled: boolean) {
    if (!selectedPayment) return;
    setFocoFullSelected(enabled);
    setPaymentFlowError('');
    const couponCode = appliedCoupons[selectedPayment.key]?.code ?? couponInputs[selectedPayment.key]?.trim();
    if (enabled && couponCode) {
      try {
        await refreshFocoFullCoupon(selectedPayment, true, couponCode);
      } catch (requestError) {
        setPaymentFlowError(requestError instanceof Error ? requestError.message : 'Unable to apply this coupon to the complete franchise amount.');
      }
    }
  }

  async function initiateGateway(method: PaymentMethodKey) {
    if (!selectedPayment || method !== 'gateway') return;
    setPaymentBusy('gateway');
    setPaymentFlowError('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/${application.id}/payments/gateway/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_key: selectedPayment.key,
          coupon_code: appliedCoupons[selectedPayment.key]?.code || undefined,
          foco_full: focoFullSelected,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: {
          order_id: string;
          order_number: string;
          amount: number;
          simulate?: boolean;
          key_id?: string;
          razorpay_order_id?: string;
          currency?: string;
          provider?: string;
        };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to start the payment gateway session.');
      setMethodModalOpen(false);
      setGatewayOrder({
        id: payload.data.order_id,
        order_number: payload.data.order_number,
        amount: payload.data.amount,
        simulate: Boolean(payload.data.simulate || payload.data.provider === 'simulate'),
        key_id: payload.data.key_id,
        razorpay_order_id: payload.data.razorpay_order_id,
        currency: payload.data.currency || 'INR',
      });
    } catch (requestError) {
      setPaymentFlowError(requestError instanceof Error ? requestError.message : 'Unable to start the payment gateway session.');
    } finally {
      setPaymentBusy('');
    }
  }

  async function finalizeGatewayPayment(extra: Record<string, string> = {}) {
    if (!gatewayOrder) return;
    setPaymentBusy('gateway-complete');
    setPaymentFlowError('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/${application.id}/payments/gateway/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: gatewayOrder.id, ...extra }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: Application; receipt?: { receipt_number?: string } }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'Payment could not be completed.');
      onApplicationUpdated?.(payload.data.application);
      setGatewayOrder(null);
      setSelectedPayment(null);
      onMessage?.(`Payment successful.${payload.data.receipt?.receipt_number ? ` Receipt ${payload.data.receipt.receipt_number} is ready to download.` : ''}`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Payment could not be completed.';
      setPaymentFlowError(message);
      onError?.(message);
    } finally {
      setPaymentBusy('');
    }
  }

  async function completeGatewayPayment() {
    if (!gatewayOrder) return;
    if (gatewayOrder.simulate || !gatewayOrder.key_id || !gatewayOrder.razorpay_order_id) {
      await finalizeGatewayPayment();
      return;
    }
    setPaymentBusy('gateway-complete');
    setPaymentFlowError('');
    try {
      await loadRazorpayCheckoutScript();
      const RazorpayCtor = (window as unknown as {
        Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
      }).Razorpay;
      if (!RazorpayCtor) throw new Error('Razorpay Checkout is unavailable.');
      const amountPaise = Math.round(Number(gatewayOrder.amount || 0) * 100);
      const checkout = new RazorpayCtor({
        key: gatewayOrder.key_id,
        amount: amountPaise,
        currency: gatewayOrder.currency || 'INR',
        name: 'Remedium Lab Franchise',
        description: gatewayOrder.order_number,
        order_id: gatewayOrder.razorpay_order_id,
        handler: (response: {
          razorpay_order_id?: string;
          razorpay_payment_id?: string;
          razorpay_signature?: string;
        }) => {
          void finalizeGatewayPayment({
            razorpay_order_id: String(response.razorpay_order_id || gatewayOrder.razorpay_order_id || ''),
            razorpay_payment_id: String(response.razorpay_payment_id || ''),
            razorpay_signature: String(response.razorpay_signature || ''),
          });
        },
        modal: {
          ondismiss: () => {
            setPaymentBusy('');
            setPaymentFlowError('Payment was cancelled before completion.');
          },
        },
      });
      checkout.open();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to open Razorpay Checkout.';
      setPaymentFlowError(message);
      onError?.(message);
      setPaymentBusy('');
    }
  }

  async function submitOfflinePayment(payload: Record<string, string>) {
    if (!selectedPayment) return;
    setPaymentBusy('offline');
    setPaymentFlowError('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/${application.id}/payments/submit-offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          foco_full: focoFullSelected,
        }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; data?: { application?: Application; message?: string }; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || !result.data?.application) throw new Error(result?.error?.message ?? 'Payment submission failed.');
      onApplicationUpdated?.(result.data.application);
      setOfflineMethod('');
      setMethodModalOpen(false);
      setSelectedPayment(null);
      onMessage?.(result.data.message ?? 'Payment submitted successfully. Status is now Under Verification.');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Payment submission failed.';
      setPaymentFlowError(message);
      onError?.(message);
    } finally {
      setPaymentBusy('');
    }
  }

  function handleSelectPaymentMethod(method: PaymentMethodKey) {
    if (method === 'gateway') {
      void initiateGateway(method);
      return;
    }
    setMethodModalOpen(false);
    setOfflineMethod(method);
  }

  return (
    <section className="payment-plan">
      <h2>{application.franchise_model} payment schedule</h2>
      {!franchiseTermsReady && duePayment ? (
        <div className="payment-terms-gate">
          <p>Payment is locked until the applicant accepts the required {application.franchise_model} franchise terms and conditions.</p>
          <button type="button" className="payment-terms-link" onClick={() => void openFranchiseTerms(duePayment)}>Read terms &amp; conditions</button>
        </div>
      ) : null}
      {application.payments.map((payment, index) => {
        const isFocoPhaseTwo = application.franchise_model === 'FOCO' && payment.key === 'franchise_fee';
        const isFocoPhaseThree = application.franchise_model === 'FOCO' && payment.key === 'security_deposit';
        const phaseTwoNeedsTerms = isFocoPhaseTwo && payment.status === 'due' && !phaseTwoTermsReady;
        const phaseThreeNeedsTerms = isFocoPhaseThree && payment.status === 'due' && !phaseThreeTermsReady;
        const requiresOriginalTerms = payment.status === 'due' && !isFocoPhaseTwo && !isFocoPhaseThree && !franchiseTermsReady;
        return (
          <article className={`payment-card ${payment.status} ${phaseTwoNeedsTerms ? 'phase-two-terms-card' : ''} ${phaseThreeNeedsTerms ? 'phase-three-terms-card' : ''}`} key={payment.key}>
            <span className="payment-phase">{index + 1}</span>
            <div>
              <h3>{payment.label}</h3>
              <p>{payment.purpose}</p>
              {payment.status === 'paid' ? <small>Paid {payment.receipt_number ? `• Receipt ${payment.receipt_number}` : ''}{payment.coupon_code ? ` • Coupon ${payment.coupon_code}` : ''}</small> : payment.status === 'under_verification' ? <small>Submitted for RFMS verification. You will be notified once it is marked as paid.</small> : payment.status === 'locked' ? <small>Unlocks after the previous RFMS review step.</small> : phaseThreeNeedsTerms ? <small>FOCO Phase 3 has been released by the franchise manager. Read and accept the current Security Deposit terms before payment.</small> : phaseTwoNeedsTerms ? <small>Phase 2 has been released by the franchise manager. Read and accept the current Phase 2 payment terms before payment.</small> : requiresOriginalTerms ? <small>Read and accept the franchise terms before payment.</small> : <small>Payment is due now.</small>}
            </div>
            <div className="payment-action">
              {payment.status === 'paid' && Number(payment.discount_amount) > 0 ? (
                <div className="payment-coupon-summary paid">
                  <small>Original {money(payment.original_amount ?? payment.amount)}</small>
                  <small>Discount -{money(payment.discount_amount ?? 0)}</small>
                  <b>{money(payment.amount)}</b>
                </div>
              ) : (
                <b>{money(payment.status === 'due' ? payableAmount(payment) : payment.amount)}</b>
              )}
              {payment.status === 'paid' ? (
                <>
                  <span>Paid</span>
                  <a className="receipt-download" href={paymentReceiptUrl(application.id, payment.key)}>Download receipt PDF</a>
                </>
              ) : payment.status === 'under_verification' ? (
                <span>{paymentStatusCopy(payment.status)}</span>
              ) : payment.status === 'due' && phaseThreeNeedsTerms ? (
                <button type="button" onClick={() => void openPhaseThreeTerms(payment)} disabled={phaseThreeTermsBusy}>Read &amp; accept Phase 3 terms</button>
              ) : payment.status === 'due' && phaseTwoNeedsTerms ? (
                <button type="button" onClick={() => void openPhaseTwoTerms(payment)} disabled={phaseTwoTermsBusy}>Read &amp; accept Phase 2 terms</button>
              ) : payment.status === 'due' && requiresOriginalTerms ? (
                <button type="button" onClick={() => void openFranchiseTerms(payment)} disabled={franchiseTermsBusy}>Read &amp; accept terms</button>
              ) : payment.status === 'due' && !phaseThreeNeedsTerms && !phaseTwoNeedsTerms && !requiresOriginalTerms ? (
                <>
                  <div className="payment-coupon-box">
                    <label>Coupon code<input value={couponInputs[payment.key] ?? ''} onChange={(event) => setCouponInputs((current) => ({ ...current, [payment.key]: event.target.value.toUpperCase() }))} placeholder="Enter coupon code" /></label>
                    <div className="payment-coupon-actions">
                      <button type="button" className="secondary" disabled={couponBusy[payment.key]} onClick={() => void applyCoupon(payment)}>{couponBusy[payment.key] ? 'Checking…' : 'Apply coupon'}</button>
                      {appliedCoupons[payment.key] ? <button type="button" className="linkish" onClick={() => clearCoupon(payment.key)}>Remove</button> : null}
                    </div>
                    {appliedCoupons[payment.key] ? <div className="payment-coupon-summary"><span>Original {money(appliedCoupons[payment.key].original_amount)}</span><span>Discount -{money(appliedCoupons[payment.key].discount_amount)}</span><strong>Payable {money(appliedCoupons[payment.key].final_amount)}</strong></div> : null}
                    {couponErrors[payment.key] ? <p className="portal-message error" role="alert">{couponErrors[payment.key]}</p> : null}
                  </div>
                  <button
                    onClick={() => {
                      if (phaseThreeNeedsTerms) { void openPhaseThreeTerms(payment); return; }
                      if (phaseTwoNeedsTerms) { void openPhaseTwoTerms(payment); return; }
                      if (requiresOriginalTerms) { void openFranchiseTerms(payment); return; }
                      openPaymentFlow(payment);
                    }}
                    disabled={paymentBusy === payment.key}
                  >
                    {paymentBusy === payment.key ? 'Processing...' : `Proceed to pay ${money(payableAmount(payment))}`}
                  </button>
                </>
              ) : (
                <span>Locked</span>
              )}
            </div>
          </article>
        );
      })}
      {franchiseTermsError ? <p className="portal-message error" role="alert">{franchiseTermsError}</p> : null}
      {phaseTwoTermsError ? <p className="portal-message error" role="alert">{phaseTwoTermsError}</p> : null}
      {phaseThreeTermsError ? <p className="portal-message error" role="alert">{phaseThreeTermsError}</p> : null}
      {franchiseTermsOpen ? <FranchiseTermsModal title={`${application.franchise_model} franchise`} terms={franchiseTermsText} onClose={() => setFranchiseTermsOpen(false)} onAccept={() => void acceptFranchiseTerms()} /> : null}
      {phaseTwoTermsOpen ? <FranchiseTermsModal title="FOCO Phase 2" terms={phaseTwoTermsText} onClose={() => setPhaseTwoTermsOpen(false)} onAccept={() => void acceptPhaseTwoTerms()} /> : null}
      {phaseThreeTermsOpen ? <FranchiseTermsModal title="FOCO Phase 3" terms={phaseThreeTermsText} onClose={() => setPhaseThreeTermsOpen(false)} onAccept={() => void acceptPhaseThreeTerms()} /> : null}
      {methodModalOpen && selectedPayment ? <PaymentMethodModal
        payment={selectedPayment}
        focoFull={focoFullSelected}
        focoFullEligible={focoFullPaymentEligible(application)}
        focoFullTotal={focoFullPaymentTotal(application)}
        pricing={currentPricing(selectedPayment)}
        busy={Boolean(paymentBusy)}
        error={paymentFlowError}
        onClose={() => { setMethodModalOpen(false); setSelectedPayment(null); setPaymentFlowError(''); }}
        onSelect={handleSelectPaymentMethod}
        onToggleFocoFull={(next) => void handleToggleFocoFull(next)}
      /> : null}
      {offlineMethod && selectedPayment && (offlineMethod === 'cheque' || offlineMethod === 'bank_transfer') ? <OfflinePaymentModal
        method={offlineMethod}
        payment={selectedPayment}
        focoFull={focoFullSelected}
        couponCode={appliedCoupons[selectedPayment.key]?.code}
        busy={paymentBusy === 'offline'}
        error={paymentFlowError}
        onClose={() => { setOfflineMethod(''); setPaymentFlowError(''); setMethodModalOpen(true); }}
        onSubmit={submitOfflinePayment}
      /> : null}
      {gatewayOrder ? <GatewayCheckoutModal
        orderNumber={gatewayOrder.order_number}
        amount={gatewayOrder.amount}
        busy={paymentBusy === 'gateway-complete'}
        error={paymentFlowError}
        simulate={Boolean(gatewayOrder.simulate)}
        onCancel={() => { setGatewayOrder(null); setPaymentFlowError(''); if (selectedPayment) setMethodModalOpen(true); }}
        onComplete={() => void completeGatewayPayment()}
      /> : null}
    </section>
  );
}

function LegacyApplicantProfile({ application, paying, refreshing, onPay, onRefresh, onPaymentPage }: { application: Application; paying: string; refreshing: boolean; onPay: (payment: Payment) => void; onRefresh: () => void; onPaymentPage: () => void }) {
  const duePayment = application.payments.find((payment) => payment.status === 'due');
  return <section className="profile-page"><div className="profile-heading"><div><div className="page-eyebrow">Applicant profile</div><h1>Track your franchise application.</h1><p>{stageLabel(application.stage)}</p></div><button className="refresh-profile" type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing...' : 'Refresh status'}</button></div><div className="application-summary"><div><span>Applicant</span><b>{application.full_name}</b></div><div><span>Franchise model</span><b>{application.franchise_model}</b></div><div><span>Preferred location</span><b>{application.preferred_location}</b></div></div><section className="profile-next-action"><div><span>Current next action</span><h2>{duePayment ? duePayment.label : stageLabel(application.stage)}</h2><p>{duePayment ? `${money(duePayment.amount)} is ready for payment.` : 'The Remedium Lab team will update this profile as your application progresses.'}</p></div>{duePayment ? <button type="button" onClick={onPaymentPage}>Continue to payment</button> : null}</section><section className="progress-card"><div className="progress-card-heading"><div><h2>Application progress</h2><p>Your current process and approvals are shown below.</p></div><b>{application.application_number}</b></div><ol className="application-progress">{profileSteps(application).map((step, index) => <li className={step.complete ? 'complete' : step.active ? 'active' : ''} key={step.label}><span>{step.complete ? '✓' : index + 1}</span><b>{step.label}</b></li>)}</ol></section><PaymentSchedule application={application} /><section className="kyc-profile"><div><h2>KYC documents</h2><p>All required documents are securely attached to your application.</p></div><b>{Object.keys(application.documents).length}/4 uploaded</b></section><p className="payment-note">Choose Cheque, UPI/card or bank transfer. Offline submissions move to Under Verification until RFMS confirms payment.</p></section>;
}
type DashboardSection = 'overview' | 'application' | 'documents' | 'territory' | 'video-kyc' | 'payments' | 'agreement' | 'training' | 'support' | 'profile-settings';

function ApplicantProfileSettings({
  application,
  token,
  photoUrl,
  onBack,
  onApplicationUpdated,
}: {
  application: Application;
  token: string;
  photoUrl?: string;
  onBack: () => void;
  onApplicationUpdated: (application: Application) => void;
}) {
  const [userId, setUserId] = useState(application.user_id ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setUserId(application.user_id ?? '');
  }, [application.user_id]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, string> = { current_password: currentPassword };
      const trimmedUserId = userId.trim().toLowerCase();
      if (trimmedUserId && trimmedUserId !== (application.user_id ?? '').toLowerCase()) payload.user_id = trimmedUserId;
      if (newPassword || confirmPassword) {
        payload.new_password = newPassword;
        payload.confirm_password = confirmPassword;
      }
      const response = await fetch(`${API_BASE}/applicant/account/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; data?: { application?: Application; message?: string }; error?: { message?: string } } | null;
      if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? 'Unable to update your profile.');
      if (result.data?.application) onApplicationUpdated(result.data.application);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage(result.data?.message ?? 'Your profile has been updated successfully.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update your profile.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-detail-panel profile-settings-panel">
      <div className="dashboard-detail-heading">
        <div>
          <p>Account</p>
          <h1>Update profile</h1>
          <span>Change your applicant user ID or password. Email and mobile number can only be updated by your franchise manager.</span>
        </div>
        <button type="button" className="profile-settings-back" onClick={onBack}>Back to dashboard</button>
      </div>
      <div className="profile-settings-identity">
        <span className="profile-settings-avatar">{photoUrl ? <img src={photoUrl} alt="" /> : <DefaultProfileAvatar />}</span>
        <div>
          <b>{application.full_name}</b>
          <small>{application.application_number}</small>
        </div>
      </div>
      <dl className="profile-settings-readonly">
        <div><dt>Registered email</dt><dd>{application.email}</dd><small>Updated only by your franchise manager.</small></div>
        <div><dt>Registered mobile</dt><dd>{application.mobile}</dd><small>Updated only by your franchise manager.</small></div>
      </dl>
      <form className="profile-settings-form" onSubmit={(event) => void saveProfile(event)}>
        <section>
          <h2>Applicant user ID</h2>
          <p>Use 4-40 lowercase letters, numbers, dots, underscores or hyphens.</p>
          <label>User ID<input required value={userId} autoComplete="username" onChange={(event) => setUserId(event.target.value.toLowerCase())} placeholder="your.user.id" /></label>
        </section>
        <section>
          <h2>Change password</h2>
          <p>Your current password is required before any profile change is saved.</p>
          <label>Current password<input required type="password" value={currentPassword} autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Enter current password" /></label>
          <label>New password<input minLength={8} type="password" value={newPassword} autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} placeholder="Minimum 8 characters" /></label>
          <label>Confirm new password<input minLength={8} type="password" value={confirmPassword} autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat new password" /></label>
        </section>
        {message ? <p className="portal-message success" role="status">{message}</p> : null}
        {error ? <p className="portal-message error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? 'Saving changes...' : 'Save profile changes'}</button>
      </form>
    </section>
  );
}

function DefaultProfileAvatar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.01 0-9 1.51-9 4.5v1.5h18v-1.5c0-2.99-5.99-4.5-9-4.5Z" fill="currentColor" />
    </svg>
  );
}

function ApplicantDocumentsPanel({ application, token, uploading, onReplaceDocument, onApplicationUpdated }: { application: Application; token: string; uploading: DocumentKey | null; onReplaceDocument: (key: DocumentKey, event: ChangeEvent<HTMLInputElement>) => void; onApplicationUpdated: (application: Application) => void }) {
  const [uploadingOnboarding, setUploadingOnboarding] = useState('');
  const [onboardingError, setOnboardingError] = useState('');
  const [onboardingNotice, setOnboardingNotice] = useState('');
  async function uploadOnboardingDocument(request: OnboardingDocument, slot: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const busyKey = `${request.id}:${slot}`;
    setUploadingOnboarding(busyKey); setOnboardingError(''); setOnboardingNotice('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file no larger than 5 MB.');
      const dataUrl = await asDataUrl(file);
      const response = await fetch(`${API_BASE}/applicant/onboarding-documents/${request.id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, name: file.name, data_url: dataUrl }) });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to upload this onboarding document.');
      onApplicationUpdated(payload.data); setOnboardingNotice(`${request.title} - file ${slot} uploaded for review.`);
    } catch (uploadError) { setOnboardingError(uploadError instanceof Error ? uploadError.message : 'Unable to upload this onboarding document.'); }
    finally { setUploadingOnboarding(''); }
  }
  return <div className="dashboard-document-list">{DOCUMENTS.map((item) => {
    const document = application.documents[item.key];
    const documentStatus = application.document_verifications?.[item.key]?.status;
    const isVerified = documentStatus === 'verified';
    const uploadAgainRequested = documentStatus === 'upload_requested';
    const status = isVerified ? 'Verified' : uploadAgainRequested ? 'Upload again required' : document ? 'Under review' : 'Missing';
    const statusClass = isVerified ? 'verified' : uploadAgainRequested ? 'upload-requested' : 'pending';

    return <div key={item.key} className={uploadAgainRequested ? 'reupload-requested' : ''}>
      <span className={isVerified ? 'ready' : ''}>{isVerified ? '✓' : uploadAgainRequested ? '!' : '○'}</span>
      <div><b>{item.title}</b><small>{document ? document.name : 'Not uploaded'}</small></div>
      <em className={statusClass}>{status}</em>
      {document && uploadAgainRequested ? <label className="document-reupload">{uploading === item.key ? 'Uploading...' : 'Upload again'}<input type="file" accept={item.accept} disabled={uploading !== null} onChange={(event) => onReplaceDocument(item.key, event)} /></label> : null}
    </div>;
  })}<section className="onboarding-document-section"><div className="onboarding-document-heading"><div><p>Franchisee onboarding documents</p><h2>Additional documents requested by your manager</h2><span>These requirements are specific to your franchise application. Upload each requested file for individual review.</span></div><b>{(application.onboarding_documents ?? []).length} request{(application.onboarding_documents ?? []).length === 1 ? '' : 's'}</b></div>{!(application.onboarding_documents ?? []).length ? <div className="onboarding-empty">No additional onboarding documents have been requested yet.</div> : <div className="onboarding-document-requests">{(application.onboarding_documents ?? []).map((request) => <article key={request.id}><header><div><h3>{request.title}</h3><p>{request.description || 'Upload the requested supporting document for manager verification.'}</p></div><span>{request.required_count} file{request.required_count === 1 ? '' : 's'} required</span></header><div className="onboarding-file-list">{Array.from({ length: request.required_count }, (_, index) => index + 1).map((slot) => { const file = [...request.files].reverse().find((item) => item.slot === slot && item.status !== 'superseded'); const canUpload = !file || file.status === 'reupload_requested'; const busy = uploadingOnboarding === `${request.id}:${slot}`; const status = !file ? 'Not uploaded' : file.status === 'verified' ? 'Verified' : file.status === 'reupload_requested' ? 'Upload again requested' : file.status === 'rejected' ? 'Rejected' : 'Under review'; return <div className={`onboarding-file ${file?.status ?? 'missing'}`} key={slot}><div><b>File {slot}</b><small>{file?.name || 'No file uploaded'}</small>{file?.remarks ? <em>Manager note: {file.remarks}</em> : null}</div><span>{status}</span>{file?.url ? <a href={file.url} target="_blank" rel="noreferrer">View file</a> : null}{canUpload ? <label className="document-reupload">{busy ? 'Uploading...' : file ? 'Upload again' : 'Choose file'}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => void uploadOnboardingDocument(request, slot, event)} /></label> : null}</div>; })}</div></article>)}</div>}{onboardingNotice ? <p className="portal-message success" role="status">{onboardingNotice}</p> : null}{onboardingError ? <p className="portal-message error" role="alert">{onboardingError}</p> : null}</section></div>;
}

function ApplicantFieldVisitCard({ application, token }: { application: Application; token: string }) {
  const visit = application.field_visit;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!visit) return null;
  async function downloadReport() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/field-visit/report`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message ?? 'Unable to download the Field Visit report.'); }
      const file = await response.blob(); const url = window.URL.createObjectURL(file); const link = document.createElement('a');
      link.href = url; link.download = `Remedium-Lab-Field-Visit-${application.application_number}.pdf`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : 'Unable to download the Field Visit report.'); }
    finally { setBusy(false); }
  }
  const status = visit.status === 'approved' ? 'Approved final report' : visit.status === 'submitted' ? 'Officer report submitted' : visit.status === 'rejected' ? 'Report correction requested' : 'Field Visit assigned';
  const sitePhotos = visit.report?.site_photos ?? [];
  return <section className={`applicant-field-visit ${visit.status}`}><div><p>Field Visit</p><h2>{status}</h2><span>{visit.status === 'assigned' ? 'A Field Visit Officer has been assigned to support the next verification stage.' : visit.status === 'approved' ? 'The manager has approved the final report. It is permanently linked to your application.' : 'The franchise team is reviewing the Field Visit report and will update this page.'}</span></div><div className="field-visit-officer"><small>Assigned Field Visit Officer</small><b>{visit.officer_name}</b><a href={`tel:${visit.officer_phone.replace(/[^+0-9]/g, '')}`}>{visit.officer_phone}</a>{visit.assigned_at ? <em>Assigned {new Date(visit.assigned_at).toLocaleDateString('en-IN')}</em> : null}</div>{visit.status === 'approved' && sitePhotos.length ? <div className="applicant-branding-photos">{sitePhotos.map((photo) => <a key={photo.id || photo.url} href={resolveUploadUrl(photo.url)} target="_blank" rel="noreferrer"><img src={resolveUploadUrl(photo.url)} alt={photo.name} /><span>{photo.name}</span></a>)}</div> : null}{visit.status === 'approved' ? <button type="button" onClick={() => void downloadReport()} disabled={busy}>{busy ? 'Preparing report...' : 'Download final Field Visit PDF'}</button> : null}{error ? <p className="portal-message error" role="alert">{error}</p> : null}</section>;
}

function ApplicantBrandingAndHr({ application }: { application: Application }) {
  const branding = application.branding_signage; const hr = application.hr_process;
  if (branding?.status !== 'approved' && hr?.status !== 'approved') return null;
  return <div className="applicant-post-allotment-workflow">{branding?.status === 'approved' ? <section className="applicant-branding-card"><div className="applicant-workflow-heading"><div><p>Branding Signage</p><h2>Approved branding installation</h2><span>{branding.completion_details || 'The franchise branding installation has been verified by the Remedium Lab team.'}</span></div><b>Approved</b></div>{branding.photographs?.length ? <div className="applicant-branding-photos">{branding.photographs.map((photo) => <a key={photo.id || photo.url} href={resolveUploadUrl(photo.url)} target="_blank" rel="noreferrer"><img src={resolveUploadUrl(photo.url)} alt={photo.name} /><span>{photo.name}</span></a>)}</div> : null}<div className="applicant-workflow-links">{branding.invoice ? <a href={resolveUploadUrl(branding.invoice.url)} target="_blank" rel="noreferrer">Download final branding invoice</a> : null}{branding.manager_remarks ? <small>Manager note: {branding.manager_remarks}</small> : null}</div></section> : null}{hr?.status === 'approved' ? <section className="applicant-hr-card"><div className="applicant-workflow-heading"><div><p>HR Process</p><h2>Your assigned franchise team</h2><span>Approved employee onboarding records and Offer Letters are permanently linked to your franchise application.</span></div><b>{hr.employees?.length ?? 0} assigned</b></div><div className="applicant-hr-employees">{hr.employees?.map((employee) => <article key={employee.id}><b>{employee.name}</b><span>{employee.designation}</span><small>{employee.phone} · joining {employee.joining_date}</small>{employee.details ? <p>{employee.details}</p> : null}{employee.offer_letter ? <a href={resolveUploadUrl(employee.offer_letter.url)} target="_blank" rel="noreferrer">View Offer Letter</a> : null}</article>)}</div>{hr.manager_remarks ? <small className="applicant-manager-note">Manager note: {hr.manager_remarks}</small> : null}</section> : null}</div>;
}

function ApplicantTerritoryPanel({ application, token }: { application: Application; token: string }) {
  const allotment = application.territory_allotment ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dateLabel = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); };
  async function downloadLetter() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/territory-allotment/report`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message ?? 'Unable to download the Territory Allotment Letter.'); }
      const file = await response.blob(); const url = window.URL.createObjectURL(file); const link = document.createElement('a');
      link.href = url; link.download = `Remedium-Lab-Territory-Allotment-${application.application_number}.pdf`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : 'Unable to download the Territory Allotment Letter.'); }
    finally { setBusy(false); }
  }
  if (!allotment) return <div className="dashboard-status-card"><b>{application.preferred_location}</b><span>Your preferred franchise territory</span><p>Territory availability is being checked by the Remedium franchise team. Your final allotted territory and official letter will appear here after the Field Visit is approved.</p></div>;
  return <div className="applicant-territory-allotment"><section className="applicant-territory-letter"><div><p>Official territory allotment</p><h2>{allotment.final_territory}</h2><span>Your approved franchise territory is active from {dateLabel(allotment.effective_date)}.</span></div><button type="button" disabled={busy} onClick={() => void downloadLetter()}>{busy ? 'Preparing letter...' : 'Download Territory Allotment Letter'}</button></section><div className="applicant-territory-details"><div><small>Territory radius</small><b>{allotment.radius_km} km</b></div><div><small>PIN code</small><b>{allotment.pincode}</b></div><div><small>District / State</small><b>{allotment.district}, {allotment.state}</b></div><div><small>Letter reference</small><b>{allotment.letter_number}</b></div></div><section className="applicant-territory-address"><small>Allotted franchise location</small><b>{allotment.franchise_address || [application.address, application.city, application.district, application.pincode].filter(Boolean).join(', ') || 'Recorded in your application'}</b>{allotment.google_maps_url ? <a href={allotment.google_maps_url} target="_blank" rel="noreferrer">Open approved Google Maps location</a> : null}</section>{(application.territory_allotments ?? []).length > 1 ? <section className="applicant-territory-history"><b>Allotment letter history</b>{[...(application.territory_allotments ?? [])].reverse().map((item) => <span key={item.id}>Version {item.version}  · {item.letter_number}  · issued {dateLabel(item.issued_at)}</span>)}</section> : null}{error ? <p className="portal-message error" role="alert">{error}</p> : null}</div>;
}

function attachApplicantVideo(video: HTMLVideoElement | null, stream: MediaStream | null) {
  if (!video || !stream) return;
  if (video.srcObject !== stream) video.srcObject = stream;
  void video.play().catch(() => undefined);
}

function ApplicantVideoKycPanel({ application, token, onApplicationUpdated }: { application: Application; token: string; onApplicationUpdated: (application: Application) => void }) {
  const sessions = [...(application.video_kyc_sessions ?? [])].sort((first, second) => second.attempt - first.attempt);
  const current = sessions.find((session) => session.id === application.video_kyc_current_session_id) ?? sessions.find((session) => ['assigned', 'in_progress'].includes(session.status)) ?? sessions[0] ?? null;
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const processedSignals = useRef(new Set<string>());
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reportingId, setReportingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const currentId = current?.id ?? '';
  const currentStatus = current?.status ?? '';

  const stopRoom = useCallback(() => {
    peerRef.current?.close(); peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    remoteStreamRef.current = null;
    processedSignals.current = new Set();
    pendingCandidates.current = [];
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setLive(false);
  }, []);
  useEffect(() => () => stopRoom(), [stopRoom]);
  useEffect(() => {
    attachApplicantVideo(localVideoRef.current, streamRef.current);
    attachApplicantVideo(remoteVideoRef.current, remoteStreamRef.current);
  }, [live]);

  const sendSignal = useCallback(async (type: 'answer' | 'candidate', signal: object) => {
    if (!currentId) return;
    const response = await fetch(`${API_BASE}/video-kyc/${currentId}/signals`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type, signal }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to connect Video KYC call.');
  }, [currentId, token]);

  const processSignal = useCallback(async (entry: { id: string; type: string; signal: unknown }) => {
    if (processedSignals.current.has(entry.id) || !peerRef.current) return;
    processedSignals.current.add(entry.id);
    const peer = peerRef.current;
    if (entry.type === 'offer') {
      if (peer.signalingState !== 'stable' && peer.signalingState !== 'have-remote-offer') return;
      await peer.setRemoteDescription(entry.signal as RTCSessionDescriptionInit);
      for (const candidate of pendingCandidates.current.splice(0)) await peer.addIceCandidate(candidate);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendSignal('answer', answer);
      attachApplicantVideo(localVideoRef.current, streamRef.current);
      attachApplicantVideo(remoteVideoRef.current, remoteStreamRef.current);
    } else if (entry.type === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(entry.signal as RTCIceCandidateInit); else pendingCandidates.current.push(entry.signal as RTCIceCandidateInit);
    }
  }, [sendSignal]);

  useEffect(() => {
    if (!live || !currentId || currentStatus !== 'in_progress') return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/video-kyc/${currentId}/signals`, { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => null) as { success?: boolean; data?: { signals?: { id: string; type: string; signal: unknown }[]; session?: VideoKycSession } } | null;
        if (!active || !response.ok || !payload?.success) return;
        for (const signal of payload.data?.signals ?? []) await processSignal(signal);
        attachApplicantVideo(localVideoRef.current, streamRef.current);
        attachApplicantVideo(remoteVideoRef.current, remoteStreamRef.current);
      } catch { /* Keep trying while this applicant Video KYC page remains open. */ }
    };
    void poll(); const interval = window.setInterval(() => void poll(), 1200);
    return () => { active = false; window.clearInterval(interval); };
  }, [currentId, currentStatus, live, processSignal, token]);

  useEffect(() => {
    if (!currentId || !['assigned', 'in_progress'].includes(currentStatus)) return;
    let active = true;
    const syncSessionStatus = async () => {
      try {
        const response = await fetch(`${API_BASE}/applicant/profile`, { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application } | null;
        const latestApplication = payload?.data;
        const latestSession = latestApplication?.video_kyc_sessions?.find((session) => session.id === currentId);
        if (!active || !response.ok || !payload?.success || !latestApplication || !latestSession) return;
        const currentAttemptChanged = latestApplication.video_kyc_current_session_id !== application.video_kyc_current_session_id;
        if (latestSession.status === currentStatus && !currentAttemptChanged) return;
        onApplicationUpdated(latestApplication);
        // Only end the live call when THIS joined session closes — not when an older attempt was reassigned.
        if (live && !['assigned', 'in_progress'].includes(latestSession.status)) {
          stopRoom();
          setNotice(latestSession.status === 'completed' ? 'Video KYC was completed by the manager. The live call has ended.' : 'This Video KYC attempt was reassigned by the manager. The live call has ended; wait for the next request.');
        }
      } catch { /* Keep checking while the applicant keeps this active Video KYC page open. */ }
    };
    void syncSessionStatus();
    const interval = window.setInterval(() => void syncSessionStatus(), 3000);
    return () => { active = false; window.clearInterval(interval); };
  }, [application.video_kyc_current_session_id, currentId, currentStatus, live, onApplicationUpdated, stopRoom, token]);

  async function joinRoom() {
    if (!current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${API_BASE}/applicant/video-kyc/${current.id}/join`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { application?: Application }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.application) throw new Error(payload?.error?.message ?? 'The manager has not started this Video KYC session yet.');
      onApplicationUpdated(payload.data.application);
      processedSignals.current = new Set();
      pendingCandidates.current = [];
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      streamRef.current = media;
      const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
      peerRef.current = peer;
      media.getTracks().forEach((track) => peer.addTrack(track, media));
      peer.ontrack = (event) => {
        const remote = event.streams[0] || new MediaStream([event.track]);
        remoteStreamRef.current = remote;
        attachApplicantVideo(remoteVideoRef.current, remote);
      };
      peer.onicecandidate = (event) => { if (event.candidate) void sendSignal('candidate', event.candidate.toJSON()).catch(() => undefined); };
      // Mount <video> elements first, then attach streams on the next frame.
      setLive(true);
      window.requestAnimationFrame(() => {
        attachApplicantVideo(localVideoRef.current, media);
        attachApplicantVideo(remoteVideoRef.current, remoteStreamRef.current);
      });
    } catch (joinError) { stopRoom(); setError(joinError instanceof Error ? joinError.message : 'Unable to join Video KYC.'); }
    finally { setBusy(false); }
  }

  async function downloadVideoKycReport(session: VideoKycSession) {
    setReportingId(session.id); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/video-kyc/${session.id}/report`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? 'Unable to create the Video KYC report.');
      }
      const report = await response.blob();
      const url = window.URL.createObjectURL(report);
      const download = document.createElement('a');
      download.href = url;
      download.download = `Remedium-Lab-Video-KYC-${application.application_number}-attempt-${session.attempt}.pdf`;
      document.body.appendChild(download); download.click(); download.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
      setNotice(`Video KYC report for attempt ${session.attempt} downloaded.`);
    } catch (reportError) { setError(reportError instanceof Error ? reportError.message : 'Unable to download the Video KYC report.'); }
    finally { setReportingId(''); }
  }

  if (!current) return <div className="dashboard-status-card"><b>Video KYC will appear here when assigned</b><span>Waiting for manager assignment</span><p>Your applicant profile will show the request after the franchise team has verified all required KYC documents.</p></div>;
  return <div className="applicant-video-kyc"><div className="applicant-video-kyc-current"><div><span className={`applicant-video-status ${current.status}`}>{current.status === 'in_progress' ? 'Live request' : current.status === 'assigned' ? 'Assigned' : current.status === 'completed' ? 'Completed' : 'Reassigned'}</span><h2>Video KYC attempt {current.attempt}</h2><p>{current.status === 'assigned' ? 'Your Video KYC request is assigned. The manager will start the secure call; return here and select Join when it is live.' : current.status === 'in_progress' ? 'The manager has started the secure Video KYC session. Join using your camera and microphone.' : current.status === 'completed' ? 'Your Video KYC has been completed. Download the final report with the manager remarks and retained evidence below.' : 'This attempt was reassigned. A new Video KYC request will appear in the next active attempt.'}</p></div>{current.status === 'in_progress' && !live ? <button className="applicant-video-join" type="button" disabled={busy} onClick={() => void joinRoom()}>{busy ? 'Joining…' : 'Join Video KYC'}</button> : current.status === 'completed' ? <button className="applicant-video-report" type="button" disabled={reportingId === current.id} onClick={() => void downloadVideoKycReport(current)}>{reportingId === current.id ? 'Preparing report…' : 'Download Video KYC report'}</button> : null}</div>{live ? <div className="applicant-video-room"><div className="applicant-video-grid"><figure><video ref={localVideoRef} autoPlay muted playsInline /><figcaption>Your camera</figcaption></figure><figure><video ref={remoteVideoRef} autoPlay playsInline /><figcaption>Manager camera</figcaption></figure></div><p>Keep this page open during verification. The manager records any required evidence and closes the session when completed.</p><button type="button" className="applicant-video-leave" onClick={stopRoom}>Leave local camera preview</button></div> : null}{notice ? <p className="portal-message success" role="status">{notice}</p> : null}{error ? <p className="portal-message error" role="alert">{error}</p> : null}<section className="applicant-video-history"><div><h3>Video KYC history</h3><span>{sessions.length} attempt{sessions.length === 1 ? '' : 's'} retained</span></div>{sessions.map((session) => <article key={session.id}><div><b>Attempt {session.attempt} · {session.status.replace('_', ' ')}</b><small>{session.completed_at ? `Closed ${new Date(session.completed_at).toLocaleString('en-IN')}` : `Assigned ${new Date(session.assigned_at).toLocaleString('en-IN')}`}</small>{session.remarks ? <p>{session.remarks}</p> : null}</div><div className="applicant-video-evidence"><em>{session.screenshots.length} evidence image{session.screenshots.length === 1 ? '' : 's'}</em>{session.screenshots.length ? <div>{session.screenshots.map((shot, index) => <a key={shot.id} href={shot.url} target="_blank" rel="noreferrer">View {index + 1}</a>)}</div> : null}{session.status === 'completed' ? <button className="applicant-video-report secondary" type="button" disabled={reportingId === session.id} onClick={() => void downloadVideoKycReport(session)}>{reportingId === session.id ? 'Preparing…' : 'Download report PDF'}</button> : null}</div></article>)}</section></div>;
}

function AgreementDocumentViewer({ url, title = 'Franchise agreement', token = '', secured = false, lockActions = false }: { url?: string | null; title?: string; token?: string; secured?: boolean; lockActions?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewerError, setViewerError] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(100);
  const adjustZoom = (delta: number) => setZoom((current) => Math.min(200, Math.max(50, current + delta)));
  const toolbar = <div className="agreement-viewer-toolbar">
    <button type="button" aria-label="Zoom out" onClick={() => adjustZoom(-10)}>−</button>
    <span>{zoom}%</span>
    <button type="button" aria-label="Zoom in" onClick={() => adjustZoom(10)}>+</button>
    <button type="button" onClick={() => setZoom(100)}>Reset</button>
  </div>;

  useEffect(() => {
    if (!secured || !url || !token) {
      setPageCount(0);
      setViewerError('');
      pagesRef.current?.replaceChildren();
      return;
    }

    let cancelled = false;

    async function renderPdf() {
      setLoading(true);
      setViewerError('');
      setPageCount(0);
      pagesRef.current?.replaceChildren();
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = appPath('/pdf.worker.min.mjs');
        const response = await fetch(url as string, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error('Unable to load the agreement document.');
        const bytes = await response.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled || !pagesRef.current) return;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled || !pagesRef.current) return;
          const viewport = page.getViewport({ scale: 1.35 * (zoom / 100) });
          const canvas = document.createElement('canvas');
          canvas.className = 'agreement-pdf-page';
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.oncontextmenu = (event) => event.preventDefault();
          canvas.ondragstart = (event) => event.preventDefault();
          const context = canvas.getContext('2d');
          if (!context) continue;
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          pagesRef.current.appendChild(canvas);
        }

        if (!cancelled) setPageCount(pdf.numPages);
      } catch (loadError) {
        if (!cancelled) setViewerError(loadError instanceof Error ? loadError.message : 'Unable to load the agreement document.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void renderPdf();
    return () => {
      cancelled = true;
      pagesRef.current?.replaceChildren();
    };
  }, [url, secured, token, zoom]);

  useEffect(() => {
    if (!lockActions) return;
    const node = containerRef.current;
    if (!node) return;

    function insideViewer(target: EventTarget | null) {
      return target instanceof Node && node?.contains(target);
    }

    function blockContextMenu(event: Event) {
      if (!insideViewer(event.target)) return;
      event.preventDefault();
    }

    function blockClipboard(event: ClipboardEvent) {
      if (!insideViewer(event.target)) return;
      event.preventDefault();
    }

    function blockSelection(event: Event) {
      if (!insideViewer(event.target)) return;
      event.preventDefault();
    }

    function blockShortcuts(event: KeyboardEvent) {
      if (!insideViewer(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'f12' || key === 'printscreen') {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (['p', 's', 'u', 'c', 'a', 'x', 'v'].includes(key)) event.preventDefault();
        if (event.shiftKey && ['i', 'j', 'c', 'p', 's'].includes(key)) event.preventDefault();
      }
    }

    node.addEventListener('contextmenu', blockContextMenu);
    node.addEventListener('copy', blockClipboard);
    node.addEventListener('cut', blockClipboard);
    node.addEventListener('paste', blockClipboard);
    node.addEventListener('selectstart', blockSelection);
    node.addEventListener('dragstart', blockSelection);
    document.addEventListener('contextmenu', blockContextMenu);
    document.addEventListener('copy', blockClipboard);
    document.addEventListener('cut', blockClipboard);
    document.addEventListener('keydown', blockShortcuts);
    return () => {
      node.removeEventListener('contextmenu', blockContextMenu);
      node.removeEventListener('copy', blockClipboard);
      node.removeEventListener('cut', blockClipboard);
      node.removeEventListener('paste', blockClipboard);
      node.removeEventListener('selectstart', blockSelection);
      node.removeEventListener('dragstart', blockSelection);
      document.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('copy', blockClipboard);
      document.removeEventListener('cut', blockClipboard);
      document.removeEventListener('keydown', blockShortcuts);
    };
  }, [lockActions, pageCount]);

  if (!url) return null;

  if (!secured) {
    const viewerUrl = `${url}${url.includes('#') ? '' : '#toolbar=0&navpanes=0&view=FitH'}`;
    return <div className="agreement-document-viewer">
      {toolbar}
      <div className="agreement-document-scroll">
        <div className="agreement-document-zoom" style={{ width: `${zoom}%` }}>
          <iframe className="agreement-document-frame" src={viewerUrl} title={title} style={{ height: `${Math.round(520 * zoom / 100)}px` }} />
        </div>
      </div>
    </div>;
  }

  return <div ref={containerRef} className={`agreement-document-viewer secured${lockActions ? ' locked' : ''}`} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()}>
    {toolbar}
    {lockActions ? <div className="agreement-viewer-watermark" aria-hidden="true">Remedium Lab · View only</div> : null}
    {loading ? <p className="agreement-viewer-empty">Loading agreement pages…</p> : null}
    {viewerError ? <p className="agreement-viewer-empty" role="alert">{viewerError}</p> : null}
    {!loading && !viewerError && pageCount === 0 ? <p className="agreement-viewer-empty">Preparing agreement preview…</p> : null}
    <div className="agreement-pdf-pages" ref={pagesRef} />
  </div>;
}

function ApplicantTrainingPanel({ application, token, onApplicationUpdated }: { application: Application; token: string; onApplicationUpdated: (application: Application) => void }) {
  const training = application.training;
  const [busyVideoId, setBusyVideoId] = useState('');
  const [busyCertificate, setBusyCertificate] = useState(false);
  const [error, setError] = useState('');
  const progress = training?.progress ?? { total: 0, completed: 0, percent: 0 };
  const certificate = training?.certificate ?? null;

  async function completeVideo(videoId: string) {
    setBusyVideoId(videoId);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/training/videos/${encodeURIComponent(videoId)}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to mark this training video as finished.');
      onApplicationUpdated(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to mark this training video as finished.');
    } finally {
      setBusyVideoId('');
    }
  }

  async function downloadCertificate() {
    setBusyCertificate(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/training/certificate`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('The training completion certificate becomes available after all assigned videos are finished.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = certificate?.pdf?.name || `Training-Certificate-${application.application_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to download the training completion certificate.');
    } finally {
      setBusyCertificate(false);
    }
  }

  if (!training?.unlocked) {
    return <div className="applicant-training-panel locked"><div className="dashboard-status-card"><b>Training not unlocked yet</b><span>Franchisee training</span><p>Mandatory training modules appear here after your final agreement is executed and the RFMS manager unlocks training for your application.</p></div></div>;
  }

  return <div className="applicant-training-panel">
    <div className="training-progress-card"><div><span>Training progress</span><b>{progress.percent}% complete</b></div><div className="training-progress-bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress.percent}%` }} /></div><small>{progress.completed} of {progress.total} assigned module{progress.total === 1 ? '' : 's'} finished</small></div>
    <div className="training-video-list">{training.videos.map((video) => {
      const isYoutube = video.mime === 'video/youtube' || /youtube\.com|youtu\.be/i.test(video.video_url);
      return <article key={video.id} className={video.completed ? 'completed' : video.accessible ? 'active' : 'locked'}>
        <header><div><span>Module {video.sequence}</span><b>{video.title}</b>{video.description ? <p>{video.description}</p> : null}{video.duration_minutes ? <small>{video.duration_minutes} minutes</small> : null}</div><span>{video.completed ? 'Finished' : video.accessible ? 'Available' : 'Locked'}</span></header>
        {video.accessible && !video.completed && video.video_url ? (isYoutube ? <iframe title={video.title} src={video.video_url} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : <video controls preload="metadata" src={video.video_url} />) : null}
        {video.accessible && !video.completed ? <button type="button" disabled={busyVideoId === video.id} onClick={() => void completeVideo(video.id)}>{busyVideoId === video.id ? 'Saving…' : 'Mark as finished'}</button> : null}
        {video.completed ? <p className="training-video-complete-note">Completed{video.completed_at ? ` on ${new Date(video.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.</p> : null}
        {!video.accessible && video.locked_reason ? <p className="training-video-lock-note">{video.locked_reason}</p> : null}
      </article>;
    })}</div>
    {certificate?.pdf?.url ? <div className="training-certificate-card"><div><b>Training completion certificate ready</b><span>{certificate.certificate_number} · {certificate.business_name}</span><a href={certificate.verification_url} target="_blank" rel="noreferrer">Verify certificate authenticity</a></div><button type="button" disabled={busyCertificate} onClick={() => void downloadCertificate()}>{busyCertificate ? 'Preparing…' : 'Download Training Completion Certificate'}</button></div> : progress.total > 0 && progress.completed === progress.total ? <div className="training-certificate-pending"><b>All training modules finished</b><p>Your manager will review your progress and issue the training completion certificate. The download option will appear here once it is issued.</p></div> : null}
    {error ? <p className="portal-message error" role="alert">{error}</p> : null}
  </div>;
}

function ApplicantAgreementPanel({ application, token, onApplicationUpdated, onEsignCompleted }: { application: Application; token: string; onApplicationUpdated: (application: Application) => void; onEsignCompleted?: (message: string) => void }) {
  const workflow = application.agreement_workflow;
  const status = workflow?.status ?? 'not_started';
  const statusLabel = agreementStatusForApplicant(application);
  const permissions = workflow?.permissions;
  const agreementExecuted = Boolean(permissions?.can_download);
  const canDownloadExecuted = agreementExecuted;
  const viewUrl = permissions?.can_view ? `${API_BASE}/applicant/agreement/view` : '';
  const correctionDecision = workflow?.applicant?.correction_decision ?? '';
  const correctionActive = status === 'correction_requested';
  const showAgreementDocument = permissions?.can_view && viewUrl && !correctionActive;
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [correction, setCorrection] = useState('');
  const [agreementTerms, setAgreementTerms] = useState('');
  const [termsOpen, setTermsOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [invitationLink, setInvitationLink] = useState('');
  const [otpHint, setOtpHint] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const esignReturnHandled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/applicant/agreement/terms`, { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => null) as { success?: boolean; data?: { terms_text?: string } } | null;
        if (!cancelled && response.ok && payload?.success && payload.data?.terms_text) setAgreementTerms(payload.data.terms_text);
      } catch {
        /* Keep the last loaded terms if the refresh fails temporarily. */
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (esignReturnHandled.current || !token) return;
    const params = new URLSearchParams(window.location.search);
    let resume = params.get('esign_return') === '1';
    if (!resume) {
      try {
        const raw = window.sessionStorage.getItem('rfms_esign_resume');
        if (raw) {
          const parsed = JSON.parse(raw) as { at?: number };
          resume = Boolean(parsed?.at && Date.now() - Number(parsed.at) < 6 * 60 * 60 * 1000);
        }
      } catch {
        resume = false;
      }
    }
    if (!resume) return;
    if (!['sent_to_applicant', 'applicant_esign_completed', 'company_dsc_completed', 'company_execution_pending', 'executed'].includes(status)) return;
    esignReturnHandled.current = true;
    let cancelled = false;
    void (async () => {
      setBusy('verify');
      setError('');
      try {
        if (status === 'sent_to_applicant') {
          const response = await fetch(`${API_BASE}/applicant/agreement/esign/complete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
          if (!response.ok || !payload?.success || !payload.data) {
            throw new Error(payload?.error?.message ?? 'Unable to finalise Aadhaar eSign after provider return.');
          }
          if (!cancelled) {
            onApplicationUpdated(payload.data);
            onEsignCompleted?.('Aadhaar eSign completed. Your signed agreement is with the franchise manager for company DSC or manual signing.');
          }
        } else if (!cancelled) {
          onEsignCompleted?.('Aadhaar eSign is already recorded. The franchise manager can complete company DSC or manual signing.');
        }
        try { window.sessionStorage.removeItem('rfms_esign_resume'); } catch { /* ignore */ }
        const url = new URL(window.location.href);
        ['esign_return', 'esign_ref', 'application'].forEach((key) => url.searchParams.delete(key));
        url.searchParams.set('view', 'profile');
        url.searchParams.set('section', 'agreement');
        window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to finalise Aadhaar eSign after provider return.');
      } finally {
        if (!cancelled) setBusy('');
      }
    })();
    return () => { cancelled = true; };
  }, [token, status, onApplicationUpdated, onEsignCompleted]);

  function openTermsModal() {
    setTermsOpen(true);
  }

  function confirmTermsAccepted() {
    setTermsAccepted(true);
    setTermsOpen(false);
  }

  function rejectTermsAccepted() {
    setTermsAccepted(false);
    setTermsOpen(false);
  }

  function handleTermsCheckboxClick(event: MouseEvent<HTMLInputElement>) {
    event.preventDefault();
    openTermsModal();
  }

  async function acceptAndEsign() {
    setBusy('accept'); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/agreement/accept-and-esign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms_accepted: true }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: {
          status?: string;
          message?: string;
          invitation_link?: string;
          return_url?: string;
          docket_id?: string;
          redirect_same_tab?: boolean;
          simulated?: boolean;
          application?: Application;
        } | Application;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to start Aadhaar eSign.');
      const data = payload.data as {
        status?: string;
        message?: string;
        invitation_link?: string;
        return_url?: string;
        docket_id?: string;
        redirect_same_tab?: boolean;
        simulated?: boolean;
        application?: Application;
      };
      if (data.application) onApplicationUpdated(data.application);
      const signingUrl = String(data.invitation_link || '').trim();
      if (signingUrl && !data.simulated) {
        try {
          window.sessionStorage.setItem('rfms_esign_resume', JSON.stringify({
            at: Date.now(),
            docket_id: data.docket_id || '',
            return_url: data.return_url || '',
          }));
        } catch {
          /* sessionStorage may be unavailable in strict privacy modes */
        }
        // Same-tab redirect to provider signing route (avoids popup blockers).
        window.location.assign(signingUrl);
        return;
      }
      if (data.status === 'esign_redirect' || data.status === 'esign_pending' || data.docket_id || data.simulated) {
        setInvitationLink(signingUrl);
        setOtpHint(
          data.simulated
            ? (data.message || 'Simulated eSign started. Confirm completion below for local testing.')
            : (data.message || 'CGPEY sent a signing SMS (idto.ai). Open that SMS link, finish Aadhaar eSign, then confirm here.'),
        );
        setOtpOpen(true);
        setError('');
        return;
      }
      if ('id' in (payload.data as Application) && (payload.data as Application).id) {
        onApplicationUpdated(payload.data as Application);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to start Aadhaar eSign.');
    } finally {
      setBusy('');
    }
  }

  async function completeEsign() {
    setBusy('verify'); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/agreement/esign/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to confirm Aadhaar eSign completion.');
      onApplicationUpdated(payload.data);
      setOtpOpen(false);
      setInvitationLink('');
      setOtpHint('');
      try { window.sessionStorage.removeItem('rfms_esign_resume'); } catch { /* ignore */ }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to confirm Aadhaar eSign completion.');
    } finally {
      setBusy('');
    }
  }

  async function reopenEsignLink() {
    if (!invitationLink) return;
    window.location.assign(invitationLink);
  }

  async function requestCorrection() {
    setBusy('correction'); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/agreement/corrections`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: correction }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to submit correction request.');
      onApplicationUpdated(payload.data);
      setCorrection('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to submit correction request.');
    } finally {
      setBusy('');
    }
  }

  async function downloadExecutedAgreement() {
    setBusy('download'); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/agreement/download`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('The executed agreement is not available to download yet.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Remedium-Lab-Agreement-${application.application_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to download the executed agreement.');
    } finally {
      setBusy('');
    }
  }

  if (status === 'not_started') {
    return <div className="dashboard-status-card agreement-panel"><b>{statusLabel}</b><span>Agreement status</span><p>The franchise agreement becomes available after the manager proceeds to final agreement following verification of the final payment or branding stage.</p></div>;
  }

  return <div className="applicant-agreement-panel">
    <div className="dashboard-status-card agreement-panel"><b>{statusLabel}</b><span>Agreement status</span><p>{agreementExecuted ? 'Your official executed franchise agreement is archived here. Use the download button below for your legal copy.' : status === 'company_execution_pending' ? 'The manager has uploaded the company-signed agreement and is reviewing it. Download will become available after the manager clicks Save agreement.' : correctionDecision === 'denied' ? 'Your change request was declined. Continue reviewing the agreement below or submit a new request if needed.' : status === 'correction_requested' && correctionDecision === 'approved' ? 'Your change request was approved. The manager will upload and send a revised agreement.' : status === 'correction_requested' ? 'Your change request has been sent to the franchise team. You will be able to review the revised agreement once the manager resends it.' : status === 'applicant_esign_completed' ? 'Your Aadhaar eSign is complete. The agreement remains view-only while the manager signs, uploads and saves the final executed copy.' : permissions?.view_only ? 'Read every page of the agreement below. Download, print, copy and save options are disabled until the manager saves and delivers the final executed agreement.' : 'Your agreement is being prepared by the Remedium franchise team.'}</p></div>
    {correctionActive && workflow?.applicant?.correction_request ? <div className="agreement-change-request-panel"><b>Your change request</b><p>{workflow.applicant.correction_request}</p>{!correctionDecision ? <small className="pending">Pending manager review</small> : null}{correctionDecision === 'approved' ? <small className="approved">Approved · The manager will send a revised agreement.</small> : null}{correctionDecision === 'denied' ? <small className="denied">Denied{workflow.applicant.correction_response ? `: ${workflow.applicant.correction_response}` : ''}</small> : null}</div> : null}
    {showAgreementDocument ? <section className="agreement-document-preview"><h3>Franchise agreement</h3><AgreementDocumentViewer url={viewUrl} title={`Franchise agreement · ${application.application_number}`} secured token={token} lockActions={!agreementExecuted} /><p className="agreement-view-only-note">{agreementExecuted ? 'Official executed agreement. Use the download button below for your legal copy.' : status === 'company_execution_pending' ? 'Secure view-only mode. The manager is reviewing the company-signed copy. Download will unlock after Save agreement.' : 'Secure view-only mode. Right-click, print, copy, save and browser download options are disabled until the manager saves and delivers the final executed agreement.'}</p></section> : null}
    {permissions?.can_accept_esign ? <div className="agreement-panel-actions agreement-acceptance">
      {permissions.can_request_corrections ? <>
        <label className="agreement-correction"><span>Request changes</span><textarea value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="Describe any incorrect information or modification required in the agreement." /></label>
        <button type="button" className="secondary" disabled={busy === 'correction' || !correction.trim()} onClick={() => void requestCorrection()}>{busy === 'correction' ? 'Submitting…' : 'Submit change request'}</button>
      </> : null}
      <label className="agreement-terms-check"><input type="checkbox" checked={termsAccepted} readOnly onClick={handleTermsCheckboxClick} /><span>I have read the Franchise Agreement and accept the <button type="button" className="text-button agreement-terms-link" onClick={(event) => { event.preventDefault(); openTermsModal(); }}>Terms &amp; Conditions</button>.</span></label>
      <button type="button" className="primary" disabled={!termsAccepted || Boolean(busy)} onClick={() => void acceptAndEsign()}>{busy === 'accept' ? 'Starting Aadhaar eSign…' : 'Accept Agreement'}</button>
    </div> : null}
    {canDownloadExecuted ? <div className="agreement-panel-actions"><button type="button" disabled={busy === 'download'} onClick={() => void downloadExecutedAgreement()}>{busy === 'download' ? 'Downloading…' : 'Download executed agreement'}</button></div> : null}
    {error ? <p className="portal-message error" role="alert">{error}</p> : null}
    {termsOpen ? <div className="terms-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTermsOpen(false); }}><section className="terms-modal agreement-terms-modal" role="dialog" aria-modal="true" aria-labelledby="agreement-terms-title"><header><div><p>Agreement terms</p><h2 id="agreement-terms-title">Terms &amp; Conditions</h2></div><button type="button" aria-label="Close terms" onClick={() => setTermsOpen(false)}>×</button></header><div className="terms-copy">{agreementTerms || 'Loading the latest Terms & Conditions…'}</div><div className="terms-modal-actions"><button type="button" className="terms-cancel" onClick={rejectTermsAccepted}>Not Accepted</button><button type="button" className="terms-accept" onClick={confirmTermsAccepted}>Ok</button></div></section></div> : null}
    {otpOpen ? <div className="terms-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOtpOpen(false); }}><section className="terms-modal agreement-otp-modal" role="dialog" aria-modal="true" aria-labelledby="agreement-otp-title"><header><div><p>Aadhaar eSign</p><h2 id="agreement-otp-title">Complete CGPEY signing</h2></div><button type="button" aria-label="Close eSign" disabled={Boolean(busy)} onClick={() => setOtpOpen(false)}>×</button></header><p className="agreement-otp-copy">{otpHint || 'A CGPEY signing window opens for Aadhaar OTP eSign. After you finish there, confirm below.'}</p><div className="terms-modal-actions"><button type="button" className="terms-cancel" disabled={Boolean(busy) || !invitationLink} onClick={() => void reopenEsignLink()}>Reopen signing link</button><button type="button" className="terms-accept" disabled={Boolean(busy)} onClick={() => void completeEsign()}>{busy === 'verify' ? 'Confirming…' : 'I have completed eSign'}</button></div></section></div> : null}
  </div>;
}

function ApplicantOnboardingCertificateCard({ application, token }: { application: Application; token: string }) {
  const certificate = application.onboarding_certificate?.certificate ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function downloadCertificate() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/onboarding-certificate`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Your onboarding welcome certificate is not available yet.');
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
      setError(requestError instanceof Error ? requestError.message : 'Unable to download the onboarding welcome certificate.');
    } finally {
      setBusy(false);
    }
  }

  if (!certificate?.pdf?.url) return null;

  return <section className="onboarding-certificate-overview-card"><div><p>Onboarding certificate</p><b>Welcome to the Remedium Lab franchise network</b><span>{certificate.certificate_number} · {certificate.franchise_model_label} partner · {certificate.business_name}</span>{certificate.verification_url ? <a href={certificate.verification_url} target="_blank" rel="noreferrer">Verify certificate online</a> : null}</div><button type="button" disabled={busy} onClick={() => void downloadCertificate()}>{busy ? 'Preparing…' : 'Download welcome certificate'}</button>{error ? <p className="portal-message error" role="alert">{error}</p> : null}</section>;
}

function ApplicantFranchiseWebpageCard({ application }: { application: Application }) {
  const webpage = application.franchise_webpage;
  if (application.stage !== 'onboarding_completed' || application.franchise_model !== 'FOCO' || !webpage?.public_url) return null;
  const businessName = webpage.settings?.business_name?.trim() || application.full_name;
  return <section className="franchise-webpage-overview-card"><div><p>Welcome aboard</p><b>Your franchise branch webpage is ready</b><span>Congratulations on completing onboarding, {application.full_name.split(/\s+/)[0] || 'partner'}. Remedium Lab has published your FOCO branch portfolio page. Share this link with patients, doctors and local partners.</span><a href={webpage.public_url} target="_blank" rel="noreferrer">{webpage.public_url}</a>{!webpage.enabled ? <small className="franchise-webpage-overview-note">Your manager has temporarily disabled this page. Contact the franchise team if you need it re-enabled.</small> : null}</div><a className="franchise-webpage-overview-button" href={webpage.public_url} target="_blank" rel="noreferrer">Open {businessName} webpage</a></section>;
}

function ApplicantProfile({ company, application, refreshing, accountToken, uploading, onRefresh, onPaymentPage, onReplaceDocument, onApplicationUpdated, onLogout, onMessage, onError }: { company: typeof DEFAULT_COMPANY; application: Application; refreshing: boolean; accountToken: string; uploading: DocumentKey | null; onRefresh: () => void; onPaymentPage: () => void; onReplaceDocument: (key: DocumentKey, event: ChangeEvent<HTMLInputElement>) => void; onApplicationUpdated: (application: Application) => void; onLogout: () => Promise<void>; onMessage?: (message: string) => void; onError?: (message: string) => void }) {
  const initialSection = (() => {
    if (typeof window === 'undefined') return 'overview' as DashboardSection;
    const section = new URLSearchParams(window.location.search).get('section');
    if (section === 'agreement' || section === 'documents' || section === 'payments' || section === 'territory' || section === 'video-kyc' || section === 'training' || section === 'support' || section === 'application' || section === 'overview') {
      return section as DashboardSection;
    }
    if (new URLSearchParams(window.location.search).get('esign_return') === '1') return 'agreement';
    try {
      if (window.sessionStorage.getItem('rfms_esign_resume')) return 'agreement';
    } catch { /* ignore */ }
    return 'overview';
  })();
  const [activeSection, setActiveSection] = useState<DashboardSection>(initialSection);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const timeline = buildOnboardingTimeline(application);
  const duePayment = application.payments.find((payment) => payment.status === 'due');
  const uploadedDocuments = Object.keys(application.documents).length;
  const reuploadRequestedDocuments = DOCUMENTS.filter((document) => application.document_verifications?.[document.key]?.status === 'upload_requested');
  const firstName = application.full_name.trim().split(/\s+/)[0] || 'Applicant';
  const photo = application.documents.photo?.url ? resolveUploadUrl(application.documents.photo.url) : '';
  const documentsVerified = allKycDocumentsVerified(application);
  const kycUnderVerification = allKycDocumentsUploaded(application) && !documentsVerified;
  const videoKycActive = (application.video_kyc_sessions ?? []).find((session) => ['assigned', 'in_progress'].includes(session.status));
  const videoKycComplete = (application.video_kyc_sessions ?? []).some((session) => session.status === 'completed');
  const territoryAllotted = Boolean(application.territory_allotment?.letter_number);

  useEffect(() => {
    document.body.classList.toggle('portal-nav-open', mobileNavOpen);
    return () => { document.body.classList.remove('portal-nav-open'); };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!accountToken) return;
    let cancelled = false;
    async function pollProfile() {
      try {
        const response = await fetch(`${API_BASE}/applicant/profile`, { headers: { Authorization: `Bearer ${accountToken}` } });
        const payload = await response.json().catch(() => null) as { success?: boolean; data?: Application } | null;
        if (!cancelled && response.ok && payload?.success && payload.data) onApplicationUpdated(payload.data);
      } catch {
        /* Keep the last synced application if polling fails temporarily. */
      }
    }
    void pollProfile();
    const interval = window.setInterval(() => void pollProfile(), 15000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [accountToken, onApplicationUpdated]);
  const menu: { key: DashboardSection; label: string }[] = [
    { key: 'overview', label: 'Overview' }, { key: 'application', label: 'Application' }, { key: 'documents', label: 'Documents' }, { key: 'territory', label: 'Territory' }, { key: 'video-kyc', label: 'Video KYC' }, { key: 'payments', label: 'Payments' }, { key: 'agreement', label: 'Agreement' }, { key: 'training', label: 'Training' }, { key: 'support', label: 'Support' },
  ];
  const selectSection = (section: DashboardSection) => { setActiveSection(section); setMobileNavOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openPayment = () => { if (duePayment) onPaymentPage(); else selectSection('payments'); };
  const moduleTitle: Record<Exclude<DashboardSection, 'overview' | 'payments' | 'profile-settings'>, { eyebrow: string; title: string; description: string }> = {
    application: { eyebrow: 'Application', title: 'Your submitted franchise details', description: 'Review the information sent to the Remedium franchise team.' },
    documents: { eyebrow: 'Documents', title: 'Application KYC documents', description: 'Verified documents are protected. If the team asks you to upload again, send a corrected replacement here.' },
    territory: territoryAllotted ? { eyebrow: 'Territory', title: 'Your allotted franchise territory', description: 'Your final territory has been approved by the franchise team and your official Territory Allotment Letter is ready to download.' } : { eyebrow: 'Territory', title: 'Your preferred franchise territory', description: 'Territory availability is confirmed by the franchise team after review.' },
    'video-kyc': { eyebrow: 'Video KYC', title: 'Video verification', description: 'Join the authenticated camera call when the manager starts your assigned Video KYC request. Every attempt stays in your application history.' },
    agreement: { eyebrow: 'Agreement', title: 'Franchise agreement', description: 'The agreement becomes available after final approval and the required payment stage.' },
    training: { eyebrow: 'Training', title: 'Franchisee training', description: application.training?.unlocked ? 'Complete each assigned module in order. The next video unlocks after you mark the current one as finished.' : 'Training modules appear here after your final agreement is executed and the RFMS manager unlocks training.' },
    support: { eyebrow: 'Support', title: 'Application support', description: 'The Remedium franchise support team can guide you through every step.' },
  };
  const franchiseWebpageUrl = application.franchise_webpage?.public_url ?? '';
  const franchiseWebpageLive = application.stage === 'onboarding_completed' && franchiseWebpageUrl;
  const overview = <>
    <section className="dashboard-hero"><div><p>Welcome back, {firstName}</p><h1>{franchiseWebpageLive ? 'Congratulations — you are officially onboarded.' : 'Your franchise journey is moving forward.'}</h1><b>Current stage: {timeline.currentStageLabel}</b>{franchiseWebpageLive ? <span className="dashboard-hero-note">Your Remedium Lab branch webpage is live and ready to share.</span> : null}</div>{franchiseWebpageLive ? <a className="dashboard-hero-action" href={franchiseWebpageUrl} target="_blank" rel="noreferrer">View My Franchisee Page →</a> : <button type="button" onClick={openPayment}>{duePayment ? 'Continue application →' : 'View payment status →'}</button>}</section>
    <ApplicationOnboardingTimeline application={application} />
    <ApplicantOnboardingCertificateCard application={application} token={accountToken} />
    <ApplicantFranchiseWebpageCard application={application} />
    <div className="dashboard-overview-grid"><section className="dashboard-panel"><h2>Your next actions</h2>{reuploadRequestedDocuments.length ? <button className="dashboard-reupload-notice" type="button" onClick={() => selectSection('documents')}><span>!</span><b>{reuploadRequestedDocuments.length} KYC document{reuploadRequestedDocuments.length === 1 ? '' : 's'} need{reuploadRequestedDocuments.length === 1 ? 's' : ''} upload again</b><small>Action required</small></button> : null}<button type="button" onClick={() => selectSection('documents')}><span>{documentsVerified ? '✓' : kycUnderVerification ? '…' : uploadedDocuments === DOCUMENTS.length ? '○' : '○'}</span><b>{kycUnderVerification ? 'KYC documents under verification' : 'Review KYC documents'}</b><small>{documentsVerified ? 'Verified' : kycUnderVerification ? 'Remedium team review in progress' : `${uploadedDocuments}/${DOCUMENTS.length} uploaded`}</small></button><button type="button" onClick={() => selectSection('video-kyc')}><span>{videoKycComplete ? '✓' : documentsVerified && videoKycActive ? '!' : '○'}</span><b>{documentsVerified && videoKycActive?.status === 'in_progress' ? 'Join your Video KYC call' : documentsVerified && videoKycActive ? 'Video KYC request assigned' : 'Video KYC status'}</b><small>{videoKycComplete ? 'Completed' : !documentsVerified ? (kycUnderVerification ? 'Available after KYC verification' : 'Available after document verification') : videoKycActive?.status === 'in_progress' ? 'Manager is ready for you' : videoKycActive ? 'Waiting for manager to start' : 'Waiting for manager assignment'}</small></button><button type="button" onClick={() => selectSection('territory')}><span>○</span><b>Confirm territory preference</b><small>{application.preferred_location}</small></button></section><section className="dashboard-panel franchise-team"><h2>Your franchise team</h2><div className="team-person"><span>RL</span><div><b>Remedium Franchise Team</b><small>Application support desk</small></div><button type="button" onClick={() => selectSection('support')}>Message</button></div><hr /><p>Next review <b>within 2 working days</b></p><p>Preferred territory <b>{application.preferred_location}</b></p></section></div>
  </>;
  const detail = activeSection !== 'overview' && activeSection !== 'payments' && activeSection !== 'profile-settings' ? moduleTitle[activeSection] : null;
  const openProfileSettings = () => { setActiveSection('profile-settings'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const body = activeSection === 'profile-settings'
    ? <ApplicantProfileSettings application={application} token={accountToken} photoUrl={photo || undefined} onBack={() => selectSection('overview')} onApplicationUpdated={onApplicationUpdated} />
    : activeSection === 'overview' ? overview : activeSection === 'payments' ? <section className="dashboard-detail-panel payments-detail"><div className="dashboard-detail-heading"><div><p>Payments</p><h1>Payment schedule</h1><span>Choose a payment method, apply coupons and track verification for every phase.</span></div></div><PaymentSchedule application={application} company={company} onApplicationUpdated={onApplicationUpdated} onMessage={onMessage} onError={onError} /></section> : <section className="dashboard-detail-panel"><div className="dashboard-detail-heading"><div><p>{detail?.eyebrow}</p><h1>{detail?.title}</h1><span>{detail?.description}</span></div><b>{application.franchisee_id || application.application_number}</b></div>{activeSection === 'application' ? <><div className="dashboard-detail-grid"><div><small>Applicant name</small><b>{application.full_name}</b></div><div><small>Franchise model</small><b>{application.franchise_model}</b></div>{application.franchisee_id ? <div><small>Franchisee ID</small><b>{application.franchisee_id}</b></div> : null}<div><small>Email address</small><b>{application.email}</b></div><div><small>Mobile number</small><b>{application.mobile}</b></div><div><small>{territoryAllotted ? 'Allotted territory' : 'Preferred territory'}</small><b>{application.territory_allotment?.final_territory || application.preferred_location}</b></div><div><small>Current stage</small><b>{stageLabel(application.stage)}</b></div></div><ApplicantFieldVisitCard application={application} token={accountToken} /><ApplicantBrandingAndHr application={application} /></> : activeSection === 'documents' ? <ApplicantDocumentsPanel application={application} token={accountToken} uploading={uploading} onReplaceDocument={onReplaceDocument} onApplicationUpdated={onApplicationUpdated} /> : activeSection === 'territory' ? <ApplicantTerritoryPanel application={application} token={accountToken} /> : activeSection === 'video-kyc' ? <ApplicantVideoKycPanel application={application} token={accountToken} onApplicationUpdated={onApplicationUpdated} /> : activeSection === 'agreement' ? <ApplicantAgreementPanel application={application} token={accountToken} onApplicationUpdated={onApplicationUpdated} onEsignCompleted={(message) => onMessage?.(message)} /> : activeSection === 'training' ? <ApplicantTrainingPanel application={application} token={accountToken} onApplicationUpdated={onApplicationUpdated} /> : activeSection === 'support' ? <ApplicantSupportPanel application={application} token={accountToken} onApplicationUpdated={onApplicationUpdated} notify={() => undefined} /> : <div className="dashboard-status-card"><b>Remedium Franchise Support</b><span>{`${detail?.eyebrow} status`}</span><p>{detail?.description}</p></div>}</section>;
  return <div className="app-dashboard"><button type="button" className={`dashboard-sidebar-backdrop${mobileNavOpen ? ' open' : ''}`} aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /><aside className={`dashboard-sidebar${mobileNavOpen ? ' open' : ''}`}><div className="dashboard-brand"><span className="dashboard-logo-frame"><img src={company.logo_url} alt={`${company.company_name} logo`} onError={(event) => { event.currentTarget.src = DEFAULT_COMPANY.logo_url; }} /></span><div className="dashboard-brand-copy"><b>{company.company_name}</b><small>Applicant portal</small></div></div><nav aria-label="Applicant portal navigation">{menu.map((item) => <button type="button" className={activeSection === item.key ? 'active' : ''} onClick={() => selectSection(item.key)} key={item.key}>{item.label}</button>)}</nav><section className="dashboard-help"><b>Need help?</b><p>Our franchise team is here to guide your application.</p><button type="button" onClick={() => selectSection('support')}>Contact support</button></section></aside><div className="dashboard-workspace"><header className="dashboard-topbar"><button type="button" className={`portal-nav-toggle${mobileNavOpen ? ' open' : ''}`} aria-expanded={mobileNavOpen} aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileNavOpen((current) => !current)}><span className="portal-nav-toggle-bar" /><span className="portal-nav-toggle-bar" /><span className="portal-nav-toggle-bar" /></button><div className="dashboard-topbar-copy"><small>{application.franchisee_id ? 'Franchisee ID' : 'Application number'}</small><strong title={application.franchisee_id || application.application_number}>{application.franchisee_id || application.application_number}</strong></div><span className="dashboard-topbar-desktop-id">{application.franchisee_id ? `Franchisee ID ${application.franchisee_id}` : `Application ${application.application_number}`}</span><button type="button" className="dashboard-topbar-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing...' : 'Refresh'}</button><ApplicantNotificationBell token={accountToken} onNavigate={(section) => selectSection(section as DashboardSection)} /><ApplicantProfileMenu photoUrl={photo || undefined} name={application.full_name} onUpdateProfile={openProfileSettings} onLogout={onLogout} /></header><main className="dashboard-content">{body}</main></div></div>;
}

function ApplicantProfileLogin({ company, onAuthenticated, onCancel }: { company: typeof DEFAULT_COMPANY; onAuthenticated: (token: string, application: Application) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function resetChallenge() {
    setChallengeId('');
    setOtp('');
    setMessage('');
  }

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_BASE}/applicant/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { challenge_id?: string; masked_mobile?: string; test_mode?: boolean }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.challenge_id) throw new Error(payload?.error?.message ?? 'Unable to send the OTP.');
      setChallengeId(payload.data.challenge_id);
      setMessage(payload.data.test_mode
        ? `OTP sent to the registered mobile number ${payload.data.masked_mobile ?? ''}. Test mode: use 123456.`
        : `OTP sent to the registered mobile number ${payload.data.masked_mobile ?? ''} via SMS.`);
    } catch (requestError) {
      setError(networkErrorMessage(requestError, 'Unable to send the OTP.'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/applicant/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: challengeId, otp }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { token?: string; application?: Application }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.token) throw new Error(payload?.error?.message ?? 'Unable to verify the OTP.');
      onAuthenticated(payload.data.token, payload.data.application as Application);
    } catch (requestError) {
      setError(networkErrorMessage(requestError, 'Unable to verify the OTP.'));
    } finally {
      setBusy(false);
    }
  }

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_BASE}/applicant/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { challenge_id?: string; masked_mobile?: string; test_mode?: boolean }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.challenge_id) throw new Error(payload?.error?.message ?? 'Unable to verify your password.');
      setChallengeId(payload.data.challenge_id);
      setMessage(payload.data.test_mode
        ? `Password verified. OTP sent to ${payload.data.masked_mobile ?? 'your registered mobile number'}. Test mode: use 123456.`
        : `Password verified. OTP sent to ${payload.data.masked_mobile ?? 'your registered mobile number'} via SMS.`);
    } catch (requestError) {
      setError(networkErrorMessage(requestError, 'Unable to sign in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-login-page">
      <div className="profile-login-card">
        <div className="page-eyebrow">Applicant portal sign in</div>
        <h1>Open your application profile.</h1>
        <p>Track your application, staff review, documents, payment receipts and next due payment.</p>
        <div className="profile-login-tabs">
          <button type="button" className={mode === 'otp' ? 'active' : ''} onClick={() => { setMode('otp'); resetChallenge(); setError(''); }}>Mobile / Registration / Email OTP</button>
          <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => { setMode('password'); resetChallenge(); setError(''); }}>User ID / Password + OTP</button>
        </div>
        {challengeId ? (
          <form className="profile-login-form" onSubmit={verifyOtp}>
            <label>One-time password<input required value={otp} inputMode="numeric" pattern="[0-9]{6}" onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="6-digit OTP" /></label>
            <button disabled={busy}>{busy ? 'Verifying...' : 'Verify and open profile'}</button>
            <button className="text-button" type="button" onClick={() => { resetChallenge(); setError(''); }}>{mode === 'otp' ? 'Use another mobile number, registration number or email' : 'Use another user ID or password'}</button>
          </form>
        ) : mode === 'otp' ? (
          <form className="profile-login-form" onSubmit={requestOtp}>
            <label>Mobile number, registration number or email<input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="8918920669, RFMS-2026-0001 or name@email.com" /></label>
            <button disabled={busy}>{busy ? 'Sending OTP...' : 'Send OTP'}</button>
          </form>
        ) : (
          <form className="profile-login-form" onSubmit={passwordLogin}>
            <label>Registration number, email address or user ID<input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="RFMS-2026-0001, name@email.com or your user ID" /></label>
            <label>Password<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /></label>
            <button disabled={busy}>{busy ? 'Verifying password...' : 'Continue with OTP'}</button>
          </form>
        )}
        {message ? <p className="portal-message success" role="status">{message}</p> : null}
        {error ? <p className="portal-message error" role="alert">{error}</p> : null}
        <div className="profile-login-help">
          <b>New applicant?</b>
          <span>Create your applicant user ID and password while submitting the franchise application.</span>
          <button type="button" className="text-button" onClick={onCancel}>Back to application</button>
        </div>
      </div>
      <aside className="profile-login-aside">
        <span className="profile-login-aside-logo"><img src={company.logo_url} alt={`${company.company_name} logo`} {...portalLogoImageProps(company.logo_url)} /></span>
        <h2>Your franchise journey, in one place.</h2>
        <p>Sign in securely whenever you need to view your current stage and available payment options.</p>
      </aside>
    </section>
  );
}

function FranchiseTermsModal({ title, terms, onAccept, onClose }: { title: string; terms: string; onAccept: () => void; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const model = title;
  return <div className="terms-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title"><header><div><p>Franchise terms</p><h2 id="terms-title">{model} terms &amp; conditions</h2></div><button type="button" aria-label="Close terms" onClick={onClose}>×</button></header><div className="terms-copy">{terms}</div><label className="terms-modal-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I have read and agree to these {model} franchise terms and conditions.</label><div className="terms-modal-actions"><button type="button" className="terms-cancel" onClick={onClose}>Close</button><button type="button" className="terms-accept" disabled={!confirmed} onClick={onAccept}>Accept terms</button></div></section></div>;
}

function LegacyApplicationForm({ company, draft, documents, uploading, submitting, message, error, setField, onUpload, onSubmit }: { company: typeof DEFAULT_COMPANY; draft: Draft; documents: Partial<Record<DocumentKey, UploadedDocument>>; uploading: DocumentKey | null; submitting: boolean; message: string; error: string; setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void; onUpload: (key: DocumentKey, event: ChangeEvent<HTMLInputElement>) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section className="application-page"><div className="application-intro"><div className="page-eyebrow">Franchise application</div><h1>Start your {company.company_name} franchise journey.</h1><p>Complete your details, create your applicant login, upload KYC documents and continue to the payment plan.</p><div className="application-steps"><span className="active"><b>1</b> Application &amp; KYC</span><span><b>2</b> Payment</span><span><b>3</b> RFMS review</span></div></div><form className="application-form" onSubmit={onSubmit}><section><h2>Applicant details</h2><div className="portal-form-grid"><label>Full name<input required value={draft.full_name} onChange={(event) => setField('full_name', event.target.value)} placeholder="Your full name" /></label><label>Mobile number<input required inputMode="tel" value={draft.mobile} onChange={(event) => setField('mobile', event.target.value)} placeholder="10-digit mobile number" /></label><label>Email address<input required type="email" value={draft.email} onChange={(event) => setField('email', event.target.value)} placeholder="name@example.com" /></label><label>Date of birth<input required type="date" value={draft.date_of_birth} onChange={(event) => setField('date_of_birth', event.target.value)} /></label><label className="span-two">Residential address<textarea required value={draft.address} onChange={(event) => setField('address', event.target.value)} placeholder="House / street / locality" /></label><label>City / town<input required value={draft.city} onChange={(event) => setField('city', event.target.value)} /></label><label>District<input required value={draft.district} onChange={(event) => setField('district', event.target.value)} /></label><label>PIN code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={draft.pincode} onChange={(event) => setField('pincode', event.target.value.replace(/\D/g, ''))} placeholder="700156" /></label><label>Franchise model<select value={draft.franchise_model} onChange={(event) => setField('franchise_model', event.target.value as Draft['franchise_model'])}><option value="FOFO">FOFO — Franchise Owned, Franchise Operated</option><option value="FOCO">FOCO — Franchise Owned, Company Operated</option></select></label><label className="span-two">Preferred territory / location<input required value={draft.preferred_location} onChange={(event) => setField('preferred_location', event.target.value)} placeholder="e.g. Newtown, Kolkata" /></label><label className="span-two">Business experience<textarea value={draft.business_experience} onChange={(event) => setField('business_experience', event.target.value)} placeholder="Tell us about your work, healthcare or business experience (optional)." /></label></div></section><section className="account-setup"><div><div className="page-eyebrow">Applicant account</div><h2>Create your applicant login</h2><p>Use this user ID and password to access your profile, payment receipts and application progress.</p></div><div className="portal-form-grid"><label>Applicant user ID<input required minLength={4} maxLength={40} pattern="[A-Za-z0-9._-]+" value={draft.user_id} onChange={(event) => setField('user_id', event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="e.g. snehasish.ganguly" /></label><label>Create password<input required type="password" minLength={8} value={draft.account_password} onChange={(event) => setField('account_password', event.target.value)} placeholder="Minimum 8 characters" /></label><label>Confirm password<input required type="password" minLength={8} value={draft.account_password_confirmation} onChange={(event) => setField('account_password_confirmation', event.target.value)} placeholder="Repeat your password" /></label></div></section><section><div className="section-heading"><div><h2>KYC documents</h2><p>Upload a clear photograph and each required identity document.</p></div><span>Required</span></div><div className="document-grid">{DOCUMENTS.map((item) => <DocumentUpload key={item.key} item={item} document={documents[item.key]} busy={uploading === item.key} onUpload={onUpload} />)}</div></section><section className="fee-preview"><h2>{draft.franchise_model} payment summary</h2>{draft.franchise_model === 'FOFO' ? <p><b>{money(45000)}</b> one-time franchise fee, payable after completing this application.</p> : <div><p><b>Phase 1: {money(10000)}</b> — document verification and location allotment</p><p><b>Phase 2: {money(110000)}</b> — onboarding process</p><p><b>Phase 3: {money(200000)}</b> — final agreement and onboarding</p></div>}</section>{message ? <p className="portal-message success" role="status">{message}</p> : null}{error ? <p className="portal-message error" role="alert">{error}</p> : null}<button className="submit-application" disabled={submitting || uploading !== null}>{submitting ? 'Saving application...' : 'Submit application and continue to payment'}</button><p className="application-note">Your application is sent to the RFMS Admin dashboard after the first payment is successfully recorded.</p></form></section>;
}

function ContactOtpControl({ channel, value, verified, onVerified }: { channel: ContactChannel; value: string; verified: boolean; onVerified: (token: string) => void }) {
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const label = channel === 'mobile' ? 'mobile number' : 'email address';
  const actionLabel = channel === 'mobile' ? 'Send mobile OTP' : 'Send email OTP';

  async function requestOtp() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/contact-otp/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, value }) });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? `Unable to send the ${label} OTP.`);
      setChallengeId(payload.data.challenge_id as string);
      setMessage(payload.data.test_mode
        ? `OTP sent to ${payload.data.masked_destination}. Test mode: use 123456.`
        : channel === 'email'
          ? `OTP sent to ${payload.data.masked_destination}. Check your email inbox.`
          : `OTP sent to ${payload.data.masked_destination} via SMS.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : `Unable to send the ${label} OTP.`); }
    finally { setBusy(false); }
  }

  async function verifyOtp() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/applications/public/contact-otp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: challengeId, otp }) });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to verify the OTP.');
      onVerified(payload.data.verification_token as string);
      setMessage(`${channel === 'mobile' ? 'Mobile number' : 'Email address'} verified.`);
      setChallengeId(''); setOtp('');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to verify the OTP.'); }
    finally { setBusy(false); }
  }

  if (verified) return <div className="contact-verification verified" role="status"><span>✓</span>{channel === 'mobile' ? 'Mobile number verified' : 'Email address verified'}</div>;
  return <div className="contact-verification">{challengeId ? <><div className="contact-otp-entry"><input aria-label={`${label} OTP`} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit OTP" /><button type="button" onClick={() => void verifyOtp()} disabled={busy || otp.length !== 6}>{busy ? 'Checking...' : 'Verify OTP'}</button></div><button className="contact-resend" type="button" onClick={() => void requestOtp()} disabled={busy}>{busy ? 'Sending...' : 'Resend OTP'}</button></> : <button className="contact-send" type="button" onClick={() => void requestOtp()} disabled={busy || !value.trim()}>{busy ? 'Sending...' : actionLabel}</button>}{message ? <small className="contact-help success">{message}</small> : null}{error ? <small className="contact-help error" role="alert">{error}</small> : null}</div>;
}

function LegacyVerifiedApplicationForm({ company, draft, documents, uploading, submitting, message, error, setField, onUpload, onSubmit }: { company: typeof DEFAULT_COMPANY; draft: Draft; documents: Partial<Record<DocumentKey, UploadedDocument>>; uploading: DocumentKey | null; submitting: boolean; message: string; error: string; setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void; onUpload: (key: DocumentKey, event: ChangeEvent<HTMLInputElement>) => void; onSubmit: (event: FormEvent<HTMLFormElement>, verification: ContactVerification) => void }) {
  const [verification, setVerification] = useState<ContactVerification>({ mobileToken: '', emailToken: '' });
  const [contactError, setContactError] = useState('');
  function updateMobile(value: string) { setField('mobile', value.replace(/\D/g, '').slice(0, 10)); setVerification((current) => ({ ...current, mobileToken: '' })); setContactError(''); }
  function updateEmail(value: string) { setField('email', value); setVerification((current) => ({ ...current, emailToken: '' })); setContactError(''); }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!verification.mobileToken || !verification.emailToken) { setContactError('Verify both the mobile number and email address with their OTPs before submitting the application.'); return; } onSubmit(event, verification); }

  return <section className="application-page"><div className="application-intro"><div className="page-eyebrow">Franchise application</div><h1>Start your {company.company_name} franchise journey.</h1><p>Complete your details, verify your contacts, create your applicant login, upload KYC documents and continue to the payment plan.</p><div className="application-steps"><span className="active"><b>1</b> Application &amp; KYC</span><span><b>2</b> Payment</span><span><b>3</b> RFMS review</span></div></div><form className="application-form" onSubmit={submit}><section><h2>Applicant details</h2><p className="contact-intro">For your security, verify your mobile number and email address before submitting.</p><div className="portal-form-grid"><label>Full name<input required value={draft.full_name} onChange={(event) => setField('full_name', event.target.value)} placeholder="Your full name" /></label><div className="verified-field"><label>Mobile number<input required inputMode="tel" pattern="[6-9][0-9]{9}" maxLength={10} value={draft.mobile} onChange={(event) => updateMobile(event.target.value)} placeholder="10-digit mobile number" /></label><ContactOtpControl key={`mobile:${draft.mobile}`} channel="mobile" value={draft.mobile} verified={Boolean(verification.mobileToken)} onVerified={(token) => setVerification((current) => ({ ...current, mobileToken: token }))} /></div><div className="verified-field"><label>Email address<input required type="email" value={draft.email} onChange={(event) => updateEmail(event.target.value)} placeholder="name@example.com" /></label><ContactOtpControl key={`email:${draft.email}`} channel="email" value={draft.email} verified={Boolean(verification.emailToken)} onVerified={(token) => setVerification((current) => ({ ...current, emailToken: token }))} /></div><label>Date of birth<input required type="date" value={draft.date_of_birth} onChange={(event) => setField('date_of_birth', event.target.value)} /></label><label className="span-two">Residential address<textarea required value={draft.address} onChange={(event) => setField('address', event.target.value)} placeholder="House / street / locality" /></label><label>City / town<input required value={draft.city} onChange={(event) => setField('city', event.target.value)} /></label><label>District<input required value={draft.district} onChange={(event) => setField('district', event.target.value)} /></label><label>PIN code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={draft.pincode} onChange={(event) => setField('pincode', event.target.value.replace(/\D/g, ''))} placeholder="700156" /></label><label>Franchise model<select value={draft.franchise_model} onChange={(event) => setField('franchise_model', event.target.value as Draft['franchise_model'])}><option value="FOFO">FOFO — Franchise Owned, Franchise Operated</option><option value="FOCO">FOCO — Franchise Owned, Company Operated</option></select></label><label className="span-two">Preferred territory / location<input required value={draft.preferred_location} onChange={(event) => setField('preferred_location', event.target.value)} placeholder="e.g. Newtown, Kolkata" /></label><label className="span-two">Business experience<textarea value={draft.business_experience} onChange={(event) => setField('business_experience', event.target.value)} placeholder="Tell us about your work, healthcare or business experience (optional)." /></label></div></section><section className="account-setup"><div><div className="page-eyebrow">Applicant account</div><h2>Create your applicant login</h2><p>Use this user ID and password to access your profile, payment receipts and application progress.</p></div><div className="portal-form-grid"><label>Applicant user ID<input required minLength={4} maxLength={40} pattern="[A-Za-z0-9._-]+" value={draft.user_id} onChange={(event) => setField('user_id', event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="e.g. snehasish.ganguly" /></label><label>Create password<input required type="password" minLength={8} value={draft.account_password} onChange={(event) => setField('account_password', event.target.value)} placeholder="Minimum 8 characters" /></label><label>Confirm password<input required type="password" minLength={8} value={draft.account_password_confirmation} onChange={(event) => setField('account_password_confirmation', event.target.value)} placeholder="Repeat your password" /></label></div></section><section><div className="section-heading"><div><h2>KYC documents</h2><p>Upload a clear photograph and each required identity document.</p></div><span>Required</span></div><div className="document-grid">{DOCUMENTS.map((item) => <DocumentUpload key={item.key} item={item} document={documents[item.key]} busy={uploading === item.key} onUpload={onUpload} />)}</div></section><section className="fee-preview"><h2>{draft.franchise_model} payment summary</h2>{draft.franchise_model === 'FOFO' ? <p><b>{money(45000)}</b> one-time franchise fee, payable after completing this application.</p> : <div><p><b>Phase 1: {money(10000)}</b> — document verification and location allotment</p><p><b>Phase 2: {money(110000)}</b> — onboarding process</p><p><b>Phase 3: {money(200000)}</b> — final agreement and onboarding</p></div>}</section>{message ? <p className="portal-message success" role="status">{message}</p> : null}{error ? <p className="portal-message error" role="alert">{error}</p> : null}{contactError ? <p className="portal-message error" role="alert">{contactError}</p> : null}<button className="submit-application" disabled={submitting || uploading !== null}>{submitting ? 'Saving application...' : 'Submit application and continue to payment'}</button><p className="application-note">Your application is sent to the RFMS Admin dashboard after the first payment is successfully recorded.</p></form></section>;
}

function TerritoryPinField({ draft, pins, loading, setField }: { draft: Draft; pins: TerritoryPin[]; loading: boolean; setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void }) {
  const modelSelected = draft.franchise_model === 'FOFO' || draft.franchise_model === 'FOCO';
  const applicable = !modelSelected ? [] : pins.filter((pin) => draft.franchise_model === 'FOFO' ? pin.fofo.available > 0 : pin.foco.available > 0);
  const selected = applicable.find((pin) => pin.pincode === draft.pincode);
  const availabilityLabel = (pin: TerritoryPin) => draft.franchise_model === 'FOFO' ? `${pin.fofo.available} FOFO available` : `${pin.foco.available} FOCO available`;
  const emptyLabel = !modelSelected
    ? 'Select FOFO or FOCO first'
    : loading
      ? 'Loading available PIN codes...'
      : applicable.length
        ? 'Select available PIN code'
        : `No ${draft.franchise_model} PIN is currently available`;
  return <label className="territory-pin-field">Franchise territory PIN code<select required value={draft.pincode} onChange={(event) => setField('pincode', event.target.value)} disabled={loading || !modelSelected || !applicable.length}><option value="">{emptyLabel}</option>{applicable.map((pin) => <option key={pin.pincode} value={pin.pincode}>{pin.pincode} — {pin.area}, {pin.district} ({availabilityLabel(pin)})</option>)}</select><small>{selected ? `${selected.area}, ${selected.subdivision}, ${selected.district}. Availability is reserved from this exact PIN after payment.` : modelSelected ? 'Only PIN codes configured as available by the franchise team can be selected.' : 'Choose a franchise model to see available PIN codes.'}</small></label>;
}

function ApplicationForm({ company, draft, documents, uploading, submitting, message, error, setField, onUpload, onSubmit, territoryPins, territoryPinsLoading }: { company: typeof DEFAULT_COMPANY; draft: Draft; documents: Partial<Record<DocumentKey, UploadedDocument>>; uploading: DocumentKey | null; submitting: boolean; message: string; error: string; setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void; onUpload: (key: DocumentKey, event: ChangeEvent<HTMLInputElement>) => void; onSubmit: (event: FormEvent<HTMLFormElement>, verification: ContactVerification) => void; territoryPins: TerritoryPin[]; territoryPinsLoading: boolean }) {
  const [verification, setVerification] = useState<ContactVerification>({ mobileToken: '', emailToken: '' });
  const [contactError, setContactError] = useState('');
  const [panStatus, setPanStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const completeDocumentCount = DOCUMENTS.filter((item) => documents[item.key]).length;
  const modelSelected = draft.franchise_model === 'FOFO' || draft.franchise_model === 'FOCO';
  const selectedTerms = draft.franchise_model === 'FOCO' ? company.foco_terms : company.fofo_terms;

  function updateMobile(value: string) {
    setField('mobile', value.replace(/\D/g, '').slice(0, 10));
    setVerification((current) => ({ ...current, mobileToken: '' }));
    setContactError('');
  }

  function updateEmail(value: string) {
    setField('email', value);
    setVerification((current) => ({ ...current, emailToken: '' }));
    setContactError('');
  }

  function updatePan(value: string) {
    setField('pan_number', value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
    setPanStatus('idle');
  }

  function validatePan() {
    setPanStatus(/^[A-Z]{5}\d{4}[A-Z]$/.test(draft.pan_number) ? 'valid' : 'invalid');
  }

  function updateModel(value: Draft['franchise_model']) {
    setField('franchise_model', value);
    setField('pincode', '');
    setTermsAccepted(false);
    setContactError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelSelected) {
      setContactError('Select FOFO or FOCO before submitting the application.');
      return;
    }
    if (!verification.mobileToken || !verification.emailToken) {
      setContactError('Verify both the mobile number and email address with their OTPs before submitting the application.');
      return;
    }
    if (!termsAccepted) {
      setContactError(`Open, read and accept the ${draft.franchise_model} franchise terms and conditions before submitting the application.`);
      return;
    }
    if (completeDocumentCount !== DOCUMENTS.length) {
      setContactError('Upload all four required files: applicant photograph, PAN card, Aadhaar card and Voter ID.');
      return;
    }
    onSubmit(event, { ...verification, termsAccepted });
  }

  return <section className="application-page">
    <div className="application-intro">
      <div className="page-eyebrow">Franchise application</div>
      <h1>Start your {company.company_name} franchise journey.</h1>
      <p>Complete your details, verify your contacts, provide KYC information and continue to the payment plan.</p>
      <div className="application-steps"><span className="active"><b>1</b> Application &amp; KYC</span><span><b>2</b> Payment</span><span><b>3</b> RFMS review</span></div>
    </div>
    <form className="application-form" onSubmit={submit}>
      <section>
        <h2>Applicant details</h2>
        <p className="contact-intro">Verify your mobile number and email address, then provide your PAN and Aadhaar details before submission.</p>
        <div className="portal-form-grid">
          <label>Full name<input required value={draft.full_name} onChange={(event) => setField('full_name', event.target.value)} placeholder="Your full name" /></label>
          <div className="verified-field"><label>Mobile number<input required inputMode="tel" pattern="[6-9][0-9]{9}" maxLength={10} value={draft.mobile} onChange={(event) => updateMobile(event.target.value)} placeholder="10-digit mobile number" /></label><ContactOtpControl key={`mobile:${draft.mobile}`} channel="mobile" value={draft.mobile} verified={Boolean(verification.mobileToken)} onVerified={(token) => setVerification((current) => ({ ...current, mobileToken: token }))} /></div>
          <div className="verified-field"><label>Email address<input required type="email" value={draft.email} onChange={(event) => updateEmail(event.target.value)} placeholder="name@example.com" /></label><ContactOtpControl key={`email:${draft.email}`} channel="email" value={draft.email} verified={Boolean(verification.emailToken)} onVerified={(token) => setVerification((current) => ({ ...current, emailToken: token }))} /></div>
          <label>Date of birth<input required type="date" value={draft.date_of_birth} onChange={(event) => setField('date_of_birth', event.target.value)} /></label>
          <div className="pan-field"><label>PAN number<input required value={draft.pan_number} onChange={(event) => updatePan(event.target.value)} pattern="[A-Z]{5}[0-9]{4}[A-Z]" maxLength={10} placeholder="ABCDE1234F" /></label><div className="pan-validation"><button type="button" className="pan-validate" onClick={validatePan}>Validate PAN</button>{panStatus === 'valid' ? <small className="pan-status valid" role="status">✓ PAN format is valid</small> : panStatus === 'invalid' ? <small className="pan-status invalid" role="alert">Enter PAN in ABCDE1234F format</small> : null}</div></div>
          <label>Aadhaar number<input required inputMode="numeric" value={draft.aadhaar_number} onChange={(event) => setField('aadhaar_number', event.target.value.replace(/\D/g, '').slice(0, 12))} pattern="[0-9]{12}" maxLength={12} placeholder="12-digit Aadhaar number" /></label>
          <label className="span-two">Residential address<textarea required value={draft.address} onChange={(event) => setField('address', event.target.value)} placeholder="House / street / locality" /></label>
          <label>City / town<input required value={draft.city} onChange={(event) => setField('city', event.target.value)} /></label>
          <label>District<input required value={draft.district} onChange={(event) => setField('district', event.target.value)} /></label>
          <label>Franchise model<select required value={draft.franchise_model} onChange={(event) => updateModel(event.target.value as Draft['franchise_model'])}><option value="">Select FOFO or FOCO</option><option value="FOFO">FOFO — Franchise Owned, Franchise Operated</option><option value="FOCO">FOCO — Franchise Owned, Company Operated</option></select></label>
          <TerritoryPinField draft={draft} pins={territoryPins} loading={territoryPinsLoading} setField={setField} />
          <label className="span-two">Preferred territory / location<input required value={draft.preferred_location} onChange={(event) => setField('preferred_location', event.target.value)} placeholder="e.g. Newtown, Kolkata" /></label>
          <label className="span-two">Business experience<textarea value={draft.business_experience} onChange={(event) => setField('business_experience', event.target.value)} placeholder="Tell us about your work, healthcare or business experience (optional)." /></label>
        </div>
      </section>
      <section className="account-setup">
        <div><div className="page-eyebrow">Applicant account</div><h2>Create your applicant login</h2><p>Use this user ID and password to access your profile, payment receipts and application progress.</p></div>
        <div className="portal-form-grid"><label>Applicant user ID<input required minLength={4} maxLength={40} pattern="[A-Za-z0-9._-]+" value={draft.user_id} onChange={(event) => setField('user_id', event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="e.g. snehasish.ganguly" /></label><label>Create password<input required type="password" minLength={8} value={draft.account_password} onChange={(event) => setField('account_password', event.target.value)} placeholder="Minimum 8 characters" /></label><label>Confirm password<input required type="password" minLength={8} value={draft.account_password_confirmation} onChange={(event) => setField('account_password_confirmation', event.target.value)} placeholder="Repeat your password" /></label></div>
      </section>
      <section>
        <div className="section-heading"><div><h2>KYC documents</h2><p>All four files are required to continue: a photo, PAN card, Aadhaar card and Voter ID.</p></div><span>{completeDocumentCount}/4 required</span></div>
        <div className="document-grid">{DOCUMENTS.map((item) => <DocumentUpload key={item.key} item={item} document={documents[item.key]} busy={uploading === item.key} onUpload={onUpload} />)}</div>
      </section>
      <section className="fee-preview"><h2>{modelSelected ? `${draft.franchise_model} payment summary` : 'Payment summary'}</h2>{!modelSelected ? <p>Select FOFO or FOCO to see the fee schedule.</p> : draft.franchise_model === 'FOFO' ? <p><b>{money(45000)}</b> one-time franchise fee, payable after completing this application.</p> : <div><p><b>Phase 1: {money(10000)}</b> — document verification and location allotment</p><p><b>Phase 2: {money(110000)}</b> — onboarding process</p><p><b>Phase 3: {money(200000)}</b> — final agreement and onboarding</p></div>}</section>
      <section className={`terms-consent ${termsAccepted ? 'accepted' : ''}`}><div><b>{modelSelected ? `${draft.franchise_model} franchise terms & conditions` : 'Franchise terms & conditions'}</b><span>{modelSelected ? 'Open the terms, read them and accept them before submitting your application or making a payment.' : 'Select FOFO or FOCO first, then read and accept the matching terms.'}</span></div><label><input type="checkbox" checked={termsAccepted} disabled={!modelSelected} onChange={(event) => { if (!event.target.checked) setTermsAccepted(false); else setTermsOpen(true); }} />I have read and accepted the {modelSelected ? `${draft.franchise_model} ` : ''}franchise terms.</label><button type="button" disabled={!modelSelected} onClick={() => setTermsOpen(true)}>{termsAccepted ? 'Review accepted terms' : 'Read terms & conditions'}</button></section>
      {message ? <p className="portal-message success" role="status">{message}</p> : null}{error ? <p className="portal-message error" role="alert">{error}</p> : null}{contactError ? <p className="portal-message error" role="alert">{contactError}</p> : null}
      <button className="submit-application" disabled={submitting || uploading !== null || !modelSelected || !termsAccepted}>{submitting ? 'Saving application...' : !modelSelected ? 'Select FOFO or FOCO to continue' : !termsAccepted ? `Accept ${draft.franchise_model} terms to continue` : 'Submit application and continue to payment'}</button>
      <p className="application-note">Your application is sent to the RFMS Admin dashboard after the first payment is successfully recorded.</p>
    </form>{termsOpen && modelSelected ? <FranchiseTermsModal title={`${draft.franchise_model} franchise`} terms={selectedTerms} onClose={() => setTermsOpen(false)} onAccept={() => { setTermsAccepted(true); setTermsOpen(false); setContactError(''); }} /> : null}
  </section>;
}

export default function Portal() {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [documents, setDocuments] = useState<Partial<Record<DocumentKey, UploadedDocument>>>({});
  const [application, setApplication] = useState<Application | null>(null);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [territoryPins, setTerritoryPins] = useState<TerritoryPin[]>([]);
  const [territoryPinsLoading, setTerritoryPinsLoading] = useState(true);
  const [view, setView] = useState<PortalView>('application');
  const [profileToken, setProfileToken] = useState('');
  const [uploading, setUploading] = useState<DocumentKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadApplication = useCallback(async () => { const id = window.localStorage.getItem(STORAGE_KEY); if (!id) return; try { const response = await fetch(`${API_BASE}/applications/public/${id}`); const payload = await response.json(); if (response.ok && payload?.success) { setApplication(payload.data as Application); setView('payment'); } else window.localStorage.removeItem(STORAGE_KEY); } catch { /* The sign-in route remains available without a locally saved application. */ } }, []);
  const loadProfile = useCallback(async (token: string, showRefresh = false) => { if (!token) return false; if (showRefresh) setRefreshing(true); try { const response = await fetch(`${API_BASE}/applicant/profile`, { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json(); if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Please sign in again to refresh your profile.'); setApplication(payload.data as Application); setProfileToken(token); setError(''); setView('profile'); return true; } catch (profileError) { window.localStorage.removeItem(AUTH_TOKEN_KEY); setProfileToken(''); setView('profile-login'); if (showRefresh) setError(profileError instanceof Error ? profileError.message : 'Please sign in again to refresh your profile.'); return false; } finally { if (showRefresh) setRefreshing(false); } }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const model = params.get('model');
    if (model === 'FOFO' || model === 'FOCO') setDraft((current) => ({ ...current, franchise_model: model }));
    const hecLead = params.get('hec_lead');
    const hecFp = params.get('hec_fp');
    const prefillName = params.get('name');
    const prefillEmail = params.get('email');
    const prefillMobile = params.get('mobile');
    const prefillLocation = params.get('location');
    if (hecLead || hecFp || prefillName || prefillEmail || prefillMobile || prefillLocation) {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      window.localStorage.removeItem(STORAGE_KEY);
      setApplication(null);
      setProfileToken('');
      setDraft((current) => ({
        ...current,
        full_name: prefillName?.trim() || current.full_name,
        email: prefillEmail?.trim() || current.email,
        mobile: prefillMobile?.trim() || current.mobile,
        preferred_location: prefillLocation?.trim() || current.preferred_location,
        franchise_model: model === 'FOFO' || model === 'FOCO' ? model : '',
        hec_lead_id: hecLead || current.hec_lead_id,
        hec_franchisee_profile: hecFp || current.hec_franchisee_profile,
      }));
      setView('application');
      setMessage('Reach sales handoff received. Choose FOFO or FOCO and complete your application.');
      ['hec_lead', 'hec_fp', 'name', 'email', 'mobile', 'location', 'model'].forEach((key) => params.delete(key));
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', next || '/');
      void fetch(`${API_BASE}/content/settings`).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => { if (response.ok && payload?.success) setCompany(normaliseCompany(payload.data)); }).catch(() => undefined);
      return;
    }
    const handoffToken = params.get('rfms_applicant_token');
    if (handoffToken) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, handoffToken);
      params.delete('rfms_applicant_token');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', next || '/');
      void loadProfile(handoffToken);
    } else {
      const savedToken = window.localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
      if (savedToken) void loadProfile(savedToken);
      else if (params.get('view') === 'profile') setView('profile-login');
      else void loadApplication();
    }
    void fetch(`${API_BASE}/content/settings`).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => { if (response.ok && payload?.success) setCompany(normaliseCompany(payload.data)); }).catch(() => undefined);
  }, [loadApplication, loadProfile]);
  useEffect(() => { let active = true; setTerritoryPinsLoading(true); void fetch(`${API_BASE}/territories/pincodes`).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => { if (active && response.ok && payload?.success) setTerritoryPins(Array.isArray(payload.data?.pincodes) ? payload.data.pincodes as TerritoryPin[] : []); }).catch(() => { if (active) setTerritoryPins([]); }).finally(() => { if (active) setTerritoryPinsLoading(false); }); return () => { active = false; }; }, []);
  function setField<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function showView(next: PortalView) { setView(next); const url = new URL(window.location.href); if (next === 'profile-login') url.searchParams.set('view', 'profile'); else url.searchParams.delete('view'); window.history.replaceState({}, '', url); }
  function openProfileLogin() { setError(''); setMessage(''); showView('profile-login'); }
  function profileAuthenticated(token: string, signedInApplication: Application) { window.localStorage.setItem(AUTH_TOKEN_KEY, token); window.localStorage.setItem(STORAGE_KEY, signedInApplication.id); setProfileToken(token); setApplication(signedInApplication); setMessage('Signed in successfully. Your applicant profile is up to date.'); setView('profile'); const url = new URL(window.location.href); url.pathname = '/'; url.search = ''; window.history.replaceState({}, '', url); }

  async function uploadDocument(key: DocumentKey, event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const isPhoto = key === 'photo'; if (file.size > 5 * 1024 * 1024 || (isPhoto && !file.type.startsWith('image/'))) { setError(isPhoto ? 'Your photograph must be an image smaller than 5 MB.' : 'Upload a PDF, PNG, JPG or WEBP file smaller than 5 MB.'); event.target.value = ''; return; } setUploading(key); setError(''); setMessage(''); try { const response = await fetch(`${API_BASE}/applications/public/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: key, name: file.name, data_url: await asDataUrl(file) }) }); const payload = await response.json(); if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to upload this file.'); setDocuments((current) => ({ ...current, [key]: payload.data })); setMessage(`${DOCUMENTS.find((item) => item.key === key)?.title} uploaded.`); } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload this file.'); } finally { setUploading(null); event.target.value = ''; } }
  async function replaceApplicantDocument(key: DocumentKey, event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file || !application || !profileToken) return; const isPhoto = key === 'photo'; if (file.size > 5 * 1024 * 1024 || (isPhoto && !file.type.startsWith('image/'))) { setError(isPhoto ? 'Your photograph must be an image smaller than 5 MB.' : 'Upload a PDF, PNG, JPG or WEBP file smaller than 5 MB.'); event.target.value = ''; return; } setUploading(key); setError(''); setMessage(''); try { const response = await fetch(`${API_BASE}/applicant/documents/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profileToken}` }, body: JSON.stringify({ name: file.name, data_url: await asDataUrl(file) }) }); const payload = await response.json(); if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to replace this document.'); setApplication(payload.data as Application); setMessage(`${DOCUMENTS.find((item) => item.key === key)?.title} replaced and sent for review.`); } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Unable to replace this document.'); } finally { setUploading(null); event.target.value = ''; } }
  async function submitApplication(event: FormEvent<HTMLFormElement>, verification: ContactVerification) { event.preventDefault(); if (DOCUMENTS.some((item) => !documents[item.key])) { setError('Upload your photograph, PAN card, Aadhaar card and Voter ID before continuing to payment.'); return; } if (draft.account_password !== draft.account_password_confirmation) { setError('Your password confirmation does not match.'); return; } setSubmitting(true); setError(''); setMessage(''); try { const response = await fetch(`${API_BASE}/applications/public`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, documents, mobile_verification_token: verification.mobileToken, email_verification_token: verification.emailToken, terms_accepted: verification.termsAccepted === true }) }); const payload = await response.json(); if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to submit the application.'); const saved = payload.data as Application; window.localStorage.setItem(STORAGE_KEY, saved.id); setApplication(saved); setMessage('Application saved. Complete the payment below to submit it to the Remedium franchise team.'); showView('payment'); } catch (submissionError) { setError(submissionError instanceof Error ? submissionError.message : 'Unable to submit the application.'); } finally { setSubmitting(false); } }
  async function logoutApplicant() {
    await secureLogoutApplicant(profileToken);
  }
  function startNewApplication() { window.localStorage.removeItem(STORAGE_KEY); window.localStorage.removeItem(AUTH_TOKEN_KEY); setApplication(null); setProfileToken(''); setDocuments({}); setDraft(EMPTY_DRAFT); setMessage(''); setError(''); showView('application'); }

  if (view === 'profile-login') return <main className="application-shell"><BrandHeader company={company} application={application} onProfile={openProfileLogin} /><ApplicantProfileLogin company={company} onAuthenticated={profileAuthenticated} onCancel={() => application ? showView('payment') : showView('application')} /></main>;
  if (application && view === 'profile') return <main className="application-shell"><ApplicantProfile company={company} application={application} refreshing={refreshing} accountToken={profileToken} uploading={uploading} onRefresh={() => void loadProfile(profileToken, true)} onPaymentPage={() => showView('payment')} onReplaceDocument={replaceApplicantDocument} onApplicationUpdated={setApplication} onLogout={logoutApplicant} onMessage={setMessage} onError={setError} />{message ? <p className="floating-message success" role="status">{message}</p> : null}{error ? <p className="floating-message error" role="alert">{error}</p> : null}</main>;
  if (application) return <main className="application-shell"><BrandHeader company={company} application={application} onProfile={openProfileLogin} /><section className="payment-page"><div className="page-eyebrow">Application submitted</div><h1>Complete your franchise payment plan.</h1><p className="page-intro">{stageLabel(application.stage)}</p><div className="application-summary"><div><span>Applicant</span><b>{application.full_name}</b></div><div><span>Franchise model</span><b>{application.franchise_model}</b></div><div><span>Preferred location</span><b>{application.preferred_location}</b></div></div><PaymentSchedule application={application} company={company} onApplicationUpdated={setApplication} onMessage={setMessage} onError={setError} /><p className="payment-note">Choose Cheque, UPI/card or bank transfer. Offline submissions move to Under Verification until RFMS confirms payment. Gateway payments are marked Paid instantly with a downloadable receipt.</p>{message ? <p className="portal-message success" role="status">{message}</p> : null}{error ? <p className="portal-message error" role="alert">{error}</p> : null}{application.payments.some((payment) => payment.status === 'paid') ? <button className="profile-cta" type="button" onClick={openProfileLogin}>Go to my application profile</button> : null}<button className="new-application" onClick={startNewApplication}>Start a new application</button></section></main>;
  return <main className="application-shell"><BrandHeader company={company} application={null} onProfile={openProfileLogin} /><ApplicationForm company={company} draft={draft} documents={documents} uploading={uploading} submitting={submitting} message={message} error={error} setField={setField} onUpload={uploadDocument} onSubmit={submitApplication} territoryPins={territoryPins} territoryPinsLoading={territoryPinsLoading} /></main>;
}

