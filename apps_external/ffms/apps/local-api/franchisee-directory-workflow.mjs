import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { franchiseeIdForApplication } from './franchisee-id-workflow.mjs';

export const FRANCHISEE_DIRECTORY_API_VERSION = '1.0';

export const FRANCHISEE_DIRECTORY_EXPORT_FIELDS = [
  'identifiers',
  'basic_details',
  'google_map_location_url',
  'territory',
  'payments',
  'agreement',
  'field_visit',
  'branding',
  'hr',
  'training',
  'certificates',
  'webpage',
  'onboarding_journey',
];

const SENSITIVE_EXPORT_FIELDS = new Set([
  'aadhaar_number',
  'account_password_hash',
  'account_password_salt',
  'internal_remarks',
  'manager_remarks',
  'review_notes',
  'secure_token',
]);

const partnerRateLimits = new Map();

export function defaultFranchiseeDirectoryApiSettings() {
  return {
    enabled: false,
    api_token_prefix: '',
    api_token_hash: '',
    api_token_salt: '',
    rate_limit_per_minute: 60,
    allowed_fields: [...FRANCHISEE_DIRECTORY_EXPORT_FIELDS],
    version: FRANCHISEE_DIRECTORY_API_VERSION,
    updated_at: '',
    updated_by: '',
  };
}

export function ensureFranchiseeDirectoryApiSettings(database) {
  if (!database.franchisee_directory_api || typeof database.franchisee_directory_api !== 'object') {
    database.franchisee_directory_api = defaultFranchiseeDirectoryApiSettings();
  }
  const settings = database.franchisee_directory_api;
  if (!Array.isArray(settings.allowed_fields) || !settings.allowed_fields.length) {
    settings.allowed_fields = [...FRANCHISEE_DIRECTORY_EXPORT_FIELDS];
  }
  if (!Number.isFinite(Number(settings.rate_limit_per_minute)) || Number(settings.rate_limit_per_minute) < 1) {
    settings.rate_limit_per_minute = 60;
  }
  return settings;
}

export function franchiseeDirectoryApiSettingsSummary(settings) {
  const source = settings && typeof settings === 'object' ? settings : defaultFranchiseeDirectoryApiSettings();
  return {
    enabled: Boolean(source.enabled),
    has_token: Boolean(source.api_token_hash),
    api_token_prefix: String(source.api_token_prefix ?? ''),
    rate_limit_per_minute: Math.max(1, Number(source.rate_limit_per_minute) || 60),
    allowed_fields: Array.isArray(source.allowed_fields) ? source.allowed_fields.filter((field) => FRANCHISEE_DIRECTORY_EXPORT_FIELDS.includes(field)) : [...FRANCHISEE_DIRECTORY_EXPORT_FIELDS],
    version: String(source.version ?? FRANCHISEE_DIRECTORY_API_VERSION),
    updated_at: String(source.updated_at ?? ''),
    updated_by: String(source.updated_by ?? ''),
  };
}

export function generatePartnerApiToken() {
  const token = `rfms_fd_${randomBytes(24).toString('hex')}`;
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(token, salt, 64).toString('hex');
  return {
    token,
    api_token_prefix: token.slice(0, 12),
    api_token_hash: hash,
    api_token_salt: salt,
  };
}

export function partnerApiTokenMatches(settings, token) {
  if (!settings?.api_token_hash || !settings?.api_token_salt || typeof token !== 'string' || !token.startsWith('rfms_fd_')) return false;
  const saved = Buffer.from(settings.api_token_hash, 'hex');
  const candidate = scryptSync(token, settings.api_token_salt, 64);
  return saved.length === candidate.length && timingSafeEqual(saved, candidate);
}

