import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import path from 'node:path';
import {
  AGREEMENT_TEMPLATE_FOCO,
  AGREEMENT_TEMPLATE_FOFO,
  agreementAudit,
  agreementEligibleForProceed,
  agreementQueueEligible,
  agreementReference,
  agreementStatusLabel,
  agreementWorkflowSummary,
  activeAgreementFile,
  agreementDeliveredToApplicant,
  applicantAgreementPermissions,
  clearApplicantEsignState,
  reconcileAgreementWorkflow,
  buildAgreementPlaceholders,
  buildExecutedAgreementText,
  createAgreementWorkflow,
  pushAgreementVersion,
  renderAgreementTemplate,
} from './agreement-workflow.mjs';
import {
  buildEsignReturnUrl,
  cgpeyConfigured,
  cgpeyConfigFromEnv,
  cgpeySimulate,
  initiateAadhaarOkyc,
  initiateAgreementEsign,
  maskAadhaar,
  mergeCgpeyConfig,
  verifyAadhaarOkycOtp,
} from './cgpey-kyc-adapter.mjs';
import {
  adminMarketingPages,
  defaultMarketingPages,
  mergeMarketingPages,
  normalizeMarketingPages,
  publicMarketingPages,
  youtubeEmbedUrlFromCode,
} from './marketing-pages-workflow.mjs';
import {
  allTrainingVideosComplete,
  businessNameForApplication,
  canIssueTrainingCertificate,
  canRegenerateTrainingCertificate,
  canUnlockTraining,
  defaultTrainingVideos,
  ensureTrainingState,
  franchiseAddressForApplication,
  initializeTrainingProgress,
  publishedTrainingVideosForModel,
  trainingCertificateNumber,
  trainingVideoAccessible,
  trainingVideoRecord,
  trainingWorkflowSummary,
} from './training-workflow.mjs';
import {
  canDownloadOnboardingCertificate,
  canIssueOnboardingCertificate,
  ensureOnboardingCertificateState,
  franchiseModelCertificateLabel,
  onboardingCertificateNumber,
  onboardingCertificateWorkflowSummary,
  trainingCertificateIssued,
} from './onboarding-certificate-workflow.mjs';
import {
  canMarkApplicationOnboarded,
  defaultFranchiseWebpageSettings,
  franchiseWebpageMatchesSearch,
  franchiseWebpageRecord,
  franchiseWebpageSlug,
  MAX_FRANCHISE_WEBPAGE_BRANCH_IMAGES,
  renderFranchiseWebpageHtml,
} from './franchise-webpage-workflow.mjs';
import {
  appendSupportTicketMessage,
  applicantSupportUnreadCount,
  createSupportTicket,
  defaultSupportSettingsFromCompany,
  markSupportTicketReadByApplicant,
  resolvePublicSupportSettings,
  supportSettingsFromBody,
  supportSettingsRecord,
  supportTicketSummary,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
} from './support-workflow.mjs';
import {
  ADMIN_USER_ROLES,
  assignableOfficerNames,
  assignableTeamMembers,
  appendAdminAuditLog,
  createOfficerUser,
  nextOfficerEmployeeId,
  normalizeRole,
  officerUserRecord,
  officerUserSummary,
  pagesForRole,
  passwordDetails as officerPasswordDetails,
  passwordMatches as officerPasswordMatches,
  resetOfficerPassword,
  roleHasPermission,
  roleLabel,
  seedLegacyOfficerAccounts,
  updateOfficerUser,
} from './admin-users-workflow.mjs';
import {
  emitWorkflowNotifications,
  markAllNotificationsRead,
  notificationSummary,
  notificationsForRecipient,
  unreadNotificationCount,
  updateNotificationStatus,
} from './notifications-workflow.mjs';
import {
  buildConfigTemplate,
  checkErpConnectivity,
  ensureCachedPackage,
  interpretSetupLog,
  lisBridgePackageMeta,
  packageCacheInfo,
} from './lis-bridge-workflow.mjs';
import {
  appendFranchiseeDirectoryVersion,
  appendPartnerApiAuditLog,
  businessIdForApplication,
  checkPartnerRateLimit,
  ensureFranchiseeDirectoryApiSettings,
  franchiseeDirectoryApiSettingsFromBody,
  franchiseeDirectoryApiSettingsSummary,
  franchiseeDirectoryDetail,
  franchiseeDirectoryListItem,
  franchiseeDirectoryMatchesFilters,
  franchiseeDirectoryPartnerRecord,
  franchiseeDirectorySnapshot,
  franchiseeBusinessName,
  FRANCHISEE_DIRECTORY_EXPORT_FIELDS,
  isOnboardedFranchisee,
  onboardingCompletedAt,
  paginateRecords,
  parseFranchiseeDirectoryFilters,
  partnerApiTokenMatches,
  resolveFranchiseeGoogleMapLocationUrl,
  updateFranchiseeGoogleMapLocationUrl,
  verifyPartnerFileToken,
} from './franchisee-directory-workflow.mjs';
import {
  deboardFranchiseApplication,
  isDeboardedFranchise,
} from './franchise-deboard-workflow.mjs';
import {
  paymentDetailForApplication,
  paymentLedgerForApplications,
  paymentLedgerMetrics,
  paymentPhaseSummary,
} from './payments-workflow.mjs';
import { buildAdminOverview } from './overview-dashboard-workflow.mjs';
import {
  applyCouponPatch,
  couponHasCompletedUsage,
  couponRecordFromBody,
  couponSummary,
  couponUsageSummary,
  ensureCouponsArray,
  normalizeCouponCode,
  recordCouponUsage,
  validateCouponForPayment,
} from './coupons-workflow.mjs';
import {
  applyPricingToPayment,
  buildOfflineSubmission,
  completeFocoFullPayment,
  completeGatewayOrder,
  createGatewayOrder,
  ensureGatewayOrders,
  focoAllPaymentsPaid,
  focoFullPaymentEligible,
  focoFullPaymentTotal,
  markPaymentPaid,
  markPaymentUnderVerification,
  paymentAuditEntry,
  paymentPhaseDetail,
  rejectPaymentSubmission,
  validateOfflineSubmission,
} from './payment-submissions-workflow.mjs';
import {
  ensureFocoPaymentSchedule,
  ensureOnboardingModules,
  focoTotalRemaining,
  onboardingModulesSummary,
  paymentScheduleSummary,
  recalculateFocoRemainingPhases,
  recordManagerDirectPayment,
  setPhaseScheduledAmount,
} from './variable-payment-workflow.mjs';
import {
  assignFranchiseeId,
  findApplicationByFranchiseeIdentifier,
  franchiseeIdForApplication,
  migrateFranchiseeIds,
} from './franchisee-id-workflow.mjs';
import {
  verifyHecToken,
  notifyFrappeOnboardingResult,
  loadUploadBytes,
  sendOtpViaErp,
  verifyOtpViaErp,
  sendEmailOtpViaErp,
  verifyEmailOtpViaErp,
  rfmsOtpUsesErp,
  rfmsDevOtpEnabled,
  rfmsContactOtpUsesErp,
  rfmsGatewaySimulate,
  fetchRfmsIntegrationConfig,
  createRfmsRazorpayOrderViaErp,
  verifyRfmsRazorpayPaymentViaErp,
  activateRfmsPaidFranchiseeViaErp,
  mapFofoParentFocoViaErp,
  provisionPartnerPortalCredentialsViaErp,
  syncRfmsHubFromDirectoryViaErp,
  scheduleFranchiseOnboardCampaignsViaErp,
  createReachFocoB2bOnPhase1ViaErp,
  fetchWbGeoHierarchy,
  resolveWbPincodeViaErp,
  fetchFranchiseWhatsappThreadViaErp,
  sendFranchiseWhatsappReplyViaErp,
  listReachRepsViaErp,
  assignReachLeadViaErp,
  updateReachLeadStatusViaErp,
  archiveReachLeadViaErp,
  archiveFieldVisitViaErp,
  disablePartnerPortalViaErp,
  deboardFranchiseeViaErp,
  updateB2bSalesStatusViaErp,
  deleteB2bSalesViaErp,
  deleteB2bCentreViaErp,
  agencyOnboardDecisionViaErp,
} from './hec-frappe-bridge.mjs';
import {
  hardDeleteLead,
  hardDeleteVisit,
  hardDeleteAppointment,
  hardDeleteApplication,
  hardDeletePaymentSubmission,
  hardDeleteConfirmMessage,
} from './hard-delete-workflow.mjs';
import {
  ensureB2bCollections,
  ingestB2bCentres,
  ingestB2bSales,
  b2bOperationsSummary,
  b2bSalesPerformance,
  b2bCentreRecord,
  b2bSalesRecord,
  hardDeleteB2bCentre,
  hardDeleteB2bSalesEntry,
} from './b2b-operations-workflow.mjs';
import {
  applyBulkPinAvailability,
  capacityCsv,
  DEFAULT_NEAR_FULL_THRESHOLD,
  flattenCapacityRows,
  nearFullCapacityAlerts,
} from './territory-capacity-workflow.mjs';
import {
  AD_LEAD_SOURCES,
  adLeadIsAcceptable,
  adLeadPayloadFromRow,
  findExistingAdLead,
  franchiseAdsStatus,
  normaliseAdSource,
  recordFranchiseAdsIngest,
} from './leads-ads-workflow.mjs';

const marketingPort = Number(process.env.RFMS_MARKETING_PORT ?? 3000);
const portalPort = Number(process.env.RFMS_PORTAL_PORT ?? 3001);
const adminPort = Number(process.env.RFMS_ADMIN_PORT ?? 3002);
const port = Number(process.env.RFMS_API_PORT ?? 8080);
const receiptValidationBaseUrl = String(process.env.RFMS_PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
const adminBaseUrl = String(process.env.RFMS_ADMIN_BASE_URL ?? `http://localhost:${adminPort}`).replace(/\/+$/, '');
const portalBaseUrl = String(process.env.RFMS_PORTAL_BASE_URL ?? `http://localhost:${portalPort}`).replace(/\/+$/, '');
const marketingBaseUrl = String(process.env.RFMS_MARKETING_BASE_URL ?? `http://localhost:${marketingPort}`).replace(/\/+$/, '');
const dataFile = path.resolve(process.env.RFMS_LOCAL_DATA_FILE ?? path.join(process.cwd(), 'work', 'rfms-local-api-data.json'));
const staticOutputSuffix = String(process.env.RFMS_STATIC_OUTPUT_SUFFIX ?? '').trim();
const allowedOrigins = new Set([
  `http://localhost:${marketingPort}`,
  `http://localhost:${portalPort}`,
  `http://localhost:${adminPort}`,
  marketingBaseUrl,
  portalBaseUrl,
  adminBaseUrl,
  'https://www.e-remedium.in',
  'https://e-remedium.in',
]);
for (const origin of String(process.env.RFMS_ALLOWED_ORIGINS || '').split(',')) {
  const trimmed = origin.trim().replace(/\/+$/, '');
  if (trimmed) allowedOrigins.add(trimmed);
}
try {
  allowedOrigins.add(new URL(portalBaseUrl).origin);
} catch {
  /* ignore invalid portal base */
}
function staticAppOutput(appDirName) {
  const folder = staticOutputSuffix ? `out-${staticOutputSuffix}` : 'out';
  return path.resolve(process.cwd(), 'apps', appDirName, folder);
}
const challenges = new Map();
const applicantChallenges = new Map();
const contactOtpChallenges = new Map();
const contactVerificationTokens = new Map();
const aadhaarOkycSessions = new Map();
const INTEGRATION_CONFIG_TTL_MS = 60_000;
let integrationConfigCache = { at: 0, value: null };
const WB_GEO_TTL_MS = 3_600_000;
let wbGeoCache = { at: 0, value: null };

async function getRfmsIntegrationConfigCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && integrationConfigCache.value && now - integrationConfigCache.at < INTEGRATION_CONFIG_TTL_MS) {
    return integrationConfigCache.value;
  }
  try {
    const value = await fetchRfmsIntegrationConfig();
    integrationConfigCache = { at: now, value: value && typeof value === 'object' ? value : {} };
    return integrationConfigCache.value;
  } catch (error) {
    if (integrationConfigCache.value) return integrationConfigCache.value;
    throw error;
  }
}

function publicIntegrationConfigPayload(config = {}) {
  return {
    razorpay_key_id: String(config.razorpay_key_id || ''),
    razorpay_test_mode: Boolean(config.razorpay_test_mode),
    razorpay_configured: Boolean(config.razorpay_configured),
    otp_provider: String(config.otp_provider || ''),
    otp_test_mode: Boolean(config.otp_test_mode),
    contact_otp_via_erp: Boolean(config.contact_otp_via_erp),
    google_maps_api_key: String(config.google_maps_api_key || ''),
    google_maps_configured: Boolean(config.google_maps_configured),
    cgpey_configured: Boolean(config.cgpey_configured),
    cgpey_simulate: Boolean(config.cgpey_simulate),
    gateway_simulate: rfmsGatewaySimulate(),
  };
}

async function resolveCgpeyRuntimeConfig({ force = false } = {}) {
  const fromEnv = cgpeyConfigFromEnv();
  if (fromEnv.apiKey && fromEnv.apiSecret && fromEnv.merchantId) {
    return fromEnv;
  }
  try {
    const erp = await getRfmsIntegrationConfigCached({ force });
    return mergeCgpeyConfig({
      apiKey: erp?.cgpey_api_key,
      apiSecret: erp?.cgpey_api_secret,
      merchantId: erp?.cgpey_merchant_id,
      baseUrl: erp?.cgpey_base_url,
      simulate: erp?.cgpey_simulate,
    });
  } catch {
    return fromEnv;
  }
}

async function getWbGeoHierarchyCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && wbGeoCache.value && now - wbGeoCache.at < WB_GEO_TTL_MS) {
    return wbGeoCache.value;
  }
  try {
    const value = await fetchWbGeoHierarchy();
    wbGeoCache = { at: now, value: value && typeof value === 'object' ? value : { districts: [], count: 0 } };
    return wbGeoCache.value;
  } catch (error) {
    if (wbGeoCache.value) return wbGeoCache.value;
    throw error;
  }
}
const tokens = new Map();
const uploadsDirectory = path.resolve(process.env.RFMS_UPLOADS_DIR ?? path.join(process.cwd(), 'work', 'rfms-uploads'));
const defaultCompanyProfile = {
  company_name: 'Remedium Lab', legal_name: 'Remedium Lab', logo_url: '/remedium-lab-logo.png',
  franchise_hub_name: 'Remedium Lab Franchisee Hub', office_address: 'ASO210, Astra Towers, 2C/1, AA II, C, Newtown, Reckjoani, Kolkata, West Bengal 700156', company_email: '', company_phone: '', whatsapp_number: '',
  google_map_embed_url: 'https://www.google.com/maps?q=ASO210%2C%20Astra%20Towers%2C%20Newtown%2C%20Kolkata%20700156&output=embed',
  why_remedium_eyebrow: 'Why Remedium Lab',
  why_remedium_title: 'Build a diagnostic business that serves society.',
  why_remedium_intro: 'Partner with Eastern India\'s fair-price diagnostics brand and bring dependable testing closer to every community.',
  why_remedium_body: 'Remedium Lab combines an NABL-accredited quality approach with structured franchise support, transparent processes and a patient-first purpose. Our franchise model helps local entrepreneurs build a trusted diagnostic business while supporting accessible healthcare in their communities.',
  why_remedium_point_one: 'NABL-accredited quality systems designed for reliable diagnostic reporting.',
  why_remedium_point_two: 'Fair-price diagnostics that help make essential testing more accessible.',
  why_remedium_point_three: 'Training, launch guidance and ongoing operational support for every franchise partner.',
  why_remedium_badge_url: '/nabl-accreditation-badge.svg',
  brochure_url: '',
  footer_disclaimer: 'Information on this website is for franchise opportunity discussion only. Financial estimates, territory availability, timelines and approval outcomes are indicative and subject to Remedium Lab review, applicable law and the final signed agreement.',
  footer_terms: 'By using this website or submitting an enquiry, you agree that the information you provide may be used by Remedium Lab to assess and respond to your franchise enquiry. This website does not constitute an offer, guarantee of franchise approval, financial advice or a promise of business performance.',
  fofo_terms: 'FOFO franchise terms and conditions\n\n1. The applicant will operate the franchise centre in accordance with Remedium Lab quality, branding and operating standards.\n2. Territory allocation, application approval and launch timelines are subject to Remedium Lab review and the final franchise agreement.\n3. The one-time FOFO franchise fee is payable after the application is accepted for processing.\n4. Business outcomes are not guaranteed. The franchisee remains responsible for local operating costs, legal compliance and approved centre operations.',
  foco_terms: 'FOCO franchise terms and conditions\n\n1. The applicant will participate in the FOCO model subject to Remedium Lab operational, quality and territory approval.\n2. The FOCO payment plan includes the application fee, franchise fee and security deposit at the stages shown in the application.\n3. Location allotment, onboarding and final agreement are completed only after the relevant review and payment stage.\n4. Business outcomes are not guaranteed. All rights and obligations are governed by the final signed franchise agreement.',
  foco_phase_2_terms: 'FOCO Phase 2 payment terms and conditions\n\n1. The Phase 2 franchise fee becomes payable only after Remedium Lab issues the Territory Allotment Letter and a manager releases this payment stage.\n2. Payment of the franchise fee confirms that the applicant accepts the allotted territory, approved onboarding plan and applicable operating requirements.\n3. Phase 2 payment does not replace the final franchise agreement, security deposit or any later compliance requirement.\n4. The applicant must review these terms and accept them before making the Phase 2 payment. All payments remain subject to verification by Remedium Lab.',
  foco_phase_3_terms: 'FOCO Phase 3 security deposit terms and conditions\n\n1. The security deposit becomes payable only after Remedium Lab approves Branding Signage and HR Process and a manager releases this payment stage.\n2. Payment of the security deposit confirms acceptance of the final onboarding review, company requirements and the signed franchise agreement process.\n3. The security deposit does not replace any later compliance requirement, audit request or contractual obligation.\n4. The applicant must review these terms and accept them before making the security deposit payment. All payments remain subject to verification by Remedium Lab.',
  foco_phase_3_terms_version: 1,
  agreement_terms: 'Franchise Agreement Terms & Conditions\n\n1. The applicant confirms that they have read the complete franchise agreement presented in the Agreement Module.\n2. Acceptance of these terms authorises Remedium Lab to proceed with Aadhaar eSign and company execution steps.\n3. All rights, obligations, territory conditions and payment confirmations remain subject to the final executed franchise agreement.\n4. Business outcomes are not guaranteed. This acceptance does not replace statutory, regulatory or contractual requirements applicable to the franchise relationship.',
  agreement_terms_version: 1,
};
const defaultHeroSlides = () => [{
  id: 'default-hero-slide',
  title: 'Build a trusted diagnostics business in your community.',
  description: 'Bring reliable diagnostics closer to patients with structured operations, quality systems and ongoing support from Remedium Lab.',
  primary_button_text: 'Apply for franchisee', primary_button_url: portalBaseUrl,
  secondary_button_text: 'Check territory availability →', secondary_button_url: '/#territory',
  image_url: '', is_published: true, sort_order: 0,
}];
const westBengalTerritorySeeds = () => [
  { id: 'wb-kolkata-newtown', state: 'West Bengal', district: 'Kolkata', subdivision: 'Kolkata Sadar', area: 'New Town / Salt Lake', pin_capacities: [{ pincode: '700156', fofo_available: 2, foco_available: 1 }, { pincode: '700091', fofo_available: 2, foco_available: 1 }], fofo_radius_km: 5, foco_radius_km: 9, map_x: 63, map_y: 79, map_projection_version: 'nh-map-r12-v2', allocations: [] },
  { id: 'wb-north-24-habra', state: 'West Bengal', district: 'North 24 Parganas', subdivision: 'Barasat', area: 'Habra', pin_capacities: [{ pincode: '743271', fofo_available: 2, foco_available: 1 }, { pincode: '743272', fofo_available: 1, foco_available: 1 }], fofo_radius_km: 6, foco_radius_km: 12, map_x: 62, map_y: 73, map_projection_version: 'nh-map-r12-v2', allocations: [] },
  { id: 'wb-howrah-central', state: 'West Bengal', district: 'Howrah', subdivision: 'Howrah Sadar', area: 'Howrah Central', pin_capacities: [{ pincode: '711101', fofo_available: 3, foco_available: 1 }], fofo_radius_km: 4, foco_radius_km: 8, map_x: 55, map_y: 80, map_projection_version: 'nh-map-r12-v2', allocations: [] },
  { id: 'wb-purba-bardhaman', state: 'West Bengal', district: 'Purba Bardhaman', subdivision: 'Bardhaman Sadar North', area: 'Bardhaman Central', pin_capacities: [{ pincode: '713101', fofo_available: 2, foco_available: 1 }], fofo_radius_km: 7, foco_radius_km: 14, map_x: 52, map_y: 71, map_projection_version: 'nh-map-r12-v2', allocations: [] },
  { id: 'wb-darjeeling-siliguri', state: 'West Bengal', district: 'Darjeeling', subdivision: 'Siliguri', area: 'Siliguri North', pin_capacities: [{ pincode: '734001', fofo_available: 2, foco_available: 1 }, { pincode: '734004', fofo_available: 2, foco_available: 1 }], fofo_radius_km: 7, foco_radius_km: 15, map_x: 45, map_y: 20, map_projection_version: 'nh-map-r12-v2', allocations: [] },
];
let database = { stories: [], franchisees: [], franchise_webpages: [], leads: [], appointments: [], territories: westBengalTerritorySeeds(), company_profile: defaultCompanyProfile, hero_slides: defaultHeroSlides(), training_videos: defaultTrainingVideos(), marketing_pages: defaultMarketingPages(), support_tickets: [], support_settings: defaultSupportSettingsFromCompany(defaultCompanyProfile), officers: [], admin_audit_log: [], notifications: [], sessions: [], franchisee_directory_api: null, partner_api_audit_log: [], payment_vouchers: [] };
let databaseFileMtimeMs = 0;

async function syncApplicationsFromDiskIfChanged() {
  if (staticOutputSuffix !== 'isolated') return;
  try {
    const fileStat = await stat(dataFile);
    if (fileStat.mtimeMs === databaseFileMtimeMs) return;
    const storedData = JSON.parse(await readFile(dataFile, 'utf8'));
    if (!Array.isArray(storedData.applications)) return;
    databaseFileMtimeMs = fileStat.mtimeMs;
    const memoryById = new Map((Array.isArray(database.applications) ? database.applications : []).map((item) => [item.id, item]));
    database.applications = storedData.applications.map((diskApp) => {
      const memoryApp = memoryById.get(diskApp.id);
      if (!memoryApp) return diskApp;
      const diskUpdated = Date.parse(diskApp.updated_at ?? '') || 0;
      const memoryUpdated = Date.parse(memoryApp.updated_at ?? '') || 0;
      return memoryUpdated > diskUpdated ? memoryApp : diskApp;
    });
  } catch {
    /* Keep the in-memory applications if the local data file cannot be read. */
  }
}

async function loadDatabase() {
  try {
    const storedData = JSON.parse(await readFile(dataFile, 'utf8'));
    const needsTerritoryMigration = !Array.isArray(storedData.territories) || storedData.territories.some((item) => !Array.isArray(item?.pin_capacities));
    const needsTerritoryMapMigration = !Array.isArray(storedData.territories) || storedData.territories.some((item) => item?.map_projection_version !== WEST_BENGAL_MAP_PROJECTION_VERSION);
    const needsLeadMigration = !Array.isArray(storedData.leads) || storedData.leads.some((item) => !Array.isArray(item?.activity_history));
    const needsAppointmentMigration = !Array.isArray(storedData.appointments) || storedData.appointments.some((item) => !Array.isArray(item?.activity_history));
    database = { stories: [], franchisees: [], leads: [], appointments: [], applications: [], territories: westBengalTerritorySeeds(), company_profile: defaultCompanyProfile, hero_slides: defaultHeroSlides(), sessions: [], ...storedData };
    database.company_profile = publicCompanyProfile(database.company_profile);
    const needsCompanyLogoMigration = String(storedData?.company_profile?.logo_url ?? '').includes('localhost')
      || String(storedData?.company_profile?.why_remedium_badge_url ?? '').includes('localhost')
      || String(storedData?.company_profile?.brochure_url ?? '').includes('localhost');
    database.hero_slides = Array.isArray(database.hero_slides) && database.hero_slides.length ? database.hero_slides.map((slide) => heroSlide(slide, slide.id)) : defaultHeroSlides();
    database.applications = Array.isArray(database.applications) ? database.applications : [];
    database.leads = Array.isArray(database.leads) ? database.leads.map((item) => leadRecord(item, item?.id)) : [];
    database.sales_visits = Array.isArray(database.sales_visits) ? database.sales_visits.map((item) => salesVisitRecord(item, item?.id)) : [];
    database.agency_onboard_requests = Array.isArray(database.agency_onboard_requests) ? database.agency_onboard_requests : [];
    ensureB2bCollections(database);
    database.b2b_collection_centres = database.b2b_collection_centres.map((item) => b2bCentreRecord(item, item?.id));
    database.b2b_sales_entries = database.b2b_sales_entries.map((item) => b2bSalesRecord(item, item?.id));
    database.appointments = Array.isArray(database.appointments) ? database.appointments.map((item) => appointmentRecord(item, item?.id)) : [];
    database.territories = Array.isArray(database.territories) ? database.territories.map((item) => territoryRecord(item, item?.id)) : westBengalTerritorySeeds().map((item) => territoryRecord(item, item.id));
    database.sessions = Array.isArray(database.sessions) ? database.sessions.filter((session) => session && typeof session.token === 'string' && typeof session.role === 'string' && typeof session.name === 'string' && typeof session.mobile === 'string').slice(-50) : [];
    database.training_videos = Array.isArray(database.training_videos) && database.training_videos.length
      ? database.training_videos.map((item) => trainingVideoRecord(item)).filter(Boolean)
      : defaultTrainingVideos();
    database.franchise_webpages = Array.isArray(database.franchise_webpages) ? database.franchise_webpages : [];
    database.support_tickets = Array.isArray(database.support_tickets) ? database.support_tickets : [];
    database.officers = Array.isArray(database.officers) ? database.officers.map((item) => officerUserRecord(item, item?.id)) : [];
    database.admin_audit_log = Array.isArray(database.admin_audit_log) ? database.admin_audit_log : [];
    database.notifications = Array.isArray(database.notifications) ? database.notifications : [];
    let needsOfficersMigration = !Array.isArray(storedData.officers) || !storedData.officers.length;
    const seedOfficersFlag = String(process.env.RFMS_SEED_OFFICERS ?? '').trim().toLowerCase();
    const allowSeedAppend = ['1', 'true', 'on', 'yes'].includes(seedOfficersFlag);
    if (!database.officers.length) {
      // Bootstrap only when the officers table is empty (first boot / wipe).
      database.officers = seedLegacyOfficerAccounts(officerAccounts, officerPasswordDetails);
      needsOfficersMigration = true;
    } else if (allowSeedAppend) {
      // Dev-only: re-inject missing demo accounts. Production creates staff via User Management.
      const knownEmails = new Set(database.officers.map((item) => item.email));
      for (const account of officerAccounts) {
        if (!knownEmails.has(String(account.email).toLowerCase())) {
          database.officers.push(...seedLegacyOfficerAccounts([account], officerPasswordDetails));
          knownEmails.add(String(account.email).toLowerCase());
          needsOfficersMigration = true;
        }
      }
    }
    database.support_settings = supportSettingsRecord(database.support_settings, companyProfile(database.company_profile));
    const resolvedSupportSettings = resolvePublicSupportSettings(database.support_settings, companyProfile(database.company_profile));
    const needsSupportSettingsMigration = !database.support_settings.whatsapp_number
      || !database.support_settings.ivr_call_number
      || !database.support_settings.technical_support_number
      || !database.support_settings.technical_whatsapp_number;
    if (needsSupportSettingsMigration) {
      database.support_settings = resolvedSupportSettings;
    }
    ensureFranchiseeDirectoryApiSettings(database);
    database.partner_api_audit_log = Array.isArray(database.partner_api_audit_log) ? database.partner_api_audit_log : [];
    database.payment_vouchers = Array.isArray(database.payment_vouchers) ? database.payment_vouchers : [];
    ensureCouponsArray(database);
    ensureGatewayOrders(database);
    database.marketing_pages = normalizeMarketingPages(database.marketing_pages);
    const needsFranchiseeIdMigration = migrateFranchiseeIds(database);
    let needsAgreementReconciliation = false;
    for (const application of database.applications) {
      if (reconcileAgreementWorkflow(application.agreement_workflow)) needsAgreementReconciliation = true;
    }
    if (needsTerritoryMigration || needsTerritoryMapMigration || needsLeadMigration || needsAppointmentMigration || needsSupportSettingsMigration || needsOfficersMigration || needsFranchiseeIdMigration || needsAgreementReconciliation || needsCompanyLogoMigration) await saveDatabase();
    try {
      databaseFileMtimeMs = (await stat(dataFile)).mtimeMs;
    } catch {
      databaseFileMtimeMs = 0;
    }
  } catch {
    database.territories = westBengalTerritorySeeds().map((item) => territoryRecord(item, item.id));
    await saveDatabase();
  }
}

async function saveDatabase() {
  ensureOfficersArray();
  ensureAdminAuditLog();
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(database, null, 2), 'utf8');
  try {
    databaseFileMtimeMs = (await stat(dataFile)).mtimeMs;
  } catch {
    databaseFileMtimeMs = 0;
  }
}

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Franchise-Ads-Secret, X-WhatsApp-Cloud-Secret');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('Vary', 'Origin');
}

function send(request, response, status, body) {
  cors(request, response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendPdf(request, response, filename, body) {
  cors(request, response);
  response.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': body.length,
    'Cache-Control': 'private, no-store',
  });
  response.end(body);
}

function sendZip(request, response, filename, body) {
  cors(request, response);
  response.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': body.length,
    'Cache-Control': 'private, no-store',
  });
  response.end(body);
}

function lisBridgeCacheDirectory() {
  return path.resolve(process.env.RFMS_LIS_BRIDGE_CACHE_DIR ?? path.join(process.cwd(), 'work', 'lis-bridge-packages'));
}

function success(request, response, data, status = 200) {
  send(request, response, status, { success: true, data });
}

function failure(request, response, code, message, status = 422) {
  send(request, response, status, { success: false, error: { code, message } });
}

async function readJson(request, maxLength = 1_000_000) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > maxLength) throw new Error('Request is too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

const officerAccounts = [
  { email: 'admin@remediumlab.local', password: 'Admin@12345', name: 'RFMS Super Admin', role: 'super_admin', mobile: '9000000000' },
  { email: 'manager@remediumlab.local', password: 'Manager@12345', name: 'CRM Manager', role: 'franchise_manager', mobile: '9000000002' },
  { email: 'officer@remediumlab.local', password: 'Demo@12345', name: 'Demo Officer', role: 'franchise_officer', mobile: '9000000001' },
  { email: 'crm2@remediumlab.local', password: 'Crm2@12345', name: 'CRM Executive Two', role: 'franchise_officer', mobile: '9000000003' },
  { email: 'consultant@remediumlab.local', password: 'Consult@12345', name: 'Business Consultant', role: 'business_consultant', mobile: '9000000004', employee_id: 'RFMS-0005' },
  { email: 'advocate@remediumlab.local', password: 'Advocate@12345', name: 'Legal Advocate', role: 'advocate', mobile: '9000000005', employee_id: 'RFMS-0006' },
  { email: 'accountant@remediumlab.local', password: 'Account@12345', name: 'Finance Accountant', role: 'accountant', mobile: '9000000006', employee_id: 'RFMS-0007' },
];

function ensureOfficersArray() {
  if (!Array.isArray(database.officers)) database.officers = [];
  return database.officers;
}

function ensureAdminAuditLog() {
  if (!Array.isArray(database.admin_audit_log)) database.admin_audit_log = [];
  return database.admin_audit_log;
}

function ensureNotificationsArray() {
  if (!Array.isArray(database.notifications)) database.notifications = [];
  return database.notifications;
}

function workflowActor(request, fallback = 'RFMS officer') {
  const session = sessionFor(request);
  return {
    name: session?.name || fallback,
    role: normalizeRole(session?.role || 'system'),
  };
}

function workflowNotify(payload) {
  return emitWorkflowNotifications({
    notifications: ensureNotificationsArray(),
    officers: ensureOfficersArray(),
    applications: database.applications,
    ...payload,
  });
}

function notificationRecipient(session) {
  if (!session) return { recipientType: 'officer', recipientId: '' };
  if (session.role === 'applicant') {
    return { recipientType: 'applicant', recipientId: session.application_id ?? session.user_id ?? '' };
  }
  if (session.user_id) return { recipientType: 'officer', recipientId: session.user_id };
  const officer = ensureOfficersArray().find((item) => (session.email && item.email === session.email) || item.mobile === session.mobile || item.name === session.name);
  return { recipientType: 'officer', recipientId: officer?.id ?? session.mobile ?? '' };
}

function crmEmployeeNames() {
  return assignableOfficerNames(ensureOfficersArray(), 'leads');
}

function appointmentEmployeeNames() {
  return assignableOfficerNames(ensureOfficersArray(), 'appointments');
}

function supportAssignableNames() {
  return assignableOfficerNames(ensureOfficersArray(), 'support');
}

function accountFor(loginId, password) {
  const identifier = text(loginId, 160).trim();
  if (!identifier) return null;
  const normalized = identifier.toLowerCase();
  const officer = ensureOfficersArray().find((item) => {
    const employeeId = String(item.employee_id || '').trim().toLowerCase();
    const email = String(item.email || '').trim().toLowerCase();
    return employeeId === normalized || email === normalized;
  });
  if (!officer || officer.status !== 'active' || !officerPasswordMatches(officer, password)) return null;
  return {
    id: officer.id,
    employee_id: officer.employee_id,
    name: officer.name,
    role: normalizeRole(officer.role),
    mobile: officer.mobile,
    email: officer.email,
  };
}

async function issueOfficerSession(account, { via = 'password' } = {}) {
  const token = randomUUID();
  const role = normalizeRole(account.role);
  const session = {
    token,
    user_id: account.id,
    employee_id: account.employee_id,
    email: account.email,
    name: account.name,
    role,
    mobile: account.mobile,
  };
  tokens.set(token, session);
  database.sessions = [...database.sessions.filter((item) => item.mobile !== account.mobile && item.email !== account.email && item.user_id !== account.id), session].slice(-50);
  const officer = ensureOfficersArray().find((item) => item.id === account.id);
  if (officer) {
    officer.last_login_at = new Date().toISOString();
    officer.updated_at = officer.last_login_at;
  }
  database.admin_audit_log = appendAdminAuditLog(ensureAdminAuditLog(), {
    action: 'user_login',
    actor_name: account.name,
    actor_role: role,
    target_user_id: account.id,
    target_user_name: account.name,
    details: `${account.name} (${roleLabel(role)}) signed in to the admin portal with company ID${via === 'password' ? '' : ` via ${via}`}.`,
  });
  await saveDatabase();
  return {
    token,
    user: {
      id: account.id,
      employee_id: account.employee_id,
      name: account.name,
      role,
      email: account.email,
      allowed_pages: pagesForRole(role),
    },
  };
}

function auditAdminAction(request, entry) {
  const session = sessionFor(request);
  database.admin_audit_log = appendAdminAuditLog(ensureAdminAuditLog(), {
    ...entry,
    actor_name: entry.actor_name ?? session?.name ?? 'System',
    actor_role: entry.actor_role ?? session?.role ?? 'system',
  });
}

function invalidateOfficerSessions(officer) {
  if (!officer) return;
  for (const [token, session] of tokens.entries()) {
    if (session.user_id === officer.id || session.email === officer.email || session.mobile === officer.mobile) tokens.delete(token);
  }
  database.sessions = database.sessions.filter((session) => session.user_id !== officer.id && session.email !== officer.email && session.mobile !== officer.mobile);
}

function sessionFor(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const active = tokens.get(token) ?? database.sessions.find((session) => session.token === token);
  if (active) tokens.set(token, active);
  return active ?? null;
}

function requireAdmin(request) {
  return roleHasPermission(sessionFor(request)?.role, 'user_management');
}

function requireOfficer(request) {
  const session = sessionFor(request);
  if (!session) return false;
  const role = normalizeRole(session.role);
  return ['super_admin', 'manager', 'crm', 'business_consultant', 'advocate', 'accountant', 'franchise_manager', 'franchise_officer'].includes(role);
}

function requirePermission(request, response, permission) {
  const session = sessionFor(request);
  if (!session) {
    failure(request, response, 'UNAUTHORIZED', 'Sign in to continue.', 401);
    return null;
  }
  if (!roleHasPermission(session.role, permission)) {
    failure(request, response, 'FORBIDDEN', 'You do not have permission for this action.', 403);
    return null;
  }
  return session;
}

function canManageCrm(request) {
  return roleHasPermission(sessionFor(request)?.role, 'crm_team');
}

function canManageAppointments(request) {
  return roleHasPermission(sessionFor(request)?.role, 'appointment_team');
}

function canManageTerritory(request) {
  return roleHasPermission(sessionFor(request)?.role, 'territory');
}

function canManageCoupons(request) {
  const role = normalizeRole(sessionFor(request)?.role);
  return ['super_admin', 'accountant'].includes(role);
}

function applicantByIdentifier(value, options = {}) {
  const includeUserId = options.includeUserId !== false;
  const includeMobile = options.includeMobile !== false;
  const raw = text(value, 160);
  const identifier = raw.toLowerCase();
  const mobile = normalizeApplicantMobile(raw);
  return database.applications.find((application) => {
    if (application.application_number?.toLowerCase() === identifier) return true;
    if (application.email?.toLowerCase() === identifier) return true;
    if (includeUserId && application.user_id?.toLowerCase() === identifier) return true;
    if (includeMobile && mobile && normalizeApplicantMobile(application.mobile) === mobile) return true;
    return false;
  }) ?? null;
}

function normalizeApplicantMobile(value) {
  const digits = text(value, 20).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return digits;
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function applicantCredentialKind(value) {
  const raw = text(value, 160).trim();
  if (!raw) return 'unknown';
  if (raw.toUpperCase().startsWith('RCP-')) return 'receipt';
  if (raw.includes('@')) return 'email';
  if (/^RFMS-/i.test(raw)) return 'application_number';
  const mobile = normalizeApplicantMobile(raw);
  if (/^[6-9]\d{9}$/.test(mobile)) return 'mobile';
  if (/^[a-z0-9._-]+$/i.test(raw)) return 'user_id';
  return 'unknown';
}

function maskedApplicantMobile(mobile) {
  const normalized = normalizeApplicantMobile(mobile);
  return normalized ? `******${normalized.slice(-4)}` : '';
}

async function dispatchMobileOtp(mobile) {
  const normalized = normalizeApplicantMobile(mobile);
  if (!/^[6-9]\d{9}$/.test(normalized)) {
    throw new Error('A valid registered 10-digit mobile number is required to send OTP.');
  }
  if (rfmsOtpUsesErp()) {
    try {
      return await sendOtpViaErp(normalized);
    } catch (error) {
      // Dev/smoke fallback when MSG91/ERP is unreachable; production keeps the real failure.
      if (rfmsDevOtpEnabled()) {
        return { mobile: normalized, expires_in: 300, test_mode: true, hint: 'Test mode: use OTP 123456' };
      }
      throw error;
    }
  }
  return { mobile: normalized, expires_in: 300, test_mode: true, hint: 'Test mode: use OTP 123456' };
}

async function confirmMobileOtp(mobile, otp) {
  const normalized = normalizeApplicantMobile(mobile);
  const code = text(otp, 10);
  if (rfmsOtpUsesErp()) {
    await verifyOtpViaErp(normalized, code);
    return true;
  }
  if (rfmsDevOtpEnabled() && code === '123456') return true;
  throw new Error('The OTP is incorrect or expired.');
}

function maskedOfficerEmail(email) {
  const value = text(email, 160).toLowerCase();
  const [local, domain] = value.split('@');
  if (!local || !domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 2))}@${domain}`;
}

async function dispatchEmailOtp(email) {
  const recipient = text(email, 160).toLowerCase();
  if (!recipient || !isEmail(recipient)) {
    throw new Error('A valid registered email address is required to send OTP.');
  }
  if (rfmsOtpUsesErp()) {
    try {
      return await sendEmailOtpViaErp(recipient);
    } catch (error) {
      if (rfmsDevOtpEnabled()) {
        return { email: recipient, expires_in: 300, test_mode: true, hint: 'Test mode: use OTP 123456', channel: 'email' };
      }
      throw error;
    }
  }
  return { email: recipient, expires_in: 300, test_mode: true, hint: 'Test mode: use OTP 123456', channel: 'email' };
}

async function confirmEmailOtp(email, otp) {
  const recipient = text(email, 160).toLowerCase();
  const code = text(otp, 10);
  if (rfmsOtpUsesErp()) {
    await verifyEmailOtpViaErp(recipient, code);
    return true;
  }
  if (rfmsDevOtpEnabled() && code === '123456') return true;
  throw new Error('The OTP is incorrect or expired.');
}

function otpDeliveryMeta(dispatchResult) {
  const meta = {
    expires_in_seconds: Number(dispatchResult?.expires_in || 300),
    test_mode: Boolean(dispatchResult?.test_mode),
  };
  if (meta.test_mode) meta.development_otp = '123456';
  return meta;
}

function applicantNotFoundMessage() {
  return 'No matching applicant account was found. Check your mobile number, registration number, email address or user ID.';
}

function passwordDetails(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 8 || password.length > 128) return null;
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function passwordMatches(application, value) {
  if (!application?.account_password_salt || !application?.account_password_hash || typeof value !== 'string') return false;
  const saved = Buffer.from(application.account_password_hash, 'hex');
  const candidate = scryptSync(value, application.account_password_salt, 64);
  return saved.length === candidate.length && timingSafeEqual(saved, candidate);
}

async function applicantSession(application) {
  const token = randomUUID();
  const session = { token, name: application.full_name, role: 'applicant', mobile: application.mobile, application_id: application.id };
  tokens.set(token, session);
  database.sessions = [...database.sessions.filter((item) => item.application_id !== application.id), session].slice(-50);
  await saveDatabase();
  return session;
}

function findLeadByHecFranchisee(fp) {
  const key = String(fp || '').trim();
  if (!key) return null;
  return (database.leads || []).find((item) => String(item.hec_franchisee_profile || '').trim() === key) || null;
}

function findApplicationByHecFranchisee(fp) {
  const key = String(fp || '').trim();
  if (!key) return null;
  return (database.applications || []).find((item) => String(item.hec_franchisee_profile || '').trim() === key) || null;
}

/** Reach HMAC handoff: create/update an FFMS CRM lead only — applicant chooses FOFO/FOCO on the form. */
async function ensureHecLinkedLead(claims) {
  database.leads = Array.isArray(database.leads) ? database.leads : [];
  const now = new Date().toISOString();
  const mobile = String(claims.phone || '').replace(/\D/g, '').slice(-10);
  const email = String(claims.email || '').trim().toLowerCase();
  const name = String(claims.name || claims.fp || 'Reach applicant').trim();
  const territory = String(claims.branch || claims.fp || '').trim();
  let lead = findLeadByHecFranchisee(claims.fp);
  if (!lead && email) {
    lead = database.leads.find((item) => String(item.email || '').toLowerCase() === email) || null;
  }
  if (!lead && mobile) {
    lead = database.leads.find((item) => String(item.mobile || '').replace(/\D/g, '').slice(-10) === mobile) || null;
  }
  if (lead) {
    lead.name = name || lead.name;
    if (email) lead.email = email;
    if (mobile) lead.mobile = mobile;
    if (territory && !lead.territory_query) lead.territory_query = territory;
    lead.hec_franchisee_profile = String(claims.fp);
    lead.hec_session_id = String(claims.sid || lead.hec_session_id || '');
    lead.hec_lead_id = String(claims.lead || lead.hec_lead_id || '');
    lead.source = lead.source === 'website' ? lead.source : 'reach_sales';
    lead.updated_at = now;
    addLeadActivity(lead, 'note', `Reach sales handoff refreshed for Franchisee Profile ${claims.fp}. Applicant will choose FOFO/FOCO on the portal.`, 'Reach sales');
    await saveDatabase();
    return lead;
  }
  lead = leadRecord({
    name,
    email: email || `reach-${String(claims.fp).toLowerCase().replace(/[^a-z0-9]+/g, '-')}@hec.local`,
    mobile: mobile || '0000000000',
    franchise_model: '',
    territory_query: territory || 'To be confirmed by applicant',
    notes: `Created from Reach sales HMAC handoff for Franchisee Profile ${claims.fp}. Franchise model left for applicant selection.`,
    source: 'reach_sales',
    stage: 'new',
    priority: 'hot',
    assigned_to: 'Unassigned',
    hec_franchisee_profile: String(claims.fp),
    hec_session_id: String(claims.sid || ''),
    hec_lead_id: String(claims.lead || ''),
  });
  database.leads.unshift(lead);
  await saveDatabase();
  return lead;
}

async function pushHecResultToFrappe(application, { status, aadhaarRef = '', notes = '' }) {
  const franchiseeId = String(application?.hec_franchisee_profile || '').trim();
  if (!franchiseeId) return;
  const signed = application?.agreement_workflow?.document?.aadhaar_signed_file
    || application?.agreement_workflow?.document?.executed_file
    || application?.agreement_workflow?.document?.uploaded_file;
  let pdfBytes = null;
  if (signed?.url) {
    pdfBytes = await loadUploadBytes(uploadsDirectory, signed.url);
  }
  try {
    await notifyFrappeOnboardingResult({
      franchiseeId,
      sessionId: application.hec_session_id || '',
      aadhaarRef: aadhaarRef || application.agreement_workflow?.applicant?.esign_reference || '',
      status,
      agreementPdfBytes: pdfBytes,
      agreementFilename: signed?.name || `agreement-${franchiseeId}.pdf`,
      notes,
    });
  } catch (error) {
    console.error('[hec-bridge] callback error', error);
  }
}

function applicantFor(request) {
  const session = sessionFor(request);
  return session?.role === 'applicant' ? database.applications.find((application) => application.id === session.application_id) ?? null : null;
}

function youtubeEmbedUrl(embedCode) {
  const source = embedCode.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ?? embedCode.trim();
  let url;
  try { url = new URL(source); } catch { return ''; }
  const acceptedHosts = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
  return url.protocol === 'https:' && acceptedHosts.has(url.hostname) && url.pathname.startsWith('/embed/') ? url.toString() : '';
}

function trainingVideoFieldsFromBody(body, current = {}) {
  const title = text(body.title, 180) || current.title || '';
  let videoUrl = text(body.video_url, 2_000) || current.video_url || '';
  let youtubeEmbedCode = body.youtube_embed_code !== undefined ? String(body.youtube_embed_code ?? '') : (current.youtube_embed_code ?? '');
  let youtubeEmbedUrlValue = current.youtube_embed_url ?? '';
  if (body.youtube_embed_code !== undefined && String(body.youtube_embed_code ?? '').trim()) {
    youtubeEmbedUrlValue = youtubeEmbedUrl(body.youtube_embed_code);
    if (!youtubeEmbedUrlValue) return { error: 'Enter a valid HTTPS YouTube iframe embed code.' };
    videoUrl = youtubeEmbedUrlValue;
    youtubeEmbedCode = String(body.youtube_embed_code);
  } else if (!videoUrl && youtubeEmbedUrlValue) {
    videoUrl = youtubeEmbedUrlValue;
  }
  const mime = youtubeEmbedUrlValue || /youtube/i.test(videoUrl) ? 'video/youtube' : text(body.mime, 80) || current.mime || 'video/mp4';
  return {
    title,
    description: body.description !== undefined ? text(body.description, 2_000) : (current.description ?? ''),
    video_url: videoUrl,
    youtube_embed_code: youtubeEmbedCode,
    youtube_embed_url: youtubeEmbedUrlValue,
    mime,
    duration_minutes: body.duration_minutes !== undefined ? Number(body.duration_minutes) : (current.duration_minutes ?? 0),
    franchise_models: Array.isArray(body.franchise_models) ? body.franchise_models : (current.franchise_models ?? ['FOFO', 'FOCO']),
    sort_order: body.sort_order !== undefined ? Number(body.sort_order) : (current.sort_order ?? 0),
    is_published: body.is_published !== undefined ? body.is_published !== false : (current.is_published !== false),
  };
}

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function validLogoUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return url.startsWith('/') || validImageUrl(url) ? url : '';
}

function googleMapEmbedUrl(value) {
  const iframeSource = typeof value === 'string' ? value.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] : '';
  const source = (iframeSource || text(value, 2500)).trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase();
    const trustedHost = host === 'google.com' || host.endsWith('.google.com') || host === 'maps.google.com';
    return url.protocol === 'https:' && trustedHost && url.pathname.startsWith('/maps') ? url.toString() : '';
  } catch { return ''; }
}

function companyProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    company_name: text(source.company_name, 120) || defaultCompanyProfile.company_name,
    legal_name: text(source.legal_name, 180) || defaultCompanyProfile.legal_name,
    logo_url: validLogoUrl(source.logo_url) || defaultCompanyProfile.logo_url,
    franchise_hub_name: text(source.franchise_hub_name, 180) || defaultCompanyProfile.franchise_hub_name,
    office_address: text(source.office_address, 500) || defaultCompanyProfile.office_address,
    company_email: text(source.company_email, 160),
    company_phone: text(source.company_phone, 40),
    whatsapp_number: text(source.whatsapp_number, 30).replace(/\D/g, '').slice(0, 15),
    google_map_embed_url: googleMapEmbedUrl(source.google_map_embed_url) || defaultCompanyProfile.google_map_embed_url,
    why_remedium_eyebrow: text(source.why_remedium_eyebrow, 100) || defaultCompanyProfile.why_remedium_eyebrow,
    why_remedium_title: text(source.why_remedium_title, 220) || defaultCompanyProfile.why_remedium_title,
    why_remedium_intro: text(source.why_remedium_intro, 500) || defaultCompanyProfile.why_remedium_intro,
    why_remedium_body: text(source.why_remedium_body, 2200) || defaultCompanyProfile.why_remedium_body,
    why_remedium_point_one: text(source.why_remedium_point_one, 280) || defaultCompanyProfile.why_remedium_point_one,
    why_remedium_point_two: text(source.why_remedium_point_two, 280) || defaultCompanyProfile.why_remedium_point_two,
    why_remedium_point_three: text(source.why_remedium_point_three, 280) || defaultCompanyProfile.why_remedium_point_three,
    why_remedium_badge_url: validLogoUrl(source.why_remedium_badge_url) || defaultCompanyProfile.why_remedium_badge_url,
    brochure_url: validLogoUrl(source.brochure_url),
    footer_disclaimer: text(source.footer_disclaimer, 3000) || defaultCompanyProfile.footer_disclaimer,
    footer_terms: text(source.footer_terms, 3000) || defaultCompanyProfile.footer_terms,
    fofo_terms: text(source.fofo_terms, 8000) || defaultCompanyProfile.fofo_terms,
    foco_terms: text(source.foco_terms, 8000) || defaultCompanyProfile.foco_terms,
    foco_phase_2_terms: text(source.foco_phase_2_terms, 8000) || defaultCompanyProfile.foco_phase_2_terms,
    foco_phase_3_terms: text(source.foco_phase_3_terms, 8000) || defaultCompanyProfile.foco_phase_3_terms,
    foco_phase_3_terms_version: Math.max(1, number(source.foco_phase_3_terms_version) || defaultCompanyProfile.foco_phase_3_terms_version),
    agreement_terms: text(source.agreement_terms, 12000) || defaultCompanyProfile.agreement_terms,
    agreement_terms_version: Math.max(1, number(source.agreement_terms_version) || defaultCompanyProfile.agreement_terms_version),
  };
}

/** Public company profile with localhost upload URLs rewritten to RFMS_PUBLIC_ORIGIN. */
function publicCompanyProfile(value) {
  const profile = companyProfile(value);
  return {
    ...profile,
    logo_url: resolveUploadUrl(profile.logo_url) || profile.logo_url,
    why_remedium_badge_url: resolveUploadUrl(profile.why_remedium_badge_url) || profile.why_remedium_badge_url,
    brochure_url: resolveUploadUrl(profile.brochure_url),
  };
}

function logoData(value) {
  const match = typeof value === 'string' ? value.match(/^data:(image\/(png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/) : null;
  if (!match) return null;
  const bytes = Buffer.from(match[3], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
  return { bytes, extension: match[2] === 'jpeg' ? 'jpg' : match[2] };
}

function brochureData(value) {
  const match = typeof value === 'string' ? value.match(/^data:(application\/pdf|application\/octet-stream);base64,([a-zA-Z0-9+/=\r\n]+)$/) : null;
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 25 * 1024 * 1024 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return null;
  return bytes;
}

function siteLink(value) {
  const url = text(value, 500);
  if (!(url.startsWith('/') || /^https?:\/\//i.test(url))) return '';
  // Rewrite pending FFMS subdomain hosts to the live path preview on www.
  try {
    if (/^https?:\/\//i.test(url)) {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const publicOrigin = (() => {
        try { return new URL(String(process.env.RFMS_MARKETING_BASE_URL || process.env.RFMS_PUBLIC_BASE_URL || '')).origin; }
        catch { return ''; }
      })();
      if (host === 'onboard.e-remedium.in') return `${publicOrigin || 'https://www.e-remedium.in'}/onboard${parsed.pathname === '/' ? '/' : parsed.pathname}${parsed.search}`;
      if (host === 'franchise.e-remedium.in') return `${publicOrigin || 'https://www.e-remedium.in'}/franchise${parsed.pathname === '/' ? '/' : parsed.pathname}${parsed.search}`;
      if (host === 'ffms.e-remedium.in') return `${publicOrigin || 'https://www.e-remedium.in'}/ffms${parsed.pathname === '/' ? '/' : parsed.pathname}${parsed.search}`;
    }
  } catch {
    // keep original
  }
  return url;
}

function heroSlide(value, id = randomUUID()) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: text(id, 80) || randomUUID(),
    title: text(source.title, 90),
    description: text(source.description, 280),
    primary_button_text: text(source.primary_button_text, 80),
    primary_button_url: siteLink(source.primary_button_url),
    secondary_button_text: text(source.secondary_button_text, 80),
    secondary_button_url: siteLink(source.secondary_button_url),
    image_url: validImageUrl(source.image_url),
    is_published: source.is_published !== false,
    sort_order: number(source.sort_order),
  };
}

function number(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

const WEST_BENGAL_MAP_PROJECTION_VERSION = 'nh-map-r12-v2';
// Coordinates are percentages of the supplied National Highway West Bengal map.
// Keeping them in the service means the selected/occupied markers remain aligned
// after a refresh, rather than being tied to the browser's current size.
const westBengalMapPoints = {
  'kolkata': { x: 62, y: 80 }, 'north 24 parganas': { x: 65, y: 76 }, 'south 24 parganas': { x: 62, y: 86 },
  'howrah': { x: 55, y: 80 }, 'hooghly': { x: 54, y: 75 }, 'purba bardhaman': { x: 52, y: 71 },
  'paschim bardhaman': { x: 45, y: 69 }, 'darjeeling': { x: 45, y: 15 }, 'jalpaiguri': { x: 58, y: 22 },
  'malda': { x: 52, y: 45 }, 'murshidabad': { x: 54, y: 58 }, 'nadia': { x: 64, y: 64 },
  'bankura': { x: 41, y: 70 }, 'purulia': { x: 28, y: 73 }, 'paschim medinipur': { x: 43, y: 80 },
  'purba medinipur': { x: 55, y: 87 }, 'birbhum': { x: 48, y: 61 }, 'siliguri': { x: 45, y: 20 },
  'alipurduar': { x: 73, y: 23 }, 'cooch behar': { x: 65, y: 27 }, 'dakshin dinajpur': { x: 49, y: 39 },
  'uttar dinajpur': { x: 48, y: 33 }, 'jhargram': { x: 35, y: 83 }, 'kalimpong': { x: 55, y: 15 },
};

const westBengalAreaMapPoints = {
  'new town': { x: 63, y: 79 }, 'salt lake': { x: 62, y: 79 }, 'newtown': { x: 63, y: 79 },
  'habra': { x: 62, y: 73 }, 'ashoknagar': { x: 66, y: 77 }, 'barasat': { x: 64, y: 78 }, 'siliguri': { x: 45, y: 20 },
  'bardhaman': { x: 52, y: 71 }, 'howrah': { x: 55, y: 80 }, 'kolkata': { x: 62, y: 80 },
};

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function boundedDecimal(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.min(maximum, Math.max(minimum, parsed));
  return Math.round(bounded * 100) / 100;
}

function territoryMapPoint(district, area, x, y, projectionVersion) {
  const areaName = text(area, 160).toLowerCase();
  const areaPoint = Object.entries(westBengalAreaMapPoints).find(([name]) => areaName.includes(name))?.[1];
  const districtPoint = westBengalMapPoints[text(district, 100).toLowerCase()];
  const inferred = areaPoint || districtPoint;
  const reuseSavedPoint = projectionVersion === WEST_BENGAL_MAP_PROJECTION_VERSION || !inferred;
  return {
    x: boundedInteger(reuseSavedPoint ? x : inferred?.x, inferred?.x ?? 50, 5, 95),
    y: boundedInteger(reuseSavedPoint ? y : inferred?.y, inferred?.y ?? 50, 5, 95),
  };
}

function territoryAllocation(value) {
  const source = value && typeof value === 'object' ? value : {};
  const franchiseModel = text(source.franchise_model, 10).toUpperCase();
  const status = ['reserved', 'occupied'].includes(text(source.status, 20).toLowerCase()) ? text(source.status, 20).toLowerCase() : 'reserved';
  return {
    id: text(source.id, 80) || randomUUID(),
    application_id: text(source.application_id, 80),
    application_number: text(source.application_number, 80),
    applicant_name: text(source.applicant_name, 120),
    pincode: text(source.pincode, 10).replace(/\D/g, '').slice(0, 6),
    // Never invent FOFO for blank/invalid model — callers must pass FOFO or FOCO.
    franchise_model: ['FOFO', 'FOCO'].includes(franchiseModel) ? franchiseModel : '',
    status,
    created_at: text(source.created_at, 60) || new Date().toISOString(),
    updated_at: text(source.updated_at, 60) || new Date().toISOString(),
  };
}

function pinCode(value) {
  const result = text(String(value ?? ''), 10).replace(/\D/g, '').slice(0, 6);
  return /^\d{6}$/.test(result) ? result : '';
}

function territoryPincodes(value, legacyPincode = '') {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : [legacyPincode];
  return [...new Set(values.map(pinCode).filter(Boolean))].slice(0, 30);
}

function territoryPinCapacities(source, legacyPincodes, legacyFofo, legacyFoco) {
  const supplied = Array.isArray(source?.pin_capacities) ? source.pin_capacities : [];
  const entries = supplied.length ? supplied : legacyPincodes.map((pincode, index) => ({
    pincode,
    fofo_capacity: index === 0 ? legacyFofo : 0,
    foco_capacity: index === 0 ? legacyFoco : 0,
  }));
  const seen = new Set();
  return entries.map((entry) => {
    const input = entry && typeof entry === 'object' ? entry : { pincode: entry };
    const pincode = pinCode(input.pincode ?? input.code ?? input);
    if (!pincode || seen.has(pincode)) return null;
    seen.add(pincode);
    return {
      pincode,
      fofo_capacity: boundedInteger(input.fofo_capacity ?? input.fofo_available ?? input.fofo?.available, 0, 0, 500),
      foco_capacity: boundedInteger(input.foco_capacity ?? input.foco_available ?? input.foco?.available, 0, 0, 500),
    };
  }).filter(Boolean).slice(0, 30);
}

function territoryRecord(value, id = randomUUID()) {
  const source = value && typeof value === 'object' ? value : {};
  const point = territoryMapPoint(source.district, source.area, source.map_x, source.map_y, source.map_projection_version);
  const pincodes = territoryPincodes(source.pincodes, source.pincode);
  const legacyFofo = boundedInteger(source.fofo_capacity ?? source.fofo_available, 1, 0, 500);
  const legacyFoco = boundedInteger(source.foco_capacity ?? source.foco_available, 1, 0, 500);
  const pin_capacities = territoryPinCapacities(source, pincodes, legacyFofo, legacyFoco);
  const validPincodes = pin_capacities.map((item) => item.pincode);
  const fallbackPin = validPincodes[0] ?? '';
  const allocations = (Array.isArray(source.allocations) ? source.allocations : []).map((item) => {
    const allocation = territoryAllocation(item);
    if (!allocation.franchise_model) return null;
    return { ...allocation, pincode: validPincodes.includes(allocation.pincode) ? allocation.pincode : fallbackPin };
  }).filter(Boolean);
  const legacyRadius = boundedInteger(source.radius_km, 8, 1, 100);
  const fofoRadius = boundedInteger(source.fofo_radius_km, legacyRadius, 1, 100);
  const focoRadius = boundedInteger(source.foco_radius_km, legacyRadius, 1, 100);
  const fofoCapacity = pin_capacities.reduce((total, item) => total + item.fofo_capacity, 0);
  const focoCapacity = pin_capacities.reduce((total, item) => total + item.foco_capacity, 0);
  return {
    id: text(id || source.id, 80) || randomUUID(),
    state: text(source.state, 100) || 'West Bengal',
    district: text(source.district, 100),
    subdivision: text(source.subdivision, 100),
    area: text(source.area, 140),
    pincode: fallbackPin,
    pincodes: validPincodes,
    pin_capacities,
    radius_km: Math.max(fofoRadius, focoRadius),
    fofo_radius_km: fofoRadius,
    foco_radius_km: focoRadius,
    fofo_capacity: fofoCapacity,
    foco_capacity: focoCapacity,
    map_x: point.x,
    map_y: point.y,
    map_projection_version: WEST_BENGAL_MAP_PROJECTION_VERSION,
    allocations,
    created_at: text(source.created_at, 60) || new Date().toISOString(),
    updated_at: text(source.updated_at, 60) || new Date().toISOString(),
  };
}

function territoryLabel(territory) {
  return [territory.area, territory.subdivision, territory.district].filter(Boolean).join(' - ') || territory.district || 'Unnamed territory';
}

function allocationCountsForPin(territory, pincode, model) {
  const pin = territory.pin_capacities.find((item) => item.pincode === pincode);
  const allocations = territory.allocations.filter((item) => item.pincode === pincode && item.franchise_model === model);
  const reserved = allocations.filter((item) => item.status === 'reserved').length;
  const occupied = allocations.filter((item) => item.status === 'occupied').length;
  const capacity = model === 'FOFO' ? pin?.fofo_capacity ?? 0 : pin?.foco_capacity ?? 0;
  return { capacity, reserved, occupied, assigned: allocations.length, available: Math.max(0, capacity - allocations.length) };
}

function allocationCounts(territory, model) {
  return territory.pin_capacities.reduce((total, pin) => {
    const counts = allocationCountsForPin(territory, pin.pincode, model);
    return {
      capacity: total.capacity + counts.capacity,
      reserved: total.reserved + counts.reserved,
      occupied: total.occupied + counts.occupied,
      assigned: total.assigned + counts.assigned,
      available: total.available + counts.available,
    };
  }, { capacity: 0, reserved: 0, occupied: 0, assigned: 0, available: 0 });
}

function pinCapacitySummary(territory, pin) {
  const fofo = allocationCountsForPin(territory, pin.pincode, 'FOFO');
  const foco = allocationCountsForPin(territory, pin.pincode, 'FOCO');
  const capacity = fofo.capacity + foco.capacity;
  const available = fofo.available + foco.available;
  const assigned = fofo.assigned + foco.assigned;
  const occupied = fofo.occupied + foco.occupied;
  const reserved = fofo.reserved + foco.reserved;
  // A reservation consumes only its own model/PIN capacity. When capacity remains,
  // this PIN stays available and is displayed as partially available, not closed.
  const status = capacity === 0 || available === 0
    ? (reserved > 0 && occupied === 0 ? 'reserved' : 'occupied')
    : assigned > 0 ? 'partially_occupied' : 'available';
  return { pincode: pin.pincode, fofo, foco, status };
}

function territorySummary(territory, includeAllocations = true) {
  const fofo = allocationCounts(territory, 'FOFO');
  const foco = allocationCounts(territory, 'FOCO');
  const capacity = fofo.capacity + foco.capacity;
  const available = fofo.available + foco.available;
  const occupied = fofo.occupied + foco.occupied;
  const reserved = fofo.reserved + foco.reserved;
  const assigned = fofo.assigned + foco.assigned;
  // A territory is only fully reserved/occupied when no FOFO or FOCO slot is
  // available across its PIN codes. Partial reservations remain bookable.
  const status = capacity === 0 || available === 0
    ? (reserved > 0 && occupied === 0 ? 'reserved' : 'occupied')
    : assigned > 0 ? 'partially_occupied' : 'available';
  const summary = {
    id: territory.id, state: territory.state, district: territory.district, subdivision: territory.subdivision, area: territory.area,
    pincode: territory.pincode, pincodes: territory.pincodes, pin_capacities: territory.pin_capacities.map((pin) => pinCapacitySummary(territory, pin)), radius_km: territory.radius_km, fofo_radius_km: territory.fofo_radius_km, foco_radius_km: territory.foco_radius_km, map_x: territory.map_x, map_y: territory.map_y,
    fofo, foco, status, label: territoryLabel(territory), created_at: territory.created_at, updated_at: territory.updated_at,
  };
  return includeAllocations ? { ...summary, allocations: territory.allocations } : summary;
}

function territoryMetrics(territories = database.territories) {
  const summaries = territories.map((territory) => territorySummary(territory, false));
  return summaries.reduce((total, territory) => ({
    territories: total.territories + 1,
    fofo_available: total.fofo_available + territory.fofo.available,
    foco_available: total.foco_available + territory.foco.available,
    fofo_occupied: total.fofo_occupied + territory.fofo.occupied,
    foco_occupied: total.foco_occupied + territory.foco.occupied,
    reserved: total.reserved + territory.fofo.reserved + territory.foco.reserved,
    occupied_territories: total.occupied_territories + (territory.status === 'occupied' ? 1 : 0),
  }), { territories: 0, fofo_available: 0, foco_available: 0, fofo_occupied: 0, foco_occupied: 0, reserved: 0, occupied_territories: 0 });
}

function pinMetrics(pins) {
  return pins.reduce((total, pin) => ({
    fofo_available: total.fofo_available + pin.fofo.available,
    foco_available: total.foco_available + pin.foco.available,
    fofo_occupied: total.fofo_occupied + pin.fofo.occupied,
    foco_occupied: total.foco_occupied + pin.foco.occupied,
    reserved: total.reserved + pin.fofo.reserved + pin.foco.reserved,
  }), { fofo_available: 0, foco_available: 0, fofo_occupied: 0, foco_occupied: 0, reserved: 0 });
}

function publicPinRecords(territories = database.territories) {
  return territories.flatMap((territory) => territory.pin_capacities.map((pin) => ({
    ...pinCapacitySummary(territory, pin),
    territory_id: territory.id,
    state: territory.state,
    district: territory.district,
    subdivision: territory.subdivision,
    area: territory.area,
    label: territoryLabel(territory),
  }))).sort((a, b) => a.pincode.localeCompare(b.pincode));
}

function publicAvailableTerritories(model) {
  const franchiseModel = text(model, 10).toUpperCase();
  if (!['FOFO', 'FOCO'].includes(franchiseModel)) return [];
  const seen = new Set();
  return publicPinRecords()
    .filter((pin) => {
      const modelCounts = franchiseModel === 'FOFO' ? pin.fofo : pin.foco;
      return modelCounts.available > 0 && ['available', 'partially_occupied'].includes(pin.status);
    })
    .map((pin) => ({
      id: `${pin.territory_id}:${pin.pincode}`,
      name: pin.area || pin.label,
      district: pin.district,
      subdivision: pin.subdivision || '',
      pincode: pin.pincode,
    }))
    .filter((entry) => {
      const key = entry.id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((first, second) => (
      first.district.localeCompare(second.district)
      || first.name.localeCompare(second.name)
      || first.pincode.localeCompare(second.pincode)
    ));
}

function availabilityForQuery(query) {
  const pin = pinCode(query);
  if (pin) {
    const matches = publicPinRecords().filter((item) => item.pincode === pin);
    return { scope: 'pincode', place: pin, territories: database.territories.filter((territory) => territory.pincodes.includes(pin)), pins: matches };
  }
  const needle = text(query, 180).toLowerCase();
  const exactScopes = [['area', 'area'], ['subdivision', 'subdivision'], ['district', 'district'], ['state', 'state']];
  for (const [field, scope] of exactScopes) {
    const territories = database.territories.filter((territory) => text(territory[field], 180).toLowerCase() === needle);
    if (territories.length) return { scope, place: territories[0][field], territories, pins: publicPinRecords(territories) };
  }
  const territories = findTerritories(query);
  return { scope: 'search', place: territories[0]?.area || query, territories, pins: publicPinRecords(territories) };
}

function findTerritories(query) {
  const value = text(query, 180).toLowerCase();
  if (!value) return database.territories;
  return database.territories.filter((territory) => [territory.state, territory.district, territory.subdivision, territory.area, ...territory.pincodes].join(' ').toLowerCase().includes(value) || (value.length === 6 && territory.pincodes.includes(value)));
}

function territoryIsValid(territory) {
  return Boolean(territory.state && territory.district && territory.subdivision && territory.area && territory.pin_capacities.length && territory.fofo_capacity + territory.foco_capacity > 0);
}

function text(value, maxLength = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function googleMapsLocationUrl(value) {
  const raw = text(value, 1000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const isGoogleMapsHost = host === 'maps.app.goo.gl' || host === 'goo.gl' || /^([a-z0-9-]+\.)?google\.(com|co\.in)$/.test(host);
    if (!['https:', 'http:'].includes(parsed.protocol) || !isGoogleMapsHost) return '';
    return parsed.toString();
  } catch { return ''; }
}

function optionalGeoCoordinate(value, minimum, maximum) {
  if (value === undefined || value === null || value === '') return { valid: true, value: null };
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return { valid: false, value: null };
  return { valid: true, value: Math.round(number * 1_000_000) / 1_000_000 };
}

function geoDistanceKm(firstLatitude, firstLongitude, secondLatitude, secondLongitude) {
  const radians = (value) => value * Math.PI / 180;
  const latitudeDistance = radians(secondLatitude - firstLatitude);
  const longitudeDistance = radians(secondLongitude - firstLongitude);
  const value = Math.sin(latitudeDistance / 2) ** 2
    + Math.cos(radians(firstLatitude)) * Math.cos(radians(secondLatitude)) * Math.sin(longitudeDistance / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function activeAllotmentMapRecord(application) {
  const allotment = territoryAllotmentSummary(application?.territory_allotment) || territoryAllotmentsFor(application).at(-1);
  if (!application || !allotment || allotment.status !== 'active') return null;
  const latitude = optionalGeoCoordinate(allotment.latitude, -90, 90).value;
  const longitude = optionalGeoCoordinate(allotment.longitude, -180, 180).value;
  const territory = database.territories.find((item) => item.id === allotment.territory_id);
  return {
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    franchise_name: allotment.final_territory || application.full_name,
    franchise_model: application.franchise_model,
    territory_id: allotment.territory_id || '',
    pincode: allotment.pincode || application.pincode || '',
    subdivision: allotment.subdivision || territory?.subdivision || '',
    district: allotment.district || territory?.district || '',
    state: allotment.state || territory?.state || 'West Bengal',
    status: territory ? territorySummary(territory, false).status : 'occupied',
    latitude,
    longitude,
    radius_km: allotment.radius_km,
    coordinates_available: latitude !== null && longitude !== null,
  };
}

function territoryAllotmentConflicts(application, latitude, longitude, radiusKm) {
  if (latitude === null || longitude === null) return [];
  return database.applications
    .filter((candidate) => candidate.id !== application.id)
    .map(activeAllotmentMapRecord)
    .filter((candidate) => candidate?.coordinates_available)
    .map((candidate) => ({
      ...candidate,
      distance_km: Math.round(geoDistanceKm(latitude, longitude, candidate.latitude, candidate.longitude) * 100) / 100,
    }))
    .filter((candidate) => candidate.distance_km < radiusKm + candidate.radius_km);
}

const leadStages = new Set(['new', 'contacted', 'no_response', 'qualified', 'follow_up', 'application_started', 'won', 'lost', 'disqualified', 'completed']);
const leadSources = new Set(['website', 'meta_ads', 'google_ads', 'whatsapp_ads', 'manual', 'csv_upload', 'appointment', 'reach_sales', 'agency_agents']);
const leadPriorities = new Set(['hot', 'warm', 'normal', 'low']);
const leadActivityTypes = new Set(['created', 'imported', 'call', 'whatsapp', 'email', 'note', 'follow_up', 'stage_change', 'owner_change', 'claim']);

function leadStage(value) {
  const stage = text(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return leadStages.has(stage) ? stage : 'new';
}

function leadSource(value) {
  const source = text(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return leadSources.has(source) ? source : 'manual';
}

function leadActivity(value, createdAt = new Date().toISOString()) {
  const source = value && typeof value === 'object' ? value : {};
  const type = text(source.type, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return {
    id: text(source.id, 80) || randomUUID(),
    type: leadActivityTypes.has(type) ? type : 'note',
    message: text(source.message, 1200),
    actor: text(source.actor, 120) || 'RFMS system',
    created_at: text(source.created_at, 60) || createdAt,
  };
}

function sourceLabel(source) {
  return ({
    website: 'Website enquiry',
    meta_ads: 'Meta Ads',
    google_ads: 'Google Ads',
    whatsapp_ads: 'WhatsApp Ads',
    manual: 'Manual entry',
    csv_upload: 'CSV upload',
    appointment: 'Appointment conversion',
    reach_sales: 'Reach sales handoff',
    agency_agents: 'Agency agents onboard',
  })[source] ?? 'Manual entry';
}

function leadRecord(value, id = randomUUID()) {
  const source = value && typeof value === 'object' ? value : {};
  const createdAt = text(source.created_at, 60) || new Date().toISOString();
  const sourceName = leadSource(source.source);
  const history = Array.isArray(source.activity_history) ? source.activity_history.map((item) => leadActivity(item, createdAt)).filter((item) => item.message) : [];
  const notes = text(source.notes, 2000);
  if (!history.length) {
    const initialMessage = sourceName === 'website'
      ? 'Website franchise enquiry received.'
      : sourceName === 'meta_ads'
        ? `Meta Ads lead imported${text(source.campaign_name, 180) ? ` from campaign: ${text(source.campaign_name, 180)}.` : '.'}`
      : sourceName === 'google_ads'
        ? `Google Ads lead imported${text(source.campaign_name, 180) ? ` from campaign: ${text(source.campaign_name, 180)}.` : '.'}`
      : sourceName === 'whatsapp_ads'
        ? `WhatsApp Ads lead imported${text(source.campaign_name, 180) ? ` from campaign: ${text(source.campaign_name, 180)}.` : '.'}`
        : sourceName === 'csv_upload'
          ? 'Lead imported from CSV upload.'
          : sourceName === 'appointment'
            ? 'Lead created from a completed business consultation appointment.'
          : sourceName === 'reach_sales'
            ? 'Lead created from Reach sales handoff. Applicant will choose FOFO or FOCO on the portal.'
          : sourceName === 'agency_agents'
            ? 'Lead created from Agency Agents franchisee onboard request.'
          : 'Lead created manually in RFMS CRM.';
    history.push(leadActivity({ type: sourceName === 'manual' || sourceName === 'website' || sourceName === 'reach_sales' || sourceName === 'agency_agents' ? 'created' : 'imported', actor: sourceName === 'website' ? 'Website form' : sourceName === 'reach_sales' ? 'Reach sales' : sourceName === 'agency_agents' ? 'Agency Agents' : sourceName.endsWith('_ads') ? 'Ads webhook' : 'RFMS officer', message: initialMessage }, createdAt));
    if (notes) history.push(leadActivity({ type: 'note', actor: 'Lead source', message: notes }, createdAt));
  }
  const model = text(source.franchise_model, 10).toUpperCase();
  return {
    id: text(id || source.id, 80) || randomUUID(),
    name: text(source.name, 120),
    email: text(source.email, 160).toLowerCase(),
    mobile: text(source.mobile, 20),
    // Leave blank until the applicant chooses FOFO/FOCO on the portal form.
    franchise_model: ['FOFO', 'FOCO'].includes(model) ? model : '',
    territory_query: text(source.territory_query, 200),
    notes,
    source: sourceName,
    campaign_name: text(source.campaign_name, 180),
    campaign_id: text(source.campaign_id, 80),
    ad_id: text(source.ad_id, 80),
    adset_id: text(source.adset_id, 80),
    form_id: text(source.form_id, 80),
    platform: text(source.platform, 40),
    external_lead_id: text(source.external_lead_id, 120),
    utm_source: text(source.utm_source, 80),
    utm_medium: text(source.utm_medium, 80),
    utm_campaign: text(source.utm_campaign, 120),
    gclid: text(source.gclid, 120),
    raw_source_payload: text(source.raw_source_payload, 4000),
    stage: leadStage(source.stage),
    priority: leadPriorities.has(text(source.priority, 20).toLowerCase()) ? text(source.priority, 20).toLowerCase() : 'normal',
    assigned_to: text(source.assigned_to, 120) || 'Unassigned',
    next_follow_up_at: text(source.next_follow_up_at, 60),
    last_contacted_at: text(source.last_contacted_at, 60),
    activity_history: history.slice(-100),
    hec_franchisee_profile: text(source.hec_franchisee_profile, 120),
    hec_session_id: text(source.hec_session_id, 120),
    hec_lead_id: text(source.hec_lead_id, 120),
    sales_rep_id: text(source.sales_rep_id, 120),
    reach_user_name: text(source.reach_user_name, 120),
    reach_user_email: text(source.reach_user_email, 160),
    reach_lead_source: text(source.reach_lead_source, 80),
    assignee_role: text(source.assignee_role, 40),
    whatsapp_conversation_id: text(source.whatsapp_conversation_id, 120),
    whatsapp_last_at: text(source.whatsapp_last_at, 60),
    whatsapp_messages: Array.isArray(source.whatsapp_messages)
      ? source.whatsapp_messages.slice(-200).map((item) => ({
        id: text(item?.id, 80) || randomUUID(),
        direction: text(item?.direction, 10) === 'Out' ? 'Out' : 'In',
        body: text(item?.body, 4000),
        meta_message_id: text(item?.meta_message_id, 140),
        status: text(item?.status, 40) || 'received',
        created_at: text(item?.created_at, 60) || createdAt,
      }))
      : [],
    created_at: createdAt,
    updated_at: text(source.updated_at, 60) || createdAt,
  };
}

function addLeadActivity(lead, type, message, actor) {
  const createdAt = new Date().toISOString();
  lead.activity_history = [...(Array.isArray(lead.activity_history) ? lead.activity_history : []), leadActivity({ type, message, actor, created_at: createdAt })].slice(-100);
  lead.updated_at = createdAt;
  if (['call', 'whatsapp', 'email'].includes(type)) lead.last_contacted_at = createdAt;
  return createdAt;
}

function salesVisitRecord(value, id = randomUUID()) {
  const source = value && typeof value === 'object' ? value : {};
  const createdAt = text(source.created_at, 60) || new Date().toISOString();
  const visitStatusRaw = text(source.visit_status, 40).toLowerCase().replace(/[\s-]+/g, '_');
  const visitStatus = ['assigned', 'in_progress', 'completed', 'cancelled'].includes(visitStatusRaw)
    ? visitStatusRaw
    : (Number(source.latitude) || Number(source.longitude) ? 'completed' : 'assigned');
  return {
    id: text(id || source.id, 80) || randomUUID(),
    hec_visit_id: text(source.hec_visit_id, 120),
    hec_lead_id: text(source.hec_lead_id, 120),
    rfms_lead_id: text(source.rfms_lead_id || source.lead_id, 120),
    lead_name: text(source.lead_name, 160),
    lead_phone: text(source.lead_phone, 20),
    reach_user: text(source.reach_user, 120),
    sales_rep_id: text(source.sales_rep_id, 120),
    visit_date: text(source.visit_date, 20),
    visit_time: text(source.visit_time, 20),
    purpose: text(source.purpose, 120) || 'Meet Lead',
    outcome: text(source.outcome, 120),
    visit_status: visitStatus,
    duration_minutes: Number(source.duration_minutes) || 0,
    latitude: Number(source.latitude) || null,
    longitude: Number(source.longitude) || null,
    notes: text(source.notes, 2000),
    photo_url: text(source.photo_url, 500),
    photo_data_url: text(source.photo_data_url, 600000),
    assigned_from: text(source.assigned_from, 120),
    source: text(source.source, 40) || 'reach',
    created_at: createdAt,
    updated_at: text(source.updated_at, 60) || createdAt,
  };
}

function ingestSalesVisitsIntoCrm(rows = []) {
  database.sales_visits = Array.isArray(database.sales_visits) ? database.sales_visits : [];
  const imported = [];
  const updated = [];
  const stageFromReachStatus = {
    New: 'new',
    Contacted: 'contacted',
    'Meeting Done': 'contacted',
    Qualified: 'qualified',
    Negotiation: 'follow_up',
    Won: 'won',
    Lost: 'lost',
  };
  for (const row of rows.slice(0, 500)) {
    if (!row || typeof row !== 'object') continue;
    const hecVisitId = text(row.hec_visit_id, 120);
    let existing = hecVisitId
      ? database.sales_visits.find((item) => item.hec_visit_id === hecVisitId)
      : null;
    // Prevent duplicate pending rows when hec_visit_id was missing on a prior stub.
    if (!existing && text(row.hec_lead_id, 120) && text(row.sales_rep_id, 120)) {
      existing = database.sales_visits.find((item) => (
        item.hec_lead_id === text(row.hec_lead_id, 120)
        && item.sales_rep_id === text(row.sales_rep_id, 120)
        && String(item.visit_status || '').toLowerCase() === 'assigned'
        && String(row.visit_status || '').toLowerCase() === 'assigned'
      )) || null;
    }
    const visit = salesVisitRecord({ ...(existing || {}), ...row, id: existing?.id }, existing?.id);
    if (!visit.rfms_lead_id && visit.hec_lead_id) {
      const lead = database.leads.find((item) => item.hec_lead_id === visit.hec_lead_id);
      if (lead) visit.rfms_lead_id = lead.id;
    }
    if (existing) {
      Object.assign(existing, visit);
      updated.push(existing);
    } else {
      database.sales_visits.unshift(visit);
      imported.push(visit);
    }
    const lead = visit.rfms_lead_id
      ? database.leads.find((item) => item.id === visit.rfms_lead_id)
      : (visit.hec_lead_id ? database.leads.find((item) => item.hec_lead_id === visit.hec_lead_id) : null);
    if (lead) {
      if (visit.reach_user) lead.assigned_to = visit.reach_user;
      if (visit.sales_rep_id) lead.sales_rep_id = visit.sales_rep_id;
      lead.assignee_role = lead.assignee_role || 'reach';
      const status = String(row.visit_status || visit.visit_status || '').toLowerCase();
      if (status === 'completed') {
        const mappedStage = stageFromReachStatus[text(row.lead_status, 40)] || null;
        if (mappedStage) lead.stage = mappedStage;
        else if (['new', ''].includes(String(lead.stage || '').toLowerCase())) lead.stage = 'contacted';
        lead.last_contacted_at = visit.updated_at || visit.created_at || new Date().toISOString();
      }
      addLeadActivity(
        lead,
        'note',
        `REACH visit ${status || 'logged'} · ${visit.purpose}${visit.outcome ? ` · ${visit.outcome}` : ''}${visit.notes ? ` — ${visit.notes.slice(0, 180)}` : ''}`,
        visit.reach_user || 'Reach sales',
      );
      if (status !== 'completed') lead.last_contacted_at = visit.created_at;
    }
  }
  return { imported, updated };
}

function leadIsValid(lead) {
  return Boolean(lead.name && isEmail(lead.email) && lead.mobile && ['FOFO', 'FOCO'].includes(lead.franchise_model) && lead.territory_query);
}

function franchiseAdsWebhookSecret() {
  return String(process.env.FRANCHISE_ADS_WEBHOOK_SECRET || process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET || '').trim();
}

function whatsappCloudSecret() {
  return String(process.env.WHATSAPP_CLOUD_WEBHOOK_SECRET || process.env.FRANCHISE_ADS_WEBHOOK_SECRET || process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET || '').trim();
}

function requireWhatsappCloudSecret(request, response) {
  const expected = whatsappCloudSecret();
  if (!expected) {
    failure(request, response, 'NOT_CONFIGURED', 'WhatsApp Cloud webhook secret is not configured on RFMS.', 503);
    return false;
  }
  const provided = String(request.headers['x-whatsapp-cloud-secret'] || '').trim();
  if (!provided || provided.length !== expected.length) {
    failure(request, response, 'UNAUTHORIZED', 'Invalid WhatsApp Cloud webhook secret.', 401);
    return false;
  }
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      failure(request, response, 'UNAUTHORIZED', 'Invalid WhatsApp Cloud webhook secret.', 401);
      return false;
    }
  } catch {
    failure(request, response, 'UNAUTHORIZED', 'Invalid WhatsApp Cloud webhook secret.', 401);
    return false;
  }
  return true;
}

function appendLeadWhatsappMessage(lead, message) {
  const entry = {
    id: text(message?.id, 80) || randomUUID(),
    direction: text(message?.direction, 10) === 'Out' ? 'Out' : 'In',
    body: text(message?.body, 4000),
    meta_message_id: text(message?.meta_message_id, 140),
    status: text(message?.status, 40) || (text(message?.direction, 10) === 'Out' ? 'sent' : 'received'),
    created_at: text(message?.created_at, 60) || new Date().toISOString(),
  };
  lead.whatsapp_messages = Array.isArray(lead.whatsapp_messages) ? lead.whatsapp_messages : [];
  if (entry.meta_message_id && lead.whatsapp_messages.some((item) => item.meta_message_id === entry.meta_message_id)) {
    return entry;
  }
  lead.whatsapp_messages.push(entry);
  lead.whatsapp_messages = lead.whatsapp_messages.slice(-200);
  lead.whatsapp_last_at = entry.created_at;
  if (message?.conversation_id) lead.whatsapp_conversation_id = text(message.conversation_id, 120);
  return entry;
}

function findLeadByMobileDigits(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!digits) return null;
  return (database.leads || []).find((lead) => String(lead.mobile || '').replace(/\D/g, '').slice(-10) === digits) || null;
}

function requireFranchiseAdsSecret(request, response) {
  const expected = franchiseAdsWebhookSecret();
  if (!expected) {
    failure(request, response, 'NOT_CONFIGURED', 'Franchise ads webhook secret is not configured on RFMS.', 503);
    return false;
  }
  const provided = String(request.headers['x-franchise-ads-secret'] || '').trim();
  if (!provided || provided.length !== expected.length) {
    failure(request, response, 'UNAUTHORIZED', 'Invalid franchise ads webhook secret.', 401);
    return false;
  }
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      failure(request, response, 'UNAUTHORIZED', 'Invalid franchise ads webhook secret.', 401);
      return false;
    }
  } catch {
    failure(request, response, 'UNAUTHORIZED', 'Invalid franchise ads webhook secret.', 401);
    return false;
  }
  return true;
}

function ingestAdLeadsIntoCrm(rows, defaults = {}) {
  const imported = [];
  const updated = [];
  const skipped = [];
  for (const row of rows.slice(0, 1000)) {
    const payload = adLeadPayloadFromRow(row, defaults);
    if (!adLeadIsAcceptable(payload)) {
      skipped.push({ name: payload.name || 'Unnamed lead', reason: 'Missing name, mobile or email' });
      continue;
    }
    const existing = findExistingAdLead(database.leads, payload);
    if (existing) {
      Object.assign(existing, {
        name: payload.name || existing.name,
        email: payload.email || existing.email,
        mobile: payload.mobile || existing.mobile,
        territory_query: payload.territory_query || existing.territory_query,
        notes: payload.notes || existing.notes,
        source: payload.source || existing.source,
        campaign_name: payload.campaign_name || existing.campaign_name,
        campaign_id: payload.campaign_id || existing.campaign_id,
        ad_id: payload.ad_id || existing.ad_id,
        adset_id: payload.adset_id || existing.adset_id,
        form_id: payload.form_id || existing.form_id,
        platform: payload.platform || existing.platform,
        external_lead_id: payload.external_lead_id || existing.external_lead_id,
        utm_source: payload.utm_source || existing.utm_source,
        utm_medium: payload.utm_medium || existing.utm_medium,
        utm_campaign: payload.utm_campaign || existing.utm_campaign,
        gclid: payload.gclid || existing.gclid,
        hec_lead_id: payload.hec_lead_id || existing.hec_lead_id,
        raw_source_payload: payload.raw_source_payload || existing.raw_source_payload,
        assigned_to: payload.assigned_to && payload.assigned_to !== 'Unassigned' ? payload.assigned_to : existing.assigned_to,
        stage: payload.stage || existing.stage,
        updated_at: new Date().toISOString(),
      });
      if (payload.franchise_model && ['FOFO', 'FOCO'].includes(payload.franchise_model)) {
        existing.franchise_model = payload.franchise_model;
      }
      addLeadActivity(existing, 'imported', payload.source === 'reach_sales' ? 'REACH Portal lead updated.' : `Ad lead updated from ${sourceLabel(payload.source)}.`, payload.source === 'reach_sales' ? 'Reach sales' : 'Ads webhook');
      updated.push(existing);
      continue;
    }
    const lead = leadRecord({
      ...payload,
      franchise_model: ['FOFO', 'FOCO'].includes(payload.franchise_model) ? payload.franchise_model : '',
      assigned_to: payload.assigned_to || 'Unassigned',
      stage: payload.stage || 'new',
      priority: payload.priority || 'normal',
    });
    database.leads.unshift(lead);
    imported.push(lead);
  }
  return { imported, updated, skipped };
}

const appointmentStatuses = new Set(['requested', 'scheduled', 'completed', 'no_show', 'cancelled', 'converted_to_lead']);
const appointmentModes = new Set(['virtual_google_meet', 'office_visit']);
const appointmentInterestLevels = new Set(['high', 'warm', 'low', 'not_interested']);
const appointmentModels = new Set(['FOFO', 'FOCO', 'both', 'not_discussed']);

function appointmentStatus(value) {
  const status = text(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return appointmentStatuses.has(status) ? status : 'requested';
}

function appointmentMode(value) {
  const mode = text(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return appointmentModes.has(mode) ? mode : 'office_visit';
}

function appointmentActivity(value, createdAt = new Date().toISOString()) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: text(source.id, 80) || randomUUID(),
    type: text(source.type, 40).toLowerCase().replace(/[\s-]+/g, '_') || 'note',
    message: text(source.message, 1600),
    actor: text(source.actor, 120) || 'RFMS system',
    created_at: text(source.created_at, 60) || createdAt,
  };
}

function appointmentRecord(value, id = randomUUID()) {
  const source = value && typeof value === 'object' ? value : {};
  const createdAt = text(source.created_at, 60) || new Date().toISOString();
  const history = Array.isArray(source.activity_history) ? source.activity_history.map((item) => appointmentActivity(item, createdAt)).filter((item) => item.message) : [];
  if (!history.length) history.push(appointmentActivity({ type: 'requested', message: 'Business consultation requested from the public website.', actor: 'Website form' }, createdAt));
  const discussed = text(source.franchise_model_discussed, 20).toLowerCase();
  const interest = text(source.interest_level, 30).toLowerCase();
  return {
    id: text(id || source.id, 80) || randomUUID(),
    name: text(source.name, 120),
    email: text(source.email, 160).toLowerCase(),
    mobile: text(source.mobile, 20),
    preferred_date: text(source.preferred_date, 10),
    preferred_time: text(source.preferred_time, 60),
    topic: text(source.topic, 180),
    territory_query: text(source.territory_query, 200),
    notes: text(source.notes, 2000),
    source: text(source.source, 40) || 'website',
    status: appointmentStatus(source.status),
    assigned_to: text(source.assigned_to, 120) || 'Unassigned',
    meeting_mode: appointmentMode(source.meeting_mode),
    confirmed_date: text(source.confirmed_date, 10),
    confirmed_time: text(source.confirmed_time, 60),
    meeting_link: text(source.meeting_link, 1000),
    meeting_location: text(source.meeting_location, 500),
    franchise_model_discussed: ['fofo', 'foco'].includes(discussed) ? discussed.toUpperCase() : appointmentModels.has(discussed) ? discussed : 'not_discussed',
    interest_level: appointmentInterestLevels.has(interest) ? interest : 'warm',
    outcome: text(source.outcome, 3000),
    converted_lead_id: text(source.converted_lead_id, 80),
    converted_at: text(source.converted_at, 60),
    activity_history: history.slice(-100),
    created_at: createdAt,
    updated_at: text(source.updated_at, 60) || createdAt,
  };
}

function appointmentSummary(appointment) {
  return appointmentRecord(appointment, appointment?.id);
}

function addAppointmentActivity(appointment, type, message, actor) {
  const createdAt = new Date().toISOString();
  appointment.activity_history = [...(Array.isArray(appointment.activity_history) ? appointment.activity_history : []), appointmentActivity({ type, message, actor, created_at: createdAt })].slice(-100);
  appointment.updated_at = createdAt;
  return createdAt;
}

function appointmentIsUnassigned(appointment) {
  return !text(appointment?.assigned_to, 120) || text(appointment?.assigned_to, 120).toLowerCase() === 'unassigned';
}

function appointmentAccess(request, appointment) {
  const session = sessionFor(request);
  if (!session || !roleHasPermission(session.role, 'appointments')) return false;
  return canManageAppointments(request) || appointmentIsUnassigned(appointment) || appointment.assigned_to === session.name;
}

function leadActor(request) {
  return sessionFor(request)?.name || 'RFMS officer';
}

function leadIsUnassigned(lead) {
  return !text(lead?.assigned_to, 120) || text(lead?.assigned_to, 120).toLowerCase() === 'unassigned';
}

function crmOwner(value) {
  const owner = text(value, 120);
  return crmEmployeeNames().has(owner) ? owner : 'Unassigned';
}

function appointmentOwner(value) {
  const owner = text(value, 120);
  return appointmentEmployeeNames().has(owner) ? owner : 'Unassigned';
}

function crmLeadAccess(request, lead) {
  const session = sessionFor(request);
  if (!session || !roleHasPermission(session.role, 'leads')) return false;
  return canManageCrm(request) || leadIsUnassigned(lead) || lead.assigned_to === session.name;
}

function completeLinkedLeadsForApplication(application) {
  if (!application || application.stage !== 'onboarding_completed') return 0;
  const email = text(application.email, 160).toLowerCase();
  const mobile = text(application.mobile, 20);
  if (!email && !mobile) return 0;
  let completed = 0;
  for (const lead of database.leads) {
    const sameEmail = email && lead.email?.toLowerCase() === email;
    const sameMobile = mobile && lead.mobile === mobile;
    if ((!sameEmail && !sameMobile) || lead.stage === 'completed') continue;
    const previous = lead.stage;
    lead.stage = 'completed';
    lead.next_follow_up_at = '';
    addLeadActivity(lead, 'stage_change', `Application ${application.application_number} completed onboarding. Lead moved from ${previous.replaceAll('_', ' ')} to the Completed directory.`, 'RFMS system');
    completed += 1;
  }
  return completed;
}

function receiptText(value, maxLength = 240) {
  return text(String(value ?? ''), maxLength).replace(/â€”|—/g, '-').replace(/â€“|–/g, '-').replace(/â†’|→/g, '->').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&');
}

function receiptAmount(value) {
  return `INR ${Number(value || 0).toLocaleString('en-IN')}`;
}

function receiptDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function receiptTransactionNumber(payment) {
  const saved = receiptText(payment.transaction_number, 80);
  if (saved) return saved;
  const suffix = receiptText(payment.receipt_number, 80).replace(/^RCP-/, '');
  return suffix ? `TXN-${suffix}` : 'TXN-UNAVAILABLE';
}

function receiptWrap(value, lineLength = 46) {
  const words = receiptText(value, 500).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > lineLength) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['Not available'];
}

function fieldVisitPdfSanitize(value, maxLength = 5000) {
  return text(String(value ?? ''), maxLength)
    .replace(/\r\n/g, '\n')
    .replace(/[•●◦▪▫■□]/g, '-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2192/g, '->')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, '?')
    .replace(/[\\()]/g, '\\$&');
}

function fieldVisitPdfWrap(value, lineLength = 88, maxLength = 5000) {
  const sanitized = fieldVisitPdfSanitize(value, maxLength);
  if (!sanitized.trim()) return ['Not available'];
  const paragraphs = sanitized.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      if (line && `${line} ${word}`.length > lineLength) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ['Not available'];
}

function fieldVisitNarrativeBlocks(report, visit) {
  return [
    ['SITE ADDRESS', report.site_address || 'Not recorded.', 700],
    ['GOOGLE MAPS LOCATION', googleMapsLocationUrl(report.google_maps_url) || 'No Google Maps location link was recorded.', 500],
    ['INSPECTION SUMMARY', report.inspection_summary || 'No inspection summary was recorded.', 5000],
    ['PROPERTY CONDITION', report.property_condition || 'No property condition was recorded.', 3000],
    ['DOCUMENTS OBSERVED', report.documents_observed || 'No documents were recorded.', 3000],
    ['OFFICER RECOMMENDATION', report.recommendation || 'No recommendation was recorded.', 3000],
    ['OFFICER REMARKS', report.officer_remarks || 'No officer remarks were recorded.', 3000],
    ['MANAGER REMARKS', visit.manager_remarks || 'No manager remarks were recorded.', 3000],
  ].map(([heading, value, maxLength]) => ({ heading, lines: fieldVisitPdfWrap(value, 88, maxLength) }));
}

function paginateFieldVisitNarrative(blocks, firstPageStartY, nextPageStartY, bottomY, lineHeight = 12, headingHeight = 20, blockPadding = 10) {
  const pages = [[]];
  let pageIndex = 0;
  let y = firstPageStartY;

  function startNewPage() {
    pageIndex += 1;
    pages[pageIndex] = [];
    y = nextPageStartY;
  }

  for (const block of blocks) {
    let lineIndex = 0;
    let heading = block.heading;
    while (lineIndex < block.lines.length) {
      const available = y - bottomY - headingHeight - blockPadding;
      const maxLines = Math.max(1, Math.floor(available / lineHeight));
      if (available < lineHeight) {
        startNewPage();
        continue;
      }
      const chunkLines = block.lines.slice(lineIndex, lineIndex + maxLines);
      lineIndex += chunkLines.length;
      pages[pageIndex].push({ heading, lines: chunkLines });
      y -= headingHeight + chunkLines.length * lineHeight + blockPadding;
      if (lineIndex < block.lines.length) {
        heading = `${block.heading} (continued)`;
        startNewPage();
      }
    }
  }

  return pages.filter((page) => page.length);
}

function fieldVisitReportNarrativeDraw(blocks, startY, lineHeight = 12, headingHeight = 20, blockPadding = 10) {
  const commands = [];
  let y = startY;
  for (const block of blocks) {
    const boxHeight = headingHeight + block.lines.length * lineHeight + blockPadding;
    const boxBottom = y - boxHeight + 5;
    commands.push(
      'q', '0.95 0.99 0.99 rg', `44 ${boxBottom} 507 ${boxHeight - 5} re f`, '0.79 0.90 0.93 RG', `44 ${boxBottom} 507 ${boxHeight - 5} re S`, 'Q',
      pdfText(block.heading, 58, y - 6, 8.7, 'F2', '0.05 0.42 0.62'),
      ...block.lines.map((line, index) => pdfText(line, 58, y - headingHeight - index * lineHeight, 8.7, 'F1', '0.16 0.28 0.40')),
    );
    y -= boxHeight;
  }
  return { commands, endY: y };
}

function fieldVisitReportHeaderDraw(profile, companyName, contactPhone, contactEmail, addressLines, headerLogo, compact = false) {
  if (compact) {
    return [
      'q', '0.03 0.16 0.35 rg', '0 780 595 62 re f', 'Q',
      'q', '1 1 1 rg', '42 792 204 40 re f', 'Q', headerLogo,
      pdfText('FIELD VISIT VERIFICATION REPORT', 48, 801, 8.5, 'F2', '0.75 0.91 0.96'),
      pdfText(profile.franchise_hub_name, 302, 818, 13, 'F2', '1 1 1'),
      pdfText(`Phone: ${contactPhone}`, 302, 798, 8.2, 'F1', '0.80 0.91 0.97'),
    ];
  }
  return [
    'q', '0.03 0.16 0.35 rg', '0 700 595 142 re f', 'Q',
    'q', '1 1 1 rg', '42 762 204 57 re f', 'Q', headerLogo,
    pdfText('FIELD VISIT VERIFICATION REPORT', 48, 741, 9, 'F2', '0.75 0.91 0.96'),
    pdfText(profile.franchise_hub_name, 302, 808, 15, 'F2', '1 1 1'),
    ...addressLines.map((line, index) => pdfText(line, 302, 789 - index * 12, 8.7, 'F1', '0.80 0.91 0.97')),
    pdfText(`Phone: ${contactPhone}`, 302, 758, 8.7, 'F1', '0.80 0.91 0.97'),
    pdfText(`Email: ${contactEmail}`, 302, 745, 8.7, 'F1', '0.80 0.91 0.97'),
  ];
}

function fieldVisitReportFooterDraw(application) {
  return [
    '0.09 0.53 0.55 rg', '44 56 507 1 re f',
    pdfText('This locked report is part of the franchise application onboarding audit history.', 44, 37, 8.5, 'F1', '0.34 0.45 0.57'),
    pdfText(`Application ${application.application_number}`, 44, 22, 8.2, 'F1', '0.34 0.45 0.57'),
  ];
}

function pdfText(value, x, y, size = 10, font = 'F1', colour = '0.07 0.18 0.37') {
  return `${colour} rg\nBT /${font} ${size} Tf ${x} ${y} Td (${receiptText(value, 500)}) Tj ET`;
}

const PDF_HELVETICA_WIDTHS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 222,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

function pdfHelveticaTextWidth(text, size, font = 'F1') {
  const scale = size / 1000;
  const boldScale = font === 'F2' ? 1.04 : 1;
  return [...text].reduce((width, char) => width + (PDF_HELVETICA_WIDTHS[char] ?? 500) * scale * boldScale, 0);
}

function pdfCenteredText(value, centerX, y, size = 10, font = 'F1', colour = '0.07 0.18 0.37') {
  const label = receiptText(value, 500);
  const x = centerX - pdfHelveticaTextWidth(label, size, font) / 2;
  return pdfText(label, x, y, size, font, colour);
}

function pdfCenteredHorizontalRule(centerX, y, width, colour = '0.72 0.78 0.88', lineWidth = 0.5) {
  const left = centerX - width / 2;
  return `${colour} RG\n${lineWidth} w\n${left.toFixed(1)} ${y} m ${(left + width).toFixed(1)} ${y} l S`;
}

function pdfCenteredFillRule(centerX, y, width, height = 1, colour = '0.04 0.63 0.64') {
  const left = centerX - width / 2;
  return `${colour} rg\n${left.toFixed(1)} ${y} ${width.toFixed(1)} ${height} re f`;
}

function pdfTextBlock(value, x, y, options = {}) {
  const { size = 10, font = 'F1', colour = '0.07 0.18 0.37', leading = 13, lineLength = 46 } = options;
  return receiptWrap(value, lineLength).map((line, index) => pdfText(line, x, y - index * leading, size, font, colour)).join('\n');
}

function pdfStream(dictionary, bytes) {
  return Buffer.concat([Buffer.from(`${dictionary}\nstream\n`, 'ascii'), bytes, Buffer.from('\nendstream', 'ascii')]);
}

function buildPdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n%RFMS\n', 'ascii')];
  const offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, 'ascii');
    const content = Buffer.isBuffer(object) ? object : Buffer.from(object, 'ascii');
    const suffix = Buffer.from('\nendobj\n', 'ascii');
    chunks.push(prefix, content, suffix);
    size += prefix.length + content.length + suffix.length;
  });
  const xref = size;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'ascii'));
  return Buffer.concat(chunks);
}

const LEGACY_LOGO_CANVAS = { width: 1920, height: 1080, left: 222, top: 369, widthCrop: 1441, heightCrop: 367 };

function legacyLogoCropBounds(width, height) {
  if (width === LEGACY_LOGO_CANVAS.width && height === LEGACY_LOGO_CANVAS.height) {
    return { left: LEGACY_LOGO_CANVAS.left, top: LEGACY_LOGO_CANVAS.top, width: LEGACY_LOGO_CANVAS.widthCrop, height: LEGACY_LOGO_CANVAS.heightCrop };
  }
  return null;
}

function pdfRgbImage(width, height, rgb) {
  const compressed = deflateSync(rgb);
  return { width, height, object: pdfStream(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>`, compressed) };
}

function cropPdfRgbImage(image, crop) {
  const rgb = Buffer.alloc(crop.width * crop.height * 3);
  for (let row = 0; row < crop.height; row += 1) {
    for (let column = 0; column < crop.width; column += 1) {
      const source = ((crop.top + row) * image.width + (crop.left + column)) * 3;
      const target = (row * crop.width + column) * 3;
      rgb[target] = image.rgb[source];
      rgb[target + 1] = image.rgb[source + 1];
      rgb[target + 2] = image.rgb[source + 2];
    }
  }
  return pdfRgbImage(crop.width, crop.height, rgb);
}

function pdfHeaderLogoDraw(logo) {
  const scale = Math.min(184 / logo.width, 45 / logo.height);
  const width = logo.width * scale;
  const height = logo.height * scale;
  return `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${(52 + (184 - width) / 2).toFixed(2)} ${(768 + (45 - height) / 2).toFixed(2)} cm\n/Logo Do\nQ`;
}

function pngReceiptImage(bytes, crop = null) {
  const signature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== signature) return null;
  let cursor = 8; let width = 0; let height = 0; let colourType = -1; let bitDepth = 0; let interlace = 0;
  const idat = [];
  while (cursor + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor); const type = bytes.subarray(cursor + 4, cursor + 8).toString('ascii');
    const dataStart = cursor + 8; const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    if (type === 'IHDR') { width = bytes.readUInt32BE(dataStart); height = bytes.readUInt32BE(dataStart + 4); bitDepth = bytes[dataStart + 8]; colourType = bytes[dataStart + 9]; interlace = bytes[dataStart + 12]; }
    if (type === 'IDAT') idat.push(bytes.subarray(dataStart, dataEnd));
    cursor = dataEnd + 4;
  }
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : colourType === 0 ? 1 : 0;
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !channels || !idat.length) return null;
  const raw = inflateSync(Buffer.concat(idat)); const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;
  const decoded = Buffer.alloc(height * stride); let source = 0;
  const paeth = (left, above, upperLeft) => { const estimate = left + above - upperLeft; const leftDelta = Math.abs(estimate - left); const aboveDelta = Math.abs(estimate - above); const upperLeftDelta = Math.abs(estimate - upperLeft); return leftDelta <= aboveDelta && leftDelta <= upperLeftDelta ? left : aboveDelta <= upperLeftDelta ? above : upperLeft; };
  for (let row = 0; row < height; row += 1) {
    const filter = raw[source++]; const base = row * stride; const above = base - stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[source++]; const left = column >= channels ? decoded[base + column - channels] : 0; const up = row ? decoded[above + column] : 0; const upLeft = row && column >= channels ? decoded[above + column - channels] : 0;
      decoded[base + column] = filter === 0 ? value : filter === 1 ? (value + left) & 255 : filter === 2 ? (value + up) & 255 : filter === 3 ? (value + Math.floor((left + up) / 2)) & 255 : filter === 4 ? (value + paeth(left, up, upLeft)) & 255 : value;
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const read = pixel * channels; const write = pixel * 3; const alpha = colourType === 6 ? decoded[read + 3] / 255 : 1;
    const red = colourType === 0 ? decoded[read] : decoded[read]; const green = colourType === 0 ? decoded[read] : decoded[read + 1]; const blue = colourType === 0 ? decoded[read] : decoded[read + 2];
    rgb[write] = Math.round(red * alpha + 255 * (1 - alpha)); rgb[write + 1] = Math.round(green * alpha + 255 * (1 - alpha)); rgb[write + 2] = Math.round(blue * alpha + 255 * (1 - alpha));
  }
  const decodedImage = { width, height, rgb };
  if (crop) return cropPdfRgbImage(decodedImage, crop);
  return pdfRgbImage(width, height, rgb);
}

function jpegReceiptImage(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let cursor = 2;
  while (cursor + 9 < bytes.length) {
    if (bytes[cursor] !== 0xff) { cursor += 1; continue; }
    const marker = bytes[cursor + 1]; cursor += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(cursor); if (length < 2 || cursor + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xc3) { const height = bytes.readUInt16BE(cursor + 3); const width = bytes.readUInt16BE(cursor + 5); const components = bytes[cursor + 7]; return { width, height, object: pdfStream(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${components === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, bytes) }; }
    cursor += length;
  }
  return null;
}

async function receiptLogoImage() {
  const saved = text(database.company_profile.logo_url, 500);
  const localUpload = saved.match(new RegExp(`^http://localhost:${port}/uploads/([A-Za-z0-9._-]+)$`));
  const candidates = [
    localUpload ? path.join(uploadsDirectory, localUpload[1]) : null,
    path.join(process.cwd(), 'apps', 'marketing-web', 'public', 'remedium-lab-logo.png'),
    path.join(process.cwd(), 'apps', 'marketing-web', 'out', 'remedium-lab-logo.png'),
  ].filter(Boolean);
  for (const filePath of candidates) {
    try {
      const bytes = await readFile(filePath);
      const png = pngReceiptImage(bytes);
      if (!png) {
        const jpeg = jpegReceiptImage(bytes);
        if (jpeg) return jpeg;
        continue;
      }
      const crop = legacyLogoCropBounds(png.width, png.height);
      return crop ? pngReceiptImage(bytes, crop) : png;
    } catch { /* try next candidate */ }
  }
  return null;
}

function qrBch(value, polynomial) { let shifted = value; while (shifted.toString(2).length >= polynomial.toString(2).length) shifted ^= polynomial << (shifted.toString(2).length - polynomial.toString(2).length); return shifted; }

function receiptQrMatrix(payload) {
  const data = Buffer.from(payload, 'utf8');
  // Byte-mode ECC-L capacities. Versions 5–6 cover production verify URLs
  // (e.g. https://www.e-remedium.in/rfms-api/v1/.../TRN-RFMS-2026-0015 ≈ 85 bytes).
  // Versions 7+ need version-info blocks this encoder does not emit yet.
  const configuration = [
    { version: 1, dataCodewords: 19, ecCodewords: 7, size: 21, alignment: [] },
    { version: 2, dataCodewords: 34, ecCodewords: 10, size: 25, alignment: [6, 18] },
    { version: 3, dataCodewords: 55, ecCodewords: 15, size: 29, alignment: [6, 22] },
    { version: 4, dataCodewords: 80, ecCodewords: 20, size: 33, alignment: [6, 26] },
    { version: 5, dataCodewords: 108, ecCodewords: 26, size: 37, alignment: [6, 30] },
    { version: 6, dataCodewords: 136, ecCodewords: 30, size: 41, alignment: [6, 34] },
  ].find((item) => data.length <= item.dataCodewords - 2);
  if (!configuration) return null;
  const bits = [0, 1, 0, 0, ...Array.from({ length: 8 }, (_, index) => (data.length >> (7 - index)) & 1)];
  for (const byte of data) for (let bit = 7; bit >= 0; bit -= 1) bits.push((byte >> bit) & 1);
  for (let index = 0; index < 4 && bits.length < configuration.dataCodewords * 8; index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let index = 0; index < bits.length; index += 8) codewords.push(bits.slice(index, index + 8).reduce((total, bit) => (total << 1) | bit, 0));
  for (let index = 0; codewords.length < configuration.dataCodewords; index += 1) codewords.push(index % 2 ? 0x11 : 0xec);
  const exp = Array(512).fill(0); const log = Array(256).fill(0); let value = 1;
  for (let index = 0; index < 255; index += 1) { exp[index] = value; log[value] = index; value <<= 1; if (value & 0x100) value ^= 0x11d; }
  for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255];
  const multiply = (left, right) => { const result = Array(left.length + right.length - 1).fill(0); left.forEach((a, row) => right.forEach((b, column) => { if (a && b) result[row + column] ^= exp[log[a] + log[b]]; })); return result; };
  let generator = [1]; for (let index = 0; index < configuration.ecCodewords; index += 1) generator = multiply(generator, [1, exp[index]]);
  const remainder = codewords.concat(Array(configuration.ecCodewords).fill(0));
  for (let index = 0; index < codewords.length; index += 1) { const factor = remainder[index]; if (factor) generator.forEach((coefficient, offset) => { remainder[index + offset] ^= exp[log[coefficient] + log[factor]]; }); }
  const allCodewords = codewords.concat(remainder.slice(-configuration.ecCodewords));
  const matrix = Array.from({ length: configuration.size }, () => Array(configuration.size).fill(null));
  const finder = (row, column) => { for (let y = -1; y <= 7; y += 1) for (let x = -1; x <= 7; x += 1) if (row + y >= 0 && row + y < configuration.size && column + x >= 0 && column + x < configuration.size) matrix[row + y][column + x] = y >= 0 && y <= 6 && x >= 0 && x <= 6 && (y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4)); };
  finder(0, 0); finder(configuration.size - 7, 0); finder(0, configuration.size - 7);
  for (let index = 8; index < configuration.size - 8; index += 1) { if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0; if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0; }
  for (const row of configuration.alignment) for (const column of configuration.alignment) {
    if (matrix[row][column] !== null) continue;
    for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) matrix[row + y][column + x] = Math.abs(y) === 2 || Math.abs(x) === 2 || (x === 0 && y === 0);
  }
  const formatBits = ((8 << 10) | qrBch(8 << 10, 0x537)) ^ 0x5412;
  for (let index = 0; index < 15; index += 1) {
    const dark = ((formatBits >> index) & 1) === 1;
    if (index < 6) matrix[index][8] = dark; else if (index < 8) matrix[index + 1][8] = dark; else matrix[configuration.size - 15 + index][8] = dark;
    if (index < 8) matrix[8][configuration.size - index - 1] = dark; else if (index < 9) matrix[8][15 - index] = dark; else matrix[8][15 - index - 1] = dark;
  }
  matrix[configuration.size - 8][8] = true;
  let row = configuration.size - 1; let direction = -1; let byte = 0; let bit = 7;
  for (let column = configuration.size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) if (matrix[row][column - offset] === null) {
        let dark = byte < allCodewords.length && ((allCodewords[byte] >> bit) & 1) === 1;
        if ((row + column - offset) % 2 === 0) dark = !dark;
        matrix[row][column - offset] = dark; bit -= 1; if (bit < 0) { byte += 1; bit = 7; }
      }
      row += direction; if (row < 0 || row >= configuration.size) { row -= direction; direction = -direction; break; }
    }
  }
  return matrix;
}

function pdfQr(matrix, x, y, size) {
  if (!matrix) return '';
  const module = size / matrix.length; const commands = ['0 0 0 rg'];
  matrix.forEach((row, rowIndex) => row.forEach((dark, columnIndex) => { if (dark) commands.push(`${(x + columnIndex * module).toFixed(3)} ${(y + (matrix.length - rowIndex - 1) * module).toFixed(3)} ${module.toFixed(3)} ${module.toFixed(3)} re f`); }));
  return commands.join('\n');
}

async function paymentReceiptPdf(application, payment) {
  const profile = companyProfile(database.company_profile);
  const companyName = receiptText(profile.company_name, 120);
  const contactPhone = receiptText(profile.company_phone || '03369029634', 40);
  const contactEmail = receiptText(profile.company_email || 'support@remediumcare.in', 160);
  const transactionNumber = receiptTransactionNumber(payment);
  const acceptedTerms = payment.key === 'franchise_fee' ? application.payment_terms?.franchise_fee : payment.key === 'security_deposit' ? application.payment_terms?.security_deposit : null;
  const verificationUrl = `${publicApiBaseUrl()}/receipts/verify/${encodeURIComponent(receiptText(payment.receipt_number, 80))}`;
  const qr = receiptQrMatrix(verificationUrl);
  const logo = await receiptLogoImage();
  const logoObjectNumber = logo ? 7 : 0;
  const imageResources = logo ? ` /XObject << /Logo ${logoObjectNumber} 0 R >>` : '';
  const headerLogo = logo
    ? pdfHeaderLogoDraw(logo)
    : ['0.04 0.63 0.64 rg', '52 776 34 34 re f', pdfText('RL', 61, 787, 12, 'F2', '1 1 1'), pdfText(companyName, 98, 790, 18, 'F2', '1 1 1')].join('\n');
  const purposeLines = receiptWrap(payment.purpose, 43).slice(0, 2);
  const addressLines = receiptWrap(profile.office_address, 42).slice(0, 2);
  const franchiseeId = franchiseeIdForApplication(application);
  const applicantMeta = franchiseeId
    ? `Franchisee ID ${franchiseeId}`
    : `Application no. ${application.application_number}`;
  const body = [
    'q', '0.03 0.16 0.35 rg', '0 700 595 142 re f', 'Q',
    'q', '1 1 1 rg', '42 762 204 57 re f', 'Q', headerLogo,
    pdfText('OFFICIAL FRANCHISE PAYMENT RECEIPT', 48, 741, 9, 'F2', '0.75 0.91 0.96'),
    pdfText(profile.franchise_hub_name, 302, 808, 15, 'F2', '1 1 1'),
    ...addressLines.map((line, index) => pdfText(line, 302, 789 - index * 12, 8.7, 'F1', '0.80 0.91 0.97')),
    pdfText(`Phone: ${contactPhone}`, 302, 758, 8.7, 'F1', '0.80 0.91 0.97'),
    pdfText(`Email: ${contactEmail}`, 302, 745, 8.7, 'F1', '0.80 0.91 0.97'),
    pdfText('PAYMENT RECEIPT', 44, 663, 20, 'F2'),
    pdfText(`Receipt no. ${receiptText(payment.receipt_number, 80)}`, 44, 641, 10, 'F2', '0.05 0.49 0.52'),
    pdfText(`Issued ${receiptDate(payment.paid_at)}`, 44, 625, 9, 'F1', '0.34 0.45 0.57'),
    'q', '0.90 0.98 0.94 rg', '462 628 89 26 re f', 'Q', pdfText('PAID', 488, 637, 10, 'F2', '0.05 0.48 0.29'),
    'q', '0.98 0.99 1 rg', '44 538 244 65 re f', '0.84 0.89 0.94 RG', '44 538 244 65 re S', 'Q',
    pdfText('APPLICANT', 58, 584, 8, 'F2', '0.36 0.48 0.61'), pdfText(application.full_name, 58, 565, 13, 'F2'), pdfText(applicantMeta, 58, 548, 9, 'F1', '0.34 0.45 0.57'),
    'q', '0.94 0.99 0.98 rg', '307 538 244 65 re f', '0.70 0.88 0.85 RG', '307 538 244 65 re S', 'Q',
    pdfText('PROPOSED FRANCHISE LOCATION', 321, 584, 8, 'F2', '0.04 0.50 0.52'), pdfText(application.preferred_location, 321, 565, 13, 'F2'), pdfText('Subject to territory review and approval', 321, 548, 9, 'F1', '0.34 0.45 0.57'),
    'q', '1 1 1 rg', '44 343 507 170 re f', '0.84 0.89 0.94 RG', '44 343 507 170 re S', 'Q',
    pdfText('PAYMENT DETAILS', 58, 491, 10, 'F2', '0.05 0.42 0.62'),
    '0.90 0.93 0.96 RG', '58 475 479 1 re f',
    pdfText('Franchise model', 58, 454, 9, 'F1', '0.36 0.48 0.61'), pdfText(application.franchise_model, 234, 454, 9.5, 'F2'),
    pdfText('Payment segment', 58, 428, 9, 'F1', '0.36 0.48 0.61'), pdfText(payment.label, 234, 428, 9.5, 'F2'),
    pdfText('Transaction no.', 58, 402, 9, 'F1', '0.36 0.48 0.61'), pdfText(transactionNumber, 234, 402, 9.5, 'F2'),
    pdfText('Payment date', 58, 376, 9, 'F1', '0.36 0.48 0.61'), pdfText(receiptDate(payment.paid_at), 234, 376, 9.5, 'F2'),
    pdfText('Payment purpose', 58, 350, 9, 'F1', '0.36 0.48 0.61'), ...purposeLines.map((line, index) => pdfText(line, 234, 350 - index * 11, 9.2, 'F1')),
    acceptedTerms ? pdfText(`Accepted terms version`, 58, 318, 9, 'F1', '0.36 0.48 0.61') : '',
    acceptedTerms ? pdfText(receiptText(acceptedTerms.terms_version ? `v${acceptedTerms.terms_version}` : 'current', 50), 234, 318, 9.5, 'F2') : '',
    acceptedTerms ? pdfText(`Terms accepted at`, 58, 292, 9, 'F1', '0.36 0.48 0.61') : '',
    acceptedTerms ? pdfText(receiptDate(acceptedTerms.accepted_at), 234, 292, 9.5, 'F2') : '',
    acceptedTerms ? pdfText(`Applicant confirmation`, 58, 266, 9, 'F1', '0.36 0.48 0.61') : '',
    acceptedTerms ? pdfText(receiptText(acceptedTerms.accepted_by || application.full_name, 80), 234, 266, 9.5, 'F2') : '',
    Number(payment.discount_amount) > 0 ? pdfText('Original amount', 58, 240, 9, 'F1', '0.36 0.48 0.61') : '',
    Number(payment.discount_amount) > 0 ? pdfText(receiptAmount(payment.original_amount ?? payment.amount), 234, 240, 9.5, 'F2') : '',
    Number(payment.discount_amount) > 0 ? pdfText('Coupon discount', 58, 224, 9, 'F1', '0.36 0.48 0.61') : '',
    Number(payment.discount_amount) > 0 ? pdfText(`-${receiptAmount(payment.discount_amount)} (${receiptText(payment.coupon_code, 40)})`, 234, 224, 9.5, 'F2', '0.05 0.48 0.29') : '',
    'q', '0.04 0.20 0.40 rg', '44 250 326 68 re f', 'Q', pdfText('AMOUNT RECEIVED', 60, 297, 9, 'F2', '0.68 0.90 0.94'), pdfText(receiptAmount(payment.amount), 60, 266, 24, 'F2', '1 1 1'),
    'q', '1 1 1 rg', '393 178 158 140 re f', '0.75 0.87 0.91 RG', '393 178 158 140 re S', 'Q',
    pdfQr(qr, 430, 210, 84), pdfText('SCAN TO VALIDATE', 406, 294, 8, 'F2', '0.05 0.42 0.62'), pdfText('Original RFMS receipt', 411, 196, 7.6, 'F1', '0.34 0.45 0.57'),
    '0.09 0.53 0.55 rg', '44 148 507 1 re f',
    pdfText('This digitally generated receipt confirms the payment recorded in the Remedium Lab Franchise Management System.', 44, 127, 8.5, 'F1', '0.34 0.45 0.57'),
    pdfText(`Need help? Call ${contactPhone} or email ${contactEmail}`, 44, 110, 8.5, 'F1', '0.34 0.45 0.57'),
  ].join('\n');
  const bodyBytes = Buffer.from(body, 'ascii');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${imageResources} >> /Contents 4 0 R >>`,
    pdfStream(`<< /Length ${bodyBytes.length} >>`, bodyBytes),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ...(logo ? [logo.object] : []),
  ];
  return buildPdf(objects);
}

function pdfCenteredMultiline(value, centerX, y, options = {}) {
  const { size = 8, font = 'F1', colour = '0.34 0.45 0.57', leading = 12, lineLength = 68, maxLines = 3 } = options;
  const lines = receiptWrap(value, lineLength).slice(0, maxLines);
  return lines.map((line, index) => pdfCenteredText(line, centerX, y - index * leading, size, font, colour)).join('\n');
}

function pdfCenteredTextBlock(value, centerX, y, options = {}) {
  return pdfCenteredMultiline(value, centerX, y, options);
}

function pdfCertificateLogoCenter(logo, centerX, bottomY, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  const width = logo.width * scale;
  const height = logo.height * scale;
  const x = centerX - width / 2;
  return `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${bottomY.toFixed(2)} cm\n/Logo Do\nQ`;
}

function pdfCertificateQrCenter(qr, centerX, bottomY, size) {
  if (!qr) return '';
  return pdfQr(qr, centerX - size / 2, bottomY, size);
}

function pdfCertificateProgramHighlight(centerX, y, text) {
  const label = receiptText(text, 120);
  const textWidth = pdfHelveticaTextWidth(label, 9.5, 'F2');
  const padX = 16;
  const width = textWidth + padX * 2;
  const left = centerX - width / 2;
  return [
    'q', '0.92 0.96 1 rg', '0.78 0.84 0.92 RG', '0.5 w',
    `${left.toFixed(1)} ${(y - 5).toFixed(1)} ${width.toFixed(1)} 18 re B`, 'Q',
    pdfCenteredText(label, centerX, y, 9.5, 'F2'),
  ].join('\n');
}

function trainingCertificateDateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function trainingCertificatePdf(application, certificate) {
  const profile = companyProfile(database.company_profile);
  const companyName = receiptText(profile.company_name, 120);
  const centerX = 297.5;
  const verificationUrl = rewritePublicApiUrl(certificate.verification_url) || `${publicApiBaseUrl()}/training-certificates/verify/${encodeURIComponent(certificate.certificate_number)}`;
  const qr = receiptQrMatrix(verificationUrl);
  const logo = await receiptLogoImage();
  const logoObjectNumber = logo ? 7 : 0;
  const imageResources = logo ? ` /XObject << /Logo ${logoObjectNumber} 0 R >>` : '';
  const applicantName = receiptText(application.full_name, 120);
  const businessName = receiptText(certificate.business_name, 120);
  const franchiseAddress = receiptText(certificate.franchise_address, 500);
  const addressLines = receiptWrap(franchiseAddress, 58).slice(0, 2);
  const completionDate = trainingCertificateDateOnly(certificate.issued_at);
  const certificateNumber = receiptText(certificate.certificate_number, 80);
  const franchiseeId = franchiseeIdForApplication(application);
  const programTitle = 'REMEDIUM LAB FRANCHISEE TRAINING PROGRAM';
  const descriptionText = 'The participant has demonstrated understanding of the operational processes, service standards, and business guidelines of Remedium Lab. We appreciate your dedication and commitment to excellence.';
  const nameTextWidth = pdfHelveticaTextWidth(applicantName, 16, 'F2');
  const nameLineLeft = centerX - nameTextWidth / 2;
  const nameLineRight = centerX + nameTextWidth / 2;
  const qrSize = 70;
  const qrBottom = 318;
  const Y = {
    logoBottom: 726,
    certificate: 700,
    subtitle: 678,
    titleRule: 662,
    certify: 638,
    name: 614,
    nameRule: 600,
    ofText: 586,
    business: 568,
    programIntro: 548,
    programHighlight: 526,
    descStart: 504,
    footerRule: 286,
    footerBusiness: 266,
    footerAddress1: 248,
    footerCertificate: 214,
    footerFranchiseeId: franchiseeId ? 198 : 214,
    footerDate: franchiseeId ? 180 : 196,
  };
  const headerBlock = logo
    ? pdfCertificateLogoCenter(logo, centerX, Y.logoBottom, 280, 60)
    : pdfCenteredText(companyName, centerX, Y.logoBottom + 42, 18, 'F2');
  const body = [
    '0.82 0.86 0.90 RG', '0.8 w', '48 48 499 746 re S',
    headerBlock,
    pdfCenteredText('CERTIFICATE', centerX, Y.certificate, 26, 'F2'),
    pdfCenteredText('OF TRAINING COMPLETION', centerX, Y.subtitle, 10, 'F2', '0.18 0.24 0.32'),
    pdfCenteredHorizontalRule(centerX, Y.titleRule, 403),
    pdfCenteredText('This is to certify that', centerX, Y.certify, 10, 'F1', '0.18 0.24 0.32'),
    pdfCenteredText(applicantName, centerX, Y.name, 16, 'F2'),
    '0.07 0.18 0.37 RG', '0.55 w', `${nameLineLeft.toFixed(1)} ${Y.nameRule} m ${nameLineRight.toFixed(1)} ${Y.nameRule} l S`,
    pdfCenteredText('of', centerX, Y.ofText, 10, 'F1', '0.34 0.45 0.57'),
    pdfCenteredText(businessName, centerX, Y.business, 12, 'F2', '0.04 0.63 0.64'),
    pdfCenteredText('has successfully completed the training program on', centerX, Y.programIntro, 9, 'F1', '0.34 0.45 0.57'),
    pdfCertificateProgramHighlight(centerX, Y.programHighlight, programTitle),
    pdfCenteredMultiline(descriptionText, centerX, Y.descStart, { size: 7.8, font: 'F1', colour: '0.34 0.45 0.57', leading: 12, lineLength: 68, maxLines: 3 }),
    pdfCertificateQrCenter(qr, centerX, qrBottom, qrSize),
    pdfCenteredFillRule(centerX, Y.footerRule, 399),
    pdfCenteredText(businessName, centerX, Y.footerBusiness, 10, 'F2'),
    ...addressLines.map((line, index) => pdfCenteredText(line, centerX, Y.footerAddress1 - index * 14, 8.8, 'F1', '0.18 0.24 0.32')),
    pdfCenteredText(certificateNumber, centerX, Y.footerCertificate, 9, 'F2'),
    franchiseeId ? pdfCenteredText(`Franchisee ID ${franchiseeId}`, centerX, Y.footerFranchiseeId, 8.5, 'F1', '0.34 0.45 0.57') : '',
    pdfCenteredText(completionDate, centerX, Y.footerDate, 9, 'F2'),
  ].join('\n');
  const bodyBytes = Buffer.from(body, 'ascii');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${imageResources} >> /Contents 4 0 R >>`,
    pdfStream(`<< /Length ${bodyBytes.length} >>`, bodyBytes),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ...(logo ? [logo.object] : []),
  ];
  return buildPdf(objects);
}

async function refreshTrainingCertificatePdfFile(application) {
  const training = ensureTrainingState(application);
  const certificate = training.certificate;
  if (!certificate?.certificate_number) return null;
  const pdfBytes = await trainingCertificatePdf(application, certificate);
  await mkdir(uploadsDirectory, { recursive: true });
  const filename = `training-certificate-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}-${Date.now()}.pdf`;
  await writeFile(path.join(uploadsDirectory, filename), pdfBytes);
  certificate.pdf = {
    id: randomUUID(),
    name: `Training-Certificate-${application.application_number}.pdf`,
    url: `/uploads/${filename}`,
    mime: 'application/pdf',
    uploaded_at: new Date().toISOString(),
  };
  return certificate;
}

async function regenerateTrainingCertificatePdf(application, actor, request) {
  const training = ensureTrainingState(application);
  const certificate = training.certificate;
  if (!certificate?.certificate_number) return null;
  certificate.business_name = receiptText(certificate.business_name || training.business_name, 120);
  certificate.franchise_address = receiptText(certificate.franchise_address || training.franchise_address || franchiseAddressForApplication(application), 500);
  const refreshed = await refreshTrainingCertificatePdfFile(application);
  if (!refreshed?.pdf?.url) return null;
  const now = new Date().toISOString();
  training.history.push({
    id: randomUUID(),
    type: 'training_certificate_regenerated',
    message: `Training completion certificate ${certificate.certificate_number} PDF regenerated.`,
    actor,
    created_at: now,
  });
  applicationReviewHistory(application, 'training_certificate_regenerated', `Training completion certificate ${certificate.certificate_number} PDF regenerated.`, request);
  return refreshed;
}

async function issueTrainingCertificate(application, actor, businessName, request) {
  const training = ensureTrainingState(application);
  const assigned = publishedTrainingVideosForModel(database.training_videos, application.franchise_model);
  const orderedIds = assigned.map((video) => video.id);
  if (!allTrainingVideosComplete(training, orderedIds)) return null;
  const resolvedBusinessName = String(businessName ?? training.business_name ?? '').trim();
  if (!resolvedBusinessName) return null;
  const franchiseAddress = String(training.franchise_address ?? franchiseAddressForApplication(application)).trim();
  training.business_name = resolvedBusinessName;
  training.franchise_address = franchiseAddress;
  const certificateNumber = training.certificate?.certificate_number || trainingCertificateNumber(application);
  const now = new Date().toISOString();
  const verificationUrl = `${publicApiBaseUrl()}/training-certificates/verify/${encodeURIComponent(certificateNumber)}`;
  const certificate = {
    certificate_number: certificateNumber,
    business_name: resolvedBusinessName,
    franchise_address: franchiseAddress,
    issued_at: now,
    issued_by: actor,
    verification_url: verificationUrl,
    qr_reference: certificateNumber,
    pdf: null,
  };
  const pdfBytes = await trainingCertificatePdf(application, certificate);
  await mkdir(uploadsDirectory, { recursive: true });
  const filename = `training-certificate-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}-${Date.now()}.pdf`;
  await writeFile(path.join(uploadsDirectory, filename), pdfBytes);
  certificate.pdf = {
    id: randomUUID(),
    name: `Training-Certificate-${application.application_number}.pdf`,
    url: `/uploads/${filename}`,
    mime: 'application/pdf',
    uploaded_at: now,
  };
  training.completed_at = now;
  training.certificate = certificate;
  training.history.push({
    id: randomUUID(),
    type: 'training_certificate_issued',
    message: `Training completion certificate ${certificateNumber} issued.`,
    actor,
    created_at: now,
  });
  applicationReviewHistory(application, 'training_certificate_issued', `Training completion certificate ${certificateNumber} issued for ${resolvedBusinessName}.`, request);
  return certificate;
}

function trainingCertificateVerifyHtml(entry) {
  const { application, certificate } = entry;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Training Certificate Verification</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#f4f8fc;color:#13365f;margin:0;padding:32px}.card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d6e5ee;border-radius:16px;padding:24px}h1{margin:0 0 8px;font-size:24px}.valid{display:inline-block;background:#ddf8ee;color:#08785e;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700}dl{display:grid;grid-template-columns:180px 1fr;gap:10px 16px;margin-top:20px}dt{color:#66809b;font-size:12px;text-transform:uppercase}dd{margin:0;font-weight:600}</style></head><body><main class="card"><span class="valid">Authentic certificate</span><h1>Remedium Lab training certificate</h1><p>This certificate was issued through the Remedium Franchise Management System.</p><dl><dt>Certificate number</dt><dd>${escape(certificate.certificate_number)}</dd><dt>Applicant name</dt><dd>${escape(application.full_name)}</dd><dt>Business name</dt><dd>${escape(certificate.business_name)}</dd><dt>Franchise address</dt><dd>${escape(certificate.franchise_address)}</dd><dt>Application number</dt><dd>${escape(application.application_number)}</dd>${franchiseeIdForApplication(application) ? `<dt>Franchisee ID</dt><dd>${escape(franchiseeIdForApplication(application))}</dd>` : ''}<dt>Training completed</dt><dd>${escape(receiptDate(certificate.issued_at))}</dd></dl></main></body></html>`;
}

function paymentReceiptVerifyHtml(entry) {
  const { application, payment } = entry;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const amount = Number(payment.amount || 0);
  const amountLabel = Number.isFinite(amount)
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
    : String(payment.amount ?? '');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Receipt Verification</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#f4f8fc;color:#13365f;margin:0;padding:32px}.card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d6e5ee;border-radius:16px;padding:24px}h1{margin:0 0 8px;font-size:24px}.valid{display:inline-block;background:#ddf8ee;color:#08785e;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700}dl{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:10px 16px;margin-top:20px}dt{color:#66809b;font-size:12px;text-transform:uppercase}dd{margin:0;font-weight:600}@media(max-width:560px){body{padding:16px}dl{grid-template-columns:1fr}}</style></head><body><main class="card"><span class="valid">Authentic payment receipt</span><h1>Remedium Lab payment receipt</h1><p>This receipt was issued through the Remedium Franchise Management System.</p><dl><dt>Receipt number</dt><dd>${escape(payment.receipt_number)}</dd><dt>Transaction number</dt><dd>${escape(receiptTransactionNumber(payment))}</dd><dt>Applicant name</dt><dd>${escape(application.full_name)}</dd><dt>Application number</dt><dd>${escape(application.application_number)}</dd><dt>Franchise model</dt><dd>${escape(application.franchise_model)}</dd><dt>Payment purpose</dt><dd>${escape(payment.purpose || payment.label || payment.key)}</dd><dt>Amount paid</dt><dd>${escape(amountLabel)}</dd><dt>Proposed location</dt><dd>${escape(application.preferred_location)}</dd><dt>Paid on</dt><dd>${escape(receiptDate(payment.paid_at))}</dd><dt>Status</dt><dd>PAID</dd></dl></main></body></html>`;
}

function pdfGoldenDoubleBorder() {
  return [
    '0.72 0.53 0.08 RG', '2.2 w', '34 34 527 774 re S',
    '0.83 0.69 0.22 RG', '0.9 w', '42 42 511 758 re S',
  ].join('\n');
}

function pdfCertificateGoldenTitle(centerX, y, ruleY, text, fontSize = 26) {
  const label = receiptText(text, 120);
  const ruleWidth = Math.min(420, Math.max(260, pdfHelveticaTextWidth(label, fontSize, 'F2') + 40));
  return [
    pdfCenteredText(label, centerX, y, fontSize, 'F2', '0.45 0.32 0.04'),
    pdfCenteredHorizontalRule(centerX, ruleY, ruleWidth, '0.72 0.53 0.08', 0.8),
  ].join('\n');
}

function onboardingCertificateDateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function onboardingCertificatePdf(application, certificate) {
  const profile = companyProfile(database.company_profile);
  const companyName = receiptText(profile.company_name, 120);
  const centerX = 297.5;
  const verificationUrl = rewritePublicApiUrl(certificate.verification_url) || `${publicApiBaseUrl()}/onboarding-certificates/verify/${encodeURIComponent(certificate.certificate_number)}`;
  const qr = receiptQrMatrix(verificationUrl);
  const logo = await receiptLogoImage();
  const logoObjectNumber = logo ? 7 : 0;
  const imageResources = logo ? ` /XObject << /Logo ${logoObjectNumber} 0 R >>` : '';
  const businessName = receiptText(certificate.business_name, 120);
  const franchiseModelLabel = franchiseModelCertificateLabel(certificate.franchise_model || application.franchise_model);
  const partnerLine = `for joining as our valued ${franchiseModelLabel} Partner.`;
  const paragraphOne = 'We appreciate your trust and association with Remedium Lab. This partnership marks the beginning of a successful journey towards providing quality, affordable, and reliable diagnostic services to the community.';
  const paragraphTwo = 'We look forward to achieving great milestones together.';
  const certificateNumber = receiptText(certificate.certificate_number, 80);
  const issueDate = onboardingCertificateDateOnly(certificate.issued_at);
  const franchiseeId = franchiseeIdForApplication(application);
  const businessNameWidth = pdfHelveticaTextWidth(businessName, 20, 'F2');
  const businessLineLeft = centerX - businessNameWidth / 2;
  const businessLineRight = centerX + businessNameWidth / 2;
  const qrSize = 68;
  const qrBottom = 168;
  const Y = {
    logoBottom: 718,
    welcome: 668,
    welcomeRule: 646,
    companyLine1: 622,
    companyLine2: 602,
    presented: 574,
    business: 546,
    businessRule: 530,
    partner: 508,
    paragraphOne: 484,
    paragraphTwo: 442,
    warmRegards: 410,
    signCompany: 390,
    signUnit: 370,
    certNumber: qrBottom - 18,
    franchiseeId: franchiseeId ? qrBottom - 34 : qrBottom - 18,
    issueDate: franchiseeId ? qrBottom - 50 : qrBottom - 34,
  };
  const headerBlock = logo
    ? pdfCertificateLogoCenter(logo, centerX, Y.logoBottom, 260, 56)
    : pdfCenteredText(companyName, centerX, Y.logoBottom + 38, 18, 'F2');
  const body = [
    pdfGoldenDoubleBorder(),
    headerBlock,
    pdfCertificateGoldenTitle(centerX, Y.welcome, Y.welcomeRule, 'WELCOME CERTIFICATE', 26),
    pdfCenteredText('Remedium Lab', centerX, Y.companyLine1, 14, 'F2', '0.18 0.24 0.32'),
    pdfCenteredText('A Unit of Smilecure Lifestyle Private Limited', centerX, Y.companyLine2, 12, 'F1', '0.18 0.24 0.32'),
    pdfCenteredText('This certificate is proudly presented to', centerX, Y.presented, 11.5, 'F1', '0.34 0.45 0.57'),
    pdfCenteredText(businessName, centerX, Y.business, 20, 'F2', '0.04 0.63 0.64'),
    '0.72 0.53 0.08 RG', '0.55 w', `${businessLineLeft.toFixed(1)} ${Y.businessRule} m ${businessLineRight.toFixed(1)} ${Y.businessRule} l S`,
    pdfCenteredText(partnerLine, centerX, Y.partner, 11.5, 'F1', '0.18 0.24 0.32'),
    pdfCenteredMultiline(paragraphOne, centerX, Y.paragraphOne, { size: 10.5, font: 'F1', colour: '0.34 0.45 0.57', leading: 14, lineLength: 68, maxLines: 3 }),
    pdfCenteredMultiline(paragraphTwo, centerX, Y.paragraphTwo, { size: 10.5, font: 'F1', colour: '0.34 0.45 0.57', leading: 14, lineLength: 68, maxLines: 2 }),
    pdfCenteredText('Warm Regards,', centerX, Y.warmRegards, 11.5, 'F2', '0.18 0.24 0.32'),
    pdfCenteredText('Remedium Lab', centerX, Y.signCompany, 12.5, 'F2'),
    pdfCenteredText('A Unit of Smilecure Lifestyle Private Limited', centerX, Y.signUnit, 10.5, 'F1', '0.34 0.45 0.57'),
    pdfCertificateQrCenter(qr, centerX, qrBottom, qrSize),
    pdfCenteredText(certificateNumber, centerX, Y.certNumber, 9, 'F2'),
    franchiseeId ? pdfCenteredText(`Franchisee ID ${franchiseeId}`, centerX, Y.franchiseeId, 8.5, 'F1', '0.34 0.45 0.57') : '',
    pdfCenteredText(issueDate, centerX, Y.issueDate, 9, 'F2'),
  ].join('\n');
  const bodyBytes = Buffer.from(body, 'ascii');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${imageResources} >> /Contents 4 0 R >>`,
    pdfStream(`<< /Length ${bodyBytes.length} >>`, bodyBytes),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ...(logo ? [logo.object] : []),
  ];
  return buildPdf(objects);
}

async function refreshOnboardingCertificatePdfFile(application) {
  const certificate = ensureOnboardingCertificateState(application);
  if (!certificate?.certificate_number) return null;
  const pdfBytes = await onboardingCertificatePdf(application, certificate);
  await mkdir(uploadsDirectory, { recursive: true });
  const filename = `onboarding-certificate-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}-${Date.now()}.pdf`;
  await writeFile(path.join(uploadsDirectory, filename), pdfBytes);
  certificate.pdf = {
    id: randomUUID(),
    name: `Onboarding-Certificate-${application.application_number}.pdf`,
    url: `/uploads/${filename}`,
    mime: 'application/pdf',
    uploaded_at: new Date().toISOString(),
  };
  return certificate;
}

async function issueOnboardingCertificate(application, actor, businessName, request) {
  if (!trainingCertificateIssued(application)) return null;
  const resolvedBusinessName = String(businessName ?? '').trim();
  if (!resolvedBusinessName) return null;
  const certificateNumber = application.onboarding_certificate?.certificate_number || onboardingCertificateNumber(application);
  const now = new Date().toISOString();
  const verificationUrl = `${publicApiBaseUrl()}/onboarding-certificates/verify/${encodeURIComponent(certificateNumber)}`;
  const certificate = {
    certificate_number: certificateNumber,
    business_name: resolvedBusinessName,
    franchise_model: application.franchise_model,
    issued_at: now,
    issued_by: actor,
    verification_url: verificationUrl,
    qr_reference: certificateNumber,
    pdf: null,
  };
  const pdfBytes = await onboardingCertificatePdf(application, certificate);
  await mkdir(uploadsDirectory, { recursive: true });
  const filename = `onboarding-certificate-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}-${Date.now()}.pdf`;
  await writeFile(path.join(uploadsDirectory, filename), pdfBytes);
  certificate.pdf = {
    id: randomUUID(),
    name: `Onboarding-Certificate-${application.application_number}.pdf`,
    url: `/uploads/${filename}`,
    mime: 'application/pdf',
    uploaded_at: now,
  };
  application.onboarding_certificate = certificate;
  ensureTrainingState(application).history.push({
    id: randomUUID(),
    type: 'onboarding_certificate_issued',
    message: `Onboarding welcome certificate ${certificateNumber} issued for ${resolvedBusinessName}.`,
    actor,
    created_at: now,
  });
  applicationReviewHistory(application, 'onboarding_certificate_issued', `Onboarding welcome certificate ${certificateNumber} issued for ${resolvedBusinessName}.`, request);
  return certificate;
}

function onboardingCertificateVerifyHtml(entry) {
  const { application, certificate } = entry;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onboarding Certificate Verification</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#faf6ee;color:#4a3a12;margin:0;padding:32px}.card{max-width:720px;margin:0 auto;background:#fff;border:2px solid #c89b2d;border-radius:16px;padding:24px}h1{margin:0 0 8px;font-size:24px;color:#6b4e0f}.valid{display:inline-block;background:#fff3d6;color:#8a6200;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700}dl{display:grid;grid-template-columns:180px 1fr;gap:10px 16px;margin-top:20px}dt{color:#8a7348;font-size:12px;text-transform:uppercase}dd{margin:0;font-weight:600;color:#3f3120}</style></head><body><main class="card"><span class="valid">Authentic certificate</span><h1>Remedium Lab onboarding certificate</h1><p>This welcome certificate was issued through the Remedium Franchise Management System.</p><dl><dt>Certificate number</dt><dd>${escape(certificate.certificate_number)}</dd><dt>Business name</dt><dd>${escape(certificate.business_name)}</dd><dt>Franchise model</dt><dd>${escape(franchiseModelCertificateLabel(certificate.franchise_model || application.franchise_model))}</dd><dt>Application number</dt><dd>${escape(application.application_number)}</dd>${franchiseeIdForApplication(application) ? `<dt>Franchisee ID</dt><dd>${escape(franchiseeIdForApplication(application))}</dd>` : ''}<dt>Issue date</dt><dd>${escape(receiptDate(certificate.issued_at))}</dd></dl></main></body></html>`;
}

function ensureFranchiseWebpagesArray() {
  if (!Array.isArray(database.franchise_webpages)) database.franchise_webpages = [];
  return database.franchise_webpages;
}

function franchiseWebpageById(id) {
  return ensureFranchiseWebpagesArray().find((item) => item.id === id) ?? null;
}

function franchiseWebpageBySlug(slug) {
  return ensureFranchiseWebpagesArray().find((item) => item.slug === slug) ?? null;
}

function franchiseWebpageByApplicationId(applicationId) {
  return ensureFranchiseWebpagesArray().find((item) => item.application_id === applicationId) ?? null;
}

function franchiseeDirectoryHelpers() {
  return {
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
    trainingVideos: database.training_videos,
  };
}

function onboardedFranchiseeApplications() {
  return database.applications
    .filter((application) => isOnboardedFranchisee(application))
    .sort((first, second) => String(onboardingCompletedAt(second)).localeCompare(String(onboardingCompletedAt(first))));
}

function coordinatesFromGoogleMapsUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  const patterns = [
    /[?&](?:q|query)=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/i,
    /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const latitude = optionalGeoCoordinate(match[1], -90, 90).value;
    const longitude = optionalGeoCoordinate(match[2], -180, 180).value;
    if (latitude !== null && longitude !== null) return { latitude, longitude };
  }
  return null;
}

function directionsUrlForCentre({ googleMapsUrl, latitude, longitude }) {
  const maps = googleMapsLocationUrl(googleMapsUrl);
  if (maps) return maps;
  if (latitude !== null && longitude !== null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }
  return '';
}

function publicOnboardedCentreRecord(application) {
  const helpers = franchiseeDirectoryHelpers();
  const listItem = franchiseeDirectoryListItem(application, helpers);
  const allotment = territoryAllotmentSummary(application.territory_allotment);
  let latitude = optionalGeoCoordinate(allotment?.latitude, -90, 90).value;
  let longitude = optionalGeoCoordinate(allotment?.longitude, -180, 180).value;
  const googleMapsUrl = listItem.google_map_location_url || '';
  if ((latitude === null || longitude === null) && googleMapsUrl) {
    const parsed = coordinatesFromGoogleMapsUrl(googleMapsUrl);
    if (parsed) {
      latitude = parsed.latitude;
      longitude = parsed.longitude;
    }
  }
  const address = allotment?.franchise_address
    || application.address
    || [listItem.district, listItem.pincode].filter(Boolean).join(' · ');
  const directionsUrl = directionsUrlForCentre({ googleMapsUrl, latitude, longitude });
  return {
    franchisee_id: listItem.franchisee_id || application.id,
    application_id: listItem.application_id,
    application_number: listItem.application_number,
    franchise_name: listItem.business_name || listItem.franchisee_name || application.full_name || 'Remedium centre',
    franchise_model: listItem.franchise_model || application.franchise_model || '',
    address,
    contact_phone: application.mobile || '',
    territory_region: listItem.territory || [listItem.district, listItem.pincode].filter(Boolean).join(' · '),
    district: listItem.district || '',
    pincode: listItem.pincode || '',
    latitude,
    longitude,
    google_map_location_url: googleMapsUrl,
    directions_url: directionsUrl,
    webpage_url: listItem.webpage_url || '',
    onboarding_completed_at: listItem.onboarding_date || '',
    book_lab_path: `/diagnostics?hub=${encodeURIComponent(listItem.franchisee_id || application.id)}`,
    book_doctor_path: '/appointments/book',
  };
}

function listPublicOnboardedCentres({ latitude = null, longitude = null, radiusKm = null } = {}) {
  const centres = onboardedFranchiseeApplications()
    .filter((application) => !application.deboarded && application.stage !== 'deboarded')
    .map((application) => publicOnboardedCentreRecord(application));
  const hasOrigin = latitude !== null && longitude !== null
    && Number.isFinite(latitude) && Number.isFinite(longitude);
  const radius = radiusKm === null || radiusKm === undefined || radiusKm === '' ? null : Number(radiusKm);
  const withDistance = centres.map((centre) => {
    if (!hasOrigin || centre.latitude === null || centre.longitude === null) {
      return { ...centre, distance_km: null };
    }
    return {
      ...centre,
      distance_km: Math.round(geoDistanceKm(latitude, longitude, centre.latitude, centre.longitude) * 100) / 100,
    };
  });
  const filtered = withDistance.filter((centre) => {
    if (!hasOrigin || radius === null || !Number.isFinite(radius) || radius <= 0) return true;
    if (centre.distance_km === null) return true;
    return centre.distance_km <= radius;
  });
  filtered.sort((first, second) => {
    if (first.distance_km !== null && second.distance_km !== null) return first.distance_km - second.distance_km;
    if (first.distance_km !== null) return -1;
    if (second.distance_km !== null) return 1;
    return String(first.franchise_name).localeCompare(String(second.franchise_name));
  });
  return filtered;
}

function partnerApiToken(request) {
  const header = String(request.headers['x-rfms-api-token'] ?? request.headers.authorization ?? '').trim();
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return header;
}

function requirePartnerApiAccess(request, response) {
  const settings = ensureFranchiseeDirectoryApiSettings(database);
  if (!settings.enabled) {
    failure(request, response, 'API_DISABLED', 'Franchisee directory partner API access is disabled.', 403);
    return null;
  }
  const token = partnerApiToken(request);
  if (!token || !partnerApiTokenMatches(settings, token)) {
    failure(request, response, 'UNAUTHORIZED', 'Provide a valid partner API token.', 401);
    return null;
  }
  if (!checkPartnerRateLimit(token, settings)) {
    failure(request, response, 'RATE_LIMITED', 'Partner API rate limit exceeded. Try again in one minute.', 429);
    return null;
  }
  return { settings, token };
}

async function servePartnerFile(request, response, fileUrl) {
  const normalized = String(fileUrl ?? '').replace(new RegExp(`^https?://localhost:${port}`), '');
  const match = normalized.match(/^\/uploads\/([A-Za-z0-9._-]+)$/);
  if (!match) return failure(request, response, 'FILE_NOT_FOUND', 'Requested file is unavailable.', 404);
  try {
    const bytes = await readFile(path.join(uploadsDirectory, match[1]));
    const mime = match[1].endsWith('.pdf') ? 'application/pdf'
      : match[1].endsWith('.png') ? 'image/png'
        : match[1].endsWith('.webp') ? 'image/webp'
          : match[1].endsWith('.html') ? 'text/html; charset=utf-8'
            : 'image/jpeg';
    cors(request, response);
    response.writeHead(200, {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${match[1]}"`,
      'Content-Length': bytes.length,
      'Cache-Control': 'private, no-store',
    });
    response.end(bytes);
    return true;
  } catch {
    return failure(request, response, 'FILE_NOT_FOUND', 'Requested file is unavailable.', 404);
  }
}

function uniqueFranchiseWebpageSlug(baseValue, excludeId = '') {
  const base = franchiseWebpageSlug(baseValue);
  let slug = base;
  let suffix = 2;
  while (ensureFranchiseWebpagesArray().some((item) => item.slug === slug && item.id !== excludeId)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function franchiseWebpagePublicUrl(slug) {
  return `${receiptValidationBaseUrl}/franchise-sites/${encodeURIComponent(slug)}`;
}

function franchiseWebpageSettingsFromBody(body, current = {}) {
  const branchImages = Array.isArray(body.branch_images)
    ? body.branch_images.map((item) => ({
      url: text(item?.url, 500),
      caption: text(item?.caption, 180),
    })).filter((item) => item.url)
    : current.branch_images ?? [];
  return {
    business_name: text(body.business_name, 180) || current.business_name || '',
    branch_address: text(body.branch_address, 500) || current.branch_address || '',
    contact_number: text(body.contact_number, 40) || current.contact_number || '',
    whatsapp_number: text(body.whatsapp_number, 40) || current.whatsapp_number || '',
    google_map_link: text(body.google_map_link, 500) || current.google_map_link || '',
    google_map_embed_url: text(body.google_map_embed_url, 500) || current.google_map_embed_url || '',
    branch_images: branchImages.slice(0, MAX_FRANCHISE_WEBPAGE_BRANCH_IMAGES),
    business_hours: text(body.business_hours, 500) || current.business_hours || '',
    hero_subtitle: text(body.hero_subtitle, 240) || current.hero_subtitle || '',
    hero_background_url: text(body.hero_background_url, 500) || current.hero_background_url || '',
    branch_intro: text(body.branch_intro, 1200) || current.branch_intro || '',
    seo_title: text(body.seo_title, 180) || current.seo_title || '',
    seo_description: text(body.seo_description, 320) || current.seo_description || '',
    seo_keywords: text(body.seo_keywords, 320) || current.seo_keywords || '',
    app_download_url: text(body.app_download_url, 500) || current.app_download_url || '',
  };
}

async function writeFranchiseWebpageHtmlFile(webpage) {
  const html = renderFranchiseWebpageHtml(webpage.settings, { publicBaseUrl: receiptValidationBaseUrl, franchisee_id: webpage.franchisee_id ?? '' });
  await mkdir(uploadsDirectory, { recursive: true });
  const filename = `franchise-webpage-${webpage.slug.replace(/[^a-z0-9-]/gi, '')}-${Date.now()}.html`;
  await writeFile(path.join(uploadsDirectory, filename), html, 'utf8');
  webpage.html_url = `/uploads/${filename}`;
  webpage.public_url = franchiseWebpagePublicUrl(webpage.slug);
  webpage.updated_at = new Date().toISOString();
  return webpage;
}

async function createFranchiseWebpageForApplication(application, actor) {
  if (application.franchise_model !== 'FOCO') return null;
  const existing = franchiseWebpageByApplicationId(application.id);
  if (existing) return existing;
  const profile = companyProfile(database.company_profile);
  const settings = defaultFranchiseWebpageSettings(application, profile);
  const now = new Date().toISOString();
  const webpage = {
    id: randomUUID(),
    application_id: application.id,
    application_number: application.application_number,
    franchisee_id: franchiseeIdForApplication(application),
    applicant_name: application.full_name,
    franchise_model: application.franchise_model,
    slug: uniqueFranchiseWebpageSlug(settings.business_name || application.application_number),
    enabled: true,
    settings,
    public_url: '',
    html_url: '',
    created_at: now,
    updated_at: now,
    onboarded_at: now,
    onboarded_by: actor,
  };
  await writeFranchiseWebpageHtmlFile(webpage);
  ensureFranchiseWebpagesArray().push(webpage);
  application.franchise_webpage_id = webpage.id;
  return webpage;
}

async function regenerateFranchiseWebpage(webpage) {
  if (!webpage) return null;
  await writeFranchiseWebpageHtmlFile(webpage);
  return webpage;
}

const PARTNER_PORTAL_ONBOARDED_MESSAGE = 'Your franchise is now onboarded. Please use the Partner Portal to manage your business and save these login credentials for future use.';

function generatePartnerPortalPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let password = 'Rp';
  for (let index = 0; index < bytes.length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }
  return password;
}

function partnerPortalLoginUrl() {
  return String(process.env.PARTNER_PORTAL_URL || 'https://partners.e-remedium.in').trim().replace(/\/+$/, '') || 'https://partners.e-remedium.in';
}

/** Franchise Directory fields pushed to Partner Portal / ERP Franchisee Profile. */
function hubDirectoryFieldsFromApplication(application) {
  const allotment = territoryAllotmentSummary(application?.territory_allotment);
  const registeredAddress = String(
    allotment?.franchise_address
    || application?.onboarding_certificate?.franchise_address
    || application?.training?.franchise_address
    || application?.address
    || '',
  ).trim();
  const territoryRegion = String(
    allotment?.final_territory
    || allotment?.registered_territory_label
    || application?.district
    || '',
  ).trim();
  return {
    businessName: franchiseeBusinessName(application),
    district: String(allotment?.district || application?.district || '').trim(),
    pincode: String(allotment?.pincode || application?.pincode || '').trim(),
    preferredLocation: String(application?.preferred_location || '').trim(),
    registeredAddress,
    territoryRegion,
    email: String(application?.email || '').trim(),
    mobile: String(application?.mobile || '').trim(),
    fullName: String(application?.full_name || '').trim(),
    franchiseModel: String(application?.franchise_model || '').trim(),
    franchiseeProfile: String(application?.hec_franchisee_profile || '').trim(),
    applicationId: application?.id || '',
    applicationNumber: application?.application_number || '',
  };
}

async function syncHubDirectoryDetailsToErp(application, request, { actor = '' } = {}) {
  if (!application) return null;
  const fields = hubDirectoryFieldsFromApplication(application);
  if (!fields.businessName && !fields.fullName) return null;
  try {
    const result = await syncRfmsHubFromDirectoryViaErp({
      applicationId: fields.applicationId,
      applicationNumber: fields.applicationNumber,
      businessName: fields.businessName,
      district: fields.district,
      email: fields.email,
      franchiseModel: fields.franchiseModel,
      franchiseeProfile: fields.franchiseeProfile,
      fullName: fields.fullName,
      mobile: fields.mobile,
      pincode: fields.pincode,
      preferredLocation: fields.preferredLocation,
      registeredAddress: fields.registeredAddress,
      territoryRegion: fields.territoryRegion,
    });
    const franchiseeId = String(result?.franchisee_id || '').trim();
    if (franchiseeId) application.hec_franchisee_profile = franchiseeId;
    application.hec_hub_directory_synced_at = new Date().toISOString();
    application.hec_hub_directory_sync_error = '';
    applicationReviewHistory(
      application,
      'franchise_hub_directory_synced',
      `Partner Portal hub synced from Franchise Directory as ${result?.franchise_name || fields.businessName}${franchiseeId ? ` (${franchiseeId})` : ''}.`,
      request,
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Franchise hub directory sync failed.';
    application.hec_hub_directory_sync_error = message.slice(0, 500);
    console.error('[hub-directory] sync failed', application.application_number, message);
    applicationReviewHistory(application, 'franchise_hub_directory_sync_failed', message, request);
    return null;
  }
}

async function provisionPartnerPortalForOnboardedApplication(application, request) {
  const password = generatePartnerPortalPassword();
  const loginUrl = partnerPortalLoginUrl();
  const fields = hubDirectoryFieldsFromApplication(application);
  try {
    const result = await provisionPartnerPortalCredentialsViaErp({
      applicationId: fields.applicationId,
      applicationNumber: fields.applicationNumber,
      businessName: fields.businessName,
      district: fields.district,
      email: fields.email,
      franchiseModel: fields.franchiseModel,
      franchiseeProfile: fields.franchiseeProfile,
      fullName: fields.fullName,
      loginUrl,
      mobile: fields.mobile,
      password,
      pincode: fields.pincode,
      preferredLocation: fields.preferredLocation,
      registeredAddress: fields.registeredAddress,
      territoryRegion: fields.territoryRegion,
    });
    const userId = String(result?.user_id || '').trim();
    const franchiseeId = String(result?.franchisee_id || '').trim();
    if (franchiseeId) application.hec_franchisee_profile = franchiseeId;
    if (!application.hec_hub_activated_at) application.hec_hub_activated_at = new Date().toISOString();
    application.partner_portal = {
      login_url: String(result?.login_url || loginUrl).trim() || loginUrl,
      user_id: userId,
      password: String(result?.password || password).trim() || password,
      provisioned_at: new Date().toISOString(),
      message: PARTNER_PORTAL_ONBOARDED_MESSAGE,
      hub_name: String(result?.franchise_name || fields.businessName || '').trim(),
      branch_code: String(result?.branch_code || '').trim(),
      territory_region: String(result?.territory_region || fields.territoryRegion || '').trim(),
    };
    application.partner_portal_error = '';
    applicationReviewHistory(
      application,
      'partner_portal_provisioned',
      `Partner Portal account created for ${userId || application.email}. Hub: ${application.partner_portal.hub_name || fields.businessName}. Login: ${application.partner_portal.login_url}`,
      request,
    );
    return application.partner_portal;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Partner Portal account creation failed.';
    application.partner_portal_error = message.slice(0, 500);
    console.error('[partner-portal] provision failed', application.application_number, message);
    applicationReviewHistory(application, 'partner_portal_provision_failed', message, request);
    return null;
  }
}

function hasPartnerPortalCredentials(application) {
  return Boolean(application?.partner_portal?.user_id && application?.partner_portal?.password);
}

/** Create Partner Portal credentials when missing (onboarded apps, including backfill). */
async function ensurePartnerPortalCredentials(application, request, { force = false, actor = '' } = {}) {
  if (!application || application.stage !== 'onboarding_completed') return null;
  if (!force && hasPartnerPortalCredentials(application)) {
    await syncHubDirectoryDetailsToErp(application, request, { actor });
    return application.partner_portal;
  }
  const provisioned = await provisionPartnerPortalForOnboardedApplication(application, request);
  if (provisioned) {
    application.updated_at = new Date().toISOString();
    appendFranchiseeDirectoryVersion(
      application,
      actor || reviewActor(request) || 'System',
      'Partner Portal credentials stored',
      franchiseeDirectorySnapshot(application, franchiseeDirectoryHelpers()),
    );
  } else {
    await syncHubDirectoryDetailsToErp(application, request, { actor });
  }
  return provisioned;
}

async function markApplicationOnboarded(application, actor, request) {
  if (!canMarkApplicationOnboarded(application)) return null;
  const now = new Date().toISOString();
  assignFranchiseeId(application, database, now);
  application.stage = 'onboarding_completed';
  application.onboarding_completed_at = now;
  application.business_id = businessIdForApplication(application);
  application.updated_at = now;
  syncApplicationTerritoryStatus(application);
  completeLinkedLeadsForApplication(application);
  if (ensureTrainingState(application).certificate?.certificate_number) {
    await refreshTrainingCertificatePdfFile(application);
  }
  if (ensureOnboardingCertificateState(application)?.certificate_number) {
    await refreshOnboardingCertificatePdfFile(application);
  }
  let webpage = null;
  if (application.franchise_model === 'FOCO') {
    webpage = await createFranchiseWebpageForApplication(application, actor);
    if (webpage && application.franchisee_id) {
      webpage.franchisee_id = application.franchisee_id;
      await writeFranchiseWebpageHtmlFile(webpage);
    }
  }
  await ensurePartnerPortalCredentials(application, request, { force: true, actor });
  ensureTrainingState(application).history.push({
    id: randomUUID(),
    type: 'application_onboarded',
    message: application.franchise_model === 'FOCO'
      ? `Application marked onboarded and FOCO franchise webpage generated${webpage?.slug ? ` (${webpage.slug})` : ''}.`
      : 'Application marked onboarded and franchise onboarding completed.',
    actor,
    created_at: now,
  });
  applicationReviewHistory(application, 'application_onboarded', application.franchise_model === 'FOCO'
    ? `Franchise onboarding completed for ${application.full_name}. Franchisee ID ${application.franchisee_id} issued.${webpage?.public_url ? ` FOCO portfolio webpage published at ${webpage.public_url}` : webpage ? ' FOCO portfolio webpage generated.' : ''}`
    : `Franchise onboarding completed for ${application.full_name}. Franchisee ID ${application.franchisee_id} issued.`, request);
  appendFranchiseeDirectoryVersion(application, actor, 'Franchise onboarding completed', franchiseeDirectorySnapshot(application, franchiseeDirectoryHelpers()));
  await pushHecResultToFrappe(application, {
    status: 'Completed',
    aadhaarRef: application.agreement_workflow?.applicant?.esign_reference || '',
    notes: 'FFMS marked application onboarded',
  });
  await maybeScheduleFranchiseOnboardCampaigns(application, webpage, request);
  return { application, webpage };
}

async function maybeScheduleFranchiseOnboardCampaigns(application, webpage, request) {
  if (!application) return null;
  if (application.hec_onboard_campaigns_at && Array.isArray(application.hec_onboard_campaigns) && application.hec_onboard_campaigns.length) {
    return application.hec_onboard_campaigns;
  }
  const fields = hubDirectoryFieldsFromApplication(application);
  const webpageUrl = String(webpage?.public_url || application.franchise_webpage?.public_url || '').trim();
  try {
    const result = await scheduleFranchiseOnboardCampaignsViaErp({
      applicationId: fields.applicationId,
      applicationNumber: fields.applicationNumber,
      businessName: fields.businessName,
      district: fields.district,
      franchiseeId: String(application.franchisee_id || ''),
      franchiseeProfile: fields.franchiseeProfile,
      fullName: fields.fullName,
      landingUrl: webpageUrl || 'https://www.e-remedium.in',
      mobile: fields.mobile,
      pincode: fields.pincode,
      preferredLocation: fields.preferredLocation,
      territoryRegion: fields.territoryRegion,
      webpageUrl,
    });
    application.hec_onboard_campaigns_at = new Date().toISOString();
    application.hec_onboard_campaigns = result?.campaigns || [];
    application.hec_onboard_campaigns_error = '';
    applicationReviewHistory(
      application,
      'onboard_campaigns_scheduled',
      `Scheduled Meta/WhatsApp campaigns for Phlebotomist, Receptionist and local blood-test booking (${(result?.campaigns || []).length} plan(s)).`,
      request,
    );
    workflowNotify({
      module: 'marketing',
      action: 'onboard_campaigns_scheduled',
      title: 'Franchise area campaigns scheduled',
      message: `${fields.businessName || application.full_name} · hiring + blood-test booking campaigns queued for ${fields.territoryRegion || fields.district || 'local area'}.`,
      actor: workflowActor(request),
      href: `admin:Applications:${application.id}`,
      entityType: 'application',
      entityId: application.id,
      applicationId: application.id,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onboard campaign scheduling failed.';
    application.hec_onboard_campaigns_error = message.slice(0, 500);
    console.error('[phase93] onboard campaigns failed', application.application_number, message);
    applicationReviewHistory(application, 'onboard_campaigns_failed', message, request);
    return null;
  }
}

async function maybeCreateReachFocoB2bOnPhase1(application, payment, request) {
  if (!application || (payment?.key !== 'application_fee' && !payment?.foco_full_payment)) return null;
  if (String(application.franchise_model || '').toUpperCase() !== 'FOCO') return null;
  if (application.hec_foco_b2b_code) return { foco_code: application.hec_foco_b2b_code, idempotent: true };
  const fields = hubDirectoryFieldsFromApplication(application);
  const lead = application.hec_lead_id
    ? database.leads.find((item) => item.hec_lead_id === application.hec_lead_id || item.id === application.hec_lead_id)
    : null;
  try {
    const result = await createReachFocoB2bOnPhase1ViaErp({
      applicationFeeAmount: Number(payment.amount) || 10000,
      applicationId: fields.applicationId,
      applicationNumber: fields.applicationNumber,
      businessName: fields.businessName,
      centreName: `FOCO · ${fields.businessName || fields.fullName}`,
      createdByReachUser: String(lead?.sales_rep_id || lead?.assigned_to || ''),
      franchiseModel: 'FOCO',
      fullName: fields.fullName,
      googleMapLocation: '',
      mobile: fields.mobile,
      preferredLocation: fields.preferredLocation,
      reachUser: String(lead?.sales_rep_id || lead?.assigned_to || 'Administrator'),
      registeredAddress: fields.registeredAddress,
      salesRepId: String(lead?.sales_rep_id || ''),
    });
    const code = String(result?.foco_code || result?.centre?.name || '').trim();
    application.hec_foco_b2b_code = code;
    application.hec_foco_b2b_at = new Date().toISOString();
    application.hec_foco_b2b_error = '';
    applicationReviewHistory(
      application,
      'foco_b2b_code_created',
      `Reach B2B FOCO code ${code || '(pending)'} created after Phase-1 payment.`,
      request,
    );
    workflowNotify({
      module: 'payments',
      action: 'foco_b2b_code_created',
      title: 'FOCO B2B code created',
      message: `${fields.businessName || application.full_name} · Reach FOCO code ${code || 'created'} after Phase 1 payment.`,
      actor: workflowActor(request),
      href: `admin:Payments:${application.id}`,
      entityType: 'application',
      entityId: application.id,
      applicationId: application.id,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FOCO B2B code creation failed.';
    application.hec_foco_b2b_error = message.slice(0, 500);
    console.error('[phase93] FOCO B2B create failed', application.application_number, message);
    applicationReviewHistory(application, 'foco_b2b_code_failed', message, request);
    return null;
  }
}

async function videoKycEvidencePdfImage(evidence) {
  const uploadedFile = String(evidence?.url ?? '').match(new RegExp(`^http://localhost:${port}/uploads/([A-Za-z0-9._-]+)$`));
  if (!uploadedFile) return null;
  try {
    const bytes = await readFile(path.join(uploadsDirectory, uploadedFile[1]));
    return pngReceiptImage(bytes) ?? jpegReceiptImage(bytes);
  } catch { return null; }
}

function pdfImageDraw(name, image, x, y, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${(x + (maxWidth - width) / 2).toFixed(2)} ${(y + (maxHeight - height) / 2).toFixed(2)} cm\n/${name} Do\nQ`;
}

async function videoKycReportPdf(application, session) {
  const profile = companyProfile(database.company_profile);
  const companyName = receiptText(profile.company_name, 120);
  const contactPhone = receiptText(profile.company_phone || '03369029634', 40);
  const contactEmail = receiptText(profile.company_email || 'support@remediumcare.in', 160);
  const addressLines = receiptWrap(profile.office_address, 42).slice(0, 2);
  const screenshots = Array.isArray(session.screenshots) ? session.screenshots : [];
  const embeddedEvidence = [];
  for (const evidence of screenshots) {
    const image = await videoKycEvidencePdfImage(evidence);
    if (image) embeddedEvidence.push({ evidence, image });
  }
  const logo = await receiptLogoImage();
  const logoObjectNumber = logo ? 5 : 0;
  const headerLogo = logo
    ? pdfHeaderLogoDraw(logo)
    : ['0.04 0.63 0.64 rg', '52 776 34 34 re f', pdfText('RL', 61, 787, 12, 'F2', '1 1 1'), pdfText(companyName, 98, 790, 18, 'F2', '1 1 1')].join('\n');
  const remarks = session.remarks || 'No manager remarks were recorded.';
  const remarkLines = receiptWrap(remarks, 68).slice(0, 8);
  const detailRows = [
    ['Franchise model', application.franchise_model],
    ['Proposed location', application.preferred_location],
    ['Verification attempt', `Attempt ${Number(session.attempt) || 1}`],
    ['Completed by', session.completed_by || 'RFMS Officer'],
    ['Started', receiptDate(session.started_at)],
    ['Completed', receiptDate(session.completed_at)],
    ['Evidence retained', `${screenshots.length} screenshot${screenshots.length === 1 ? '' : 's'} (${embeddedEvidence.length} embedded in this report)`],
  ];
  const summaryBody = [
    'q', '0.03 0.16 0.35 rg', '0 700 595 142 re f', 'Q',
    'q', '1 1 1 rg', '42 762 204 57 re f', 'Q', headerLogo,
    pdfText('VIDEO KYC VERIFICATION REPORT', 48, 741, 9, 'F2', '0.75 0.91 0.96'),
    pdfText(profile.franchise_hub_name, 302, 808, 15, 'F2', '1 1 1'),
    ...addressLines.map((line, index) => pdfText(line, 302, 789 - index * 12, 8.7, 'F1', '0.80 0.91 0.97')),
    pdfText(`Phone: ${contactPhone}`, 302, 758, 8.7, 'F1', '0.80 0.91 0.97'),
    pdfText(`Email: ${contactEmail}`, 302, 745, 8.7, 'F1', '0.80 0.91 0.97'),
    pdfText('Completed Video KYC', 44, 663, 21, 'F2'),
    pdfText(`Report generated ${receiptDate(new Date().toISOString())}`, 44, 641, 9, 'F1', '0.34 0.45 0.57'),
    'q', '0.90 0.98 0.94 rg', '462 628 89 26 re f', 'Q', pdfText('COMPLETED', 474, 637, 9.4, 'F2', '0.05 0.48 0.29'),
    'q', '0.98 0.99 1 rg', '44 535 507 71 re f', '0.84 0.89 0.94 RG', '44 535 507 71 re S', 'Q',
    pdfText('APPLICANT', 58, 582, 8, 'F2', '0.36 0.48 0.61'), pdfText(application.full_name, 58, 562, 14, 'F2'), pdfText(`Application no. ${application.application_number}`, 58, 546, 9, 'F1', '0.34 0.45 0.57'),
    pdfText('COMPLETED IDENTITY VERIFICATION', 314, 582, 8, 'F2', '0.04 0.50 0.52'), pdfText(`Attempt ${Number(session.attempt) || 1}`, 314, 562, 14, 'F2'), pdfText(`Manager: ${session.completed_by || 'RFMS Officer'}`, 314, 546, 9, 'F1', '0.34 0.45 0.57'),
    'q', '1 1 1 rg', '44 350 507 157 re f', '0.84 0.89 0.94 RG', '44 350 507 157 re S', 'Q', pdfText('VERIFICATION DETAILS', 58, 483, 10, 'F2', '0.05 0.42 0.62'),
    ...detailRows.flatMap(([label, value], index) => [pdfText(label, 58, 457 - index * 17, 8.8, 'F1', '0.36 0.48 0.61'), pdfText(value, 214, 457 - index * 17, 9.2, 'F2')]),
    'q', '0.94 0.99 0.98 rg', '44 177 507 145 re f', '0.70 0.88 0.85 RG', '44 177 507 145 re S', 'Q', pdfText('MANAGER REMARKS', 58, 297, 10, 'F2', '0.05 0.42 0.62'),
    ...remarkLines.map((line, index) => pdfText(line, 58, 275 - index * 14, 9.2, 'F1', '0.16 0.28 0.40')),
    '0.09 0.53 0.55 rg', '44 147 507 1 re f',
    pdfText('This digitally generated report records the completed Video KYC verification and retained evidence.', 44, 126, 8.5, 'F1', '0.34 0.45 0.57'),
    pdfText(`Need help? Call ${contactPhone} or email ${contactEmail}`, 44, 109, 8.5, 'F1', '0.34 0.45 0.57'),
  ].join('\n');

  let nextObjectNumber = logo ? 6 : 5;
  const summaryPageNumber = nextObjectNumber++; const summaryContentNumber = nextObjectNumber++;
  const evidencePages = embeddedEvidence.map((entry, index) => ({ ...entry, index: index + 1, imageObjectNumber: nextObjectNumber++, pageObjectNumber: nextObjectNumber++, contentObjectNumber: nextObjectNumber++ }));
  const pageObjectNumbers = [summaryPageNumber, ...evidencePages.map((entry) => entry.pageObjectNumber)];
  const objects = new Array(nextObjectNumber - 1);
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  if (logo) objects[4] = logo.object;
  const baseResources = `/Font << /F1 3 0 R /F2 4 0 R >>${logo ? ` /XObject << /Logo ${logoObjectNumber} 0 R >>` : ''}`;
  const summaryBytes = Buffer.from(summaryBody, 'ascii');
  objects[summaryPageNumber - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${baseResources} >> /Contents ${summaryContentNumber} 0 R >>`;
  objects[summaryContentNumber - 1] = pdfStream(`<< /Length ${summaryBytes.length} >>`, summaryBytes);
  for (const entry of evidencePages) {
    const evidenceBody = [
      'q', '0.03 0.16 0.35 rg', '0 700 595 142 re f', 'Q',
      'q', '1 1 1 rg', '42 762 204 57 re f', 'Q', headerLogo,
      pdfText('VIDEO KYC EVIDENCE', 48, 741, 9, 'F2', '0.75 0.91 0.96'),
      pdfText(`Evidence ${entry.index} of ${screenshots.length}`, 44, 663, 20, 'F2'),
      pdfText(entry.evidence.name || `Video KYC evidence ${entry.index}`, 44, 641, 9.5, 'F2', '0.05 0.49 0.52'),
      pdfText(`Captured ${receiptDate(entry.evidence.captured_at)} by ${entry.evidence.captured_by || session.completed_by || 'RFMS Officer'}`, 44, 625, 8.8, 'F1', '0.34 0.45 0.57'),
      'q', '0.97 0.99 1 rg', '44 116 507 474 re f', '0.84 0.89 0.94 RG', '44 116 507 474 re S', 'Q',
      pdfImageDraw('Evidence', entry.image, 60, 136, 475, 434),
      '0.09 0.53 0.55 rg', '44 92 507 1 re f', pdfText(`Application ${application.application_number} - Video KYC attempt ${Number(session.attempt) || 1}`, 44, 70, 8.3, 'F1', '0.34 0.45 0.57'),
    ].join('\n');
    const evidenceBytes = Buffer.from(evidenceBody, 'ascii');
    objects[entry.imageObjectNumber - 1] = entry.image.object;
    objects[entry.pageObjectNumber - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Evidence ${entry.imageObjectNumber} 0 R${logo ? ` /Logo ${logoObjectNumber} 0 R` : ''} >> >> /Contents ${entry.contentObjectNumber} 0 R >>`;
    objects[entry.contentObjectNumber - 1] = pdfStream(`<< /Length ${evidenceBytes.length} >>`, evidenceBytes);
  }
  return buildPdf(objects);
}

async function fieldVisitReportPdf(application, visit) {
  const profile = companyProfile(database.company_profile);
  const report = visit.report && typeof visit.report === 'object' ? visit.report : {};
  const companyName = receiptText(profile.company_name, 120);
  const contactPhone = receiptText(profile.company_phone || '03369029634', 40);
  const contactEmail = receiptText(profile.company_email || 'support@remediumcare.in', 160);
  const addressLines = receiptWrap(profile.office_address, 44).slice(0, 2);
  const logo = await receiptLogoImage();
  const headerLogo = logo
    ? pdfHeaderLogoDraw(logo)
    : ['0.04 0.63 0.64 rg', '52 776 34 34 re f', pdfText('RL', 61, 787, 12, 'F2', '1 1 1'), pdfText(companyName, 98, 790, 18, 'F2', '1 1 1')].join('\n');
  const details = [
    ['Application no.', application.application_number], ['Applicant', application.full_name], ['Franchise model', application.franchise_model],
    ['Proposed location', application.preferred_location], ['Field officer', visit.officer_name], ['Officer contact', visit.officer_phone],
    ['Date of field visit', report.visit_date || 'Not recorded'], ['Submitted', receiptDate(visit.submitted_at || report.submitted_at)],
    ['Approved by', visit.approved_by || 'RFMS Officer'], ['Approved', receiptDate(visit.approved_at)],
  ];
  const narrativeBlocks = fieldVisitNarrativeBlocks(report, visit);
  const narrativePages = paginateFieldVisitNarrative(narrativeBlocks, 400, 740, 72);
  const pageBodies = [];

  const firstPageBody = [
    ...fieldVisitReportHeaderDraw(profile, companyName, contactPhone, contactEmail, addressLines, headerLogo, false),
    pdfText('Approved field visit report', 44, 663, 21, 'F2'),
    pdfText(`Generated ${receiptDate(new Date().toISOString())}`, 44, 641, 9, 'F1', '0.34 0.45 0.57'),
    'q', '0.90 0.98 0.94 rg', '460 628 91 26 re f', 'Q', pdfText('APPROVED', 472, 637, 9.4, 'F2', '0.05 0.48 0.29'),
    'q', '0.98 0.99 1 rg', '44 470 507 140 re f', '0.84 0.89 0.94 RG', '44 470 507 140 re S', 'Q',
    pdfText('VISIT DETAILS', 58, 584, 10, 'F2', '0.05 0.42 0.62'),
    ...details.flatMap(([label, value], index) => [pdfText(label, index < 5 ? 58 : 314, 558 - (index % 5) * 20, 8.5, 'F1', '0.36 0.48 0.61'), pdfText(fieldVisitPdfSanitize(value, 240), index < 5 ? 150 : 405, 558 - (index % 5) * 20, 8.6, 'F2')]),
    ...fieldVisitReportNarrativeDraw(narrativePages[0] ?? [], 400).commands,
  ];
  pageBodies.push(firstPageBody);

  for (let pageIndex = 1; pageIndex < narrativePages.length; pageIndex += 1) {
    pageBodies.push([
      ...fieldVisitReportHeaderDraw(profile, companyName, contactPhone, contactEmail, addressLines, headerLogo, true),
      pdfText(`Application ${application.application_number}`, 44, 748, 10, 'F2', '0.05 0.42 0.62'),
      pdfText(`Applicant: ${fieldVisitPdfSanitize(application.full_name, 120)}`, 44, 732, 8.8, 'F1', '0.34 0.45 0.57'),
      ...fieldVisitReportNarrativeDraw(narrativePages[pageIndex], 710).commands,
    ]);
  }

  pageBodies.at(-1)?.push(...fieldVisitReportFooterDraw(application));

  let nextObjectNumber = logo ? 6 : 5;
  const pageEntries = pageBodies.map((body) => ({
    pageObjectNumber: nextObjectNumber++,
    contentObjectNumber: nextObjectNumber++,
    bodyBytes: Buffer.from(body.join('\n'), 'ascii'),
  }));
  const pageObjectNumbers = pageEntries.map((entry) => entry.pageObjectNumber);
  const logoObjectNumber = logo ? 5 : null;
  const objects = new Array(nextObjectNumber - 1);
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  if (logo) objects[4] = logo.object;
  const baseResources = `/Font << /F1 3 0 R /F2 4 0 R >>${logo ? ` /XObject << /Logo ${logoObjectNumber} 0 R >>` : ''}`;
  for (const entry of pageEntries) {
    objects[entry.pageObjectNumber - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${baseResources} >> /Contents ${entry.contentObjectNumber} 0 R >>`;
    objects[entry.contentObjectNumber - 1] = pdfStream(`<< /Length ${entry.bodyBytes.length} >>`, entry.bodyBytes);
  }
  return buildPdf(objects);
}

async function territoryAllotmentLetterPdf(application, allotment) {
  const profile = companyProfile(database.company_profile);
  const companyName = receiptText(profile.company_name, 120);
  const contactPhone = receiptText(profile.company_phone || '03369029634', 40);
  const contactEmail = receiptText(profile.company_email || 'support@remediumcare.in', 160);
  const addressLines = receiptWrap(profile.office_address, 44).slice(0, 2);
  const logo = await receiptLogoImage();
  const headerLogo = logo
    ? pdfHeaderLogoDraw(logo)
    : ['0.04 0.63 0.64 rg', '52 776 34 34 re f', pdfText('RL', 61, 787, 12, 'F2', '1 1 1'), pdfText(companyName, 98, 790, 18, 'F2', '1 1 1')].join('\n');
  const franchiseAddress = receiptWrap(allotment.franchise_address || application.address || 'Not recorded', 80).slice(0, 2);
  const locationCoordinates = optionalGeoCoordinate(allotment.latitude, -90, 90).value !== null && optionalGeoCoordinate(allotment.longitude, -180, 180).value !== null
    ? `${optionalGeoCoordinate(allotment.latitude, -90, 90).value}, ${optionalGeoCoordinate(allotment.longitude, -180, 180).value}`
    : 'Not recorded';
  const details = [
    ['Letter no.', allotment.letter_number], ['Version', `Version ${Number(allotment.version) || 1}`],
    ['Effective date', allotment.effective_date || 'Not recorded'], ['Issued by', allotment.issued_by || 'RFMS Officer'],
    ['Application no.', application.application_number], ['Applicant', application.full_name],
    ['Franchise model', application.franchise_model], ['PIN code', allotment.pincode || application.pincode || 'Not recorded'],
    ['District / State', [allotment.district, allotment.state].filter(Boolean).join(', ') || 'Not recorded'],
    ['Territory radius', `${Number(allotment.radius_km) || 0} km`],
  ];
  const mandatoryClause = "The allotted franchise territory may be increased or decreased by the Company based on the franchisee's business performance, operational requirements, compliance status, and company policies.";
  const body = [
    'q', '0.03 0.16 0.35 rg', '0 700 595 142 re f', 'Q',
    'q', '1 1 1 rg', '42 762 204 57 re f', 'Q', headerLogo,
    pdfText('OFFICIAL TERRITORY ALLOTMENT LETTER', 48, 741, 9, 'F2', '0.75 0.91 0.96'),
    pdfText(profile.franchise_hub_name, 302, 808, 15, 'F2', '1 1 1'),
    ...addressLines.map((line, index) => pdfText(line, 302, 789 - index * 12, 8.7, 'F1', '0.80 0.91 0.97')),
    pdfText(`Phone: ${contactPhone}`, 302, 758, 8.7, 'F1', '0.80 0.91 0.97'), pdfText(`Email: ${contactEmail}`, 302, 745, 8.7, 'F1', '0.80 0.91 0.97'),
    pdfText('Territory allotment confirmation', 44, 663, 21, 'F2'), pdfText(`Generated ${receiptDate(new Date().toISOString())}`, 44, 641, 9, 'F1', '0.34 0.45 0.57'),
    'q', '0.90 0.98 0.94 rg', '456 628 95 26 re f', 'Q', pdfText('ISSUED', 480, 637, 9.4, 'F2', '0.05 0.48 0.29'),
    'q', '0.98 0.99 1 rg', '44 438 507 174 re f', '0.84 0.89 0.94 RG', '44 438 507 174 re S', 'Q', pdfText('FRANCHISE AND ALLOTMENT DETAILS', 58, 590, 10, 'F2', '0.05 0.42 0.62'),
    ...details.flatMap(([label, value], index) => [pdfText(label, index < 5 ? 58 : 314, 564 - (index % 5) * 20, 8.5, 'F1', '0.36 0.48 0.61'), pdfText(value, index < 5 ? 162 : 418, 564 - (index % 5) * 20, 8.6, 'F2')]),
    'q', '0.94 0.99 0.98 rg', '44 335 507 80 re f', '0.70 0.88 0.85 RG', '44 335 507 80 re S', 'Q',
    pdfText('YOUR ALLOTTED FRANCHISE TERRITORY', 58, 398, 8.7, 'F2', '0.05 0.42 0.62'), pdfText(allotment.final_territory || allotment.registered_territory_label || 'Not recorded', 58, 375, 16, 'F2'),
    pdfText(`Registered territory: ${allotment.registered_territory_label || 'Not recorded'}`, 58, 358, 8.6, 'F1', '0.16 0.28 0.40'),
    pdfText(`Subdivision: ${allotment.subdivision || 'Not recorded'}  |  GPS: ${locationCoordinates}`, 58, 342, 8.2, 'F1', '0.16 0.28 0.40'),
    pdfText('FRANCHISE ADDRESS', 58, 316, 8.7, 'F2', '0.05 0.42 0.62'), ...franchiseAddress.map((line, index) => pdfText(line, 58, 300 - index * 12, 8.7, 'F1', '0.16 0.28 0.40')),
    'q', '1 0.98 0.92 rg', '44 180 507 92 re f', '0.93 0.74 0.35 RG', '44 180 507 92 re S', 'Q',
    pdfText('IMPORTANT TERMS', 58, 250, 9.2, 'F2', '0.50 0.30 0.03'), ...receiptWrap(mandatoryClause, 88).map((line, index) => pdfText(line, 58, 229 - index * 13, 8.7, 'F1', '0.26 0.25 0.20')),
    pdfText('This digitally generated letter is stored permanently in the franchise application audit history.', 44, 88, 8.5, 'F1', '0.34 0.45 0.57'),
    '0.09 0.53 0.55 rg', '44 69 507 1 re f', pdfText(`Verification reference: ${allotment.letter_number}`, 44, 50, 8.5, 'F1', '0.34 0.45 0.57'),
  ];
  const content = Buffer.from(body.join('\n'), 'ascii');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${logo ? ' /XObject << /Logo 7 0 R >>' : ''} >> /Contents 4 0 R >>`,
    pdfStream(`<< /Length ${content.length} >>`, content), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', ...(logo ? [logo.object] : []),
  ];
  return buildPdf(objects);
}

const applicationDocumentKinds = new Set(['photo', 'pan', 'aadhaar', 'voter']);

function applicationDocumentData(value) {
  const match = typeof value === 'string' ? value.match(/^data:(image\/(png|jpeg|webp)|application\/(pdf|octet-stream));base64,([a-zA-Z0-9+/=\r\n]+)$/) : null;
  if (!match) return null;
  const bytes = Buffer.from(match[4], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
  const isPdf = match[1].startsWith('application/') && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (match[1].startsWith('application/') && !isPdf) return null;
  const extension = isPdf ? 'pdf' : match[2] === 'jpeg' ? 'jpg' : match[2];
  return { bytes, mime: isPdf ? 'application/pdf' : match[1], extension };
}

function agreementDocumentData(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const marker = ';base64,';
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) return null;
  const base64 = value.slice(markerIndex + marker.length).replace(/\s/g, '');
  if (!base64) return null;
  let bytes;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > 32 * 1024 * 1024) return null;
  const headerWindow = bytes.subarray(0, Math.min(bytes.length, 1024)).toString('latin1');
  if (!headerWindow.includes('%PDF-')) return null;
  return { bytes, mime: 'application/pdf', extension: 'pdf' };
}

function paymentPlan(model) {
  if (model === 'FOFO') return [{ key: 'fofo_one_time_fee', label: 'FOFO one-time franchise fee', amount: 45000, purpose: 'Application submission, document review and franchise processing', status: 'due' }];
  return [
    { key: 'application_fee', label: 'Phase 1 — Application fee', amount: 10000, scheduled_amount: 10000, purpose: 'Document verification and location allotment', status: 'due' },
    { key: 'franchise_fee', label: 'Phase 2 — Franchise fee', amount: 110000, scheduled_amount: 110000, purpose: 'Onboarding process', status: 'locked' },
    { key: 'security_deposit', label: 'Phase 3 — Security deposit', amount: 200000, scheduled_amount: 200000, purpose: 'Final agreement and onboarding', status: 'locked' },
  ];
}

function applicationNumber() {
  return `RFMS-${new Date().getFullYear()}-${String(database.applications.length + 1).padStart(4, '0')}`;
}

function publicAssetOrigin() {
  const explicit = String(process.env.RFMS_PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  for (const candidate of [
    process.env.RFMS_ADMIN_BASE_URL,
    process.env.RFMS_PORTAL_BASE_URL,
    process.env.RFMS_MARKETING_BASE_URL,
    process.env.RFMS_PUBLIC_BASE_URL,
  ]) {
    try {
      const origin = new URL(String(candidate ?? '')).origin;
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
    } catch {
      // ignore invalid URL candidates
    }
  }
  return `http://localhost:${port}`;
}

function resolveUploadUrl(url) {
  const value = text(url, 1000);
  if (!value) return '';
  const origin = publicAssetOrigin();
  const localMatch = value.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/uploads\/[A-Za-z0-9._-]+)$/i);
  if (localMatch) return `${origin}${localMatch[1]}`;
  if (value.startsWith('/uploads/')) return `${origin}${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return value;
}

function storedUploadUrl(filename) {
  return resolveUploadUrl(`/uploads/${path.basename(String(filename || ''))}`);
}

/** Public API base for QR/verification links (must hit the API, not the portal static app). */
function publicApiBaseUrl() {
  const explicit = String(process.env.RFMS_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const origin = publicAssetOrigin();
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return `${origin}/rfms-api/v1`;
  }
  return `http://localhost:${port}/api/v1`;
}

/** Rewrite legacy verification links that still point at /onboard/api or localhost. */
function rewritePublicApiUrl(url) {
  const value = text(url, 1000);
  if (!value) return '';
  const api = publicApiBaseUrl();
  return value
    .replace(/https?:\/\/[^/\s]+\/onboard\/api\/v1/gi, api)
    .replace(/https?:\/\/onboard\.e-remedium\.in\/api\/v1/gi, api)
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/api\/v1/gi, api);
}

function territoryAllotmentSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const history = Array.isArray(value.history) ? value.history.slice(-50) : [];
  return {
    id: text(value.id, 80), version: Math.max(1, Number(value.version) || 1), letter_number: text(value.letter_number, 120),
    territory_id: text(value.territory_id, 80), registered_territory_label: text(value.registered_territory_label, 240),
    final_territory: text(value.final_territory, 240), radius_km: boundedDecimal(value.radius_km, 5, 0.1, 100),
    franchise_address: text(value.franchise_address, 700), district: text(value.district, 100), subdivision: text(value.subdivision, 100), state: text(value.state, 100) || 'West Bengal',
    pincode: pinCode(value.pincode), preferred_location: text(value.preferred_location, 240),
    latitude: optionalGeoCoordinate(value.latitude, -90, 90).value, longitude: optionalGeoCoordinate(value.longitude, -180, 180).value,
    google_maps_url: googleMapsLocationUrl(value.google_maps_url), effective_date: text(value.effective_date, 10),
    conflict_override: Boolean(value.conflict_override),
    issued_at: text(value.issued_at, 60), issued_by: text(value.issued_by, 120), status: 'active', history,
  };
}

function territoryAllotmentsFor(application) {
  return (Array.isArray(application?.territory_allotments) ? application.territory_allotments : []).map(territoryAllotmentSummary).filter(Boolean);
}

function applicationSummary(application) {
  if (application?.franchise_model === 'FOCO') ensureFocoPaymentSchedule(application);
  ensureOnboardingModules(application, { territoryAllotted, paymentIsPaid });
  reconcileAgreementWorkflow(application.agreement_workflow);
  const assignedTerritory = database.territories.find((territory) => territory.id === application.territory_id);
  const documentVerifications = application.document_verifications && typeof application.document_verifications === 'object' ? application.document_verifications : {};
  const reviewHistory = Array.isArray(application.review_history) ? application.review_history : [];
  const videoKycSessions = videoKycSessionsFor(application).map(videoKycSessionSummary);
  const territoryAllotments = territoryAllotmentsFor(application);
  const currentTerritoryAllotment = territoryAllotmentSummary(application.territory_allotment) || territoryAllotments.at(-1) || null;
  const documents = application.documents && typeof application.documents === 'object'
    ? Object.fromEntries(Object.entries(application.documents).map(([kind, document]) => [kind, document && typeof document === 'object' ? { ...document, url: resolveUploadUrl(document.url) } : document]))
    : {};
  return {
    id: application.id,
    application_number: application.application_number,
    franchisee_id: franchiseeIdForApplication(application),
    franchisee_id_issued_at: application.franchisee_id_issued_at ?? '',
    full_name: application.full_name,
    email: application.email,
    mobile: application.mobile,
    date_of_birth: application.date_of_birth ?? '',
    pan_number: application.pan_number ?? '',
    aadhaar_number: application.aadhaar_number ?? '',
    aadhaar_okyc: application.aadhaar_okyc && typeof application.aadhaar_okyc === 'object'
      ? {
          status: application.aadhaar_okyc.status || '',
          reference_id: application.aadhaar_okyc.reference_id || '',
          message: application.aadhaar_okyc.message || '',
          verified_at: application.aadhaar_okyc.verified_at || '',
          initiated_at: application.aadhaar_okyc.initiated_at || '',
          simulated: Boolean(application.aadhaar_okyc.simulated),
          aadhaar_masked: application.aadhaar_okyc.aadhaar_masked || maskAadhaar(application.aadhaar_number),
          response: application.aadhaar_okyc.response && typeof application.aadhaar_okyc.response === 'object'
            ? application.aadhaar_okyc.response
            : null,
        }
      : null,
    address: application.address ?? '',
    city: application.city ?? '',
    district: application.district ?? '',
    pincode: application.pincode ?? '',
    business_experience: application.business_experience ?? '',
    user_id: application.user_id ?? '',
    franchise_model: application.franchise_model,
    preferred_location: application.preferred_location,
    territory_id: application.territory_id ?? '',
    territory_label: application.territory_label || (assignedTerritory ? territoryLabel(assignedTerritory) : ''),
    territory_pincode: application.territory_pincode ?? '',
    territory_allotment: currentTerritoryAllotment,
    territory_allotments: territoryAllotments,
    stage: application.stage,
    visible_to_admin: Boolean(application.visible_to_admin),
    terms_accepted: Boolean(application.terms_accepted_at),
    payment_terms: application.payment_terms && typeof application.payment_terms === 'object' ? application.payment_terms : {},
    documents,
    document_verifications: documentVerifications,
    review_notes: application.review_notes ?? '',
    review_history: reviewHistory,
    video_kyc_sessions: videoKycSessions,
    video_kyc_current_session_id: application.video_kyc_current_session_id ?? '',
    field_visit: fieldVisitSummary(application.field_visit),
    onboarding_documents: onboardingDocumentsFor(application).map(onboardingDocumentSummary),
    branding_signage: brandingSignageSummary(application.branding_signage),
    hr_process: hrProcessSummary(application.hr_process),
    payments: application.payments,
    payment_schedule: application.franchise_model === 'FOCO' ? paymentScheduleSummary(application) : null,
    onboarding_modules: onboardingModulesSummary(application),
    agreement_workflow: agreementWorkflowSummary(application.agreement_workflow, resolveUploadUrl),
    training: trainingWorkflowSummary(application, database.training_videos, resolveUploadUrl),
    onboarding_certificate: onboardingCertificateWorkflowSummary(application, resolveUploadUrl),
    franchise_webpage: (() => {
      const webpage = franchiseWebpageByApplicationId(application.id);
      return webpage ? franchiseWebpageRecord(webpage, resolveUploadUrl) : null;
    })(),
    hec_franchisee_profile: application.hec_franchisee_profile ?? '',
    hec_hub_activated_at: application.hec_hub_activated_at ?? '',
    hec_wallet_recharge: application.hec_wallet_recharge ?? null,
    hec_hub_activation_error: application.hec_hub_activation_error ?? '',
    parent_foco_id: application.parent_foco_id ?? '',
    parent_foco_name: application.parent_foco_name ?? '',
    parent_foco_mapped_at: application.parent_foco_mapped_at ?? '',
    partner_portal: application.partner_portal && typeof application.partner_portal === 'object'
      ? {
          login_url: String(application.partner_portal.login_url || partnerPortalLoginUrl()).trim() || partnerPortalLoginUrl(),
          user_id: String(application.partner_portal.user_id || '').trim(),
          password: String(application.partner_portal.password || '').trim(),
          provisioned_at: String(application.partner_portal.provisioned_at || '').trim(),
          message: String(application.partner_portal.message || PARTNER_PORTAL_ONBOARDED_MESSAGE).trim() || PARTNER_PORTAL_ONBOARDED_MESSAGE,
        }
      : null,
    partner_portal_error: application.partner_portal_error ?? '',
    employee_referral_number: text(application.employee_referral_number, 40),
    support: {
      unread_replies: applicantSupportUnreadCount(ensureSupportTicketsArray(), application.id),
      open_tickets: ensureSupportTicketsArray().filter((item) => item.application_id === application.id && item.status !== 'closed').length,
    },
    created_at: application.created_at,
    updated_at: application.updated_at,
  };
}

function agreementQueueItem(application) {
  const workflow = application.agreement_workflow;
  const correctionRequest = String(workflow?.applicant?.correction_request ?? '').trim();
  return {
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    franchise_model: application.franchise_model,
    preferred_location: application.preferred_location,
    status: workflow?.status ?? 'not_started',
    status_label: agreementStatusLabel(workflow?.status ?? 'not_started'),
    reference_number: workflow?.reference_number ?? agreementReference(application),
    correction_request: correctionRequest,
    correction_requested_at: workflow?.applicant?.correction_requested_at ?? '',
    updated_at: application.updated_at,
  };
}

function agreementExecutionBlockedMessage(workflow, mode = 'manual') {
  const status = workflow?.status ?? 'not_started';
  if (mode === 'manual') {
    if (['applicant_esign_completed', 'company_execution_pending', 'executed'].includes(status)) return '';
    return 'Manual execution upload is available only after applicant Aadhaar eSign is completed.';
  }
  if (status === 'executed') return 'This agreement is already executed. Refresh the Agreement workspace to view the archived final version.';
  if (status === 'company_dsc_completed') return 'Company DSC is already complete. Refresh the Agreement workspace to continue.';
  if (status !== 'applicant_esign_completed') {
    return 'Company DSC signing is enabled only after applicant Aadhaar eSign is completed.';
  }
  return '';
}

function agreementApplicationRecord(applicationId, visibleToAdmin = true) {
  return database.applications.find((item) => item.id === applicationId && (!visibleToAdmin || item.visible_to_admin));
}

async function reloadDatabaseFromDisk() {
  tokens.clear();
  await loadDatabase();
}

async function persistExecutedAgreement(application, workflow, method = 'dsc') {
  const source = workflow.document?.aadhaar_signed_file || workflow.document?.uploaded_file;
  if (source?.url) {
    const copied = await copyAgreementUploadFile(source.url, `executed-agreement-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}`, source.name || 'executed-agreement.pdf');
    if (copied) {
      workflow.document = workflow.document && typeof workflow.document === 'object' ? workflow.document : {};
      workflow.document.executed_file = copied;
      workflow.executed = {
        agreement_url: copied.url,
        executed_at: new Date().toISOString(),
        qr_reference: workflow.reference_number,
      };
      workflow.execution_method = method;
      workflow.status = 'executed';
      pushAgreementVersion(workflow, {
        type: method === 'manual' ? 'manual_executed' : 'dsc_executed',
        name: copied.name,
        url: copied.url,
        mime: copied.mime,
        actor: workflow.company?.dsc_signed_by || workflow.executed?.uploaded_by || 'RFMS Officer',
        reference: workflow.reference_number,
        message: method === 'manual' ? 'Manually signed and stamped agreement uploaded as the official executed version.' : 'Company DSC signature applied and executed agreement generated.',
      });
      return;
    }
  }
  const content = buildExecutedAgreementText(application, database.company_profile, workflow);
  await mkdir(uploadsDirectory, { recursive: true });
  const filename = `executed-agreement-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}-${Date.now()}.txt`;
  await writeFile(path.join(uploadsDirectory, filename), content, 'utf8');
  workflow.document = workflow.document && typeof workflow.document === 'object' ? workflow.document : {};
  workflow.document.executed_file = { id: randomUUID(), name: filename, url: `/uploads/${filename}`, mime: 'text/plain', uploaded_at: new Date().toISOString(), uploaded_by: workflow.company?.dsc_signed_by || 'RFMS Officer' };
  workflow.executed = {
    agreement_url: `/uploads/${filename}`,
    executed_at: new Date().toISOString(),
    qr_reference: workflow.reference_number,
  };
  workflow.execution_method = method;
  workflow.status = 'executed';
}

async function readAgreementUploadBytes(sourceUrl) {
  const basename = path.basename(String(sourceUrl || ''));
  if (!basename) return null;
  const fallbackUploadsDirectory = path.resolve(process.cwd(), 'work', 'rfms-uploads');
  const candidateDirectories = uploadsDirectory === fallbackUploadsDirectory
    ? [uploadsDirectory]
    : [uploadsDirectory, fallbackUploadsDirectory];
  for (const directory of candidateDirectories) {
    const bytes = await readFile(path.join(directory, basename)).catch(() => null);
    if (bytes) return bytes;
  }
  return null;
}

async function copyAgreementUploadFile(sourceUrl, prefix, name = 'agreement.pdf') {
  const basename = path.basename(String(sourceUrl || ''));
  if (!basename) return null;
  const bytes = await readAgreementUploadBytes(sourceUrl);
  if (!bytes) return null;
  const extension = path.extname(name) || path.extname(basename) || '.pdf';
  const safeName = text(name, 180).replace(/[^A-Za-z0-9._-]/g, '_') || `${prefix}${extension}`;
  const filename = `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}${extension.startsWith('.') ? extension : `.${extension}`}`;
  await mkdir(uploadsDirectory, { recursive: true });
  await writeFile(path.join(uploadsDirectory, filename), bytes);
  return { id: randomUUID(), name: safeName.replace(/\.[^.]+$/, '') + extension, url: `/uploads/${filename}`, mime: extension.toLowerCase() === '.pdf' ? 'application/pdf' : 'application/octet-stream', uploaded_at: new Date().toISOString() };
}

async function persistAadhaarSignedAgreement(application, workflow, actorName, esignReference) {
  const uploaded = workflow.document?.uploaded_file;
  if (!uploaded?.url) return false;
  const copied = await copyAgreementUploadFile(uploaded.url, `aadhaar-signed-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}`, uploaded.name?.replace(/\.[^.]+$/, '') + '-aadhaar-signed.pdf');
  if (!copied) return false;
  workflow.document.aadhaar_signed_file = copied;
  pushAgreementVersion(workflow, {
    type: 'aadhaar_esign',
    name: copied.name,
    url: copied.url,
    mime: copied.mime,
    actor: actorName,
    reference: esignReference,
    message: 'Applicant Aadhaar eSign completed. Digital signature applied at all predefined signature locations.',
  });
  return true;
}

function agreementDownloadFile(workflow) {
  if (workflow.status === 'executed') return workflow.document?.executed_file || null;
  if (['applicant_esign_completed', 'company_dsc_completed'].includes(workflow.status)) return workflow.document?.aadhaar_signed_file || null;
  return workflow.document?.uploaded_file || null;
}

async function streamAgreementDownload(request, response, file, downloadName) {
  if (!file?.url) return false;
  const bytes = await readAgreementUploadBytes(file.url);
  if (!bytes) return false;
  cors(request, response);
  const mime = file.mime || (file.url.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8');
  response.writeHead(200, {
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="${downloadName || file.name || 'agreement.pdf'}"`,
    'Content-Length': bytes.length,
  });
  response.end(bytes);
  return true;
}

function reviewActor(request) {
  return sessionFor(request)?.name || 'RFMS Officer';
}

function notifyApplicationWorkflow(application, type, message, request, actorName = '') {
  const actor = workflowActor(request, actorName || reviewActor(request));
  const portalSection = ({
    document_verified: 'documents',
    document_reupload_requested: 'documents',
    document_upload_again_requested: 'documents',
    document_reuploaded: 'documents',
    onboarding_document_requested: 'documents',
    onboarding_document_uploaded: 'documents',
    video_kyc_assigned: 'video-kyc',
    video_kyc_started: 'video-kyc',
    video_kyc_completed: 'video-kyc',
    field_visit_assigned: 'overview',
    field_visit_report_submitted: 'overview',
    territory_allotment_issued: 'territory',
    territory_allotment_reissued: 'territory',
    agreement_sent: 'agreement',
    agreement_sent_to_applicant: 'agreement',
    agreement_executed: 'agreement',
    agreement_delivered_to_applicant: 'agreement',
    agreement_accepted: 'agreement',
    agreement_correction_requested: 'agreement',
    applicant_esign_completed: 'agreement',
    training_unlocked: 'training',
    training_certificate_issued: 'training',
    onboarding_completed: 'overview',
    application_onboarded: 'overview',
    payment_verified: 'payments',
    payment_received: 'payments',
    foco_phase_2_payment_received: 'payments',
    foco_phase_3_payment_received: 'payments',
    foco_phase_2_payment_unlocked: 'payments',
    foco_phase_3_payment_unlocked: 'payments',
  })[type] ?? 'overview';
  const module = type.includes('payment') || type.includes('receipt') || type.includes('refund') || type.includes('invoice')
    ? 'payments'
    : type.includes('agreement') || type.includes('estamp') || type.includes('esign') || type.includes('dsc')
      ? 'agreements'
      : type.includes('video_kyc')
        ? 'video_kyc'
        : type.includes('field_visit')
          ? 'field_visit'
          : type.includes('territory')
            ? 'territory'
            : type.includes('training') || type.includes('certificate')
              ? 'training'
              : type.includes('onboarding') || type.includes('hr_') || type.includes('branding')
                ? 'onboarding'
                : 'applications';
  const adminPage = module === 'payments'
    ? 'Payments'
    : module === 'agreements'
      ? 'Agreements'
      : module === 'video_kyc'
        ? 'Video KYC'
        : module === 'territory'
          ? 'Territory'
          : module === 'training'
            ? 'Training'
            : 'Applicants';
  workflowNotify({
    module,
    action: type,
    title: message.split('.')[0] || 'Application update',
    message,
    actor,
    href: `admin:${adminPage}:${application.id}`,
    portalHref: `portal:${portalSection}`,
    entityType: 'application',
    entityId: application.id,
    applicationId: application.id,
  });
}

function applicationReviewHistory(application, type, message, request, actorName = '') {
  application.review_history = Array.isArray(application.review_history) ? application.review_history : [];
  application.review_history.push({ id: randomUUID(), type, message, actor: actorName || reviewActor(request), created_at: new Date().toISOString() });
  application.review_history = application.review_history.slice(-50);
  notifyApplicationWorkflow(application, type, message, request, actorName);
}

function documentIsVerified(application, kind) {
  return application?.document_verifications?.[kind]?.status === 'verified';
}

function documentUploadAgainRequested(application, kind) {
  return application?.document_verifications?.[kind]?.status === 'upload_requested';
}

function videoKycSessionsFor(application) {
  return Array.isArray(application?.video_kyc_sessions) ? application.video_kyc_sessions : [];
}

function onboardingDocumentsFor(application) {
  return Array.isArray(application?.onboarding_documents) ? application.onboarding_documents : [];
}

function onboardingDocumentSummary(document) {
  if (!document || typeof document !== 'object') return null;
  return {
    id: document.id,
    title: document.title || 'Supporting document',
    description: document.description || '',
    required_count: Math.max(1, Number(document.required_count) || 1),
    requested_at: document.requested_at || '',
    requested_by: document.requested_by || '',
    files: Array.isArray(document.files) ? document.files.map((file) => ({
      id: file.id, slot: Number(file.slot) || 1, name: file.name || 'Uploaded file', url: resolveUploadUrl(file.url),
      status: file.status || 'pending', remarks: file.remarks || '', submitted_at: file.submitted_at || '',
      reviewed_at: file.reviewed_at || '', reviewed_by: file.reviewed_by || '', history: Array.isArray(file.history) ? file.history.slice(-30) : [],
    })) : [],
  };
}

function onboardingDocumentRecord(application, documentId) {
  return onboardingDocumentsFor(application).find((document) => document.id === documentId) ?? null;
}

function fieldVisitSummary(visit) {
  if (!visit || typeof visit !== 'object') return null;
  const report = visit.report && typeof visit.report === 'object' ? visit.report : null;
  return {
    id: visit.id,
    status: visit.status || 'assigned',
    officer_name: visit.officer_name || '', officer_phone: visit.officer_phone || '',
    assigned_at: visit.assigned_at || '', assigned_by: visit.assigned_by || '',
    submitted_at: visit.submitted_at || '', approved_at: visit.approved_at || '', approved_by: visit.approved_by || '',
    manager_remarks: visit.manager_remarks || '',
    report: report ? {
      visit_date: report.visit_date || '', site_address: report.site_address || '', google_maps_url: googleMapsLocationUrl(report.google_maps_url), inspection_summary: report.inspection_summary || '',
      property_condition: report.property_condition || '', documents_observed: report.documents_observed || '',
      recommendation: report.recommendation || '', officer_remarks: report.officer_remarks || '',
      site_photos: Array.isArray(report.site_photos)
        ? report.site_photos.slice(-12).map((item) => ({
          id: text(item.id, 80),
          name: text(item.name, 240),
          url: resolveUploadUrl(item.url),
          uploaded_at: text(item.uploaded_at, 60),
        }))
        : [],
      submitted_at: report.submitted_at || '', submitted_by: report.submitted_by || '',
    } : null,
    history: Array.isArray(visit.history) ? visit.history.slice(-50) : [],
  };
}

function brandingSignageSummary(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    status: record.status || 'not_started',
    vendor: record.vendor && typeof record.vendor === 'object' ? {
      name: text(record.vendor.name, 120), shop_name: text(record.vendor.shop_name, 160),
      address: text(record.vendor.address, 700), phone: text(record.vendor.phone, 30),
    } : null,
    materials: Array.isArray(record.materials) ? record.materials.slice(-30).map((item) => ({ id: text(item.id, 80), title: text(item.title, 160), url: resolveUploadUrl(item.url), uploaded_at: text(item.uploaded_at, 60) })) : [],
    completion_details: text(record.completion_details, 5000),
    photographs: Array.isArray(record.photographs) ? record.photographs.slice(-6).map((item) => ({ id: text(item.id, 80), name: text(item.name, 240), url: resolveUploadUrl(item.url), uploaded_at: text(item.uploaded_at, 60) })) : [],
    submitted_at: text(record.submitted_at, 60), submitted_by: text(record.submitted_by, 120),
    manager_remarks: text(record.manager_remarks, 3000), approved_at: text(record.approved_at, 60), approved_by: text(record.approved_by, 120),
    installation_cost: Number(record.installation_cost) || 0,
    invoice: record.invoice && typeof record.invoice === 'object' ? { name: text(record.invoice.name, 240), url: resolveUploadUrl(record.invoice.url), uploaded_at: text(record.invoice.uploaded_at, 60) } : null,
    payment_voucher_id: text(record.payment_voucher_id, 80),
    payment_voucher_number: text(record.payment_voucher_number, 80),
    history: Array.isArray(record.history) ? record.history.slice(-50) : [],
  };
}

function ensurePaymentVouchersArray() {
  if (!Array.isArray(database.payment_vouchers)) database.payment_vouchers = [];
  return database.payment_vouchers;
}

function nextPaymentVoucherNumber() {
  const year = new Date().getFullYear();
  const prefix = `PV-BRAND-${year}-`;
  const existing = ensurePaymentVouchersArray()
    .map((item) => String(item.voucher_number || ''))
    .filter((value) => value.startsWith(prefix))
    .map((value) => Number(value.slice(prefix.length)))
    .filter((value) => Number.isFinite(value));
  const next = (existing.length ? Math.max(...existing) : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function paymentVoucherSummary(voucher) {
  if (!voucher || typeof voucher !== 'object') return null;
  return {
    id: text(voucher.id, 80),
    voucher_number: text(voucher.voucher_number, 80),
    type: text(voucher.type, 60) || 'branding_installation',
    status: text(voucher.status, 40) || 'pending_payment',
    application_id: text(voucher.application_id, 80),
    application_number: text(voucher.application_number, 80),
    applicant_name: text(voucher.applicant_name, 160),
    franchise_model: text(voucher.franchise_model, 10),
    preferred_location: text(voucher.preferred_location, 240),
    vendor_name: text(voucher.vendor_name, 120),
    vendor_shop_name: text(voucher.vendor_shop_name, 160),
    vendor_phone: text(voucher.vendor_phone, 30),
    amount: Number(voucher.amount) || 0,
    currency: 'INR',
    invoice: voucher.invoice && typeof voucher.invoice === 'object'
      ? { name: text(voucher.invoice.name, 240), url: resolveUploadUrl(voucher.invoice.url), uploaded_at: text(voucher.invoice.uploaded_at, 60) }
      : null,
    branding_status: text(voucher.branding_status, 40),
    created_at: text(voucher.created_at, 60),
    created_by: text(voucher.created_by, 120),
    paid_at: text(voucher.paid_at, 60),
    paid_by: text(voucher.paid_by, 120),
    remarks: text(voucher.remarks, 3000),
  };
}

function createBrandingPaymentVoucher(application, branding, actor) {
  const vouchers = ensurePaymentVouchersArray();
  const existing = vouchers.find((item) => item.application_id === application.id && item.type === 'branding_installation' && item.status !== 'cancelled');
  if (existing) {
    existing.amount = Number(branding.installation_cost) || existing.amount || 0;
    existing.invoice = branding.invoice || existing.invoice || null;
    existing.vendor_name = branding.vendor?.name || existing.vendor_name || '';
    existing.vendor_shop_name = branding.vendor?.shop_name || existing.vendor_shop_name || '';
    existing.vendor_phone = branding.vendor?.phone || existing.vendor_phone || '';
    existing.branding_status = branding.status;
    existing.updated_at = new Date().toISOString();
    branding.payment_voucher_id = existing.id;
    branding.payment_voucher_number = existing.voucher_number;
    return existing;
  }
  const voucher = {
    id: randomUUID(),
    voucher_number: nextPaymentVoucherNumber(),
    type: 'branding_installation',
    status: 'pending_payment',
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    franchise_model: application.franchise_model,
    preferred_location: application.preferred_location,
    vendor_name: branding.vendor?.name || '',
    vendor_shop_name: branding.vendor?.shop_name || '',
    vendor_phone: branding.vendor?.phone || '',
    amount: Number(branding.installation_cost) || 0,
    invoice: branding.invoice || null,
    branding_status: branding.status,
    created_at: new Date().toISOString(),
    created_by: actor || 'System',
    paid_at: '',
    paid_by: '',
    remarks: `Pay branding vendor for application ${application.application_number}.`,
    updated_at: new Date().toISOString(),
  };
  vouchers.unshift(voucher);
  database.payment_vouchers = vouchers.slice(0, 2000);
  branding.payment_voucher_id = voucher.id;
  branding.payment_voucher_number = voucher.voucher_number;
  return voucher;
}

function hrProcessSummary(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    status: record.status || 'not_started',
    submitted_at: text(record.submitted_at, 60), submitted_by: text(record.submitted_by, 120),
    manager_remarks: text(record.manager_remarks, 3000), approved_at: text(record.approved_at, 60), approved_by: text(record.approved_by, 120),
    employees: Array.isArray(record.employees) ? record.employees.slice(0, 2).map((employee) => ({
      id: text(employee.id, 80), name: text(employee.name, 120), designation: text(employee.designation, 120), phone: text(employee.phone, 30),
      joining_date: text(employee.joining_date, 10), details: text(employee.details, 2000),
      offer_letter: employee.offer_letter && typeof employee.offer_letter === 'object' ? { name: text(employee.offer_letter.name, 240), url: resolveUploadUrl(employee.offer_letter.url), uploaded_at: text(employee.offer_letter.uploaded_at, 60) } : null,
    })) : [],
    history: Array.isArray(record.history) ? record.history.slice(-50) : [],
  };
}

function applicationWorkflowAudit(application, record, type, message, request, actorName = '') {
  const entry = { id: randomUUID(), type, message, actor: actorName || reviewActor(request), created_at: new Date().toISOString() };
  record.history = Array.isArray(record.history) ? record.history : [];
  record.history.push(entry); record.history = record.history.slice(-100);
  applicationReviewHistory(application, type, message, request, actorName);
}

async function storeApplicationUpload(application, prefix, source, name = '') {
  const file = applicationDocumentData(source);
  if (!file) return null;
  await mkdir(uploadsDirectory, { recursive: true });
  const safeName = text(name, 180).replace(/[^A-Za-z0-9._-]/g, '_') || `${prefix}.${file.extension}`;
  const filename = `${prefix}-${application.id}-${Date.now()}-${randomBytes(4).toString('hex')}-${safeName.replace(/\.[^.]+$/, '')}.${file.extension}`;
  await writeFile(path.join(uploadsDirectory, filename), file.bytes);
  return { id: randomUUID(), name: safeName.replace(/\.[^.]+$/, '') + `.${file.extension}`, url: `/uploads/${filename}`, uploaded_at: new Date().toISOString() };
}

function ensureSupportTicketsArray() {
  if (!Array.isArray(database.support_tickets)) database.support_tickets = [];
  return database.support_tickets;
}

function supportSettings() {
  return supportSettingsRecord(database.support_settings, companyProfile(database.company_profile));
}

function publicSupportSettings() {
  return resolvePublicSupportSettings(database.support_settings, companyProfile(database.company_profile));
}

function supportTicketById(id) {
  return ensureSupportTicketsArray().find((item) => item.id === id) ?? null;
}

function supportTicketsForApplication(applicationId) {
  return ensureSupportTicketsArray()
    .filter((item) => item.application_id === applicationId)
    .sort((first, second) => String(second.updated_at).localeCompare(String(first.updated_at)));
}

async function storeSupportAttachments(application, attachments) {
  const stored = [];
  for (const item of Array.isArray(attachments) ? attachments : []) {
    const uploaded = await storeApplicationUpload(application, 'support', item?.data_url ?? item?.url, item?.name ?? 'support-attachment');
    if (uploaded) stored.push({ id: uploaded.id, name: uploaded.name, url: uploaded.url });
  }
  return stored;
}

function syncApplicantProfileSessions(application) {
  if (!application?.id) return;
  for (const [token, session] of tokens.entries()) {
    if (session?.application_id === application.id) {
      tokens.set(token, {
        ...session,
        name: application.full_name,
        mobile: application.mobile,
        email: application.email,
      });
    }
  }
  database.sessions = database.sessions.map((session) => (
    session.application_id === application.id
      ? { ...session, name: application.full_name, mobile: application.mobile, email: application.email }
      : session
  ));
}

async function updateApplicantProfileFromManager(application, body, request) {
  const fullName = Object.prototype.hasOwnProperty.call(body, 'full_name') ? text(body.full_name, 120) : application.full_name;
  const email = Object.prototype.hasOwnProperty.call(body, 'email') ? contactValue('email', body.email) : application.email;
  const mobile = Object.prototype.hasOwnProperty.call(body, 'mobile') ? contactValue('mobile', body.mobile) : application.mobile;
  const address = Object.prototype.hasOwnProperty.call(body, 'address') ? text(body.address, 500) : application.address;
  const city = Object.prototype.hasOwnProperty.call(body, 'city') ? text(body.city, 100) : application.city;
  const district = Object.prototype.hasOwnProperty.call(body, 'district') ? text(body.district, 100) : application.district;
  const pincode = Object.prototype.hasOwnProperty.call(body, 'pincode') ? text(body.pincode, 10) : application.pincode;

  if (!fullName) return { error: 'VALIDATION_ERROR', message: 'Enter the applicant name.', status: 400 };
  if (!isEmail(email)) return { error: 'VALIDATION_ERROR', message: 'Enter a valid registered email address.', status: 400 };
  if (!mobile) return { error: 'VALIDATION_ERROR', message: 'Enter the applicant mobile number.', status: 400 };
  if (!address) return { error: 'VALIDATION_ERROR', message: 'Enter the applicant address.', status: 400 };
  if (!city) return { error: 'VALIDATION_ERROR', message: 'Enter the applicant city.', status: 400 };
  if (!district) return { error: 'VALIDATION_ERROR', message: 'Enter the applicant district.', status: 400 };
  if (!/^\d{6}$/.test(pincode)) return { error: 'VALIDATION_ERROR', message: 'Enter a valid 6-digit PIN code.', status: 400 };
  if (database.applications.some((item) => item.id !== application.id && item.email?.toLowerCase() === email.toLowerCase())) {
    return { error: 'EMAIL_TAKEN', message: 'This email address is already registered to another application.', status: 409 };
  }

  const changes = [];
  if (fullName !== application.full_name) changes.push(`name updated from ${application.full_name} to ${fullName}`);
  if (email !== application.email) changes.push(`email updated from ${application.email} to ${email}`);
  if (mobile !== application.mobile) changes.push(`mobile updated from ${application.mobile} to ${mobile}`);
  if (address !== application.address) changes.push('address updated');
  if (city !== application.city) changes.push(`city updated to ${city}`);
  if (district !== application.district) changes.push(`district updated to ${district}`);
  if (pincode !== application.pincode) changes.push(`PIN code updated to ${pincode}`);
  if (!changes.length) return { error: 'NO_CHANGES', message: 'Update at least one applicant profile field before saving.', status: 400 };

  application.full_name = fullName;
  application.email = email;
  application.mobile = mobile;
  application.address = address;
  application.city = city;
  application.district = district;
  application.pincode = pincode;
  application.updated_at = new Date().toISOString();

  const territory = application.territory_id ? database.territories.find((item) => item.id === application.territory_id) : null;
  if (territory) {
    const allocation = territory.allocations?.find((item) => item.application_id === application.id);
    if (allocation) allocation.applicant_name = fullName;
  }

  syncApplicantProfileSessions(application);
  const message = `Manager updated applicant profile: ${changes.join('; ')}.`;
  applicationReviewHistory(application, 'applicant_profile_updated', message, request);
  auditAdminAction(request, {
    action: 'applicant_profile_updated',
    details: `${application.application_number}: ${changes.join('; ')}`,
    target_application_id: application.id,
  });
  workflowNotify({
    module: 'applications',
    action: 'applicant_profile_updated',
    title: 'Applicant profile updated',
    message,
    actor: workflowActor(request),
    href: `admin:Applicants:${application.id}`,
    portalHref: 'portal:application',
    entityType: 'application',
    entityId: application.id,
    applicationId: application.id,
    applicantOnly: true,
  });
  await syncHubDirectoryDetailsToErp(application, request);
  return { application, message, changes };
}

function paymentIsPaid(application, key) { return application?.payments?.some((payment) => payment.key === key && payment.status === 'paid'); }
function brandingUnlocked(application) {
  if (application.franchise_model === 'FOFO') return territoryAllotted(application) && paymentIsPaid(application, 'fofo_one_time_fee');
  ensureOnboardingModules(application, { territoryAllotted, paymentIsPaid });
  return territoryAllotted(application) && Boolean(application.onboarding_modules?.branding_released);
}
function hrUnlocked(application) {
  if (application.franchise_model !== 'FOCO') return false;
  ensureOnboardingModules(application, { territoryAllotted, paymentIsPaid });
  return territoryAllotted(application) && Boolean(application.onboarding_modules?.hr_released);
}

function resolvePaymentPricing(application, payment, couponCode, options = {}) {
  const originalAmount = Number(options.amount_override ?? payment.original_amount ?? payment.amount ?? 0);
  let couponResult = null;
  const rawCouponCode = text(couponCode, 40);
  if (rawCouponCode) {
    couponResult = validateCouponForPayment(database, application, payment, rawCouponCode, new Date(), {
      amount_override: originalAmount,
      payment_key: options.payment_key ?? payment.key,
      foco_full: options.foco_full,
    });
    if (!couponResult.valid) return couponResult;
  }
  const pricing = couponResult?.valid
    ? { original_amount: couponResult.original_amount, discount_amount: couponResult.discount_amount, final_amount: couponResult.final_amount, coupon_code: couponResult.coupon.code, coupon_id: couponResult.coupon.id }
    : { original_amount: originalAmount, discount_amount: 0, final_amount: originalAmount, coupon_code: '', coupon_id: '' };
  return { valid: true, pricing, couponResult };
}

function applyApplicationStageAfterPayment(application, payment, request, focoFull = false) {
  application.visible_to_admin = true;
  if (focoFull || (payment.foco_full_payment && focoAllPaymentsPaid(application))) {
    application.stage = 'payment_3_received';
    applicationReviewHistory(application, 'foco_full_payment_received', 'FOCO complete franchise amount received. All payment phases are now marked as paid.', request);
    return;
  }
  if (application.franchise_model === 'FOFO') application.stage = 'payment_1_received';
  else if (payment.key === 'application_fee') application.stage = 'payment_1_received';
  else if (payment.key === 'franchise_fee') {
    application.stage = 'payment_2_received';
    applicationReviewHistory(application, 'foco_phase_2_payment_received', 'FOCO Phase 2 franchise fee received. Onboarding modules remain under separate manager control.', request);
  } else if (payment.key === 'security_deposit') {
    application.stage = 'payment_3_received';
    applicationReviewHistory(application, 'foco_phase_3_payment_received', 'FOCO security deposit received. Final agreement and onboarding can now proceed.', request);
  }   else application.stage = 'payment_3_received';
}

function hubActivationMilestone(application, payment) {
  if (!payment || payment.status !== 'paid') return false;
  if (String(process.env.RFMS_HUB_ACTIVATE_ON_PAY || '1').trim() === '0') return false;
  if (application.hec_hub_activated_at) return false;
  const key = String(payment.key || '');
  if (application.franchise_model === 'FOFO') return key === 'fofo_one_time_fee';
  if (payment.foco_full_payment) return true;
  return key === 'security_deposit';
}

function depositAmountForHubActivation(application, payment) {
  if (payment?.foco_full_payment) {
    const deposit = application.payments?.find((item) => item.key === 'security_deposit');
    return Number(deposit?.amount ?? payment.amount) || 0;
  }
  if (payment?.key === 'security_deposit' || payment?.key === 'fofo_one_time_fee') {
    return Number(payment.amount) || 0;
  }
  return Number(payment?.amount) || 0;
}

function onboardedFocoCentres() {
  const helpers = franchiseeDirectoryHelpers();
  return onboardedFranchiseeApplications()
    .filter((item) => String(item.franchise_model || '').toUpperCase() === 'FOCO')
    .map((application) => {
      const row = franchiseeDirectoryListItem(application, helpers);
      return {
        parent_foco_id: String(application.hec_franchisee_profile || row.franchisee_id || '').trim(),
        franchisee_id: row.franchisee_id,
        application_id: row.application_id,
        franchise_name: row.business_name || row.franchisee_name || application.full_name,
        franchise_code: row.franchisee_id,
        address: [row.territory, row.location].filter(Boolean).join(' · '),
        district: row.district || '',
        pincode: row.pincode || '',
        onboarding_status: row.current_status || 'Onboarded',
      };
    })
    .filter((item) => item.parent_foco_id || item.franchisee_id);
}

async function maybeSyncFofoParentFoco(application, request, { actor = '' } = {}) {
  if (!application || String(application.franchise_model || '').toUpperCase() !== 'FOFO') return null;
  const parentFoco = String(application.parent_foco_id || '').trim();
  const fofoId = String(application.hec_franchisee_profile || '').trim();
  if (!parentFoco || !fofoId) return null;
  try {
    const result = await mapFofoParentFocoViaErp({
      applicationId: application.id,
      applicationNumber: application.application_number,
      fofoFranchisee: fofoId,
      parentFoco,
    });
    application.parent_foco_mapped_at = new Date().toISOString();
    application.parent_foco_error = '';
    applicationReviewHistory(
      application,
      'fofo_mapped_under_foco',
      `FOFO permanently mapped under FOCO ${application.parent_foco_name || parentFoco}.`,
      request,
      actor || reviewActor(request),
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FOFO→FOCO map failed.';
    application.parent_foco_error = message.slice(0, 500);
    console.error('[phase111] FOFO parent FOCO map failed', application.application_number, message);
    return null;
  }
}

async function maybeActivateFranchiseeHub(application, payment, request) {
  if (!hubActivationMilestone(application, payment)) return null;
  const fields = hubDirectoryFieldsFromApplication(application);
  try {
    const result = await activateRfmsPaidFranchiseeViaErp({
      applicationId: fields.applicationId,
      applicationNumber: fields.applicationNumber,
      businessName: fields.businessName,
      depositAmount: depositAmountForHubActivation(application, payment),
      district: fields.district,
      email: fields.email,
      franchiseModel: fields.franchiseModel,
      franchiseeProfile: fields.franchiseeProfile,
      fullName: fields.fullName,
      mobile: fields.mobile,
      paymentKey: payment.key || '',
      pincode: fields.pincode,
      preferredLocation: fields.preferredLocation,
      registeredAddress: fields.registeredAddress,
      territoryRegion: fields.territoryRegion,
    });
    const franchiseeId = String(result?.franchisee_id || '').trim();
    if (franchiseeId) application.hec_franchisee_profile = franchiseeId;
    application.hec_hub_activated_at = new Date().toISOString();
    application.hec_wallet_recharge = Number(result?.wallet_recharge) || 0;
    application.hec_hub_activation_error = '';
    await maybeSyncFofoParentFoco(application, request);
    applicationReviewHistory(
      application,
      'franchisee_hub_activated',
      `Franchisee hub ${franchiseeId || 'profile'} activated as ${result?.franchise_name || fields.businessName || application.full_name}${result?.wallet_recharge ? ` with opening wallet ₹${result.wallet_recharge}` : ''}.`,
      request,
    );
    workflowNotify({
      module: 'payments',
      action: 'franchisee_hub_activated',
      title: 'Franchisee hub activated',
      message: `${fields.businessName || application.full_name} · hub ${franchiseeId || 'created'} after ${payment.label || payment.key}.`,
      actor: workflowActor(request),
      href: `admin:Payments:${application.id}`,
      entityType: 'application',
      entityId: application.id,
      applicationId: application.id,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Franchisee hub activation failed.';
    application.hec_hub_activation_error = message.slice(0, 500);
    console.error('[phase85c] hub activation failed', application.application_number, message);
    applicationReviewHistory(application, 'franchisee_hub_activation_failed', message, request);
    return null;
  }
}

async function finalizeVerifiedPayment(application, payment, request, couponResult = null) {
  if (couponResult?.valid || (payment.coupon_code && payment.coupon_id)) {
    const coupon = couponResult?.coupon ?? database.coupons.find((item) => item.id === payment.coupon_id);
    if (coupon) {
      recordCouponUsage(database, {
        coupon,
        application,
        payment,
        pricing: {
          original_amount: payment.original_amount ?? payment.amount,
          discount_amount: payment.discount_amount ?? 0,
          final_amount: payment.amount,
        },
        receiptNumber: payment.receipt_number,
        transactionNumber: payment.transaction_number,
      });
    }
  }
  applyApplicationStageAfterPayment(application, payment, request, payment.foco_full_payment);
  applicationReviewHistory(application, payment.payment_method === 'gateway' ? 'gateway_payment_received' : 'payment_verified', `${payment.label} marked as paid.`, request);
  workflowNotify({
    module: 'payments',
    action: 'payment_verified',
    title: 'Payment verified',
    message: `${application.full_name} · ${payment.label} is now marked as paid.`,
    actor: workflowActor(request),
    href: `admin:Payments:${application.id}`,
    entityType: 'application',
    entityId: application.id,
    applicationId: application.id,
  });
  application.updated_at = new Date().toISOString();
  if (payment.key === 'application_fee') automaticallyReserveMatchingTerritory(application);
  await maybeActivateFranchiseeHub(application, payment, request);
  await maybeCreateReachFocoB2bOnPhase1(application, payment, request);
}

function paymentsPendingVerification(application, payment) {
  const bundleReference = payment.bundle_reference;
  if (bundleReference) {
    return application.payments.filter((item) => item.bundle_reference === bundleReference && item.status === 'under_verification');
  }
  return payment.status === 'under_verification' ? [payment] : [];
}

async function verifyPaymentRecord(application, payment, request) {
  const actor = reviewActor(request);
  const targets = paymentsPendingVerification(application, payment);
  if (!targets.length) return { error: 'PAYMENT_NOT_PENDING', message: 'This payment is not awaiting verification.' };
  for (const item of targets) {
    markPaymentPaid(item, item.payment_method || item.submission?.method || 'cheque', { verified_by: actor });
  }
  const primary = targets[0];
  for (const item of targets) {
    if (item.coupon_code && item.coupon_id) {
      const coupon = database.coupons.find((entry) => entry.id === item.coupon_id);
      if (coupon) {
        recordCouponUsage(database, {
          coupon,
          application,
          payment: item,
          pricing: {
            original_amount: item.original_amount ?? item.amount,
            discount_amount: item.discount_amount ?? 0,
            final_amount: item.amount,
          },
          receiptNumber: item.receipt_number,
          transactionNumber: item.transaction_number,
        });
      }
    }
  }
  applyApplicationStageAfterPayment(application, primary, request, Boolean(primary.foco_full_payment || targets.length > 1));
  applicationReviewHistory(application, 'payment_verified', `${primary.foco_full_payment ? 'FOCO complete franchise amount' : primary.label} marked as paid after verification.`, request);
  workflowNotify({
    module: 'payments',
    action: 'payment_verified',
    title: 'Payment verified',
    message: `${application.full_name} · ${primary.foco_full_payment ? 'FOCO complete franchise amount' : primary.label} is now marked as paid.`,
    actor: workflowActor(request),
    href: `admin:Payments:${application.id}`,
    entityType: 'application',
    entityId: application.id,
    applicationId: application.id,
  });
  application.updated_at = new Date().toISOString();
  if (primary.key === 'application_fee' || primary.foco_full_payment) automaticallyReserveMatchingTerritory(application);
  if (application.franchise_model === 'FOCO' && !primary.foco_full_payment) {
    recalculateFocoRemainingPhases(application, { actor: reviewActor(request) });
  }
  await maybeActivateFranchiseeHub(application, primary, request);
  await maybeCreateReachFocoB2bOnPhase1(application, primary, request);
  return { payment: primary, verified_count: targets.length };
}

async function rejectPaymentRecord(application, payment, remarks, request) {
  const actor = reviewActor(request);
  const targets = paymentsPendingVerification(application, payment);
  if (!targets.length) return { error: 'PAYMENT_NOT_PENDING', message: 'This payment is not awaiting verification.' };
  for (const item of targets) rejectPaymentSubmission(item, remarks, actor);
  const primary = targets[0];
  applicationReviewHistory(application, 'payment_rejected', `${primary.foco_full_payment ? 'FOCO complete franchise amount submission' : primary.label} rejected.${text(remarks, 2000) ? ` Note: ${text(remarks, 2000)}` : ''}`, request);
  workflowNotify({
    module: 'payments',
    action: 'payment_rejected',
    title: 'Payment submission rejected',
    message: `${application.full_name} · ${primary.label} requires a corrected payment submission.`,
    actor: workflowActor(request),
    href: `admin:Payments:${application.id}`,
    entityType: 'application',
    entityId: application.id,
    applicationId: application.id,
  });
  application.updated_at = new Date().toISOString();
  return { payment: primary, rejected_count: targets.length };
}

function assertPaymentTerms(application, payment) {
  if (!application.terms_accepted_at && payment.key !== 'franchise_fee' && !payment.foco_full_payment) {
    return `Read and accept the ${application.franchise_model} franchise terms and conditions before payment.`;
  }
  if (payment.key === 'franchise_fee' && !territoryAllotted(application) && !payment.foco_full_payment) {
    return 'The manager must issue the Territory Allotment Letter before the FOCO second payment can be completed.';
  }
  if (payment.key === 'franchise_fee' && !application.payment_terms?.franchise_fee?.accepted_at && !payment.foco_full_payment) {
    return 'Read and accept the FOCO Phase 2 payment terms and conditions before payment.';
  }
  if (payment.key === 'security_deposit' && !application.payment_terms?.security_deposit?.accepted_at && !payment.foco_full_payment) {
    return 'Read and accept the FOCO Phase 3 payment terms and conditions before payment.';
  }
  return '';
}

function fieldVisitAudit(application, visit, type, message, request, actorName = '') {
  const entry = { id: randomUUID(), type, message, actor: actorName || reviewActor(request), created_at: new Date().toISOString() };
  visit.history = Array.isArray(visit.history) ? visit.history : [];
  visit.history.push(entry);
  visit.history = visit.history.slice(-100);
  applicationReviewHistory(application, type, message, request, actorName);
}

function completedVideoKyc(application) {
  return videoKycSessionsFor(application).some((session) => session.status === 'completed');
}

function videoKycSessionSummary(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    id: session.id,
    attempt: Number(session.attempt) || 1,
    status: session.status || 'assigned',
    assigned_at: session.assigned_at || '',
    assigned_by: session.assigned_by || '',
    started_at: session.started_at || '',
    started_by: session.started_by || '',
    applicant_joined_at: session.applicant_joined_at || '',
    completed_at: session.completed_at || '',
    completed_by: session.completed_by || '',
    remarks: session.remarks || '',
    reassigned_from: session.reassigned_from || '',
    screenshots: Array.isArray(session.screenshots) ? session.screenshots.map((shot) => ({ id: shot.id, url: shot.url, name: shot.name, captured_at: shot.captured_at, captured_by: shot.captured_by })) : [],
    history: Array.isArray(session.history) ? session.history.slice(-50) : [],
  };
}

function videoKycSessionRecord(sessionId) {
  for (const application of database.applications) {
    const session = videoKycSessionsFor(application).find((item) => item.id === sessionId);
    if (session) return { application, session };
  }
  return null;
}

function videoKycAudit(application, session, type, message, request) {
  const entry = { id: randomUUID(), type, message, actor: reviewActor(request), created_at: new Date().toISOString() };
  session.history = Array.isArray(session.history) ? session.history : [];
  session.history.push(entry);
  session.history = session.history.slice(-100);
  applicationReviewHistory(application, type, message, request);
}

function allApplicationDocumentsVerified(application) {
  return [...applicationDocumentKinds].every((kind) => documentIsVerified(application, kind));
}

function videoKycScreenshotData(value) {
  const file = applicationDocumentData(value);
  return file && file.mime.startsWith('image/') ? file : null;
}

function videoKycAccess(request, application) {
  return requireOfficer(request) || applicantFor(request)?.id === application.id;
}

function videoKycParticipant(request, application) {
  return applicantFor(request)?.id === application.id ? 'applicant' : requireOfficer(request) ? 'manager' : '';
}

function nextApplicationAction(application) {
  if (application.franchise_model === 'FOFO' && application.stage === 'payment_1_received') return { label: 'Verify documents and begin onboarding', stage: 'onboarding_initiated' };
  if (application.franchise_model === 'FOFO' && application.stage === 'onboarding_initiated') return { label: 'Mark onboarding complete and go live', stage: 'onboarding_completed' };
  if (application.franchise_model === 'FOCO' && application.stage === 'payment_1_received') return null;
  if (application.franchise_model === 'FOCO' && application.stage === 'payment_2_received') return { label: 'Approve onboarding and request security deposit', stage: 'security_deposit_due', unlock: 'security_deposit' };
  if (application.franchise_model === 'FOCO' && application.stage === 'agreement_and_onboarding') return { label: 'Mark onboarding complete and go live', stage: 'onboarding_completed' };
  return null;
}

function syncApplicationTerritoryStatus(application) {
  if (!application?.territory_id) return;
  const territory = database.territories.find((item) => item.id === application.territory_id);
  const allocation = territory?.allocations.find((item) => item.application_id === application.id);
  if (!territory || !allocation) return;
  const nextStatus = ['onboarding_completed', 'go_live', 'active'].includes(application.stage) ? 'occupied' : 'reserved';
  if (allocation.status !== nextStatus) {
    allocation.status = nextStatus;
    allocation.updated_at = new Date().toISOString();
    territory.updated_at = allocation.updated_at;
  }
}

function automaticallyReserveMatchingTerritory(application) {
  if (!application || application.territory_id || !['FOFO', 'FOCO'].includes(application.franchise_model)) return null;
  const pincode = text(application.pincode, 10).replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(pincode)) return null;
  const eligible = database.territories.filter((territory) => territory.pincodes.includes(pincode) && allocationCountsForPin(territory, pincode, application.franchise_model).available > 0);
  if (eligible.length !== 1) return null;
  const territory = eligible[0];
  territory.allocations.push(territoryAllocation({
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    pincode,
    franchise_model: application.franchise_model,
    status: 'reserved',
  }));
  territory.updated_at = new Date().toISOString();
  application.territory_id = territory.id;
  application.territory_label = territoryLabel(territory);
  application.territory_pincode = pincode;
  return territory;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function contactValue(channel, value) {
  if (channel === 'mobile') return text(value, 20).replace(/\D/g, '');
  return text(value, 160).toLowerCase();
}

function validContact(channel, value) {
  return channel === 'mobile' ? /^[6-9]\d{9}$/.test(value) : channel === 'email' && isEmail(value);
}

function maskedContact(channel, value) {
  if (channel === 'mobile') return `******${value.slice(-4)}`;
  const [name, domain] = value.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(3, name.length - 2))}@${domain}`;
}

function verifiedContact(token, channel, value) {
  const verification = contactVerificationTokens.get(text(token, 100));
  return Boolean(verification && !verification.used && verification.expires_at > Date.now() && verification.channel === channel && verification.value === value);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function serveStaticApplication(request, response, outputDirectory) {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  const requestedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
  const candidates = [requestedPath];
  if (!path.extname(requestedPath)) candidates.push(`${requestedPath}.html`, `${requestedPath}/index.html`);

  for (const candidate of candidates) {
    const filePath = path.resolve(outputDirectory, `.${candidate}`);
    if (!filePath.startsWith(`${outputDirectory}${path.sep}`)) {
      response.writeHead(403); response.end(); return;
    }
    try {
      const content = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': candidate.startsWith('/_next/') ? 'public, max-age=3600' : 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
      return;
    } catch {
      // Try the next static export path.
    }
  }

  const missingBuildMessage = staticOutputSuffix
    ? 'RFMS isolated website build was not found. Close RFMS Isolated Services and run start-isolated.cmd again.'
    : 'RFMS website build was not found. Run run-api.cmd again.';
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(missingBuildMessage);
}

async function serveFranchiseWebpagePublic(request, response, slug) {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  const webpage = franchiseWebpageBySlug(decodeURIComponent(slug));
  if (!webpage || webpage.enabled === false) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Franchise webpage not found.'); return; }
  await regenerateFranchiseWebpage(webpage);
  try {
    const content = await readFile(path.join(uploadsDirectory, path.basename(webpage.html_url)));
    cors(request, response);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    const html = renderFranchiseWebpageHtml(webpage.settings, { publicBaseUrl: receiptValidationBaseUrl });
    cors(request, response);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : html);
  }
}

async function serveUpload(request, response, route) {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  const filename = path.basename(route.replace(/^\/uploads\//, ''));
  if (!filename || filename !== route.replace(/^\/uploads\//, '')) { response.writeHead(404); response.end(); return; }
  try {
    const filePath = path.join(uploadsDirectory, filename);
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end(); }
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') return send(request, response, 204, {});
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const route = url.pathname;

  try {
    await syncApplicationsFromDiskIfChanged();
    const franchiseSiteMatch = route.match(/^\/franchise-sites\/([^/]+)$/);
    if (franchiseSiteMatch && ['GET', 'HEAD'].includes(request.method ?? 'GET')) return serveFranchiseWebpagePublic(request, response, franchiseSiteMatch[1]);
    if (route.startsWith('/uploads/')) return serveUpload(request, response, route);
    if (request.method === 'GET' && route === '/api/v1/health') {
      return success(request, response, {
        service: 'rfms-local-api',
        status: 'ok',
        isolated: staticOutputSuffix === 'isolated',
        agreement_execution_routes: { manual_execute: true, save_executed: true },
        cgpey_aadhaar_otp: (() => {
          try {
            // Sync snapshot from env; ERP-backed status is refreshed on Accept Agreement.
            const cfg = cgpeyConfigFromEnv();
            return { configured: cgpeyConfigured(cfg), simulate: cgpeySimulate(cfg), source: 'env_or_erp' };
          } catch {
            return { configured: false, simulate: false, source: 'unknown' };
          }
        })(),
        hec_bridge: Boolean(process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET),
        phase83_erp_bridge: true,
        phase84_wb_geo: true,
        phase86_franchise_ads: Boolean(process.env.FRANCHISE_ADS_WEBHOOK_SECRET || process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET),
        phase87_whatsapp_cloud: Boolean(process.env.WHATSAPP_CLOUD_WEBHOOK_SECRET || process.env.ONBOARD_HMAC_SECRET || process.env.HEC_ONBOARD_HMAC_SECRET),
      });
    }

    if (request.method === 'GET' && route === '/api/v1/integrations/public-config') {
      try {
        const config = await getRfmsIntegrationConfigCached();
        return success(request, response, publicIntegrationConfigPayload(config));
      } catch (error) {
        return failure(
          request,
          response,
          'INTEGRATION_CONFIG_UNAVAILABLE',
          error instanceof Error ? error.message : 'Unable to load ERP integration config.',
          502,
        );
      }
    }

    if (request.method === 'GET' && route === '/api/v1/geo/wb-hierarchy') {
      try {
        const force = String(url.searchParams.get('refresh') || '') === '1';
        const data = await getWbGeoHierarchyCached({ force });
        return success(request, response, data);
      } catch (error) {
        return failure(
          request,
          response,
          'WB_GEO_UNAVAILABLE',
          error instanceof Error ? error.message : 'Unable to load West Bengal geo hierarchy from ERP.',
          502,
        );
      }
    }

    if (request.method === 'GET' && route.startsWith('/api/v1/geo/pincode/')) {
      try {
        const pin = decodeURIComponent(route.slice('/api/v1/geo/pincode/'.length)).replace(/\D/g, '').slice(0, 6);
        if (!/^\d{6}$/.test(pin)) {
          return failure(request, response, 'VALIDATION_ERROR', 'Enter a valid 6-digit PIN code.', 400);
        }
        const data = await resolveWbPincodeViaErp(pin);
        return success(request, response, data);
      } catch (error) {
        return failure(
          request,
          response,
          'WB_PIN_RESOLVE_FAILED',
          error instanceof Error ? error.message : 'Unable to resolve PIN against ERP directory.',
          502,
        );
      }
    }

    if (request.method === 'GET' && route === '/api/v1/admin/integrations/maps-key') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can load Maps configuration.', 403);
      try {
        const config = await getRfmsIntegrationConfigCached();
        return success(request, response, {
          google_maps_api_key: String(config.google_maps_api_key || ''),
          google_maps_configured: Boolean(config.google_maps_configured),
        });
      } catch (error) {
        return failure(
          request,
          response,
          'MAPS_CONFIG_UNAVAILABLE',
          error instanceof Error ? error.message : 'Unable to load Google Maps key from ERP.',
          502,
        );
      }
    }

    // Mother ERP HMAC handoff → create FFMS lead, open application form (applicant picks FOFO/FOCO)
    if (request.method === 'GET' && (route === '/hec-session' || route === '/api/v1/hec-session')) {
      try {
        const token = text(url.searchParams.get('token') ?? '', 4000);
        if (!token) return failure(request, response, 'VALIDATION_ERROR', 'token query parameter is required.', 400);
        const claims = verifyHecToken(token);
        const lead = await ensureHecLinkedLead(claims);
        const params = new URLSearchParams({
          hec_lead: lead.id,
          hec_fp: String(claims.fp || ''),
        });
        if (lead.name) params.set('name', lead.name);
        if (lead.email && !String(lead.email).includes('@hec.local')) params.set('email', lead.email);
        if (lead.mobile && lead.mobile !== '0000000000') params.set('mobile', lead.mobile);
        if (lead.territory_query) params.set('location', lead.territory_query);
        const redirectTo = `${portalBaseUrl}/?${params.toString()}`;
        cors(request, response);
        response.writeHead(302, { Location: redirectTo });
        response.end();
        return;
      } catch (error) {
        return failure(request, response, 'HEC_SESSION_INVALID', error instanceof Error ? error.message : 'Invalid HEC session token.', 401);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/admin/system/reload-data') {
      if (!requireAdmin(request)) return failure(request, response, 'FORBIDDEN', 'Only a super administrator can reload local RFMS data.', 403);
      await reloadDatabaseFromDisk();
      return success(request, response, { message: 'Local RFMS data reloaded from disk.' });
    }

    if (request.method === 'GET' && route === '/api/v1/territories/availability') {
      const query = text(url.searchParams.get('query') ?? '', 180);
      if (!query) return failure(request, response, 'VALIDATION_ERROR', 'Enter a district, area or six-digit PIN code to check availability.');
      const result = availabilityForQuery(query);
      if (!result.pins.length) return success(request, response, { query, match_found: false, scope: 'search', place: query, fofo_available: 0, foco_available: 0, territories: [], pincodes: [] });
      const metrics = pinMetrics(result.pins);
      return success(request, response, {
        query, match_found: true, scope: result.scope, place: result.place,
        fofo_available: metrics.fofo_available, foco_available: metrics.foco_available,
        territories: result.territories.map((territory) => territorySummary(territory, false)),
        pincodes: result.pins,
      });
    }

    if (request.method === 'GET' && route === '/api/v1/territories/pincodes') {
      const model = text(url.searchParams.get('model') ?? '', 10).toUpperCase();
      const query = text(url.searchParams.get('query') ?? '', 180).toLowerCase();
      const records = publicPinRecords().filter((item) => {
        const modelAvailable = model === 'FOFO' ? item.fofo.available : model === 'FOCO' ? item.foco.available : true;
        const searchable = [item.pincode, item.area, item.subdivision, item.district, item.state].join(' ').toLowerCase();
        return modelAvailable && (!query || searchable.includes(query));
      });
      return success(request, response, { model: ['FOFO', 'FOCO'].includes(model) ? model : '', pincodes: records });
    }

    if (request.method === 'POST' && route === '/api/v1/auth/login') {
      const body = await readJson(request);
      const loginId = text(body.login_id ?? body.employee_id ?? body.email ?? body.username ?? '', 160);
      const account = accountFor(loginId, body.password);
      if (!account || (body.role_type && body.role_type !== 'officer')) {
        return failure(request, response, 'INVALID_CREDENTIALS', 'Invalid company ID or password.', 401);
      }
      return success(request, response, await issueOfficerSession(account, { via: 'password' }));
    }

    if (request.method === 'POST' && route === '/api/v1/auth/otp/request') {
      return failure(
        request,
        response,
        'OTP_DISABLED',
        'Officer OTP login is disabled. Sign in with your company ID and password.',
        410,
      );
    }

    if (request.method === 'POST' && route === '/api/v1/auth/otp/verify') {
      return failure(
        request,
        response,
        'OTP_DISABLED',
        'Officer OTP login is disabled. Sign in with your company ID and password.',
        410,
      );
    }

    if (request.method === 'GET' && route === '/api/v1/auth/me') {
      const session = sessionFor(request);
      if (!session) return failure(request, response, 'UNAUTHORIZED', 'Sign in to continue.', 401);
      const role = normalizeRole(session.role);
      return success(request, response, {
        id: session.user_id ?? session.mobile,
        employee_id: session.employee_id ?? '',
        name: session.name,
        role,
        email: session.email ?? '',
        allowed_pages: pagesForRole(role),
      });
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/auth/otp/request') {
      const body = await readJson(request);
      const credentialKind = applicantCredentialKind(body.identifier);
      if (credentialKind === 'receipt') return failure(request, response, 'INVALID_REGISTRATION_NUMBER', 'Enter your RFMS application registration number (for example RFMS-2026-0148), not an RCP payment receipt number.');
      if (credentialKind === 'user_id') return failure(request, response, 'USE_PASSWORD_LOGIN', 'Sign in with your user ID and password, then verify the OTP sent to your registered mobile number.', 422);
      if (credentialKind === 'unknown') return failure(request, response, 'VALIDATION_ERROR', 'Enter your mobile number, registration number or email address.', 422);
      const application = applicantByIdentifier(body.identifier, { includeUserId: false, includeMobile: true });
      if (!application) return failure(request, response, 'APPLICATION_NOT_FOUND', applicantNotFoundMessage(), 404);
      try {
        const delivery = await dispatchMobileOtp(application.mobile);
        const challengeId = randomUUID();
        applicantChallenges.set(challengeId, {
          application_id: application.id,
          mobile: delivery.mobile,
          expires_at: Date.now() + 300_000,
          method: 'otp',
          credential_kind: credentialKind,
        });
        return success(request, response, {
          challenge_id: challengeId,
          masked_mobile: maskedApplicantMobile(delivery.mobile),
          credential_kind: credentialKind,
          ...otpDeliveryMeta(delivery),
        });
      } catch (otpError) {
        return failure(request, response, 'OTP_SEND_FAILED', otpError instanceof Error ? otpError.message : 'Could not send OTP.', 502);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/auth/otp/verify') {
      const body = await readJson(request);
      const challenge = applicantChallenges.get(text(body.challenge_id, 100));
      if (!challenge || challenge.expires_at < Date.now()) return failure(request, response, 'OTP_INVALID', 'The OTP is incorrect or has expired.', 401);
      try {
        await confirmMobileOtp(challenge.mobile, body.otp);
      } catch (otpError) {
        return failure(request, response, 'OTP_INVALID', otpError instanceof Error ? otpError.message : 'The OTP is incorrect or has expired.', 401);
      }
      const application = database.applications.find((item) => item.id === challenge.application_id);
      applicantChallenges.delete(text(body.challenge_id, 100));
      if (!application) return failure(request, response, 'APPLICATION_NOT_FOUND', 'Application not found.', 404);
      const session = await applicantSession(application);
      return success(request, response, { token: session.token, application: applicationSummary(application), user: { name: application.full_name, role: 'applicant' } });
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/auth/password') {
      const body = await readJson(request);
      const credentialKind = applicantCredentialKind(body.identifier);
      if (credentialKind === 'mobile') return failure(request, response, 'USE_MOBILE_OTP', 'Sign in with your registered mobile number on the Mobile / Registration / Email OTP tab.', 422);
      if (credentialKind === 'unknown') return failure(request, response, 'VALIDATION_ERROR', 'Enter your registration number, email address or user ID.', 422);
      const application = applicantByIdentifier(body.identifier);
      if (!application || !passwordMatches(application, body.password)) return failure(request, response, 'INVALID_CREDENTIALS', 'The registration number, email address, user ID or password is incorrect.', 401);
      try {
        const delivery = await dispatchMobileOtp(application.mobile);
        const challengeId = randomUUID();
        applicantChallenges.set(challengeId, {
          application_id: application.id,
          mobile: delivery.mobile,
          expires_at: Date.now() + 300_000,
          method: 'password_otp',
          credential_kind: credentialKind,
        });
        return success(request, response, {
          challenge_id: challengeId,
          masked_mobile: maskedApplicantMobile(delivery.mobile),
          credential_kind: credentialKind,
          ...otpDeliveryMeta(delivery),
        });
      } catch (otpError) {
        return failure(request, response, 'OTP_SEND_FAILED', otpError instanceof Error ? otpError.message : 'Could not send OTP.', 502);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/account/password') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'FORBIDDEN', 'Sign in to change your password.', 403);
      const body = await readJson(request);
      const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
      const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
      const confirmPassword = typeof body.confirm_password === 'string' ? body.confirm_password : '';
      if (application.account_password_hash && !passwordMatches(application, currentPassword)) return failure(request, response, 'CURRENT_PASSWORD_INCORRECT', 'Your current password is incorrect.', 400);
      if (newPassword !== confirmPassword) return failure(request, response, 'PASSWORD_CONFIRMATION_MISMATCH', 'The new password and confirmation do not match.', 400);
      const details = passwordDetails(newPassword);
      if (!details) return failure(request, response, 'PASSWORD_INVALID', 'Choose a password between 8 and 128 characters.', 400);
      application.account_password_salt = details.salt;
      application.account_password_hash = details.hash;
      application.updated_at = new Date().toISOString();
      applicationReviewHistory(application, 'applicant_password_updated', 'Applicant password updated from the profile settings page.', request);
      await saveDatabase();
      return success(request, response, { message: 'Your password has been changed successfully.' });
    }

    if (request.method === 'PATCH' && route === '/api/v1/applicant/account/profile') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'FORBIDDEN', 'Sign in to update your profile.', 403);
      const body = await readJson(request);
      const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
      const requestedUserId = text(body.user_id, 40).toLowerCase();
      const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
      const confirmPassword = typeof body.confirm_password === 'string' ? body.confirm_password : '';
      const currentUserId = String(application.user_id ?? '').toLowerCase();
      const userIdChanging = Boolean(requestedUserId) && requestedUserId !== currentUserId;
      const passwordChanging = Boolean(newPassword || confirmPassword);
      if (!userIdChanging && !passwordChanging) return failure(request, response, 'NO_CHANGES', 'Enter a new user ID or password to update your profile.', 400);
      if (!currentPassword) return failure(request, response, 'CURRENT_PASSWORD_REQUIRED', 'Enter your current password to save profile changes.', 400);
      if (!passwordMatches(application, currentPassword)) return failure(request, response, 'CURRENT_PASSWORD_INCORRECT', 'Your current password is incorrect.', 400);
      if (userIdChanging) {
        if (!/^[a-z0-9._-]{4,40}$/.test(requestedUserId)) return failure(request, response, 'USER_ID_INVALID', 'Choose a user ID with 4-40 lowercase letters, numbers, dots, underscores or hyphens.', 400);
        if (database.applications.some((item) => item.id !== application.id && item.user_id?.toLowerCase() === requestedUserId)) return failure(request, response, 'USER_ID_TAKEN', 'This user ID is already registered to another applicant.', 409);
        application.user_id = requestedUserId;
        applicationReviewHistory(application, 'applicant_user_id_updated', `Applicant user ID updated to ${requestedUserId}.`, request);
      }
      if (passwordChanging) {
        if (newPassword !== confirmPassword) return failure(request, response, 'PASSWORD_CONFIRMATION_MISMATCH', 'The new password and confirmation do not match.', 400);
        const details = passwordDetails(newPassword);
        if (!details) return failure(request, response, 'PASSWORD_INVALID', 'Choose a password between 8 and 128 characters.', 400);
        application.account_password_salt = details.salt;
        application.account_password_hash = details.hash;
        applicationReviewHistory(application, 'applicant_password_updated', 'Applicant password updated from the profile settings page.', request);
      }
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, { message: 'Your profile has been updated successfully.', application: applicationSummary(application) });
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/auth/logout') {
      const session = sessionFor(request);
      if (session?.role === 'applicant') {
        tokens.delete(session.token);
        database.sessions = database.sessions.filter((item) => item.token !== session.token);
        await saveDatabase();
      }
      return success(request, response, { logged_out: true });
    }

    if (request.method === 'POST' && route === '/api/v1/auth/logout') {
      const session = sessionFor(request);
      if (session && session.role !== 'applicant') {
        tokens.delete(session.token);
        database.sessions = database.sessions.filter((item) => item.token !== session.token);
        await saveDatabase();
      }
      return success(request, response, { logged_out: true });
    }

    if (request.method === 'GET' && route === '/api/v1/notifications/unread-count') {
      const session = sessionFor(request);
      if (!session) return failure(request, response, 'UNAUTHORIZED', 'Sign in to continue.', 401);
      const { recipientType, recipientId } = notificationRecipient(session);
      return success(request, response, { unread_count: unreadNotificationCount(ensureNotificationsArray(), recipientType, recipientId) });
    }

    if (request.method === 'GET' && route === '/api/v1/notifications') {
      const session = sessionFor(request);
      if (!session) return failure(request, response, 'UNAUTHORIZED', 'Sign in to continue.', 401);
      const { recipientType, recipientId } = notificationRecipient(session);
      const status = text(url.searchParams.get('status') ?? 'all', 20).toLowerCase();
      const allowedStatus = ['all', 'unread', 'read', 'archived'].includes(status) ? status : 'all';
      const items = notificationsForRecipient(ensureNotificationsArray(), recipientType, recipientId, allowedStatus).map(notificationSummary);
      return success(request, response, items);
    }

    if (request.method === 'POST' && route === '/api/v1/notifications/read-all') {
      const session = sessionFor(request);
      if (!session) return failure(request, response, 'UNAUTHORIZED', 'Sign in to continue.', 401);
      const { recipientType, recipientId } = notificationRecipient(session);
      const updated = markAllNotificationsRead(ensureNotificationsArray(), recipientType, recipientId);
      await saveDatabase();
      return success(request, response, { updated_count: updated });
    }

    const notificationMatch = route.match(/^\/api\/v1\/notifications\/([^/]+)$/);
    if (notificationMatch && request.method === 'PATCH') {
      const session = sessionFor(request);
      if (!session) return failure(request, response, 'UNAUTHORIZED', 'Sign in to continue.', 401);
      const body = await readJson(request);
      const nextStatus = text(body.status, 20).toLowerCase();
      const { recipientType, recipientId } = notificationRecipient(session);
      try {
        const updated = updateNotificationStatus(ensureNotificationsArray(), notificationMatch[1], recipientType, recipientId, nextStatus);
        if (!updated) return failure(request, response, 'NOT_FOUND', 'Notification not found.', 404);
        await saveDatabase();
        return success(request, response, updated);
      } catch (error) {
        return failure(request, response, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Unable to update notification.', 400);
      }
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/profile') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'FORBIDDEN', 'Sign in to view your applicant profile.', 403);
      if (application.stage === 'onboarding_completed' && !hasPartnerPortalCredentials(application)) {
        await ensurePartnerPortalCredentials(application, request, { actor: 'System' });
        await saveDatabase();
      }
      return success(request, response, applicationSummary(application));
    }

    const applicantDocumentReplaceMatch = route.match(/^\/api\/v1\/applicant\/documents\/(photo|pan|aadhaar|voter)$/);
    if (applicantDocumentReplaceMatch && request.method === 'POST') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'FORBIDDEN', 'Sign in to replace an application document.', 403);
      const kind = applicantDocumentReplaceMatch[1];
      if (!application.documents?.[kind]?.url) return failure(request, response, 'DOCUMENT_NOT_FOUND', 'This document is not available to replace.', 404);
      if (!documentUploadAgainRequested(application, kind)) return failure(request, response, 'REUPLOAD_NOT_REQUESTED', 'The RFMS team has not requested another upload for this document. You can upload a replacement only after they select Upload again.', 409);
      const body = await readJson(request, 7_500_000);
      const document = applicationDocumentData(body.data_url);
      if (!document || (kind === 'photo' && !document.mime.startsWith('image/'))) {
        return failure(request, response, 'VALIDATION_ERROR', 'Upload a valid replacement file. Photos must be images; KYC files may be PDF, PNG, JPG or WEBP, up to 5 MB.');
      }
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `application-${application.id}-${kind}-${Date.now()}-${randomUUID()}.${document.extension}`;
      application.documents[kind] = { kind, name: text(body.name, 180) || `${kind}.${document.extension}`, url: storedUploadUrl(filename) };
      await writeFile(path.join(uploadsDirectory, filename), document.bytes);
      application.document_verifications = application.document_verifications && typeof application.document_verifications === 'object' ? application.document_verifications : {};
      application.document_verifications[kind] = { status: 'pending', verified_at: '', verified_by: '' };
      applicationReviewHistory(application, 'document_reuploaded', `${kind === 'photo' ? 'Applicant photograph' : kind === 'pan' ? 'PAN card' : kind === 'aadhaar' ? 'Aadhaar card' : 'Voter ID card'} replaced by the applicant and sent back for review.`, request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const applicantOnboardingUploadMatch = route.match(/^\/api\/v1\/applicant\/onboarding-documents\/([^/]+)\/files$/);
    if (applicantOnboardingUploadMatch && request.method === 'POST') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'FORBIDDEN', 'Sign in to upload a requested onboarding document.', 403);
      const requestDocument = onboardingDocumentRecord(application, applicantOnboardingUploadMatch[1]);
      if (!requestDocument) return failure(request, response, 'NOT_FOUND', 'This onboarding document request was not found.', 404);
      const body = await readJson(request, 7_500_000);
      const uploaded = applicationDocumentData(body.data_url);
      const slot = Math.max(1, Math.floor(Number(body.slot) || 1));
      const requiredCount = Math.max(1, Number(requestDocument.required_count) || 1);
      if (!uploaded || slot > requiredCount) return failure(request, response, 'VALIDATION_ERROR', 'Upload a valid PDF, PNG, JPG or WEBP file for a requested document slot.', 400);
      requestDocument.files = Array.isArray(requestDocument.files) ? requestDocument.files : [];
      const current = requestDocument.files.find((file) => Number(file.slot) === slot && file.status !== 'superseded');
      if (current?.status === 'verified') return failure(request, response, 'DOCUMENT_LOCKED', 'This document slot has already been verified and cannot be replaced.', 409);
      if (current && current.status !== 'reupload_requested') return failure(request, response, 'DOCUMENT_ALREADY_UPLOADED', 'The current file is awaiting review. You can replace it only after the manager requests an upload again.', 409);
      if (current) current.status = 'superseded';
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `onboarding-${application.id}-${requestDocument.id}-${slot}-${Date.now()}-${randomUUID()}.${uploaded.extension}`;
      await writeFile(path.join(uploadsDirectory, filename), uploaded.bytes);
      const now = new Date().toISOString();
      requestDocument.files.push({ id: randomUUID(), slot, name: text(body.name, 180) || `supporting-document-${slot}.${uploaded.extension}`, url: storedUploadUrl(filename), status: 'pending', remarks: '', submitted_at: now, reviewed_at: '', reviewed_by: '', history: [{ id: randomUUID(), type: 'uploaded', message: 'Applicant uploaded this onboarding document for review.', actor: application.full_name, created_at: now }] });
      applicationReviewHistory(application, 'onboarding_document_uploaded', `${requestDocument.title} - file ${slot} was uploaded by the applicant for review.`, request);
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/field-visit/report') {
      const application = applicantFor(request);
      const visit = application?.field_visit;
      if (!application || !visit || visit.status !== 'approved') return failure(request, response, 'FIELD_VISIT_REPORT_UNAVAILABLE', 'A final Field Visit report is available after manager approval.', 409);
      const safeApplicationNumber = receiptText(application.application_number, 50).replace(/[^A-Za-z0-9_-]/g, '') || 'application';
      return sendPdf(request, response, `Remedium-Lab-Field-Visit-${safeApplicationNumber}.pdf`, await fieldVisitReportPdf(application, visit));
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/territory-allotment/report') {
      const application = applicantFor(request);
      const allotment = territoryAllotmentSummary(application?.territory_allotment) || territoryAllotmentsFor(application).at(-1);
      if (!application || !allotment) return failure(request, response, 'TERRITORY_ALLOTMENT_UNAVAILABLE', 'Your Territory Allotment Letter is available after the franchise team confirms the final territory.', 409);
      const safeApplicationNumber = receiptText(application.application_number, 50).replace(/[^A-Za-z0-9_-]/g, '') || 'application';
      return sendPdf(request, response, `Remedium-Lab-Territory-Allotment-${safeApplicationNumber}-v${allotment.version}.pdf`, await territoryAllotmentLetterPdf(application, allotment));
    }

    const applicantVideoKycJoinMatch = route.match(/^\/api\/v1\/applicant\/video-kyc\/([^/]+)\/join$/);
    if (applicantVideoKycJoinMatch && request.method === 'POST') {
      const application = applicantFor(request);
      const record = videoKycSessionRecord(applicantVideoKycJoinMatch[1]);
      if (!application || !record || record.application.id !== application.id) return failure(request, response, 'FORBIDDEN', 'Sign in to your own applicant profile to join Video KYC.', 403);
      if (record.session.status === 'assigned') return failure(request, response, 'VIDEO_KYC_NOT_STARTED', 'The manager has not started this Video KYC session yet.', 409);
      if (record.session.status !== 'in_progress') return failure(request, response, 'VIDEO_KYC_NOT_ACTIVE', 'This Video KYC session is no longer active.', 409);
      if (!record.session.applicant_joined_at) {
        record.session.applicant_joined_at = new Date().toISOString();
        videoKycAudit(application, record.session, 'video_kyc_applicant_joined', `${application.full_name} joined Video KYC attempt ${record.session.attempt}.`, request);
        application.updated_at = new Date().toISOString();
        await saveDatabase();
      }
      return success(request, response, { application: applicationSummary(application), session: videoKycSessionSummary(record.session) });
    }

    const applicantVideoKycReportMatch = route.match(/^\/api\/v1\/applicant\/video-kyc\/([^/]+)\/report$/);
    if (applicantVideoKycReportMatch && request.method === 'GET') {
      const application = applicantFor(request);
      const record = videoKycSessionRecord(applicantVideoKycReportMatch[1]);
      if (!application || !record || record.application.id !== application.id) return failure(request, response, 'FORBIDDEN', 'Sign in to your own applicant profile to download this Video KYC report.', 403);
      if (record.session.status !== 'completed') return failure(request, response, 'VIDEO_KYC_REPORT_UNAVAILABLE', 'A Video KYC report is available only after the manager completes the verification.', 409);
      const safeApplicationNumber = receiptText(application.application_number, 50).replace(/[^A-Za-z0-9_-]/g, '') || 'application';
      return sendPdf(request, response, `Remedium-Lab-Video-KYC-${safeApplicationNumber}-attempt-${Number(record.session.attempt) || 1}.pdf`, await videoKycReportPdf(application, record.session));
    }

    const publicFieldVisitMatch = route.match(/^\/api\/v1\/field-visits\/([A-Za-z0-9_-]+)$/);
    if (publicFieldVisitMatch && request.method === 'GET') {
      const application = database.applications.find((item) => item.field_visit?.secure_token === publicFieldVisitMatch[1]);
      const visit = application?.field_visit;
      if (!application || !visit) return failure(request, response, 'FIELD_VISIT_LINK_INVALID', 'This Field Visit submission link is invalid or has expired.', 404);
      return success(request, response, {
        application_number: application.application_number, applicant_name: application.full_name, franchise_model: application.franchise_model,
        preferred_location: application.preferred_location, pincode: application.pincode, field_visit: fieldVisitSummary(visit),
      });
    }

    if (publicFieldVisitMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.field_visit?.secure_token === publicFieldVisitMatch[1]);
      const visit = application?.field_visit;
      if (!application || !visit) return failure(request, response, 'FIELD_VISIT_LINK_INVALID', 'This Field Visit submission link is invalid or has expired.', 404);
      if (visit.status === 'approved') return failure(request, response, 'FIELD_VISIT_LOCKED', 'The manager has approved this Field Visit report and it is locked.', 409);
      const body = await readJson(request, 18_000_000);
      const visitDate = text(body.visit_date, 10);
      const inspectionSummary = text(body.inspection_summary, 5000);
      if (!isIsoDate(visitDate) || !inspectionSummary) return failure(request, response, 'VALIDATION_ERROR', 'Enter the visit date and a complete inspection summary before submitting the report.', 400);
      const suppliedGoogleMapsUrl = text(body.google_maps_url, 1000);
      const googleMapsUrl = googleMapsLocationUrl(suppliedGoogleMapsUrl);
      if (suppliedGoogleMapsUrl && !googleMapsUrl) return failure(request, response, 'VALIDATION_ERROR', 'Enter a valid Google Maps location link.', 400);
      const incomingPhotos = Array.isArray(body.site_photos)
        ? body.site_photos
        : (Array.isArray(body.photographs) ? body.photographs : null);
      let sitePhotos = Array.isArray(visit.report?.site_photos) ? visit.report.site_photos.slice(-12) : [];
      if (Array.isArray(incomingPhotos) && incomingPhotos.length) {
        if (incomingPhotos.length > 12) return failure(request, response, 'VALIDATION_ERROR', 'Upload a maximum of 12 site photographs.', 400);
        const files = [];
        for (const photo of incomingPhotos.slice(0, 12)) {
          if (!String(photo?.data_url || '').startsWith('data:image/')) {
            return failure(request, response, 'PHOTO_INVALID', 'Site photographs must be PNG, JPG or WEBP images.', 400);
          }
          const file = await storeApplicationUpload(application, 'field-visit-photo', photo.data_url, photo.name || 'site-photo.jpg');
          if (!file) return failure(request, response, 'PHOTO_INVALID', 'One of the site photographs is invalid or exceeds 5 MB.', 400);
          files.push(file);
        }
        sitePhotos = files;
      }
      if (!sitePhotos.length) {
        return failure(request, response, 'PHOTOS_REQUIRED', 'Upload at least one site photograph with the Field Visit report.', 400);
      }
      const now = new Date().toISOString();
      visit.report = {
        visit_date: visitDate, site_address: text(body.site_address, 700), inspection_summary: inspectionSummary,
        google_maps_url: googleMapsUrl,
        property_condition: text(body.property_condition, 3000), documents_observed: text(body.documents_observed, 3000),
        recommendation: text(body.recommendation, 3000), officer_remarks: text(body.officer_remarks, 3000),
        site_photos: sitePhotos,
        submitted_at: now, submitted_by: visit.officer_name,
      };
      visit.status = 'submitted'; visit.submitted_at = now;
      fieldVisitAudit(
        application,
        visit,
        'field_visit_report_submitted',
        `Field Visit report submitted by ${visit.officer_name}${googleMapsUrl ? ' with a Google Maps location link' : ''}${sitePhotos.length ? ` and ${sitePhotos.length} site photograph${sitePhotos.length === 1 ? '' : 's'}` : ''}.`,
        { headers: {} },
        visit.officer_name,
      );
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, { message: 'Your Field Visit report was submitted to the franchise manager for review.', status: visit.status, field_visit: fieldVisitSummary(visit) });
    }

    const publicBrandingVendorMatch = route.match(/^\/api\/v1\/branding-vendor\/([A-Za-z0-9_-]+)$/);
    if (publicBrandingVendorMatch && request.method === 'GET') {
      const application = database.applications.find((item) => item.branding_signage?.secure_token === publicBrandingVendorMatch[1]);
      const branding = application?.branding_signage;
      if (!application || !branding) return failure(request, response, 'BRANDING_LINK_INVALID', 'This Branding Signage submission link is invalid or no longer available.', 404);
      return success(request, response, { application_number: application.application_number, applicant_name: application.full_name, franchise_model: application.franchise_model, preferred_location: application.preferred_location, branding_signage: brandingSignageSummary(branding) });
    }
    if (publicBrandingVendorMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.branding_signage?.secure_token === publicBrandingVendorMatch[1]);
      const branding = application?.branding_signage;
      if (!application || !branding) return failure(request, response, 'BRANDING_LINK_INVALID', 'This Branding Signage submission link is invalid or no longer available.', 404);
      if (branding.status === 'approved') return failure(request, response, 'BRANDING_LOCKED', 'The manager has approved this Branding Signage work and it is locked.', 409);
      const body = await readJson(request, 24_000_000);
      const photographs = Array.isArray(body.photographs) ? body.photographs.slice(0, 6) : [];
      const existingPhotos = Array.isArray(branding.photographs) ? branding.photographs : [];
      let files = existingPhotos;
      if (photographs.length) {
        files = [];
        for (const photo of photographs) {
          if (!String(photo?.data_url || '').startsWith('data:image/')) return failure(request, response, 'PHOTO_INVALID', 'Branding evidence must be a PNG, JPG or WEBP image.', 400);
          const file = await storeApplicationUpload(application, 'branding-photo', photo.data_url, photo.name);
          if (!file) return failure(request, response, 'PHOTO_INVALID', 'One of the branding photographs is invalid or exceeds 5 MB.', 400);
          files.push(file);
        }
      }
      if (!files.length) return failure(request, response, 'PHOTOS_REQUIRED', 'Upload at least one and no more than six completed-installation photographs.', 400);
      const cost = Number(body.installation_cost);
      if (!Number.isFinite(cost) || cost <= 0) return failure(request, response, 'AMOUNT_REQUIRED', 'Enter the total branding installation amount in INR.', 400);
      if (body.invoice_data_url) {
        const invoice = await storeApplicationUpload(application, 'branding-invoice', body.invoice_data_url, body.invoice_name);
        if (!invoice) return failure(request, response, 'INVOICE_INVALID', 'Upload a valid bill/invoice as PDF, PNG, JPG or WEBP smaller than 5 MB.', 400);
        branding.invoice = invoice;
      }
      if (!branding.invoice) return failure(request, response, 'INVOICE_REQUIRED', 'Upload the branding bill/invoice before submitting for review.', 400);
      const now = new Date().toISOString();
      branding.photographs = files;
      branding.installation_cost = Math.round(cost * 100) / 100;
      branding.completion_details = text(body.completion_details, 5000);
      branding.status = 'submitted';
      branding.submitted_at = now;
      branding.submitted_by = branding.vendor?.name || 'Branding vendor';
      applicationWorkflowAudit(
        application,
        branding,
        'branding_vendor_submitted',
        `Branding installation evidence, total amount ₹${branding.installation_cost.toLocaleString('en-IN')} and bill submitted by ${branding.submitted_by} (${files.length} photograph${files.length === 1 ? '' : 's'}).`,
        { headers: {} },
        branding.submitted_by,
      );
      application.updated_at = now; await saveDatabase();
      return success(request, response, { message: 'Branding installation evidence, total amount and bill were submitted to the franchise manager for review.', status: branding.status, branding_signage: brandingSignageSummary(branding) });
    }

    const publicHrProcessMatch = route.match(/^\/api\/v1\/hr-process\/([A-Za-z0-9_-]+)$/);
    if (publicHrProcessMatch && request.method === 'GET') {
      const application = database.applications.find((item) => item.hr_process?.secure_token === publicHrProcessMatch[1]);
      const hr = application?.hr_process;
      if (!application || !hr) return failure(request, response, 'HR_LINK_INVALID', 'This HR submission link is invalid or no longer available.', 404);
      return success(request, response, { application_number: application.application_number, applicant_name: application.full_name, franchise_model: application.franchise_model, preferred_location: application.preferred_location, hr_process: hrProcessSummary(hr) });
    }
    if (publicHrProcessMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.hr_process?.secure_token === publicHrProcessMatch[1]);
      const hr = application?.hr_process;
      if (!application || !hr) return failure(request, response, 'HR_LINK_INVALID', 'This HR submission link is invalid or no longer available.', 404);
      if (hr.status === 'approved') return failure(request, response, 'HR_PROCESS_LOCKED', 'The manager has approved this HR submission and it is locked.', 409);
      const body = await readJson(request, 12_000_000);
      const candidates = Array.isArray(body.employees) ? body.employees.slice(0, 2) : [];
      if (!candidates.length) return failure(request, response, 'EMPLOYEES_REQUIRED', 'Add at least one and no more than two employee records.', 400);
      const employees = [];
      for (const candidate of candidates) {
        const name = text(candidate?.name, 120); const designation = text(candidate?.designation, 120); const phone = text(candidate?.phone, 30).replace(/[^0-9+ -]/g, ''); const joiningDate = text(candidate?.joining_date, 10);
        if (!name || !designation || phone.replace(/\D/g, '').length < 10 || !isIsoDate(joiningDate)) return failure(request, response, 'EMPLOYEE_INVALID', 'Every employee needs a name, designation, valid contact number and joining date.', 400);
        const offer = await storeApplicationUpload(application, 'offer-letter', candidate?.offer_letter?.data_url, candidate?.offer_letter?.name);
        if (!offer) return failure(request, response, 'OFFER_LETTER_REQUIRED', 'Upload a valid PDF, PNG, JPG or WEBP Offer Letter for every employee.', 400);
        employees.push({ id: randomUUID(), name, designation, phone, joining_date: joiningDate, details: text(candidate?.details, 2000), offer_letter: offer });
      }
      const now = new Date().toISOString();
      hr.employees = employees; hr.status = 'submitted'; hr.submitted_at = now; hr.submitted_by = text(body.submitted_by, 120) || 'HR Department';
      applicationWorkflowAudit(application, hr, 'hr_submission_received', `HR submitted ${employees.length} employee onboarding record${employees.length === 1 ? '' : 's'} with Offer Letters.`, { headers: {} }, hr.submitted_by);
      application.updated_at = now; await saveDatabase();
      return success(request, response, { message: 'Employee onboarding details were submitted to the franchise manager for review.', status: hr.status });
    }

    const videoKycSignalsMatch = route.match(/^\/api\/v1\/video-kyc\/([^/]+)\/signals$/);
    if (videoKycSignalsMatch && request.method === 'GET') {
      const record = videoKycSessionRecord(videoKycSignalsMatch[1]);
      if (!record || !videoKycAccess(request, record.application)) return failure(request, response, 'FORBIDDEN', 'You do not have access to this Video KYC session.', 403);
      const participant = videoKycParticipant(request, record.application);
      const signals = Array.isArray(record.session.signals) ? record.session.signals.filter((signal) => signal.from !== participant) : [];
      return success(request, response, { signals, session: videoKycSessionSummary(record.session) });
    }

    if (videoKycSignalsMatch && request.method === 'POST') {
      const record = videoKycSessionRecord(videoKycSignalsMatch[1]);
      if (!record || !videoKycAccess(request, record.application)) return failure(request, response, 'FORBIDDEN', 'You do not have access to this Video KYC session.', 403);
      if (record.session.status !== 'in_progress') return failure(request, response, 'VIDEO_KYC_NOT_ACTIVE', 'Video KYC signaling is available only while the session is in progress.', 409);
      const body = await readJson(request, 500_000);
      const type = text(body.type, 20).toLowerCase();
      if (!['offer', 'answer', 'candidate'].includes(type) || !body.signal || typeof body.signal !== 'object') return failure(request, response, 'VALIDATION_ERROR', 'Send a valid Video KYC offer, answer or connection candidate.');
      record.session.signals = Array.isArray(record.session.signals) ? record.session.signals : [];
      record.session.signals.push({ id: randomUUID(), from: videoKycParticipant(request, record.application), type, signal: body.signal, created_at: new Date().toISOString() });
      record.session.signals = record.session.signals.slice(-160);
      await saveDatabase();
      return success(request, response, { accepted: true });
    }

    if (request.method === 'POST' && route === '/api/v1/leads/public') {
      const body = await readJson(request);
      const lead = leadRecord({
        ...body,
        source: 'website',
        stage: 'new',
        assigned_to: 'Unassigned',
        priority: 'normal',
        utm_source: body.utm_source,
        utm_medium: body.utm_medium,
        utm_campaign: body.utm_campaign,
        gclid: body.gclid,
        campaign_name: body.campaign_name || body.utm_campaign || '',
      });
      if (!lead.name || !isEmail(lead.email) || !lead.mobile || !['FOFO', 'FOCO'].includes(lead.franchise_model) || !lead.territory_query) {
        return failure(request, response, 'VALIDATION_ERROR', 'Enter your name, email, phone number, franchise model and preferred territory.');
      }
      database.leads.push(lead);
      workflowNotify({
        module: 'leads',
        action: 'new_lead',
        title: 'New website lead received',
        message: `${lead.name} submitted a franchise enquiry for ${lead.territory_query}.`,
        actor: { name: lead.name, role: 'applicant' },
        href: `admin:Leads:${lead.id}`,
        entityType: 'lead',
        entityId: lead.id,
      });
      await saveDatabase();
      return success(request, response, { lead_id: lead.id, message: 'Your franchise enquiry has been received.' }, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/appointments/public') {
      const body = await readJson(request);
      const appointment = appointmentRecord({ ...body, source: 'website', status: 'requested', assigned_to: 'Unassigned' });
      if (!appointment.name || !isEmail(appointment.email) || !appointment.mobile || !isIsoDate(appointment.preferred_date) || !appointment.preferred_time || !appointment.topic) {
        return failure(request, response, 'VALIDATION_ERROR', 'Enter your name, email, phone number, preferred date and time, and consultation topic.');
      }
      database.appointments.push(appointment);
      workflowNotify({
        module: 'appointments',
        action: 'new_appointment',
        title: 'New appointment request',
        message: `${appointment.name} requested a consultation on ${appointment.preferred_date}.`,
        actor: { name: appointment.name, role: 'applicant' },
        href: `admin:Appointments:${appointment.id}`,
        entityType: 'appointment',
        entityId: appointment.id,
      });
      await saveDatabase();
      return success(request, response, { appointment_id: appointment.id, message: 'Your appointment request has been received.' }, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/applications/public/contact-otp/request') {
      const body = await readJson(request);
      const channel = text(body.channel, 10).toLowerCase();
      const value = contactValue(channel, body.value);
      if (!validContact(channel, value)) {
        return failure(request, response, 'CONTACT_INVALID', channel === 'mobile' ? 'Enter a valid 10-digit Indian mobile number.' : 'Enter a valid email address.');
      }
      // Default RFMS_CONTACT_OTP_VIA_ERP=1: mobile + email OTP through mother ERP (MSG91 / email).
      if (rfmsContactOtpUsesErp()) {
        try {
          if (channel === 'mobile') {
            const delivery = await dispatchMobileOtp(value);
            const challengeId = randomUUID();
            const viaErp = rfmsOtpUsesErp() && !delivery?.test_mode;
            contactOtpChallenges.set(challengeId, {
              channel,
              value: delivery.mobile || normalizeApplicantMobile(value),
              expires_at: Date.now() + 300_000,
              via_erp: viaErp,
            });
            return success(request, response, {
              challenge_id: challengeId,
              channel,
              masked_destination: maskedContact(channel, delivery.mobile || value),
              ...otpDeliveryMeta(delivery),
            });
          }
          const delivery = await dispatchEmailOtp(value);
          const challengeId = randomUUID();
          const viaErp = rfmsOtpUsesErp() && !delivery?.test_mode;
          contactOtpChallenges.set(challengeId, {
            channel,
            value: delivery.email || text(value, 160).toLowerCase(),
            expires_at: Date.now() + 300_000,
            via_erp: viaErp,
          });
          return success(request, response, {
            challenge_id: challengeId,
            channel,
            masked_destination: maskedContact(channel, delivery.email || value),
            ...otpDeliveryMeta(delivery),
          });
        } catch (otpError) {
          return failure(request, response, 'OTP_SEND_FAILED', otpError instanceof Error ? otpError.message : 'Could not send OTP.', 502);
        }
      }
      const challengeId = randomUUID();
      const destination = channel === 'mobile' ? normalizeApplicantMobile(value) : value;
      contactOtpChallenges.set(challengeId, { channel, value: destination, expires_at: Date.now() + 300_000, via_erp: false });
      return success(request, response, {
        challenge_id: challengeId,
        channel,
        masked_destination: maskedContact(channel, destination),
        expires_in_seconds: 300,
        test_mode: true,
        development_otp: '123456',
      });
    }

    if (request.method === 'POST' && route === '/api/v1/applications/public/contact-otp/verify') {
      const body = await readJson(request);
      const challengeId = text(body.challenge_id, 100);
      const challenge = contactOtpChallenges.get(challengeId);
      if (!challenge || challenge.expires_at < Date.now()) {
        return failure(request, response, 'OTP_INVALID', 'The OTP is incorrect or has expired.', 401);
      }
      try {
        if (challenge.via_erp && rfmsOtpUsesErp()) {
          if (challenge.channel === 'email') await confirmEmailOtp(challenge.value, body.otp);
          else await confirmMobileOtp(challenge.value, body.otp);
        } else if (text(body.otp, 10) !== '123456') {
          throw new Error('The OTP is incorrect or has expired.');
        }
      } catch (otpError) {
        return failure(request, response, 'OTP_INVALID', otpError instanceof Error ? otpError.message : 'The OTP is incorrect or has expired.', 401);
      }
      contactOtpChallenges.delete(challengeId);
      const verificationToken = randomUUID();
      contactVerificationTokens.set(verificationToken, { ...challenge, expires_at: Date.now() + 1_800_000, used: false });
      return success(request, response, { channel: challenge.channel, verification_token: verificationToken, verified: true });
    }

    if (request.method === 'POST' && route === '/api/v1/applications/public/documents') {
      const body = await readJson(request, 7_500_000);
      const kind = text(body.kind, 20).toLowerCase();
      const document = applicationDocumentData(body.data_url);
      if (!applicationDocumentKinds.has(kind) || !document || (kind === 'photo' && !document.mime.startsWith('image/'))) {
        return failure(request, response, 'VALIDATION_ERROR', 'Upload a valid photo, PAN, Aadhaar or Voter ID file. Photos must be images; KYC files may be PDF, PNG, JPG or WEBP, up to 5 MB.');
      }
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `application-${kind}-${Date.now()}-${randomUUID()}.${document.extension}`;
      await writeFile(path.join(uploadsDirectory, filename), document.bytes);
      return success(request, response, { kind, name: text(body.name, 180) || `${kind}.${document.extension}`, url: storedUploadUrl(filename) }, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/applications/public/aadhaar/okyc/initiate') {
      const body = await readJson(request);
      const aadhaarNumber = text(body.aadhaar_number ?? body.aadhaarNumber, 20).replace(/\D/g, '');
      if (!/^\d{12}$/.test(aadhaarNumber)) {
        return failure(request, response, 'AADHAAR_INVALID', 'Enter a valid 12-digit Aadhaar number before verification.', 400);
      }
      try {
        const cgpey = await resolveCgpeyRuntimeConfig({ force: true });
        const okyc = await initiateAadhaarOkyc({ aadhaarNumber, config: cgpey });
        const verificationToken = randomUUID();
        const record = {
          verification_token: verificationToken,
          status: 'otp_pending',
          reference_id: okyc.referenceId || okyc.sessionId || '',
          session_id: okyc.sessionId || okyc.referenceId || '',
          message: okyc.message || 'Aadhaar OTP sent. Enter the OTP to complete verification.',
          aadhaar_masked: maskAadhaar(aadhaarNumber),
          aadhaar_digits: aadhaarNumber, // in-memory only; stripped before application persistence
          initiated_at: new Date().toISOString(),
          verified_at: '',
          simulated: Boolean(okyc.simulated),
          response: okyc.data || {},
        };
        aadhaarOkycSessions.set(verificationToken, record);
        return success(request, response, {
          status: record.status,
          reference_id: record.reference_id,
          message: record.message,
          aadhaar_masked: record.aadhaar_masked,
          initiated_at: record.initiated_at,
          simulated: record.simulated,
          verification_token: verificationToken,
          response: record.response,
        });
      } catch (okycError) {
        const code = okycError?.code || 'CGPEY_OKYC_FAILED';
        const status = code === 'AADHAAR_INVALID' ? 400 : code === 'CGPEY_NOT_CONFIGURED' ? 503 : 502;
        return failure(request, response, code, okycError instanceof Error ? okycError.message : 'Unable to start Aadhaar OKYC.', status);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/applications/public/aadhaar/okyc/verify') {
      const body = await readJson(request);
      const verificationToken = text(body.verification_token ?? body.verificationToken, 80);
      const otp = text(body.otp, 12).replace(/\D/g, '');
      const session = verificationToken ? aadhaarOkycSessions.get(verificationToken) : null;
      if (!session) {
        return failure(request, response, 'OKYC_SESSION_MISSING', 'Aadhaar OKYC session expired or not found. Click Verify Aadhaar to send a new OTP.', 400);
      }
      if (session.status === 'verified' && session.verified_at) {
        return success(request, response, {
          status: 'verified',
          reference_id: session.reference_id || '',
          message: session.message || 'Aadhaar already verified.',
          aadhaar_masked: session.aadhaar_masked || '',
          initiated_at: session.initiated_at || '',
          verified_at: session.verified_at,
          simulated: Boolean(session.simulated),
          verification_token: verificationToken,
          response: session.response || {},
        });
      }
      if (!/^\d{4,8}$/.test(otp)) {
        return failure(request, response, 'OTP_INVALID', 'Enter the OTP sent to the Aadhaar-linked mobile number.', 400);
      }
      try {
        const cgpey = await resolveCgpeyRuntimeConfig({ force: true });
        const verified = await verifyAadhaarOkycOtp({
          aadhaarNumber: session.aadhaar_digits,
          sessionId: session.session_id || session.reference_id,
          otp,
          config: cgpey,
        });
        session.status = 'verified';
        session.reference_id = verified.referenceId || session.reference_id || '';
        session.session_id = verified.sessionId || session.session_id || '';
        session.message = verified.message || 'Aadhaar verified successfully.';
        session.verified_at = new Date().toISOString();
        session.simulated = Boolean(verified.simulated);
        session.response = verified.data || session.response || {};
        aadhaarOkycSessions.set(verificationToken, session);
        return success(request, response, {
          status: 'verified',
          reference_id: session.reference_id,
          message: session.message,
          aadhaar_masked: session.aadhaar_masked,
          initiated_at: session.initiated_at,
          verified_at: session.verified_at,
          simulated: session.simulated,
          verification_token: verificationToken,
          response: session.response,
        });
      } catch (okycError) {
        const code = okycError?.code || 'CGPEY_OKYC_VERIFY_FAILED';
        const status = code === 'OTP_INVALID' || code === 'OKYC_SESSION_MISSING' || code === 'AADHAAR_INVALID'
          ? 400
          : code === 'CGPEY_NOT_CONFIGURED' ? 503 : 502;
        return failure(request, response, code, okycError instanceof Error ? okycError.message : 'Unable to verify Aadhaar OTP.', status);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/applications/public') {
      const body = await readJson(request);
      const model = text(body.franchise_model, 10).toUpperCase();
      const email = contactValue('email', body.email);
      const mobile = contactValue('mobile', body.mobile);
      const panNumber = text(body.pan_number, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const aadhaarNumber = text(body.aadhaar_number, 20).replace(/\D/g, '');
      const termsText = model === 'FOCO' ? database.company_profile.foco_terms : database.company_profile.fofo_terms;
      const termsAccepted = body.terms_accepted === true;
      const documents = body.documents && typeof body.documents === 'object' ? body.documents : {};
      const userId = text(body.user_id, 40).toLowerCase();
      const accountPassword = typeof body.account_password === 'string' ? body.account_password : '';
      const accountPasswordConfirmation = typeof body.account_password_confirmation === 'string' ? body.account_password_confirmation : '';
      const account = passwordDetails(accountPassword);
      const requiredDocumentsPresent = [...applicationDocumentKinds].every((kind) => typeof documents[kind]?.url === 'string' && documents[kind].url.includes('/uploads/application-'));
      const application = {
        id: randomUUID(), application_number: applicationNumber(),
        full_name: text(body.full_name, 120), email, mobile,
        date_of_birth: text(body.date_of_birth, 10), pan_number: panNumber, aadhaar_number: aadhaarNumber, address: text(body.address, 500), city: text(body.city, 100), district: text(body.district, 100), pincode: text(body.pincode, 10),
        franchise_model: model, preferred_location: text(body.preferred_location, 180), business_experience: text(body.business_experience, 2000),
        user_id: userId, account_password_salt: account?.salt ?? '', account_password_hash: account?.hash ?? '',
        terms_model: model, terms_text: termsText, terms_accepted_at: termsAccepted ? new Date().toISOString() : '',
        documents, document_verifications: {}, review_notes: '', review_history: [], payment_terms: {}, video_kyc_sessions: [], video_kyc_current_session_id: '', field_visit: null, onboarding_documents: [], branding_signage: null, hr_process: null, onboarding_modules: { branding_released: false, branding_released_at: '', branding_released_by: '', hr_released: false, hr_released_at: '', hr_released_by: '' }, payments: paymentPlan(model), stage: 'payment_1_due', visible_to_admin: false,
        employee_referral_number: '',
        parent_foco_id: '', parent_foco_name: '', parent_foco_mapped_at: '',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      const referralRaw = text(body.employee_referral_number ?? body.employee_referral ?? body.referral_number, 40).toUpperCase();
      const referral = referralRaw.replace(/[^A-Z0-9-]/g, '').slice(0, 40);
      if (referral) {
        application.employee_referral_number = referral.startsWith('ERN-') ? referral : `ERN-${referral}`;
        applicationReviewHistory(
          application,
          'reach_employee_referral',
          `Reach Employee Referral Number ${application.employee_referral_number} recorded as internal reference (not editable by applicant).`,
          { headers: {} },
          'Reach sales',
        );
      }
      const okycToken = text(body.aadhaar_okyc_verification_token ?? body.aadhaar_okyc?.verification_token, 80);
      const okycSession = okycToken ? aadhaarOkycSessions.get(okycToken) : null;
      if (okycSession && okycSession.aadhaar_digits === aadhaarNumber) {
        application.aadhaar_okyc = {
          status: okycSession.status || 'initiated',
          reference_id: okycSession.reference_id || '',
          message: okycSession.message || '',
          aadhaar_masked: okycSession.aadhaar_masked || maskAadhaar(aadhaarNumber),
          initiated_at: okycSession.initiated_at || new Date().toISOString(),
          verified_at: okycSession.verified_at || '',
          simulated: Boolean(okycSession.simulated),
          response: okycSession.response && typeof okycSession.response === 'object' ? okycSession.response : {},
        };
        aadhaarOkycSessions.delete(okycToken);
      } else if (body.aadhaar_okyc && typeof body.aadhaar_okyc === 'object') {
        // Accept client-echoed OKYC summary only when reference_id is present (no full Aadhaar in payload).
        const referenceId = text(body.aadhaar_okyc.reference_id, 120);
        if (referenceId) {
          application.aadhaar_okyc = {
            status: text(body.aadhaar_okyc.status, 40) || 'initiated',
            reference_id: referenceId,
            message: text(body.aadhaar_okyc.message, 500),
            aadhaar_masked: text(body.aadhaar_okyc.aadhaar_masked, 20) || maskAadhaar(aadhaarNumber),
            initiated_at: text(body.aadhaar_okyc.initiated_at, 40) || new Date().toISOString(),
            verified_at: text(body.aadhaar_okyc.verified_at, 40),
            simulated: Boolean(body.aadhaar_okyc.simulated),
            response: body.aadhaar_okyc.response && typeof body.aadhaar_okyc.response === 'object'
              ? body.aadhaar_okyc.response
              : {},
          };
        }
      }
      if (!application.full_name || !isEmail(application.email) || !application.mobile || !application.date_of_birth || !/^[A-Z]{5}\d{4}[A-Z]$/.test(application.pan_number) || !/^\d{12}$/.test(application.aadhaar_number) || !application.address || !application.city || !application.district || !/^\d{6}$/.test(application.pincode) || !['FOFO', 'FOCO'].includes(model) || !application.preferred_location || !requiredDocumentsPresent || !/^[a-z0-9._-]{4,40}$/.test(userId) || !account || accountPassword !== accountPasswordConfirmation) {
        return failure(request, response, 'VALIDATION_ERROR', 'Enter a valid PAN number and 12-digit Aadhaar number, complete all applicant details, and upload all four required files: photo, PAN card, Aadhaar card and Voter ID.');
      }
      const configuredPin = publicPinRecords().find((item) => item.pincode === application.pincode && (model === 'FOFO' ? item.fofo.available > 0 : item.foco.available > 0));
      if (!configuredPin) return failure(request, response, 'PINCODE_UNAVAILABLE', `The selected PIN code does not currently have an available ${model} opportunity. Choose another available franchise territory PIN code.`, 409);
      application.territory_pincode = application.pincode;
      if (!termsAccepted || !termsText) return failure(request, response, 'TERMS_NOT_ACCEPTED', `Read and accept the ${model} franchise terms and conditions before continuing to payment.`);
      if (!verifiedContact(body.mobile_verification_token, 'mobile', mobile) || !verifiedContact(body.email_verification_token, 'email', email)) {
        return failure(request, response, 'CONTACT_NOT_VERIFIED', 'Verify the mobile number and email address with their OTPs before continuing to payment.');
      }
      if (database.applications.some((item) => item.email?.toLowerCase() === application.email || item.user_id?.toLowerCase() === application.user_id)) {
        return failure(request, response, 'ACCOUNT_EXISTS', 'That email address or applicant user ID is already registered. Sign in to your applicant profile instead.', 409);
      }
      const hecLeadId = text(body.hec_lead_id, 120);
      const hecFranchisee = text(body.hec_franchisee_profile, 120);
      if (hecLeadId) application.hec_lead_id = hecLeadId;
      if (hecFranchisee) application.hec_franchisee_profile = hecFranchisee;
      const linkedLead = hecLeadId
        ? (database.leads || []).find((item) => item.id === hecLeadId)
        : hecFranchisee
          ? findLeadByHecFranchisee(hecFranchisee)
          : null;
      if (linkedLead) {
        linkedLead.stage = 'application_started';
        linkedLead.franchise_model = model;
        linkedLead.updated_at = application.updated_at;
        if (hecFranchisee) linkedLead.hec_franchisee_profile = hecFranchisee;
        addLeadActivity(linkedLead, 'note', `Applicant started ${model} application ${application.application_number} from the franchise portal.`, 'Applicant portal');
      }
      if (model === 'FOCO') ensureFocoPaymentSchedule(application);
      database.applications.push(application);
      contactVerificationTokens.get(text(body.mobile_verification_token, 100)).used = true;
      contactVerificationTokens.get(text(body.email_verification_token, 100)).used = true;
      await saveDatabase();
      return success(request, response, applicationSummary(application), 201);
    }

    const publicApplicationTermsMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/terms$/);
    if (publicApplicationTermsMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.id === decodeURIComponent(publicApplicationTermsMatch[1]));
      if (!application) return failure(request, response, 'APPLICATION_NOT_FOUND', 'This franchise application could not be found.', 404);
      const body = await readJson(request);
      if (body.accepted !== true) return failure(request, response, 'TERMS_NOT_ACCEPTED', `Read and accept the ${application.franchise_model} franchise terms before continuing.`);
      const now = new Date().toISOString();
      const profile = companyProfile(database.company_profile);
      application.terms_model = application.franchise_model;
      application.terms_text = application.franchise_model === 'FOCO' ? profile.foco_terms : profile.fofo_terms;
      application.terms_accepted_at = now;
      application.updated_at = now;
      applicationReviewHistory(application, 'franchise_terms_accepted', `Applicant accepted the ${application.franchise_model} franchise terms and conditions.`, { headers: {} });
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const receiptVerificationMatch = route.match(/^\/api\/v1\/receipts\/verify\/([^/]+)$/);
    if (receiptVerificationMatch && request.method === 'GET') {
      const receiptNumber = decodeURIComponent(receiptVerificationMatch[1]);
      const entry = database.applications.flatMap((application) => application.payments.map((payment) => ({ application, payment }))).find(({ payment }) => payment.status === 'paid' && payment.receipt_number === receiptNumber);
      if (!entry) return failure(request, response, 'RECEIPT_NOT_FOUND', 'This receipt could not be validated.', 404);
      const accept = String(request.headers.accept ?? '');
      const wantsJson = url.searchParams.get('format') === 'json' || (accept.includes('application/json') && !accept.includes('text/html'));
      if (!wantsJson) {
        cors(request, response);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(paymentReceiptVerifyHtml(entry));
        return;
      }
      return success(request, response, {
        valid: true,
        receipt_number: entry.payment.receipt_number,
        transaction_number: receiptTransactionNumber(entry.payment),
        application_number: entry.application.application_number,
        franchise_model: entry.application.franchise_model,
        proposed_location: entry.application.preferred_location,
        payment_amount: entry.payment.amount,
        paid_at: entry.payment.paid_at,
        status: 'PAID',
      });
    }

    const onboardingCertificateVerifyMatch = route.match(/^\/api\/v1\/onboarding-certificates\/verify\/([^/]+)$/);
    if (onboardingCertificateVerifyMatch && request.method === 'GET') {
      const certificateNumber = decodeURIComponent(onboardingCertificateVerifyMatch[1]);
      const entry = database.applications
        .map((application) => ({ application, certificate: application.onboarding_certificate }))
        .find(({ certificate }) => certificate?.certificate_number === certificateNumber);
      if (!entry?.certificate) return failure(request, response, 'CERTIFICATE_NOT_FOUND', 'This onboarding certificate could not be validated.', 404);
      const accept = String(request.headers.accept ?? '');
      if (accept.includes('text/html') || url.searchParams.get('format') === 'html') {
        cors(request, response);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(onboardingCertificateVerifyHtml(entry));
        return;
      }
      return success(request, response, {
        valid: true,
        certificate_number: entry.certificate.certificate_number,
        business_name: entry.certificate.business_name,
        franchise_model: franchiseModelCertificateLabel(entry.certificate.franchise_model || entry.application.franchise_model),
        application_number: entry.application.application_number,
        issued_at: entry.certificate.issued_at,
        status: 'VALID',
      });
    }

    const trainingCertificateVerifyMatch = route.match(/^\/api\/v1\/training-certificates\/verify\/([^/]+)$/);
    if (trainingCertificateVerifyMatch && request.method === 'GET') {
      const certificateNumber = decodeURIComponent(trainingCertificateVerifyMatch[1]);
      const entry = database.applications
        .map((application) => ({ application, certificate: application.training?.certificate }))
        .find(({ certificate }) => certificate?.certificate_number === certificateNumber);
      if (!entry?.certificate) return failure(request, response, 'CERTIFICATE_NOT_FOUND', 'This training certificate could not be validated.', 404);
      const accept = String(request.headers.accept ?? '');
      if (accept.includes('text/html') || url.searchParams.get('format') === 'html') {
        cors(request, response);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(trainingCertificateVerifyHtml(entry));
        return;
      }
      return success(request, response, {
        valid: true,
        certificate_number: entry.certificate.certificate_number,
        applicant_name: entry.application.full_name,
        business_name: entry.certificate.business_name,
        franchise_address: entry.certificate.franchise_address,
        application_number: entry.application.application_number,
        franchise_model: entry.application.franchise_model,
        completed_at: entry.certificate.issued_at,
        status: 'VALID',
      });
    }

    const publicReceiptMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payments\/([^/]+)\/receipt$/);
    if (publicReceiptMatch && request.method === 'GET') {
      const application = database.applications.find((item) => item.id === publicReceiptMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const payment = application.payments.find((item) => item.key === publicReceiptMatch[2]);
      if (!payment || payment.status !== 'paid' || !payment.receipt_number) return failure(request, response, 'RECEIPT_UNAVAILABLE', 'A receipt is available only after this payment is successfully recorded.', 404);
      const receiptName = receiptText(payment.receipt_number, 50).replace(/[^A-Za-z0-9_-]/g, '') || 'receipt';
      return sendPdf(request, response, `Remedium-Lab-${receiptName}.pdf`, await paymentReceiptPdf(application, payment));
    }

    const publicApplicationId = route.match(/^\/api\/v1\/applications\/public\/([^/]+)$/)?.[1];
    if (publicApplicationId && request.method === 'GET') {
      const application = database.applications.find((item) => item.id === publicApplicationId);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      return success(request, response, applicationSummary(application));
    }

    const publicPaymentTermsMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payment-terms\/franchise_fee$/);
    if (publicPaymentTermsMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.id === publicPaymentTermsMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.franchise_model !== 'FOCO') return failure(request, response, 'PAYMENT_TERMS_UNAVAILABLE', 'Phase 2 payment terms are available only for a FOCO franchise application.', 409);
      if (!territoryAllotted(application)) return failure(request, response, 'TERRITORY_ALLOTMENT_REQUIRED', 'The Territory Allotment Letter must be issued before Phase 2 terms can be accepted.', 409);
      const phaseTwo = application.payments.find((payment) => payment.key === 'franchise_fee');
      if (!phaseTwo || phaseTwo.status !== 'due') return failure(request, response, 'PAYMENT_UNAVAILABLE', 'The manager must unlock the FOCO Phase 2 payment before these terms can be accepted.', 409);
      const body = await readJson(request);
      if (body.accepted !== true) return failure(request, response, 'TERMS_NOT_ACCEPTED', 'Read and accept the FOCO Phase 2 payment terms before continuing.', 422);
      const now = new Date().toISOString();
      application.payment_terms = application.payment_terms && typeof application.payment_terms === 'object' ? application.payment_terms : {};
      application.payment_terms.franchise_fee = { terms_text: companyProfile(database.company_profile).foco_phase_2_terms, accepted_at: now, accepted_by: application.full_name };
      application.updated_at = now;
      applicationReviewHistory(application, 'foco_phase_2_terms_accepted', 'Applicant accepted the FOCO Phase 2 payment terms and conditions.', { headers: {} });
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const publicSecurityDepositTermsMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payment-terms\/security_deposit$/);
    if (publicSecurityDepositTermsMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.id === publicSecurityDepositTermsMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.franchise_model !== 'FOCO') return failure(request, response, 'PAYMENT_TERMS_UNAVAILABLE', 'Phase 3 payment terms are available only for a FOCO franchise application.', 409);
      const phaseThree = application.payments.find((payment) => payment.key === 'security_deposit');
      if (!phaseThree || phaseThree.status !== 'due') return failure(request, response, 'PAYMENT_UNAVAILABLE', 'The manager must unlock the FOCO security deposit before these terms can be accepted.', 409);
      const body = await readJson(request);
      if (body.accepted !== true) return failure(request, response, 'TERMS_NOT_ACCEPTED', 'Read and accept the FOCO Phase 3 payment terms before continuing.', 422);
      const now = new Date().toISOString();
      const profile = companyProfile(database.company_profile);
      application.payment_terms = application.payment_terms && typeof application.payment_terms === 'object' ? application.payment_terms : {};
      application.payment_terms.security_deposit = {
        terms_text: profile.foco_phase_3_terms,
        terms_version: profile.foco_phase_3_terms_version,
        accepted_at: now,
        accepted_by: application.full_name,
      };
      application.updated_at = now;
      applicationReviewHistory(application, 'foco_phase_3_terms_accepted', 'Applicant accepted the FOCO Phase 3 security deposit terms and conditions.', { headers: {} });
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const publicPaymentValidateCouponMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payments\/validate-coupon$/);
    if (publicPaymentValidateCouponMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.id === publicPaymentValidateCouponMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const body = await readJson(request);
      const focoFull = body.foco_full === true;
      const paymentKey = text(body.payment_key, 80);
      const payment = focoFull
        ? application.payments.find((item) => item.key === 'application_fee')
        : application.payments.find((item) => item.key === paymentKey);
      if (!payment || (!focoFull && payment.status !== 'due')) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'This payment is not currently due.', 409);
      if (focoFull && !focoFullPaymentEligible(application)) return failure(request, response, 'FOCO_FULL_UNAVAILABLE', 'The complete franchise amount option is available only at the FOCO application payment stage.', 409);
      const amountOverride = focoFull ? focoFullPaymentTotal(application) : undefined;
      const result = validateCouponForPayment(database, application, payment, body.coupon_code, new Date(), {
        amount_override: amountOverride,
        payment_key: focoFull ? 'application_fee' : payment.key,
        foco_full: focoFull,
      });
      if (!result.valid) return failure(request, response, result.code, result.message, 422);
      return success(request, response, {
        coupon_code: result.coupon.code,
        original_amount: result.original_amount,
        discount_amount: result.discount_amount,
        final_amount: result.final_amount,
        foco_full: focoFull,
        message: result.message,
      });
    }

    const publicFocoFullQuoteMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payments\/foco-full-quote$/);
    if (publicFocoFullQuoteMatch && request.method === 'GET') {
      const application = database.applications.find((item) => item.id === publicFocoFullQuoteMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!focoFullPaymentEligible(application)) return failure(request, response, 'FOCO_FULL_UNAVAILABLE', 'The complete franchise amount option is available only at the FOCO application payment stage.', 409);
      const phaseOne = application.payments.find((item) => item.key === 'application_fee');
      const originalAmount = focoFullPaymentTotal(application);
      const couponCode = text(new URL(request.url, 'http://localhost').searchParams.get('coupon_code'), 40);
      let pricing = { original_amount: originalAmount, discount_amount: 0, final_amount: originalAmount, coupon_code: '', coupon_id: '' };
      if (couponCode) {
        const result = validateCouponForPayment(database, application, phaseOne, couponCode, new Date(), {
          amount_override: originalAmount,
          payment_key: 'application_fee',
          foco_full: true,
        });
        if (!result.valid) return failure(request, response, result.code, result.message, 422);
        pricing = {
          original_amount: result.original_amount,
          discount_amount: result.discount_amount,
          final_amount: result.final_amount,
          coupon_code: result.coupon.code,
          coupon_id: result.coupon.id,
        };
      }
      return success(request, response, {
        eligible: true,
        label: 'Complete FOCO franchise amount',
        ...pricing,
        phases: ['application_fee', 'franchise_fee', 'security_deposit'],
      });
    }

    const publicPaymentSubmitOfflineMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payments\/submit-offline$/);
    if (publicPaymentSubmitOfflineMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.id === publicPaymentSubmitOfflineMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const body = await readJson(request);
      const method = text(body.method, 40);
      if (!['cheque', 'bank_transfer'].includes(method)) return failure(request, response, 'VALIDATION_ERROR', 'Choose Cheque or Bank Transfer for offline payment.', 400);
      const focoFull = body.foco_full === true;
      const paymentKey = text(body.payment_key, 80);
      const payment = focoFull
        ? application.payments.find((item) => item.key === 'application_fee')
        : application.payments.find((item) => item.key === paymentKey);
      if (!payment || (!focoFull && payment.status !== 'due')) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'This payment is not currently due.', 409);
      if (focoFull && !focoFullPaymentEligible(application)) return failure(request, response, 'FOCO_FULL_UNAVAILABLE', 'The complete franchise amount option is available only at the FOCO application payment stage.', 409);
      const termsError = assertPaymentTerms(application, { ...payment, foco_full_payment: focoFull });
      if (termsError) return failure(request, response, 'TERMS_NOT_ACCEPTED', termsError, 422);
      const fields = validateOfflineSubmission(body, method);
      if (fields.error) return failure(request, response, 'VALIDATION_ERROR', fields.error, 400);
      const proof = await storeApplicationUpload(application, `payment-${method}`, body.proof_data_url ?? body.data_url, body.proof_name ?? body.name ?? `${method}-proof`);
      if (!proof) return failure(request, response, 'PROOF_REQUIRED', method === 'cheque' ? 'Upload a clear image of the cheque.' : 'Upload the bank transfer receipt.', 400);
      const pricingResult = resolvePaymentPricing(application, payment, body.coupon_code, {
        amount_override: focoFull ? focoFullPaymentTotal(application) : undefined,
        payment_key: focoFull ? 'application_fee' : payment.key,
        foco_full: focoFull,
      });
      if (!pricingResult.valid) return failure(request, response, pricingResult.code, pricingResult.message, 422);
      const actor = application.full_name || 'Applicant';
      const submission = buildOfflineSubmission(method, fields, proof, actor);
      if (focoFull) {
        completeFocoFullPayment(application, {
          ...pricingResult.pricing,
          coupon_id: pricingResult.couponResult?.coupon?.id ?? pricingResult.pricing.coupon_id ?? '',
        }, method, { submission }, actor);
        applicationReviewHistory(application, 'foco_full_payment_submitted', 'FOCO complete franchise amount submitted for verification.', { headers: {} });
      } else {
        applyPricingToPayment(payment, pricingResult.pricing, pricingResult.couponResult);
        markPaymentUnderVerification(payment, method, submission, actor);
        applicationReviewHistory(application, 'payment_submitted', `${payment.label} submitted for verification via ${method === 'cheque' ? 'cheque' : 'bank transfer'}.`, { headers: {} });
      }
      application.visible_to_admin = true;
      application.updated_at = new Date().toISOString();
      workflowNotify({
        module: 'payments',
        action: 'payment_submitted',
        title: 'Payment submitted for verification',
        message: `${application.full_name} · ${focoFull ? 'FOCO complete franchise amount' : payment.label} is awaiting verification.`,
        actor,
        href: `admin:Payments:${application.id}`,
        entityType: 'application',
        entityId: application.id,
        applicationId: application.id,
      });
      await saveDatabase();
      return success(request, response, {
        application: applicationSummary(application),
        status: focoFull ? 'under_verification' : payment.status,
        message: 'Payment submitted successfully. Status is now Under Verification.',
      });
    }

    const publicPaymentGatewayInitiateMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payments\/gateway\/initiate$/);
    if (publicPaymentGatewayInitiateMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.id === publicPaymentGatewayInitiateMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const body = await readJson(request);
      const focoFull = body.foco_full === true;
      const paymentKey = text(body.payment_key, 80);
      const payment = focoFull
        ? application.payments.find((item) => item.key === 'application_fee')
        : application.payments.find((item) => item.key === paymentKey);
      if (!payment || (!focoFull && payment.status !== 'due')) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'This payment is not currently due.', 409);
      if (focoFull && !focoFullPaymentEligible(application)) return failure(request, response, 'FOCO_FULL_UNAVAILABLE', 'The complete franchise amount option is available only at the FOCO application payment stage.', 409);
      const termsError = assertPaymentTerms(application, { ...payment, foco_full_payment: focoFull });
      if (termsError) return failure(request, response, 'TERMS_NOT_ACCEPTED', termsError, 422);
      const pricingResult = resolvePaymentPricing(application, payment, body.coupon_code, {
        amount_override: focoFull ? focoFullPaymentTotal(application) : undefined,
        payment_key: focoFull ? 'application_fee' : payment.key,
        foco_full: focoFull,
      });
      if (!pricingResult.valid) return failure(request, response, pricingResult.code, pricingResult.message, 422);
      ensureGatewayOrders(database);

      let provider = 'simulate';
      let razorpayOrderId = '';
      let razorpayKeyId = '';
      let razorpayTestMode = true;
      let simulateReason = '';

      if (rfmsGatewaySimulate()) {
        provider = 'simulate';
        simulateReason = 'RFMS_GATEWAY_SIMULATE';
      } else {
        try {
          const erpOrder = await createRfmsRazorpayOrderViaErp({
            amount: pricingResult.pricing.final_amount,
            applicationId: application.id,
            paymentKey: focoFull ? 'application_fee' : payment.key,
            receipt: `RFMS-${String(application.application_number || application.id).replace(/[^A-Za-z0-9]/g, '').slice(-20)}`,
            currency: 'INR',
          });
          razorpayOrderId = String(erpOrder.order_id || erpOrder.id || '');
          razorpayKeyId = String(erpOrder.razorpay_key_id || erpOrder.key_id || '');
          razorpayTestMode = Boolean(erpOrder.test_mode);
          if (!razorpayOrderId) throw new Error('ERP did not return a Razorpay order id.');
          // Simulate checkout UI only when ERP is in test mode without a usable key_id.
          if (razorpayTestMode && !razorpayKeyId) {
            provider = 'simulate';
            simulateReason = 'erp_test_mode_missing_key';
          } else {
            provider = 'razorpay';
          }
        } catch (gatewayError) {
          if (rfmsGatewaySimulate() || String(process.env.RFMS_GATEWAY_FALLBACK_SIMULATE ?? '').trim() === '1') {
            provider = 'simulate';
            simulateReason = gatewayError instanceof Error ? gatewayError.message : 'erp_order_failed';
          } else {
            return failure(
              request,
              response,
              'GATEWAY_INIT_FAILED',
              gatewayError instanceof Error ? gatewayError.message : 'Unable to create payment gateway order.',
              502,
            );
          }
        }
      }

      const order = createGatewayOrder(database, application, {
        payment_key: focoFull ? 'application_fee' : payment.key,
        foco_full: focoFull,
        amount: pricingResult.pricing.final_amount,
        original_amount: pricingResult.pricing.original_amount,
        discount_amount: pricingResult.pricing.discount_amount,
        coupon_code: pricingResult.pricing.coupon_code,
        coupon_id: pricingResult.couponResult?.coupon?.id ?? pricingResult.pricing.coupon_id ?? '',
        provider,
        razorpay_order_id: razorpayOrderId,
        razorpay_key_id: razorpayKeyId,
        razorpay_test_mode: razorpayTestMode,
      });
      await saveDatabase();
      return success(request, response, {
        order_id: order.id,
        order_number: order.order_number,
        amount: order.amount,
        original_amount: order.original_amount,
        discount_amount: order.discount_amount,
        coupon_code: order.coupon_code,
        provider: order.provider,
        simulate: order.provider === 'simulate',
        simulate_reason: simulateReason || undefined,
        key_id: order.razorpay_key_id || undefined,
        razorpay_order_id: order.razorpay_order_id || undefined,
        razorpay_test_mode: Boolean(order.razorpay_test_mode),
        currency: 'INR',
        checkout_url: `${portalBaseUrl}/?rfms_gateway=${encodeURIComponent(order.id)}&application=${encodeURIComponent(application.id)}`,
        return_url: `${portalBaseUrl}/`,
      });
    }

    const publicPaymentGatewayCompleteMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payments\/gateway\/complete$/);
    if (publicPaymentGatewayCompleteMatch && request.method === 'POST') {
      const application = database.applications.find((item) => item.id === publicPaymentGatewayCompleteMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const body = await readJson(request);
      const orderId = text(body.order_id, 80);
      ensureGatewayOrders(database);
      const order = database.payment_gateway_orders.find((item) => item.id === orderId && item.application_id === application.id);
      if (!order || order.status !== 'pending') return failure(request, response, 'GATEWAY_ORDER_INVALID', 'This payment session is no longer available.', 409);

      const isSimulate = order.provider === 'simulate' || rfmsGatewaySimulate();
      let razorpayPaymentId = text(body.razorpay_payment_id || body.payment_id, 120);
      let razorpayOrderId = text(body.razorpay_order_id, 120) || String(order.razorpay_order_id || '');
      let razorpaySignature = text(body.razorpay_signature || body.signature, 200);

      if (!isSimulate) {
        try {
          const verified = await verifyRfmsRazorpayPaymentViaErp({
            applicationId: application.id,
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
          });
          if (!verified?.verified && !verified?.test_mode) {
            return failure(request, response, 'GATEWAY_VERIFY_FAILED', 'Payment signature verification failed.', 401);
          }
          razorpayPaymentId = String(verified.razorpay_payment_id || razorpayPaymentId);
          razorpayOrderId = String(verified.razorpay_order_id || razorpayOrderId);
        } catch (verifyError) {
          return failure(
            request,
            response,
            'GATEWAY_VERIFY_FAILED',
            verifyError instanceof Error ? verifyError.message : 'Payment verification failed.',
            401,
          );
        }
      }

      completeGatewayOrder(database, order.id);
      const receiptNumber = `RCP-${Date.now().toString().slice(-8)}`;
      const transactionNumber = `TXN-${Date.now().toString().slice(-10)}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const gatewayReference = razorpayPaymentId
        ? `RZP-${razorpayPaymentId}`
        : `GW-${transactionNumber.replace(/^TXN-/, '')}`;
      if (razorpayOrderId) order.razorpay_order_id = razorpayOrderId;
      if (razorpayPaymentId) order.razorpay_payment_id = razorpayPaymentId;
      const pricing = {
        original_amount: order.original_amount,
        discount_amount: order.discount_amount,
        final_amount: order.amount,
        coupon_code: order.coupon_code,
        coupon_id: order.coupon_id,
      };
      const couponResult = order.coupon_code
        ? { valid: true, coupon: database.coupons.find((item) => item.id === order.coupon_id) ?? { id: order.coupon_id, code: order.coupon_code } }
        : null;
      if (order.foco_full) {
        completeFocoFullPayment(application, pricing, 'gateway', {
          immediate_paid: true,
          receipt_number: receiptNumber,
          transaction_number: transactionNumber,
          gateway_reference: gatewayReference,
          verified_by: isSimulate ? 'Payment gateway (simulate)' : 'Payment gateway',
        }, 'Payment gateway');
        if (couponResult?.coupon?.id) {
          for (const key of ['application_fee', 'franchise_fee', 'security_deposit']) {
            const phase = application.payments.find((item) => item.key === key);
            if (!phase || phase.status !== 'paid') continue;
            recordCouponUsage(database, {
              coupon: couponResult.coupon,
              application,
              payment: phase,
              pricing: {
                original_amount: phase.original_amount ?? phase.amount,
                discount_amount: phase.discount_amount ?? 0,
                final_amount: phase.amount,
              },
              receiptNumber: phase.receipt_number,
              transactionNumber: phase.transaction_number,
            });
          }
        }
        applicationReviewHistory(application, 'foco_full_payment_received', 'FOCO complete franchise amount received through the payment gateway.', { headers: {} });
        automaticallyReserveMatchingTerritory(application);
      } else {
        const payment = application.payments.find((item) => item.key === order.payment_key);
        if (!payment) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'This payment is no longer available.', 409);
        applyPricingToPayment(payment, pricing, couponResult);
        markPaymentPaid(payment, 'gateway', {
          receipt_number: receiptNumber,
          transaction_number: transactionNumber,
          gateway_reference: gatewayReference,
          verified_by: isSimulate ? 'Payment gateway (simulate)' : 'Payment gateway',
        });
        await finalizeVerifiedPayment(application, payment, { headers: {} }, couponResult);
      }
      application.visible_to_admin = true;
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      const paidPayment = order.foco_full
        ? application.payments.find((item) => item.key === 'application_fee')
        : application.payments.find((item) => item.key === order.payment_key);
      return success(request, response, {
        application: applicationSummary(application),
        foco_full: order.foco_full,
        receipt: paidPayment?.status === 'paid' ? {
          receipt_number: paidPayment.receipt_number,
          transaction_number: paidPayment.transaction_number,
          gateway_reference: paidPayment.gateway_reference ?? gatewayReference,
          amount: paidPayment.amount,
          original_amount: paidPayment.original_amount ?? paidPayment.amount,
          discount_amount: paidPayment.discount_amount ?? 0,
          coupon_code: paidPayment.coupon_code ?? '',
          label: paidPayment.label,
          paid_at: paidPayment.paid_at,
          download_url: `/api/v1/applications/public/${application.id}/payments/${paidPayment.key}/receipt`,
        } : null,
      });
    }

    const publicPaymentMatch = route.match(/^\/api\/v1\/applications\/public\/([^/]+)\/payments$/);
    if (publicPaymentMatch && request.method === 'POST') {
      return failure(request, response, 'PAYMENT_METHOD_REQUIRED', 'Choose a payment method and use the payment gateway, cheque or bank transfer submission endpoints.', 410);
    }

    if (request.method === 'GET' && route === '/api/v1/territories') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can manage territories.', 403);
      const territories = database.territories.map((territory) => territorySummary(territory));
      const unassignedApplications = database.applications
        .filter((application) => application.visible_to_admin && !application.territory_id)
        .map((application) => ({ id: application.id, application_number: application.application_number, full_name: application.full_name, franchise_model: application.franchise_model, preferred_location: application.preferred_location, district: application.district, pincode: application.pincode }));
      const franchiseLocations = database.applications
        .filter((application) => application.visible_to_admin)
        .map(activeAllotmentMapRecord)
        .filter(Boolean);
      return success(request, response, { territories, metrics: territoryMetrics(), unassigned_applications: unassignedApplications, franchise_locations: franchiseLocations });
    }

    if (request.method === 'GET' && route === '/api/v1/admin/overview') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can view the overview dashboard.', 403);
      const overview = buildAdminOverview(database, {
        territoryMetrics: () => territoryMetrics(),
        territorySummary: (territory) => territorySummary(territory, false),
      });
      return success(request, response, overview);
    }

    if (request.method === 'GET' && route === '/api/v1/territories/capacities') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can export territory capacities.', 403);
      const rows = flattenCapacityRows(publicPinRecords);
      const wantCsv = String(url.searchParams.get('format') || '').toLowerCase() === 'csv';
      if (wantCsv) {
        const body = capacityCsv(rows);
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="rfms-territory-capacities.csv"',
          'Cache-Control': 'no-store',
        });
        response.end(body);
        return;
      }
      return success(request, response, { rows, count: rows.length, metrics: territoryMetrics() });
    }

    if (request.method === 'GET' && route === '/api/v1/territories/capacity-alerts') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can view capacity alerts.', 403);
      const threshold = Number(url.searchParams.get('threshold') ?? DEFAULT_NEAR_FULL_THRESHOLD);
      const rows = flattenCapacityRows(publicPinRecords);
      const alerts = nearFullCapacityAlerts(rows, threshold);
      return success(request, response, {
        alerts,
        count: alerts.length,
        threshold: Number.isFinite(threshold) ? Math.max(0, threshold) : DEFAULT_NEAR_FULL_THRESHOLD,
      });
    }

    if (request.method === 'PATCH' && route === '/api/v1/territories/capacities/bulk') {
      if (!requirePermission(request, response, 'territory')) return;
      const body = await readJson(request);
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      if (!updates.length) return failure(request, response, 'VALIDATION_ERROR', 'Provide at least one PIN capacity update.');
      if (updates.length > 500) return failure(request, response, 'VALIDATION_ERROR', 'Bulk capacity updates are limited to 500 PIN rows per request.');

      const updated = [];
      const errors = [];
      const touched = new Set();

      for (const raw of updates) {
        const pincode = pinCode(raw?.pincode);
        const territoryId = text(raw?.territory_id, 80);
        const territory = territoryId
          ? database.territories.find((item) => item.id === territoryId)
          : database.territories.find((item) => item.pincodes.includes(pincode));
        if (!territory) {
          errors.push({ pincode: pincode || String(raw?.pincode || ''), error: 'No territory owns this PIN code.' });
          continue;
        }
        const result = applyBulkPinAvailability(territory, { ...raw, pincode, territory_id: territory.id }, allocationCountsForPin);
        if (!result.ok) {
          errors.push({ pincode, territory_id: territory.id, error: result.error });
          continue;
        }
        touched.add(territory.id);
        updated.push({ pincode, territory_id: territory.id });
      }

      if (updated.length) await saveDatabase();

      const nearFull = nearFullCapacityAlerts(flattenCapacityRows(publicPinRecords), DEFAULT_NEAR_FULL_THRESHOLD);
      if (nearFull.length) {
        workflowNotify({
          module: 'territory',
          action: 'near_full',
          title: 'Territory capacity near full',
          message: `${nearFull.length} PIN${nearFull.length === 1 ? '' : 's'} at or below ${DEFAULT_NEAR_FULL_THRESHOLD} remaining FOFO/FOCO slot(s).`,
          actor: workflowActor(request),
          href: 'admin:Territory',
          entityType: 'territory',
          entityId: 'capacity-alerts',
        });
      }

      return success(request, response, {
        updated,
        errors,
        updated_count: updated.length,
        error_count: errors.length,
        territories: [...touched].map((id) => {
          const territory = database.territories.find((item) => item.id === id);
          return territory ? territorySummary(territory) : null;
        }).filter(Boolean),
        alerts: nearFull.slice(0, 50),
      });
    }

    if (request.method === 'POST' && route === '/api/v1/territories') {
      if (!requirePermission(request, response, 'territory')) return;
      const body = await readJson(request);
      const territory = territoryRecord({ ...body, fofo_capacity: body.fofo_available ?? body.fofo_capacity, foco_capacity: body.foco_available ?? body.foco_capacity });
      if (!territoryIsValid(territory)) return failure(request, response, 'VALIDATION_ERROR', 'Choose a state, district and subdivision, enter an area, add one or more six-digit PIN codes, and set FOFO or FOCO availability.');
      const duplicatePins = territory.pincodes.filter((pincode) => database.territories.some((item) => item.pincodes.includes(pincode)));
      if (duplicatePins.length) return failure(request, response, 'PINCODE_EXISTS', `PIN code ${duplicatePins[0]} is already controlled by another territory. Edit that territory instead.`, 409);
      const duplicate = database.territories.some((item) => [item.state, item.district, item.subdivision, item.area].map((value) => value.toLowerCase()).join('|') === [territory.state, territory.district, territory.subdivision, territory.area].map((value) => value.toLowerCase()).join('|'));
      if (duplicate) return failure(request, response, 'TERRITORY_EXISTS', 'This territory hierarchy already exists. Edit the current territory instead.', 409);
      database.territories.push(territory);
      await saveDatabase();
      return success(request, response, territorySummary(territory), 201);
    }

    const territoryMatch = route.match(/^\/api\/v1\/territories\/([^/]+)$/);
    if (territoryMatch && request.method === 'PATCH') {
      if (!requirePermission(request, response, 'territory')) return;
      const index = database.territories.findIndex((item) => item.id === territoryMatch[1]);
      if (index < 0) return failure(request, response, 'NOT_FOUND', 'Territory not found.', 404);
      const current = database.territories[index];
      const body = await readJson(request);
      const requestedPins = Array.isArray(body.pin_capacities) ? body.pin_capacities : current.pin_capacities;
      const requestedCodes = territoryPinCapacities({ pin_capacities: requestedPins }, [], 0, 0).map((item) => item.pincode);
      const allocatedCodes = [...new Set(current.allocations.map((item) => item.pincode).filter(Boolean))];
      if (allocatedCodes.some((pincode) => !requestedCodes.includes(pincode))) return failure(request, response, 'PINCODE_IN_USE', 'A PIN code with a reserved or occupied franchisee cannot be removed.', 409);
      const duplicatePins = requestedCodes.filter((pincode) => database.territories.some((item) => item.id !== current.id && item.pincodes.includes(pincode)));
      if (duplicatePins.length) return failure(request, response, 'PINCODE_EXISTS', `PIN code ${duplicatePins[0]} is already controlled by another territory.`, 409);
      const pin_capacities = requestedPins.map((raw) => {
        const entry = raw && typeof raw === 'object' ? raw : { pincode: raw };
        const pincode = pinCode(entry.pincode ?? entry.code ?? entry);
        const existing = current.pin_capacities.find((item) => item.pincode === pincode);
        const fofoUsed = allocationCountsForPin(current, pincode, 'FOFO').assigned;
        const focoUsed = allocationCountsForPin(current, pincode, 'FOCO').assigned;
        const fofoAvailable = Number(entry.fofo_available);
        const focoAvailable = Number(entry.foco_available);
        return {
          ...entry,
          pincode,
          fofo_capacity: Number.isInteger(fofoAvailable) && fofoAvailable >= 0 ? fofoUsed + fofoAvailable : boundedInteger(entry.fofo_capacity, existing?.fofo_capacity ?? fofoUsed, fofoUsed, 500),
          foco_capacity: Number.isInteger(focoAvailable) && focoAvailable >= 0 ? focoUsed + focoAvailable : boundedInteger(entry.foco_capacity, existing?.foco_capacity ?? focoUsed, focoUsed, 500),
        };
      });
      const updated = territoryRecord({
        ...current, ...body,
        pin_capacities,
        id: current.id, allocations: current.allocations, created_at: current.created_at, updated_at: new Date().toISOString(),
      }, current.id);
      if (!territoryIsValid(updated)) return failure(request, response, 'VALIDATION_ERROR', 'Keep state, district, subdivision, area, PIN codes and at least one franchise availability valid.');
      if (updated.pin_capacities.some((pin) => {
        const fofo = allocationCountsForPin(updated, pin.pincode, 'FOFO');
        const foco = allocationCountsForPin(updated, pin.pincode, 'FOCO');
        return fofo.capacity < fofo.assigned || foco.capacity < foco.assigned;
      })) return failure(request, response, 'CAPACITY_CONFLICT', 'PIN capacity cannot be lower than the currently reserved or occupied franchisee count.');
      database.territories[index] = updated;
      await saveDatabase();
      return success(request, response, territorySummary(updated));
    }

    if (territoryMatch && request.method === 'DELETE') {
      if (!requirePermission(request, response, 'territory')) return;
      const territory = database.territories.find((item) => item.id === territoryMatch[1]);
      if (!territory) return failure(request, response, 'NOT_FOUND', 'Territory not found.', 404);
      if (territory.allocations.length) return failure(request, response, 'TERRITORY_IN_USE', 'Release all territory allocations before removing this territory.');
      database.territories = database.territories.filter((item) => item.id !== territory.id);
      await saveDatabase();
      return success(request, response, { message: 'Territory removed.' });
    }

    const allocationMatch = route.match(/^\/api\/v1\/territories\/([^/]+)\/allocations$/);
    if (allocationMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can assign a territory.', 403);
      const territory = database.territories.find((item) => item.id === allocationMatch[1]);
      if (!territory) return failure(request, response, 'NOT_FOUND', 'Territory not found.', 404);
      const body = await readJson(request);
      const application = database.applications.find((item) => item.id === text(body.application_id, 100) && item.visible_to_admin);
      if (!application) return failure(request, response, 'APPLICATION_NOT_FOUND', 'Choose a paid franchise application that is visible to the RFMS team.', 404);
      if (application.territory_id) return failure(request, response, 'APPLICATION_ALREADY_ASSIGNED', 'This application already has a territory assignment. Release it before assigning another one.', 409);
      const applicationPin = pinCode(application.pincode);
      if (!applicationPin || !territory.pincodes.includes(applicationPin)) return failure(request, response, 'PINCODE_MISMATCH', 'This application must be allocated to the territory that owns its selected PIN code.', 409);
      const capacity = allocationCountsForPin(territory, applicationPin, application.franchise_model);
      if (capacity.available < 1) return failure(request, response, 'TERRITORY_UNAVAILABLE', `No ${application.franchise_model} capacity remains for PIN code ${applicationPin}.`, 409);
      const now = new Date().toISOString();
      territory.allocations.push(territoryAllocation({ id: randomUUID(), application_id: application.id, application_number: application.application_number, applicant_name: application.full_name, pincode: applicationPin, franchise_model: application.franchise_model, status: 'reserved', created_at: now, updated_at: now }));
      territory.updated_at = now;
      application.territory_id = territory.id;
      application.territory_label = territoryLabel(territory);
      application.territory_pincode = applicationPin;
      application.updated_at = now;
      syncApplicationTerritoryStatus(application);
      await saveDatabase();
      return success(request, response, { territory: territorySummary(territory), application: applicationSummary(application) }, 201);
    }

    const allocationStatusMatch = route.match(/^\/api\/v1\/territories\/([^/]+)\/allocations\/([^/]+)$/);
    if (allocationStatusMatch && request.method === 'PATCH') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can update a territory allocation.', 403);
      const territory = database.territories.find((item) => item.id === allocationStatusMatch[1]);
      const allocation = territory?.allocations.find((item) => item.id === allocationStatusMatch[2]);
      if (!territory || !allocation) return failure(request, response, 'NOT_FOUND', 'Territory allocation not found.', 404);
      const status = text((await readJson(request)).status, 20).toLowerCase();
      if (!['reserved', 'occupied'].includes(status)) return failure(request, response, 'VALIDATION_ERROR', 'Allocation status must be Reserved or Occupied.');
      allocation.status = status; allocation.updated_at = new Date().toISOString(); territory.updated_at = allocation.updated_at;
      await saveDatabase();
      return success(request, response, territorySummary(territory));
    }

    if (allocationStatusMatch && request.method === 'DELETE') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can release a territory allocation.', 403);
      const territory = database.territories.find((item) => item.id === allocationStatusMatch[1]);
      const allocation = territory?.allocations.find((item) => item.id === allocationStatusMatch[2]);
      if (!territory || !allocation) return failure(request, response, 'NOT_FOUND', 'Territory allocation not found.', 404);
      territory.allocations = territory.allocations.filter((item) => item.id !== allocation.id);
      territory.updated_at = new Date().toISOString();
      const application = database.applications.find((item) => item.id === allocation.application_id && item.territory_id === territory.id);
      if (application) { application.territory_id = ''; application.territory_label = ''; application.territory_pincode = ''; application.updated_at = territory.updated_at; }
      await saveDatabase();
      return success(request, response, territorySummary(territory));
    }

    if (request.method === 'GET' && route === '/api/v1/video-kyc') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can view the Video KYC queue.', 403);
      const queue = database.applications.flatMap((application) => videoKycSessionsFor(application).map((session) => ({
        ...videoKycSessionSummary(session),
        application_id: application.id,
        application_number: application.application_number,
        applicant_name: application.full_name,
        applicant_email: application.email,
        applicant_mobile: application.mobile,
        franchise_model: application.franchise_model,
        preferred_location: application.preferred_location,
        pincode: application.pincode,
      }))).sort((first, second) => (second.assigned_at || '').localeCompare(first.assigned_at || ''));
      return success(request, response, queue);
    }

    const applicationVideoKycAssignMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/video-kyc$/);
    if (applicationVideoKycAssignMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can assign Video KYC.', 403);
      const application = database.applications.find((item) => item.id === applicationVideoKycAssignMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!allApplicationDocumentsVerified(application)) return failure(request, response, 'DOCUMENTS_NOT_VERIFIED', 'Verify all four submitted KYC documents before assigning Video KYC.', 409);
      const sessions = videoKycSessionsFor(application);
      const existing = sessions.find((session) => ['assigned', 'in_progress'].includes(session.status));
      if (existing) return failure(request, response, 'VIDEO_KYC_ALREADY_ACTIVE', 'This applicant already has an active Video KYC request.', 409);
      if (sessions.some((session) => session.status === 'completed')) return failure(request, response, 'VIDEO_KYC_COMPLETED', 'Video KYC has already been completed for this application. A completed verification cannot be assigned or reassigned again.', 409);
      if (sessions.length) return failure(request, response, 'VIDEO_KYC_REASSIGNMENT_REQUIRED', 'A follow-up Video KYC attempt can only be created by selecting Reassign on the active attempt. Direct assignment is not available after an earlier attempt.', 409);
      const attempt = 1;
      const session = {
        id: randomUUID(), attempt, status: 'assigned', assigned_at: new Date().toISOString(), assigned_by: reviewActor(request), started_at: '', started_by: '', applicant_joined_at: '', completed_at: '', completed_by: '', remarks: '', reassigned_from: '', screenshots: [], history: [], signals: [],
      };
      application.video_kyc_sessions = videoKycSessionsFor(application);
      application.video_kyc_sessions.push(session);
      application.video_kyc_current_session_id = session.id;
      videoKycAudit(application, session, 'video_kyc_assigned', `Video KYC attempt ${attempt} assigned to ${application.full_name}.`, request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, { application: applicationSummary(application), session: videoKycSessionSummary(session) }, 201);
    }

    const videoKycStartMatch = route.match(/^\/api\/v1\/admin\/video-kyc\/([^/]+)\/start$/);
    if (videoKycStartMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can start Video KYC.', 403);
      const record = videoKycSessionRecord(videoKycStartMatch[1]);
      if (!record) return failure(request, response, 'NOT_FOUND', 'Video KYC session not found.', 404);
      if (!['assigned', 'in_progress'].includes(record.session.status)) return failure(request, response, 'VIDEO_KYC_NOT_ACTIVE', 'This Video KYC attempt has already been closed.', 409);
      if (record.session.status === 'assigned') {
        record.session.status = 'in_progress';
        record.session.started_at = new Date().toISOString();
        record.session.started_by = reviewActor(request);
        record.session.signals = [];
        videoKycAudit(record.application, record.session, 'video_kyc_started', `Video KYC attempt ${record.session.attempt} started by ${reviewActor(request)}.`, request);
        record.application.updated_at = new Date().toISOString();
        await saveDatabase();
      } else if (record.session.status === 'in_progress') {
        // Manager refreshed / re-opened the room — clear stale SDP so a fresh two-way offer can form.
        record.session.signals = [];
        record.application.updated_at = new Date().toISOString();
        await saveDatabase();
      }
      return success(request, response, { application: applicationSummary(record.application), session: videoKycSessionSummary(record.session) });
    }

    const videoKycScreenshotMatch = route.match(/^\/api\/v1\/admin\/video-kyc\/([^/]+)\/screenshots$/);
    if (videoKycScreenshotMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can capture Video KYC evidence.', 403);
      const record = videoKycSessionRecord(videoKycScreenshotMatch[1]);
      if (!record) return failure(request, response, 'NOT_FOUND', 'Video KYC session not found.', 404);
      if (record.session.status !== 'in_progress') return failure(request, response, 'VIDEO_KYC_NOT_ACTIVE', 'Screenshots can be captured only during an active Video KYC session.', 409);
      const body = await readJson(request, 7_500_000);
      const screenshot = videoKycScreenshotData(body.data_url);
      if (!screenshot) return failure(request, response, 'VALIDATION_ERROR', 'Capture a PNG, JPG or WEBP screenshot smaller than 5 MB.');
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `video-kyc-${record.application.id}-${record.session.id}-${Date.now()}-${randomUUID()}.${screenshot.extension}`;
      await writeFile(path.join(uploadsDirectory, filename), screenshot.bytes);
      const evidence = { id: randomUUID(), name: text(body.name, 180) || `Video KYC evidence ${record.session.screenshots.length + 1}.${screenshot.extension}`, url: storedUploadUrl(filename), captured_at: new Date().toISOString(), captured_by: reviewActor(request) };
      record.session.screenshots = Array.isArray(record.session.screenshots) ? record.session.screenshots : [];
      record.session.screenshots.push(evidence);
      videoKycAudit(record.application, record.session, 'video_kyc_screenshot_captured', `Video KYC evidence screenshot ${record.session.screenshots.length} captured.`, request);
      record.application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, { application: applicationSummary(record.application), session: videoKycSessionSummary(record.session), screenshot: evidence }, 201);
    }

    const videoKycFinishMatch = route.match(/^\/api\/v1\/admin\/video-kyc\/([^/]+)\/finish$/);
    if (videoKycFinishMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can complete or reassign Video KYC.', 403);
      const record = videoKycSessionRecord(videoKycFinishMatch[1]);
      if (!record) return failure(request, response, 'NOT_FOUND', 'Video KYC session not found.', 404);
      if (!['assigned', 'in_progress'].includes(record.session.status)) return failure(request, response, 'VIDEO_KYC_ALREADY_CLOSED', 'This Video KYC attempt is already closed.', 409);
      const body = await readJson(request);
      const action = text(body.action, 20).toLowerCase();
      const remarks = text(body.remarks, 2_000);
      if (!['complete', 'reassign'].includes(action)) return failure(request, response, 'VALIDATION_ERROR', 'Choose whether to complete or reassign this Video KYC attempt.');
      record.session.remarks = remarks;
      record.session.completed_at = new Date().toISOString();
      record.session.completed_by = reviewActor(request);
      record.session.signals = [];
      if (action === 'complete') {
        record.session.status = 'completed';
        videoKycAudit(record.application, record.session, 'video_kyc_completed', `Video KYC attempt ${record.session.attempt} completed${remarks ? `: ${remarks}` : '.'}`, request);
        record.application.video_kyc_current_session_id = record.session.id;
      } else {
        record.session.status = 'reassigned';
        videoKycAudit(record.application, record.session, 'video_kyc_reassigned', `Video KYC attempt ${record.session.attempt} reassigned${remarks ? `: ${remarks}` : '.'}`, request);
        const next = { id: randomUUID(), attempt: record.session.attempt + 1, status: 'assigned', assigned_at: new Date().toISOString(), assigned_by: reviewActor(request), started_at: '', started_by: '', applicant_joined_at: '', completed_at: '', completed_by: '', remarks: '', reassigned_from: record.session.id, screenshots: [], history: [], signals: [] };
        record.application.video_kyc_sessions = videoKycSessionsFor(record.application);
        record.application.video_kyc_sessions.push(next);
        record.application.video_kyc_current_session_id = next.id;
        videoKycAudit(record.application, next, 'video_kyc_assigned', `Video KYC attempt ${next.attempt} created after reassignment of attempt ${record.session.attempt}.`, request);
      }
      record.application.updated_at = new Date().toISOString();
      await saveDatabase();
      const current = videoKycSessionsFor(record.application).find((session) => session.id === record.application.video_kyc_current_session_id) ?? record.session;
      return success(request, response, { application: applicationSummary(record.application), session: videoKycSessionSummary(current) });
    }

    if (request.method === 'GET' && route === '/api/v1/applications') {
      if (!requirePermission(request, response, 'applicants')) return;
      return success(request, response, database.applications.filter((application) => application.visible_to_admin).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(applicationSummary));
    }

    const applicationTerritoryAllotmentReportMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/territory-allotment\/report$/);
    if (applicationTerritoryAllotmentReportMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can download a Territory Allotment Letter.', 403);
      const application = database.applications.find((item) => item.id === applicationTerritoryAllotmentReportMatch[1] && item.visible_to_admin);
      const allotment = territoryAllotmentSummary(application?.territory_allotment) || territoryAllotmentsFor(application).at(-1);
      if (!application || !allotment) return failure(request, response, 'TERRITORY_ALLOTMENT_UNAVAILABLE', 'No Territory Allotment Letter has been issued for this application.', 404);
      const safeApplicationNumber = receiptText(application.application_number, 50).replace(/[^A-Za-z0-9_-]/g, '') || 'application';
      return sendPdf(request, response, `Remedium-Lab-Territory-Allotment-${safeApplicationNumber}-v${allotment.version}.pdf`, await territoryAllotmentLetterPdf(application, allotment));
    }

    const applicationTerritoryAllotmentMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/territory-allotment$/);
    if (applicationTerritoryAllotmentMatch && request.method === 'GET') {
      if (!canManageTerritory(request)) return failure(request, response, 'FORBIDDEN', 'Only a franchise manager or administrator can view Territory Allotment options.', 403);
      const application = database.applications.find((item) => item.id === applicationTerritoryAllotmentMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const applicationPin = pinCode(application.pincode);
      const territories = database.territories
        .filter((territory) => applicationPin && territory.pincodes.includes(applicationPin))
        .map((territory) => {
          const summary = territorySummary(territory, false);
          const pinCapacity = summary.pin_capacities.find((item) => item.pincode === applicationPin) ?? null;
          return {
            ...summary,
            registered_pin: applicationPin,
            registered_pin_status: pinCapacity?.status ?? summary.status,
            registered_pin_capacity: pinCapacity,
            available_units: allocationCountsForPin(territory, applicationPin, application.franchise_model).available,
          };
        });
      const nearbyFranchises = database.applications
        .filter((candidate) => candidate.id !== application.id)
        .map(activeAllotmentMapRecord)
        .filter(Boolean);
      return success(request, response, {
        application: applicationSummary(application),
        eligible: application.field_visit?.status === 'approved',
        territories,
        nearby_franchises: nearbyFranchises,
      });
    }

    if (applicationTerritoryAllotmentMatch && request.method === 'POST') {
      if (!canManageTerritory(request)) return failure(request, response, 'FORBIDDEN', 'Only a franchise manager or administrator can allot a franchise territory.', 403);
      const application = database.applications.find((item) => item.id === applicationTerritoryAllotmentMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.field_visit?.status !== 'approved') return failure(request, response, 'FIELD_VISIT_APPROVAL_REQUIRED', 'Approve the Field Visit report before allotting a territory.', 409);
      const body = await readJson(request);
      const territory = database.territories.find((item) => item.id === text(body.territory_id, 100));
      const applicationPin = pinCode(application.pincode);
      if (!territory) return failure(request, response, 'TERRITORY_NOT_FOUND', 'Choose a registered territory for this allotment.', 404);
      if (!applicationPin || !territory.pincodes.includes(applicationPin)) return failure(request, response, 'PINCODE_MISMATCH', 'The selected territory must contain the applicant PIN code.', 409);
      const finalTerritory = text(body.final_territory, 240) || territoryLabel(territory);
      const radiusKm = boundedDecimal(body.radius_km, 5, 0.1, 100);
      const effectiveDate = text(body.effective_date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return failure(request, response, 'VALIDATION_ERROR', 'Choose the effective date for the Territory Allotment Letter.', 400);
      const suppliedGoogleMapsUrl = text(body.google_maps_url, 1000);
      const googleMapsUrl = googleMapsLocationUrl(suppliedGoogleMapsUrl || application.field_visit?.report?.google_maps_url);
      if (suppliedGoogleMapsUrl && !googleMapsUrl) return failure(request, response, 'VALIDATION_ERROR', 'Enter a valid Google Maps location link.', 400);
      const latitude = optionalGeoCoordinate(body.latitude, -90, 90);
      const longitude = optionalGeoCoordinate(body.longitude, -180, 180);
      if (!latitude.valid || !longitude.valid || (latitude.value === null) !== (longitude.value === null)) return failure(request, response, 'VALIDATION_ERROR', 'Enter both valid GPS latitude and longitude, or leave both fields empty.', 400);
      const territoryConflicts = territoryAllotmentConflicts(application, latitude.value, longitude.value, radiusKm);
      const conflictOverride = body.conflict_override === true;
      if (territoryConflicts.length && !conflictOverride) {
        return failure(request, response, 'TERRITORY_CONFLICT', `${territoryConflicts.length} existing franchise territory ${territoryConflicts.length === 1 ? 'overlaps' : 'overlap'} the proposed radius. Adjust the point or radius, or record a manager-approved overlap exception.`, 409);
      }
      const franchiseAddress = text(body.franchise_address, 700) || application.field_visit?.report?.site_address || application.address || '';
      const district = text(body.district, 100) || application.district || territory.district;
      const state = text(body.state, 100) || territory.state || 'West Bengal';
      const subdivision = text(body.subdivision, 100) || territory.subdivision;
      const preferredLocation = text(body.preferred_location, 240) || application.preferred_location || territory.area;
      const currentTerritory = database.territories.find((item) => item.id === application.territory_id);
      const existingAllocation = territory.allocations.find((item) => item.application_id === application.id);
      if (!existingAllocation) {
        const availability = allocationCountsForPin(territory, applicationPin, application.franchise_model);
        if (availability.available < 1) return failure(request, response, 'TERRITORY_UNAVAILABLE', `No ${application.franchise_model} capacity remains for PIN code ${applicationPin}.`, 409);
      }
      const now = new Date().toISOString();
      if (currentTerritory && currentTerritory.id !== territory.id) {
        currentTerritory.allocations = currentTerritory.allocations.filter((item) => item.application_id !== application.id);
        currentTerritory.updated_at = now;
      }
      if (!existingAllocation) {
        territory.allocations.push(territoryAllocation({ id: randomUUID(), application_id: application.id, application_number: application.application_number, applicant_name: application.full_name, pincode: applicationPin, franchise_model: application.franchise_model, status: 'reserved', created_at: now, updated_at: now }));
      } else {
        existingAllocation.status = 'reserved'; existingAllocation.updated_at = now;
      }
      territory.updated_at = now;
      application.territory_id = territory.id;
      application.territory_label = finalTerritory;
      application.territory_pincode = applicationPin;
      application.territory_allotments = Array.isArray(application.territory_allotments) ? application.territory_allotments : [];
      const version = application.territory_allotments.length + 1;
      const letterNumber = `TAL-${new Date().getFullYear()}-${application.application_number.replace(/[^A-Za-z0-9]/g, '')}-V${version}`;
      const allotment = {
        id: randomUUID(), version, letter_number: letterNumber, territory_id: territory.id, registered_territory_label: territoryLabel(territory),
        final_territory: finalTerritory, radius_km: radiusKm, franchise_address: franchiseAddress, district, subdivision, state,
        pincode: applicationPin, preferred_location: preferredLocation, latitude: latitude.value, longitude: longitude.value, google_maps_url: googleMapsUrl, effective_date: effectiveDate,
        conflict_override: conflictOverride,
        issued_at: now, issued_by: reviewActor(request), status: 'active', history: [{ id: randomUUID(), type: version === 1 ? 'issued' : 'reissued', message: `Territory Allotment Letter ${letterNumber} issued for ${finalTerritory} (${radiusKm} km radius)${territoryConflicts.length ? ` with manager-approved overlap against ${territoryConflicts.length} existing franchise territory ${territoryConflicts.length === 1 ? 'record' : 'records'}` : ''}.`, actor: reviewActor(request), created_at: now }],
      };
      application.territory_allotments.push(allotment);
      application.territory_allotment = allotment;
      if (application.franchise_model === 'FOCO') {
        const phaseTwo = application.payments.find((payment) => payment.key === 'franchise_fee');
        application.stage = phaseTwo?.status === 'paid' ? 'payment_2_received' : 'territory_allotted_payment_locked';
        applicationReviewHistory(application, 'foco_phase_2_payment_pending_manager_unlock', 'Territory Allotment completed. FOCO Phase 2 franchise fee remains locked until a manager releases it.', request);
      } else if (paymentIsPaid(application, 'fofo_one_time_fee')) {
        application.stage = 'branding_signage_unlocked';
        applicationReviewHistory(application, 'branding_signage_unlocked', 'Territory Allotment completed. Branding Signage is now available for the FOFO franchise.', request);
      }
      application.updated_at = now;
      applicationReviewHistory(application, version === 1 ? 'territory_allotment_issued' : 'territory_allotment_reissued', `Territory Allotment Letter ${letterNumber} issued for ${finalTerritory} with a ${radiusKm} km radius.${territoryConflicts.length ? ` Manager approved ${territoryConflicts.length} map-overlap exception${territoryConflicts.length === 1 ? '' : 's'}.` : ''}`, request);
      syncApplicationTerritoryStatus(application);
      await saveDatabase();
      return success(request, response, { application: applicationSummary(application), allotment: territoryAllotmentSummary(allotment), territory: territorySummary(territory) }, 201);
    }

    const applicationPhaseTwoUnlockMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/franchise_fee\/unlock$/);
    if (applicationPhaseTwoUnlockMatch && request.method === 'POST') {
      if (!canManageTerritory(request)) return failure(request, response, 'FORBIDDEN', 'Only a franchise manager or administrator can unlock the FOCO Phase 2 payment.', 403);
      const application = database.applications.find((item) => item.id === applicationPhaseTwoUnlockMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.franchise_model !== 'FOCO') return failure(request, response, 'PAYMENT_UNAVAILABLE', 'Phase 2 payment applies only to a FOCO franchise application.', 409);
      if (!territoryAllotted(application)) return failure(request, response, 'TERRITORY_ALLOTMENT_REQUIRED', 'Issue the Territory Allotment Letter before unlocking the FOCO Phase 2 payment.', 409);
      if (!paymentIsPaid(application, 'application_fee')) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'The FOCO application fee must be paid before Phase 2 can be unlocked.', 409);
      const phaseTwo = application.payments.find((payment) => payment.key === 'franchise_fee');
      if (!phaseTwo) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'FOCO Phase 2 payment was not found for this application.', 409);
      if (phaseTwo.status === 'paid') return failure(request, response, 'PAYMENT_ALREADY_PAID', 'The FOCO Phase 2 payment has already been received.', 409);
      if (phaseTwo.status === 'locked') {
        phaseTwo.status = 'due';
        application.stage = 'franchise_fee_due';
        application.updated_at = new Date().toISOString();
        applicationReviewHistory(application, 'foco_phase_2_payment_unlocked', 'Manager unlocked the FOCO Phase 2 franchise fee. The applicant must accept the current Phase 2 terms before payment.', request);
        await saveDatabase();
      }
      return success(request, response, applicationSummary(application));
    }

    const applicationSecurityDepositUnlockMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/security_deposit\/unlock$/);
    if (applicationSecurityDepositUnlockMatch && request.method === 'POST') {
      if (!canManageTerritory(request)) return failure(request, response, 'FORBIDDEN', 'Only a franchise manager or administrator can unlock the FOCO security deposit.', 403);
      const application = database.applications.find((item) => item.id === applicationSecurityDepositUnlockMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.franchise_model !== 'FOCO') return failure(request, response, 'PAYMENT_UNAVAILABLE', 'The security deposit applies only to a FOCO franchise application.', 409);
      if (!territoryAllotted(application)) return failure(request, response, 'TERRITORY_ALLOTMENT_REQUIRED', 'Issue the Territory Allotment Letter before unlocking the security deposit.', 409);
      if (!paymentIsPaid(application, 'franchise_fee')) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'The FOCO franchise fee must be paid before the security deposit can be unlocked.', 409);
      const phaseThree = application.payments.find((payment) => payment.key === 'security_deposit');
      if (!phaseThree) return failure(request, response, 'PAYMENT_UNAVAILABLE', 'FOCO Phase 3 payment was not found for this application.', 409);
      if (phaseThree.status === 'paid') return failure(request, response, 'PAYMENT_ALREADY_PAID', 'The FOCO security deposit has already been received.', 409);
      if (phaseThree.status === 'locked') {
        phaseThree.status = 'due';
        application.stage = 'security_deposit_due';
        application.updated_at = new Date().toISOString();
        applicationReviewHistory(application, 'foco_phase_3_payment_unlocked', 'Manager unlocked the FOCO security deposit. The applicant must accept the current Phase 3 terms before payment.', request);
        await saveDatabase();
      }
      return success(request, response, applicationSummary(application));
    }

    const applicationFieldVisitMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/field-visit$/);
    if (applicationFieldVisitMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can view a Field Visit link.', 403);
      const application = database.applications.find((item) => item.id === applicationFieldVisitMatch[1] && item.visible_to_admin);
      const visit = application?.field_visit;
      if (!application || !visit) return failure(request, response, 'FIELD_VISIT_NOT_FOUND', 'No Field Visit has been assigned to this application.', 404);
      return success(request, response, {
        application: applicationSummary(application),
        officer_submission_url: visit.status === 'approved' ? '' : `${adminBaseUrl}/?field-visit=${visit.secure_token}`,
      });
    }
    if (applicationFieldVisitMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can assign a Field Visit.', 403);
      const application = database.applications.find((item) => item.id === applicationFieldVisitMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!completedVideoKyc(application)) return failure(request, response, 'VIDEO_KYC_REQUIRED', 'Complete Video KYC before assigning a Field Visit.', 409);
      if (application.field_visit && !['rejected'].includes(application.field_visit.status)) return failure(request, response, 'FIELD_VISIT_ALREADY_ASSIGNED', 'A Field Visit is already assigned for this application.', 409);
      const body = await readJson(request);
      const officerName = text(body.officer_name, 120);
      const officerPhone = text(body.officer_phone, 30).replace(/[^0-9+ -]/g, '');
      if (!officerName || officerPhone.replace(/\D/g, '').length < 10) return failure(request, response, 'VALIDATION_ERROR', 'Enter the Field Visit Officer name and a valid contact number.', 400);
      const now = new Date().toISOString();
      const visit = { id: randomUUID(), secure_token: randomBytes(32).toString('hex'), status: 'assigned', officer_name: officerName, officer_phone: officerPhone, assigned_at: now, assigned_by: reviewActor(request), submitted_at: '', approved_at: '', approved_by: '', manager_remarks: '', report: null, history: [] };
      application.field_visit = visit;
      fieldVisitAudit(application, visit, 'field_visit_assigned', `Field Visit assigned to ${officerName} (${officerPhone}).`, request);
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, { application: applicationSummary(application), officer_submission_url: `${adminBaseUrl}/?field-visit=${visit.secure_token}` }, 201);
    }

    if (applicationFieldVisitMatch && request.method === 'PATCH') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can review a Field Visit.', 403);
      const application = database.applications.find((item) => item.id === applicationFieldVisitMatch[1] && item.visible_to_admin);
      const visit = application?.field_visit;
      if (!application || !visit) return failure(request, response, 'NOT_FOUND', 'Field Visit not found.', 404);
      if (visit.status === 'approved') return failure(request, response, 'FIELD_VISIT_LOCKED', 'The final Field Visit report is already approved and locked.', 409);
      const body = await readJson(request);
      const action = text(body.action, 20).toLowerCase();
      if (!['save', 'approve', 'reject'].includes(action)) return failure(request, response, 'VALIDATION_ERROR', 'Choose save, approve or reject for this Field Visit report.', 400);
      if (!visit.report && action !== 'reject') return failure(request, response, 'FIELD_VISIT_REPORT_REQUIRED', 'The Field Visit Officer must submit a report before manager review.', 409);
      const now = new Date().toISOString();
      if (visit.report && body.report && typeof body.report === 'object') {
        const report = body.report;
        const suppliedGoogleMapsUrl = text(report.google_maps_url, 1000);
        const googleMapsUrl = googleMapsLocationUrl(suppliedGoogleMapsUrl);
        if (suppliedGoogleMapsUrl && !googleMapsUrl) return failure(request, response, 'VALIDATION_ERROR', 'Enter a valid Google Maps location link.', 400);
        visit.report = {
          ...visit.report, visit_date: text(report.visit_date, 10) || visit.report.visit_date, site_address: text(report.site_address, 700),
          google_maps_url: googleMapsUrl,
          inspection_summary: text(report.inspection_summary, 5000) || visit.report.inspection_summary, property_condition: text(report.property_condition, 3000),
          documents_observed: text(report.documents_observed, 3000), recommendation: text(report.recommendation, 3000), officer_remarks: text(report.officer_remarks, 3000),
          site_photos: Array.isArray(visit.report.site_photos) ? visit.report.site_photos : [],
        };
      }
      visit.manager_remarks = text(body.manager_remarks, 3000);
      if (action === 'approve') {
        if (!visit.report?.inspection_summary) return failure(request, response, 'FIELD_VISIT_REPORT_REQUIRED', 'Add an inspection summary before approving the final report.', 409);
        visit.status = 'approved'; visit.approved_at = now; visit.approved_by = reviewActor(request);
        fieldVisitAudit(application, visit, 'field_visit_approved', 'Manager approved and locked the Field Visit report.', request);
      } else if (action === 'reject') {
        visit.status = 'rejected';
        fieldVisitAudit(application, visit, 'field_visit_rejected', `Manager requested a corrected Field Visit report.${visit.manager_remarks ? ` Note: ${visit.manager_remarks}` : ''}`, request);
      } else {
        visit.status = 'submitted';
        fieldVisitAudit(application, visit, 'field_visit_review_saved', 'Manager saved edits and remarks on the Field Visit report.', request);
      }
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, { application: applicationSummary(application), officer_submission_url: `${adminBaseUrl}/?field-visit=${visit.secure_token}` });
    }

    const applicationFieldVisitReportMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/field-visit\/report$/);
    if (applicationFieldVisitReportMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can download a Field Visit report.', 403);
      const application = database.applications.find((item) => item.id === applicationFieldVisitReportMatch[1] && item.visible_to_admin);
      if (!application?.field_visit || application.field_visit.status !== 'approved') return failure(request, response, 'FIELD_VISIT_REPORT_UNAVAILABLE', 'The final Field Visit report is available after manager approval.', 409);
      const safeApplicationNumber = receiptText(application.application_number, 50).replace(/[^A-Za-z0-9_-]/g, '') || 'application';
      return sendPdf(request, response, `Remedium-Lab-Field-Visit-${safeApplicationNumber}.pdf`, await fieldVisitReportPdf(application, application.field_visit));
    }

    const applicationBrandingMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/branding-signage$/);
    if (applicationBrandingMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can manage Branding Signage.', 403);
      const application = database.applications.find((item) => item.id === applicationBrandingMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const branding = application.branding_signage;
      return success(request, response, { application: applicationSummary(application), branding_signage: brandingSignageSummary(branding), vendor_submission_url: branding?.secure_token && branding.status !== 'approved' ? `${adminBaseUrl}/?branding-vendor=${branding.secure_token}` : '' });
    }
    if (applicationBrandingMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can manage Branding Signage.', 403);
      const application = database.applications.find((item) => item.id === applicationBrandingMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!brandingUnlocked(application)) return failure(request, response, 'BRANDING_LOCKED', application.franchise_model === 'FOCO' ? 'FOCO Branding Signage unlocks after the Territory Allotment Letter and a manager releases the Branding module.' : 'Branding Signage unlocks after Territory Allotment and the FOFO payment.', 409);
      const body = await readJson(request, 8_000_000); const now = new Date().toISOString();
      const branding = application.branding_signage && typeof application.branding_signage === 'object' ? application.branding_signage : { id: randomUUID(), secure_token: randomBytes(32).toString('hex'), status: 'not_started', vendor: null, materials: [], photographs: [], completion_details: '', manager_remarks: '', installation_cost: 0, invoice: null, history: [] };
      branding.materials = Array.isArray(branding.materials) ? branding.materials : [];
      const suppliedMaterials = Array.isArray(body.materials) ? body.materials.slice(0, 20) : [];
      for (const material of suppliedMaterials) { const title = text(material?.title, 160); const url = text(material?.url, 1000); if (title && /^https?:\/\//i.test(url)) branding.materials.push({ id: randomUUID(), title, url, uploaded_at: now }); }
      if (body.material_data_url) { const materialFile = await storeApplicationUpload(application, 'branding-material', body.material_data_url, body.material_name); if (!materialFile) return failure(request, response, 'MATERIAL_INVALID', 'Upload a valid PDF, PNG, JPG or WEBP branding material smaller than 5 MB.', 400); branding.materials.push({ ...materialFile, title: text(body.material_title, 160) || materialFile.name }); }
      branding.materials = branding.materials.slice(-30);
      const vendorName = text(body.vendor_name, 120); const shopName = text(body.vendor_shop_name, 160); const vendorAddress = text(body.vendor_address, 700); const vendorPhone = text(body.vendor_phone, 30).replace(/[^0-9+ -]/g, '');
      if (vendorName || shopName || vendorAddress || vendorPhone) {
        if (!vendorName || !shopName || !vendorAddress || vendorPhone.replace(/\D/g, '').length < 10) return failure(request, response, 'VENDOR_INVALID', 'Enter the branding vendor name, shop name, address and a valid contact number.', 400);
        branding.vendor = { name: vendorName, shop_name: shopName, address: vendorAddress, phone: vendorPhone };
        branding.status = branding.status === 'approved' ? 'approved' : 'vendor_assigned';
        applicationWorkflowAudit(application, branding, 'branding_vendor_assigned', `Branding vendor ${vendorName} (${shopName}) assigned with a secure completion link.`, request);
      } else if (!application.branding_signage) applicationWorkflowAudit(application, branding, 'branding_signage_prepared', 'Branding Signage workspace prepared by the franchise manager.', request);
      application.branding_signage = branding; application.updated_at = now; await saveDatabase();
      return success(request, response, { application: applicationSummary(application), branding_signage: brandingSignageSummary(branding), vendor_submission_url: branding.secure_token && branding.status !== 'approved' ? `${adminBaseUrl}/?branding-vendor=${branding.secure_token}` : '' });
    }
    if (applicationBrandingMatch && request.method === 'PATCH') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can review Branding Signage.', 403);
      const application = database.applications.find((item) => item.id === applicationBrandingMatch[1] && item.visible_to_admin); const branding = application?.branding_signage;
      if (!application || !branding) return failure(request, response, 'BRANDING_NOT_FOUND', 'Assign a branding vendor before reviewing the installation.', 404);
      if (branding.status === 'approved') return failure(request, response, 'BRANDING_LOCKED', 'Approved Branding Signage work is locked.', 409);
      const body = await readJson(request, 8_000_000); const action = text(body.action, 30).toLowerCase();
      if (!['save', 'approve', 'reject', 'request_correction'].includes(action)) return failure(request, response, 'VALIDATION_ERROR', 'Choose save, approve, reject or request correction.', 400);
      const now = new Date().toISOString(); branding.manager_remarks = text(body.manager_remarks, 3000); const cost = Number(body.installation_cost); if (Number.isFinite(cost) && cost >= 0) branding.installation_cost = Math.round(cost * 100) / 100;
      if (body.invoice_data_url) { const invoice = await storeApplicationUpload(application, 'branding-invoice', body.invoice_data_url, body.invoice_name); if (!invoice) return failure(request, response, 'INVOICE_INVALID', 'Upload a valid invoice PDF or image smaller than 5 MB.', 400); branding.invoice = invoice; }
      if (action === 'approve') {
        if (!Array.isArray(branding.photographs) || !branding.photographs.length) return failure(request, response, 'BRANDING_EVIDENCE_REQUIRED', 'The vendor must submit at least one branding installation photograph before approval.', 409);
        if (!(Number(branding.installation_cost) > 0)) return failure(request, response, 'BRANDING_AMOUNT_REQUIRED', 'The vendor must submit a total installation amount before approval.', 409);
        if (!branding.invoice) return failure(request, response, 'BRANDING_INVOICE_REQUIRED', 'The vendor must upload a bill/invoice before approval.', 409);
        branding.status = 'approved'; branding.approved_at = now; branding.approved_by = reviewActor(request);
        const voucher = createBrandingPaymentVoucher(application, branding, reviewActor(request));
        applicationWorkflowAudit(application, branding, 'branding_signage_approved', `Manager approved branding installation for ₹${Number(branding.installation_cost).toLocaleString('en-IN')}. Payment voucher ${voucher.voucher_number} created for the accountant.`, request);
        workflowNotify({
          module: 'payments',
          action: 'branding_payment_voucher',
          title: 'Branding payment voucher ready',
          message: `${voucher.voucher_number}: pay ₹${Number(voucher.amount).toLocaleString('en-IN')} to ${voucher.vendor_name || 'branding vendor'} for ${application.application_number}.`,
          actor: { name: reviewActor(request), role: 'manager' },
          href: 'admin:Payments:vouchers',
          entityType: 'payment_voucher',
          entityId: voucher.id,
        });
      }
      else if (action === 'reject') { branding.status = 'rejected'; applicationWorkflowAudit(application, branding, 'branding_signage_rejected', `Manager rejected the branding installation. Vendor may resubmit amount, bill and evidence from the same secure link.${branding.manager_remarks ? ` Note: ${branding.manager_remarks}` : ''}`, request); }
      else if (action === 'request_correction') { branding.status = 'revision_requested'; applicationWorkflowAudit(application, branding, 'branding_signage_correction_requested', `Manager requested corrected branding amount, bill or evidence. Vendor may resubmit from the same secure link.${branding.manager_remarks ? ` Note: ${branding.manager_remarks}` : ''}`, request); }
      else { applicationWorkflowAudit(application, branding, 'branding_signage_review_saved', 'Manager saved Branding Signage review details.', request); }
      application.updated_at = now; await saveDatabase();
      return success(request, response, { application: applicationSummary(application), branding_signage: brandingSignageSummary(branding), vendor_submission_url: branding.secure_token && branding.status !== 'approved' ? `${adminBaseUrl}/?branding-vendor=${branding.secure_token}` : '', payment_voucher: branding.payment_voucher_id ? paymentVoucherSummary(ensurePaymentVouchersArray().find((item) => item.id === branding.payment_voucher_id)) : null });
    }

    const applicationHrProcessMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/hr-process$/);
    if (applicationHrProcessMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can manage HR Process.', 403);
      const application = database.applications.find((item) => item.id === applicationHrProcessMatch[1] && item.visible_to_admin); const hr = application?.hr_process;
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      return success(request, response, { application: applicationSummary(application), hr_process: hrProcessSummary(hr), hr_submission_url: hr?.secure_token && hr.status !== 'approved' ? `${adminBaseUrl}/?hr-process=${hr.secure_token}` : '' });
    }
    if (applicationHrProcessMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can manage HR Process.', 403);
      const application = database.applications.find((item) => item.id === applicationHrProcessMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!hrUnlocked(application)) return failure(request, response, 'HR_PROCESS_LOCKED', 'HR Process is available only for a FOCO franchise after Territory Allotment and a manager releases the HR module.', 409);
      const hr = application.hr_process && typeof application.hr_process === 'object' ? application.hr_process : { id: randomUUID(), secure_token: randomBytes(32).toString('hex'), status: 'assigned', employees: [], manager_remarks: '', history: [] };
      if (hr.status !== 'approved') hr.status = 'assigned'; application.hr_process = hr; application.updated_at = new Date().toISOString();
      applicationWorkflowAudit(application, hr, 'hr_process_assigned', 'Secure HR employee-onboarding submission link generated.', request); await saveDatabase();
      return success(request, response, { application: applicationSummary(application), hr_process: hrProcessSummary(hr), hr_submission_url: `${adminBaseUrl}/?hr-process=${hr.secure_token}` }, 201);
    }
    if (applicationHrProcessMatch && request.method === 'PATCH') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can review HR Process.', 403);
      const application = database.applications.find((item) => item.id === applicationHrProcessMatch[1] && item.visible_to_admin); const hr = application?.hr_process;
      if (!application || !hr) return failure(request, response, 'HR_PROCESS_NOT_FOUND', 'Generate the HR submission link before reviewing employee details.', 404);
      if (hr.status === 'approved') return failure(request, response, 'HR_PROCESS_LOCKED', 'Approved HR records are locked.', 409);
      const body = await readJson(request); const action = text(body.action, 30).toLowerCase(); if (!['save', 'approve', 'reject', 'request_correction'].includes(action)) return failure(request, response, 'VALIDATION_ERROR', 'Choose save, approve, reject or request correction.', 400);
      if (action === 'approve' && (!Array.isArray(hr.employees) || !hr.employees.length)) return failure(request, response, 'HR_EMPLOYEES_REQUIRED', 'HR must submit employee records before approval.', 409);
      hr.manager_remarks = text(body.manager_remarks, 3000); const now = new Date().toISOString();
      if (action === 'approve') { hr.status = 'approved'; hr.approved_at = now; hr.approved_by = reviewActor(request); applicationWorkflowAudit(application, hr, 'hr_process_approved', 'Manager approved the FOCO employee onboarding records and Offer Letters.', request); }
      else if (action === 'reject') { hr.status = 'rejected'; applicationWorkflowAudit(application, hr, 'hr_process_rejected', `Manager rejected the HR submission.${hr.manager_remarks ? ` Note: ${hr.manager_remarks}` : ''}`, request); }
      else if (action === 'request_correction') { hr.status = 'revision_requested'; applicationWorkflowAudit(application, hr, 'hr_process_correction_requested', `Manager requested HR corrections.${hr.manager_remarks ? ` Note: ${hr.manager_remarks}` : ''}`, request); }
      else { applicationWorkflowAudit(application, hr, 'hr_process_review_saved', 'Manager saved HR onboarding review notes.', request); }
      application.updated_at = now; await saveDatabase();
      return success(request, response, { application: applicationSummary(application), hr_process: hrProcessSummary(hr), hr_submission_url: hr.secure_token && hr.status !== 'approved' ? `${adminBaseUrl}/?hr-process=${hr.secure_token}` : '' });
    }

    const onboardingDocumentRequestMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/onboarding-documents$/);
    if (onboardingDocumentRequestMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can request onboarding documents.', 403);
      const application = database.applications.find((item) => item.id === onboardingDocumentRequestMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const body = await readJson(request);
      const title = text(body.title, 160);
      const description = text(body.description, 1500);
      const requiredCount = Math.floor(Number(body.required_count) || 1);
      if (!title || requiredCount < 1 || requiredCount > 100) return failure(request, response, 'VALIDATION_ERROR', 'Enter a document title and a required file count between 1 and 100.', 400);
      application.onboarding_documents = onboardingDocumentsFor(application);
      const requested = { id: randomUUID(), title, description, required_count: requiredCount, requested_at: new Date().toISOString(), requested_by: reviewActor(request), files: [] };
      application.onboarding_documents.push(requested);
      applicationReviewHistory(application, 'onboarding_document_requested', `${title} requested from the applicant (${requiredCount} file${requiredCount === 1 ? '' : 's'} required).`, request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application), 201);
    }

    const onboardingDocumentReviewMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/onboarding-documents\/([^/]+)\/files\/([^/]+)\/review$/);
    if (onboardingDocumentReviewMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can review onboarding documents.', 403);
      const application = database.applications.find((item) => item.id === onboardingDocumentReviewMatch[1] && item.visible_to_admin);
      const document = application && onboardingDocumentRecord(application, onboardingDocumentReviewMatch[2]);
      const file = document?.files?.find((item) => item.id === onboardingDocumentReviewMatch[3]);
      if (!application || !document || !file) return failure(request, response, 'NOT_FOUND', 'Onboarding document file not found.', 404);
      if (file.status === 'superseded') return failure(request, response, 'DOCUMENT_SUPERSEDED', 'This file has already been replaced by the applicant.', 409);
      const body = await readJson(request);
      const action = text(body.action, 20).toLowerCase();
      if (!['verify', 'reupload', 'reject'].includes(action)) return failure(request, response, 'VALIDATION_ERROR', 'Choose verify, request upload again or reject.', 400);
      const now = new Date().toISOString();
      file.status = action === 'verify' ? 'verified' : action === 'reupload' ? 'reupload_requested' : 'rejected';
      file.remarks = text(body.remarks, 3000); file.reviewed_at = now; file.reviewed_by = reviewActor(request);
      file.history = Array.isArray(file.history) ? file.history : [];
      file.history.push({ id: randomUUID(), type: action, message: action === 'verify' ? 'Document verified.' : action === 'reupload' ? `Applicant asked to upload again.${file.remarks ? ` ${file.remarks}` : ''}` : `Document rejected.${file.remarks ? ` ${file.remarks}` : ''}`, actor: file.reviewed_by, created_at: now });
      applicationReviewHistory(application, `onboarding_document_${action}`, `${document.title} - file ${file.slot} ${action === 'verify' ? 'verified' : action === 'reupload' ? 'marked for applicant upload again' : 'rejected'}.`, request);
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const applicationDocumentReviewMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/documents\/(photo|pan|aadhaar|voter)$/);
    if (applicationDocumentReviewMatch && request.method === 'PATCH') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can verify application documents.', 403);
      const application = database.applications.find((item) => item.id === applicationDocumentReviewMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const kind = applicationDocumentReviewMatch[2];
      if (!application.documents?.[kind]?.url) return failure(request, response, 'DOCUMENT_NOT_FOUND', 'The applicant has not uploaded this document.', 404);
      const body = await readJson(request);
      const verified = body.verified !== false;
      application.document_verifications = application.document_verifications && typeof application.document_verifications === 'object' ? application.document_verifications : {};
      application.document_verifications[kind] = verified
        ? { status: 'verified', verified_at: new Date().toISOString(), verified_by: reviewActor(request) }
        : { status: 'upload_requested', verified_at: '', verified_by: '' };
      applicationReviewHistory(application, verified ? 'document_verified' : 'document_upload_again_requested', `${kind === 'photo' ? 'Applicant photograph' : kind === 'pan' ? 'PAN card' : kind === 'aadhaar' ? 'Aadhaar card' : 'Voter ID card'} ${verified ? 'verified' : 'marked for applicant upload again'}.`, request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const applicationContactMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/contact-details$/);
    if (applicationContactMatch && request.method === 'PATCH') {
      if (!requirePermission(request, response, 'applicants')) return;
      const session = sessionFor(request);
      const role = normalizeRole(session?.role ?? '');
      if (!['super_admin', 'manager'].includes(role)) return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can update applicant contact details from the franchise application form.', 403);
      const application = database.applications.find((item) => item.id === applicationContactMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const body = await readJson(request);
      const result = await updateApplicantProfileFromManager(application, body, request);
      if (result.error) return failure(request, response, result.error, result.message, result.status ?? 400);
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const applicationProfileMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/applicant-profile$/);
    if (applicationProfileMatch && request.method === 'PATCH') {
      if (!requirePermission(request, response, 'applicants')) return;
      const session = sessionFor(request);
      const role = normalizeRole(session?.role ?? '');
      if (!['super_admin', 'manager'].includes(role)) return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can update applicant profile details.', 403);
      const application = database.applications.find((item) => item.id === applicationProfileMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const body = await readJson(request);
      const result = await updateApplicantProfileFromManager(application, body, request);
      if (result.error) return failure(request, response, result.error, result.message, result.status ?? 400);
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const applicationPaymentScheduleMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payment-schedule$/);
    if (applicationPaymentScheduleMatch && request.method === 'PATCH') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      if (!['super_admin', 'manager'].includes(String(session.role ?? '').replace('franchise_manager', 'manager'))) {
        return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can edit the FOCO payment schedule.', 403);
      }
      const application = database.applications.find((item) => item.id === applicationPaymentScheduleMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.franchise_model !== 'FOCO') return failure(request, response, 'NOT_FOCO', 'Variable payment scheduling applies only to FOCO applications.', 409);
      const body = await readJson(request);
      ensureFocoPaymentSchedule(application);
      const actor = reviewActor(request);
      const phaseAmounts = body.phase_amounts && typeof body.phase_amounts === 'object' ? body.phase_amounts : {};
      const updates = [];
      for (const [phaseKey, rawAmount] of Object.entries(phaseAmounts)) {
        const result = setPhaseScheduledAmount(application, text(phaseKey, 40), rawAmount, actor);
        if (result.error) return failure(request, response, result.error, result.message, result.error === 'SCHEDULE_OVERFLOW' ? 409 : 400);
        updates.push(`${phaseKey}: ₹${Number(result.scheduled_amount).toLocaleString('en-IN')}`);
      }
      if (body.auto_recalculate === true || (!updates.length && body.recalculate === true)) {
        recalculateFocoRemainingPhases(application, { actor });
        applicationReviewHistory(application, 'foco_payment_schedule_recalculated', `FOCO remaining balance auto-adjusted across unpaid phases. Remaining payable: ₹${focoTotalRemaining(application).toLocaleString('en-IN')}.`, request);
      }
      if (!updates.length && body.auto_recalculate !== true && body.recalculate !== true) {
        return failure(request, response, 'NO_CHANGES', 'Provide phase_amounts or set recalculate to true.', 400);
      }
      if (updates.length) {
        applicationReviewHistory(application, 'foco_payment_schedule_updated', `Manager updated FOCO payment schedule — ${updates.join('; ')}. Remaining payable: ₹${focoTotalRemaining(application).toLocaleString('en-IN')}.`, request);
      }
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, {
        application: applicationSummary(application),
        payment_schedule: paymentScheduleSummary(application),
      });
    }

    const applicationPaymentRecordMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/([^/]+)\/record$/);
    if (applicationPaymentRecordMatch && request.method === 'POST') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      if (!['super_admin', 'manager', 'accountant'].includes(String(session.role ?? '').replace('franchise_manager', 'manager'))) {
        return failure(request, response, 'FORBIDDEN', 'Only a manager or accountant can record a direct FOCO payment.', 403);
      }
      const application = database.applications.find((item) => item.id === applicationPaymentRecordMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.franchise_model !== 'FOCO') return failure(request, response, 'NOT_FOCO', 'Variable manager payment recording applies only to FOCO applications.', 409);
      const phaseKey = applicationPaymentRecordMatch[2];
      const body = await readJson(request);
      const actor = reviewActor(request);
      const result = recordManagerDirectPayment(application, phaseKey, body, actor);
      if (result.error) return failure(request, response, result.error, result.message, result.error === 'ALREADY_PAID' ? 409 : 400);
      await finalizeVerifiedPayment(application, result.payment, request);
      applicationReviewHistory(
        application,
        'foco_variable_payment_recorded',
        `Manager recorded ${result.payment.label} of ₹${Number(result.amount).toLocaleString('en-IN')}. Remaining FOCO payable: ₹${focoTotalRemaining(application).toLocaleString('en-IN')}.`,
        request,
      );
      await saveDatabase();
      return success(request, response, {
        application: applicationSummary(application),
        payment: paymentPhaseDetail(result.payment),
        payment_schedule: paymentScheduleSummary(application),
      });
    }

    const onboardingModuleReleaseMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/onboarding-modules\/(branding|hr)\/release$/);
    if (onboardingModuleReleaseMatch && request.method === 'POST') {
      if (!canManageTerritory(request)) return failure(request, response, 'FORBIDDEN', 'Only a franchise manager or administrator can release onboarding modules.', 403);
      const application = database.applications.find((item) => item.id === onboardingModuleReleaseMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!territoryAllotted(application)) return failure(request, response, 'TERRITORY_ALLOTMENT_REQUIRED', 'Issue the Territory Allotment Letter before releasing onboarding modules.', 409);
      const moduleKey = onboardingModuleReleaseMatch[2];
      const modules = ensureOnboardingModules(application, { territoryAllotted, paymentIsPaid });
      const actor = reviewActor(request);
      const now = new Date().toISOString();
      if (moduleKey === 'branding') {
        if (modules.branding_released) return failure(request, response, 'ALREADY_RELEASED', 'Branding Signage is already released for this applicant.', 409);
        modules.branding_released = true;
        modules.branding_released_at = now;
        modules.branding_released_by = actor;
        applicationReviewHistory(application, 'branding_module_released', 'Manager released Branding Signage for the applicant portal.', request);
        workflowNotify({
          module: 'applications',
          action: 'branding_module_released',
          title: 'Branding module released',
          message: `${application.full_name} · Branding Signage is now available in the applicant portal.`,
          actor: workflowActor(request),
          href: `admin:Applicants:${application.id}`,
          portalHref: 'portal:application',
          entityType: 'application',
          entityId: application.id,
          applicationId: application.id,
          applicantOnly: true,
        });
      } else {
        if (application.franchise_model !== 'FOCO') return failure(request, response, 'NOT_FOCO', 'HR Process release applies only to FOCO applications.', 409);
        if (modules.hr_released) return failure(request, response, 'ALREADY_RELEASED', 'HR Process is already released for this applicant.', 409);
        modules.hr_released = true;
        modules.hr_released_at = now;
        modules.hr_released_by = actor;
        applicationReviewHistory(application, 'hr_module_released', 'Manager released HR Process for the applicant portal.', request);
        workflowNotify({
          module: 'applications',
          action: 'hr_module_released',
          title: 'HR module released',
          message: `${application.full_name} · HR Process is now available in the applicant portal.`,
          actor: workflowActor(request),
          href: `admin:Applicants:${application.id}`,
          portalHref: 'portal:application',
          entityType: 'application',
          entityId: application.id,
          applicationId: application.id,
          applicantOnly: true,
        });
      }
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/agreements/queue') {
      if (!requirePermission(request, response, 'agreements')) return;
      const queue = database.applications.filter((item) => item.visible_to_admin && agreementQueueEligible(item)).map(agreementQueueItem).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return success(request, response, queue);
    }

    if (request.method === 'GET' && route === '/api/v1/admin/payments/ledger') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      const rows = paymentLedgerForApplications(database.applications);
      return success(request, response, { rows, metrics: paymentLedgerMetrics(rows) });
    }

    if (request.method === 'GET' && route === '/api/v1/admin/payment-vouchers') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      const vouchers = ensurePaymentVouchersArray()
        .map(paymentVoucherSummary)
        .filter(Boolean)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const pending = vouchers.filter((item) => item.status === 'pending_payment');
      return success(request, response, {
        vouchers,
        metrics: {
          pending_payment: pending.length,
          pending_amount: pending.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
          paid: vouchers.filter((item) => item.status === 'paid').length,
          total: vouchers.length,
        },
      });
    }

    const adminPaymentVoucherMatch = route.match(/^\/api\/v1\/admin\/payment-vouchers\/([^/]+)$/);
    if (adminPaymentVoucherMatch && request.method === 'PATCH') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      if (!['super_admin', 'manager', 'accountant'].includes(String(session.role ?? '').replace('franchise_manager', 'manager'))) {
        return failure(request, response, 'FORBIDDEN', 'Only an administrator, manager or accountant can update payment vouchers.', 403);
      }
      const voucher = ensurePaymentVouchersArray().find((item) => item.id === adminPaymentVoucherMatch[1]);
      if (!voucher) return failure(request, response, 'NOT_FOUND', 'Payment voucher not found.', 404);
      const body = await readJson(request);
      const action = text(body.action, 30).toLowerCase();
      const now = new Date().toISOString();
      if (action === 'mark_paid') {
        if (voucher.status === 'paid') return failure(request, response, 'VOUCHER_ALREADY_PAID', 'This payment voucher is already marked as paid.', 409);
        voucher.status = 'paid';
        voucher.paid_at = now;
        voucher.paid_by = reviewActor(request);
        voucher.remarks = text(body.remarks, 3000) || voucher.remarks || '';
        voucher.updated_at = now;
      } else if (action === 'save') {
        voucher.remarks = text(body.remarks, 3000) || voucher.remarks || '';
        voucher.updated_at = now;
      } else {
        return failure(request, response, 'VALIDATION_ERROR', 'Choose mark_paid or save.', 400);
      }
      await saveDatabase();
      return success(request, response, { voucher: paymentVoucherSummary(voucher) });
    }

    const adminPaymentDetailMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/detail$/);
    if (adminPaymentDetailMatch && request.method === 'GET') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      const application = database.applications.find((item) => item.id === adminPaymentDetailMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      return success(request, response, paymentDetailForApplication(application, session.role, { adminBasePath: '/api/v1/admin' }));
    }

    const adminPaymentReceiptMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/([^/]+)\/receipt$/);
    if (adminPaymentReceiptMatch && request.method === 'GET') {
      if (!requirePermission(request, response, 'payments')) return;
      const application = database.applications.find((item) => item.id === adminPaymentReceiptMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const payment = application.payments.find((item) => item.key === adminPaymentReceiptMatch[2]);
      if (!payment || payment.status !== 'paid' || !payment.receipt_number) return failure(request, response, 'RECEIPT_UNAVAILABLE', 'A receipt is available only after this payment is successfully recorded.', 404);
      const receiptName = receiptText(payment.receipt_number, 50).replace(/[^A-Za-z0-9_-]/g, '') || 'receipt';
      return sendPdf(request, response, `Remedium-Lab-${receiptName}.pdf`, await paymentReceiptPdf(application, payment));
    }

    const adminPaymentVerifyMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/([^/]+)\/verify$/);
    if (adminPaymentVerifyMatch && request.method === 'POST') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      if (!['super_admin', 'manager', 'accountant'].includes(String(session.role ?? '').replace('franchise_manager', 'manager'))) {
        return failure(request, response, 'FORBIDDEN', 'Only an administrator, manager or accountant can verify payments.', 403);
      }
      const application = database.applications.find((item) => item.id === adminPaymentVerifyMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const payment = application.payments.find((item) => item.key === adminPaymentVerifyMatch[2]);
      if (!payment) return failure(request, response, 'NOT_FOUND', 'Payment phase not found.', 404);
      const result = await verifyPaymentRecord(application, payment, request);
      if (result.error) return failure(request, response, result.error, result.message, 409);
      await saveDatabase();
      return success(request, response, paymentDetailForApplication(application, session.role, { adminBasePath: '/api/v1/admin' }));
    }

    const adminPaymentRejectMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/([^/]+)\/reject$/);
    if (adminPaymentRejectMatch && request.method === 'POST') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      if (!['super_admin', 'manager', 'accountant'].includes(String(session.role ?? '').replace('franchise_manager', 'manager'))) {
        return failure(request, response, 'FORBIDDEN', 'Only an administrator, manager or accountant can reject payment submissions.', 403);
      }
      const application = database.applications.find((item) => item.id === adminPaymentRejectMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const payment = application.payments.find((item) => item.key === adminPaymentRejectMatch[2]);
      if (!payment) return failure(request, response, 'NOT_FOUND', 'Payment phase not found.', 404);
      const body = await readJson(request);
      const remarks = text(body.remarks ?? body.reason, 2000);
      if (!remarks) return failure(request, response, 'REMARKS_REQUIRED', 'Enter remarks explaining why this payment submission is rejected.', 422);
      const result = await rejectPaymentRecord(application, payment, remarks, request);
      if (result.error) return failure(request, response, result.error, result.message, 409);
      await saveDatabase();
      return success(request, response, paymentDetailForApplication(application, session.role, { adminBasePath: '/api/v1/admin' }));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/coupons') {
      if (!requirePermission(request, response, 'payments')) return;
      if (!canManageCoupons(request)) return failure(request, response, 'FORBIDDEN', 'Only an administrator or accountant can manage coupon codes.', 403);
      ensureCouponsArray(database);
      const coupons = database.coupons.map((coupon) => couponSummary(database, coupon)).sort((first, second) => second.updated_at.localeCompare(first.updated_at));
      return success(request, response, coupons);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/coupons') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      if (!canManageCoupons(request)) return failure(request, response, 'FORBIDDEN', 'Only an administrator or accountant can create coupon codes.', 403);
      ensureCouponsArray(database);
      const body = await readJson(request);
      const actor = reviewActor(request);
      const built = couponRecordFromBody(body, actor);
      if (built.error) return failure(request, response, 'VALIDATION_ERROR', built.error, 400);
      if (database.coupons.some((item) => normalizeCouponCode(item.code) === built.record.code)) {
        return failure(request, response, 'COUPON_EXISTS', 'This coupon code is already in use.', 409);
      }
      database.coupons.unshift(built.record);
      await saveDatabase();
      return success(request, response, couponSummary(database, built.record), 201);
    }

    if (request.method === 'GET' && route === '/api/v1/admin/coupons/usages') {
      if (!requirePermission(request, response, 'payments')) return;
      if (!canManageCoupons(request)) return failure(request, response, 'FORBIDDEN', 'Only an administrator or accountant can view coupon usage history.', 403);
      ensureCouponsArray(database);
      const couponId = text(new URL(request.url, 'http://localhost').searchParams.get('coupon_id'), 80);
      const usages = database.coupon_usages
        .filter((item) => !couponId || item.coupon_id === couponId)
        .map(couponUsageSummary)
        .sort((first, second) => second.redeemed_at.localeCompare(first.redeemed_at));
      return success(request, response, usages);
    }

    const adminCouponMatch = route.match(/^\/api\/v1\/admin\/coupons\/([^/]+)$/);
    if (adminCouponMatch && request.method === 'GET') {
      if (!requirePermission(request, response, 'payments')) return;
      if (!canManageCoupons(request)) return failure(request, response, 'FORBIDDEN', 'Only an administrator or accountant can view coupon details.', 403);
      ensureCouponsArray(database);
      const coupon = database.coupons.find((item) => item.id === adminCouponMatch[1]);
      if (!coupon) return failure(request, response, 'NOT_FOUND', 'Coupon not found.', 404);
      return success(request, response, couponSummary(database, coupon));
    }

    if (adminCouponMatch && request.method === 'PATCH') {
      const session = requirePermission(request, response, 'payments');
      if (!session) return;
      if (!canManageCoupons(request)) return failure(request, response, 'FORBIDDEN', 'Only an administrator or accountant can update coupon codes.', 403);
      ensureCouponsArray(database);
      const index = database.coupons.findIndex((item) => item.id === adminCouponMatch[1]);
      if (index < 0) return failure(request, response, 'NOT_FOUND', 'Coupon not found.', 404);
      const current = database.coupons[index];
      const body = await readJson(request);
      const patched = applyCouponPatch(current, { ...body, updated_by: reviewActor(request) }, database);
      if (patched.error) return failure(request, response, 'COUPON_LOCKED', patched.error, 409);
      const duplicate = database.coupons.some((item, itemIndex) => itemIndex !== index && normalizeCouponCode(item.code) === patched.record.code);
      if (duplicate) return failure(request, response, 'COUPON_EXISTS', 'This coupon code is already in use.', 409);
      database.coupons[index] = { ...patched.record, updated_by: reviewActor(request) };
      await saveDatabase();
      return success(request, response, couponSummary(database, patched.record));
    }

    if (adminCouponMatch && request.method === 'DELETE') {
      if (!requirePermission(request, response, 'payments')) return;
      if (!canManageCoupons(request)) return failure(request, response, 'FORBIDDEN', 'Only an administrator or accountant can delete coupon codes.', 403);
      ensureCouponsArray(database);
      const index = database.coupons.findIndex((item) => item.id === adminCouponMatch[1]);
      if (index < 0) return failure(request, response, 'NOT_FOUND', 'Coupon not found.', 404);
      if (couponHasCompletedUsage(database, database.coupons[index].id)) {
        return failure(request, response, 'COUPON_IN_USE', 'Coupons used in completed transactions cannot be deleted. Deactivate the coupon instead.', 409);
      }
      database.coupons.splice(index, 1);
      database.coupon_usages = database.coupon_usages.filter((item) => item.coupon_id !== adminCouponMatch[1]);
      await saveDatabase();
      return success(request, response, { deleted: true });
    }

    const agreementProceedMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/proceed$/);
    if (agreementProceedMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can proceed to final agreement.', 403);
      const application = agreementApplicationRecord(agreementProceedMatch[1]);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!agreementEligibleForProceed(application)) return failure(request, response, 'AGREEMENT_NOT_READY', 'Proceed to final agreement is available only after the final payment or branding stage is verified.', 409);
      const body = await readJson(request);
      const actor = reviewActor(request);
      createAgreementWorkflow(application, actor);
      application.review_notes = text(body.review_notes, 2_000);
      applicationReviewHistory(application, 'agreement_process_started', 'Manager proceeded to final agreement. Agreement process started and queued for the Agreement Module.', request);
      agreementAudit(application.agreement_workflow, 'agreement_process_started', 'Agreement process started from Manual Application Review.', actor);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, { application: applicationSummary(application), queue_item: agreementQueueItem(application) });
    }

    const agreementEstampMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/estamp$/);
    if (agreementEstampMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can upload an e-Stamp certificate.', 403);
      const application = agreementApplicationRecord(agreementEstampMatch[1]);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found for this application.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status === 'executed') return failure(request, response, 'AGREEMENT_LOCKED', 'This agreement has already been executed.', 409);
      const body = await readJson(request, 12_000_000);
      const state = text(body.state, 80);
      const stampDutyValue = Number(body.stamp_duty_value);
      const purpose = text(body.purpose, 240);
      const executionDate = text(body.execution_date, 10);
      const certificateNumber = text(body.certificate_number, 120);
      const uin = text(body.uin, 120);
      const vendor = text(body.vendor, 180);
      if (!state || !purpose || !certificateNumber || !vendor || !isIsoDate(executionDate) || !Number.isFinite(stampDutyValue) || stampDutyValue <= 0) {
        return failure(request, response, 'VALIDATION_ERROR', 'Enter State, Stamp Duty Value, Purpose of Stamp, Execution Date, e-Stamp Certificate Number and Vendor/Issuing Authority.', 400);
      }
      const certificate = await storeApplicationUpload(application, 'estamp', body.certificate?.data_url ?? body.data_url, body.certificate?.name ?? body.name ?? 'e-stamp-certificate.pdf');
      if (!certificate) return failure(request, response, 'VALIDATION_ERROR', 'Upload the official e-Stamp certificate PDF.', 400);
      const actor = reviewActor(request);
      workflow.estamp = {
        state, stamp_duty_value: stampDutyValue, purpose, execution_date: executionDate, certificate_number: certificateNumber, uin, vendor, certificate,
        verified_at: new Date().toISOString(), verified_by: actor,
      };
      workflow.status = 'estamp_verified';
      agreementAudit(workflow, 'estamp_verified', `e-Stamp certificate ${certificateNumber} verified and permanently linked to the application.`, actor);
      applicationReviewHistory(application, 'estamp_verified', `Official e-Stamp certificate ${certificateNumber} verified for ${state}.`, request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementUploadMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/upload$/);
    if (agreementUploadMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can upload the final agreement document.', 403);
      const application = agreementApplicationRecord(agreementUploadMatch[1]);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found for this application.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status === 'executed') return failure(request, response, 'AGREEMENT_LOCKED', 'This agreement has already been executed.', 409);
      if (!workflow.estamp?.verified_at) return failure(request, response, 'ESTAMP_REQUIRED', 'Verify the e-Stamp certificate before uploading the final agreement.', 409);
      const body = await readJson(request, 32_000_000);
      const fileData = agreementDocumentData(body.file?.data_url ?? body.data_url);
      if (!fileData) return failure(request, response, 'VALIDATION_ERROR', 'Upload the final agreement as a valid PDF up to 32 MB.', 400);
      const actor = reviewActor(request);
      await mkdir(uploadsDirectory, { recursive: true });
      const safeName = text(body.file?.name ?? body.name, 180).replace(/[^A-Za-z0-9._-]/g, '_') || 'final-agreement.pdf';
      const filename = `agreement-${application.id}-${Date.now()}-${randomBytes(4).toString('hex')}-${safeName.replace(/\.[^.]+$/, '')}.pdf`;
      await writeFile(path.join(uploadsDirectory, filename), fileData.bytes);
      const uploadedFile = { id: randomUUID(), name: safeName.replace(/\.[^.]+$/, '') + '.pdf', url: `/uploads/${filename}`, mime: 'application/pdf', uploaded_at: new Date().toISOString(), uploaded_by: actor };
      workflow.document = workflow.document && typeof workflow.document === 'object' ? workflow.document : {};
      workflow.document.uploaded_file = uploadedFile;
      workflow.document.aadhaar_signed_file = null;
      workflow.document.executed_file = null;
      workflow.document.sent_to_applicant_at = '';
      clearApplicantEsignState(workflow);
      workflow.status = 'draft_ready';
      pushAgreementVersion(workflow, { type: 'uploaded', name: uploadedFile.name, url: uploadedFile.url, mime: uploadedFile.mime, actor, reference: workflow.reference_number, message: workflow.applicant?.correction_request?.trim() ? `Corrected agreement PDF uploaded in response to applicant request: ${workflow.applicant.correction_request.trim()}` : 'Final agreement document uploaded after merging the approved template with the e-Stamp certificate.' });
      agreementAudit(workflow, 'agreement_uploaded', workflow.applicant?.correction_request?.trim() ? `Corrected agreement PDF uploaded by ${actor} after applicant correction request.` : `Final agreement PDF uploaded by ${actor}.`, actor);
      applicationReviewHistory(application, 'agreement_uploaded', workflow.applicant?.correction_request?.trim() ? 'Corrected agreement document uploaded after applicant correction request.' : 'Final agreement document uploaded for manager preview before sending to the applicant.', request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementGenerateMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/generate$/);
    if (agreementGenerateMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can generate the franchise agreement.', 403);
      const application = agreementApplicationRecord(agreementGenerateMatch[1]);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found for this application.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status === 'executed') return failure(request, response, 'AGREEMENT_LOCKED', 'This agreement has already been executed.', 409);
      if (!workflow.estamp?.verified_at) return failure(request, response, 'ESTAMP_REQUIRED', 'Verify the e-Stamp certificate before generating the final agreement.', 409);
      const actor = reviewActor(request);
      const template = application.franchise_model === 'FOFO' ? AGREEMENT_TEMPLATE_FOFO : AGREEMENT_TEMPLATE_FOCO;
      const placeholders = buildAgreementPlaceholders(application, database.company_profile, workflow);
      const body = renderAgreementTemplate(template, placeholders);
      const version = (Number(workflow.document?.version) || 0) + 1;
      workflow.reference_number = agreementReference({ ...application, agreement_workflow: { document: { version } } });
      workflow.document = {
        template_key: application.franchise_model === 'FOFO' ? 'fofo' : 'foco',
        version,
        body,
        draft_body: body,
        generated_at: new Date().toISOString(),
        generated_by: actor,
        sent_to_applicant_at: '',
      };
      workflow.status = 'draft_ready';
      agreementAudit(workflow, 'agreement_generated', `Final ${application.franchise_model} franchise agreement generated (version ${version}).`, actor);
      applicationReviewHistory(application, 'agreement_generated', `Final franchise agreement generated automatically from verified application data.`, request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementDraftMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/draft$/);
    if (agreementDraftMatch && request.method === 'PATCH') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can save agreement drafts.', 403);
      const application = agreementApplicationRecord(agreementDraftMatch[1]);
      if (!application?.agreement_workflow?.document) return failure(request, response, 'NOT_FOUND', 'Agreement draft not found for this application.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status === 'executed') return failure(request, response, 'AGREEMENT_LOCKED', 'This agreement has already been executed.', 409);
      const body = await readJson(request);
      workflow.document.draft_body = text(body.draft_body, 120_000);
      agreementAudit(workflow, 'agreement_draft_saved', 'Manager saved permitted edits to the agreement draft.', reviewActor(request));
      applicationReviewHistory(application, 'agreement_draft_saved', 'Manager saved permitted edits to the agreement draft.', request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementCorrectionResponseMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/correction-response$/);
    if (agreementCorrectionResponseMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can review applicant change requests.', 403);
      const application = agreementApplicationRecord(agreementCorrectionResponseMatch[1]);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found for this application.', 404);
      const workflow = application.agreement_workflow;
      const correctionRequest = String(workflow.applicant?.correction_request ?? '').trim();
      if (workflow.status !== 'correction_requested' || !correctionRequest) {
        return failure(request, response, 'AGREEMENT_STATE', 'No applicant change request is pending review.', 409);
      }
      if (workflow.applicant?.correction_decision) {
        return failure(request, response, 'AGREEMENT_STATE', 'This change request has already been reviewed.', 409);
      }
      const body = await readJson(request);
      const decision = text(body.decision, 20).toLowerCase();
      if (!['approve', 'deny'].includes(decision)) return failure(request, response, 'VALIDATION_ERROR', 'Choose approve or deny for the applicant change request.', 400);
      const responseMessage = text(body.message, 1_000);
      const actor = reviewActor(request);
      const now = new Date().toISOString();
      workflow.applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : {};
      workflow.applicant.correction_decision = decision === 'approve' ? 'approved' : 'denied';
      workflow.applicant.correction_decision_at = now;
      workflow.applicant.correction_decision_by = actor;
      workflow.applicant.correction_response = responseMessage;
      if (decision === 'approve') {
        agreementAudit(workflow, 'agreement_correction_approved', `Manager approved applicant change request.${responseMessage ? ` Note: ${responseMessage}` : ''}`, actor);
        applicationReviewHistory(application, 'agreement_correction_approved', 'Applicant change request approved. Upload the corrected agreement and send it back to the applicant.', request);
      } else {
        workflow.status = 'sent_to_applicant';
        if (workflow.document && typeof workflow.document === 'object') {
          workflow.document.aadhaar_signed_file = null;
        }
        clearApplicantEsignState(workflow);
        agreementAudit(workflow, 'agreement_correction_denied', `Manager denied applicant change request.${responseMessage ? ` Reason: ${responseMessage}` : ''}`, actor);
        applicationReviewHistory(application, 'agreement_correction_denied', 'Applicant change request denied by the manager.', request);
      }
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementSendMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/send$/);
    if (agreementSendMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can send the agreement to the applicant.', 403);
      const application = agreementApplicationRecord(agreementSendMatch[1]);
      if (!application?.agreement_workflow?.document?.uploaded_file?.url) return failure(request, response, 'NOT_FOUND', 'Upload the final agreement document before sending it to the applicant.', 404);
      const workflow = application.agreement_workflow;
      if (!['draft_ready', 'correction_requested'].includes(workflow.status)) return failure(request, response, 'AGREEMENT_STATE', 'The agreement must be in draft review before it can be sent to the applicant.', 409);
      const actor = reviewActor(request);
      workflow.document.sent_to_applicant_at = new Date().toISOString();
      workflow.applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : {};
      workflow.applicant.terms_accepted_at = '';
      workflow.applicant.correction_request = '';
      workflow.applicant.correction_requested_at = '';
      workflow.applicant.correction_decision = '';
      workflow.applicant.correction_decision_at = '';
      workflow.applicant.correction_decision_by = '';
      workflow.applicant.correction_response = '';
      clearApplicantEsignState(workflow);
      workflow.status = 'sent_to_applicant';
      agreementAudit(workflow, 'agreement_sent_to_applicant', 'Agreement sent to the applicant for view-only review and Aadhaar eSign.', actor);
      applicationReviewHistory(application, 'agreement_sent_to_applicant', 'Final franchise agreement sent to the applicant for review.', request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementDscMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/dsc$/);
    if (agreementDscMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised company signatory can execute the company DSC signature.', 403);
      const application = agreementApplicationRecord(agreementDscMatch[1]);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found for this application.', 404);
      const workflow = application.agreement_workflow;
      const blockedMessage = agreementExecutionBlockedMessage(workflow, 'dsc');
      if (blockedMessage) return failure(request, response, 'AGREEMENT_STATE', blockedMessage, 409);
      const actor = reviewActor(request);
      const dscReference = `DSC-${randomUUID().slice(0, 8).toUpperCase()}`;
      workflow.company = { dsc_signed_at: new Date().toISOString(), dsc_signed_by: actor, dsc_reference: dscReference };
      workflow.status = 'company_dsc_completed';
      agreementAudit(workflow, 'company_dsc_completed', `Company DSC signature executed by ${actor}. Reference ${dscReference}.`, actor);
      await persistExecutedAgreement(application, workflow, 'dsc');
      agreementAudit(workflow, 'agreement_executed', `Executed agreement generated with e-Stamp, applicant Aadhaar eSign, company DSC, seal and QR reference ${workflow.executed.qr_reference}.`, actor);
      applicationReviewHistory(application, 'agreement_executed', 'Final franchise agreement executed and archived for download.', request);
      application.stage = application.franchise_model === 'FOFO' ? 'onboarding_initiated' : 'agreement_and_onboarding';
      application.updated_at = new Date().toISOString();
      syncApplicationTerritoryStatus(application);
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementManualExecuteMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/manual-execute$/);
    if (agreementManualExecuteMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can upload the executed agreement.', 403);
      const application = agreementApplicationRecord(agreementManualExecuteMatch[1]);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found for this application.', 404);
      const workflow = application.agreement_workflow;
      const body = await readJson(request, 48_000_000);
      const executionMethod = text(body.execution_method, 20).toLowerCase() === 'dsc' ? 'dsc' : 'manual';
      const blockedMessage = agreementExecutionBlockedMessage(workflow, executionMethod);
      if (blockedMessage) return failure(request, response, 'AGREEMENT_STATE', blockedMessage, 409);
      const fileData = agreementDocumentData(body.file?.data_url ?? body.data_url);
      if (!fileData) return failure(request, response, 'VALIDATION_ERROR', executionMethod === 'dsc' ? 'Upload the DSC-signed agreement as a valid PDF up to 32 MB.' : 'Upload the manually signed and stamped agreement as a valid PDF up to 32 MB.', 400);
      const actor = reviewActor(request);
      await mkdir(uploadsDirectory, { recursive: true });
      const safeName = text(body.file?.name ?? body.name, 180).replace(/[^A-Za-z0-9._-]/g, '_') || 'executed-agreement.pdf';
      const filename = `executed-agreement-${application.application_number.replace(/[^A-Za-z0-9-]/g, '')}-${Date.now()}-${randomBytes(4).toString('hex')}.pdf`;
      await writeFile(path.join(uploadsDirectory, filename), fileData.bytes);
      const pendingFile = { id: randomUUID(), name: safeName.replace(/\.[^.]+$/, '') + '.pdf', url: `/uploads/${filename}`, mime: 'application/pdf', uploaded_at: new Date().toISOString(), uploaded_by: actor };
      workflow.document = workflow.document && typeof workflow.document === 'object' ? workflow.document : {};
      workflow.document.pending_executed_file = pendingFile;
      workflow.status = 'company_execution_pending';
      workflow.company = null;
      workflow.executed = workflow.executed && typeof workflow.executed === 'object' ? workflow.executed : {};
      workflow.executed.delivered_to_applicant_at = '';
      pushAgreementVersion(workflow, { type: 'manual_executed_pending', name: pendingFile.name, url: pendingFile.url, mime: pendingFile.mime, actor, reference: workflow.reference_number, message: 'Manually signed agreement uploaded for manager review before delivery to the applicant.' });
      agreementAudit(workflow, 'agreement_manual_uploaded', `Manually signed agreement uploaded by ${actor} and held for manager save before applicant delivery.`, actor);
      applicationReviewHistory(application, 'agreement_manual_uploaded', 'Manually signed agreement uploaded and held for manager review before applicant delivery.', request);
      application.updated_at = new Date().toISOString();
      syncApplicationTerritoryStatus(application);
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementSaveExecutedMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/save-executed$/);
    if (agreementSaveExecutedMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can save the executed agreement.', 403);
      const application = agreementApplicationRecord(agreementSaveExecutedMatch[1]);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found for this application.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status !== 'company_execution_pending' || !workflow.document?.pending_executed_file?.url) {
        return failure(request, response, 'AGREEMENT_STATE', 'Upload the manually signed agreement before saving it for the applicant.', 409);
      }
      const actor = reviewActor(request);
      const pendingFile = workflow.document.pending_executed_file;
      workflow.document.executed_file = pendingFile;
      workflow.document.pending_executed_file = null;
      const now = new Date().toISOString();
      workflow.executed = {
        agreement_url: pendingFile.url,
        executed_at: now,
        delivered_to_applicant_at: now,
        qr_reference: workflow.reference_number,
        uploaded_by: actor,
      };
      workflow.execution_method = 'manual';
      workflow.status = 'executed';
      pushAgreementVersion(workflow, { type: 'manual_executed', name: pendingFile.name, url: pendingFile.url, mime: pendingFile.mime, actor, reference: workflow.reference_number, message: 'Final executed agreement saved and delivered to the applicant portal.' });
      agreementAudit(workflow, 'agreement_executed', `Executed agreement saved by ${actor} and delivered to the applicant portal. QR reference ${workflow.executed.qr_reference}.`, actor);
      agreementAudit(workflow, 'agreement_delivered_to_applicant', `Final executed agreement published to the applicant portal by ${actor}.`, actor);
      applicationReviewHistory(application, 'agreement_executed', 'Final franchise agreement manually executed and delivered to the applicant portal.', request);
      application.stage = application.franchise_model === 'FOFO' ? 'onboarding_initiated' : 'agreement_and_onboarding';
      application.updated_at = new Date().toISOString();
      syncApplicationTerritoryStatus(application);
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const agreementDownloadMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/agreement\/download$/);
    if (agreementDownloadMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can download this agreement.', 403);
      const application = agreementApplicationRecord(agreementDownloadMatch[1]);
      const workflow = application?.agreement_workflow;
      if (!workflow) return failure(request, response, 'NOT_FOUND', 'Agreement workflow not found.', 404);
      const kind = text(new URL(request.url, `http://localhost:${port}`).searchParams.get('kind'), 20).toLowerCase();
      const file = kind === 'aadhaar' && workflow.document?.aadhaar_signed_file
        ? workflow.document.aadhaar_signed_file
        : agreementDownloadFile(workflow);
      if (file && await streamAgreementDownload(request, response, file, `Remedium-Lab-Agreement-${application.application_number}.pdf`)) return;
      const draftBody = workflow.document?.draft_body || workflow.document?.body;
      if (draftBody) {
        cors(request, response);
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="Remedium-Lab-Agreement-Draft-${application.application_number}.txt"` });
        response.end(draftBody);
        return;
      }
      return failure(request, response, 'NOT_FOUND', 'No agreement document is available to download yet.', 404);
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/agreement/terms') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'FORBIDDEN', 'Sign in to view agreement terms.', 403);
      const profile = companyProfile(database.company_profile);
      return success(request, response, {
        terms_text: profile.agreement_terms,
        terms_version: profile.agreement_terms_version,
        updated_at: application.updated_at,
      });
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/agreement/accept-and-esign') {
      const application = applicantFor(request);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'No agreement is available for review yet.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status !== 'sent_to_applicant') return failure(request, response, 'AGREEMENT_STATE', 'The agreement is not currently ready for acceptance and Aadhaar eSign.', 409);
      const body = await readJson(request);
      if (body.terms_accepted !== true) return failure(request, response, 'VALIDATION_ERROR', 'Select the mandatory Terms & Conditions checkbox before accepting the agreement.', 400);
      if (!workflow.document?.uploaded_file?.url) return failure(request, response, 'AGREEMENT_NOT_READY', 'The agreement document is not available yet.', 409);
      const cgpey = await resolveCgpeyRuntimeConfig({ force: true });
      if (!cgpeySimulate(cgpey) && !cgpeyConfigured(cgpey)) {
        return failure(request, response, 'CGPEY_NOT_CONFIGURED', 'Aadhaar eSign is not configured. Paste CGPEY API key, secret and merchant ID in Health Ecosystem Settings (base URL https://verify.cgpey.com).', 503);
      }
      const pdfBytes = await readAgreementUploadBytes(workflow.document.uploaded_file.url);
      if (!pdfBytes?.length) return failure(request, response, 'AGREEMENT_PDF_MISSING', 'Unable to read the agreement PDF for CGPEY eSign.', 500);
      const now = new Date().toISOString();
      workflow.applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : {};
      workflow.applicant.terms_accepted_at = now;
      workflow.applicant.correction_request = '';
      workflow.applicant.terms_version = companyProfile(database.company_profile).agreement_terms_version;
      try {
        const returnUrl = buildEsignReturnUrl({
          portalBaseUrl,
          applicationNumber: application.application_number || '',
        });
        const esignStart = await initiateAgreementEsign({
          pdfBase64: Buffer.from(pdfBytes).toString('base64'),
          signerName: application.full_name,
          signerMobile: application.mobile,
          referencePrefix: application.application_number || 'RFMS',
          returnUrl,
          applicationNumber: application.application_number || '',
          config: cgpey,
        });
        if (!esignStart.simulated && !esignStart.invitationLink) {
          return failure(
            request,
            response,
            'CGPEY_ESIGN_LINK_MISSING',
            'CGPEY eSign started but did not return a browser signing URL. Retry Accept Agreement or use the idto.ai SMS link, then return to the portal.',
            502,
          );
        }
        workflow.applicant.esign_pending = {
          provider: 'cgpey',
          mode: 'invitation_link',
          request_id: esignStart.reference || esignStart.docketId || '',
          docket_id: esignStart.docketId || '',
          document_id: esignStart.documentId || '',
          signer_id: esignStart.signerId || '',
          invitation_link: esignStart.invitationLink || '',
          return_url: esignStart.returnUrl || returnUrl,
          started_at: now,
          simulated: Boolean(esignStart.simulated),
        };
        agreementAudit(workflow, 'agreement_accepted', 'Applicant accepted the franchise agreement Terms & Conditions.', application.full_name);
        agreementAudit(workflow, 'aadhaar_esign_started', esignStart.simulated
          ? 'Simulated CGPEY Aadhaar eSign started.'
          : `CGPEY Aadhaar eSign started${esignStart.docketId ? ` (docket ${esignStart.docketId})` : ''}.`, application.full_name);
        application.updated_at = now;
        await saveDatabase();
        return success(request, response, {
          status: esignStart.invitationLink ? 'esign_redirect' : 'esign_pending',
          message: esignStart.message || 'Redirecting to CGPEY Aadhaar eSign…',
          invitation_link: esignStart.invitationLink || '',
          return_url: esignStart.returnUrl || returnUrl,
          docket_id: esignStart.docketId || '',
          redirect_same_tab: Boolean(esignStart.invitationLink),
          simulated: Boolean(esignStart.simulated),
          application: applicationSummary(application),
        });
      } catch (esignError) {
        const code = esignError?.code || 'CGPEY_ESIGN_START_FAILED';
        return failure(request, response, code, esignError instanceof Error ? esignError.message : 'Unable to start CGPEY Aadhaar eSign.', 502);
      }
    }

    // Provider return landing (no auth cookie) → bounce into portal agreement section.
    if (request.method === 'GET' && (route === '/api/v1/public/esign/return' || route === '/api/v1/applicant/agreement/esign/return')) {
      const redirectTo = buildEsignReturnUrl({
        portalBaseUrl,
        referenceDocId: text(url.searchParams.get('esign_ref') || url.searchParams.get('reference_doc_id') || url.searchParams.get('docket_id') || '', 80),
        applicationNumber: text(url.searchParams.get('application') || '', 80),
      });
      cors(request, response);
      response.writeHead(302, {
        Location: redirectTo,
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/agreement/esign/complete') {
      const application = applicantFor(request);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'No agreement is available for eSign yet.', 404);
      const workflow = application.agreement_workflow;
      if (['applicant_esign_completed', 'company_dsc_completed', 'company_execution_pending', 'executed'].includes(workflow.status)) {
        return success(request, response, applicationSummary(application));
      }
      if (workflow.status !== 'sent_to_applicant') return failure(request, response, 'AGREEMENT_STATE', 'The agreement is not currently awaiting Aadhaar eSign completion.', 409);
      if (!workflow.applicant?.terms_accepted_at) return failure(request, response, 'TERMS_REQUIRED', 'Accept the Terms & Conditions before completing Aadhaar eSign.', 409);
      if (!workflow.document?.uploaded_file?.url) return failure(request, response, 'AGREEMENT_NOT_READY', 'The agreement document is not available yet.', 409);
      const pending = workflow.applicant?.esign_pending && typeof workflow.applicant.esign_pending === 'object' ? workflow.applicant.esign_pending : null;
      if (!pending) return failure(request, response, 'ESIGN_NOT_STARTED', 'Start Aadhaar eSign before marking it complete.', 409);
      const now = new Date().toISOString();
      const esignReference = pending.docket_id || pending.request_id || `AADHAAR-ESIGN-${randomUUID().slice(0, 8).toUpperCase()}`;
      const signed = await persistAadhaarSignedAgreement(application, workflow, application.full_name, esignReference);
      if (!signed) return failure(request, response, 'AGREEMENT_ESIGN_FAILED', 'Unable to complete the Aadhaar eSign process for this agreement.', 500);
      workflow.applicant.esign_completed_at = now;
      workflow.applicant.esign_reference = esignReference;
      workflow.applicant.esign_provider = 'cgpey';
      workflow.applicant.esign_pending = null;
      workflow.status = 'applicant_esign_completed';
      reconcileAgreementWorkflow(workflow);
      agreementAudit(workflow, 'applicant_esign_completed', `Applicant completed CGPEY Aadhaar eSign. Reference ${esignReference}. Agreement is ready for company DSC or manual signing in the Manager Agreement Panel.`, application.full_name);
      applicationReviewHistory(application, 'applicant_esign_completed', 'Applicant accepted the agreement and completed Aadhaar eSign. Company execution is now enabled in the Agreement Queue.', { headers: {} });
      notifyApplicationWorkflow(application, 'applicant_esign_completed', 'Applicant Aadhaar eSign completed. Open Agreement Queue for company DSC or manual signing.', { headers: {} }, application.full_name);
      application.updated_at = now;
      await saveDatabase();
      await pushHecResultToFrappe(application, {
        status: 'Agreement Signed',
        aadhaarRef: esignReference,
        notes: pending.simulated ? 'Applicant Aadhaar eSign completed in FFMS (simulated)' : 'Applicant Aadhaar eSign completed in FFMS via CGPEY',
      });
      return success(request, response, applicationSummary(application));
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/agreement/esign/resend-otp') {
      return failure(request, response, 'CGPEY_KYC_DEPRECATED', 'Aadhaar OTP is completed inside the CGPEY signing link. Use Accept Agreement again if you need a fresh signing invitation.', 410);
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/agreement/esign/verify-otp') {
      return failure(request, response, 'CGPEY_KYC_DEPRECATED', 'Aadhaar OTP is completed inside the CGPEY signing link. After signing, click “I have completed eSign”.', 410);
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/agreement/accept') {
      const application = applicantFor(request);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'No agreement is available for review yet.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status !== 'sent_to_applicant') return failure(request, response, 'AGREEMENT_STATE', 'The agreement is not currently ready for acceptance.', 409);
      const body = await readJson(request);
      if (body.terms_accepted !== true) return failure(request, response, 'VALIDATION_ERROR', 'Accept the mandatory Terms & Conditions before proceeding.', 400);
      workflow.applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : {};
      workflow.applicant.terms_accepted_at = new Date().toISOString();
      workflow.applicant.correction_request = '';
      workflow.status = 'applicant_accepted';
      agreementAudit(workflow, 'agreement_accepted', 'Applicant accepted the franchise agreement and Terms & Conditions.', application.full_name);
      applicationReviewHistory(application, 'agreement_accepted', 'Applicant accepted the franchise agreement Terms & Conditions.', { headers: {} });
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/agreement/corrections') {
      const application = applicantFor(request);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'No agreement is available for review yet.', 404);
      const workflow = application.agreement_workflow;
      if (workflow.status !== 'sent_to_applicant') return failure(request, response, 'AGREEMENT_STATE', 'Correction requests can be raised only while the agreement is ready for review.', 409);
      const body = await readJson(request);
      const message = text(body.message, 4_000);
      if (!message) return failure(request, response, 'VALIDATION_ERROR', 'Describe the correction you need before submitting the request.', 400);
      workflow.applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : {};
      workflow.applicant.correction_request = message;
      workflow.applicant.correction_requested_at = new Date().toISOString();
      workflow.applicant.correction_decision = '';
      workflow.applicant.correction_decision_at = '';
      workflow.applicant.correction_decision_by = '';
      workflow.applicant.correction_response = '';
      workflow.status = 'correction_requested';
      agreementAudit(workflow, 'agreement_correction_requested', `Applicant requested corrections: ${message}`, application.full_name);
      applicationReviewHistory(application, 'agreement_correction_requested', `Applicant requested agreement corrections: ${message}`, { headers: {} });
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/agreement/esign') {
      return failure(request, response, 'CGPEY_KYC_DEPRECATED', 'Use Accept Agreement. CGPEY opens a hosted Aadhaar eSign link instead of the legacy OTP route.', 410);
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/agreement/view') {
      const application = applicantFor(request);
      if (!application?.agreement_workflow) return failure(request, response, 'NOT_FOUND', 'No agreement is available to view yet.', 404);
      const workflow = application.agreement_workflow;
      const permissions = applicantAgreementPermissions(workflow);
      if (!permissions.can_view) return failure(request, response, 'FORBIDDEN', 'The agreement is not available to view at this stage.', 403);
      const file = activeAgreementFile(workflow);
      if (!file?.url) return failure(request, response, 'NOT_FOUND', 'No agreement document is available to view yet.', 404);
      try {
        const content = await readAgreementUploadBytes(file.url);
        if (!content) throw new Error('missing file');
        cors(request, response);
        response.writeHead(200, {
          'Content-Type': file.mime || 'application/pdf',
          'Content-Disposition': 'inline',
          'Content-Length': content.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(content);
        return;
      } catch {
        return failure(request, response, 'NOT_FOUND', 'Agreement document file not found.', 404);
      }
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/agreement/download') {
      const application = applicantFor(request);
      const workflow = application?.agreement_workflow;
      if (!workflow || !agreementDeliveredToApplicant(workflow)) {
        return failure(request, response, 'FORBIDDEN', 'The executed agreement becomes downloadable only after the manager saves and delivers the final copy.', 403);
      }
      const file = workflow.document?.executed_file || agreementDownloadFile(workflow);
      if (file && await streamAgreementDownload(request, response, file, `Remedium-Lab-Agreement-${application.application_number}.pdf`)) return;
      return failure(request, response, 'NOT_FOUND', 'No executed agreement document is available to download yet.', 404);
    }

    const applicantTrainingCompleteMatch = route.match(/^\/api\/v1\/applicant\/training\/videos\/([^/]+)\/complete$/);
    if (applicantTrainingCompleteMatch && request.method === 'POST') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      const training = ensureTrainingState(application);
      if (!training.unlocked) return failure(request, response, 'TRAINING_LOCKED', 'Training is not unlocked for your application yet.', 403);
      const videoId = applicantTrainingCompleteMatch[1];
      const assigned = publishedTrainingVideosForModel(database.training_videos, application.franchise_model);
      const orderedIds = assigned.map((video) => video.id);
      if (!assigned.some((video) => video.id === videoId)) return failure(request, response, 'NOT_FOUND', 'Training video not found.', 404);
      if (!trainingVideoAccessible(training, videoId, orderedIds)) {
        return failure(request, response, 'TRAINING_SEQUENCE', 'Complete the previous training video before marking this one as finished.', 409);
      }
      const entry = training.videos.find((item) => item.video_id === videoId) ?? { video_id: videoId, completed: false, completed_at: '' };
      if (!training.videos.some((item) => item.video_id === videoId)) training.videos.push(entry);
      if (entry.completed) return success(request, response, applicationSummary(application));
      entry.completed = true;
      entry.completed_at = new Date().toISOString();
      const video = assigned.find((item) => item.id === videoId);
      training.history.push({
        id: randomUUID(),
        type: 'training_video_completed',
        message: `Completed training video: ${video?.title ?? videoId}.`,
        actor: application.full_name,
        created_at: entry.completed_at,
      });
      applicationReviewHistory(application, 'training_video_completed', `Applicant completed training video "${video?.title ?? videoId}".`, request);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

        if (request.method === 'GET' && route === '/api/v1/applicant/lis-bridge/package') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      try {
        const info = await packageCacheInfo(lisBridgeCacheDirectory());
        if (!info.ready) {
          const built = await ensureCachedPackage(lisBridgeCacheDirectory());
          const { buffer, ...meta } = built;
          return success(request, response, { ...meta, ready: true, size_kb: Math.round((meta.size_bytes || 0) / 1024) });
        }
        return success(request, response, { ...info, size_kb: Math.round((info.size_bytes || 0) / 1024) });
      } catch (error) {
        return failure(request, response, 'PACKAGE_UNAVAILABLE', error instanceof Error ? error.message : 'Unable to prepare LIS Bridge package.', 500);
      }
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/lis-bridge/download') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      try {
        const packed = await ensureCachedPackage(lisBridgeCacheDirectory());
        return sendZip(request, response, packed.filename || 'hec-em200-lis-bridge.zip', packed.buffer);
      } catch (error) {
        return failure(request, response, 'PACKAGE_UNAVAILABLE', error instanceof Error ? error.message : 'Unable to download LIS Bridge package.', 500);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/lis-bridge/erp-check') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      const body = await readJson(request, 100_000);
      const result = await checkErpConnectivity({
        backend_base_url: body.backend_base_url,
        site_name: body.site_name,
        api_key: body.api_key,
        api_secret: body.api_secret,
        barcode: body.barcode,
      });
      return success(request, response, result);
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/lis-bridge/debug-log') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      const body = await readJson(request, 400_000);
      const analysis = interpretSetupLog(body.log_text || body.log || '');
      return success(request, response, {
        ...analysis,
        application_number: application.application_number,
        franchisee_id: application.franchisee_id || '',
        analyzed_at: new Date().toISOString(),
      });
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/lis-bridge/config-template') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      return success(request, response, {
        filename: 'em200.env.json',
        config: buildConfigTemplate(),
        note: 'Replace PASTE_KEY / PASTE_SECRET with HQ keys. Do not share this file on WhatsApp.',
      });
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/training/certificate') {
      const application = applicantFor(request);
      if (!application?.training?.certificate?.pdf?.url) {
        return failure(request, response, 'CERTIFICATE_UNAVAILABLE', 'The training completion certificate becomes available after the manager reviews your progress and issues the certificate.', 403);
      }
      try {
        await refreshTrainingCertificatePdfFile(application);
        application.updated_at = new Date().toISOString();
        await saveDatabase();
        const certificate = application.training.certificate;
        const content = await readFile(path.join(uploadsDirectory, path.basename(certificate.pdf.url)));
        return sendPdf(request, response, certificate.pdf.name || `Training-Certificate-${application.application_number}.pdf`, content);
      } catch {
        return failure(request, response, 'NOT_FOUND', 'Training certificate file not found. Ask your manager to re-issue the certificate.', 404);
      }
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/onboarding-certificate') {
      const application = applicantFor(request);
      if (!canDownloadOnboardingCertificate(application)) {
        return failure(request, response, 'CERTIFICATE_UNAVAILABLE', 'The onboarding welcome certificate becomes available after your manager generates it.', 403);
      }
      try {
        await refreshOnboardingCertificatePdfFile(application);
        application.updated_at = new Date().toISOString();
        await saveDatabase();
        const certificate = application.onboarding_certificate;
        const content = await readFile(path.join(uploadsDirectory, path.basename(certificate.pdf.url)));
        return sendPdf(request, response, certificate.pdf.name || `Onboarding-Certificate-${application.application_number}.pdf`, content);
      } catch {
        return failure(request, response, 'NOT_FOUND', 'Onboarding certificate file not found. Ask your manager to generate it again.', 404);
      }
    }

    if (request.method === 'GET' && route === '/api/v1/applicant/support/tickets') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      const tickets = supportTicketsForApplication(application.id).map((item) => supportTicketSummary(item, resolveUploadUrl));
      return success(request, response, tickets);
    }

    if (request.method === 'POST' && route === '/api/v1/applicant/support/tickets') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      const body = await readJson(request, 12_000_000);
      const subject = text(body.subject, 180);
      const message = text(body.message, 4000);
      const category = text(body.category, 40);
      if (!subject) return failure(request, response, 'VALIDATION_ERROR', 'Enter a subject for your support ticket.', 400);
      if (!message) return failure(request, response, 'VALIDATION_ERROR', 'Describe your issue in the message field.', 400);
      if (!SUPPORT_TICKET_CATEGORIES.includes(category)) return failure(request, response, 'VALIDATION_ERROR', 'Choose a valid support category.', 400);
      const attachments = await storeSupportAttachments(application, body.attachments);
      const ticket = createSupportTicket({
        application,
        category,
        subject,
        message,
        attachments,
        tickets: ensureSupportTicketsArray(),
      });
      ensureSupportTicketsArray().push(ticket);
      application.updated_at = new Date().toISOString();
      workflowNotify({
        module: 'support',
        action: 'support_ticket_created',
        title: 'New applicant support ticket',
        message: `${application.full_name} opened support ticket ${ticket.ticket_number}: ${subject}.`,
        actor: { name: application.full_name, role: 'applicant' },
        href: `admin:Support:${ticket.id}`,
        entityType: 'support_ticket',
        entityId: ticket.id,
        applicationId: application.id,
        portalHref: 'portal:support',
      });
      await saveDatabase();
      return success(request, response, supportTicketSummary(ticket, resolveUploadUrl), 201);
    }

    const applicantSupportTicketMatch = route.match(/^\/api\/v1\/applicant\/support\/tickets\/([^/]+)$/);
    if (applicantSupportTicketMatch && request.method === 'GET') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      const ticket = supportTicketById(applicantSupportTicketMatch[1]);
      if (!ticket || ticket.application_id !== application.id) return failure(request, response, 'NOT_FOUND', 'Support ticket not found.', 404);
      markSupportTicketReadByApplicant(ticket);
      await saveDatabase();
      return success(request, response, supportTicketSummary(ticket, resolveUploadUrl));
    }

    const applicantSupportMessageMatch = route.match(/^\/api\/v1\/applicant\/support\/tickets\/([^/]+)\/messages$/);
    if (applicantSupportMessageMatch && request.method === 'POST') {
      const application = applicantFor(request);
      if (!application) return failure(request, response, 'UNAUTHORIZED', 'Applicant authentication required.', 401);
      const ticket = supportTicketById(applicantSupportMessageMatch[1]);
      if (!ticket || ticket.application_id !== application.id) return failure(request, response, 'NOT_FOUND', 'Support ticket not found.', 404);
      if (ticket.status === 'closed') return failure(request, response, 'TICKET_CLOSED', 'This support ticket is closed. Open a new ticket if you need further help.', 409);
      const body = await readJson(request, 12_000_000);
      const message = text(body.message, 4000);
      if (!message) return failure(request, response, 'VALIDATION_ERROR', 'Enter a message to continue this conversation.', 400);
      const attachments = await storeSupportAttachments(application, body.attachments);
      appendSupportTicketMessage(ticket, {
        author_type: 'applicant',
        author_name: application.full_name,
        body: message,
        attachments,
      });
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, supportTicketSummary(ticket, resolveUploadUrl));
    }

    const trainingUnlockMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/training\/unlock$/);
    if (trainingUnlockMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can unlock training.', 403);
      const application = database.applications.find((item) => item.id === trainingUnlockMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!canUnlockTraining(application)) {
        return failure(request, response, 'TRAINING_STATE', application.training?.unlocked
          ? 'Training is already unlocked for this applicant.'
          : 'Training unlocks only after the final agreement is executed and delivered.', 409);
      }
      const body = await readJson(request, 48_000);
      const businessName = text(body.business_name, 180);
      if (!businessName) return failure(request, response, 'VALIDATION_ERROR', 'Enter the franchise business name before unlocking training.', 400);
      const franchiseAddress = franchiseAddressForApplication(application);
      if (!franchiseAddress) return failure(request, response, 'VALIDATION_ERROR', 'Franchise address is not available yet. Issue the Territory Allotment Letter before unlocking training.', 409);
      const assigned = publishedTrainingVideosForModel(database.training_videos, application.franchise_model);
      if (!assigned.length) return failure(request, response, 'TRAINING_CATALOG_EMPTY', 'Publish at least one training video in Admin → Training before unlocking applicant training.', 409);
      const actor = reviewActor(request);
      const now = new Date().toISOString();
      const training = ensureTrainingState(application);
      training.unlocked = true;
      training.unlocked_at = now;
      training.unlocked_by = actor;
      training.business_name = businessName;
      training.franchise_address = franchiseAddress;
      initializeTrainingProgress(application, database.training_videos);
      training.history.push({
        id: randomUUID(),
        type: 'training_unlocked',
        message: `Training unlocked by ${actor}. ${assigned.length} video${assigned.length === 1 ? '' : 's'} assigned.`,
        actor,
        created_at: now,
      });
      applicationReviewHistory(application, 'training_unlocked', `Mandatory franchise training unlocked for ${businessName} at ${franchiseAddress}.`, request);
      application.updated_at = now;
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const trainingIssueMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/training\/certificate\/issue$/);
    if (trainingIssueMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can issue this certificate.', 403);
      const application = database.applications.find((item) => item.id === trainingIssueMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!canIssueTrainingCertificate(application, database.training_videos)) {
        return failure(request, response, 'TRAINING_STATE', application.training?.certificate?.pdf?.url
          ? 'The training completion certificate has already been issued.'
          : 'Issue the certificate only after the applicant finishes every assigned training video.', 409);
      }
      const body = await readJson(request, 48_000);
      const businessName = text(body.business_name, 180) || application.training?.business_name;
      if (!businessName) return failure(request, response, 'VALIDATION_ERROR', 'Enter the franchise business name before issuing the certificate.', 400);
      const actor = reviewActor(request);
      const certificate = await issueTrainingCertificate(application, actor, businessName, request);
      if (!certificate?.pdf?.url) return failure(request, response, 'CERTIFICATE_ISSUE_FAILED', 'Unable to generate the training completion certificate.', 500);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const trainingRegenerateMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/training\/certificate\/regenerate$/);
    if (trainingRegenerateMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can regenerate this certificate.', 403);
      const application = database.applications.find((item) => item.id === trainingRegenerateMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!canRegenerateTrainingCertificate(application)) {
        return failure(request, response, 'TRAINING_STATE', 'Issue the training completion certificate before requesting a regenerated PDF.', 409);
      }
      const actor = reviewActor(request);
      const certificate = await regenerateTrainingCertificatePdf(application, actor, request);
      if (!certificate?.pdf?.url) return failure(request, response, 'CERTIFICATE_ISSUE_FAILED', 'Unable to regenerate the training completion certificate.', 500);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const adminTrainingCertificateMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/training\/certificate$/);
    if (adminTrainingCertificateMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can download this certificate.', 403);
      const application = database.applications.find((item) => item.id === adminTrainingCertificateMatch[1] && item.visible_to_admin);
      if (!application?.training?.certificate?.pdf?.url) return failure(request, response, 'NOT_FOUND', 'No training completion certificate is stored for this application yet.', 404);
      try {
        await refreshTrainingCertificatePdfFile(application);
        application.updated_at = new Date().toISOString();
        await saveDatabase();
        const certificate = application.training.certificate;
        const content = await readFile(path.join(uploadsDirectory, path.basename(certificate.pdf.url)));
        return sendPdf(request, response, certificate.pdf.name || `Training-Certificate-${application.application_number}.pdf`, content);
      } catch {
        return failure(request, response, 'NOT_FOUND', 'Training certificate file not found.', 404);
      }
    }

    const onboardingIssueMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/onboarding-certificate\/issue$/);
    if (onboardingIssueMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can generate this certificate.', 403);
      const application = database.applications.find((item) => item.id === onboardingIssueMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!canIssueOnboardingCertificate(application)) {
        return failure(request, response, 'ONBOARDING_CERTIFICATE_STATE', application.onboarding_certificate?.pdf?.url
          ? 'The onboarding welcome certificate has already been generated.'
          : 'Generate the onboarding certificate only after the training completion certificate has been issued.', 409);
      }
      const body = await readJson(request, 48_000);
      const businessName = text(body.business_name, 180) || application.training?.certificate?.business_name || application.training?.business_name;
      if (!businessName) return failure(request, response, 'VALIDATION_ERROR', 'Enter the franchise business name before generating the onboarding certificate.', 400);
      const actor = reviewActor(request);
      const certificate = await issueOnboardingCertificate(application, actor, businessName, request);
      if (!certificate?.pdf?.url) return failure(request, response, 'CERTIFICATE_ISSUE_FAILED', 'Unable to generate the onboarding welcome certificate.', 500);
      application.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, applicationSummary(application));
    }

    const adminOnboardingCertificateMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/onboarding-certificate$/);
    if (adminOnboardingCertificateMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can download this certificate.', 403);
      const application = database.applications.find((item) => item.id === adminOnboardingCertificateMatch[1] && item.visible_to_admin);
      if (!canDownloadOnboardingCertificate(application)) return failure(request, response, 'NOT_FOUND', 'No onboarding welcome certificate is stored for this application yet.', 404);
      try {
        await refreshOnboardingCertificatePdfFile(application);
        application.updated_at = new Date().toISOString();
        await saveDatabase();
        const certificate = application.onboarding_certificate;
        const content = await readFile(path.join(uploadsDirectory, path.basename(certificate.pdf.url)));
        return sendPdf(request, response, certificate.pdf.name || `Onboarding-Certificate-${application.application_number}.pdf`, content);
      } catch {
        return failure(request, response, 'NOT_FOUND', 'Onboarding certificate file not found.', 404);
      }
    }

    const applicationOnboardMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/onboard$/);
    if (applicationOnboardMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can mark this application onboarded.', 403);
      const application = database.applications.find((item) => item.id === applicationOnboardMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (!canMarkApplicationOnboarded(application)) {
        return failure(request, response, 'ONBOARDING_STATE', application.stage === 'onboarding_completed'
          ? 'This franchise application is already marked onboarded.'
          : 'Generate the onboarding welcome certificate before marking the application onboarded.', 409);
      }
      const actor = reviewActor(request);
      const result = await markApplicationOnboarded(application, actor, request);
      if (!result) return failure(request, response, 'ONBOARDING_FAILED', 'Unable to complete the franchise onboarding workflow.', 500);
      await saveDatabase();
      return success(request, response, {
        application: applicationSummary(application),
        franchise_webpage: result.webpage ? franchiseWebpageRecord(result.webpage, resolveUploadUrl) : null,
      });
    }

    const partnerPortalProvisionMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/partner-portal\/provision$/);
    if (partnerPortalProvisionMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can provision Partner Portal credentials.', 403);
      const application = database.applications.find((item) => item.id === partnerPortalProvisionMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (application.stage !== 'onboarding_completed') {
        return failure(request, response, 'ONBOARDING_STATE', 'Mark the application onboarded before creating Partner Portal credentials.', 409);
      }
      const body = await readJson(request, 8_000).catch(() => ({}));
      const force = Boolean(body?.force);
      const provisioned = await ensurePartnerPortalCredentials(application, request, {
        force,
        actor: reviewActor(request),
      });
      await saveDatabase();
      if (!provisioned) {
        return failure(
          request,
          response,
          'PARTNER_PORTAL_FAILED',
          application.partner_portal_error || 'Unable to create Partner Portal credentials.',
          502,
        );
      }
      return success(request, response, applicationSummary(application));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/franchise-webpages') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can view franchise webpages.', 403);
      const query = text(url.searchParams.get('q') ?? '', 120).toLowerCase();
      const pages = ensureFranchiseWebpagesArray()
        .filter((item) => item.franchise_model === 'FOCO')
        .filter((item) => !query || franchiseWebpageMatchesSearch(item, query))
        .sort((first, second) => String(second.updated_at).localeCompare(String(first.updated_at)))
        .map((item) => franchiseWebpageRecord(item, resolveUploadUrl));
      return success(request, response, pages);
    }

    const franchiseWebpageIdMatch = route.match(/^\/api\/v1\/admin\/franchise-webpages\/([^/]+)$/);
    if (franchiseWebpageIdMatch && request.method === 'GET') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can view franchise webpages.', 403);
      const webpage = franchiseWebpageById(franchiseWebpageIdMatch[1]);
      if (!webpage) return failure(request, response, 'NOT_FOUND', 'Franchise webpage not found.', 404);
      return success(request, response, franchiseWebpageRecord(webpage, resolveUploadUrl));
    }

    if (franchiseWebpageIdMatch && request.method === 'PATCH') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can update franchise webpages.', 403);
      const webpage = franchiseWebpageById(franchiseWebpageIdMatch[1]);
      if (!webpage) return failure(request, response, 'NOT_FOUND', 'Franchise webpage not found.', 404);
      const body = await readJson(request, 96_000);
      webpage.settings = franchiseWebpageSettingsFromBody(body.settings && typeof body.settings === 'object' ? body.settings : body, webpage.settings ?? {});
      if (typeof body.enabled === 'boolean') webpage.enabled = body.enabled;
      if (body.slug) webpage.slug = uniqueFranchiseWebpageSlug(body.slug, webpage.id);
      await regenerateFranchiseWebpage(webpage);
      await saveDatabase();
      return success(request, response, franchiseWebpageRecord(webpage, resolveUploadUrl));
    }

    const franchiseWebpageRegenerateMatch = route.match(/^\/api\/v1\/admin\/franchise-webpages\/([^/]+)\/regenerate$/);
    if (franchiseWebpageRegenerateMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can regenerate franchise webpages.', 403);
      const webpage = franchiseWebpageById(franchiseWebpageRegenerateMatch[1]);
      if (!webpage) return failure(request, response, 'NOT_FOUND', 'Franchise webpage not found.', 404);
      await regenerateFranchiseWebpage(webpage);
      await saveDatabase();
      return success(request, response, franchiseWebpageRecord(webpage, resolveUploadUrl));
    }

    const franchiseWebpageStatusMatch = route.match(/^\/api\/v1\/admin\/franchise-webpages\/([^/]+)\/status$/);
    if (franchiseWebpageStatusMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can update franchise webpage status.', 403);
      const webpage = franchiseWebpageById(franchiseWebpageStatusMatch[1]);
      if (!webpage) return failure(request, response, 'NOT_FOUND', 'Franchise webpage not found.', 404);
      const body = await readJson(request, 8_000);
      webpage.enabled = body.enabled !== false;
      webpage.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, franchiseWebpageRecord(webpage, resolveUploadUrl));
    }

    const franchiseWebpageBranchImageUploadMatch = route.match(/^\/api\/v1\/admin\/franchise-webpages\/([^/]+)\/branch-images\/upload$/);
    if (franchiseWebpageBranchImageUploadMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can upload branch images.', 403);
      const webpage = franchiseWebpageById(franchiseWebpageBranchImageUploadMatch[1]);
      if (!webpage) return failure(request, response, 'NOT_FOUND', 'Franchise webpage not found.', 404);
      const application = database.applications.find((item) => item.id === webpage.application_id);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Linked franchise application not found.', 404);
      webpage.settings = webpage.settings && typeof webpage.settings === 'object' ? webpage.settings : defaultFranchiseWebpageSettings(application, companyProfile(database.company_profile));
      webpage.settings.branch_images = Array.isArray(webpage.settings.branch_images) ? webpage.settings.branch_images : [];
      if (webpage.settings.branch_images.length >= MAX_FRANCHISE_WEBPAGE_BRANCH_IMAGES) {
        return failure(request, response, 'BRANCH_IMAGE_LIMIT', `You can upload up to ${MAX_FRANCHISE_WEBPAGE_BRANCH_IMAGES} branch photographs for this webpage.`, 409);
      }
      const body = await readJson(request, 12_000_000);
      const stored = await storeApplicationUpload(application, 'franchise-branch', body.data_url ?? body.file?.data_url, body.name ?? body.file?.name ?? 'branch-photo.jpg');
      if (!stored?.url) return failure(request, response, 'PHOTO_INVALID', 'Upload a valid PNG, JPG or WEBP branch photograph smaller than 5 MB.', 400);
      webpage.settings.branch_images.push({
        url: stored.url,
        caption: text(body.caption, 180) || text(body.name, 180) || stored.name,
      });
      await regenerateFranchiseWebpage(webpage);
      await saveDatabase();
      return success(request, response, franchiseWebpageRecord(webpage, resolveUploadUrl));
    }

    const franchiseWebpageBranchImageDeleteMatch = route.match(/^\/api\/v1\/admin\/franchise-webpages\/([^/]+)\/branch-images\/(\d+)$/);
    if (franchiseWebpageBranchImageDeleteMatch && request.method === 'DELETE') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can delete branch images.', 403);
      const webpage = franchiseWebpageById(franchiseWebpageBranchImageDeleteMatch[1]);
      if (!webpage) return failure(request, response, 'NOT_FOUND', 'Franchise webpage not found.', 404);
      const index = Number(franchiseWebpageBranchImageDeleteMatch[2]);
      webpage.settings = webpage.settings && typeof webpage.settings === 'object' ? webpage.settings : {};
      webpage.settings.branch_images = Array.isArray(webpage.settings.branch_images) ? webpage.settings.branch_images : [];
      if (!Number.isInteger(index) || index < 0 || index >= webpage.settings.branch_images.length) {
        return failure(request, response, 'NOT_FOUND', 'Branch image not found.', 404);
      }
      webpage.settings.branch_images.splice(index, 1);
      await regenerateFranchiseWebpage(webpage);
      await saveDatabase();
      return success(request, response, franchiseWebpageRecord(webpage, resolveUploadUrl));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/franchisees') {
      if (!requirePermission(request, response, 'franchisee_directory')) return;
      const filters = parseFranchiseeDirectoryFilters(url.searchParams);
      const helpers = franchiseeDirectoryHelpers();
      const items = onboardedFranchiseeApplications()
        .map((application) => franchiseeDirectoryListItem(application, helpers))
        .filter((item) => franchiseeDirectoryMatchesFilters(item, filters));
      const paged = paginateRecords(items, filters.page, filters.page_size);
      return success(request, response, paged);
    }

    if (request.method === 'GET' && route === '/api/v1/admin/foco-centres') {
      if (!requirePermission(request, response, 'applicants')) return;
      return success(request, response, { centres: onboardedFocoCentres() });
    }

    const applicationParentFocoMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/parent-foco$/);
    if (applicationParentFocoMatch && request.method === 'POST') {
      if (!canManageTerritory(request)) return failure(request, response, 'FORBIDDEN', 'Only a franchise manager or administrator can map a FOFO under a FOCO.', 403);
      const application = database.applications.find((item) => item.id === applicationParentFocoMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      if (String(application.franchise_model || '').toUpperCase() !== 'FOFO') {
        return failure(request, response, 'NOT_FOFO', 'Under Which FOCO applies only to FOFO onboarding.', 409);
      }
      const body = await readJson(request);
      const parentId = text(body.parent_foco_id || body.parent_foco, 120);
      const parentName = text(body.parent_foco_name, 180);
      if (!parentId) return failure(request, response, 'FOCO_REQUIRED', 'Select an active FOCO centre.', 400);
      const already = String(application.parent_foco_id || '').trim();
      const onboarded = isOnboardedFranchisee(application);
      if (already && already !== parentId && onboarded) {
        return failure(request, response, 'MAPPING_LOCKED', `This FOFO is already mapped under ${application.parent_foco_name || already}. Mapping is permanent after onboarding.`, 409);
      }
      const known = onboardedFocoCentres().find((item) => item.parent_foco_id === parentId || item.franchisee_id === parentId);
      application.parent_foco_id = parentId;
      application.parent_foco_name = parentName || known?.franchise_name || parentId;
      application.parent_foco_mapped_at = already === parentId ? (application.parent_foco_mapped_at || new Date().toISOString()) : new Date().toISOString();
      application.updated_at = new Date().toISOString();
      applicationReviewHistory(
        application,
        'fofo_parent_foco_selected',
        `Under Which FOCO set to ${application.parent_foco_name} (${parentId}).`,
        request,
      );
      await maybeSyncFofoParentFoco(application, request);
      await saveDatabase();
      return success(request, response, { application: applicationSummary(application) });
    }

    const franchiseeDetailMatch = route.match(/^\/api\/v1\/admin\/franchisees\/([^/]+)$/);
    if (franchiseeDetailMatch && request.method === 'GET') {
      const session = requirePermission(request, response, 'franchisee_directory');
      if (!session) return;
      const application = findApplicationByFranchiseeIdentifier(database.applications, franchiseeDetailMatch[1]);
      if (!application || !isOnboardedFranchisee(application)) return failure(request, response, 'NOT_FOUND', 'Onboarded franchisee record not found.', 404);
      if (!hasPartnerPortalCredentials(application)) {
        await ensurePartnerPortalCredentials(application, request, { actor: session.name || 'System' });
      } else {
        await syncHubDirectoryDetailsToErp(application, request, { actor: session.name || 'System' });
      }
      const detail = franchiseeDirectoryDetail(application, franchiseeDirectoryHelpers(), session.name);
      await saveDatabase();
      return success(request, response, detail);
    }

    if (franchiseeDetailMatch && request.method === 'PATCH') {
      const session = requirePermission(request, response, 'franchisee_directory');
      if (!session) return;
      const application = findApplicationByFranchiseeIdentifier(database.applications, franchiseeDetailMatch[1]);
      if (!application || !isOnboardedFranchisee(application)) return failure(request, response, 'NOT_FOUND', 'Onboarded franchisee record not found.', 404);
      const body = await readJson(request, 4000);
      if (!Object.prototype.hasOwnProperty.call(body, 'google_map_location_url')) {
        return failure(request, response, 'VALIDATION_ERROR', 'Provide google_map_location_url to update the franchisee Google Maps location link.', 400);
      }
      const helpers = franchiseeDirectoryHelpers();
      const result = updateFranchiseeGoogleMapLocationUrl(application, body.google_map_location_url, session.name, helpers);
      if (result.error) return failure(request, response, 'VALIDATION_ERROR', result.error, 400);
      auditAdminAction(request, {
        action: 'franchisee_google_map_location_updated',
        target: franchiseeIdForApplication(application) || application.id,
        details: result.url ? 'Google Maps location link saved for partner API export.' : 'Google Maps location link cleared; directory will use derived location sources.',
      });
      await saveDatabase();
      return success(request, response, franchiseeDirectoryDetail(application, helpers, session.name));
    }

    const franchiseeDeboardMatch = route.match(/^\/api\/v1\/admin\/franchisees\/([^/]+)\/deboard$/);
    if (franchiseeDeboardMatch && request.method === 'POST') {
      const session = requirePermission(request, response, 'deboard_franchise');
      if (!session) return;
      const application = findApplicationByFranchiseeIdentifier(database.applications, franchiseeDeboardMatch[1]);
      if (!application || !isOnboardedFranchisee(application)) return failure(request, response, 'NOT_FOUND', 'Onboarded franchisee record not found.', 404);
      if (isDeboardedFranchise(application)) return failure(request, response, 'ALREADY_DEBOARDED', 'This franchise is already deboarded.', 409);
      const helpers = franchiseeDirectoryHelpers();
      const result = deboardFranchiseApplication(database, application, session, helpers);
      let erp = null;
      try {
        erp = await deboardFranchiseeViaErp({
          franchiseeProfile: result.cascade.hec_franchisee_profile,
          franchiseeId: result.cascade.franchisee_id,
          reason: `Deboarded by ${session.name} from FFMS Admin`,
        });
      } catch (error) {
        erp = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      auditAdminAction(request, {
        action: 'franchise_deboarded',
        target: franchiseeIdForApplication(application) || application.id,
        details: `Franchise deboarded. Total expense ₹${result.cost_report.total_expense}.`,
      });
      await saveDatabase();
      return success(request, response, {
        ...franchiseeDirectoryDetail(application, helpers, session.name),
        deboarding_report: result.cost_report,
        erp,
      });
    }

    if (request.method === 'GET' && route === '/api/v1/admin/franchisee-directory/api-settings') {
      if (!requirePermission(request, response, 'franchisee_directory_api')) return;
      return success(request, response, {
        ...franchiseeDirectoryApiSettingsSummary(ensureFranchiseeDirectoryApiSettings(database)),
        available_fields: FRANCHISEE_DIRECTORY_EXPORT_FIELDS,
        recent_audit: (database.partner_api_audit_log ?? []).slice(0, 20),
      });
    }

    if (request.method === 'PUT' && route === '/api/v1/admin/franchisee-directory/api-settings') {
      const session = requirePermission(request, response, 'franchisee_directory_api');
      if (!session) return;
      const body = await readJson(request, 16_000);
      const current = ensureFranchiseeDirectoryApiSettings(database);
      const next = franchiseeDirectoryApiSettingsFromBody(body, current, session.name);
      const generatedToken = next.generated_token;
      delete next.generated_token;
      database.franchisee_directory_api = next;
      auditAdminAction(request, { action: 'franchisee_directory_api_settings_updated', target: 'franchisee_directory_api', details: `Partner API ${next.enabled ? 'enabled' : 'disabled'} with ${next.allowed_fields.length} export fields.` });
      await saveDatabase();
      return success(request, response, {
        ...franchiseeDirectoryApiSettingsSummary(next),
        available_fields: FRANCHISEE_DIRECTORY_EXPORT_FIELDS,
        generated_token: generatedToken ?? '',
      });
    }

    const partnerFranchiseeFileMatch = route.match(/^\/api\/v1\/partner\/franchisees\/files\/([^/]+)$/);
    if (partnerFranchiseeFileMatch && request.method === 'GET') {
      const access = requirePartnerApiAccess(request, response);
      if (!access) return;
      const payload = verifyPartnerFileToken(access.settings, partnerFranchiseeFileMatch[1]);
      if (!payload) return failure(request, response, 'INVALID_FILE_TOKEN', 'This secure file link is invalid or expired.', 401);
      appendPartnerApiAuditLog(database, { route, method: request.method, franchisee_id: payload.franchisee_id || payload.application_id, status: 'file_download', token_prefix: access.settings.api_token_prefix });
      await saveDatabase();
      return servePartnerFile(request, response, payload.file_url);
    }

    if (request.method === 'GET' && route === '/api/v1/partner/franchisees') {
      const access = requirePartnerApiAccess(request, response);
      if (!access) return;
      const filters = parseFranchiseeDirectoryFilters(url.searchParams);
      const helpers = franchiseeDirectoryHelpers();
      const items = onboardedFranchiseeApplications()
        .map((application) => franchiseeDirectoryListItem(application, helpers))
        .filter((item) => franchiseeDirectoryMatchesFilters(item, filters));
      const paged = paginateRecords(items, filters.page, filters.page_size);
      appendPartnerApiAuditLog(database, { route, method: request.method, status: 'list', result_count: paged.items.length, token_prefix: access.settings.api_token_prefix });
      await saveDatabase();
      const listExportFields = access.settings.allowed_fields.filter((field) => ['identifiers', 'basic_details', 'google_map_location_url', 'territory', 'webpage'].includes(field));
      return success(request, response, {
        api_version: access.settings.version,
        ...paged,
        items: paged.items.map((item) => franchiseeDirectoryPartnerRecord({
          identifiers: {
            franchisee_id: item.franchisee_id,
            application_id: item.application_id,
            application_number: item.application_number,
            business_id: item.business_id,
          },
          basic_details: {
            franchisee_name: item.franchisee_name,
            applicant_name: item.applicant_name,
            business_name: item.business_name,
            franchise_model: item.franchise_model,
            district: item.district,
            pincode: item.pincode,
            onboarding_completed_at: item.onboarding_date,
            current_status: item.current_status,
          },
          google_map_location_url: item.google_map_location_url || '',
          territory: item.territory ? { allotted_territory: item.territory } : null,
          webpage: item.webpage_url ? { public_url: item.webpage_url } : null,
        }, access.settings, listExportFields.length ? listExportFields : ['identifiers', 'basic_details', 'territory', 'webpage']).record),
      });
    }

    const partnerFranchiseeDetailMatch = route.match(/^\/api\/v1\/partner\/franchisees\/([^/]+)$/);
    if (partnerFranchiseeDetailMatch && request.method === 'GET') {
      const access = requirePartnerApiAccess(request, response);
      if (!access) return;
      const application = findApplicationByFranchiseeIdentifier(database.applications, partnerFranchiseeDetailMatch[1]);
      if (!application || !isOnboardedFranchisee(application)) return failure(request, response, 'NOT_FOUND', 'Onboarded franchisee record not found.', 404);
      const detail = franchiseeDirectoryDetail(application, franchiseeDirectoryHelpers(), 'Partner API');
      appendPartnerApiAuditLog(database, { route, method: request.method, franchisee_id: franchiseeIdForApplication(application) || application.id, status: 'detail', token_prefix: access.settings.api_token_prefix });
      await saveDatabase();
      return success(request, response, franchiseeDirectoryPartnerRecord(detail, access.settings, access.settings.allowed_fields));
    }

        if (request.method === 'GET' && route === '/api/v1/admin/lis-bridge/package') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can manage the LIS Bridge package.', 403);
      try {
        let info = await packageCacheInfo(lisBridgeCacheDirectory());
        if (!info.ready) {
          const built = await ensureCachedPackage(lisBridgeCacheDirectory());
          const { buffer, ...meta } = built;
          info = { ...meta, ready: true };
        }
        return success(request, response, { ...info, size_kb: Math.round((info.size_bytes || 0) / 1024), meta_defaults: lisBridgePackageMeta() });
      } catch (error) {
        return failure(request, response, 'PACKAGE_UNAVAILABLE', error instanceof Error ? error.message : 'Unable to load LIS Bridge package status.', 500);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/admin/lis-bridge/rebuild') {
      if (!requirePermission(request, response, 'lis_bridge')) return;
      try {
        const packed = await ensureCachedPackage(lisBridgeCacheDirectory(), { force: true });
        const { buffer, ...meta } = packed;
        return success(request, response, { ...meta, ready: true, size_kb: Math.round((meta.size_bytes || 0) / 1024), rebuilt: true });
      } catch (error) {
        return failure(request, response, 'PACKAGE_UNAVAILABLE', error instanceof Error ? error.message : 'Unable to rebuild LIS Bridge package.', 500);
      }
    }

    if (request.method === 'GET' && route === '/api/v1/admin/lis-bridge/download') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can download the LIS Bridge package.', 403);
      try {
        const packed = await ensureCachedPackage(lisBridgeCacheDirectory());
        return sendZip(request, response, packed.filename || 'hec-em200-lis-bridge.zip', packed.buffer);
      } catch (error) {
        return failure(request, response, 'PACKAGE_UNAVAILABLE', error instanceof Error ? error.message : 'Unable to download LIS Bridge package.', 500);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/admin/lis-bridge/erp-check') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can run the ERP check.', 403);
      const body = await readJson(request, 100_000);
      const result = await checkErpConnectivity({
        backend_base_url: body.backend_base_url,
        site_name: body.site_name,
        api_key: body.api_key,
        api_secret: body.api_secret,
        barcode: body.barcode,
      });
      return success(request, response, result);
    }

    if (request.method === 'GET' && route === '/api/v1/admin/lis-bridge/config-template') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can export the LIS Bridge config template.', 403);
      return success(request, response, {
        filename: 'em200.env.json',
        config: buildConfigTemplate(),
        note: 'Base config for franchise USB / portal. Fill API_KEY / API_SECRET from Health Ecosystem Settings.',
      });
    }

    if (route.startsWith('/api/v1/admin/training/videos') && !requireOfficer(request)) {
      return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can manage training videos.', 403);
    }
    if (request.method === 'GET' && route === '/api/v1/admin/training/videos') {
      return success(request, response, database.training_videos.slice().sort((first, second) => first.sort_order - second.sort_order));
    }
    if (request.method === 'POST' && route === '/api/v1/admin/training/videos') {
      const body = await readJson(request, 48_000_000);
      const fields = trainingVideoFieldsFromBody(body);
      if (fields.error) return failure(request, response, 'VALIDATION_ERROR', fields.error, 400);
      if (!fields.title) return failure(request, response, 'VALIDATION_ERROR', 'Enter a training video title.', 400);
      let videoUrl = fields.video_url;
      const fileData = applicationDocumentData(body.file?.data_url ?? body.data_url);
      if (fileData) {
        await mkdir(uploadsDirectory, { recursive: true });
        const safeName = text(body.file?.name ?? body.name, 180).replace(/[^A-Za-z0-9._-]/g, '_') || 'training-video.mp4';
        const ext = safeName.includes('.') ? safeName.split('.').pop() : 'mp4';
        const filename = `training-video-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
        await writeFile(path.join(uploadsDirectory, filename), fileData.bytes);
        videoUrl = `/uploads/${filename}`;
        fields.video_url = videoUrl;
        fields.mime = 'video/mp4';
        fields.youtube_embed_code = '';
        fields.youtube_embed_url = '';
      }
      if (!videoUrl) return failure(request, response, 'VALIDATION_ERROR', 'Provide a YouTube embed code, video URL or upload a video file.', 400);
      const now = new Date().toISOString();
      const video = trainingVideoRecord({ ...fields, id: randomUUID(), created_at: now, updated_at: now });
      database.training_videos.push(video);
      await saveDatabase();
      return success(request, response, video, 201);
    }
    const trainingVideoIdMatch = route.match(/^\/api\/v1\/admin\/training\/videos\/([^/]+)$/);
    if (trainingVideoIdMatch && request.method === 'PATCH') {
      const index = database.training_videos.findIndex((item) => item.id === trainingVideoIdMatch[1]);
      if (index < 0) return failure(request, response, 'NOT_FOUND', 'Training video not found.', 404);
      const body = await readJson(request, 48_000_000);
      const current = database.training_videos[index];
      const fields = trainingVideoFieldsFromBody(body, current);
      if (fields.error) return failure(request, response, 'VALIDATION_ERROR', fields.error, 400);
      let videoUrl = fields.video_url;
      const fileData = applicationDocumentData(body.file?.data_url ?? body.data_url);
      if (fileData) {
        await mkdir(uploadsDirectory, { recursive: true });
        const safeName = text(body.file?.name ?? body.name, 180).replace(/[^A-Za-z0-9._-]/g, '_') || 'training-video.mp4';
        const ext = safeName.includes('.') ? safeName.split('.').pop() : 'mp4';
        const filename = `training-video-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
        await writeFile(path.join(uploadsDirectory, filename), fileData.bytes);
        videoUrl = `/uploads/${filename}`;
        fields.video_url = videoUrl;
        fields.mime = 'video/mp4';
        fields.youtube_embed_code = '';
        fields.youtube_embed_url = '';
      }
      database.training_videos[index] = trainingVideoRecord({
        ...current,
        ...fields,
        title: fields.title || current.title,
        updated_at: new Date().toISOString(),
      }, current.id);
      await saveDatabase();
      return success(request, response, database.training_videos[index]);
    }
    if (trainingVideoIdMatch && request.method === 'DELETE') {
      database.training_videos = database.training_videos.filter((item) => item.id !== trainingVideoIdMatch[1]);
      await saveDatabase();
      return success(request, response, { message: 'Training video deleted.' });
    }

    const applicationAdvanceMatch = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/advance$/);
    if (applicationAdvanceMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can advance an application.', 403);
      const application = database.applications.find((item) => item.id === applicationAdvanceMatch[1] && item.visible_to_admin);
      if (!application) return failure(request, response, 'NOT_FOUND', 'Application not found.', 404);
      const next = nextApplicationAction(application);
      if (!next) return failure(request, response, 'WORKFLOW_COMPLETE', 'There is no officer action due for this application at this stage.');
      if (!application.territory_id) return failure(request, response, 'TERRITORY_REQUIRED', 'Assign an available FOFO or FOCO territory before moving this franchise application to the next stage.');
      const body = await readJson(request);
      if (application.stage === 'payment_1_received') {
        const unverified = [...applicationDocumentKinds].filter((kind) => !documentIsVerified(application, kind));
        if (unverified.length) return failure(request, response, 'DOCUMENTS_NOT_VERIFIED', `Verify all four KYC documents before proceeding. Still pending: ${unverified.map((kind) => kind === 'photo' ? 'photograph' : kind === 'pan' ? 'PAN card' : kind === 'aadhaar' ? 'Aadhaar card' : 'Voter ID card').join(', ')}.`, 409);
        application.review_notes = text(body.review_notes, 2_000);
        applicationReviewHistory(application, 'manual_review_completed', `Manual document and application review completed. ${application.review_notes ? `Note: ${application.review_notes}` : 'No review note added.'}`, request);
      }
      application.stage = next.stage;
      if (next.unlock) {
        const payment = application.payments.find((item) => item.key === next.unlock);
        if (payment) payment.status = 'due';
      }
      application.updated_at = new Date().toISOString();
      syncApplicationTerritoryStatus(application);
      completeLinkedLeadsForApplication(application);
      await saveDatabase();
      return success(request, response, { application: applicationSummary(application), action: next.label });
    }

    if (request.method === 'DELETE' && route.match(/^\/api\/v1\/leads\/([^/]+)$/)) {
      const session = requirePermission(request, response, 'hard_delete');
      if (!session) return;
      const leadId = route.match(/^\/api\/v1\/leads\/([^/]+)$/)[1];
      const result = hardDeleteLead(database, leadId, session);
      if (result.error) return failure(request, response, 'NOT_FOUND', result.error, 404);
      let erp = null;
      try {
        if (result.cascade.hec_lead_id || result.cascade.source === 'reach_sales') {
          erp = await archiveReachLeadViaErp({
            hecLeadId: result.cascade.hec_lead_id,
            rfmsLeadId: result.cascade.rfms_lead_id,
            reason: `Hard-deleted by ${session.name} from FFMS Admin`,
          });
        }
      } catch (error) {
        erp = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await saveDatabase();
      return success(request, response, { deleted: true, entity: 'lead', id: leadId, confirm_message: hardDeleteConfirmMessage(), erp });
    }

    if (request.method === 'DELETE' && route.match(/^\/api\/v1\/sales-visits\/([^/]+)$/)) {
      const session = requirePermission(request, response, 'hard_delete');
      if (!session) return;
      const visitId = route.match(/^\/api\/v1\/sales-visits\/([^/]+)$/)[1];
      const result = hardDeleteVisit(database, visitId, session);
      if (result.error) return failure(request, response, 'NOT_FOUND', result.error, 404);
      let erp = null;
      try {
        if (result.cascade.hec_visit_id) {
          erp = await archiveFieldVisitViaErp({
            hecVisitId: result.cascade.hec_visit_id,
            reason: `Hard-deleted by ${session.name} from FFMS Admin`,
          });
        }
      } catch (error) {
        erp = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await saveDatabase();
      return success(request, response, { deleted: true, entity: 'sales_visit', id: visitId, confirm_message: hardDeleteConfirmMessage(), erp });
    }

    if (request.method === 'DELETE' && route.match(/^\/api\/v1\/appointments\/([^/]+)$/)) {
      const session = requirePermission(request, response, 'hard_delete');
      if (!session) return;
      const appointmentId = route.match(/^\/api\/v1\/appointments\/([^/]+)$/)[1];
      const result = hardDeleteAppointment(database, appointmentId, session);
      if (result.error) return failure(request, response, 'NOT_FOUND', result.error, 404);
      await saveDatabase();
      return success(request, response, { deleted: true, entity: 'appointment', id: appointmentId, confirm_message: hardDeleteConfirmMessage() });
    }

    if (request.method === 'DELETE' && route.match(/^\/api\/v1\/admin\/applications\/([^/]+)$/)) {
      const session = requirePermission(request, response, 'hard_delete');
      if (!session) return;
      const applicationId = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)$/)[1];
      const result = hardDeleteApplication(database, applicationId, session);
      if (result.error) return failure(request, response, 'NOT_FOUND', result.error, 404);
      const erp = { reach: null, partner: null };
      try {
        if (result.cascade.hec_lead_id) {
          erp.reach = await archiveReachLeadViaErp({
            hecLeadId: result.cascade.hec_lead_id,
            reason: `Applicant hard-deleted by ${session.name} from FFMS Admin`,
          });
        }
      } catch (error) {
        erp.reach = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      try {
        if (result.cascade.hec_franchisee_profile || result.cascade.partner_portal_user_id || result.cascade.franchisee_id) {
          erp.partner = await disablePartnerPortalViaErp({
            franchiseeProfile: result.cascade.hec_franchisee_profile,
            userId: result.cascade.partner_portal_user_id,
            franchiseeId: result.cascade.franchisee_id,
            reason: `Applicant hard-deleted by ${session.name} from FFMS Admin`,
          });
        }
      } catch (error) {
        erp.partner = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await saveDatabase();
      return success(request, response, { deleted: true, entity: 'application', id: applicationId, confirm_message: hardDeleteConfirmMessage(), erp, cascade: result.cascade });
    }

    if (request.method === 'DELETE' && route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/([^/]+)$/)) {
      const session = requirePermission(request, response, 'hard_delete');
      if (!session) return;
      const match = route.match(/^\/api\/v1\/admin\/applications\/([^/]+)\/payments\/([^/]+)$/);
      const result = hardDeletePaymentSubmission(database, match[1], decodeURIComponent(match[2]), session);
      if (result.error) return failure(request, response, 'NOT_FOUND', result.error, 404);
      await saveDatabase();
      return success(request, response, {
        deleted: true,
        entity: 'payment',
        application_id: match[1],
        payment_key: match[2],
        confirm_message: hardDeleteConfirmMessage(),
      });
    }

    if (request.method === 'GET' && route === '/api/v1/leads') {
      if (!requirePermission(request, response, 'leads')) return;
      return success(request, response, [...database.leads].filter((lead) => crmLeadAccess(request, lead)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    }

    if (request.method === 'GET' && route === '/api/v1/crm/team') {
      if (!requirePermission(request, response, 'leads')) return;
      if (!canManageCrm(request)) return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can view the CRM assignment roster.', 403);
      return success(request, response, assignableTeamMembers(ensureOfficersArray(), 'leads'));
    }

    if (request.method === 'GET' && route === '/api/v1/appointments/team') {
      if (!requirePermission(request, response, 'appointments')) return;
      if (!canManageAppointments(request)) return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can view the appointment assignment roster.', 403);
      return success(request, response, assignableTeamMembers(ensureOfficersArray(), 'appointments'));
    }

    if (request.method === 'GET' && route === '/api/v1/support/team') {
      if (!requirePermission(request, response, 'support')) return;
      return success(request, response, assignableTeamMembers(ensureOfficersArray(), 'support'));
    }

    if (request.method === 'POST' && route === '/api/v1/leads') {
      if (!requirePermission(request, response, 'leads')) return;
      const body = await readJson(request);
      const owner = canManageCrm(request) ? crmOwner(body.assigned_to) : leadActor(request);
      const lead = leadRecord({ ...body, source: body.source === 'meta_ads' ? 'meta_ads' : 'manual', stage: body.stage ?? 'new', assigned_to: owner });
      if (!leadIsValid(lead)) return failure(request, response, 'VALIDATION_ERROR', 'Enter lead name, valid email, mobile number, franchise model and preferred territory.');
      database.leads.push(lead);
      workflowNotify({
        module: 'leads',
        action: 'new_lead',
        title: 'New CRM lead created',
        message: `${lead.name} was added to the CRM lead inbox.`,
        actor: workflowActor(request),
        href: `admin:Leads:${lead.id}`,
        entityType: 'lead',
        entityId: lead.id,
        assigneeName: lead.assigned_to,
      });
      await saveDatabase();
      return success(request, response, lead, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/leads/import') {
      if (!requirePermission(request, response, 'leads')) return;
      const body = await readJson(request, 2_000_000);
      const rawSource = String(body.source || '').trim().toLowerCase();
      const source = AD_LEAD_SOURCES.has(rawSource) ? rawSource : leadSource(rawSource === 'meta_ads' ? 'meta_ads' : 'csv_upload');
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
      if (!rows.length) return failure(request, response, 'VALIDATION_ERROR', 'Upload a CSV with at least one lead row.');
      const imported = []; const skipped = [];
      const ownerDefault = canManageCrm(request) ? crmOwner(body.assigned_to) : leadActor(request);
      for (const row of rows) {
        const requestedOwner = row?.assigned_to || body.assigned_to;
        const owner = canManageCrm(request) ? crmOwner(requestedOwner) : leadActor(request);
        const mapped = {
          ...row,
          source,
          stage: row?.stage ?? 'new',
          campaign_name: row?.campaign_name ?? body.campaign_name,
          campaign_id: row?.campaign_id ?? body.campaign_id,
          ad_id: row?.ad_id ?? body.ad_id,
          adset_id: row?.adset_id ?? body.adset_id,
          form_id: row?.form_id ?? body.form_id,
          external_lead_id: row?.external_lead_id || row?.id || row?.lead_id || '',
          platform: row?.platform || (source === 'google_ads' ? 'google' : source === 'whatsapp_ads' ? 'whatsapp' : 'meta'),
          assigned_to: owner || ownerDefault,
        };
        if (AD_LEAD_SOURCES.has(source)) {
          const result = ingestAdLeadsIntoCrm([mapped], { source, campaign_name: body.campaign_name, assigned_to: owner || ownerDefault });
          imported.push(...result.imported, ...result.updated);
          skipped.push(...result.skipped);
          continue;
        }
        const lead = leadRecord(mapped);
        const existing = findExistingAdLead(database.leads, lead);
        if (!leadIsValid(lead) || existing) {
          skipped.push({ name: lead.name || 'Unnamed lead', reason: existing ? 'Duplicate contact' : 'Missing required lead details' });
          continue;
        }
        database.leads.push(lead); imported.push(lead);
      }
      if (imported.length) {
        recordFranchiseAdsIngest(database, { source, count: imported.length, externalLeadId: imported[0]?.external_lead_id || '' });
        workflowNotify({
          module: 'leads',
          action: 'leads_imported',
          title: `${imported.length} lead${imported.length === 1 ? '' : 's'} imported`,
          message: `${imported.length} CRM lead${imported.length === 1 ? '' : 's'} imported from ${source.replaceAll('_', ' ')}.`,
          actor: workflowActor(request),
          href: 'admin:Leads',
          entityType: 'lead_import',
          entityId: String(imported.length),
          assigneeName: canManageCrm(request) ? crmOwner(body.assigned_to) : leadActor(request),
        });
      }
      await saveDatabase();
      return success(request, response, { imported_count: imported.length, skipped_count: skipped.length, skipped, leads: imported }, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/leads/ingest/ad') {
      if (!requireFranchiseAdsSecret(request, response)) return;
      const body = await readJson(request, 2_000_000);
      const rows = Array.isArray(body.leads) ? body.leads : (Array.isArray(body.rows) ? body.rows : [body]);
      const defaults = {
        source: normaliseAdSource(body.source || rows[0]?.source || 'meta_ads'),
        campaign_name: body.campaign_name,
        platform: body.platform,
        assigned_to: body.assigned_to || 'Unassigned',
      };
      const result = ingestAdLeadsIntoCrm(rows.filter(Boolean), defaults);
      recordFranchiseAdsIngest(database, {
        source: defaults.source,
        count: result.imported.length + result.updated.length,
        externalLeadId: (result.imported[0] || result.updated[0] || {}).external_lead_id || '',
      });
      if (result.imported.length || result.updated.length) {
        workflowNotify({
          module: 'leads',
          action: 'leads_imported',
          title: `${result.imported.length + result.updated.length} ad lead${result.imported.length + result.updated.length === 1 ? '' : 's'} ingested`,
          message: `Franchise ads ingest (${defaults.source.replaceAll('_', ' ')}) wrote ${result.imported.length} new and ${result.updated.length} updated CRM lead(s).`,
          actor: { name: 'Franchise ads bridge', role: 'system' },
          href: 'admin:Leads',
          entityType: 'lead_import',
          entityId: String(result.imported.length + result.updated.length),
        });
      }
      await saveDatabase();
      return success(request, response, {
        imported_count: result.imported.length,
        updated_count: result.updated.length,
        skipped_count: result.skipped.length,
        skipped: result.skipped,
        leads: [...result.imported, ...result.updated],
      }, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/sales-visits/ingest') {
      if (!requireFranchiseAdsSecret(request, response)) return;
      const body = await readJson(request, 1_000_000);
      const rows = Array.isArray(body.visits) ? body.visits : (Array.isArray(body.rows) ? body.rows : [body]);
      const result = ingestSalesVisitsIntoCrm(rows.filter(Boolean));
      if (result.imported.length || result.updated.length) {
        workflowNotify({
          module: 'leads',
          action: 'sales_visit_logged',
          title: 'REACH field visit logged',
          message: `${result.imported.length + result.updated.length} visit report${result.imported.length + result.updated.length === 1 ? '' : 's'} synced from REACH.`,
          actor: { name: 'REACH Portal', role: 'system' },
          href: 'admin:Log Visit',
          entityType: 'sales_visit',
          entityId: (result.imported[0] || result.updated[0] || {}).id || '',
        });
      }
      await saveDatabase();
      return success(request, response, {
        imported_count: result.imported.length,
        updated_count: result.updated.length,
        visits: [...result.imported, ...result.updated],
      }, 201);
    }

    // --- Agency Agents (BA/MLM) franchisee onboard requests ---
    if (request.method === 'POST' && route === '/api/v1/agency/onboard-requests') {
      if (!requireFranchiseAdsSecret(request, response)) return;
      const body = await readJson(request, 50_000);
      database.agency_onboard_requests = Array.isArray(database.agency_onboard_requests) ? database.agency_onboard_requests : [];
      const hecRequestId = text(body.request_id, 120);
      let existing = hecRequestId
        ? database.agency_onboard_requests.find((item) => item.hec_request_id === hecRequestId)
        : null;
      const now = new Date().toISOString();
      const prospectName = text(body.prospect_name, 160) || 'Agency prospect';
      const mobile = String(body.mobile || '').replace(/\D/g, '').slice(-10);
      // Mirror into CRM leads for FFMS visibility.
      const lead = leadRecord({
        name: prospectName,
        email: text(body.email, 160) || `agency-${mobile || randomUUID().slice(0, 8)}@agency.ffms.local`,
        mobile: mobile || '0000000000',
        franchise_model: ['FOFO', 'FOCO'].includes(String(body.franchise_model || '').toUpperCase())
          ? String(body.franchise_model).toUpperCase()
          : '',
        territory_query: text(body.territory, 200) || 'Agency territory TBD',
        notes: `Agency agent onboard request ${hecRequestId}. Agent: ${text(body.agent_name, 120)} (${text(body.agent_id, 80)}). ${text(body.notes, 1000)}`,
        source: 'agency_agents',
        stage: 'new',
        priority: 'hot',
        assigned_to: 'Unassigned',
      });
      if (!existing) {
        database.leads = Array.isArray(database.leads) ? database.leads : [];
        database.leads.unshift(lead);
      }
      const row = {
        id: existing?.id || randomUUID(),
        hec_request_id: hecRequestId,
        lead_id: existing?.lead_id || lead.id,
        agent_id: text(body.agent_id, 120),
        agent_name: text(body.agent_name, 160),
        agent_email: text(body.agent_email, 160),
        agent_mobile: text(body.agent_mobile, 20),
        agent_level: text(body.agent_level, 40),
        prospect_name: prospectName,
        mobile,
        email: text(body.email, 160),
        territory: text(body.territory, 200),
        franchise_model: text(body.franchise_model, 20),
        deal_value: Number(body.deal_value) || 0,
        notes: text(body.notes, 2000),
        status: existing?.status || 'pending',
        decided_by: existing?.decided_by || '',
        decided_at: existing?.decided_at || '',
        decision_notes: existing?.decision_notes || '',
        created_at: existing?.created_at || now,
        updated_at: now,
        source: 'agency_agents',
      };
      if (existing) Object.assign(existing, row);
      else database.agency_onboard_requests.unshift(row);
      workflowNotify({
        module: 'leads',
        action: 'agency_onboard_request',
        title: 'Agency franchisee onboard request',
        message: `${row.agent_name || 'Agency agent'} requested onboarding for ${prospectName}.`,
        actor: { name: row.agent_name || 'Agency Agents', role: 'agency' },
        href: 'admin:Agency Onboard',
        entityType: 'agency_onboard_request',
        entityId: row.id,
      });
      await saveDatabase();
      return success(request, response, { id: row.id, lead_id: row.lead_id, hec_request_id: row.hec_request_id, status: row.status }, 201);
    }

    if (request.method === 'GET' && route === '/api/v1/agency/onboard-requests') {
      if (!requirePermission(request, response, 'leads')) return;
      database.agency_onboard_requests = Array.isArray(database.agency_onboard_requests) ? database.agency_onboard_requests : [];
      const status = text(new URL(request.url, 'http://localhost').searchParams.get('status') || '', 40).toLowerCase();
      let rows = [...database.agency_onboard_requests];
      if (status) rows = rows.filter((item) => String(item.status || '').toLowerCase() === status);
      return success(request, response, { requests: rows, count: rows.length });
    }

    if (request.method === 'POST' && /^\/api\/v1\/agency\/onboard-requests\/[^/]+\/decide$/.test(route)) {
      if (!requirePermission(request, response, 'leads')) return;
      if (!canManageCrm(request)) return failure(request, response, 'FORBIDDEN', 'Only CRM managers can approve agency onboard requests.', 403);
      const requestId = route.split('/')[5];
      database.agency_onboard_requests = Array.isArray(database.agency_onboard_requests) ? database.agency_onboard_requests : [];
      const row = database.agency_onboard_requests.find((item) => item.id === requestId);
      if (!row) return failure(request, response, 'NOT_FOUND', 'Agency onboard request not found.', 404);
      const body = await readJson(request, 8_000);
      const decision = text(body.decision || body.status, 20).toLowerCase();
      if (!['approved', 'rejected'].includes(decision)) {
        return failure(request, response, 'VALIDATION_ERROR', 'decision must be approved or rejected.', 400);
      }
      const actor = leadActor(request);
      try {
        await agencyOnboardDecisionViaErp({
          requestId: row.hec_request_id,
          decision,
          decidedBy: actor,
          notes: text(body.notes, 2000),
          ffmsLeadId: row.lead_id,
        });
      } catch (error) {
        return failure(request, response, 'REACH_SYNC_ERROR', error instanceof Error ? error.message : 'Unable to sync decision to ERP.', 502);
      }
      row.status = decision;
      row.decided_by = actor;
      row.decided_at = new Date().toISOString();
      row.decision_notes = text(body.notes, 2000);
      row.updated_at = row.decided_at;
      if (row.lead_id) {
        const lead = database.leads.find((item) => item.id === row.lead_id);
        if (lead) {
          addLeadActivity(
            lead,
            'note',
            `Agency onboard request ${decision} by ${actor}.${row.decision_notes ? ` ${row.decision_notes}` : ''}`,
            actor,
          );
          if (decision === 'approved' && lead.stage === 'new') lead.stage = 'qualified';
        }
      }
      await saveDatabase();
      return success(request, response, row);
    }

    if (request.method === 'POST' && route === '/api/v1/b2b-centres/ingest') {
      if (!requireFranchiseAdsSecret(request, response)) return;
      const body = await readJson(request, 1_000_000);
      const rows = Array.isArray(body.centres) ? body.centres : [body];
      const centres = ingestB2bCentres(database, rows.filter(Boolean));
      await saveDatabase();
      return success(request, response, { imported_count: centres.length, centres, centre: centres[0] || null }, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/b2b-sales/ingest') {
      if (!requireFranchiseAdsSecret(request, response)) return;
      const body = await readJson(request, 1_000_000);
      const rows = Array.isArray(body.entries) ? body.entries : [body];
      const entries = ingestB2bSales(database, rows.filter(Boolean));
      await saveDatabase();
      return success(request, response, { imported_count: entries.length, entries, entry: entries[0] || null }, 201);
    }

    if (request.method === 'GET' && route === '/api/v1/admin/b2b/summary') {
      if (!requirePermission(request, response, 'b2b_operations')) return;
      ensureB2bCollections(database);
      return success(request, response, b2bOperationsSummary(database));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/b2b/centres') {
      if (!requirePermission(request, response, 'b2b_operations')) return;
      ensureB2bCollections(database);
      return success(request, response, [...database.b2b_collection_centres].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/b2b/sales') {
      if (!requirePermission(request, response, 'b2b_operations')) return;
      ensureB2bCollections(database);
      return success(request, response, [...database.b2b_sales_entries].sort((a, b) => String(b.sales_date || b.updated_at).localeCompare(String(a.sales_date || a.updated_at))));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/b2b/performance') {
      if (!requirePermission(request, response, 'b2b_operations')) return;
      ensureB2bCollections(database);
      const url = new URL(request.url, 'http://localhost');
      return success(request, response, b2bSalesPerformance(database, {
        centre_id: url.searchParams.get('centre_id') || '',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        period: url.searchParams.get('period') || 'daily',
      }));
    }

    const b2bSalesPatchMatch = route.match(/^\/api\/v1\/admin\/b2b\/sales\/([^/]+)$/);
    if (b2bSalesPatchMatch && request.method === 'DELETE') {
      const session = requirePermission(request, response, 'b2b_hard_delete');
      if (!session) return;
      ensureB2bCollections(database);
      const result = hardDeleteB2bSalesEntry(database, decodeURIComponent(b2bSalesPatchMatch[1]), session);
      if (result.error) return failure(request, response, 'NOT_FOUND', result.error, 404);
      let erp = null;
      try {
        if (result.cascade.hec_sales_id) {
          erp = await deleteB2bSalesViaErp({
            hecSalesId: result.cascade.hec_sales_id,
            reason: `Hard-deleted by ${session.name} from FFMS B2B Operations`,
          });
        }
      } catch (error) {
        erp = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await saveDatabase();
      return success(request, response, {
        deleted: true,
        entity: 'b2b_sales_entry',
        id: result.entry.id,
        confirm_message: hardDeleteConfirmMessage(),
        erp,
      });
    }

    if (b2bSalesPatchMatch && request.method === 'PATCH') {
      const session = requirePermission(request, response, 'b2b_operations');
      if (!session) return;
      ensureB2bCollections(database);
      const entry = database.b2b_sales_entries.find((item) => item.id === b2bSalesPatchMatch[1] || item.hec_sales_id === b2bSalesPatchMatch[1]);
      if (!entry) return failure(request, response, 'NOT_FOUND', 'B2B sales entry not found.', 404);
      const body = await readJson(request);
      if (body.status) entry.status = text(body.status, 40);
      if (Object.prototype.hasOwnProperty.call(body, 'assigned_logistics_person')) entry.assigned_logistics_person = text(body.assigned_logistics_person, 140);
      if (Object.prototype.hasOwnProperty.call(body, 'remarks')) entry.remarks = text(body.remarks, 1000);
      if (Object.prototype.hasOwnProperty.call(body, 'business_value')) entry.business_value = Number(body.business_value) || 0;
      if (Object.prototype.hasOwnProperty.call(body, 'number_of_samples')) entry.number_of_samples = Math.max(0, Math.floor(Number(body.number_of_samples) || 0));
      entry.updated_at = new Date().toISOString();
      let erp = null;
      try {
        if (entry.hec_sales_id) {
          erp = await updateB2bSalesStatusViaErp({
            hecSalesId: entry.hec_sales_id,
            status: entry.status,
            assignedLogisticsPerson: entry.assigned_logistics_person,
            remarks: entry.remarks,
          });
        }
      } catch (error) {
        erp = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await saveDatabase();
      return success(request, response, { entry, erp });
    }

    const b2bCentrePatchMatch = route.match(/^\/api\/v1\/admin\/b2b\/centres\/([^/]+)$/);
    if (b2bCentrePatchMatch && request.method === 'DELETE') {
      const session = requirePermission(request, response, 'b2b_hard_delete');
      if (!session) return;
      ensureB2bCollections(database);
      const result = hardDeleteB2bCentre(database, decodeURIComponent(b2bCentrePatchMatch[1]), session, { cascadeSales: true });
      if (result.error) return failure(request, response, 'NOT_FOUND', result.error, 404);
      let erp = null;
      try {
        if (result.cascade.hec_centre_id) {
          erp = await deleteB2bCentreViaErp({
            hecCentreId: result.cascade.hec_centre_id,
            reason: `Hard-deleted by ${session.name} from FFMS B2B Operations`,
            cascadeSales: true,
          });
        }
      } catch (error) {
        erp = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await saveDatabase();
      return success(request, response, {
        deleted: true,
        entity: 'b2b_collection_centre',
        id: result.centre.id,
        sales_deleted: result.cascade.sales_count,
        confirm_message: hardDeleteConfirmMessage(),
        erp,
      });
    }

    if (b2bCentrePatchMatch && request.method === 'PATCH') {
      const session = requirePermission(request, response, 'b2b_operations');
      if (!session) return;
      ensureB2bCollections(database);
      const centre = database.b2b_collection_centres.find((item) => item.id === b2bCentrePatchMatch[1] || item.hec_centre_id === b2bCentrePatchMatch[1]);
      if (!centre) return failure(request, response, 'NOT_FOUND', 'B2B collection centre not found.', 404);
      const body = await readJson(request);
      if (body.status) centre.status = text(body.status, 40);
      if (Array.isArray(body.logistics_assignments)) {
        centre.logistics_assignments = body.logistics_assignments.map((item) => ({
          person_name: text(item?.person_name, 140),
          contact_number: text(item?.contact_number, 40),
          pickup_point: text(item?.pickup_point, 200),
          logistics_cost: Number(item?.logistics_cost) || 0,
        })).filter((item) => item.person_name);
      }
      centre.updated_at = new Date().toISOString();
      await saveDatabase();
      return success(request, response, { centre });
    }

    if (request.method === 'GET' && route === '/api/v1/sales-visits') {
      if (!requirePermission(request, response, 'leads')) return;
      const visits = [...(database.sales_visits || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      // Assign Lead must list every active CRM lead (FFMS manual/upload/ads + REACH), not only REACH-synced rows.
      const TERMINAL_LEAD_STAGES = new Set(['won', 'lost', 'completed', 'disqualified']);
      const reachLeads = (database.leads || [])
        .filter((lead) => !TERMINAL_LEAD_STAGES.has(String(lead.stage || '').toLowerCase()))
        .filter((lead) => crmLeadAccess(request, lead))
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      const performanceMap = new Map();
      for (const visit of visits) {
        const key = visit.reach_user || visit.sales_rep_id || 'Unassigned';
        if (!performanceMap.has(key)) {
          performanceMap.set(key, {
            reach_user: key,
            sales_rep_id: visit.sales_rep_id || '',
            total_visits: 0,
            completed: 0,
            assigned: 0,
            positive: 0,
            with_photo: 0,
            with_gps: 0,
          });
        }
        const row = performanceMap.get(key);
        row.total_visits += 1;
        if (visit.visit_status === 'completed') row.completed += 1;
        if (visit.visit_status === 'assigned') row.assigned += 1;
        if (String(visit.outcome || '').toLowerCase() === 'positive') row.positive += 1;
        if (visit.photo_url || visit.photo_data_url) row.with_photo += 1;
        if (visit.latitude != null && visit.longitude != null && (Number(visit.latitude) || Number(visit.longitude))) row.with_gps += 1;
      }
      const performance = [...performanceMap.values()].sort((a, b) => b.total_visits - a.total_visits);
      return success(request, response, {
        visits,
        reach_leads: reachLeads,
        performance,
        stats: {
          total_visits: visits.length,
          visits_today: visits.filter((item) => String(item.visit_date || item.created_at || '').startsWith(new Date().toISOString().slice(0, 10))).length,
          reach_leads: reachLeads.length,
          open_leads: reachLeads.filter((lead) => !['won', 'lost', 'completed', 'disqualified'].includes(lead.stage)).length,
          assigned_visits: visits.filter((item) => item.visit_status === 'assigned').length,
          completed_visits: visits.filter((item) => item.visit_status === 'completed').length,
        },
      });
    }

    if (request.method === 'GET' && route === '/api/v1/sales-visits/reach-reps') {
      if (!requirePermission(request, response, 'leads')) return;
      if (!canManageCrm(request)) return failure(request, response, 'FORBIDDEN', 'Only CRM managers can list REACH users.', 403);
      try {
        const remote = await listReachRepsViaErp();
        const reps = Array.isArray(remote.reps) ? remote.reps : [];
        return success(request, response, { reps });
      } catch (error) {
        return failure(request, response, 'REACH_SYNC_ERROR', error instanceof Error ? error.message : 'Unable to load REACH users.', 502);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/sales-visits/assign-lead') {
      if (!requirePermission(request, response, 'leads')) return;
      if (!canManageCrm(request)) return failure(request, response, 'FORBIDDEN', 'Only CRM managers can assign REACH users.', 403);
      const body = await readJson(request, 8_000);
      const lead = database.leads.find((item) => item.id === text(body.lead_id, 80));
      if (!lead) return failure(request, response, 'NOT_FOUND', 'Lead not found.', 404);
      const assigneeRole = text(body.assignee_role || body.role, 40).toLowerCase().replace(/[\s-]+/g, '_') || 'reach';
      const salesRepId = text(body.sales_rep_id, 120);
      const reachUser = text(body.reach_user || body.assigned_to || body.assigned_to_name, 120);
      if (!reachUser && !salesRepId) return failure(request, response, 'VALIDATION_ERROR', 'Assignee is required.', 400);
      const isReachAssign = assigneeRole === 'reach' || assigneeRole === 'log_visit';
      if (isReachAssign && !salesRepId) {
        return failure(request, response, 'VALIDATION_ERROR', 'Choose a REACH user (sales_rep_id) for Log Visit assignment.', 400);
      }
      if (isReachAssign) {
        const phoneDigits = String(lead.mobile || '').replace(/\D/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(phoneDigits)) {
          return failure(request, response, 'VALIDATION_ERROR', 'Lead needs a valid 10-digit mobile before REACH Log Visit sync.', 400);
        }
      }
      const actor = leadActor(request);
      try {
        if (lead.hec_lead_id || isReachAssign) {
          const remote = await assignReachLeadViaErp({
            hecLeadId: lead.hec_lead_id || '',
            rfmsLeadId: lead.id,
            salesRepId: salesRepId || (isReachAssign ? reachUser : ''),
            assignedToName: reachUser,
            assigneeRole,
            createVisit: isReachAssign,
            assignedFrom: actor,
            lead: {
              name: lead.name,
              lead_name: lead.name,
              email: lead.email,
              phone: lead.mobile,
              mobile: lead.mobile,
              territory_query: lead.territory_query,
              address: lead.territory_query,
              notes: lead.notes,
              stage: lead.stage,
              source: lead.source,
              campaign_name: lead.campaign_name,
              franchise_model: lead.franchise_model,
            },
          });
          if (remote?.lead_id) lead.hec_lead_id = text(remote.lead_id, 120);
          if (remote?.assigned_rep) lead.sales_rep_id = text(remote.assigned_rep, 120);
          if (salesRepId) lead.sales_rep_id = salesRepId;
          if (isReachAssign) {
            if (!remote?.visit_id) {
              throw new Error('REACH Log Visit was not created in ERP. Assignment aborted — nothing synced to the field app.');
            }
            ingestSalesVisitsIntoCrm([{
              hec_visit_id: remote.visit_id,
              hec_lead_id: lead.hec_lead_id || remote.lead_id || '',
              rfms_lead_id: lead.id,
              lead_name: lead.name,
              lead_phone: lead.mobile,
              reach_user: reachUser,
              sales_rep_id: lead.sales_rep_id || salesRepId,
              visit_status: 'assigned',
              purpose: 'Meet Lead',
              assigned_from: actor,
              notes: `Assigned from FFMS to ${reachUser || salesRepId} for field Log Visit.`,
            }]);
          }
        }
      } catch (error) {
        return failure(request, response, 'REACH_SYNC_ERROR', error instanceof Error ? error.message : 'Unable to sync assignment to REACH.', 502);
      }
      lead.assigned_to = reachUser || lead.assigned_to;
      lead.assignee_role = assigneeRole;
      if (salesRepId) lead.sales_rep_id = salesRepId;
      if (isReachAssign) {
        lead.reach_user_name = reachUser || lead.reach_user_name;
      }
      addLeadActivity(
        lead,
        'owner_change',
        `Assigned to ${lead.assigned_to} (${assigneeRole.replaceAll('_', ' ')}) for ${isReachAssign ? 'Log Visit' : 'CRM handling'}.`,
        actor,
      );
      await saveDatabase();
      return success(request, response, lead);
    }

    if (request.method === 'GET' && route === '/api/v1/leads/ads/status') {
      if (!requirePermission(request, response, 'leads')) return;
      return success(request, response, franchiseAdsStatus(database));
    }

    if (request.method === 'POST' && (route === '/api/v1/leads/webhooks/meta' || route === '/api/v1/leads/webhooks/google')) {
      // Thin public aliases: accept already-enriched payloads (primary path is ERP webhook).
      if (!requireFranchiseAdsSecret(request, response)) return;
      const body = await readJson(request, 2_000_000);
      const source = route.endsWith('/google') ? 'google_ads' : normaliseAdSource(body.source || 'meta_ads');
      const rows = Array.isArray(body.leads) ? body.leads : (Array.isArray(body.rows) ? body.rows : [body]);
      const result = ingestAdLeadsIntoCrm(rows.filter(Boolean), { source, campaign_name: body.campaign_name, platform: body.platform || (source === 'google_ads' ? 'google' : 'meta') });
      recordFranchiseAdsIngest(database, {
        source,
        count: result.imported.length + result.updated.length,
        externalLeadId: (result.imported[0] || result.updated[0] || {}).external_lead_id || '',
      });
      if (result.imported.length || result.updated.length) {
        workflowNotify({
          module: 'leads',
          action: 'leads_imported',
          title: `${result.imported.length + result.updated.length} webhook lead${result.imported.length + result.updated.length === 1 ? '' : 's'}`,
          message: `RFMS ${source.replaceAll('_', ' ')} webhook alias ingested leads.`,
          actor: { name: 'Franchise ads webhook', role: 'system' },
          href: 'admin:Leads',
          entityType: 'lead_import',
          entityId: String(result.imported.length + result.updated.length),
        });
      }
      await saveDatabase();
      return success(request, response, {
        imported_count: result.imported.length,
        updated_count: result.updated.length,
        skipped_count: result.skipped.length,
        skipped: result.skipped,
        leads: [...result.imported, ...result.updated],
      }, 201);
    }

    const leadWhatsappMatch = route.match(/^\/api\/v1\/leads\/([^/]+)\/whatsapp$/);
    if (leadWhatsappMatch && request.method === 'GET') {
      if (!requirePermission(request, response, 'leads')) return;
      const lead = database.leads.find((item) => item.id === leadWhatsappMatch[1]);
      if (!lead) return failure(request, response, 'NOT_FOUND', 'Lead not found.', 404);
      if (!crmLeadAccess(request, lead)) return failure(request, response, 'LEAD_ASSIGNED', 'This lead is assigned to another CRM employee.', 403);
      try {
        const remote = await fetchFranchiseWhatsappThreadViaErp({
          phone: lead.mobile,
          rfmsLeadId: lead.id,
          conversationId: lead.whatsapp_conversation_id || '',
        });
        const messages = Array.isArray(remote?.messages) ? remote.messages : (lead.whatsapp_messages || []);
        if (remote?.conversation?.id) lead.whatsapp_conversation_id = remote.conversation.id;
        if (messages.length) {
          lead.whatsapp_messages = messages.map((item) => ({
            id: item.id || randomUUID(),
            direction: item.direction === 'Out' ? 'Out' : 'In',
            body: item.body || '',
            meta_message_id: item.meta_message_id || '',
            status: item.status || 'received',
            created_at: item.created_at || new Date().toISOString(),
          }));
          lead.whatsapp_last_at = lead.whatsapp_messages[lead.whatsapp_messages.length - 1]?.created_at || lead.whatsapp_last_at;
          await saveDatabase();
        }
        return success(request, response, {
          conversation: remote?.conversation || { id: lead.whatsapp_conversation_id || '', phone: lead.mobile, rfms_lead_id: lead.id },
          messages: lead.whatsapp_messages || [],
        });
      } catch (error) {
        return success(request, response, {
          conversation: { id: lead.whatsapp_conversation_id || '', phone: lead.mobile, rfms_lead_id: lead.id },
          messages: lead.whatsapp_messages || [],
          warning: error instanceof Error ? error.message : 'ERP thread unavailable; showing local cache.',
        });
      }
    }

    if (leadWhatsappMatch && request.method === 'POST') {
      if (!requirePermission(request, response, 'leads')) return;
      const lead = database.leads.find((item) => item.id === leadWhatsappMatch[1]);
      if (!lead) return failure(request, response, 'NOT_FOUND', 'Lead not found.', 404);
      if (!crmLeadAccess(request, lead)) return failure(request, response, 'LEAD_ASSIGNED', 'This lead is assigned to another CRM employee.', 403);
      if (lead.stage === 'completed') return failure(request, response, 'LEAD_COMPLETED', 'Completed leads are read-only.', 409);
      const body = await readJson(request);
      const message = text(body.message, 4000);
      if (!message) return failure(request, response, 'VALIDATION_ERROR', 'Enter a WhatsApp reply.');
      const actor = leadActor(request);
      try {
        const remote = await sendFranchiseWhatsappReplyViaErp({
          phone: lead.mobile,
          message,
          rfmsLeadId: lead.id,
          conversationId: lead.whatsapp_conversation_id || '',
        });
        if (remote?.conversation_id) lead.whatsapp_conversation_id = remote.conversation_id;
        appendLeadWhatsappMessage(lead, {
          direction: 'Out',
          body: message,
          meta_message_id: remote?.meta_id || '',
          status: 'sent',
          conversation_id: remote?.conversation_id || lead.whatsapp_conversation_id,
        });
        addLeadActivity(lead, 'whatsapp', `WhatsApp reply sent: ${message.slice(0, 240)}`, actor);
        await saveDatabase();
        return success(request, response, { lead, messages: lead.whatsapp_messages });
      } catch (error) {
        return failure(request, response, 'WHATSAPP_SEND_FAILED', error instanceof Error ? error.message : 'Unable to send WhatsApp reply.', 502);
      }
    }

    if (request.method === 'POST' && route === '/api/v1/leads/whatsapp/link') {
      if (!requireWhatsappCloudSecret(request, response)) return;
      const body = await readJson(request);
      let lead = findLeadByMobileDigits(body.phone);
      if (!lead) {
        const digits = String(body.phone || '').replace(/\D/g, '').slice(-10);
        lead = leadRecord({
          name: text(body.contact_name, 120) || `WhatsApp ${digits}`,
          email: digits ? `${digits}@wa.franchise.local` : `wa-${randomUUID().slice(0, 8)}@wa.franchise.local`,
          mobile: digits,
          source: 'whatsapp_ads',
          platform: 'whatsapp',
          assigned_to: 'Unassigned',
          stage: 'new',
          whatsapp_conversation_id: body.conversation_id,
        });
        database.leads.unshift(lead);
      }
      if (body.conversation_id) lead.whatsapp_conversation_id = text(body.conversation_id, 120);
      if (body.franchise_sales_lead) lead.hec_lead_id = text(body.franchise_sales_lead, 120);
      await saveDatabase();
      return success(request, response, { lead_id: lead.id, conversation_id: lead.whatsapp_conversation_id || '' });
    }

    if (request.method === 'POST' && route === '/api/v1/leads/whatsapp/inbound') {
      if (!requireWhatsappCloudSecret(request, response)) return;
      const body = await readJson(request);
      let lead = null;
      if (body.rfms_lead_id) lead = database.leads.find((item) => item.id === body.rfms_lead_id) || null;
      if (!lead) lead = findLeadByMobileDigits(body.phone);
      if (!lead) {
        const digits = String(body.phone || '').replace(/\D/g, '').slice(-10);
        lead = leadRecord({
          name: text(body.contact_name, 120) || `WhatsApp ${digits}`,
          email: digits ? `${digits}@wa.franchise.local` : `wa-${randomUUID().slice(0, 8)}@wa.franchise.local`,
          mobile: digits,
          source: 'whatsapp_ads',
          platform: 'whatsapp',
          assigned_to: 'Unassigned',
          stage: 'new',
        });
        database.leads.unshift(lead);
      }
      appendLeadWhatsappMessage(lead, {
        direction: body.direction === 'Out' ? 'Out' : 'In',
        body: body.body,
        meta_message_id: body.meta_message_id,
        conversation_id: body.conversation_id,
        status: 'received',
      });
      addLeadActivity(lead, 'whatsapp', `WhatsApp ${body.direction === 'Out' ? 'outbound' : 'inbound'}: ${String(body.body || '').slice(0, 240)}`, 'WhatsApp Cloud');
      await saveDatabase();
      workflowNotify({
        module: 'leads',
        action: 'whatsapp_inbound',
        title: 'WhatsApp message received',
        message: `${lead.name}: ${String(body.body || '').slice(0, 120)}`,
        actor: { name: 'WhatsApp Cloud', role: 'system' },
        href: `admin:Leads:${lead.id}`,
        entityType: 'lead',
        entityId: lead.id,
      });
      return success(request, response, { lead_id: lead.id, messages: lead.whatsapp_messages });
    }

    const leadMatch = route.match(/^\/api\/v1\/leads\/([^/]+)$/);
    if (leadMatch && request.method === 'GET') {
      if (!requirePermission(request, response, 'leads')) return;
      const lead = database.leads.find((item) => item.id === leadMatch[1]);
      if (!lead) return failure(request, response, 'NOT_FOUND', 'Lead not found.', 404);
      if (!crmLeadAccess(request, lead)) return failure(request, response, 'LEAD_ASSIGNED', 'This lead is assigned to another CRM employee.', 403);
      return success(request, response, lead);
    }

    const leadActionMatch = route.match(/^\/api\/v1\/leads\/([^/]+)\/actions$/);
    if (leadActionMatch && request.method === 'POST') {
      if (!requirePermission(request, response, 'leads')) return;
      const lead = database.leads.find((item) => item.id === leadActionMatch[1]);
      if (!lead) return failure(request, response, 'NOT_FOUND', 'Lead not found.', 404);
      if (lead.stage === 'completed') return failure(request, response, 'LEAD_COMPLETED', 'This lead is in the Completed directory after successful onboarding and is read-only.', 409);
      const body = await readJson(request);
      const action = text(body.type, 40).toLowerCase().replace(/[\s-]+/g, '_');
      const actor = leadActor(request);
      const requestedStageValue = text(body.stage, 40).toLowerCase().replace(/[\s-]+/g, '_');
      const requestedStage = leadStages.has(requestedStageValue) ? requestedStageValue : '';
      if (!leadActivityTypes.has(action) || action === 'created' || action === 'imported') return failure(request, response, 'VALIDATION_ERROR', 'Choose a valid CRM action.');
      if (action === 'claim') {
        if (canManageCrm(request)) return failure(request, response, 'MANAGER_CLAIM_NOT_REQUIRED', 'Managers and administrators can assign a CRM employee instead of claiming a lead.', 409);
        if (!leadIsUnassigned(lead)) return failure(request, response, 'LEAD_ASSIGNED', 'This lead has already been taken by another CRM employee.', 409);
        lead.assigned_to = actor;
        addLeadActivity(lead, 'claim', `${actor} took ownership of this lead.`, actor);
      } else {
        if (!crmLeadAccess(request, lead)) return failure(request, response, 'LEAD_ASSIGNED', 'This lead is assigned to another CRM employee. Only its handler, a CRM manager or an administrator can update it.', 403);
        if (!canManageCrm(request) && leadIsUnassigned(lead)) return failure(request, response, 'LEAD_CLAIM_REQUIRED', 'Take ownership of this unassigned lead before recording CRM actions.', 409);
        if (action === 'stage_change') {
        const previous = lead.stage; const next = leadStage(body.stage);
        if (next === previous) return failure(request, response, 'NO_CHANGE', 'Choose a different lead stage.', 409);
        lead.stage = next;
        addLeadActivity(lead, action, text(body.message, 1200) || `Stage changed from ${previous.replaceAll('_', ' ')} to ${next.replaceAll('_', ' ')}.`, actor);
      } else if (action === 'owner_change') {
        if (!canManageCrm(request)) return failure(request, response, 'FORBIDDEN', 'Only a CRM manager or administrator can transfer lead ownership.', 403);
        const owner = crmOwner(body.assigned_to);
        if (owner === 'Unassigned') return failure(request, response, 'VALIDATION_ERROR', 'Choose an active team member to handle this lead.');
        const previous = lead.assigned_to; lead.assigned_to = owner;
        addLeadActivity(lead, action, text(body.message, 1200) || `Owner changed from ${previous} to ${owner}.`, actor);
      } else if (action === 'follow_up') {
        const nextFollowUp = text(body.next_follow_up_at, 60);
        if (!nextFollowUp) return failure(request, response, 'VALIDATION_ERROR', 'Choose a next follow-up date and time.');
        lead.next_follow_up_at = nextFollowUp; lead.stage = lead.stage === 'new' ? 'follow_up' : lead.stage;
        addLeadActivity(lead, action, text(body.message, 1200) || `Follow-up scheduled for ${nextFollowUp}.`, actor);
      } else {
        const message = text(body.message, 1200);
        if (!message) return failure(request, response, 'VALIDATION_ERROR', 'Add a short outcome or note for this CRM action.');
        if (['call', 'whatsapp', 'email'].includes(action)) lead.last_contacted_at = new Date().toISOString();
        addLeadActivity(lead, action, message, actor);
      }
      if (action !== 'stage_change' && requestedStage && requestedStage !== lead.stage) {
        const previous = lead.stage;
        lead.stage = requestedStage;
        addLeadActivity(lead, 'stage_change', `Stage changed from ${previous.replaceAll('_', ' ')} to ${requestedStage.replaceAll('_', ' ')}.`, actor);
      }
      }
      workflowNotify({
        module: 'leads',
        action,
        title: action === 'owner_change' ? 'Lead assignment updated' : action === 'claim' ? 'Lead claimed' : 'Lead activity recorded',
        message: text(body.message, 1200) || `${actor} updated CRM lead ${lead.name}.`,
        actor: workflowActor(request, actor),
        href: `admin:Leads:${lead.id}`,
        entityType: 'lead',
        entityId: lead.id,
        assigneeName: lead.assigned_to,
      });
      if (lead.hec_lead_id || lead.source === 'reach_sales') {
        try {
          if (action === 'stage_change' || Boolean(requestedStage)) {
            await updateReachLeadStatusViaErp({
              hecLeadId: lead.hec_lead_id || '',
              rfmsLeadId: lead.id,
              stage: lead.stage,
            });
          }
          if (action === 'owner_change' || action === 'claim') {
            await assignReachLeadViaErp({
              hecLeadId: lead.hec_lead_id || '',
              rfmsLeadId: lead.id,
              assignedToName: lead.assigned_to,
              assigneeRole: 'crm',
              createVisit: false,
              assignedFrom: actor,
            });
          }
        } catch (error) {
          console.error('reach_status_sync_failed', error);
        }
      }
      await saveDatabase();
      return success(request, response, lead);
    }

    if (request.method === 'GET' && route === '/api/v1/appointments') {
      if (!requirePermission(request, response, 'appointments')) return;
      return success(request, response, [...database.appointments].filter((appointment) => appointmentAccess(request, appointment)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(appointmentSummary));
    }

    if (request.method === 'POST' && route === '/api/v1/appointments') {
      if (!requirePermission(request, response, 'appointments')) return;
      if (!canManageAppointments(request)) return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can add appointments.', 403);
      const body = await readJson(request);
      const actor = leadActor(request);
      const appointment = appointmentRecord({
        ...body,
        source: 'manual',
        status: 'requested',
        assigned_to: 'Unassigned',
        activity_history: [{ type: 'created', message: `${actor} added this consultation from the Appointment Management panel.`, actor }],
      });
      if (!appointment.name || !isEmail(appointment.email) || !appointment.mobile || !isIsoDate(appointment.preferred_date) || !appointment.preferred_time || !appointment.topic) {
        return failure(request, response, 'VALIDATION_ERROR', 'Enter guest name, valid email, mobile number, requested date, time and consultation topic.');
      }
      database.appointments.push(appointment);
      await saveDatabase();
      return success(request, response, appointmentSummary(appointment), 201);
    }

    const appointmentMatch = route.match(/^\/api\/v1\/appointments\/([^/]+)$/);
    if (appointmentMatch && request.method === 'PATCH') {
      if (!requirePermission(request, response, 'appointments')) return;
      const appointment = database.appointments.find((item) => item.id === appointmentMatch[1]);
      if (!appointment) return failure(request, response, 'NOT_FOUND', 'Appointment not found.', 404);
      if (!appointmentAccess(request, appointment)) return failure(request, response, 'APPOINTMENT_ASSIGNED', 'This appointment is assigned to another business consultant.', 403);
      if (!canManageAppointments(request) && appointmentIsUnassigned(appointment)) return failure(request, response, 'APPOINTMENT_ASSIGNMENT_REQUIRED', 'A manager must assign this appointment before it can be managed.', 409);
      if (appointment.status === 'converted_to_lead') return failure(request, response, 'APPOINTMENT_CONVERTED', 'This appointment has already been converted to a CRM lead.', 409);
      const body = await readJson(request);
      const actor = leadActor(request);
      const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
      const action = text(body.action, 40).toLowerCase().replace(/[\s-]+/g, '_');
      const planFields = ['meeting_mode', 'confirmed_date', 'confirmed_time', 'meeting_link', 'meeting_location'];
      if (!canManageAppointments(request) && (action === 'schedule' || planFields.some(has))) {
        return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can set the meeting type, exact schedule, office location or Google Meet link.', 403);
      }
      if (has('assigned_to')) {
        if (!canManageAppointments(request)) return failure(request, response, 'FORBIDDEN', 'Only a manager or administrator can assign an appointment.', 403);
        const owner = appointmentOwner(body.assigned_to);
        const nextOwner = text(body.assigned_to, 120) ? owner : 'Unassigned';
        if (text(body.assigned_to, 120) && nextOwner === 'Unassigned') return failure(request, response, 'VALIDATION_ERROR', 'Choose an available business consultant.');
        if (appointment.assigned_to !== nextOwner) {
          const previous = appointment.assigned_to || 'Unassigned';
          appointment.assigned_to = nextOwner;
          addAppointmentActivity(appointment, 'assignment', `${actor} assigned this appointment from ${previous} to ${nextOwner}.`, actor);
          workflowNotify({
            module: 'appointments',
            action: 'appointment_assigned',
            title: 'Appointment assigned',
            message: `${appointment.name} consultation assigned to ${nextOwner}.`,
            actor: workflowActor(request, actor),
            href: `admin:Appointments:${appointment.id}`,
            entityType: 'appointment',
            entityId: appointment.id,
            assigneeName: nextOwner,
          });
        }
      }
      if (has('status')) appointment.status = appointmentStatus(body.status);
      if (has('meeting_mode')) appointment.meeting_mode = appointmentMode(body.meeting_mode);
      if (has('confirmed_date')) appointment.confirmed_date = text(body.confirmed_date, 10);
      if (has('confirmed_time')) appointment.confirmed_time = text(body.confirmed_time, 60);
      if (has('meeting_link')) appointment.meeting_link = text(body.meeting_link, 1000);
      if (has('meeting_location')) appointment.meeting_location = text(body.meeting_location, 500);
      if (has('territory_query')) appointment.territory_query = text(body.territory_query, 200);
      if (has('franchise_model_discussed')) {
        const model = text(body.franchise_model_discussed, 20).toLowerCase();
        appointment.franchise_model_discussed = ['fofo', 'foco'].includes(model) ? model.toUpperCase() : appointmentModels.has(model) ? model : 'not_discussed';
      }
      if (has('interest_level')) {
        const interest = text(body.interest_level, 30).toLowerCase();
        appointment.interest_level = appointmentInterestLevels.has(interest) ? interest : 'warm';
      }
      if (has('outcome')) appointment.outcome = text(body.outcome, 3000);
      const historyNote = text(body.history_note, 1600);
      if (action === 'schedule') {
        if (!isIsoDate(appointment.confirmed_date) || !/^\d{2}:\d{2}$/.test(appointment.confirmed_time)) return failure(request, response, 'VALIDATION_ERROR', 'Choose an exact confirmed appointment date and time.');
        if (appointment.meeting_mode === 'virtual_google_meet' && !appointment.meeting_link) return failure(request, response, 'VALIDATION_ERROR', 'Add the Google Meet link before confirming a virtual appointment.');
        if (appointment.meeting_mode === 'office_visit' && !appointment.meeting_location) return failure(request, response, 'VALIDATION_ERROR', 'Add the office meeting address before confirming an office visit.');
        appointment.status = 'scheduled';
        const place = appointment.meeting_mode === 'virtual_google_meet' ? (appointment.meeting_link || 'Google Meet link pending') : (appointment.meeting_location || 'Office location pending');
        addAppointmentActivity(appointment, 'scheduled', historyNote || `${actor} scheduled a ${appointment.meeting_mode === 'virtual_google_meet' ? 'Google Meet' : 'office visit'} for ${appointment.confirmed_date} at ${appointment.confirmed_time}. ${place}`, actor);
      } else if (action === 'outcome') {
        if (!appointment.outcome) return failure(request, response, 'VALIDATION_ERROR', 'Record the consultation outcome before saving it.');
        appointment.status = 'completed';
        addAppointmentActivity(appointment, 'outcome', historyNote || `${actor} recorded the consultation outcome. Model discussed: ${appointment.franchise_model_discussed}. Interest: ${appointment.interest_level}.`, actor);
      } else if (historyNote) {
        addAppointmentActivity(appointment, 'update', historyNote, actor);
      } else {
        appointment.updated_at = new Date().toISOString();
      }
      await saveDatabase();
      return success(request, response, appointmentSummary(appointment));
    }

    const appointmentLeadMatch = route.match(/^\/api\/v1\/appointments\/([^/]+)\/convert-to-lead$/);
    if (appointmentLeadMatch && request.method === 'POST') {
      if (!requireOfficer(request)) return failure(request, response, 'FORBIDDEN', 'Only an authorised RFMS officer can convert appointments into leads.', 403);
      const appointment = database.appointments.find((item) => item.id === appointmentLeadMatch[1]);
      if (!appointment) return failure(request, response, 'NOT_FOUND', 'Appointment not found.', 404);
      if (!appointmentAccess(request, appointment)) return failure(request, response, 'APPOINTMENT_ASSIGNED', 'This appointment is assigned to another CRM employee.', 403);
      if (!canManageCrm(request) && appointmentIsUnassigned(appointment)) return failure(request, response, 'APPOINTMENT_ASSIGNMENT_REQUIRED', 'A CRM manager must assign this appointment before it can be converted to a lead.', 409);
      if (appointment.converted_lead_id) return failure(request, response, 'ALREADY_CONVERTED', 'This appointment has already been converted to a CRM lead.', 409);
      if (appointment.status !== 'completed') return failure(request, response, 'APPOINTMENT_NOT_COMPLETED', 'Complete the appointment and record its outcome before converting it to a CRM lead.', 409);
      const body = await readJson(request);
      const selectedModel = text(body.franchise_model, 10).toUpperCase();
      const model = ['FOFO', 'FOCO'].includes(selectedModel) ? selectedModel : ['FOFO', 'FOCO'].includes(appointment.franchise_model_discussed) ? appointment.franchise_model_discussed : '';
      if (!model) return failure(request, response, 'MODEL_REQUIRED', 'Choose FOFO or FOCO as the franchise model for the new CRM lead.');
      const duplicate = database.leads.find((lead) => (appointment.email && lead.email === appointment.email) || (appointment.mobile && lead.mobile === appointment.mobile));
      if (duplicate) return failure(request, response, 'LEAD_EXISTS', `A CRM lead already exists for this contact (${duplicate.name}).`);
      const actor = leadActor(request);
      const territory = text(body.territory_query, 200) || appointment.territory_query;
      if (!territory) return failure(request, response, 'TERRITORY_REQUIRED', 'Record the preferred franchise location before converting this appointment to a CRM lead.');
      const meetingDetails = appointment.meeting_mode === 'virtual_google_meet' ? `Google Meet: ${appointment.meeting_link || 'not recorded'}` : `Office visit: ${appointment.meeting_location || 'not recorded'}`;
      const notes = [`Converted from appointment ${appointment.id}.`, `Appointment owner: ${appointment.assigned_to || 'Unassigned'}.`, `Confirmed slot: ${appointment.confirmed_date || appointment.preferred_date} ${appointment.confirmed_time || appointment.preferred_time}.`, meetingDetails, `Model discussed: ${appointment.franchise_model_discussed}.`, `Interest: ${appointment.interest_level}.`, `Outcome: ${appointment.outcome || 'Not recorded'}`, appointment.notes ? `Guest note: ${appointment.notes}` : ''].filter(Boolean).join('\n');
      const lead = leadRecord({ name: appointment.name, email: appointment.email, mobile: appointment.mobile, franchise_model: model, territory_query: territory, notes, source: 'appointment', stage: 'new', priority: appointment.interest_level === 'high' ? 'hot' : appointment.interest_level === 'warm' ? 'warm' : 'normal', assigned_to: crmOwner(appointment.assigned_to), activity_history: [{ type: 'created', actor, message: `Created from completed appointment. Consultation outcome and meeting details were retained in this lead.` }] });
      if (!leadIsValid(lead)) return failure(request, response, 'VALIDATION_ERROR', 'The appointment needs valid contact details and a preferred territory before conversion.');
      database.leads.push(lead);
      appointment.status = 'converted_to_lead';
      appointment.converted_lead_id = lead.id;
      appointment.converted_at = new Date().toISOString();
      addAppointmentActivity(appointment, 'converted_to_lead', `${actor} converted this completed appointment into CRM lead ${lead.name} (${model}).`, actor);
      await saveDatabase();
      return success(request, response, { appointment: appointmentSummary(appointment), lead });
    }

    if (request.method === 'GET' && route === '/api/v1/content/success-stories') {
      return success(request, response, database.stories.filter((story) => story.is_published).sort((a, b) => a.sort_order - b.sort_order).map(({ id, title, youtube_embed_url, sort_order }) => ({ id, title, youtube_embed_url, sort_order })));
    }
    if (request.method === 'GET' && route === '/api/v1/content/featured-franchisees') {
      return success(request, response, database.franchisees.filter((item) => item.is_featured).sort((a, b) => a.sort_order - b.sort_order));
    }
    if (request.method === 'GET' && route === '/api/v1/public/centres') {
      const latitudeParam = url.searchParams.get('latitude') ?? url.searchParams.get('lat');
      const longitudeParam = url.searchParams.get('longitude') ?? url.searchParams.get('lng');
      const radiusParam = url.searchParams.get('radius_km') ?? url.searchParams.get('radius');
      const latitude = latitudeParam === null || latitudeParam === '' ? null : optionalGeoCoordinate(latitudeParam, -90, 90).value;
      const longitude = longitudeParam === null || longitudeParam === '' ? null : optionalGeoCoordinate(longitudeParam, -180, 180).value;
      if ((latitudeParam || longitudeParam) && (latitude === null || longitude === null)) {
        return failure(request, response, 'VALIDATION_ERROR', 'Pass both valid latitude and longitude, or omit both.', 400);
      }
      const radiusKm = radiusParam === null || radiusParam === '' ? null : Number(radiusParam);
      if (radiusParam !== null && radiusParam !== '' && !Number.isFinite(radiusKm)) {
        return failure(request, response, 'VALIDATION_ERROR', 'radius_km must be a number.', 400);
      }
      const centres = listPublicOnboardedCentres({ latitude, longitude, radiusKm });
      return success(request, response, {
        centres,
        count: centres.length,
        source: 'ffms_onboarded',
      });
    }
    if (request.method === 'GET' && route === '/api/v1/content/hero-slides') {
      return success(request, response, database.hero_slides.filter((slide) => slide.is_published).sort((a, b) => a.sort_order - b.sort_order));
    }
    if (request.method === 'GET' && route === '/api/v1/content/settings') return success(request, response, publicCompanyProfile(database.company_profile));
    if (request.method === 'GET' && route === '/api/v1/content/marketing-pages') {
      return success(request, response, publicMarketingPages(database.marketing_pages, resolveUploadUrl));
    }
    if (request.method === 'GET' && route === '/api/v1/content/available-territories') {
      const model = text(url.searchParams.get('model') ?? '', 10);
      if (!['FOFO', 'FOCO'].includes(model.toUpperCase())) {
        return failure(request, response, 'VALIDATION_ERROR', 'Pass model=FOFO or model=FOCO to list available territories.');
      }
      return success(request, response, {
        model: model.toUpperCase(),
        territories: publicAvailableTerritories(model),
        updated_at: new Date().toISOString(),
      });
    }
    if (request.method === 'GET' && route === '/api/v1/content/support-settings') return success(request, response, publicSupportSettings());

    if (request.method === 'GET' && route === '/api/v1/support/tickets') {
      if (!requirePermission(request, response, 'support')) return;
      const statusFilter = String(new URL(request.url ?? '', 'http://localhost').searchParams.get('status') ?? '').trim().toLowerCase();
      const tickets = ensureSupportTicketsArray()
        .filter((item) => !statusFilter || statusFilter === 'all' ? true : item.status === statusFilter)
        .sort((first, second) => String(second.updated_at).localeCompare(String(first.updated_at)))
        .map((item) => supportTicketSummary(item, resolveUploadUrl, { includeInternal: true }));
      return success(request, response, tickets);
    }

    const supportTicketIdMatch = route.match(/^\/api\/v1\/support\/tickets\/([^/]+)$/);
    if (supportTicketIdMatch && request.method === 'GET') {
      if (!requirePermission(request, response, 'support')) return;
      const ticket = supportTicketById(supportTicketIdMatch[1]);
      if (!ticket) return failure(request, response, 'NOT_FOUND', 'Support ticket not found.', 404);
      return success(request, response, supportTicketSummary(ticket, resolveUploadUrl, { includeInternal: true }));
    }

    const supportTicketActionMatch = route.match(/^\/api\/v1\/support\/tickets\/([^/]+)\/actions$/);
    if (supportTicketActionMatch && request.method === 'POST') {
      if (!requirePermission(request, response, 'support')) return;
      const ticket = supportTicketById(supportTicketActionMatch[1]);
      if (!ticket) return failure(request, response, 'NOT_FOUND', 'Support ticket not found.', 404);
      const body = await readJson(request, 12_000_000);
      const action = String(body.type ?? body.action ?? '').trim().toLowerCase();
      const actor = reviewActor(request);
      const message = text(body.message, 4000);
      if (action === 'reply') {
        if (!message) return failure(request, response, 'VALIDATION_ERROR', 'Enter a reply message for the applicant.', 400);
        appendSupportTicketMessage(ticket, { author_type: 'staff', author_name: actor, body: message, is_internal: false });
      } else if (action === 'internal_note') {
        if (!message) return failure(request, response, 'VALIDATION_ERROR', 'Enter an internal note.', 400);
        appendSupportTicketMessage(ticket, { author_type: 'staff', author_name: actor, body: message, is_internal: true });
      } else if (action === 'assign') {
        const assignee = text(body.assigned_to, 120);
        if (!assignee || !supportAssignableNames().has(assignee)) return failure(request, response, 'VALIDATION_ERROR', 'Choose an active support team member.', 400);
        appendSupportTicketMessage(ticket, {
          author_type: 'system',
          author_name: 'Support desk',
          body: message || `Ticket assigned to ${assignee}.`,
          is_internal: true,
        }, { assigned_to: assignee, status: 'pending' });
      } else if (action === 'status') {
        const nextStatus = text(body.status, 40);
        if (!SUPPORT_TICKET_STATUSES.includes(nextStatus)) return failure(request, response, 'VALIDATION_ERROR', 'Choose a valid ticket status.', 400);
        appendSupportTicketMessage(ticket, {
          author_type: 'system',
          author_name: 'Support desk',
          body: message || `Ticket status changed to ${nextStatus.replaceAll('_', ' ')}.`,
          is_internal: true,
        }, { status: nextStatus });
      } else if (action === 'close') {
        appendSupportTicketMessage(ticket, {
          author_type: 'staff',
          author_name: actor,
          body: message || 'This support ticket has been closed by the support team.',
          is_internal: false,
        }, { close: true, closed_by: actor });
      } else {
        return failure(request, response, 'VALIDATION_ERROR', 'Choose a valid support action.', 400);
      }
      workflowNotify({
        module: 'support',
        action,
        title: action === 'reply' ? 'Support ticket reply' : action === 'assign' ? 'Support ticket assigned' : 'Support ticket updated',
        message: message || `${actor} updated support ticket ${ticket.ticket_number}.`,
        actor: workflowActor(request, actor),
        href: `admin:Support:${ticket.id}`,
        entityType: 'support_ticket',
        entityId: ticket.id,
        assigneeName: ticket.assigned_to,
        applicationId: ticket.application_id,
        portalHref: 'portal:support',
      });
      await saveDatabase();
      return success(request, response, supportTicketSummary(ticket, resolveUploadUrl, { includeInternal: true }));
    }

    if (route.startsWith('/api/v1/admin/support/') && !requirePermission(request, response, 'support_settings')) return;
    if (request.method === 'GET' && route === '/api/v1/admin/support/settings') {
      return success(request, response, supportSettings());
    }
    if (request.method === 'PUT' && route === '/api/v1/admin/support/settings') {
      const body = await readJson(request, 48_000);
      database.support_settings = supportSettingsFromBody(body.value && typeof body.value === 'object' ? body.value : body, database.support_settings, companyProfile(database.company_profile));
      auditAdminAction(request, { action: 'support_settings_updated', details: 'Support contact settings were updated.' });
      await saveDatabase();
      return success(request, response, supportSettings());
    }

    if (request.method === 'GET' && route === '/api/v1/admin/users') {
      if (!requirePermission(request, response, 'user_management')) return;
      return success(request, response, ensureOfficersArray().map(officerUserSummary).sort((a, b) => a.name.localeCompare(b.name)));
    }

    if (request.method === 'GET' && route === '/api/v1/admin/users/next-employee-id') {
      if (!requirePermission(request, response, 'user_management')) return;
      return success(request, response, { employee_id: nextOfficerEmployeeId(ensureOfficersArray()) });
    }

    if (request.method === 'POST' && route === '/api/v1/admin/users') {
      if (!requirePermission(request, response, 'user_management')) return;
      const body = await readJson(request, 48_000);
      try {
        const user = createOfficerUser(body, ensureOfficersArray());
        ensureOfficersArray().push(user);
        auditAdminAction(request, {
          action: 'user_created',
          target_user_id: user.id,
          target_user_name: user.name,
          details: `Created ${roleLabel(user.role)} user ${user.name} (${user.employee_id}).`,
        });
        workflowNotify({
          module: 'users',
          action: 'user_created',
          title: 'New admin user created',
          message: `${user.name} (${roleLabel(user.role)}) was added to User Management.`,
          actor: workflowActor(request),
          href: 'admin:User Management',
          entityType: 'officer',
          entityId: user.id,
        });
        await saveDatabase();
        return success(request, response, officerUserSummary(user), 201);
      } catch (error) {
        return failure(request, response, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Unable to create admin user.', 400);
      }
    }

    if (request.method === 'GET' && route === '/api/v1/admin/audit-log') {
      if (!requirePermission(request, response, 'audit_log')) return;
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, 500);
      return success(request, response, ensureAdminAuditLog().slice(0, limit));
    }

    const adminUserMatch = route.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && request.method === 'PATCH') {
      if (!requirePermission(request, response, 'user_management')) return;
      const user = ensureOfficersArray().find((item) => item.id === adminUserMatch[1]);
      if (!user) return failure(request, response, 'NOT_FOUND', 'Admin user not found.', 404);
      const body = await readJson(request, 48_000);
      const session = sessionFor(request);
      if (user.id === session?.user_id && normalizeRole(user.role) === 'super_admin') {
        const nextRole = body?.role !== undefined ? normalizeRole(body.role) : user.role;
        if (nextRole !== 'super_admin') return failure(request, response, 'FORBIDDEN', 'You cannot remove your own administrator access.', 403);
      }
      try {
        const previousStatus = user.status;
        const updated = updateOfficerUser(user, body, ensureOfficersArray());
        Object.assign(user, updated);
        if (body.password) {
          const reset = resetOfficerPassword(user, body.password);
          Object.assign(user, reset);
          invalidateOfficerSessions(user);
          auditAdminAction(request, {
            action: 'password_reset',
            target_user_id: user.id,
            target_user_name: user.name,
            details: `Password reset for ${user.name} (${user.employee_id}).`,
          });
        }
        if (body.status && body.status !== previousStatus) {
          auditAdminAction(request, {
            action: body.status === 'active' ? 'user_activated' : 'user_deactivated',
            target_user_id: user.id,
            target_user_name: user.name,
            details: `${user.name} account ${body.status === 'active' ? 'activated' : 'deactivated'}.`,
          });
          if (body.status === 'inactive') invalidateOfficerSessions(user);
        } else if (!body.password) {
          auditAdminAction(request, {
            action: 'user_updated',
            target_user_id: user.id,
            target_user_name: user.name,
            details: `Updated ${roleLabel(user.role)} user ${user.name} (${user.employee_id}).`,
          });
        }
        if (body.role && normalizeRole(body.role) !== normalizeRole(updated.role)) {
          invalidateOfficerSessions(user);
        }
        await saveDatabase();
        return success(request, response, officerUserSummary(user));
      } catch (error) {
        return failure(request, response, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Unable to update admin user.', 400);
      }
    }

    const adminUserResetMatch = route.match(/^\/api\/v1\/admin\/users\/([^/]+)\/reset-password$/);
    if (adminUserResetMatch && request.method === 'POST') {
      if (!requirePermission(request, response, 'user_management')) return;
      const user = ensureOfficersArray().find((item) => item.id === adminUserResetMatch[1]);
      if (!user) return failure(request, response, 'NOT_FOUND', 'Admin user not found.', 404);
      const body = await readJson(request, 48_000);
      try {
        const reset = resetOfficerPassword(user, body.password);
        Object.assign(user, reset);
        invalidateOfficerSessions(user);
        auditAdminAction(request, {
          action: 'password_reset',
          target_user_id: user.id,
          target_user_name: user.name,
          details: `Password reset for ${user.name} (${user.employee_id}).`,
        });
        await saveDatabase();
        return success(request, response, { message: 'Password reset successfully.' });
      } catch (error) {
        return failure(request, response, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Unable to reset password.', 400);
      }
    }

    if (route.startsWith('/api/v1/admin/content/') && !requireAdmin(request)) return failure(request, response, 'FORBIDDEN', 'Only a Super Admin can manage public content.', 403);

    if (request.method === 'GET' && route === '/api/v1/admin/content/success-stories') return success(request, response, database.stories.sort((a, b) => a.sort_order - b.sort_order));
    if (request.method === 'GET' && route === '/api/v1/admin/content/training-videos') return success(request, response, database.training_videos.slice().sort((first, second) => first.sort_order - second.sort_order));
    if (request.method === 'GET' && route === '/api/v1/admin/content/featured-franchisees') return success(request, response, database.franchisees.sort((a, b) => a.sort_order - b.sort_order));
    if (request.method === 'GET' && route === '/api/v1/admin/content/hero-slides') return success(request, response, database.hero_slides.sort((a, b) => a.sort_order - b.sort_order));

    if (request.method === 'GET' && route === '/api/v1/admin/content/marketing-pages') {
      if (!requireAdmin(request)) return;
      return success(request, response, adminMarketingPages(database.marketing_pages, resolveUploadUrl));
    }

    if (request.method === 'PUT' && route === '/api/v1/admin/content/marketing-pages/homepage-models') {
      if (!requireAdmin(request)) return;
      const body = await readJson(request);
      database.marketing_pages = mergeMarketingPages(database.marketing_pages, { homepage_models: body?.homepage_models ?? body });
      database.marketing_pages.homepage_models = normalizeMarketingPages(database.marketing_pages).homepage_models;
      await saveDatabase();
      return success(request, response, adminMarketingPages(database.marketing_pages, resolveUploadUrl));
    }

    if (request.method === 'PUT' && route === '/api/v1/admin/content/marketing-pages/fofo') {
      if (!requireAdmin(request)) return;
      const body = await readJson(request);
      const page = body?.fofo_page ?? body;
      if (page?.success_story?.youtube_embed_code) {
        page.success_story.youtube_embed_url = youtubeEmbedUrlFromCode(page.success_story.youtube_embed_code);
      }
      database.marketing_pages = mergeMarketingPages(database.marketing_pages, { fofo_page: { ...page, updated_at: new Date().toISOString() } });
      await saveDatabase();
      return success(request, response, adminMarketingPages(database.marketing_pages, resolveUploadUrl));
    }

    if (request.method === 'PUT' && route === '/api/v1/admin/content/marketing-pages/foco') {
      if (!requireAdmin(request)) return;
      const body = await readJson(request);
      const page = body?.foco_page ?? body;
      if (page?.success_story?.youtube_embed_code) {
        page.success_story.youtube_embed_url = youtubeEmbedUrlFromCode(page.success_story.youtube_embed_code);
      }
      database.marketing_pages = mergeMarketingPages(database.marketing_pages, { foco_page: { ...page, updated_at: new Date().toISOString() } });
      await saveDatabase();
      return success(request, response, adminMarketingPages(database.marketing_pages, resolveUploadUrl));
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/marketing-pages/image') {
      if (!requireAdmin(request)) return;
      const body = await readJson(request, 7_500_000);
      const image = logoData(body.data_url);
      if (!image) return failure(request, response, 'VALIDATION_ERROR', 'Upload a PNG, JPG or WEBP image smaller than 5 MB.');
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `marketing-page-${Date.now()}-${randomUUID()}.${image.extension}`;
      await writeFile(path.join(uploadsDirectory, filename), image.bytes);
      return success(request, response, { image_url: storedUploadUrl(filename) }, 201);
    }

    if (request.method === 'PUT' && route === '/api/v1/admin/content/settings/company-profile') {
      const body = await readJson(request);
      const previous = companyProfile(database.company_profile);
      const next = companyProfile(body.value);
      const nextPhase3Terms = text(body?.value?.foco_phase_3_terms, 8000);
      next.foco_phase_3_terms_version = nextPhase3Terms !== previous.foco_phase_3_terms
        ? Math.max(1, Number(previous.foco_phase_3_terms_version) || 1) + 1
        : Math.max(1, number(body?.value?.foco_phase_3_terms_version) || previous.foco_phase_3_terms_version);
      const nextAgreementTerms = text(body?.value?.agreement_terms, 12000);
      next.agreement_terms_version = nextAgreementTerms !== previous.agreement_terms
        ? Math.max(1, Number(previous.agreement_terms_version) || 1) + 1
        : Math.max(1, number(body?.value?.agreement_terms_version) || previous.agreement_terms_version);
      database.company_profile = publicCompanyProfile(next);
      await saveDatabase();
      return success(request, response, { key: 'company-profile', value: database.company_profile });
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/company-profile/logo') {
      // A 5 MB image becomes roughly 6.7 MB after browser base64 encoding.
      const body = await readJson(request, 7_500_000);
      const logo = logoData(body.data_url);
      if (!logo) return failure(request, response, 'VALIDATION_ERROR', 'Upload a PNG, JPG or WEBP logo smaller than 5 MB.');
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `company-logo-${Date.now()}-${randomUUID()}.${logo.extension}`;
      await writeFile(path.join(uploadsDirectory, filename), logo.bytes);
      database.company_profile = publicCompanyProfile({ ...database.company_profile, logo_url: storedUploadUrl(filename) });
      await saveDatabase();
      return success(request, response, database.company_profile, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/why-remedium/badge-image') {
      const body = await readJson(request, 7_500_000);
      const image = logoData(body.data_url);
      if (!image) return failure(request, response, 'VALIDATION_ERROR', 'Upload a PNG, JPG or WEBP accreditation image smaller than 5 MB.');
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `why-remedium-badge-${Date.now()}-${randomUUID()}.${image.extension}`;
      await writeFile(path.join(uploadsDirectory, filename), image.bytes);
      database.company_profile = publicCompanyProfile({ ...database.company_profile, why_remedium_badge_url: storedUploadUrl(filename) });
      await saveDatabase();
      return success(request, response, database.company_profile, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/footer/brochure') {
      const body = await readJson(request, 35_000_000);
      const brochure = brochureData(body.data_url);
      if (!brochure) return failure(request, response, 'VALIDATION_ERROR', 'Upload a valid PDF brochure smaller than 25 MB.');
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `franchise-brochure-${Date.now()}-${randomUUID()}.pdf`;
      await writeFile(path.join(uploadsDirectory, filename), brochure);
      database.company_profile = publicCompanyProfile({ ...database.company_profile, brochure_url: storedUploadUrl(filename) });
      await saveDatabase();
      return success(request, response, database.company_profile, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/hero-slides') {
      const body = await readJson(request);
      const slide = heroSlide(body);
      if (!slide.title || !slide.primary_button_text || !slide.primary_button_url) return failure(request, response, 'VALIDATION_ERROR', 'Enter slide heading, primary button text and a valid primary button link.');
      database.hero_slides.push(slide); await saveDatabase(); return success(request, response, slide, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/hero-slides/image') {
      const body = await readJson(request, 7_500_000);
      const image = logoData(body.data_url);
      if (!image) return failure(request, response, 'VALIDATION_ERROR', 'Upload a PNG, JPG or WEBP image smaller than 5 MB.');
      await mkdir(uploadsDirectory, { recursive: true });
      const filename = `hero-slide-${Date.now()}-${randomUUID()}.${image.extension}`;
      await writeFile(path.join(uploadsDirectory, filename), image.bytes);
      return success(request, response, { image_url: storedUploadUrl(filename) }, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/success-stories') {
      const body = await readJson(request);
      const youtube_embed_url = youtubeEmbedUrl(body.youtube_embed_code ?? '');
      if (!body.title?.trim() || !youtube_embed_url) return failure(request, response, 'VALIDATION_ERROR', 'Enter a title and a valid HTTPS YouTube iframe embed code.');
      const story = { id: randomUUID(), title: body.title.trim(), youtube_embed_code: body.youtube_embed_code, youtube_embed_url, is_published: body.is_published !== false, sort_order: number(body.sort_order) };
      database.stories.push(story); await saveDatabase(); return success(request, response, story, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/training-videos') {
      const body = await readJson(request, 48_000);
      const fields = trainingVideoFieldsFromBody(body);
      if (fields.error) return failure(request, response, 'VALIDATION_ERROR', fields.error, 400);
      if (!fields.title?.trim()) return failure(request, response, 'VALIDATION_ERROR', 'Enter a training module title.', 400);
      if (!fields.video_url) return failure(request, response, 'VALIDATION_ERROR', 'Paste a valid YouTube iframe embed code for this training video.', 400);
      const now = new Date().toISOString();
      const video = trainingVideoRecord({
        ...fields,
        id: randomUUID(),
        sort_order: fields.sort_order || database.training_videos.length + 1,
        created_at: now,
        updated_at: now,
      });
      database.training_videos.push(video);
      await saveDatabase();
      return success(request, response, video, 201);
    }

    if (request.method === 'POST' && route === '/api/v1/admin/content/featured-franchisees') {
      const body = await readJson(request);
      const image_url = validImageUrl(body.image_url ?? '');
      if (!body.name?.trim() || !body.location?.trim() || !image_url || !['FOFO', 'FOCO'].includes(body.franchise_type)) return failure(request, response, 'VALIDATION_ERROR', 'Enter name, location, franchise type and a valid image URL.');
      const franchisee = { id: randomUUID(), name: body.name.trim(), location: body.location.trim(), franchise_type: body.franchise_type, image_url, is_featured: body.is_featured !== false, sort_order: number(body.sort_order) };
      database.franchisees.push(franchisee); await saveDatabase(); return success(request, response, franchisee, 201);
    }

    const storyId = route.match(/^\/api\/v1\/admin\/content\/success-stories\/([^/]+)$/)?.[1];
    if (storyId && request.method === 'DELETE') {
      database.stories = database.stories.filter((story) => story.id !== storyId); await saveDatabase(); return success(request, response, { message: 'Success story deleted.' });
    }
    const trainingVideoContentId = route.match(/^\/api\/v1\/admin\/content\/training-videos\/([^/]+)$/)?.[1];
    if (trainingVideoContentId && request.method === 'PATCH') {
      const index = database.training_videos.findIndex((item) => item.id === trainingVideoContentId);
      if (index < 0) return failure(request, response, 'NOT_FOUND', 'Training video not found.', 404);
      const body = await readJson(request, 48_000);
      const current = database.training_videos[index];
      const fields = trainingVideoFieldsFromBody(body, current);
      if (fields.error) return failure(request, response, 'VALIDATION_ERROR', fields.error, 400);
      database.training_videos[index] = trainingVideoRecord({ ...current, ...fields, title: fields.title || current.title, updated_at: new Date().toISOString() }, current.id);
      await saveDatabase();
      return success(request, response, database.training_videos[index]);
    }
    if (trainingVideoContentId && request.method === 'DELETE') {
      database.training_videos = database.training_videos.filter((item) => item.id !== trainingVideoContentId);
      await saveDatabase();
      return success(request, response, { message: 'Training video deleted.' });
    }
    const franchiseeId = route.match(/^\/api\/v1\/admin\/content\/featured-franchisees\/([^/]+)$/)?.[1];
    if (franchiseeId && request.method === 'DELETE') {
      database.franchisees = database.franchisees.filter((item) => item.id !== franchiseeId); await saveDatabase(); return success(request, response, { message: 'Featured franchisee deleted.' });
    }
    const heroSlideId = route.match(/^\/api\/v1\/admin\/content\/hero-slides\/([^/]+)$/)?.[1];
    if (heroSlideId && request.method === 'PATCH') {
      const index = database.hero_slides.findIndex((slide) => slide.id === heroSlideId);
      if (index < 0) return failure(request, response, 'NOT_FOUND', 'Hero slide not found.', 404);
      const slide = heroSlide(await readJson(request), heroSlideId);
      if (!slide.title || !slide.primary_button_text || !slide.primary_button_url) return failure(request, response, 'VALIDATION_ERROR', 'Enter slide heading, primary button text and a valid primary button link.');
      database.hero_slides[index] = slide; await saveDatabase(); return success(request, response, slide);
    }
    if (heroSlideId && request.method === 'DELETE') {
      database.hero_slides = database.hero_slides.filter((slide) => slide.id !== heroSlideId); await saveDatabase(); return success(request, response, { message: 'Hero slide deleted.' });
    }
    if (request.method === 'POST' && route === '/api/v1/admin/content/featured-franchisees/image') return failure(request, response, 'UPLOAD_UNAVAILABLE', 'Use Image URL while running the local API. Image upload is available through the Laravel Docker API.', 501);

    return failure(request, response, 'NOT_FOUND', 'Route not found.', 404);
  } catch (error) {
    if (error instanceof Error && error.message === 'Request is too large.') {
      const agreementUploadRoute = /^\/api\/v1\/admin\/applications\/[^/]+\/agreement\/(upload|manual-execute)$/.test(route);
      return failure(request, response, 'PAYLOAD_TOO_LARGE', agreementUploadRoute
        ? 'The agreement PDF is too large. Upload a valid PDF up to 32 MB.'
        : 'The upload is too large. Use fewer photographs or smaller image files (each under 5 MB).', 413);
    }
    return failure(request, response, 'BAD_REQUEST', error instanceof Error ? error.message : 'Unable to process this request.', 400);
  }
}

await loadDatabase();
const apiServer = createServer((request, response) => { void handle(request, response); });
apiServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`RFMS local API could not start because port ${port} is already in use.`);
    console.error('Close the older RFMS local-service window, then run run-admin.cmd again.');
    process.exit(1);
  }
  throw error;
});
apiServer.listen(port, () => {
  console.log(`RFMS local API running at http://localhost:${port}/api/v1`);
  console.log('Local Super Admin: admin@remediumlab.local / Admin@12345 / OTP 123456');
});
const staticApps = [
  { label: 'RFMS Marketing Website', port: marketingPort, output: staticAppOutput('marketing-web') },
  { label: 'RFMS Applicant Portal', port: portalPort, output: staticAppOutput('franchise-portal') },
  { label: 'RFMS Admin Dashboard', port: adminPort, output: staticAppOutput('admin-dashboard') },
];

if (process.env.RFMS_API_ONLY !== 'true') {
  for (const app of staticApps) {
    const staticServer = createServer((request, response) => { void serveStaticApplication(request, response, app.output); });
    staticServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`${app.label} could not start because port ${app.port} is already in use.`);
        console.error('Close the older RFMS local-service window, then run run-admin.cmd again.');
        process.exit(1);
      }
      throw error;
    });
    staticServer.listen(app.port, () => console.log(`${app.label} running at http://localhost:${app.port}`));
  }
}
