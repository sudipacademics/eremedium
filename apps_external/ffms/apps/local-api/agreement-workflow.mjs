import { randomUUID } from 'node:crypto';
import { franchiseeIdForApplication } from './franchisee-id-workflow.mjs';

export const AGREEMENT_TEMPLATE_FOCO = `FRANCHISE AGREEMENT — FOCO MODEL

Agreement Reference: {{agreement_reference}}
Execution Date: {{execution_date}}

Between {{company_name}} ("Franchisor") and {{full_name}} ("Franchisee")

Application Number: {{application_number}}
Franchisee ID: {{franchisee_id}}
Franchise Model: FOCO
Applicant Email: {{email}}
Applicant Mobile: {{mobile}}
PAN: {{pan_number}}
Aadhaar: {{aadhaar_number}}

Allotted Territory: {{territory}}
Franchise Address: {{franchise_address}}

Phase 1 Application Fee Received: {{application_fee_paid}}
Phase 2 Franchise Fee Received: {{franchise_fee_paid}}
Phase 3 Security Deposit Received: {{security_deposit_paid}}

The Franchisee agrees to operate under the FOCO model subject to Remedium Lab quality, branding, territory and operational standards. This agreement is governed by the signed franchise documentation and applicable law.

Signature blocks follow after e-Stamp verification, applicant Aadhaar eSign and company DSC execution.`;

export const AGREEMENT_TEMPLATE_FOFO = `FRANCHISE AGREEMENT — FOFO MODEL

Agreement Reference: {{agreement_reference}}
Execution Date: {{execution_date}}

Between {{company_name}} ("Franchisor") and {{full_name}} ("Franchisee")

Application Number: {{application_number}}
Franchisee ID: {{franchisee_id}}
Franchise Model: FOFO
Applicant Email: {{email}}
Applicant Mobile: {{mobile}}
PAN: {{pan_number}}
Aadhaar: {{aadhaar_number}}

Allotted Territory: {{territory}}
Franchise Address: {{franchise_address}}

FOFO Franchise Fee Received: {{fofo_fee_paid}}

The Franchisee agrees to own and operate the franchise centre under Remedium Lab standards. This agreement is governed by the signed franchise documentation and applicable law.

Signature blocks follow after e-Stamp verification, applicant Aadhaar eSign and company DSC execution.`;

export function agreementReference(application) {
  const base = String(application?.application_number ?? 'RFMS').replace(/[^A-Za-z0-9-]/g, '');
  const version = Number(application?.agreement_workflow?.document?.version) || 1;
  return `AGR-${base}-V${version}`;
}

const POST_APPLICANT_ESIGN_STATUSES = ['applicant_esign_completed', 'company_dsc_completed', 'company_execution_pending', 'executed'];
const PRE_APPLICANT_ESIGN_STATUSES = ['sent_to_applicant', 'draft_ready', 'correction_requested', 'applicant_accepted'];

export function clearApplicantEsignState(workflow) {
  if (!workflow?.applicant || typeof workflow.applicant !== 'object') return;
  workflow.applicant.esign_completed_at = '';
  workflow.applicant.esign_reference = '';
}

export function reconcileAgreementWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object') return false;
  let changed = false;
  const status = workflow.status ?? 'not_started';
  const applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : null;
  const document = workflow.document && typeof workflow.document === 'object' ? workflow.document : null;
  const hasAadhaar = Boolean(document?.aadhaar_signed_file?.url);
  const hasEsign = Boolean(applicant?.esign_completed_at);

  if (PRE_APPLICANT_ESIGN_STATUSES.includes(status) && hasEsign && !hasAadhaar) {
    clearApplicantEsignState(workflow);
    changed = true;
  }

  if (status === 'sent_to_applicant' && hasAadhaar && hasEsign) {
    workflow.status = 'applicant_esign_completed';
    changed = true;
  }

  return changed;
}

export function applicantEsignIsComplete(workflow) {
  if (!workflow || typeof workflow !== 'object') return false;
  const status = workflow.status ?? 'not_started';
  return POST_APPLICANT_ESIGN_STATUSES.includes(status) && Boolean(workflow.document?.aadhaar_signed_file?.url);
}

