import { clearStoredSession, getSid, loadSession, saveSession } from './auth/session';
import { apiUrl, ApiModule } from './config';
import { CareJourney, JourneyOpsBoard, JourneyActivity } from './types/journey';
import {
  LabReportDetail,
  LabReportParamEdit,
  LabReportQueue,
} from './types/labReport';
import { ReportLifecycleQueue } from './types/reportLifecycle';
import { FranchiseeKpiResponse } from './types/franchiseeKpi';
import { StaffGamificationResponse } from './types/gamification';
import { CriticalAlertsResponse, ExecutiveAnalyticsResponse } from './types/executiveAnalytics';

export type ApiEnvelope<T> = {
  status: 'success' | 'error';
  message?: string;
  data: T;
};

export type CouponResult = {
  promo_code: string;
  title?: string;
  subtotal: number;
  discount_amount: number;
  final_total: number;
  applies_to?: string;
  membership_discount?: number;
  coupon_discount?: number;
  membership_plan_title?: string;
};

export type SubscriptionPlan = {
  plan_code: string;
  title: string;
  description?: string;
  monthly_price: number;
  billing_interval?: string;
  free_home_collection?: boolean;
  lab_discount_percent?: number;
  pharmacy_discount_percent?: number;
  plan_category?: string;
  wellness_wing?: string;
  included_sessions_per_month?: number;
  unlimited_sessions?: boolean;
  online_access?: boolean;
};

export type HealthSubscription = {
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  amount?: number;
  plan?: SubscriptionPlan | null;
};

export type ProviderScheduleInput = {
  day_of_week: string;
  from_time: string;
  to_time: string;
  slot_duration: number;
  consultation_mode: 'In-person' | 'Online' | 'Both';
};

export type ServiceProviderApplication = {
  name: string;
  provider_type: 'Doctor' | 'Wellness';
  application_status: string;
  full_name: string;
  email: string;
  phone: string;
  registration_number?: string;
  speciality?: string;
  department?: string;
  wellness_wing?: string;
  consultation_fee?: number;
  supports_online?: boolean;
  supports_in_person?: boolean;
  city?: string;
  linked_doctor?: string | null;
  schedule_count?: number;
  modified?: string;
};

export type InsuranceQuoteRequest = {
  name: string;
  customer_name: string;
  phone: string;
  email?: string;
  product?: string;
  product_name?: string;
  insurer?: string;
  sum_insured?: number;
  status: string;
  notes?: string;
  creation?: string;
  modified?: string;
};

export type TrainingEventRow = {
  name: string;
  event_name?: string;
  event_status?: string;
  start_time?: string;
};

export type StaffAppraisalRow = {
  name: string;
  appraisal_cycle?: string;
  appraisal_template?: string;
  reflections?: string;
  self_score?: number | null;
  self_ratings?: Array<{ criteria?: string; rating?: number }>;
};

export type StaffPerformanceHub = {
  performance_available?: boolean;
  missing_modules?: string[];
  employee?: string;
  training_programs: Array<{ name: string; training_program?: string; description?: string }>;
  training_events: TrainingEventRow[];
  kras: Array<{
    name: string;
    title?: string;
    description?: string;
    weightage?: number | string;
    score?: number | string;
  }>;
  appraisals: StaffAppraisalRow[];
  feedback_criteria: Array<{ name: string; criteria?: string }>;
};

export type ProviderApplicationDetail = ServiceProviderApplication & {
  gender?: string;
  qualification?: string;
  registration_number?: string;
  clinic_address?: string;
  bio?: string;
  review_notes?: string;
  creation?: string;
  schedule_proposal?: ProviderScheduleInput[];
};

export type TeleconsultSession = {
  appointment_id: string;
  patient_name?: string;
  doctor_name?: string;
  appointment_date?: string;
  appointment_time?: string;
  status?: string;
  consultation_mode?: string;
  meeting_link?: string;
  portal_join_url?: string;
  follow_up_date?: string | null;
  follow_up_notes?: string | null;
  needs_followup?: boolean;
  sales_invoice?: string | null;
  doctor?: string;
  amount?: number;
  razorpay_payment_status?: string;
};

export type InsuranceProduct = {
  product_code: string;
  product_name: string;
  insurer: string;
  category?: string;
  sum_insured_from?: number;
  sum_insured_to?: number;
  premium_from?: number;
  highlights?: string[];
  description?: string;
  brochure_url?: string;
};

export type B2bCatalogItem = {
  item_code: string;
  item_name: string;
  item_group?: string;
  retail_rate: number;
  wholesale_rate: number;
  margin: number;
  franchisee_type?: string;
  franchisee_rate_label?: string;
  mrp_price_list?: string;
  franchisee_price_list?: string;
};

export type B2bWalletTransaction = {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  reference?: string | null;
  payment_reference?: string | null;
  remarks?: string | null;
  created?: string;
};

export type B2bWalletPayload = {
  wallet_balance: number;
  min_recharge: number;
  transactions: B2bWalletTransaction[];
  razorpay_recharge_enabled?: boolean;
};

export type AiPhysicianWorkupItem = {
  kind?: string;
  item_code?: string;
  panel_id?: string;
  item_name: string;
  rate?: number;
  mrp?: number | null;
  reason?: string;
  book_path?: string;
  detail_path?: string;
  probability?: number;
  probability_label?: string;
};

export type AiPhysicianService = {
  kind?: string;
  service: string;
  department?: string;
  practitioner?: string;
  wing_id?: string;
  service_code?: string;
  rate?: number;
  reason?: string;
  book_path?: string;
  probability?: number;
  probability_label?: string;
};

export type AiPhysicianCenter = {
  franchisee_id: string;
  franchise_name: string;
  branch_code?: string;
  address?: string;
  contact_phone?: string;
  territory_region?: string;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  book_lab_path?: string;
  book_doctor_path?: string;
};

export type AiPhysicianSuggestions = {
  health_packages?: AiPhysicianWorkupItem[];
  physician_services: AiPhysicianService[];
  individual_tests?: AiPhysicianWorkupItem[];
  nearby_centers: AiPhysicianCenter[];
  diagnostic_workup?: AiPhysicianWorkupItem[];
  specialty_hint?: string;
  suggestion_order?: string[];
};

export type AiPhysicianTurn = {
  session_id: string;
  phase: 'questions' | 'suggestions' | 'emergency' | 'refine' | string;
  message: string;
  question?: string | null;
  question_index?: number;
  total_questions?: number;
  turn_count?: number;
  max_turns?: number;
  suggestions?: AiPhysicianSuggestions | null;
  quick_replies?: string[];
  disclaimer?: string;
  journey_mode?: 'openai' | 'rules' | string;
  openai_enabled?: boolean;
  openai_polished?: boolean;
  openai_status?: {
    configured?: boolean;
    ready?: boolean;
    model?: string;
    last_error_code?: string | null;
    last_error_message?: string | null;
    using_fallback?: boolean;
  };
};

export type B2bPortalPayload = {
  b2b_available: boolean;
  franchisee?: FranchiseeProfile;
  wallet?: B2bWalletPayload;
  stats?: {
    orders_today: number;
    retail_collected_today: number;
    wholesale_due_today: number;
    margin_today: number;
    pending_platform_charges: number;
    wallet_balance?: number;
  };
};

export type B2bStatementLine = {
  trf_id: string;
  patient_name: string;
  test: string;
  retail_amount: number;
  wholesale_amount: number;
  margin: number;
  platform_billed: boolean;
  payment_method?: string;
  order_status?: string;
  created?: string;
};

export type SalesRepProfile = {
  rep_id: string;
  rep_code: string;
  full_name: string;
  designation?: string;
  territory_region?: string;
  phone?: string;
  hq_latitude?: number;
  hq_longitude?: number;
  reports_to?: string;
  manager?: { full_name?: string; rep_code?: string } | null;
  team?: Array<{
    name: string;
    rep_code: string;
    full_name: string;
    designation?: string;
    territory_region?: string;
  }>;
};

export type SalesPortalPayload = {
  available: boolean;
  reason?: string;
  rep?: SalesRepProfile;
  is_manager?: boolean;
  stats?: {
    visits_today: number;
    open_leads: number;
    franchisees_count: number;
    month_trfs: number;
    month_revenue: number;
    month_commission?: number;
    accrued_commission?: number;
  };
  commission?: {
    available: boolean;
    accrued_total?: number;
    paid_total?: number;
    month_accrued?: number;
    entry_count?: number;
  };
  hr_available?: boolean;
};

export type SalesLead = {
  name: string;
  lead_name: string;
  company_name?: string;
  phone: string;
  city?: string;
  status: string;
  assigned_rep?: string;
  franchisee?: string;
  latitude?: number;
  longitude?: number;
  modified?: string;
};

export type SalesVisit = {
  name: string;
  sales_rep: string;
  lead?: string;
  franchisee?: string;
  visit_date?: string;
  purpose?: string;
  outcome?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  creation?: string;
};

export type SalesFranchiseeStats = {
  franchisees: Array<{
    franchisee_id: string;
    franchise_name: string;
    branch_code: string;
    territory_region?: string;
    active_status?: string;
    trf_count: number;
    revenue: number;
  }>;
  total_trfs: number;
  total_revenue: number;
};

export type SalesCatalogOffering = {
  offering_code?: string;
  title: string;
  category?: string;
  description?: string;
  investment_from?: number;
  investment_to?: number;
  mrp_reference?: number;
  wholesale_reference?: number;
  points?: string[];
  brochure_page?: number;
};

export type RemediumCompanyInfo = {
  name?: string;
  legal_name?: string;
  tagline?: string;
  accreditation?: string;
  experience_years?: number;
  email?: string;
  phone?: string;
  home_collection_helpline?: string;
  home_collection_hours?: string;
  public_site?: string;
  franchise_page?: string;
};

export type SalesCatalogPayload = {
  panels: Array<{ name: string; panel_name?: string; description?: string; rate?: number; panel_rate?: number }>;
  pitch_decks: Array<SalesCatalogOffering>;
  health_packages?: Array<SalesCatalogOffering>;
  addons?: Array<SalesCatalogOffering>;
  diagnostic_services?: Array<SalesCatalogOffering>;
  offerings?: Array<SalesCatalogOffering>;
  brochure_url?: string;
  franchise_portal_url?: string;
  company?: RemediumCompanyInfo;
  popular_tests: Array<{ name: string; item_name?: string; standard_rate?: number }>;
};

export type SalesCommissionEntry = {
  name: string;
  sales_rep: string;
  franchisee?: string;
  franchise_name?: string;
  entry_type: string;
  reference_doctype?: string;
  reference_name?: string;
  gross_amount?: number;
  commission_rate?: number;
  commission_amount: number;
  status: string;
  posting_date: string;
  notes?: string;
};

export type SalesCommissionPayload = {
  summary: {
    available: boolean;
    accrued_total?: number;
    paid_total?: number;
    month_accrued?: number;
    entry_count?: number;
  };
  entries: SalesCommissionEntry[];
};

export type SalesClosingReport = {
  name: string;
  sales_rep: string;
  report_type: string;
  period_date: string;
  visits_count: number;
  new_leads: number;
  qualified_leads: number;
  onboardings: number;
  franchise_revenue: number;
  km_traveled?: number;
  creation?: string;
};

export type CheckoutPricing = {
  subtotal: number;
  membership_active: boolean;
  membership_plan_code?: string;
  membership_plan_title?: string;
  membership_discount: number;
  membership_discount_percent?: number;
  after_membership: number;
  coupon_discount: number;
  promo_code?: string;
  discount_amount: number;
  final_total: number;
  free_home_collection?: boolean;
  wallet_balance?: number;
  wallet_credit?: number;
};

