export function onboardingCertificateNumber(application) {
  return `ONB-${String(application.application_number ?? 'RFMS').replace(/[^A-Za-z0-9-]/g, '')}`;
}

export function franchiseModelCertificateLabel(franchiseModel) {
  if (franchiseModel === 'FOFO') return 'FOFO';
  if (franchiseModel === 'FOCO') return 'FOCO';
  return String(franchiseModel ?? 'Franchise').trim() || 'Franchise';
}

export function trainingCertificateIssued(application) {
  return Boolean(application?.training?.certificate?.pdf?.url);
}

export function ensureOnboardingCertificateState(application) {
  if (!application.onboarding_certificate || typeof application.onboarding_certificate !== 'object') {
    application.onboarding_certificate = null;
  }
  return application.onboarding_certificate;
}

export function canIssueOnboardingCertificate(application) {
  if (!trainingCertificateIssued(application)) return false;
  const certificate = ensureOnboardingCertificateState(application);
  return !certificate?.pdf?.url;
}

export function canDownloadOnboardingCertificate(application) {
  const certificate = ensureOnboardingCertificateState(application);
  return Boolean(certificate?.certificate_number && certificate?.pdf?.url);
}

export function onboardingCertificateWorkflowSummary(application, resolveUploadUrl) {
  const certificate = application?.onboarding_certificate && typeof application.onboarding_certificate === 'object' && application.onboarding_certificate.pdf?.url
    ? application.onboarding_certificate
    : null;
  return {
    can_issue: canIssueOnboardingCertificate(application),
    can_download: canDownloadOnboardingCertificate(application),
    can_mark_onboarded: Boolean(certificate?.pdf?.url) && application?.stage !== 'onboarding_completed',
    is_onboarded: application?.stage === 'onboarding_completed',
    certificate: certificate ? {
      certificate_number: certificate.certificate_number ?? '',
      business_name: certificate.business_name ?? '',
      franchise_model: certificate.franchise_model ?? application.franchise_model ?? '',
      franchise_model_label: franchiseModelCertificateLabel(certificate.franchise_model ?? application.franchise_model),
      issued_at: certificate.issued_at ?? '',
      issued_by: certificate.issued_by ?? '',
      verification_url: certificate.verification_url ?? '',
      qr_reference: certificate.qr_reference ?? certificate.certificate_number ?? '',
      pdf: certificate.pdf && typeof certificate.pdf === 'object'
        ? { name: certificate.pdf.name ?? '', url: resolveUploadUrl(certificate.pdf.url), mime: certificate.pdf.mime ?? 'application/pdf' }
        : null,
    } : null,
  };
}