export function agreementStatusLabel(status) {
  return ({
    not_started: 'Not started',
    in_process: 'Agreement in process',
    estamp_pending: 'Awaiting e-Stamp upload',
    estamp_verified: 'e-Stamp verified',
    draft_ready: 'Agreement uploaded — ready for review',
    sent_to_applicant: 'Agreement ready for review',
    correction_requested: 'Applicant requested corrections',
    applicant_accepted: 'Applicant accepted terms',
    applicant_esign_completed: 'Applicant Aadhaar eSign completed',
    company_dsc_completed: 'Company DSC completed',
    company_execution_pending: 'Manager signed copy uploaded — pending save',
    executed: 'Agreement executed',
  })[status] ?? 'Agreement in process';
}

function agreementFileSummary(file, resolveUploadUrl) {
  if (!file || typeof file !== 'object') return null;
  return {
    id: file.id ?? '',
    name: file.name ?? 'Agreement document',
    url: resolveUploadUrl(file.url),
    mime: file.mime ?? 'application/pdf',
    uploaded_at: file.uploaded_at ?? '',
    uploaded_by: file.uploaded_by ?? '',
  };
}

export function pushAgreementVersion(workflow, entry) {
  workflow.versions = Array.isArray(workflow.versions) ? workflow.versions : [];
  workflow.versions.push({ id: randomUUID(), created_at: new Date().toISOString(), ...entry });
  workflow.versions = workflow.versions.slice(-100);
}

export function agreementDeliveredToApplicant(workflow) {
  if (!workflow || workflow.status !== 'executed') return false;
  if (!workflow.document?.executed_file?.url) return false;
  if (workflow.executed?.delivered_to_applicant_at) return true;
  return Boolean(workflow.executed?.executed_at) && !workflow.document?.pending_executed_file;
}

export function activeAgreementFile(workflow) {
  if (!workflow?.document) return null;
  const document = workflow.document;
  if (workflow.status === 'executed' && document.executed_file) return document.executed_file;
  if (workflow.status === 'company_execution_pending' && document.aadhaar_signed_file) return document.aadhaar_signed_file;
  if (['applicant_esign_completed', 'company_dsc_completed'].includes(workflow.status) && document.aadhaar_signed_file) return document.aadhaar_signed_file;
  if (document.uploaded_file) return document.uploaded_file;
  return null;
}

export function applicantAgreementPermissions(workflow) {
  const status = workflow?.status ?? 'not_started';
  const executedReady = agreementDeliveredToApplicant(workflow);
  return {
    can_view: ['sent_to_applicant', 'correction_requested', 'applicant_accepted', 'applicant_esign_completed', 'company_dsc_completed', 'company_execution_pending', 'executed'].includes(status),
    can_download: executedReady,
    can_accept_esign: status === 'sent_to_applicant',
    can_request_corrections: status === 'sent_to_applicant',
    can_request_changes: status === 'sent_to_applicant',
    view_only: !executedReady,
  };
}

export function managerAgreementPermissions(workflow) {
  const status = workflow?.status ?? 'not_started';
  const correctionRequest = String(workflow?.applicant?.correction_request ?? '').trim();
  const correctionDecision = String(workflow?.applicant?.correction_decision ?? '').trim();
  const pendingExecuted = Boolean(workflow?.document?.pending_executed_file?.url);
  const applicantSignedReady = applicantEsignIsComplete(workflow)
    || (Boolean(workflow?.document?.aadhaar_signed_file?.url) && Boolean(workflow?.applicant?.esign_completed_at));
  return {
    can_download_aadhaar_signed: ['applicant_esign_completed', 'company_dsc_completed', 'company_execution_pending', 'executed'].includes(status) || applicantSignedReady,
    can_apply_dsc: status === 'applicant_esign_completed',
    can_upload_manual_executed: ['applicant_esign_completed', 'company_execution_pending', 'executed'].includes(status) || applicantSignedReady,
    can_save_executed_agreement: status === 'company_execution_pending' && pendingExecuted,
    can_download_executed: agreementDeliveredToApplicant(workflow),
    can_respond_to_correction: status === 'correction_requested' && Boolean(correctionRequest) && !correctionDecision,
    correction_pending: status === 'correction_requested' && Boolean(correctionRequest) && !correctionDecision,
  };
}