export type CircleLandingPayload = {
  brand: string;
  tagline: string;
  hero_points: string[];
  benefit_cards: Array<{ icon: string; title: string; text: string }>;
  comparison: Array<{ feature: string; guest: string; circle: string }>;
  plans: SubscriptionPlan[];
  plans_available: boolean;
  entitlements?: Record<string, unknown>;
};

export type SalesTeamMapData = {
  reps: Array<{
    rep_id: string;
    rep_code: string;
    full_name: string;
    designation?: string;
    hq_latitude?: number;
    hq_longitude?: number;
    latitude?: number;
    longitude?: number;
    on_duty?: boolean;
    updated?: string;
  }>;
  leads: Array<{
    name: string;
    lead_name: string;
    latitude?: number;
    longitude?: number;
    status?: string;
    city?: string;
  }>;
};

export type LabReagentBatch = {
  batch_id: string;
  reagent_item: string;
  reagent_name: string;
  lot_number: string;
  franchisee_id?: string | null;
  status: string;
  verification_status?: string;
  verified_on?: string | null;
  tests_per_pack: number;
  tests_remaining: number;
  opened_on?: string | null;
  expiry_date?: string | null;
  low_stock: boolean;
  usage_percent: number;
};

export type LabReagentDashboard = {
  available: boolean;
  reason?: string;
  batches?: LabReagentBatch[];
  low_stock_alerts?: LabReagentBatch[];
  rules_count?: number;
  reagent_items?: Array<{ item_code: string; item_name: string }>;
};

export type QcEquipment = {
  name: string;
  equipment_name: string;
  asset_tag?: string;
  equipment_type?: string;
  nabl_product_group?: string;
  status?: string;
  safety_label?: string;
  next_calibration_due?: string;
  location?: string;
  reason?: string;
};

export type QcDashboard = {
  equipment: QcEquipment[];
  overdue: QcEquipment[];
  iqc_today: Array<{
    name: string;
    analyte_code: string;
    analyte_name?: string;
    qc_level: string;
    result_value: number;
    outcome: string;
    equipment?: string;
  }>;
  eqa: Array<{
    name: string;
    scheme_name: string;
    discipline: string;
    cycle?: string;
    outcome: string;
    participation_date?: string;
    score?: string;
  }>;
  counts: { equipment: number; iqc: number; eqa: number; calibrations: number };
};

export type QmsDashboard = {
  capas: Array<{
    name: string;
    title: string;
    source: string;
    severity?: string;
    status: string;
    opened_on?: string;
    due_date?: string;
    linked_complaint?: string;
  }>;
  complaints: Array<{
    name: string;
    ack_id?: string;
    subject: string;
    source: string;
    status: string;
    priority?: string;
    complaint_date?: string;
    linked_capa?: string;
    contact_name?: string;
  }>;
  quality_indicators: Array<{
    name: string;
    indicator_name: string;
    indicator_code: string;
    category?: string;
    unit?: string;
    target_value?: number;
    direction?: string;
  }>;
  qi_values: Array<{
    name: string;
    indicator: string;
    period_start?: string;
    period_end?: string;
    value: number;
    meets_target?: number;
    numerator?: number;
    denominator?: number;
  }>;
  audits: Array<{
    name: string;
    audit_title: string;
    audit_type?: string;
    audit_date?: string;
    status?: string;
    area?: string;
    nonconformities_count?: number;
  }>;
  risks: Array<{
    name: string;
    risk_title: string;
    process_area?: string;
    likelihood?: string;
    impact?: string;
    risk_score?: number;
    status?: string;
  }>;
  lis_checklists: Array<{
    name: string;
    checklist_title: string;
    verification_date?: string;
    status?: string;
  }>;
  retention?: { reports: number; raw_data: number; qc: number; complaints: number };
  counts: {
    capa: number;
    capa_open: number;
    complaints: number;
    complaints_open: number;
    qi: number;
    audits: number;
    risks: number;
    lis: number;
  };
};

export type TelephonyDashboard = {
  calls: Array<{
    name: string;
    call_sid: string;
    from_number?: string;
    status?: string;
    path?: string;
    caller_known?: number;
    patient_name?: string;
    service_intent?: string;
    booking_doctype?: string;
    booking_ref?: string;
    escalate_reason?: string;
    creation?: string;
  }>;
  counts: {
    total: number;
    booked: number;
    escalated: number;
    ai: number;
    ivr: number;
  };
  telephony_enabled?: boolean;
  agent_configured?: boolean;
  openai_configured?: boolean;
  openai_status?: {
    configured?: boolean;
    ready?: boolean;
    model?: string;
    last_error_code?: string | null;
    last_error_message?: string | null;
    using_fallback?: boolean;
  };
};

export type LabAboutSection = {
  title: string;
  body: string;
};

export type LabFaq = {
  question: string;
  answer: string;
};

export type LabParameter = {
  parameter_code?: string;
  parameter_name: string;
  unit?: string;
  normal_min?: number | null;
  normal_max?: number | null;
  is_calculated?: number;
};

export type CatalogItem = {
  name: string;
  item_name: string;
  description?: string;
  standard_rate: number;
  rate?: number;
  mrp?: number;
  discount_percent?: number;
  coupon_label?: string | null;
  member_tag?: string | null;
  price_basis?: 'foco' | 'ten_percent' | 'none' | string;
  foco_rate?: number | null;
  wallet_earn_percent?: number;
  wallet_earn_amount?: number;
  image?: string | null;
  item_group?: string;
  sample_type?: string;
  report_tat_hours?: number;
  test_count?: number;
  preparation?: string;
  also_known_as?: string[];
  lab_category?: string;
  slug?: string;
  about_sections?: LabAboutSection[];
  faqs?: LabFaq[];
  included_tests?: LabParameter[];
  parameters_source?: string;
};

export type LabTestDetail = CatalogItem;

export type LabPanel = {
  panel_id: string;
  panel_name: string;
  description?: string;
  rate: number;
  mrp?: number | null;
  discount_percent?: number;
  price_basis?: string;
  wallet_earn_percent?: number;
  wallet_earn_amount?: number;
  member_tag?: string | null;
  coupon_label?: string | null;
  test_count?: number;
  tests: Array<{ item_code: string; item_name: string; rate: number; mrp?: number | null }>;
};

export type HomeQuickAction = {
  title: string;
  route: string;
  url?: string;
};

export type HomeRadiologyService = {
  title: string;
  description?: string;
  query: string;
  icon?: string;
};

export type WhatsappCta = {
  enabled: boolean;
  label: string;
  phone?: string | null;
  url?: string | null;
};

export type HomeHeaders = {
  home_title?: string;
  home_subtitle?: string;
  search_placeholder?: string;
  section_packages_title?: string;
  section_radiology_title?: string;
  section_popular_title?: string;
};

export type Franchisee = {
  name: string;
  franchise_name: string;
  branch_code: string;
  territory_region?: string;
  address?: string;
  contact_phone?: string;
  hub_latitude?: number | null;
  hub_longitude?: number | null;
  geofence_radius_m?: number;
};

export type PhleboMapStop = {
  trf_id: string;
  patient_name: string;
  patient_phone?: string;
  collection_address?: string;
  latitude: number;
  longitude: number;
  order_status?: string;
  barcode?: string;
  test_name?: string;
  collection_slot?: string | null;
};

export type PhleboMapData = {
  hub: Franchisee | null;
  phlebotomist: {
    latitude?: number;
    longitude?: number;
    on_duty?: number | boolean;
    updated_at?: string;
  } | null;
  stops: PhleboMapStop[];
  route: {
    distance_m?: number;
    duration_s?: number;
    geometry?: Array<[number, number]>;
  } | null;
};

export type LeaveApplicationRow = {
  name: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  status?: string;
  description?: string;
  total_leave_days?: number;
  creation?: string;
  modified?: string;
};

export type ExpenseClaimRow = {
  name: string;
  approval_status?: string;
  total_claimed_amount?: number;
  posting_date?: string | null;
  remark?: string;
  expenses?: Array<{ expense_type?: string; description?: string; amount?: number }>;
  creation?: string;
  modified?: string;
};

export type HrSelfService = {
  hr_available: boolean;
  missing_modules?: string[];
  employee?: string | null;
  leave_types: Array<{ name: string; leave_type_name?: string; max_leaves_allowed?: number }>;
  expense_types: Array<{ name: string; expense_type?: string }>;
  leave_applications: LeaveApplicationRow[];
  expense_claims: ExpenseClaimRow[];
};

export type FranchiseeProfile = {
  name: string;
  branch_code?: string;
  franchise_name?: string;
  territory_region?: string;
  commission_percentage_rate?: number;
};

export type ProviderProfile = {
  doctor_id: string;
  doctor_name: string;
  email?: string;
  mobile?: string;
  primary_department?: string;
  department_name?: string;
  status?: string;
  bio?: string;
};

export type ProviderScheduleSlot = {
  name: string;
  day_of_week: string;
  from_time: string;
  to_time: string;
  slot_duration: number;
  consultation_type?: string;
  department?: string;
  is_active: boolean;
};

export type ProviderPortalPayload = {
  profile: ProviderProfile;
  schedule_slots: ProviderScheduleSlot[];
  upcoming_appointments: Array<{
    appointment_id: string;
    patient_name?: string;
    appointment_date?: string;
    appointment_time?: string;
    status?: string;
    consultation_mode?: string;
    meeting_link?: string;
    department?: string;
    amount?: number;
    razorpay_payment_status?: string;
  }>;
  doctor_status?: string;
};

export type SessionUser = {
  user: string;
  full_name?: string;
  fullName?: string;
  roles: string[];
  sid?: string;
  franchisee?: FranchiseeProfile | null;
  provider?: ProviderProfile | null;
  must_change_password?: boolean;
};

export type AppSettings = {
  site_name: string;
  razorpay_key_id?: string;
  razorpay_test_mode?: boolean;
  otp_test_mode?: boolean;
  lis_requires_payment?: boolean;
  supported_order_statuses?: string[];
  email_signup_enabled?: boolean;
  email_configured?: boolean;
  portal_base_url?: string;
  oauth_enabled?: boolean;
  oauth_providers?: string[];
};

export type JobOpeningSummary = {
  name: string;
  job_title: string;
  department?: string | null;
  location?: string;
  employment_type?: string;
  description?: string;
  status?: string;
  posted_on?: string | null;
};

export type JobApplicationSummary = {
  name: string;
  applicant_name?: string;
  email_id?: string;
  phone_number?: string;
  job_opening?: string;
  status?: string;
  pipeline_stage?: string;
  source?: string;
  applied_on?: string | null;
};

export type JobApplicationDetail = JobApplicationSummary & {
  opening?: JobOpeningSummary | null;
  documents?: {
    resume?: string | null;
    photo?: string | null;
    aadhaar?: string | null;
    other?: string | null;
  };
  application?: Record<string, unknown>;
  stages?: string[];
};

export type HiringCampaignRow = {
  name: string;
  campaign_name: string;
  platform?: string;
  job_role_label?: string;
  impressions?: number;
  clicks?: number;
  leads?: number;
  applications?: number;
  hired?: number;
  spend?: number;
  cpl?: number;
  roi?: number;
  status?: string;
};

export type HiringLeadRow = {
  name: string;
  lead_name: string;
  job_role?: string;
  source?: string;
  lead_date?: string;
  status?: string;
  campaign?: string;
};