export function franchiseeDirectoryApiSettingsFromBody(body, current, actor) {
  const source = body && typeof body === 'object' ? body : {};
  const base = current && typeof current === 'object' ? current : defaultFranchiseeDirectoryApiSettings();
  const allowedFields = Array.isArray(source.allowed_fields)
    ? source.allowed_fields.filter((field) => FRANCHISEE_DIRECTORY_EXPORT_FIELDS.includes(String(field)))
    : base.allowed_fields;
  const next = {
    ...base,
    enabled: typeof source.enabled === 'boolean' ? source.enabled : Boolean(base.enabled),
    rate_limit_per_minute: Math.min(600, Math.max(1, Number(source.rate_limit_per_minute) || base.rate_limit_per_minute || 60)),
    allowed_fields: allowedFields.length ? allowedFields : [...FRANCHISEE_DIRECTORY_EXPORT_FIELDS],
    version: FRANCHISEE_DIRECTORY_API_VERSION,
    updated_at: new Date().toISOString(),
    updated_by: actor,
  };
  if (source.regenerate_token === true) {
    const generated = generatePartnerApiToken();
    next.api_token_prefix = generated.api_token_prefix;
    next.api_token_hash = generated.api_token_hash;
    next.api_token_salt = generated.api_token_salt;
    next.generated_token = generated.token;
  }
  return next;
}

export function isOnboardedFranchisee(application) {
  return Boolean(application?.visible_to_admin && application?.stage === 'onboarding_completed');
}

export function businessIdForApplication(application) {
  if (application?.business_id) return String(application.business_id);
  return `BUS-${String(application?.application_number ?? application?.id ?? 'UNKNOWN').replace(/[^A-Za-z0-9-]/g, '')}`;
}

export function franchiseeBusinessName(application) {
  return String(
    application?.onboarding_certificate?.business_name
    || application?.training?.business_name
    || application?.territory_allotment?.final_territory
    || application?.full_name
    || '',
  ).trim();
}

export function onboardingCompletedAt(application) {
  if (application?.onboarding_completed_at) return application.onboarding_completed_at;
  const history = Array.isArray(application?.review_history) ? application.review_history : [];
  const onboarded = history.find((entry) => entry.type === 'application_onboarded');
  if (onboarded?.created_at) return onboarded.created_at;
  return application?.onboarding_certificate?.issued_at || application?.updated_at || application?.created_at || '';
}

export function franchiseeOperationalStatus(application) {
  if (application?.stage === 'onboarding_completed') return 'onboarded';
  if (application?.stage === 'go_live') return 'go_live';
  if (application?.stage === 'active') return 'active';
  return application?.stage || 'unknown';
}

function fileAsset(value, resolveUploadUrl, label = '') {
  if (!value || typeof value !== 'object' || !value.url) return null;
  return {
    id: String(value.id ?? randomUUID()),
    name: String(value.name ?? label ?? 'Document'),
    mime: String(value.mime ?? ''),
    url: resolveUploadUrl(value.url),
    uploaded_at: String(value.uploaded_at ?? ''),
  };
}

function ensureFranchiseeDirectoryVersions(application) {
  if (!Array.isArray(application.franchisee_directory_versions)) application.franchisee_directory_versions = [];
  return application.franchisee_directory_versions;
}

export function appendFranchiseeDirectoryVersion(application, actor, summary, snapshot) {
  const versions = ensureFranchiseeDirectoryVersions(application);
  const entry = {
    id: randomUUID(),
    version: versions.length + 1,
    summary: String(summary ?? 'Directory snapshot recorded'),
    actor: String(actor ?? 'System'),
    recorded_at: new Date().toISOString(),
    snapshot,
  };
  versions.push(entry);
  application.franchisee_directory_versions = versions.slice(-30);
  return entry;
}