export function agreementEligibleForProceed(application) {
  if (!application) return false;
  const status = application.agreement_workflow?.status ?? 'not_started';
  if (status !== 'not_started') return false;
  if (application.franchise_model === 'FOCO') {
    return application.payments?.some((payment) => payment.key === 'security_deposit' && payment.status === 'paid') === true;
  }
  return application.branding_signage?.status === 'approved'
    && application.payments?.some((payment) => payment.key === 'fofo_one_time_fee' && payment.status === 'paid') === true;
}

export function agreementQueueEligible(application) {
  const status = application?.agreement_workflow?.status ?? 'not_started';
  return status !== 'not_started';
}

export function agreementWorkflowSummary(value, resolveUploadUrl) {
  if (!value || typeof value !== 'object') return null;
  const estamp = value.estamp && typeof value.estamp === 'object' ? value.estamp : null;
  const document = value.document && typeof value.document === 'object' ? value.document : null;
  const applicant = value.applicant && typeof value.applicant === 'object' ? value.applicant : null;
  const company = value.company && typeof value.company === 'object' ? value.company : null;
  const executed = value.executed && typeof value.executed === 'object' ? value.executed : null;
  const permissions = applicantAgreementPermissions(value);
  const managerPermissions = managerAgreementPermissions(value);
  const viewFile = activeAgreementFile(value);
  return {
    id: value.id ?? '',
    status: value.status ?? 'not_started',
    status_label: agreementStatusLabel(value.status ?? 'not_started'),
    initiated_at: value.initiated_at ?? '',
    initiated_by: value.initiated_by ?? '',
    reference_number: value.reference_number ?? '',
    estamp: estamp ? {
      state: estamp.state ?? '',
      stamp_duty_value: Number(estamp.stamp_duty_value) || 0,
      purpose: estamp.purpose ?? '',
      execution_date: estamp.execution_date ?? '',
      certificate_number: estamp.certificate_number ?? '',
      uin: estamp.uin ?? '',
      vendor: estamp.vendor ?? '',
      certificate: estamp.certificate && typeof estamp.certificate === 'object'
        ? { name: estamp.certificate.name ?? '', url: resolveUploadUrl(estamp.certificate.url) }
        : null,
      verified_at: estamp.verified_at ?? '',
      verified_by: estamp.verified_by ?? '',
    } : null,
    document: document ? {
      template_key: document.template_key ?? '',
      version: Number(document.version) || 1,
      body: document.body ?? '',
      draft_body: document.draft_body ?? '',
      generated_at: document.generated_at ?? '',
      generated_by: document.generated_by ?? '',
      sent_to_applicant_at: document.sent_to_applicant_at ?? '',
      uploaded_file: agreementFileSummary(document.uploaded_file, resolveUploadUrl),
      aadhaar_signed_file: agreementFileSummary(document.aadhaar_signed_file, resolveUploadUrl),
      pending_executed_file: agreementFileSummary(document.pending_executed_file, resolveUploadUrl),
      executed_file: agreementFileSummary(document.executed_file, resolveUploadUrl),
    } : null,
    view_document: agreementFileSummary(viewFile, resolveUploadUrl),
    permissions,
    manager_permissions: managerPermissions,
    execution_method: value.execution_method ?? '',
    versions: Array.isArray(value.versions) ? value.versions.slice(-100).map((version) => ({
      id: version.id ?? '',
      type: version.type ?? '',
      name: version.name ?? '',
      url: resolveUploadUrl(version.url),
      mime: version.mime ?? '',
      actor: version.actor ?? '',
      reference: version.reference ?? '',
      created_at: version.created_at ?? '',
      message: version.message ?? '',
    })) : [],
    applicant: applicant ? {
      terms_accepted_at: applicant.terms_accepted_at ?? '',
      correction_request: applicant.correction_request ?? '',
      correction_requested_at: applicant.correction_requested_at ?? '',
      correction_decision: applicant.correction_decision ?? '',
      correction_decision_at: applicant.correction_decision_at ?? '',
      correction_decision_by: applicant.correction_decision_by ?? '',
      correction_response: applicant.correction_response ?? '',
      esign_completed_at: applicant.esign_completed_at ?? '',
      esign_reference: applicant.esign_reference ?? '',
    } : null,
    company: company ? {
      dsc_signed_at: company.dsc_signed_at ?? '',
      dsc_signed_by: company.dsc_signed_by ?? '',
      dsc_reference: company.dsc_reference ?? '',
    } : null,
    executed: executed ? {
      agreement_url: resolveUploadUrl(executed.agreement_url),
      executed_at: executed.executed_at ?? '',
      delivered_to_applicant_at: executed.delivered_to_applicant_at ?? '',
      qr_reference: executed.qr_reference ?? '',
    } : null,
    history: Array.isArray(value.history) ? value.history.slice(-100) : [],
  };
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

export function buildAgreementPlaceholders(application, profile, workflow) {
  const allotment = application?.territory_allotment;
  const paid = (key) => application?.payments?.some((payment) => payment.key === key && payment.status === 'paid') ? 'Yes' : 'No';
  return {
    agreement_reference: workflow?.reference_number || agreementReference(application),
    execution_date: workflow?.estamp?.execution_date || new Date().toISOString().slice(0, 10),
    company_name: profile?.company_name || 'Remedium Lab',
    full_name: application?.full_name || '',
    application_number: application?.application_number || '',
    franchisee_id: franchiseeIdForApplication(application),
    email: application?.email || '',
    mobile: application?.mobile || '',
    pan_number: application?.pan_number || '',
    aadhaar_number: application?.aadhaar_number || '',
    territory: allotment?.final_territory || application?.preferred_location || '',
    franchise_address: allotment?.franchise_address || application?.address || '',
    application_fee_paid: paid('application_fee'),
    franchise_fee_paid: paid('franchise_fee'),
    security_deposit_paid: paid('security_deposit'),
    fofo_fee_paid: paid('fofo_one_time_fee'),
  };
}

export function renderAgreementTemplate(template, placeholders) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? '');
}

