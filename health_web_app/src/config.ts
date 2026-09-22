function resolveApiBaseUrl() {
  const env = import.meta.env.VITE_API_BASE_URL;
  if (env !== undefined && env.trim().length > 0) {
    return env.replace(/\/$/, '');
  }
  if (import.meta.env.DEV) {
    return '';
  }
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return '';
}

const CORE = 'health_ecosystem_core.health_ecosystem_core';

export const API_MODULES = {
  main: `${CORE}.api`,
  journey: `${CORE}.clinical_journey`,
  journeyOps: `${CORE}.clinical_phase33_journey_ops`,
  prescriptions: `${CORE}.clinical_prescriptions`,
  appointments: `${CORE}.appointments`,
  otp: `${CORE}.otp_auth`,
  email: `${CORE}.email_auth`,
  oauth: `${CORE}.clinical_phase18b`,
  diagnostics: `${CORE}.clinical_diagnostics`,
  pharmacyQuote: `${CORE}.clinical_phase32_pharmacy_quote`,
  insurance: `${CORE}.clinical_phase44_insurance`,
  telephony: `${CORE}.clinical_phase64_telephony`,
  telemedicine: `${CORE}.clinical_phase42_telemedicine`,
  ePrescribe: `${CORE}.clinical_phase48_eprescribe`,
  ePrescribeFormat: `${CORE}.clinical_prescription_format`,
  rxDiagnostics: `${CORE}.clinical_phase49_rx_diagnostics`,
  erxFulfillment: `${CORE}.clinical_phase50_erx_fulfillment`,
  yogaSubscriptions: `${CORE}.clinical_yoga_subscriptions`,
  wellnessSessions: `${CORE}.clinical_phase110_wellness_sessions`,
  remediumCare: `${CORE}.clinical_phase113_remedium_care`,
  wellnessVideos: `${CORE}.clinical_phase114_wellness_videos`,
  providerOnboarding: `${CORE}.clinical_phase41_provider_onboarding`,
  providerPortal: `${CORE}.clinical_phase46_provider_portal`,
  opsQueues: `${CORE}.clinical_phase45_ops_queues`,
  completeCare: `${CORE}.clinical_phase47_complete_care`,
  criticalAlerts: `${CORE}.clinical_phase53_critical_alerts`,
  executiveAnalytics: `${CORE}.clinical_phase53_executive_analytics`,
  franchiseeKpi: `${CORE}.clinical_phase39_franchisee_kpi`,
  franchiseeRates: `${CORE}.clinical_phase54_franchisee_rate_model`,
  gamification: `${CORE}.clinical_phase52_staff_gamification_web`,
  labReport: `${CORE}.clinical_phase8`,
  reportLifecycle: `${CORE}.clinical_phase37_report_lifecycle`,
  nabl112b: `${CORE}.clinical_phase61_nabl_112b`,
  nablQc: `${CORE}.clinical_phase62_nabl_112a_qc`,
  nablQms: `${CORE}.clinical_phase63_nabl_112a_qms`,
  vialAccession: `${CORE}.clinical_phase89_vial_accession`,
  motherLabBill: `${CORE}.clinical_phase94_mother_lab_bill`,
  hubLabBill: `${CORE}.clinical_phase95_hub_lab_bill`,
  labBillEntry: `${CORE}.clinical_phase70_lab_bill_entry`,
  cpt: `${CORE}.clinical_phase98_cpt`,
  careers: `${CORE}.clinical_phase73b_careers`,
  hiringMarketing: `${CORE}.clinical_phase73d_hiring_marketing`,
  hiringPipeline: `${CORE}.clinical_phase73e_pipeline`,
  wbHiring: `${CORE}.clinical_phase112_wb_hiring`,
  blog: `${CORE}.clinical_phase93_blog`,
  siteFooter: `${CORE}.clinical_phase76_site_footer`,
  orderCheckout: `${CORE}.clinical_order_checkout`,
  hiringAdsSync: `${CORE}.clinical_phase73f_ad_sync`,
  staffPlanning: `${CORE}.clinical_phase91_staff_planning`,
  clinicalEncounter: `${CORE}.clinical_phase99_encounter`,
  aiPractice: `${CORE}.clinical_phase100_ai_practice`,
  carePrograms: `${CORE}.clinical_phase101_care_programs`,
  abha: `${CORE}.clinical_phase102_abha`,
  practiceAnalytics: `${CORE}.clinical_phase103_practice_analytics`,
  researchLite: `${CORE}.clinical_phase104_research_lite`,
  abdm: `${CORE}.clinical_phase105_abdm`,
  knowledge: `${CORE}.clinical_phase107_knowledge`,
  studyOps: `${CORE}.clinical_phase108_study_ops`,
  agencyAgents: `${CORE}.clinical_phase109_agency_agents`,
  agencyOnboardForm: `${CORE}.clinical_phase115_agency_onboard_form`,
} as const;

export type ApiModule = keyof typeof API_MODULES;

export const config = {
  apiBaseUrl: resolveApiBaseUrl(),
  siteName: import.meta.env.VITE_SITE_NAME || 'health.localhost',
  apiModule: API_MODULES.main,
};

export function apiUrl(method: string, module: ApiModule = 'main') {
  return `${config.apiBaseUrl}/api/method/${API_MODULES[module]}.${method}`;
}

export function deskAppUrl() {
  const env = import.meta.env.VITE_DESK_BASE_URL;
  if (env !== undefined && env.trim().length > 0) {
    return env.replace(/\/$/, '');
  }
  return config.apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
}

export function assetUrl(path?: string | null) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const base = config.apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** FFMS/RFMS JSON API on the same www host (`/rfms-api/v1/...`). */
export function rfmsApiUrl(path = '') {
  const env = import.meta.env.VITE_RFMS_API_BASE_URL;
  const base = (env && String(env).trim())
    || `${config.apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')}/rfms-api/v1`;
  const normalized = String(path || '').replace(/^\//, '');
  return normalized ? `${base.replace(/\/$/, '')}/${normalized}` : base.replace(/\/$/, '');
}