export type HiringMarketingDashboard = {
  from_date: string;
  to_date: string;
  kpis: Array<{ key: string; label: string; value: number; delta_pct?: number; suffix?: string }>;
  leads_over_time: Array<{ date: string; leads: number }>;
  leads_by_source: Array<{ source: string; count: number; pct: number }>;
  leads_by_role: Array<{ role: string; count: number; pct: number }>;
  funnel: Array<{ stage: string; count: number; conversion_from_prev?: number }>;
  campaigns: HiringCampaignRow[];
  recent_leads: HiringLeadRow[];
  recent_hires: Array<{
    name: string;
    applicant_name?: string;
    job_role?: string;
    hired_on?: string | null;
    stage?: string;
  }>;
  overall_hire_rate?: number;
};

export type ApplicationPipelineBundle = {
  application: string;
  interviews: Array<{
    name: string;
    interview_type?: string;
    scheduled_on?: string;
    duration_minutes?: number;
    status?: string;
    interviewer?: string;
    meeting_link?: string;
    location?: string;
    notes?: string;
  }>;
  notes: Array<{
    name: string;
    note_type?: string;
    content?: string;
    created_by_user?: string;
    created_on?: string | null;
  }>;
  offers: Array<{
    name: string;
    designation?: string;
    department?: string;
    offer_date?: string;
    joining_date?: string;
    status?: string;
    salary_offered?: number;
    notes?: string;
  }>;
  onboarding_todos: Array<{
    name: string;
    description?: string;
    status?: string;
    date?: string;
    allocated_to?: string;
  }>;
  stages?: string[];
};

export type OAuthProvider = {
  provider: string;
  label?: string;
  client_id?: string;
  login_url: string;
};

export type PrescriptionMedicineOption = {
  name: string;
  item_name?: string;
  standard_rate?: number;
  item_group?: string;
};

export type PrescriptionMedicineLine = {
  medicine_item: string;
  item_name?: string;
  dosage?: string;
  duration?: string;
  frequency?: string;
  instructions?: string;
};

export type PrescriptionDiagnosticOption = {
  name: string;
  test_name?: string;
  department?: string;
  item?: string;
  item_name?: string;
  description?: string;
};

export type PrescriptionDiagnosticLine = {
  diagnostic_test?: string;
  test_name?: string;
  item?: string;
  item_name?: string;
  notes?: string;
};

export type ClinicalPrescription = {
  name: string;
  patient?: string;
  patient_name?: string;
  doctor?: string;
  department?: string;
  status?: string;
  diagnosis?: string;
  clinical_notes?: string;
  encounter_date?: string;
  care_journey?: string;
  doctor_appointment?: string | null;
  medicine_count?: number;
  diagnostic_count?: number;
  medicines?: PrescriptionMedicineLine[];
  diagnostics?: PrescriptionDiagnosticLine[];
};

export type RazorpayOrder = {
  order_id: string;
  amount: number;
  amount_paise: number;
  currency: string;
  razorpay_key_id?: string;
  test_mode?: boolean;
};

export type Booking = {
  trf_id: string;
  patient_name: string;
  patient_phone?: string;
  barcode?: string;
  test_required?: string;
  test_name?: string;
  test_labels?: string[];
  order_status?: string;
  razorpay_payment_status?: string;
  payment_method?: string;
  amount?: number;
  collection_slot?: string | null;
  collection_address?: string;
  collection_latitude?: number | null;
  collection_longitude?: number | null;
  creation?: string;
  modified?: string;
  franchisee_id?: string;
};

export type PharmacyOrder = {
  name: string;
  customer_name?: string;
  customer_phone?: string;
  delivery_address?: string;
  uploaded_prescription_url?: string;
  order_total?: number;
  delivery_status?: string;
  delivery_user?: string;
  razorpay_payment_status?: string;
  payment_method?: string;
  duration_months?: number;
  desired_discount_slab?: string;
  order_kind?: string;
  clinical_prescription?: string;
  doctor_name?: string;
  pharmacist_notes?: string;
  quote_sent_on?: string;
  creation?: string;
  items?: Array<{
    item_name?: string;
    item_code?: string;
    qty?: number;
    rate?: number;
    amount?: number;
    dosage?: string;
    frequency?: string;
    duration?: string;
  }>;
};

export type PhlebotomistReport = {
  journey_id: string;
  trf_id: string;
  patient_name: string;
  patient_phone?: string;
  status: string;
  report_pdf?: string;
  authorized_on?: string;
  test_name?: string;
  test_labels?: string[];
};

export type PromoBanner = {
  title: string;
  subtitle: string;
  color: string;
  icon?: string;
  image_url?: string;
};

export type AlliedHealthWing = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  image: string;
  service_count?: number;
  starting_rate?: number;
};

export type AlliedHealthService = {
  service_code: string;
  wing_id: string;
  wing_title: string;
  service_name: string;
  item_group: string;
  mode?: string;
  duration?: string;
  rate: number;
  short_description?: string;
  long_description?: string;
  department_name?: string;
  consultation_type?: string;
  icon?: string;
  color?: string;
  image?: string;
};

export type Appointment = {
  name: string;
  patient_name?: string;
  practitioner_name?: string;
  appointment_type?: string;
  appointment_date?: string;
  appointment_time?: string;
  status?: string;
  department?: string;
  amount?: number;
  razorpay_payment_status?: string;
  payment_method?: string;
};

export type DoctorSlot = {
  time: string;
  consultation_type?: string;
  department?: string;
};

function humanizeApiError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('validate_coupon') && lower.includes('has no attribute')) {
    return 'Coupon API is not on the server yet. Deploy latest backend (deploy-clinical-apis.sh).';
  }
  if (msg.includes('Failed to get method for command')) {
    const match = msg.match(/command\s+[\w.]+\.(\w+)\s+with/);
    if (match) {
      return `Server is missing the ${match[1]} API. Deploy the latest backend code.`;
    }
    return 'This feature is not available on the server yet. Deploy the latest backend code.';
  }
  return msg.replace(/^[^:]+:\s*/, '').trim() || msg;
}

function parseFrappeMessage(message: unknown): string | null {
  if (!message) return null;
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message) as unknown[];
      if (Array.isArray(parsed) && parsed[0]) {
        let item: unknown = parsed[0];
        if (typeof item === 'string') {
          try {
            item = JSON.parse(item) as unknown;
          } catch {
            return humanizeApiError(String(item));
          }
        }
        if (item && typeof item === 'object' && 'message' in item) {
          return humanizeApiError(String((item as { message?: string }).message || ''));
        }
      }
    } catch {
      return humanizeApiError(message);
    }
    return humanizeApiError(message);
  }
  return null;
}

function parseEnvelope<T>(body: unknown): ApiEnvelope<T> {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid server response');
  }
  const raw = body as Record<string, unknown>;
  if (raw.exc_type || raw.exception) {
    const serverMsg = parseFrappeMessage(raw._server_messages);
    const exc = String(raw.exception || raw.message || serverMsg || 'Server error');
    const cleaned = humanizeApiError(exc.replace(/^[^:]+:\s*/, '').trim() || exc);
    throw new Error(serverMsg || cleaned || 'Server error');
  }
  const nested = raw.message;
  if (nested && typeof nested === 'object') {
    const envelope = nested as ApiEnvelope<T>;
    if (envelope.status === 'error') {
      throw new Error(envelope.message || 'Request failed');
    }
    return envelope;
  }
  if (typeof nested === 'string') {
    return { status: 'success', message: nested, data: {} as T };
  }
  return raw as ApiEnvelope<T>;
}

async function downloadBinary(
  method: string,
  body: Record<string, string>,
  filename: string,
): Promise<void> {
  const sid = getSid();
  const params = new URLSearchParams({
    ...body,
    ...(sid ? { sid } : {}),
  });
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/pdf, application/json',
      'X-Frappe-Site-Name': import.meta.env.VITE_SITE_NAME || 'health.localhost',
      ...(sid ? { Cookie: `sid=${sid}` } : {}),
    },
    body: params.toString(),
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('application/json')) {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as {
        message?: { message?: string; status?: string };
        exc?: string;
      };
      const nested = json.message;
      const msg =
        (typeof nested === 'object' && nested?.message) ||
        (typeof nested === 'string' ? nested : null) ||
        json.exc ||
        text ||
        'Download failed';
      throw new Error(String(msg).replace(/^[^:]+:\s*/, '').trim() || 'Download failed');
    } catch (e) {
      if (e instanceof Error && e.message !== 'Unexpected token') throw e;
      throw new Error(text || 'Download failed');
    }
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Fetch a whitelisted method that returns a raw HTML/string in `message`. */
async function fetchRawMessage(
  method: string,
  body: Record<string, string>,
  module: ApiModule = 'main',
): Promise<string> {
  const sid = getSid();
  const params = new URLSearchParams({ ...body, ...(sid ? { sid } : {}) });
  const res = await fetch(apiUrl(method, module), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'X-Frappe-Site-Name': import.meta.env.VITE_SITE_NAME || 'health.localhost',
      ...(sid ? { Cookie: `sid=${sid}` } : {}),
    },
    body: params.toString(),
    credentials: 'include',
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { message?: unknown };
    if (typeof json.message === 'string') return json.message;
    return String(json.message ?? '');
  } catch {
    return text;
  }
}

async function request<T>(
  method: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, string | number | boolean>;
    auth?: boolean;
    cookies?: boolean;
    module?: ApiModule;
  } = {},
): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Frappe-Site-Name': import.meta.env.VITE_SITE_NAME || 'health.localhost',
  };

  const module = options.module ?? 'main';
  let url = apiUrl(method, module);
  const needsAuth = options.auth !== false;
  const useCookies = options.cookies === true || needsAuth;
  const init: RequestInit = {
    method: options.method || 'GET',
    headers,
    credentials: useCookies ? 'include' : 'omit',
  };

  const body: Record<string, string | number | boolean> = { ...(options.body || {}) };

  if (needsAuth) {
    const sid = getSid();
    if (sid) {
      headers.Cookie = `sid=${sid}`;
      body.sid = sid;
    }
  }

  if (options.method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(
      Object.entries(body).map(([k, v]) => [k, String(v)]),
    ).toString();
  } else if (Object.keys(body).length > 0) {
    const params = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
    url += `?${params.toString()}`;
  }

  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (!contentType.includes('application/json')) {
    if (response.status === 502 || rawText.trimStart().startsWith('<')) {
      throw new Error(
        'Server is temporarily unavailable (502). Backend may be restarting — wait 1 minute and try again, or run emergency-fix-502.sh on the server.',
      );
    }
    throw new Error(rawText.slice(0, 120) || `Request failed (${response.status})`);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error('Invalid server response. The API may be down or not deployed yet.');
  }

  const envelope = parseEnvelope<T>(json);

  if (envelope.status !== 'success') {
    const msg = (envelope.message || 'Request failed').toLowerCase();
    if (
      needsAuth &&
      (msg.includes('not authenticated') ||
        msg.includes('invalid credentials') ||
        msg.includes('disabled'))
    ) {
      clearSession();
    }
    throw new Error(envelope.message || 'Request failed');
  }

  return envelope;
}

export function clearSession() {
  clearStoredSession();
}

export function isLoggedIn() {
  return Boolean(getSid());
}