export function createAgreementWorkflow(application, actorName) {
  const now = new Date().toISOString();
  const workflow = {
    id: randomUUID(),
    status: 'in_process',
    initiated_at: now,
    initiated_by: actorName,
    reference_number: agreementReference(application),
    estamp: null,
    document: null,
    applicant: null,
    company: null,
    executed: null,
    execution_method: '',
    versions: [],
    history: [{ id: randomUUID(), type: 'agreement_initiated', message: 'Manager proceeded to final agreement. Agreement process started.', actor: actorName, created_at: now }],
  };
  application.agreement_workflow = workflow;
  application.stage = 'agreement_in_process';
  return workflow;
}

export function agreementAudit(workflow, type, message, actor) {
  workflow.history = Array.isArray(workflow.history) ? workflow.history : [];
  workflow.history.push({ id: randomUUID(), type, message, actor, created_at: new Date().toISOString() });
  workflow.history = workflow.history.slice(-100);
}

export function buildExecutedAgreementText(application, profile, workflow) {
  const body = workflow.document?.draft_body || workflow.document?.body || '';
  const estamp = workflow.estamp;
  const lines = [
    'EXECUTED FRANCHISE AGREEMENT',
    `Agreement Reference: ${workflow.reference_number}`,
    `Executed At: ${workflow.executed?.executed_at || new Date().toISOString()}`,
    `QR Reference: ${workflow.executed?.qr_reference || workflow.reference_number}`,
    '',
    'e-Stamp Certificate',
    `State: ${estamp?.state || '—'}`,
    `Certificate Number: ${estamp?.certificate_number || '—'}`,
    `UIN: ${estamp?.uin || '—'}`,
    `Stamp Duty: ${money(estamp?.stamp_duty_value)}`,
    '',
    'Applicant Aadhaar eSign',
    `Completed: ${workflow.applicant?.esign_completed_at || '—'}`,
    `Reference: ${workflow.applicant?.esign_reference || '—'}`,
    '',
    'Company DSC Signature',
    `Signed: ${workflow.company?.dsc_signed_at || '—'}`,
    `Signatory: ${workflow.company?.dsc_signed_by || '—'}`,
    `Reference: ${workflow.company?.dsc_reference || '—'}`,
    '',
    '--- Agreement Body ---',
    body,
  ];
  return lines.join('\n');
}