function text(value, maxLength = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function googleMapsLocationUrl(value) {
  const raw = text(value, 1000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const isGoogleMapsHost = host === 'maps.app.goo.gl' || host === 'goo.gl' || /^([a-z0-9-]+\.)?google\.(com|co\.in)$/.test(host);
    if (!['https:', 'http:'].includes(parsed.protocol) || !isGoogleMapsHost) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function resolveFranchiseeGoogleMapLocationUrl(application, webpageGoogleMapLink = '') {
  const stored = googleMapsLocationUrl(application?.google_map_location_url);
  if (stored) return stored;
  const territory = application?.territory_allotment && typeof application.territory_allotment === 'object' ? application.territory_allotment : null;
  const fromTerritory = googleMapsLocationUrl(territory?.google_maps_url);
  if (fromTerritory) return fromTerritory;
  const fieldVisit = application?.field_visit && typeof application.field_visit === 'object' ? application.field_visit : null;
  const fromFieldVisit = googleMapsLocationUrl(fieldVisit?.report?.google_maps_url);
  if (fromFieldVisit) return fromFieldVisit;
  return googleMapsLocationUrl(webpageGoogleMapLink);
}

export function updateFranchiseeGoogleMapLocationUrl(application, value, actor, helpers) {
  const supplied = text(value, 1000);
  if (supplied && !googleMapsLocationUrl(supplied)) {
    return { error: 'Enter a valid Google Maps location link from google.com, google.co.in, maps.app.goo.gl or goo.gl.' };
  }
  application.google_map_location_url = supplied ? googleMapsLocationUrl(supplied) : '';
  application.updated_at = new Date().toISOString();
  const snapshot = buildDirectorySnapshot(application, helpers);
  appendFranchiseeDirectoryVersion(application, actor, 'Google Maps location link updated', snapshot);
  return { snapshot, url: snapshot.google_map_location_url };
}

function readableStatus(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 'Pending';
  if (['approved', 'executed', 'completed', 'paid', 'verified'].includes(normalized)) return 'Completed';
  if (['assigned', 'submitted', 'in_progress', 'pending', 'replied'].includes(normalized)) return 'In Progress';
  return normalized.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildOnboardingJourneyStages(application) {
  const stage = (stageName, completedBy, status, completedAt, remarks) => ({
    stage_name: stageName,
    completed_by: completedBy || '—',
    status,
    completion_date_time: completedAt || '',
    remarks: remarks || '—',
  });
  const isFoco = application.franchise_model === 'FOCO';
  const stages = [];
  stages.push(stage('Application Submitted', application.full_name, 'Completed', application.created_at, `Application ${application.application_number} submitted for ${application.franchise_model} franchise onboarding.`));

  const paidPayments = (Array.isArray(application.payments) ? application.payments : []).filter((item) => item.status === 'paid');
  if (paidPayments.length) {
    const latestPaidAt = paidPayments.map((item) => item.paid_at).filter(Boolean).sort().at(-1) ?? '';
    stages.push(stage('Payments', 'Applicant', 'Completed', latestPaidAt, paidPayments.map((item) => `${item.label}${item.receipt_number ? ` (${item.receipt_number})` : ''}`).join('; ')));
  } else {
    stages.push(stage('Payments', '—', 'Pending', '', 'No verified payment receipts recorded.'));
  }

  const verifications = application.document_verifications && typeof application.document_verifications === 'object' ? application.document_verifications : {};
  const verificationEntries = Object.values(verifications);
  const verifiedEntries = verificationEntries.filter((item) => item?.status === 'verified');
  const latestKycVerification = verifiedEntries.map((item) => item.verified_at).filter(Boolean).sort().at(-1) ?? '';
  const kycComplete = verificationEntries.length > 0 && verificationEntries.every((item) => item?.status === 'verified');
  stages.push(stage('KYC Verification', verifiedEntries.at(-1)?.verified_by ?? 'Franchise manager', kycComplete ? 'Completed' : verificationEntries.length ? 'In Progress' : 'Pending', latestKycVerification, kycComplete ? 'All mandatory KYC documents verified.' : 'KYC document verification pending or incomplete.'));

  const sessions = Array.isArray(application.video_kyc_sessions) ? application.video_kyc_sessions : [];
  const completedSession = sessions.find((item) => item.status === 'completed') ?? null;
  stages.push(stage('Video KYC', completedSession?.completed_by || completedSession?.assigned_by || 'Video KYC officer', completedSession ? 'Completed' : sessions.length ? 'In Progress' : 'Pending', completedSession?.completed_at || completedSession?.started_at || '', completedSession ? `Video KYC session ${completedSession.attempt ?? 1} completed.` : 'Video KYC not completed.'));

  const fieldVisit = application.field_visit && typeof application.field_visit === 'object' ? application.field_visit : null;
  stages.push(stage('Field Visit', fieldVisit?.approved_by || fieldVisit?.officer_name || 'Field officer', fieldVisit?.status === 'approved' ? 'Completed' : fieldVisit ? readableStatus(fieldVisit.status) : 'Pending', fieldVisit?.approved_at || fieldVisit?.submitted_at || fieldVisit?.assigned_at || '', fieldVisit?.report?.recommendation || fieldVisit?.manager_remarks || (fieldVisit?.status === 'approved' ? 'Field visit report approved.' : 'Field visit pending or not approved.')));

  const territory = application.territory_allotment && typeof application.territory_allotment === 'object' ? application.territory_allotment : null;
  stages.push(stage('Territory Allocation', territory?.issued_by || 'Territory manager', territory?.letter_number ? 'Completed' : 'Pending', territory?.issued_at || territory?.effective_date || '', territory ? `${territory.final_territory || territory.registered_territory_label || 'Territory allotted'}${territory.letter_number ? ` · Letter ${territory.letter_number}` : ''}` : 'Territory not allotted.'));

  const branding = application.branding_signage && typeof application.branding_signage === 'object' ? application.branding_signage : null;
  stages.push(stage('Branding Signage', branding?.approved_by || branding?.submitted_by || branding?.vendor?.name || 'Branding vendor', branding?.status === 'approved' ? 'Completed' : branding ? readableStatus(branding.status) : 'Pending', branding?.approved_at || branding?.submitted_at || '', branding?.completion_details || (branding?.status === 'approved' ? 'Branding signage approved.' : 'Branding signage pending.')));

  if (isFoco) {
    const hr = application.hr_process && typeof application.hr_process === 'object' ? application.hr_process : null;
    stages.push(stage('HR Process', hr?.approved_by || hr?.submitted_by || 'HR manager', hr?.status === 'approved' ? 'Completed' : hr ? readableStatus(hr.status) : 'Pending', hr?.approved_at || hr?.submitted_at || '', Array.isArray(hr?.employees) && hr.employees.length ? `${hr.employees.length} staff member(s) recorded with offer letters.` : 'HR staffing process pending.'));
  }

  const agreement = application.agreement_workflow && typeof application.agreement_workflow === 'object' ? application.agreement_workflow : null;
  stages.push(stage('Agreement', agreement?.company?.dsc_signed_by || 'Legal / Manager', agreement?.status === 'executed' ? 'Completed' : agreement ? readableStatus(agreement.status) : 'Pending', agreement?.executed?.executed_at || agreement?.company?.dsc_signed_at || agreement?.applicant?.esign_completed_at || '', agreement?.reference_number ? `Agreement reference ${agreement.reference_number}.` : 'Agreement execution pending.'));

  const training = application.training && typeof application.training === 'object' ? application.training : null;
  stages.push(stage('Training', training?.certificate?.issued_by || training?.unlocked_by || 'Training manager', training?.completed_at || training?.certificate?.pdf?.url ? 'Completed' : training?.unlocked_at ? 'In Progress' : 'Pending', training?.completed_at || training?.certificate?.issued_at || training?.unlocked_at || '', training?.progress ? `${training.progress.completed}/${training.progress.total} training modules completed.` : 'Training journey pending.'));

  const trainingCertificate = training?.certificate?.pdf?.url ? training.certificate : null;
  const onboardingCertificate = application.onboarding_certificate?.pdf?.url ? application.onboarding_certificate : null;
  const certificateIssuedAt = [trainingCertificate?.issued_at, onboardingCertificate?.issued_at].filter(Boolean).sort().at(-1) ?? '';
  stages.push(stage('Certificate Generation', onboardingCertificate?.issued_by || trainingCertificate?.issued_by || 'RFMS Admin', trainingCertificate && onboardingCertificate ? 'Completed' : trainingCertificate || onboardingCertificate ? 'In Progress' : 'Pending', certificateIssuedAt, [trainingCertificate?.certificate_number ? `Training certificate ${trainingCertificate.certificate_number}` : '', onboardingCertificate?.certificate_number ? `Onboarding certificate ${onboardingCertificate.certificate_number}` : ''].filter(Boolean).join(' · ') || 'Certificates pending.'));

  stages.push(stage('Onboarded', onboardingCertificate?.issued_by || 'RFMS Admin', application.stage === 'onboarding_completed' ? 'Completed' : 'Pending', onboardingCompletedAt(application), application.stage === 'onboarding_completed' ? `Franchise onboarding completed${franchiseeIdForApplication(application) ? ` · Franchisee ID ${franchiseeIdForApplication(application)}` : ''}.` : 'Franchise onboarding not completed.'));

  return stages;
}

function buildTimeline(application) {
  const events = [];
  const push = (type, label, at, actor = '') => {
    if (!at) return;
    events.push({ id: `${type}-${at}`, type, label, at, actor });
  };
  push('application_submitted', 'Application submitted', application.created_at, application.full_name);
  const payments = Array.isArray(application.payments) ? application.payments : [];
  payments.filter((item) => item.status === 'paid').forEach((item) => push(`payment_${item.key}`, `${item.label} received`, item.paid_at, 'Applicant'));
  push('territory_allotted', 'Territory allotted', application.territory_allotment?.issued_at, application.territory_allotment?.issued_by);
  push('field_visit_approved', 'Field visit approved', application.field_visit?.approved_at, application.field_visit?.approved_by);
  push('branding_approved', 'Branding signage approved', application.branding_signage?.approved_at, application.branding_signage?.approved_by);
  push('hr_approved', 'HR process approved', application.hr_process?.approved_at, application.hr_process?.approved_by);
  push('agreement_executed', 'Agreement executed', application.agreement_workflow?.executed?.executed_at, application.agreement_workflow?.company?.dsc_signed_by);
  push('training_completed', 'Training completed', application.training?.completed_at, application.training?.unlocked_by);
  push('training_certificate', 'Training certificate issued', application.training?.certificate?.issued_at, application.training?.certificate?.issued_by);
  push('onboarding_certificate', 'Onboarding certificate issued', application.onboarding_certificate?.issued_at, application.onboarding_certificate?.issued_by);
  push('onboarded', 'Franchise onboarding completed', onboardingCompletedAt(application), application.onboarding_certificate?.issued_by);
  const reviewHistory = Array.isArray(application.review_history) ? application.review_history : [];
  reviewHistory.forEach((entry) => push(String(entry.type), String(entry.message ?? entry.type), entry.created_at, entry.actor));
  return events
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((first, second) => String(first.at).localeCompare(String(second.at)));
}

function buildDirectorySnapshot(application, helpers) {
  const {
    resolveUploadUrl,
    territoryAllotmentSummary,
    fieldVisitSummary,
    brandingSignageSummary,
    hrProcessSummary,
    agreementWorkflowSummary,
    trainingWorkflowSummary,
    onboardingCertificateWorkflowSummary,
    franchiseWebpageRecord,
    franchiseWebpageByApplicationId,
    trainingVideos,
  } = helpers;

  const territory = territoryAllotmentSummary(application.territory_allotment);
  const webpageSource = franchiseWebpageByApplicationId(application.id);
  const webpage = webpageSource ? franchiseWebpageRecord(webpageSource, resolveUploadUrl) : null;
  const agreement = agreementWorkflowSummary(application.agreement_workflow, resolveUploadUrl);
  const training = trainingWorkflowSummary(application, trainingVideos, resolveUploadUrl);
  const onboardingCertificate = onboardingCertificateWorkflowSummary(application, resolveUploadUrl);
  const fieldVisit = fieldVisitSummary(application.field_visit);
  const branding = brandingSignageSummary(application.branding_signage);
  const hr = hrProcessSummary(application.hr_process);
  const businessName = franchiseeBusinessName(application);
  const registeredAddress = territory?.franchise_address || application.address || '';
  const googleMapsUrl = resolveFranchiseeGoogleMapLocationUrl(application, webpage?.settings?.google_map_link || '');

  return {
    identifiers: {
      franchisee_id: franchiseeIdForApplication(application),
      application_id: application.id,
      application_number: application.application_number,
      business_id: businessIdForApplication(application),
      webpage_id: webpage?.id || application.franchise_webpage_id || '',
    },
    basic_details: {
      franchisee_name: businessName,
      applicant_name: application.full_name,
      business_name: businessName,
      franchise_model: application.franchise_model,
      registered_address: registeredAddress,
      contact_number: application.mobile,
      email_address: application.email,
      google_maps_location: googleMapsUrl,
      district: territory?.district || application.district || '',
      pincode: territory?.pincode || application.pincode || '',
      preferred_location: application.preferred_location || '',
      application_submitted_at: application.created_at,
      onboarding_completed_at: onboardingCompletedAt(application),
      current_status: franchiseeOperationalStatus(application),
    },
    google_map_location_url: googleMapsUrl,
    territory: territory ? {
      ...territory,
      territory_allotment_letter: territory.letter_number,
      allotted_territory: territory.final_territory || territory.registered_territory_label,
      radius_km: territory.radius_km,
      letter_number: territory.letter_number,
      history: territory.history ?? [],
    } : null,
    payments: {
      items: (Array.isArray(application.payments) ? application.payments : []).map((payment) => ({
        key: payment.key,
        label: payment.label,
        amount: payment.amount,
        purpose: payment.purpose,
        status: payment.status,
        receipt_number: payment.receipt_number ?? '',
        paid_at: payment.paid_at ?? '',
        receipt: payment.status === 'paid' ? {
          name: `${payment.label} receipt`,
          url: `/api/v1/applications/public/${application.id}/payments/${payment.key}/receipt`,
        } : null,
      })),
    },
    agreement: agreement ? {
      status: agreement.status,
      status_label: agreement.status_label,
      reference_number: agreement.reference_number,
      executed_at: agreement.executed?.executed_at ?? '',
      executed_agreement: fileAsset(agreement.document?.executed_file, resolveUploadUrl, 'Executed agreement')
        || (agreement.executed?.agreement_url ? { id: randomUUID(), name: 'Executed agreement', url: agreement.executed.agreement_url, mime: 'application/pdf', uploaded_at: agreement.executed.executed_at ?? '' } : null),
      applicant_esign_reference: agreement.applicant?.esign_reference ?? '',
      company_dsc_signed_by: agreement.company?.dsc_signed_by ?? '',
    } : null,
    field_visit: fieldVisit ? {
      status: fieldVisit.status,
      field_officer_name: fieldVisit.officer_name,
      field_officer_contact: fieldVisit.officer_phone,
      approved_at: fieldVisit.approved_at,
      approved_by: fieldVisit.approved_by,
      report: fieldVisit.report,
      history: fieldVisit.history ?? [],
    } : null,
    branding: branding ? {
      status: branding.status,
      vendor_name: branding.vendor?.name ?? '',
      vendor_contact_number: branding.vendor?.phone ?? '',
      vendor_address: branding.vendor?.address ?? '',
      vendor_shop_name: branding.vendor?.shop_name ?? '',
      installation_cost: branding.installation_cost,
      completion_details: branding.completion_details,
      materials: branding.materials ?? [],
      photographs: branding.photographs ?? [],
      invoice: branding.invoice,
      approved_at: branding.approved_at,
      approved_by: branding.approved_by,
      history: branding.history ?? [],
    } : null,
    hr: hr ? {
      status: hr.status,
      staff: (hr.employees ?? []).map((employee) => ({
        id: employee.id,
        name: employee.name,
        designation: employee.designation,
        phone: employee.phone,
        joining_date: employee.joining_date,
        details: employee.details,
        offer_letter: employee.offer_letter,
      })),
      approved_at: hr.approved_at,
      approved_by: hr.approved_by,
      history: hr.history ?? [],
    } : null,
    training: training ? {
      unlocked_at: training.unlocked_at,
      completed_at: training.completed_at,
      business_name: training.business_name,
      franchise_address: training.franchise_address,
      progress: training.progress,
      videos: training.videos ?? [],
      certificate: training.certificate ?? null,
      history: training.history ?? [],
    } : null,
    certificates: {
      training_completion: training?.certificate ?? null,
      onboarding_welcome: onboardingCertificate.certificate ?? null,
    },
    webpage: webpage ? {
      id: webpage.id,
      public_url: webpage.public_url,
      html_url: webpage.html_url,
      enabled: webpage.enabled,
      preview_image: webpage.settings?.branch_images?.[0]?.url || webpage.settings?.hero_background_url || '',
      settings: {
        business_name: webpage.settings?.business_name ?? '',
        branch_address: webpage.settings?.branch_address ?? '',
        contact_number: webpage.settings?.contact_number ?? '',
        google_map_link: webpage.settings?.google_map_link ?? '',
      },
    } : null,
    onboarding_journey: {
      application_submitted_at: application.created_at,
      onboarding_completed_at: onboardingCompletedAt(application),
      timeline: buildTimeline(application),
      stages: buildOnboardingJourneyStages(application),
    },
  };
}

export function franchiseeDirectorySnapshot(application, helpers) {
  return buildDirectorySnapshot(application, helpers);
}

export function franchiseeDirectoryListItem(application, helpers) {
  const snapshot = buildDirectorySnapshot(application, helpers);
  const territory = snapshot.territory;
  return {
    franchisee_id: snapshot.identifiers.franchisee_id,
    application_id: snapshot.identifiers.application_id,
    application_number: snapshot.identifiers.application_number,
    business_id: snapshot.identifiers.business_id,
    business_name: snapshot.basic_details.business_name,
    franchisee_name: snapshot.basic_details.franchisee_name,
    applicant_name: snapshot.basic_details.applicant_name,
    franchise_model: snapshot.basic_details.franchise_model,
    location: [territory?.district || snapshot.basic_details.district, territory?.pincode || snapshot.basic_details.pincode].filter(Boolean).join(' · '),
    district: territory?.district || snapshot.basic_details.district,
    pincode: territory?.pincode || snapshot.basic_details.pincode,
    territory: territory?.allotted_territory || territory?.registered_territory_label || '',
    onboarding_date: snapshot.basic_details.onboarding_completed_at,
    current_status: snapshot.basic_details.current_status,
    google_map_location_url: snapshot.google_map_location_url,
    webpage_url: snapshot.webpage?.public_url || '',
    updated_at: application.updated_at,
  };
}

export function franchiseeDirectoryDetail(application, helpers, actor = 'System') {
  const versions = ensureFranchiseeDirectoryVersions(application);
  const lastVersion = versions.at(-1);
  if (!lastVersion || String(application.updated_at) > String(lastVersion.recorded_at)) {
    const snapshot = buildDirectorySnapshot(application, helpers);
    appendFranchiseeDirectoryVersion(application, actor, lastVersion ? 'Application record updated' : 'Initial onboarded snapshot', snapshot);
  }
  const snapshot = buildDirectorySnapshot(application, helpers);
  return {
    ...snapshot,
    version_history: ensureFranchiseeDirectoryVersions(application).map((entry) => ({
      id: entry.id,
      version: entry.version,
      summary: entry.summary,
      actor: entry.actor,
      recorded_at: entry.recorded_at,
    })),
  };
}

function sanitizePartnerValue(key, value) {
  if (SENSITIVE_EXPORT_FIELDS.has(key)) return undefined;
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizePartnerRecord(item));
  if (typeof value === 'object') return sanitizePartnerRecord(value);
  return value;
}

function sanitizePartnerRecord(record) {
  if (!record || typeof record !== 'object') return record;
  return Object.fromEntries(Object.entries(record)
    .filter(([key]) => !SENSITIVE_EXPORT_FIELDS.has(key))
    .map(([key, value]) => [key, sanitizePartnerValue(key, value)]));
}

export function createPartnerFileToken(settings, applicationId, fileUrl, ttlMs = 60 * 60 * 1000) {
  const secret = String(settings.api_token_hash ?? '');
  if (!secret || !fileUrl) return null;
  const payload = {
    application_id: applicationId,
    file_url: fileUrl,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyPartnerFileToken(settings, token) {
  const secret = String(settings.api_token_hash ?? '');
  if (!secret || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.', 2);
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.file_url || !payload?.application_id || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function partnerFileUrl(settings, applicationId, asset) {
  if (!asset?.url) return null;
  const token = createPartnerFileToken(settings, applicationId, asset.url);
  if (!token) return null;
  return {
    id: asset.id,
    name: asset.name,
    mime: asset.mime ?? '',
    secure_url: `/api/v1/partner/franchisees/files/${token}`,
    expires_in_seconds: 3600,
  };
}

function mapPartnerFiles(section, applicationId, settings) {
  if (!section || typeof section !== 'object') return section;
  if (Array.isArray(section)) return section.map((item) => mapPartnerFiles(item, applicationId, settings));
  if (section.url && section.name) return partnerFileUrl(settings, applicationId, section);
  return Object.fromEntries(Object.entries(section).map(([key, value]) => {
    if (value && typeof value === 'object' && value.url && value.name) return [key, partnerFileUrl(settings, applicationId, value)];
    if (Array.isArray(value)) return [key, value.map((item) => mapPartnerFiles(item, applicationId, settings))];
    if (value && typeof value === 'object') return [key, mapPartnerFiles(value, applicationId, settings)];
    return [key, value];
  }));
}

export function franchiseeDirectoryPartnerRecord(detail, settings, allowedFields) {
  const fields = Array.isArray(allowedFields) && allowedFields.length ? allowedFields : FRANCHISEE_DIRECTORY_EXPORT_FIELDS;
  const sanitized = sanitizePartnerRecord(detail);
  const applicationId = sanitized.identifiers?.application_id || sanitized.identifiers?.franchisee_id || '';
  const mapped = Object.fromEntries(fields
    .filter((field) => {
      if (field === 'google_map_location_url') return Boolean(sanitized.google_map_location_url);
      return sanitized[field] != null;
    })
    .map((field) => {
      if (field === 'google_map_location_url') return [field, sanitized.google_map_location_url];
      return [field, mapPartnerFiles(sanitized[field], applicationId, settings)];
    }));
  return {
    api_version: FRANCHISEE_DIRECTORY_API_VERSION,
    exported_at: new Date().toISOString(),
    record: mapped,
  };
}

export function parseFranchiseeDirectoryFilters(searchParams) {
  return {
    q: String(searchParams.get('q') ?? searchParams.get('search') ?? '').trim(),
    franchisee_id: String(searchParams.get('franchisee_id') ?? '').trim(),
    franchise_model: String(searchParams.get('franchise_model') ?? '').trim().toUpperCase(),
    onboarding_status: String(searchParams.get('onboarding_status') ?? searchParams.get('status') ?? '').trim(),
    district: String(searchParams.get('district') ?? '').trim(),
    pincode: String(searchParams.get('pincode') ?? searchParams.get('pin_code') ?? '').trim(),
    territory: String(searchParams.get('territory') ?? '').trim(),
    onboarding_from: String(searchParams.get('onboarding_from') ?? searchParams.get('onboarding_date_from') ?? '').trim(),
    onboarding_to: String(searchParams.get('onboarding_to') ?? searchParams.get('onboarding_date_to') ?? '').trim(),
    page: Math.max(1, Number(searchParams.get('page')) || 1),
    page_size: Math.min(100, Math.max(1, Number(searchParams.get('page_size') ?? searchParams.get('limit')) || 20)),
  };
}

export function franchiseeDirectoryMatchesFilters(item, filters) {
  if (filters.franchisee_id && item.franchisee_id !== filters.franchisee_id && item.application_id !== filters.franchisee_id) return false;
  if (filters.franchise_model && item.franchise_model !== filters.franchise_model) return false;
  if (filters.onboarding_status && item.current_status !== filters.onboarding_status && item.current_status !== filters.onboarding_status.replace(/_/g, ' ')) return false;
  if (filters.district && !String(item.district ?? '').toLowerCase().includes(filters.district.toLowerCase())) return false;
  if (filters.pincode && String(item.pincode ?? '') !== filters.pincode) return false;
  if (filters.territory && !String(item.territory ?? '').toLowerCase().includes(filters.territory.toLowerCase())) return false;
  if (filters.onboarding_from && String(item.onboarding_date ?? '').slice(0, 10) < filters.onboarding_from) return false;
  if (filters.onboarding_to && String(item.onboarding_date ?? '').slice(0, 10) > filters.onboarding_to) return false;
  if (filters.q) {
    const haystack = `${item.franchisee_id} ${item.application_number} ${item.business_name} ${item.applicant_name} ${item.location} ${item.territory}`.toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

export function paginateRecords(records, page, pageSize) {
  const total = records.length;
  const start = (page - 1) * pageSize;
  return {
    items: records.slice(start, start + pageSize),
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      has_next: start + pageSize < total,
      has_previous: page > 1,
    },
  };
}

export function checkPartnerRateLimit(token, settings) {
  const limit = Math.max(1, Number(settings?.rate_limit_per_minute) || 60);
  const now = Date.now();
  const windowMs = 60_000;
  const current = partnerRateLimits.get(token) ?? { count: 0, windowStart: now };
  if (now - current.windowStart >= windowMs) {
    current.count = 0;
    current.windowStart = now;
  }
  current.count += 1;
  partnerRateLimits.set(token, current);
  return current.count <= limit;
}

export function appendPartnerApiAuditLog(database, entry) {
  if (!Array.isArray(database.partner_api_audit_log)) database.partner_api_audit_log = [];
  database.partner_api_audit_log.unshift({
    id: randomUUID(),
    ...entry,
    created_at: new Date().toISOString(),
  });
  database.partner_api_audit_log = database.partner_api_audit_log.slice(0, 500);
  return database.partner_api_audit_log;
}