export const api = {
  getAppSettings: () => request<AppSettings>('get_app_settings', { auth: false }),

  createRazorpayOrder: (body: {
    reference_doctype: string;
    reference_name: string;
    amount?: number;
  }) =>
    request<RazorpayOrder>('create_razorpay_order', {
      method: 'POST',
      body,
      auth: true,
    }),

  verifyRazorpayPayment: (body: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
    reference_doctype: string;
    reference_name: string;
  }) =>
    request<{ reference: string; payment_entry: string; status: string }>('verify_razorpay_payment', {
      method: 'POST',
      body,
      auth: true,
    }),

  validateSession: () =>
    request<{
      user: string;
      full_name?: string;
      roles: string[];
      franchisee?: FranchiseeProfile | null;
      provider?: ProviderProfile | null;
    }>('validate_session', { auth: true }),

  getHomeContent: () =>
    request<{
      banners: unknown[];
      promotions: unknown[];
      popular_tests: CatalogItem[];
      quick_actions?: HomeQuickAction[];
      trust_badges?: Array<{ title: string; subtitle: string }>;
      health_categories?: Array<{ label: string; query: string; icon?: string }>;
      collection_steps?: Array<{ step: number; title: string; description: string }>;
      health_packages?: LabPanel[];
      radiology_services?: HomeRadiologyService[];
      whatsapp_cta?: WhatsappCta;
      headers?: HomeHeaders;
    }>('get_home_content', { auth: false }),

  startAiPhysicianJourney: (body: {
    symptoms: string;
    latitude?: number;
    longitude?: number;
  }) =>
    request<AiPhysicianTurn>('start_ai_physician_journey', {
      method: 'POST',
      body,
      auth: false,
    }),

  aiPhysicianTurn: (body: {
    session_id: string;
    message: string;
    latitude?: number;
    longitude?: number;
  }) =>
    request<AiPhysicianTurn>('ai_physician_turn', {
      method: 'POST',
      body,
      auth: false,
    }),

  findNearbyCollectionCenters: (body: {
    latitude: number;
    longitude: number;
    radius_km?: number;
    limit?: number;
  }) =>
    request<{ centers: AiPhysicianCenter[]; count: number }>('find_nearby_collection_centers', {
      method: 'POST',
      body,
      auth: false,
    }),

  getLabPanels: () =>
    request<{ panels: LabPanel[] }>('get_lab_test_panels', { auth: false, module: 'diagnostics' }),

  getLabCatalog: () => request<{ items: CatalogItem[] }>('get_lab_test_catalog', { auth: false }),

  getPharmacyCatalog: () =>
    request<{ items: CatalogItem[] }>('get_pharmacy_catalog', { auth: false }),

  getItemDetail: (itemCode: string) =>
    request<{ item: LabTestDetail }>('get_item_detail', { body: { item_code: itemCode }, auth: false }),

  searchFranchisees: (q = '', limit = 200) =>
    request<{ franchisees: Franchisee[] }>('search_franchisees', { body: { q, limit }, auth: false }),

  getCollectionCenters: (q = '', limit = 200) =>
    request<{ franchisees: Franchisee[] }>('get_collection_centers', {
      body: { q, limit },
      auth: false,
    }),

  login: async (usr: string, pwd: string) => {
    const envelope = await request<SessionUser>('authenticate_user', {
      method: 'POST',
      body: { usr, pwd },
      auth: false,
    });
    const data = envelope.data;
    if (data.sid) {
      saveSession({
        sid: data.sid,
        user: data.user,
        fullName: data.full_name,
        roles: data.roles || [],
        franchisee: data.franchisee ?? null,
        provider: data.provider ?? null,
      });
    }
    return envelope;
  },

  sendOtp: (mobile: string) =>
    request<{ mobile: string; test_mode?: boolean; hint?: string }>('send_otp', {
      method: 'POST',
      body: { mobile },
      auth: false,
      module: 'otp',
    }),

  verifyOtpLogin: async (mobile: string, otp: string) => {
    const envelope = await request<SessionUser>('verify_otp_and_login', {
      method: 'POST',
      body: { mobile, otp },
      auth: false,
      cookies: true,
      module: 'otp',
    });
    const data = envelope.data;
    if (data?.sid) {
      saveSession({
        sid: data.sid,
        user: data.user,
        fullName: data.full_name || data.fullName || data.user,
        roles: Array.isArray(data.roles) ? data.roles : [],
        franchisee: data.franchisee ?? null,
        provider: data.provider ?? null,
      });
    }
    return envelope;
  },

  getOAuthProviders: (redirectTo?: string) =>
    request<{ providers: OAuthProvider[]; callback_url?: string; google_redirect_uri?: string }>(
      'get_oauth_providers',
      {
        body: redirectTo ? { redirect_to: redirectTo } : {},
        auth: false,
        module: 'oauth',
      },
    ),

  completeOAuthLogin: (sid?: string, loginToken?: string) =>
    request<SessionUser>('complete_oauth_login', {
      method: 'POST',
      body: {
        ...(sid ? { sid } : {}),
        ...(loginToken ? { login_token: loginToken } : {}),
      },
      auth: false,
      cookies: true,
      module: 'oauth',
    }),

  getMyBookings: (limit = 50) =>
    request<{ bookings: Booking[] }>('get_my_bookings', { body: { limit }, auth: true }),

  getPhlebotomistQueue: (limit = 50) =>
    request<{ orders: Booking[]; franchisee: Franchisee | null }>('get_phlebotomist_collection_queue', {
      body: { limit },
      auth: true,
    }),

  markSampleCollected: (trfId: string) =>
    request<{ trf_id: string; order_status: string }>('phlebotomist_mark_sample_collected', {
      method: 'POST',
      body: { trf_id: trfId },
      auth: true,
    }),

  getPhlebotomistMapData: () =>
    request<PhleboMapData>('get_phlebotomist_map_data', { body: {}, auth: true }),

  getApproximateLocation: () =>
    request<{ location: { latitude: number; longitude: number; city?: string; source?: string } }>(
      'get_approximate_location',
      { body: {}, auth: true },
    ),

  updatePhlebotomistLocation: (latitude: number, longitude: number, onDuty: boolean) =>
    request<{ location: { latitude: number; longitude: number; on_duty: number } }>(
      'phlebotomist_update_location',
      {
        method: 'POST',
        body: { latitude, longitude, on_duty: onDuty ? 1 : 0 },
        auth: true,
      },
    ),

  phlebotomistHubCheckin: (latitude: number, longitude: number) =>
    request<{ ok: boolean; distance_m?: number; message?: string }>('phlebotomist_hub_checkin', {
      method: 'POST',
      body: { latitude, longitude },
      auth: true,
    }),

  startMaskedCall: (referenceDoctype: string, referenceName: string, dryRun = false) =>
    request<{
      ok: boolean;
      call_sid: string;
      masked_caller_id?: string;
      masked_caller_id_display?: string;
      peer_label?: string;
      dry_run?: boolean;
    }>('start_masked_call', {
      method: 'POST',
      body: {
        reference_doctype: referenceDoctype,
        reference_name: referenceName,
        dry_run: dryRun ? 1 : 0,
      },
      auth: true,
    }),

  getMaskedCallContext: (referenceDoctype: string, referenceName: string) =>
    request<{
      available: boolean;
      ready: boolean;
      telephony_enabled?: boolean;
      masked_caller_id_display?: string | null;
      exophone_last4?: string | null;
      peer_label?: string | null;
      reason?: string | null;
      initiator_role?: string;
    }>('get_masked_call_context', {
      method: 'POST',
      body: { reference_doctype: referenceDoctype, reference_name: referenceName },
      auth: true,
    }),

  getHrSelfService: () => request<HrSelfService>('get_hr_self_service', { body: {}, auth: true }),

  submitLeaveApplication: (body: {
    leave_type: string;
    from_date: string;
    to_date: string;
    description?: string;
  }) =>
    request<{ leave_application: LeaveApplicationRow }>('submit_leave_application', {
      method: 'POST',
      body,
      auth: true,
    }),

  submitExpenseClaim: (body: {
    expense_type: string;
    amount: number;
    description?: string;
    expense_date?: string;
  }) =>
    request<{ expense_claim: ExpenseClaimRow }>('submit_expense_claim', {
      method: 'POST',
      body,
      auth: true,
    }),

  attachExpenseReceipt: (expenseClaim: string, filename: string, fileContent: string) =>
    request<{ ok: boolean }>('attach_expense_receipt', {
      method: 'POST',
      body: { expense_claim: expenseClaim, filename, file_content: fileContent },
      auth: true,
    }),

  markOfflinePaymentCollected: (referenceDoctype: string, referenceName: string) =>
    request<{ status: string; payment_method?: string }>('mark_offline_payment_collected', {
      method: 'POST',
      body: { reference_doctype: referenceDoctype, reference_name: referenceName },
      auth: true,
    }),

  getPhlebotomistReports: (limit = 50) =>
    request<{ reports: PhlebotomistReport[] }>('get_phlebotomist_reports', {
      body: { limit },
      auth: true,
    }),

  downloadJourneyReport: (journeyId: string, fileName?: string) =>
    downloadBinary(
      'download_journey_report_pdf',
      { journey_id: journeyId },
      fileName || `Lab_Report_${journeyId}.pdf`,
    ),

  getTrfDetail: (arg: string | { trf_id?: string; barcode?: string }) =>
    request<{ trf: Booking; results: unknown[] }>('get_trf_detail', {
      body: typeof arg === 'string' ? { trf_id: arg } : arg,
      auth: true,
    }),

  updateOrderStatus: (trfId: string, orderStatus: string, barcode?: string) =>
    request<{ trf_id: string; order_status: string }>('update_order_status', {
      method: 'POST',
      body: { trf_id: trfId, order_status: orderStatus, ...(barcode ? { barcode } : {}) },
      auth: true,
    }),

  getStaffPerformanceHub: () =>
    request<StaffPerformanceHub>('get_staff_performance_hub', { auth: true }),

  submitAppraisalSelfReview: (body: {
    appraisal: string;
    reflections?: string;
    ratings?: Array<{ criteria: string; rating: number; per_weightage?: number }>;
  }) =>
    request<{ appraisal: StaffAppraisalRow }>('submit_appraisal_self_review', {
      method: 'POST',
      body: {
        appraisal: body.appraisal,
        ...(body.reflections !== undefined ? { reflections: body.reflections } : {}),
        ...(body.ratings ? { ratings: JSON.stringify(body.ratings) } : {}),
      },
      auth: true,
    }),

  submitTrainingFeedback: (body: { training_event: string; rating: number; feedback?: string }) =>
    request<{ ok?: boolean }>('submit_training_feedback', {
      method: 'POST',
      body: {
        training_event: body.training_event,
        rating: body.rating,
        ...(body.feedback !== undefined ? { feedback: body.feedback } : {}),
      },
      auth: true,
    }),

  getPatientJourney: (journeyId?: string) =>
    request<{ journey: CareJourney | null }>('get_patient_journey', {
      body: journeyId ? { journey_id: journeyId } : {},
      auth: true,
      module: 'journey',
    }),

  listPatientJourneys: (limit = 20) =>
    request<{ journeys: CareJourney[] }>('list_patient_journeys', {
      body: { limit },
      auth: true,
      module: 'journey',
    }),

  getAppointmentTypes: () =>
    request<{ types: Array<{ name: string; consultation_type?: string }> }>('get_appointment_types', {
      auth: false,
      module: 'appointments',
    }),

  getDepartments: () =>
    request<{ departments: Array<{ name: string; department_name?: string }> }>(
      'get_healthcare_departments',
      { auth: false, module: 'appointments' },
    ),

  getPractitioners: (department?: string) =>
    request<{ practitioners: Array<{ name: string; practitioner_name?: string; department?: string }> }>(
      'get_healthcare_practitioners',
      { body: department ? { department } : {}, auth: false, module: 'appointments' },
    ),

  getDoctorSlots: (doctor: string, appointmentDate: string, department?: string) =>
    request<{ slots: DoctorSlot[]; day?: string }>('get_doctor_schedule_slots', {
      body: { doctor, appointment_date: appointmentDate, ...(department ? { department } : {}) },
      auth: false,
      module: 'appointments',
    }),

  bookAppointment: (body: Record<string, string>) =>
    request<{ appointment_id: string; care_journey?: string }>('book_patient_appointment', {
      method: 'POST',
      body,
      auth: true,
      module: 'appointments',
    }),

  bookTeleconsultAppointment: (body: Record<string, string>) =>
    request<{ appointment_id: string; care_journey?: string; meeting_link?: string; consultation_mode?: string }>(
      'book_teleconsult_appointment',
      {
        method: 'POST',
        body,
        auth: true,
        module: 'telemedicine',
      },
    ),

  getTeleconsultSession: (appointmentId: string) =>
    request<{ session: TeleconsultSession }>('get_teleconsult_session', {
      method: 'POST',
      body: { appointment_id: appointmentId },
      auth: true,
      module: 'telemedicine',
    }),

  scheduleAppointmentFollowup: (body: {
    appointment_id: string;
    follow_up_date?: string;
    follow_up_notes?: string;
    book_slot?: boolean;
    appointment_time?: string;
  }) =>
    request<{ parent_appointment: string; follow_up_date?: string; follow_up_appointment?: string }>(
      'schedule_appointment_followup',
      {
        method: 'POST',
        body: {
          appointment_id: body.appointment_id,
          ...(body.follow_up_date ? { follow_up_date: body.follow_up_date } : {}),
          ...(body.follow_up_notes ? { follow_up_notes: body.follow_up_notes } : {}),
          ...(body.book_slot != null ? { book_slot: body.book_slot } : {}),
          ...(body.appointment_time ? { appointment_time: body.appointment_time } : {}),
        },
        auth: true,
        module: 'telemedicine',
      },
    ),

  getMyAppointments: (limit = 50) =>
    request<{ appointments: Appointment[] }>('get_my_appointments', {
      body: { limit },
      auth: true,
      module: 'appointments',
    }),

  getAlliedHealthWings: () =>
    request<{ wings: AlliedHealthWing[]; promo_banners?: PromoBanner[] }>('get_allied_health_wings', {
      auth: false,
      module: 'appointments',
    }),

  getAlliedHealthServices: (wingId?: string, q?: string) =>
    request<{ services: AlliedHealthService[]; count: number }>('get_allied_health_services', {
      body: { ...(wingId ? { wing_id: wingId } : {}), ...(q ? { q } : {}) },
      auth: false,
      module: 'appointments',
    }),

  getAlliedHealthService: (serviceCode: string) =>
    request<{ service: AlliedHealthService }>('get_allied_health_service', {
      body: { service_code: serviceCode },
      auth: false,
      module: 'appointments',
    }),

  bookAlliedHealthAppointment: (body: Record<string, string>) =>
    request<{ appointment_id: string; amount?: number }>('book_allied_health_appointment', {
      method: 'POST',
      body,
      auth: true,
      module: 'appointments',
    }),

  getMyPharmacyOrders: (limit = 50) =>
    request<{ orders: PharmacyOrder[] }>('get_my_pharmacy_orders', { body: { limit }, auth: true }),

  uploadPrescription: (fileName: string, fileData: string) =>
    request<{ file_url: string }>('upload_prescription', {
      method: 'POST',
      body: { file_name: fileName, file_data: fileData },
      auth: true,
    }),

  searchPrescriptionMedicines: (q: string, limit = 25) =>
    request<{ medicines: PrescriptionMedicineOption[] }>('search_prescription_medicines', {
      method: 'POST',
      body: { q, limit },
      auth: true,
      module: 'ePrescribe',
    }),

  searchPrescriptionDiagnostics: (q: string, limit = 25) =>
    request<{ diagnostics: PrescriptionDiagnosticOption[] }>('search_prescription_diagnostics', {
      method: 'POST',
      body: { q, limit },
      auth: true,
      module: 'rxDiagnostics',
    }),

  providerIssuePrescription: (body: {
    appointment_id: string;
    diagnosis?: string;
    clinical_notes?: string;
    medicines?: PrescriptionMedicineLine[];
    diagnostics?: PrescriptionDiagnosticLine[];
    submit?: boolean;
  }) =>
    request<{ prescription: ClinicalPrescription }>('provider_issue_prescription', {
      method: 'POST',
      body: {
        appointment_id: body.appointment_id,
        ...(body.diagnosis ? { diagnosis: body.diagnosis } : {}),
        ...(body.clinical_notes ? { clinical_notes: body.clinical_notes } : {}),
        medicines: JSON.stringify(body.medicines || []),
        diagnostics: JSON.stringify(body.diagnostics || []),
        submit: body.submit === false ? 0 : 1,
      },
      auth: true,
      module: 'ePrescribe',
    }),

  getAppointmentPrescriptions: (appointmentId: string) =>
    request<{ prescriptions: ClinicalPrescription[] }>('get_appointment_prescriptions', {
      method: 'POST',
      body: { appointment_id: appointmentId },
      auth: true,
      module: 'ePrescribe',
    }),

  getMyPrescriptions: (limit = 50) =>
    request<{ prescriptions: ClinicalPrescription[] }>('get_my_prescriptions', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'ePrescribe',
    }),

  getClinicalPrescription: (prescriptionId: string) =>
    request<{ prescription: ClinicalPrescription }>('get_clinical_prescription', {
      method: 'POST',
      body: { prescription_id: prescriptionId },
      auth: true,
      module: 'prescriptions',
    }),

  orderPharmacyFromPrescription: (body: {
    prescription_id: string;
    delivery_address?: string;
    customer_phone?: string;
  }) =>
    request<{ order_id: string; delivery_status?: string; order_total?: number }>(
      'create_pharmacy_order_from_prescription',
      {
        method: 'POST',
        body: {
          prescription_id: body.prescription_id,
          ...(body.delivery_address ? { delivery_address: body.delivery_address } : {}),
          ...(body.customer_phone ? { customer_phone: body.customer_phone } : {}),
        },
        auth: true,
        module: 'prescriptions',
      },
    ),

  orderDiagnosticsFromPrescription: (body: {
    prescription_id: string;
    franchisee_id: string;
    collection_address?: string;
    collection_slot?: string;
  }) =>
    request<{ trfs: Array<{ trf_id?: string }>; care_journey?: string }>(
      'order_diagnostics_from_prescription',
      {
        method: 'POST',
        body: {
          prescription_id: body.prescription_id,
          franchisee_id: body.franchisee_id,
          ...(body.collection_address ? { collection_address: body.collection_address } : {}),
          ...(body.collection_slot ? { collection_slot: body.collection_slot } : {}),
        },
        auth: true,
        module: 'diagnostics',
      },
    ),

  createPharmacyQuoteRequest: (body: Record<string, string | number>) =>
    request<{ order_id: string; delivery_status?: string; message?: string }>(
      'create_pharmacy_quote_request',
      {
        method: 'POST',
        body,
        auth: true,
      },
    ),

  getPharmacyQuoteQueue: (limit = 50) =>
    request<{ pending: PharmacyOrder[]; sent_recent: PharmacyOrder[]; pending_count: number; sent_count: number }>(
      'list_pharmacy_quote_queue',
      { body: { limit }, auth: true, module: 'pharmacyQuote' },
    ),

  sendPharmacyQuote: (body: {
    order_id: string;
    order_total: number;
    items_json: string;
    pharmacist_notes?: string;
  }) =>
    request<{ order_id: string; delivery_status: string; order_total: number }>('send_pharmacy_quote', {
      method: 'POST',
      body,
      auth: true,
      module: 'pharmacyQuote',
    }),

  getErxPharmacyQueue: (limit = 50) =>
    request<{
      pending: PharmacyOrder[];
      recent: PharmacyOrder[];
      summary: { pending_count: number; awaiting_payment: number };
    }>('list_erx_pharmacy_queue', {
      body: { limit },
      auth: true,
      module: 'erxFulfillment',
    }),

  updateErxPharmacyOrder: (body: {
    order_id: string;
    delivery_status: string;
    pharmacist_notes?: string;
    notify?: boolean;
  }) =>
    request<{ order: PharmacyOrder }>('update_erx_pharmacy_order', {
      method: 'POST',
      body: {
        order_id: body.order_id,
        delivery_status: body.delivery_status,
        ...(body.pharmacist_notes !== undefined ? { pharmacist_notes: body.pharmacist_notes } : {}),
        notify: body.notify === false ? 0 : 1,
      },
      auth: true,
      module: 'erxFulfillment',
    }),

  createPharmacyOrder: (body: Record<string, string | number>) =>
    request<Record<string, unknown>>('create_pharmacy_order', {
      method: 'POST',
      body,
      auth: true,
    }),

  validateCoupon: (promoCode: string, subtotal: number, context: 'pharmacy' | 'lab') =>
    request<CouponResult>('validate_coupon', {
      method: 'POST',
      body: { promo_code: promoCode, subtotal, context },
      auth: true,
    }),

  getHealthSubscriptionPlans: () =>
    request<{ plans: SubscriptionPlan[]; subscriptions_available: boolean }>(
      'get_health_subscription_plans',
      { method: 'POST', auth: false },
    ),

  getYogaSubscriptionPlans: () =>
    request<{ plans: SubscriptionPlan[]; wing: AlliedHealthWing; subscriptions_available: boolean }>(
      'get_yoga_subscription_plans',
      { method: 'POST', auth: false, module: 'yogaSubscriptions' },
    ),

  getMyYogaSubscription: () =>
    request<{ subscription: HealthSubscription | null }>('get_my_yoga_subscription', {
      method: 'POST',
      auth: true,
      module: 'yogaSubscriptions',
    }),

  getMyHealthSubscription: () =>
    request<{ subscription: HealthSubscription | null; entitlements: Record<string, unknown> }>(
      'get_my_health_subscription',
      { method: 'POST', auth: true },
    ),

  subscribeHealthPlan: (plan_code: string) =>
    request<{ subscription: HealthSubscription }>('subscribe_health_plan', {
      method: 'POST',
      body: { plan_code },
      auth: true,
    }),

  createSubscriptionCheckout: (plan_code: string) =>
    request<{
      subscription: HealthSubscription;
      reference_doctype: string;
      reference_name: string;
      amount: number;
    }>('create_subscription_checkout', {
      method: 'POST',
      body: { plan_code },
      auth: true,
    }),

  submitServiceProviderApplication: (body: {
    provider_type: 'Doctor' | 'Wellness';
    full_name: string;
    email: string;
    phone: string;
    gender?: string;
    qualification?: string;
    registration_number: string;
    speciality?: string;
    department?: string;
    wellness_wing?: string;
    consultation_fee?: number;
    supports_online?: boolean;
    supports_in_person?: boolean;
    clinic_address?: string;
    city?: string;
    bio?: string;
    schedule_proposal: ProviderScheduleInput[];
  }) =>
    request<{ application: ServiceProviderApplication }>('submit_service_provider_application', {
      method: 'POST',
      body: {
        provider_type: body.provider_type,
        full_name: body.full_name,
        email: body.email,
        phone: body.phone,
        ...(body.gender ? { gender: body.gender } : {}),
        ...(body.qualification ? { qualification: body.qualification } : {}),
        ...(body.registration_number ? { registration_number: body.registration_number } : {}),
        ...(body.speciality ? { speciality: body.speciality } : {}),
        ...(body.department ? { department: body.department } : {}),
        ...(body.wellness_wing ? { wellness_wing: body.wellness_wing } : {}),
        ...(body.consultation_fee != null ? { consultation_fee: body.consultation_fee } : {}),
        ...(body.supports_online != null ? { supports_online: body.supports_online } : {}),
        ...(body.supports_in_person != null ? { supports_in_person: body.supports_in_person } : {}),
        ...(body.clinic_address ? { clinic_address: body.clinic_address } : {}),
        ...(body.city ? { city: body.city } : {}),
        ...(body.bio ? { bio: body.bio } : {}),
        schedule_proposal: JSON.stringify(body.schedule_proposal),
      },
      auth: false,
      module: 'providerOnboarding',
    }),

  getMyProviderApplication: () =>
    request<{ application: ServiceProviderApplication | null }>('get_my_provider_application', {
      method: 'POST',
      auth: true,
      module: 'providerOnboarding',
    }),

  listProviderApplications: (status?: string, limit = 50) =>
    request<{ applications: ServiceProviderApplication[] }>('list_provider_applications', {
      method: 'POST',
      body: { ...(status ? { status } : {}), limit },
      auth: true,
      module: 'providerOnboarding',
    }),

  getProviderApplicationDetail: (applicationId: string) =>
    request<{ application: ProviderApplicationDetail }>('get_provider_application_detail', {
      method: 'POST',
      body: { application_id: applicationId },
      auth: true,
      module: 'opsQueues',
    }),

  reviewProviderApplication: (body: {
    application_id: string;
    action: 'approve' | 'reject';
    review_notes?: string;
  }) =>
    request<{ application: ServiceProviderApplication }>('review_provider_application', {
      method: 'POST',
      body: {
        application_id: body.application_id,
        action: body.action,
        ...(body.review_notes ? { review_notes: body.review_notes } : {}),
      },
      auth: true,
      module: 'providerOnboarding',
    }),

  getOpsHubSummary: () =>
    request<{
      provider_applications_pending: number;
      insurance_quotes_pending: number;
      teleconsults_upcoming: number;
    }>('get_ops_hub_summary', { method: 'POST', auth: true, module: 'opsQueues' }),

  listInsuranceQuoteQueue: (limit = 50) =>
    request<{ pending: InsuranceQuoteRequest[]; recent: InsuranceQuoteRequest[] }>(
      'list_insurance_quote_queue',
      { method: 'POST', body: { limit }, auth: true, module: 'opsQueues' },
    ),

  updateInsuranceQuoteRequest: (body: { request_id: string; status: string; notes?: string }) =>
    request<{ request: InsuranceQuoteRequest }>('update_insurance_quote_request', {
      method: 'POST',
      body: {
        request_id: body.request_id,
        status: body.status,
        ...(body.notes != null ? { notes: body.notes } : {}),
      },
      auth: true,
      module: 'opsQueues',
    }),

  listTeleconsultQueue: (days = 7, limit = 50) =>
    request<{ sessions: TeleconsultSession[] }>('list_teleconsult_queue', {
      method: 'POST',
      body: { days, limit },
      auth: true,
      module: 'opsQueues',
    }),

  getMyProviderPortal: () =>
    request<ProviderPortalPayload>('get_my_provider_portal', {
      method: 'POST',
      auth: true,
      module: 'providerPortal',
    }),

  updateMyProviderProfile: (body: { mobile?: string; email?: string; bio?: string }) =>
    request<{ profile: ProviderProfile }>('update_my_provider_profile', {
      method: 'POST',
      body,
      auth: true,
      module: 'providerPortal',
    }),

  saveMyScheduleSlot: (body: {
    slot_id?: string;
    day_of_week: string;
    from_time: string;
    to_time: string;
    slot_duration?: number;
    consultation_type?: string;
    department?: string;
    is_active?: boolean;
  }) =>
    request<{ slot: ProviderScheduleSlot }>('save_my_schedule_slot', {
      method: 'POST',
      body: {
        ...body,
        ...(body.is_active != null ? { is_active: body.is_active ? 1 : 0 } : {}),
      },
      auth: true,
      module: 'providerPortal',
    }),

  setMyScheduleSlotActive: (slotId: string, isActive: boolean) =>
    request<{ slot: ProviderScheduleSlot }>('set_my_schedule_slot_active', {
      method: 'POST',
      body: { slot_id: slotId, is_active: isActive ? 1 : 0 },
      auth: true,
      module: 'providerPortal',
    }),

  listConsultFollowupQueue: (limit = 50) =>
    request<{ sessions: TeleconsultSession[] }>('list_consult_followup_queue', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'completeCare',
    }),

  scheduleConsultFollowup: (body: {
    appointment_id: string;
    follow_up_date?: string;
    follow_up_notes?: string;
    book_slot?: boolean;
    appointment_time?: string;
  }) =>
    request<{ parent_appointment: string; follow_up_date?: string; follow_up_appointment?: string }>(
      'schedule_consult_followup',
      {
        method: 'POST',
        body: {
          appointment_id: body.appointment_id,
          ...(body.follow_up_date ? { follow_up_date: body.follow_up_date } : {}),
          ...(body.follow_up_notes ? { follow_up_notes: body.follow_up_notes } : {}),
          ...(body.book_slot != null ? { book_slot: body.book_slot ? 1 : 0 } : {}),
          ...(body.appointment_time ? { appointment_time: body.appointment_time } : {}),
        },
        auth: true,
        module: 'completeCare',
      },
    ),

  completeConsultationBilling: (appointmentId: string, completionNotes?: string) =>
    request<{
      appointment_id: string;
      status: string;
      sales_invoice?: string | null;
      amount?: number;
    }>('complete_consultation_billing', {
      method: 'POST',
      body: {
        appointment_id: appointmentId,
        ...(completionNotes ? { completion_notes: completionNotes } : {}),
      },
      auth: true,
      module: 'completeCare',
    }),

  previewConsultCheckout: (subtotal: number, promoCode?: string) =>
    request<CheckoutPricing>('preview_consult_checkout', {
      method: 'POST',
      body: { subtotal, ...(promoCode ? { promo_code: promoCode } : {}) },
      auth: true,
      module: 'completeCare',
    }),

  getInsuranceLanding: () =>
    request<{ products: InsuranceProduct[]; agent_note: string; categories: string[] }>(
      'get_insurance_landing',
      { method: 'POST', auth: false, module: 'insurance' },
    ),

  submitInsuranceQuoteRequest: (body: {
    product_code?: string;
    customer_name: string;
    phone: string;
    email?: string;
    sum_insured?: number;
    notes?: string;
  }) =>
    request<{ request_id: string; insurer?: string; product_name?: string }>(
      'submit_insurance_quote_request',
      {
        method: 'POST',
        body: {
          customer_name: body.customer_name,
          phone: body.phone,
          ...(body.product_code ? { product_code: body.product_code } : {}),
          ...(body.email ? { email: body.email } : {}),
          ...(body.sum_insured != null ? { sum_insured: body.sum_insured } : {}),
          ...(body.notes ? { notes: body.notes } : {}),
        },
        auth: true,
        module: 'insurance',
      },
    ),

  listPublishedJobOpenings: (body?: { search?: string; location?: string; limit?: number }) =>
    request<{ openings: JobOpeningSummary[]; count: number }>('list_published_job_openings', {
      method: 'POST',
      body: {
        ...(body?.search ? { search: body.search } : {}),
        ...(body?.location ? { location: body.location } : {}),
        ...(body?.limit != null ? { limit: body.limit } : {}),
      },
      auth: false,
      module: 'careers',
    }),

  getPublishedJobOpening: (jobOpening: string) =>
    request<JobOpeningSummary>('get_published_job_opening', {
      method: 'POST',
      body: { job_opening: jobOpening },
      auth: false,
      module: 'careers',
    }),

  submitJobApplication: (body: {
    job_opening: string;
    full_name: string;
    email: string;
    mobile: string;
    application_json: string;
    declaration_accepted: number;
    resume: string;
    photo?: string;
    aadhaar?: string;
    other_document?: string;
  }) =>
    request<{ application_id: string; job_opening: string; pipeline_stage: string }>(
      'submit_job_application',
      {
        method: 'POST',
        body,
        auth: false,
        module: 'careers',
      },
    ),

  listJobApplications: (body?: { job_opening?: string; stage?: string; source?: string; limit?: number }) =>
    request<{ applications: JobApplicationSummary[]; stages: string[] }>('list_job_applications', {
      method: 'POST',
      body: {
        ...(body?.job_opening ? { job_opening: body.job_opening } : {}),
        ...(body?.stage ? { stage: body.stage } : {}),
        ...(body?.source ? { source: body.source } : {}),
        ...(body?.limit != null ? { limit: body.limit } : {}),
      },
      auth: true,
      module: 'careers',
    }),

  getJobApplication: (application: string) =>
    request<JobApplicationDetail>('get_job_application', {
      method: 'POST',
      body: { application },
      auth: true,
      module: 'careers',
    }),

  updateApplicationStage: (body: { application: string; stage?: string; reject?: number }) =>
    request<{ application_id: string; pipeline_stage: string; status?: string }>(
      'update_application_stage',
      {
        method: 'POST',
        body: {
          application: body.application,
          ...(body.stage ? { stage: body.stage } : {}),
          ...(body.reject != null ? { reject: body.reject } : {}),
        },
        auth: true,
        module: 'careers',
      },
    ),

  getMyCareerHub: () =>
    request<{
      profile: Record<string, unknown>;
      applications: JobApplicationSummary[];
      claimed: number;
      user: string;
    }>('get_my_career_hub', { method: 'POST', auth: true, module: 'careers' }),

  updateMyCareerProfile: (profile: Record<string, unknown>) =>
    request<{ profile: Record<string, unknown> }>('update_my_career_profile', {
      method: 'POST',
      body: { profile_json: JSON.stringify(profile) },
      auth: true,
      module: 'careers',
    }),

  listMyApplications: (limit = 50) =>
    request<{ applications: JobApplicationSummary[] }>('list_my_applications', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'careers',
    }),

  getMyApplication: (application: string) =>
    request<JobApplicationDetail>('get_my_application', {
      method: 'POST',
      body: { application },
      auth: true,
      module: 'careers',
    }),

  listMyCareerDocuments: () =>
    request<{
      documents: Array<{ application: string; job_opening?: string; label: string; url: string }>;
    }>('list_my_career_documents', { method: 'POST', auth: true, module: 'careers' }),

  claimMyApplications: () =>
    request<{ claimed: number }>('claim_my_applications', {
      method: 'POST',
      auth: true,
      module: 'careers',
    }),

  getHiringMarketingDashboard: (body?: { from_date?: string; to_date?: string }) =>
    request<HiringMarketingDashboard>('get_hiring_marketing_dashboard', {
      method: 'POST',
      body: {
        ...(body?.from_date ? { from_date: body.from_date } : {}),
        ...(body?.to_date ? { to_date: body.to_date } : {}),
      },
      auth: true,
      module: 'hiringMarketing',
    }),

  listHiringCampaigns: () =>
    request<{ campaigns: HiringCampaignRow[] }>('list_hiring_campaigns', {
      method: 'POST',
      auth: true,
      module: 'hiringMarketing',
    }),

  listHiringLeads: (limit = 50) =>
    request<{ leads: HiringLeadRow[] }>('list_hiring_leads', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'hiringMarketing',
    }),

  getHiringAdsStatus: () =>
    request<{
      sync_enabled: boolean;
      meta_configured: boolean;
      google_configured: boolean;
      campaigns_from_ads: number;
      webhook: string;
    }>('hiring_ads_status', {
      method: 'POST',
      auth: true,
      module: 'hiringAdsSync',
    }),

  runHiringAdsSyncNow: () =>
    request<Record<string, unknown>>('run_hiring_ads_sync_now', {
      method: 'POST',
      auth: true,
      module: 'hiringAdsSync',
    }),

  importHiringCampaignsCsv: (csv_text: string) =>
    request<{ campaigns: string[]; count: number }>('import_campaigns_csv', {
      method: 'POST',
      body: { csv_text },
      auth: true,
      module: 'hiringAdsSync',
    }),

  importHiringLeadsCsv: (csv_text: string) =>
    request<{ count: number }>('import_leads_csv', {
      method: 'POST',
      body: { csv_text },
      auth: true,
      module: 'hiringAdsSync',
    }),

  getApplicationPipeline: (application: string) =>
    request<ApplicationPipelineBundle>('get_application_pipeline', {
      method: 'POST',
      body: { application },
      auth: true,
      module: 'hiringPipeline',
    }),

  scheduleInterview: (body: {
    application: string;
    scheduled_on: string;
    interview_type?: string;
    duration_minutes?: number;
    meeting_link?: string;
    location?: string;
    notes?: string;
  }) =>
    request<{ interview_id: string; pipeline_stage?: string | null }>('schedule_interview', {
      method: 'POST',
      body: {
        application: body.application,
        scheduled_on: body.scheduled_on,
        ...(body.interview_type ? { interview_type: body.interview_type } : {}),
        ...(body.duration_minutes != null ? { duration_minutes: body.duration_minutes } : {}),
        ...(body.meeting_link ? { meeting_link: body.meeting_link } : {}),
        ...(body.location ? { location: body.location } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
        move_to_interview: 1,
      },
      auth: true,
      module: 'hiringPipeline',
    }),

  updateInterviewStatus: (interview: string, status: string) =>
    request<{ interview_id: string; status: string }>('update_interview_status', {
      method: 'POST',
      body: { interview, status },
      auth: true,
      module: 'hiringPipeline',
    }),

  addApplicationNote: (application: string, content: string) =>
    request<{ note_id: string }>('add_application_note', {
      method: 'POST',
      body: { application, content, note_type: 'Note' },
      auth: true,
      module: 'hiringPipeline',
    }),

  createJobOffer: (body: {
    application: string;
    designation?: string;
    department?: string;
    joining_date?: string;
    salary_offered?: number;
    notes?: string;
    send?: number;
  }) =>
    request<{ offer_id: string; status: string; pipeline_stage: string }>('create_job_offer', {
      method: 'POST',
      body: {
        application: body.application,
        ...(body.designation ? { designation: body.designation } : {}),
        ...(body.department ? { department: body.department } : {}),
        ...(body.joining_date ? { joining_date: body.joining_date } : {}),
        ...(body.salary_offered != null ? { salary_offered: body.salary_offered } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
        send: body.send ?? 1,
      },
      auth: true,
      module: 'hiringPipeline',
    }),

  startApplicantOnboarding: (application: string, employee?: string) =>
    request<{ pipeline_stage: string; todos: string[] }>('start_applicant_onboarding', {
      method: 'POST',
      body: {
        application,
        ...(employee ? { employee } : {}),
      },
      auth: true,
      module: 'hiringPipeline',
    }),

  getCircleLanding: () =>
    request<CircleLandingPayload>('get_circle_landing', { method: 'POST', auth: true }),

  previewCheckoutPrice: (
    subtotal: number,
    context: 'pharmacy' | 'lab' | 'consult',
    promoCode?: string,
    useWallet?: boolean,
  ) =>
    request<CheckoutPricing>('preview_checkout_price', {
      method: 'POST',
      body: {
        subtotal,
        context,
        ...(promoCode ? { promo_code: promoCode } : {}),
        ...(useWallet ? { use_wallet: 1 } : {}),
      },
      auth: true,
    }),

  getB2bPortal: () =>
    request<B2bPortalPayload>('get_b2b_portal', { method: 'POST', auth: true }),

  getB2bCatalog: () =>
    request<{ items: B2bCatalogItem[]; franchisee_id: string }>('get_b2b_catalog', {
      method: 'POST',
      auth: true,
    }),

  getB2bStatements: () =>
    request<{ lines: B2bStatementLine[]; summary: Record<string, number> }>(
      'get_b2b_statements',
      { method: 'POST', auth: true },
    ),

  getB2bWallet: () =>
    request<B2bWalletPayload>('get_b2b_wallet', { method: 'POST', auth: true }),

  createB2bWalletRazorpayOrder: (body: { amount: number | string }) =>
    request<RazorpayOrder & { franchisee_id?: string }>('create_b2b_wallet_razorpay_order', {
      method: 'POST',
      body,
      auth: true,
    }),

  verifyB2bWalletRazorpayPayment: (body: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) =>
    request<{
      transaction_id: string;
      amount: number;
      wallet_balance: number;
      already_credited?: boolean;
    }>('verify_b2b_wallet_razorpay_payment', { method: 'POST', body, auth: true }),

  rechargeB2bWallet: (body: { amount: string; payment_reference?: string }) =>
    request<{ transaction_id: string; amount: number; wallet_balance: number }>(
      'recharge_b2b_wallet',
      { method: 'POST', body, auth: true },
    ),

  createB2bWalkInOrder: (body: Record<string, string>) =>
    request<{
      trf_id: string;
      barcode: string;
      retail_amount: number;
      wholesale_amount: number;
      margin: number;
      wallet_balance: number;
      wallet_transaction?: string;
    }>('create_b2b_walk_in_order', { method: 'POST', body, auth: true }),

  getLabReagentDashboard: () =>
    request<LabReagentDashboard>('get_lab_reagent_dashboard', { method: 'POST', auth: true }),

  getSalesPortal: () =>
    request<SalesPortalPayload>('get_sales_portal', { method: 'POST', auth: true }),

  getSalesLeads: (limit = 50) =>
    request<{ leads: SalesLead[] }>('get_sales_leads', { method: 'POST', body: { limit }, auth: true }),

  createSalesLead: (body: Record<string, string | number>) =>
    request<{ lead_id: string }>('create_sales_lead', { method: 'POST', body, auth: true }),

  logSalesVisit: (body: Record<string, string | number>) =>
    request<{ visit_id: string }>('log_sales_visit', { method: 'POST', body, auth: true }),

  getSalesVisits: (limit = 50) =>
    request<{ visits: SalesVisit[] }>('get_sales_visits', { method: 'POST', body: { limit }, auth: true }),

  submitSalesOnboarding: (body: Record<string, string | number>) =>
    request<{ onboarding_id: string; franchisee_id: string }>('submit_sales_onboarding', {
      method: 'POST',
      body,
      auth: true,
    }),

  createOnboardingSession: (body: { franchisee_id: string; lead_id?: string; ttl_seconds?: number }) =>
    request<{
      session_id: string;
      token: string;
      url: string;
      expires_at: number;
      franchisee_id: string;
    }>('create_onboarding_session', { method: 'POST', body, auth: true }),

  getSalesFranchiseeStats: (period?: 'month' | 'all') =>
    request<SalesFranchiseeStats>('get_sales_franchisee_stats', {
      method: 'POST',
      body: period ? { period } : {},
      auth: true,
    }),

  getSalesCatalog: () =>
    request<SalesCatalogPayload>('get_sales_catalog', { method: 'POST', auth: true }),

  getSalesCommissions: (limit = 50, status?: string) =>
    request<SalesCommissionPayload>('get_sales_commissions', {
      method: 'POST',
      auth: true,
      body: status ? { limit, status } : { limit },
    }),

  getSalesClosingReports: (limit = 30) =>
    request<{ reports: SalesClosingReport[] }>('get_sales_closing_reports', {
      method: 'POST',
      body: { limit },
      auth: true,
    }),

  draftSalesClosingReport: (reportType: 'Daily' | 'Monthly', periodDate?: string) =>
    request<Record<string, string | number>>('draft_sales_closing_report', {
      method: 'POST',
      body: periodDate
        ? { report_type: reportType, period_date: periodDate }
        : { report_type: reportType },
      auth: true,
    }),

  submitSalesClosingReport: (body: Record<string, string | number>) =>
    request<{ report_id: string }>('submit_sales_closing_report', { method: 'POST', body, auth: true }),

  updateSalesRepLocation: (latitude: number, longitude: number, onDuty = true) =>
    request<{ rep_id: string; latitude: number; longitude: number }>('sales_rep_update_location', {
      method: 'POST',
      body: { latitude, longitude, on_duty: onDuty ? 1 : 0 },
      auth: true,
    }),

  getSalesTeamMap: () =>
    request<SalesTeamMapData>('get_sales_team_map', { method: 'POST', auth: true }),

  registerLabReagentBatch: (body: {
    reagent_item: string;
    lot_number: string;
    tests_per_pack: string;
    expiry_date?: string;
    franchisee_id?: string;
    remarks?: string;
  }) =>
    request<LabReagentBatch>('register_lab_reagent_batch', { method: 'POST', body, auth: true }),

  openLabReagentBatch: (batchId: string) =>
    request<LabReagentBatch>('open_lab_reagent_batch', {
      method: 'POST',
      body: { batch_id: batchId },
      auth: true,
    }),

  submitLotVerification: (body: {
    new_batch: string;
    old_batch?: string;
    assay_type?: string;
    outcome?: string;
    notes?: string;
  }) =>
    request<{ lot_verification: string; verification_status: string; batch: string }>(
      'submit_lot_verification',
      { method: 'POST', body, auth: true, module: 'nabl112b' },
    ),

  recordSampleRejection: (body: {
    customer_trf: string;
    reason: string;
    action_taken?: string;
    notes?: string;
    lab_report?: string;
  }) =>
    request<{ rejection: string; action_taken: string }>('record_sample_rejection', {
      method: 'POST',
      body,
      auth: true,
      module: 'nabl112b',
    }),

  recordSampleTransport: (body: {
    customer_trf: string;
    pack_temp_setpoint_c?: number | string;
    logger_min_c?: number | string;
    logger_max_c?: number | string;
    temp_acceptable?: number;
    remarks?: string;
  }) =>
    request<{ transport_log: string; temp_acceptable: number }>('record_sample_transport', {
      method: 'POST',
      body,
      auth: true,
      module: 'nabl112b',
    }),

  evaluateLabReportGates: (labReport: string) =>
    request<{ auto_verified: number; holds: string[]; disciplines: string[] }>(
      'evaluate_lab_report_gates',
      { method: 'POST', body: { lab_report: labReport }, auth: true, module: 'nabl112b' },
    ),

  getQcDashboard: () =>
    request<QcDashboard>('get_qc_dashboard', { method: 'POST', auth: true, module: 'nablQc' }),

  submitIqcRun: (body: {
    analyte_code: string;
    analyte_name?: string;
    qc_level?: string;
    result_value: string | number;
    equipment?: string;
    lab_mean?: string | number;
    lab_sd?: string | number;
    control_lot?: string;
    shift?: string;
    notes?: string;
  }) =>
    request<{ iqc_run: string; outcome: string; z_score?: number | null }>('submit_iqc_run', {
      method: 'POST',
      body,
      auth: true,
      module: 'nablQc',
    }),

  getIqcLjChart: (params: { analyte_code: string; qc_level?: string; limit?: number }) =>
    request<{
      analyte_code: string;
      qc_level: string;
      points: Array<{ run_date: string; result_value: number; outcome?: string; name?: string }>;
      stats: { mean?: number; sd?: number; cv_percent?: number };
    }>('get_iqc_lj_chart', { method: 'POST', body: params, auth: true, module: 'nablQc' }),

  getQmsDashboard: () =>
    request<QmsDashboard>('get_qms_dashboard', { method: 'POST', auth: true, module: 'nablQms' }),

  createCapa: (body: {
    title: string;
    nonconformity_description: string;
    source?: string;
    severity?: string;
    root_cause?: string;
    corrective_action?: string;
    linked_complaint?: string;
    due_date?: string;
  }) =>
    request<{ capa: string }>('create_capa', { method: 'POST', body, auth: true, module: 'nablQms' }),

  submitLabComplaint: (body: {
    subject: string;
    description: string;
    contact_name?: string;
    contact_phone?: string;
    contact_email?: string;
    source?: string;
    patient?: string;
  }) =>
    request<{ complaint: string; ack_id: string; status: string }>('submit_lab_complaint', {
      method: 'POST',
      body,
      auth: false,
      module: 'nablQms',
    }),

  updateComplaintStatus: (body: {
    complaint: string;
    status: string;
    reply_summary?: string;
    investigation_notes?: string;
  }) =>
    request<{ complaint: string; status: string }>('update_complaint_status', {
      method: 'POST',
      body,
      auth: true,
      module: 'nablQms',
    }),

  getTelephonyDashboard: () =>
    request<TelephonyDashboard>('get_telephony_dashboard', {
      method: 'POST',
      auth: true,
      module: 'telephony',
    }),

  registerPatient: (body: {
    email: string;
    password: string;
    full_name: string;
    mobile?: string;
    referral_code?: string;
  }) =>
    request<{ email: string; verification_sent: boolean }>('register_patient', {
      method: 'POST',
      body,
      auth: false,
      module: 'email',
    }),

  getPatientProfile: () =>
    request<Record<string, unknown>>('get_patient_profile', {
      method: 'POST',
      auth: true,
    }),

  getPatientWallet: (limit?: number) =>
    request<Record<string, unknown>>('get_patient_wallet', {
      method: 'POST',
      body: limit ? { limit } : {},
      auth: true,
    }),

  getMyReferral: () =>
    request<{
      linked?: boolean;
      referral_code?: string;
      wallet_balance?: number;
      referred_count?: number;
      share_text?: string;
      share_url?: string;
      signup_credit?: number;
      first_order_bonus?: number;
    }>('get_my_referral', {
      method: 'POST',
      auth: true,
    }),

  updatePatientProfile: (body: {
    patient_name?: string;
    mobile?: string;
    email?: string;
    dob?: string;
    gender?: string;
    profile_image?: string;
    profile_image_filename?: string;
    new_password?: string;
  }) =>
    request<Record<string, unknown>>('update_patient_profile', {
      method: 'POST',
      body,
      auth: true,
    }),

  applyPatientWalletCredit: (body: {
    reference_doctype: string;
    reference_name: string;
    amount: number;
  }) =>
    request<Record<string, unknown>>('apply_patient_wallet_credit', {
      method: 'POST',
      body,
      auth: true,
    }),

  verifyEmail: (token: string) =>
    request<{ email: string; verified: boolean }>('verify_email', {
      method: 'POST',
      body: { token },
      auth: false,
      module: 'email',
    }),

  resendVerificationEmail: (email: string) =>
    request<Record<string, never>>('resend_verification_email', {
      method: 'POST',
      body: { email },
      auth: false,
      module: 'email',
    }),

  forgotPassword: (email: string) =>
    request<Record<string, never>>('forgot_password_email', {
      method: 'POST',
      body: { email },
      auth: false,
      module: 'email',
    }),

  bookLabTest: (body: Record<string, string | number>) =>
    request<Record<string, unknown>>('book_lab_test', { method: 'POST', body, auth: true }),

  bookLabPanel: (body: Record<string, string | number>) =>
    request<Record<string, unknown>>('book_lab_panel', {
      method: 'POST',
      body,
      auth: true,
      module: 'diagnostics',
    }),

  getJourneyOpsBoard: (limit = 200) =>
    request<JourneyOpsBoard>('get_journey_ops_board', {
      body: { limit },
      auth: true,
      module: 'journeyOps',
    }),

  journeyTransition: (body: {
    journey_id: string;
    to_status: string;
    phlebotomist?: string;
    notes?: string;
  }) =>
    request<{ journey: CareJourney }>('journey_transition', {
      method: 'POST',
      body,
      auth: true,
      module: 'journeyOps',
    }),

  listActivePhlebotomists: () =>
    request<{ phlebotomists: Array<{ user: string; full_name: string }> }>(
      'list_active_phlebotomists',
      { auth: true, module: 'journeyOps' },
    ),

  getJourneyActivity: (journeyId: string) =>
    request<{ activity: JourneyActivity[] }>('get_journey_activity', {
      body: { journey_id: journeyId },
      auth: true,
      module: 'journeyOps',
    }),

  // --- Phase 36: lab report result entry + pathologist authorization ---
  getLabReportQueue: (limit = 200) =>
    request<LabReportQueue>('list_lab_report_queue', {
      body: { limit },
      auth: true,
      module: 'labReport',
    }),

  getLabReportDetail: (params: { lab_report?: string; trf_id?: string }) =>
    request<LabReportDetail>('get_lab_report_detail', {
      method: 'POST',
      body: {
        ...(params.lab_report ? { lab_report: params.lab_report } : {}),
        ...(params.trf_id ? { trf_id: params.trf_id } : {}),
      },
      auth: true,
      module: 'labReport',
    }),

  saveLabReportParameters: (labReport: string, parameters: LabReportParamEdit[]) =>
    request<LabReportDetail>('save_lab_report_parameters', {
      method: 'POST',
      body: { lab_report: labReport, parameters: JSON.stringify(parameters) },
      auth: true,
      module: 'labReport',
    }),

  importMachineResults: (labReport: string) =>
    request<{ lab_report: string; imported: number }>('import_machine_results_to_report', {
      method: 'POST',
      body: { lab_report: labReport },
      auth: true,
      module: 'labReport',
    }),

  reloadLabReportParameters: (labReport: string) =>
    request<{ lab_report: string; parameters: number }>('reload_lab_report_parameters', {
      method: 'POST',
      body: { lab_report: labReport },
      auth: true,
      module: 'labReport',
    }),

  recalculateLabReport: (labReport: string) =>
    request<{ lab_report: string }>('recalculate_lab_report', {
      method: 'POST',
      body: { lab_report: labReport },
      auth: true,
      module: 'labReport',
    }),

  finalizeLabReport: (labReport: string) =>
    request<{ lab_report: string; trf_id: string; journey_id?: string; complete: boolean }>(
      'finalize_lab_report',
      {
        method: 'POST',
        body: { lab_report: labReport },
        auth: true,
        module: 'labReport',
      },
    ),

  getLabReportPreviewHtml: (labReport: string) =>
    fetchRawMessage('get_lab_report_preview_html', { lab_report: labReport }, 'labReport'),

  authorizeLabReport: (body: { journey_id: string; pathologist_notes?: string }) =>
    request<{ journey: CareJourney }>('authorize_lab_report', {
      method: 'POST',
      body: {
        journey_id: body.journey_id,
        ...(body.pathologist_notes ? { pathologist_notes: body.pathologist_notes } : {}),
      },
      auth: true,
      module: 'journey',
    }),

  dispatchJourneyReport: (journeyId: string) =>
    request<{ journey: CareJourney }>('dispatch_journey_report', {
      method: 'POST',
      body: { journey_id: journeyId },
      auth: true,
      module: 'journey',
    }),

  getReportLifecycleQueue: (limit = 50) =>
    request<ReportLifecycleQueue>('get_report_lifecycle_queue', {
      body: { limit },
      auth: true,
      module: 'reportLifecycle',
    }),

  // --- Phase 39: Franchisee KPI dashboard ---
  getFranchiseeKpis: (params: { period?: string; franchisee_id?: string } = {}) =>
    request<FranchiseeKpiResponse>('get_franchisee_kpis', {
      body: {
        period: params.period || '30d',
        ...(params.franchisee_id ? { franchisee_id: params.franchisee_id } : {}),
      },
      auth: true,
      module: 'franchiseeKpi',
    }),

  getStaffGamificationDashboard: (limit = 10) =>
    request<StaffGamificationResponse>('get_staff_gamification_dashboard', {
      body: { limit },
      auth: true,
      module: 'gamification',
    }),

  getExecutiveAnalytics: (params: { period?: string } = {}) =>
    request<ExecutiveAnalyticsResponse>('get_executive_analytics', {
      body: { period: params.period || '30d' },
      auth: true,
      module: 'executiveAnalytics',
    }),

  getCriticalAlertsQueue: (params: { status?: string; limit?: number } = {}) =>
    request<CriticalAlertsResponse>('get_critical_alerts_queue', {
      body: { status: params.status || 'Open', limit: params.limit || 50 },
      auth: true,
      module: 'criticalAlerts',
    }),

  acknowledgeCriticalAlert: (alert_name: string) =>
    request<{ name: string; alert_status: string }>('acknowledge_critical_alert', {
      body: { alert_name },
      auth: true,
      module: 'criticalAlerts',
    }),

  updateFranchiseeCommissionSettings: (params: {
    commission_base?: 'Franchisee Rate' | 'MRP';
    franchisee_type?: 'Vector' | 'Pulse';
    franchisee_id?: string;
  }) =>
    request<{
      franchisee_id: string;
      franchisee_type: string;
      commission_base: string;
      retail_price_list?: string;
      wholesale_price_list?: string;
      commission_percentage_rate?: number;
    }>('update_franchisee_commission_settings', {
      body: params,
      auth: true,
      module: 'franchiseeRates',
    }),
};

/** List journeys; falls back to get_patient_journey when server lacks list_patient_journeys. */
export async function loadPatientJourneys(limit = 20): Promise<CareJourney[]> {
  try {
    const res = await api.listPatientJourneys(limit);
    return res.data.journeys || [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('list_patient_journeys') && !msg.includes('has no attribute')) {
      throw err;
    }
    const single = await api.getPatientJourney();
    const journey = single.data.journey;
    return journey ? [journey] : [];
  }
}

export function itemRate(item: CatalogItem) {
  return item.rate ?? item.standard_rate ?? 0;
}

export function itemMrp(item: CatalogItem) {
  const mrp = item.mrp ?? 0;
  const rate = itemRate(item);
  return mrp > rate ? mrp : rate;
}

export function itemDiscountPercent(item: CatalogItem) {
  if (item.discount_percent && item.discount_percent > 0) return item.discount_percent;
  const rate = itemRate(item);
  const mrp = item.mrp ?? 0;
  if (mrp > rate && mrp > 0) return Math.round((1 - rate / mrp) * 100);
  return 0;
}

export function franchiseeLabel(f: Franchisee) {
  const parts = [f.franchise_name, f.branch_code, f.territory_region].filter(Boolean);
  return parts.join(' · ');
}

/** @deprecated use useAuth() */
export function getSessionCookie() {
  return loadSession()?.sid ? `sid=${loadSession()!.sid}` : null;
}
