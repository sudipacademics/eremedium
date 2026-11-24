import { clearStoredSession, getSid, loadSession, saveSession } from './auth/session';
import { apiUrl, ApiModule, rfmsApiUrl } from './config';
import { isB2bPortalHost, isVaultHost } from './config/portalHosts';

const isVaultLogin = () =>
  isVaultHost() || (typeof window !== 'undefined' && (window.location.pathname === '/vault' || window.location.pathname.startsWith('/vault/')));
import { CareJourney, JourneyOpsBoard, JourneyActivity } from './types/journey';
import {
  CommentPresetRow,
  LabReportDetail,
  LabReportParamEdit,
  LabReportQueue,
} from './types/labReport';
import { PathologistQueue } from './types/pathologist';
import { PatientAuthorizedReport, ReportChromeTemplate, ReportLifecycleQueue, ReportWhatsAppResult } from './types/reportLifecycle';

export type LabtechSettingsPayload = {
  can_manage: boolean;
  reporting_pad: {
    identity: Record<string, string | number>;
    images: Record<string, { field: string; label: string; url: string }>;
    source?: string;
  };
  whatsapp: {
    ready: boolean;
    provider: string;
    phone_number_id: string;
    sender_number: string;
    token_configured: boolean;
    hint: string;
    report_enabled: number;
    report_message: string;
  };
  department_defaults: Array<{
    key: string;
    label: string;
    role?: string;
    name: string;
    qualification: string;
    signature_url?: string;
  }>;
  pathologists: Array<{
    employee: string;
    name: string;
    user?: string;
    designation?: string;
    department?: string;
    photo?: string;
    signature_url?: string;
  }>;
};
import { AllBookingsQuery, AllBookingsResponse, BookingLifecycleDetail } from './types/bookingLifecycle';
import type {
  InvAllocation,
  InvCompanyUnit,
  InvDashboard,
  InvDispatch,
  InvDispatchFilters,
  InvDispatchPayload,
  InvExportFile,
  InvExportKind,
  InvFranchiseUnit,
  InvHistoryFilters,
  InvItemDetail,
  InvItemFilters,
  InvItemList,
  InvMyRequestsPayload,
  InvPage,
  InvStockUnit,
  InvUnitItemDetail,
  InvUnitStockFilters,
  InvUnitStockList,
  InvUnitTxn,
  InvPartnerPayload,
  InvReports,
  InvRequestPayload,
  InvRequisition,
  InvRequisitionFilters,
  InvRequisitionList,
  InvTransactionList,
} from './types/labInventory';
import { FranchiseeKpiResponse } from './types/franchiseeKpi';
import type {
  AddDependantPayload,
  ApiClientRow,
  ApiClientSecret,
  CustodyChain,
  FieldProvider,
  HandoffSession,
  IamMe,
  LabelFormat,
  LabelOutput,
  PatientProfile,
  PayoutRow,
} from './types/foundations';
import { StaffGamificationResponse } from './types/gamification';
import { CriticalAlertsResponse, ExecutiveAnalyticsResponse } from './types/executiveAnalytics';
import type {
  PfAccount,
  PfApproveItem,
  PfBarcodeCheck,
  PfBarcodeRow,
  PfBindResult,
  PfCreateRequestPayload,
  PfEarnings,
  PfHub,
  PfJobBoard,
  PfJobDetail,
  PfKitRow,
  PfLabInbox,
  PfLabSettings,
  PfMe,
  PfMyJobs,
  PfMyRequests,
  PfOcrResult,
  PfOpenJobs,
  PfRequestDetail,
  PfRiderRow,
  PfTestHit,
  PfTube,
} from './types/phlebofirst';
import type {
  TpAccessionResult,
  TpAuthSession,
  TpBoardFilters,
  TpCreateManifestPayload,
  TpCustodyChain,
  TpDestinationScanPayload,
  TpDestinationScanResult,
  TpIcebox,
  TpIceboxFilters,
  TpLab,
  TpLookupKind,
  TpLookupRow,
  TpManifest,
  TpManifestSamplesResult,
  TpMapping,
  TpMappingSavePayload,
  TpMe,
  TpMyPoint,
  TpOriginScanPayload,
  TpOriginScanResult,
  TpParty,
  TpPartyFilters,
  TpPartyKind,
  TpPartySavePayload,
  TpPaymentMode,
  TpRunner,
  TpRunnerBadge,
  TpRunnerToday,
  TpSignupPayload,
  TpSignupResult,
  TpSubscription,
  TpSubscriptionSavePayload,
  TpTatReport,
  TpTier,
} from './types/teleporter';
import type {
  UdAuthSession,
  UdAvailability,
  UdBooking,
  UdBookingFilters,
  UdBookingRow,
  UdBookPayload,
  UdCalendar,
  UdClinic,
  UdClinicAction,
  UdClinicSignupPayload,
  UdConfig,
  UdCredentialType,
  UdEmrRecord,
  UdEnrollment,
  UdFileOut,
  UdIcdRow,
  UdIcdSearch,
  UdJoin,
  UdMe,
  UdMedRow,
  UdMeta,
  UdOfflineMode,
  UdOpsOverview,
  UdApplicationRow,
  UdPayKind,
  UdPayOrder,
  UdProgram,
  UdProgramAction,
  UdProgramCard,
  UdProgramPayload,
  UdProgramPick,
  UdProvider,
  UdProviderAction,
  UdProviderCard,
  UdProviderDashboard,
  UdProviderProfilePayload,
  UdProviderPublic,
  UdProviderSignupPayload,
  UdRate,
  UdRulePayload,
  UdRx,
  UdRxListRow,
  UdRxSavePayload,
  UdSettlement,
  UdSettlementAction,
  UdShiftPayload,
  UdSignupResult,
  UdSlots,
  UdTestRow,
  UdVerify,
  UdWebhookDelivery,
  UdWebhookList,
} from './types/uberdoc';
import type {
  VaultAdherence,
  VaultCard,
  VaultChecklist,
  VaultExport,
  VaultFile,
  VaultGoal,
  VaultGoalPayload,
  VaultHome,
  VaultLookupRow,
  VaultMe,
  VaultMedications,
  VaultMeta,
  VaultOtpLoginResult,
  VaultProfile,
  VaultProfileDetail,
  VaultProfilePayload,
  VaultPublicCard,
  VaultRecord,
  VaultRegisterPayload,
  VaultRegisterResult,
  VaultRoutine,
  VaultRxRow,
  VaultSchedule,
  VaultSettingsPayload,
  VaultTimeline,
  VaultTimelineFilters,
  VaultTip,
  VaultTrend,
  VaultTrendItem,
  VaultUploadPayload,
} from './types/vault';

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

export type TrainingFile = {
  file_name?: string;
  file_url?: string;
  file_size?: number;
  file_type?: string;
  kind?: string;
};

export type TrainingEventRow = {
  name: string;
  event_name?: string;
  event_status?: string;
  start_time?: string;
  end_time?: string;
  type?: string;
  introduction?: string;
  training_program?: string;
  attendance?: string;
  participant_status?: string;
  files?: TrainingFile[];
};

export type TrainingProgramRow = {
  name: string;
  training_program?: string;
  description?: string;
  status?: string;
  files?: TrainingFile[];
};

export type HrPolicySnippet = {
  name: string;
  slug: string;
  body?: string;
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
  training_programs: TrainingProgramRow[];
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
  policies?: HrPolicySnippet[];
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
  mrp?: number;
  foco_rate?: number;
  platform_fee?: number;
  commission_value?: number;
  show_mrp_slash?: boolean;
  price_basis?: string;
  patient_rate_label?: string;
  sample_type?: string;
  sample_requirement_label?: string;
  collection_tubes?: CollectionTubeRow[];
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
  credit_limit?: number;
  available_to_bill?: number;
  franchisee_type?: string;
  min_recharge: number;
  transactions: B2bWalletTransaction[];
  razorpay_recharge_enabled?: boolean;
  pending_fofo_earnings?: number;
  profit_from_centre?: number;
  topup_requests?: B2bWalletTopupRequest[];
};

export type PartnerTier = 'FOCO' | 'Master FOCO' | 'Orange FOCO';

export type PartnerCircuit = {
  franchisee?: string | null;
  franchise_name?: string;
  tier?: PartnerTier | null;
  has_lab?: boolean;
  master_foco?: string | null;
  master_foco_name?: string | null;
  lab?: string | null;
  lab_name?: string | null;
  services?: { phlebotomy: boolean; lr_logistics: boolean; lab_team: boolean };
  circuit_mapped_on?: string | null;
  vector_entry?: VectorEntry | null;
  bill_to_vectors?: VectorOption[];
};

export type VectorEntry = {
  vector: string;
  vector_name?: string;
  entry_partner: string;
  entry_name?: string;
  entry_tier: PartnerTier;
  entry_has_lab?: boolean;
};

export type VectorOption = { id: string; name: string; branch_code?: string | null };

export type PartnerVectorBill = {
  id: string;
  trf: string;
  vector: string;
  vector_name?: string;
  entry_partner: string;
  entry_name?: string;
  entry_tier?: string;
  amount: number;
  tests?: string | null;
  patient_name?: string | null;
  billed_by?: string | null;
  status: 'Unsettled' | 'Settled' | 'Cancelled' | string;
  settled_on?: string | null;
  created: string;
};

export type PartnerPricingKey =
  | 'foco_billing'
  | 'foco_fee'
  | 'mf_billing'
  | 'mf_fee'
  | 'orange_billing'
  | 'orange_fee'
  | 'mrp';

export type PartnerPricingRow = {
  item_code: string;
  item_name: string;
  category: string;
  on_circuit: boolean;
  status?: 'On' | 'Incomplete' | 'Off';
} & Record<PartnerPricingKey, number | null>;

export type PartnerPricingRowInput = { item_code: string } & Partial<Record<PartnerPricingKey, number | string | null>>;

export type PartnerPricingChart = {
  rows: PartnerPricingRow[];
  columns: Array<{ key: PartnerPricingKey; tier: string | null; field: string; label: string }>;
  mrp_price_list: string;
  on_circuit: number;
  incomplete?: number;
  total: number;
};

export type PartnerPricingImportReport = {
  ok: boolean;
  dry_run: boolean;
  rows: number;
  updated: number;
  unchanged: number;
  errors: Array<{ row: number; item_code: string; error: string }>;
};

export type PartnerVectorBillTotals = { unsettled: number; settled_month: number; count_unsettled: number };

export type PartnerVectorBillsPayload = {
  vector_entry?: VectorEntry | null;
  receivable: PartnerVectorBill[];
  payable: PartnerVectorBill[];
  receivable_totals: PartnerVectorBillTotals;
  payable_totals: PartnerVectorBillTotals;
};

export type PartnerEarningsBill = {
  trf: string;
  channel?: string | null;
  created: string;
  billed_by_me: boolean;
  tests: string;
  debit: number;
  mf_share: number;
  mf_status?: string | null;
  mf_beneficiary?: string | null;
  lab_share: number;
  lab_status?: string | null;
  lab_beneficiary?: string | null;
};

export type PartnerEarningsPayload = {
  circuit: PartnerCircuit;
  kpis: {
    pending_mf: number;
    pending_lab: number;
    credited_month: number;
    debited_month: number;
    bills_month: number;
  };
  bills: PartnerEarningsBill[];
  wallet_balance: number;
};

export type PartnerAccessionSample = {
  trf: string;
  patient_name?: string | null;
  order_status?: string | null;
  billed_by?: string | null;
  billed_by_name?: string | null;
  tests: string;
  created: string;
  via_vector?: string | null;
  via_vector_name?: string | null;
};

export type PartnerShipment = {
  id: string;
  shipper: string;
  shipper_name?: string | null;
  to_lab?: string | null;
  to_lab_name?: string | null;
  status: 'Shipped' | 'Delivered' | 'Cancelled' | string;
  lr_number?: string | null;
  courier?: string | null;
  icebox_temp_c?: number | null;
  shipped_on?: string | null;
  delivered_on?: string | null;
  sample_count: number;
  samples: Array<{ trf: string; patient_name?: string | null; tests?: string | null; from_partner?: string | null }>;
};

export type PartnerShipmentsPayload = {
  circuit: PartnerCircuit;
  can_ship: boolean;
  pending: PartnerAccessionSample[];
  outgoing: PartnerShipment[];
  incoming: PartnerShipment[];
};

export type PartnerTierPreview = {
  tier?: PartnerTier | string | null;
  applied: boolean;
  deposit_adjustment: number;
  master_foco_name?: string | null;
  lab_name?: string | null;
  vector?: boolean;
  b2b_amount?: number;
  entry_name?: string | null;
  entry_tier?: PartnerTier | null;
};

export type B2bWalletTopupRequest = {
  name: string;
  amount: number;
  payment_reference: string;
  payment_mode?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  creation?: string;
  review_remarks?: string;
};

export type PaymentCoreStatus = {
  company: string;
  providers: Record<string, string>;
  icici_available: boolean;
  webhook_configured: boolean;
  bank_account?: string;
  intents: Record<string, number>;
  wallet_books?: { wallets?: number; ledger?: number; difference?: number; opening_booked?: boolean };
  patient_wallet_books?: { wallets?: number; ledger?: number; difference?: number };
};

export type BankMatchSuggestion = {
  voucher_type: string;
  voucher_name: string;
  amount: number;
  label: string;
  confidence: 'reference' | 'amount_date' | 'approve_first';
};

export type BankStatementLine = {
  name: string;
  date: string;
  deposit: number;
  withdrawal: number;
  description?: string;
  reference_number?: string;
  unallocated_amount?: number;
  status: string;
  suggestions: BankMatchSuggestion[];
  settlement_hint?: boolean;
};

export type CollectionMode = 'cash' | 'upi' | 'card' | 'cheque';

export type ReconStatementType = 'upi' | 'cheque';

export type ReconSuggestion = {
  voucher_type: string;
  voucher_name: string;
  amount: number;
  label: string;
  confidence: 'reference' | 'amount_date' | 'approve_first';
  posting_date?: string;
  amount_differs?: boolean;
};

export type ReconLine = {
  name: string;
  txn_date: string;
  amount: number;
  reference: string;
  counterparty?: string;
  report_status?: string;
  settlement_date?: string;
  recon_status: 'Unmatched' | 'Matched' | 'Returned' | 'Ignored';
  matched_doctype?: string;
  matched_name?: string;
  matched_via?: string;
  suggestions: ReconSuggestion[];
};

export type ReconBookItem = {
  voucher_type: string;
  voucher_name: string;
  date: string;
  amount: number;
  label: string;
  collected_by?: string | null;
  age_days?: number;
};

export type ReconReport = {
  statement_type: string;
  from_date: string;
  to_date: string;
  lines: ReconLine[];
  counts: Record<string, { count: number; amount: number }>;
  books_not_in_report: ReconBookItem[];
};

export type CashInHand = {
  cash_account: string;
  since: string;
  items: ReconBookItem[];
  total: number;
  deposits: { journal_entry: string; date: string; amount: number; slip_no: string; in_bank_statement: boolean; remark?: string }[];
};

export type BankBookingAccounts = {
  accounts: { name: string; root_type: string }[];
  bank_charges_account?: string | null;
  razorpay_clearing_account?: string | null;
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
  google_map_location_url?: string;
  directions_url?: string;
  webpage_url?: string;
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
    profit_from_centre?: number;
    pending_fofo_earnings?: number;
  };
};

export type B2bFocoCentreRow = {
  fofo: string;
  fofo_name: string;
  franchise_code?: string;
  address?: string;
  territory?: string;
  onboarding_status?: string;
  total_fofo_sales: number;
  net_business: number;
  foco_earning: number;
  pending_earning: number;
  credited_earning: number;
  settlement_status: string;
};

export type B2bFofoCommissionLine = {
  id: string;
  fofo: string;
  fofo_name: string;
  trf_id: string;
  bill_date: string;
  mrp: number;
  fofo_margin: number;
  net_amount: number;
  commission_percent: number;
  foco_earning: number;
  settlement_date?: string;
  status: string;
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

export type SalesProfileDashboard = {
  available: boolean;
  reason?: string;
  period: {
    label: string;
    start: string;
    end: string;
    days_covered: number;
    days_in_month: number;
  };
  rep?: SalesRepProfile;
  employee: {
    id: string;
    name: string;
    department?: string;
    designation?: string;
    phone?: string;
    email?: string;
    date_of_joining?: string;
    status?: string;
    company?: string;
    branch?: string;
    grade?: string;
  };
  compensation: {
    monthly_ctc: number;
    monthly_target: number;
    ctc_prorated_mtd: number;
    expenses_claimed_mtd: number;
    net_expense_to_company_mtd: number;
    net_expense_per_day: number;
  };
  kpis: {
    leads_uploaded: number;
    visits_logged: number;
    fofo_created: number;
    foco_created: number;
    b2b_created: number;
    total_sales_generated: number;
    achievement_pct: number;
    used_seed_counts?: { fofo?: boolean; foco?: boolean; b2b?: boolean };
  };
  charts: {
    sales_earned: Array<{ day: number; label: string; amount: number; seeded?: boolean }>;
    sales_earned_mtd: number;
    net_expense: {
      ctc_prorated: number;
      expenses: number;
      total: number;
      per_day: number;
      days_covered: number;
    };
  };
  seed?: { ok?: boolean; seeded?: string[] };
};

export type SalesLead = {
  name: string;
  lead_name: string;
  company_name?: string;
  phone: string;
  email?: string;
  city?: string;
  district?: string;
  subdivision?: string;
  pincode?: string;
  status: string;
  assigned_rep?: string;
  franchisee?: string;
  lead_source?: string;
  platform?: string;
  external_lead_id?: string;
  campaign_name?: string;
  campaign_id?: string;
  ad_id?: string;
  form_id?: string;
  rfms_lead_id?: string;
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
  visit_time?: string;
  purpose?: string;
  outcome?: string;
  visit_status?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  photo?: string;
  assigned_from?: string;
  lead_name?: string;
  lead_phone?: string;
  lead_status?: string;
  reach_user?: string;
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

export type AgencyLevel = {
  name: string;
  code: string;
  title: string;
  rank: number;
  conversion_pct: number;
  monthly_revenue_pct: number;
  override_pct: number;
  active?: number;
};

export type AgencyAgent = {
  name: string;
  full_name: string;
  mobile?: string;
  email?: string;
  user?: string;
  level: string;
  level_title?: string;
  level_rank?: number;
  sponsor?: string;
  sponsor_name?: string;
  status: string;
  is_agency_manager?: number;
  joined_on?: string;
};

export type AgencyDashboard = {
  stats: {
    recruitment: number;
    activation: number;
    productivity: number;
    leadership: number;
    economics: number;
    team_size: number;
  };
  levels: AgencyLevel[];
  my_agent_id?: string | null;
  is_manager?: boolean;
  conversion_base_inr?: number;
  recent_attributions?: { name: string; agent: string; franchisee: string }[];
};

export type AgencyTeamNode = {
  id: string;
  full_name: string;
  level: string;
  level_title?: string;
  status: string;
  is_agency_manager?: number;
  children?: AgencyTeamNode[];
};

export type AgencyCommissionEntry = {
  name: string;
  agent: string;
  agent_name?: string;
  entry_type: string;
  franchisee?: string;
  franchise_name?: string;
  source_agent?: string;
  period?: string;
  gross_amount?: number;
  commission_rate?: number;
  commission_amount: number;
  status: string;
  posting_date?: string;
  notes?: string;
};

export type AgencyCommissionPayload = {
  entries: AgencyCommissionEntry[];
  summary: {
    accrued_total: number;
    paid_total: number;
    month_accrued: number;
    entry_count: number;
  };
};

export type AgencyOnboardRequest = {
  name: string;
  agent: string;
  agent_name?: string;
  prospect_name: string;
  mobile: string;
  email?: string;
  territory?: string;
  franchise_model?: string;
  deal_value?: number;
  status: string;
  ffms_request_id?: string;
  ffms_lead_id?: string;
  decided_by?: string;
  decided_on?: string;
  decision_notes?: string;
  franchisee?: string;
  franchise_name?: string;
  attribution?: string;
  created_at?: string;
  notes?: string;
  commission_earned?: number;
  commission_payout_status?: string;
};

export type AgencyOnboardFormField = {
  field_key: string;
  label: string;
  fieldtype: string;
  options?: string[];
  required?: number | boolean;
  enabled?: number | boolean;
  placeholder?: string;
  help_text?: string;
  sort_order?: number;
  span_full?: number | boolean;
};

export type AgencyOnboardFormSchema = {
  form_key: string;
  title: string;
  subtitle?: string;
  success_message?: string;
  submit_label?: string;
  enabled?: number | boolean;
  allow_guest?: number | boolean;
  require_login?: number | boolean;
  fields: AgencyOnboardFormField[];
  desk_path?: string;
};

export type AgencyFranchiseeRow = {
  attribution_id: string;
  franchisee: string;
  franchise_name?: string;
  agent?: string;
  agent_name?: string;
  deal_value?: number;
  attributed_on?: string;
  level_at_conversion?: string;
  commission_earned?: number;
  commission_paid?: number;
  commission_payout_status?: string;
  ledger_entries?: number;
};

export type AgencyProfilePayload = {
  agent: AgencyAgent;
  downline: { name: string; full_name: string; level: string; status: string }[];
  downline_count: number;
  franchisees: {
    name: string;
    franchisee: string;
    franchise_name?: string;
    deal_value?: number;
    attributed_on?: string;
    level_at_conversion?: string;
  }[];
  onboard_requests?: AgencyOnboardRequest[];
  commissions: AgencyCommissionPayload;
};

export type SalesClosingExpenseLine = {
  expense_type: string;
  amount: number;
  remarks?: string;
  filename?: string;
};

export type SalesClosingReport = {
  name: string;
  sales_rep: string;
  report_type: string;
  period_date: string;
  period_end?: string;
  visits_count: number;
  new_leads: number;
  qualified_leads: number;
  onboardings: number;
  franchise_revenue: number;
  km_traveled?: number;
  other_expenses?: number;
  total_expenses?: number;
  expenses?: SalesClosingExpenseLine[];
  notes?: string;
  creation?: string;
};

export type SalesClosingDraft = {
  report_type: string;
  period_date: string;
  period_end?: string;
  visits_count: number;
  new_leads: number;
  qualified_leads: number;
  onboardings: number;
  franchise_revenue: number;
  already_submitted?: number;
  existing_report_id?: string;
  b2b_samples?: number;
  b2b_business_value?: number;
  b2b_entries?: number;
  b2b_new_centres?: number;
};

export type B2bLogisticsAssignment = {
  person_name: string;
  contact_number?: string;
  pickup_point?: string;
  logistics_cost?: number;
};

export type B2bCollectionCentre = {
  name: string;
  centre_name: string;
  status?: string;
  wallet_amount?: number;
  total_deposit?: number;
  contact_number?: string;
  manual_address?: string;
  google_map_location?: string;
  logistics_assignments?: B2bLogisticsAssignment[];
  remarks?: string;
};

export type B2bSalesEntry = {
  name: string;
  sales_date: string;
  b2b_collection_centre: string;
  centre_name?: string;
  number_of_samples: number;
  business_value: number;
  assigned_logistics_person?: string;
  status?: string;
  remarks?: string;
};

export type B2bClosingSummary = {
  samples: number;
  business_value: number;
  entries: number;
  new_centres: number;
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
    district?: string;
    subdivision?: string;
    pincode?: string;
  }>;
};

export type SalesTeamPerformanceAttachment = {
  name?: string;
  file_name?: string;
  file_url?: string;
  file_size?: number;
};

export type SalesTeamPerformanceReport = {
  name: string;
  sales_rep: string;
  rep_code?: string;
  full_name?: string;
  designation?: string;
  activity_date: string;
  title: string;
  doctors_met?: number;
  visits_done?: number;
  samples_collected?: number;
  km_traveled?: number;
  location_note?: string;
  activity_summary: string;
  creation?: string;
  attachments?: SalesTeamPerformanceAttachment[];
};

export type SalesTeamPerformanceList = {
  is_manager: boolean;
  my_rep_id?: string;
  reports: SalesTeamPerformanceReport[];
};

export type WbGeoHierarchy = {
  districts: Array<{
    name: string;
    subdivisions: Array<{
      name: string;
      localities: Array<{ block_area?: string; pincode?: string; post_office?: string }>;
    }>;
  }>;
  count?: number;
};

export type TerritorialSalesSummary = {
  available: boolean;
  period?: string;
  reason?: string;
  by_district: Array<{
    district: string;
    leads: number;
    leads_won: number;
    visits: number;
    franchisees: number;
  }>;
  totals: {
    leads: number;
    leads_won: number;
    visits: number;
    franchisees: number;
  };
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
  safety_stock?: number;
  low_stock: boolean;
  usage_percent: number;
};

export type LabConsumableBatch = {
  batch_id: string;
  consumable_item: string;
  consumable_name: string;
  lot_number: string;
  franchisee_id?: string | null;
  status: string;
  units_per_pack: number;
  units_remaining: number;
  opened_on?: string | null;
  expiry_date?: string | null;
  safety_stock?: number;
  low_stock: boolean;
  usage_percent: number;
};

export type LabReorderAlert = {
  item_code: string;
  item_name: string;
  remaining: number;
  safety_stock: number;
  message: string;
};

export type LabMappableTest = {
  item_code: string;
  item_name: string;
  diagnostic_test?: string;
  parameters: Array<{ parameter_code: string; parameter_name: string }>;
};

export type LabReagentDashboard = {
  available: boolean;
  reason?: string;
  batches?: LabReagentBatch[];
  low_stock_alerts?: LabReagentBatch[];
  reorder_alerts?: LabReorderAlert[];
  rules_count?: number;
  reagent_items?: Array<{ item_code: string; item_name: string; safety_stock?: number }>;
  lab_tests?: LabMappableTest[];
  consumable_batches?: LabConsumableBatch[];
  consumable_reorder_alerts?: LabReorderAlert[];
  consumable_items?: Array<{ item_code: string; item_name: string; safety_stock?: number }>;
  consumable_rules?: Array<{
    name: string;
    rule_name: string;
    consumable_item: string;
    consumable_name?: string;
    qty_per_trf: number;
  }>;
};

export type LabCptTestRow = {
  ok?: boolean;
  diagnostic_test?: string;
  test_name?: string;
  item?: string;
  department?: string;
  selling_price?: number;
  cpt_reagent?: number;
  cpt_fixed?: number;
  cpt_logistics?: number;
  cpt_total?: number;
  margin?: number | null;
  overhead_coefficient?: number;
};

export type LabCptDashboard = {
  period: {
    start_date?: string;
    end_date?: string;
    lookback_days?: number;
    fixed_expenses?: number;
    logistics_expenses?: number;
    total_test_sales_revenue?: number;
    overhead_coefficient?: number;
    avg_tests_per_trf?: number;
    revenue_is_synthetic?: boolean;
  };
  settings: {
    overhead_coefficient?: number;
    lookback_days?: number;
    avg_tests_per_trf?: number;
  };
  totals: {
    fixed_expenses?: number;
    logistics_expenses?: number;
    total_test_sales_revenue?: number;
    tests_with_cpt?: number;
  };
  tests: LabCptTestRow[];
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
  next_maintenance_due?: string;
  location?: string;
  item?: string;
  erp_asset?: string;
  machine_name_alias?: string;
  model?: string;
  reason?: string;
};

export type QcDashboard = {
  equipment: QcEquipment[];
  overdue: QcEquipment[];
  pm_overdue?: QcEquipment[];
  iqc_today: Array<{
    name: string;
    analyte_code: string;
    analyte_name?: string;
    qc_level: string;
    result_value: number;
    outcome: string;
    equipment?: string;
    lab_mean?: number | null;
    lab_sd?: number | null;
    z_score?: number | null;
    creation?: string;
  }>;
  iqc_analytes?: Array<{ analyte_code: string; analyte_name?: string; qc_level: string; runs: number }>;
  eqa: Array<{
    name: string;
    scheme_name: string;
    discipline: string;
    cycle?: string;
    outcome: string;
    participation_date?: string;
    score?: string;
  }>;
  counts: {
    equipment: number;
    iqc: number;
    iqc_tests?: number;
    eqa: number;
    calibrations: number;
    maintenance?: number;
  };
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

export type SiteFooterLink = {
  code?: string;
  title: string;
  url: string;
  icon?: string;
  open_in_new_tab?: boolean;
  group?: string;
};

export type PublicSeoSettings = {
  seo_tagline?: string;
  seo_keywords?: string;
  public_website_title?: string;
  public_meta_title?: string;
  public_meta_description?: string;
  public_canonical_url?: string;
  public_robots_index?: number;
  public_robots_follow?: number;
  public_og_title?: string;
  public_og_description?: string;
  public_org_name?: string;
  public_org_display_name?: string;
  public_contact_phone?: string;
  public_contact_email?: string;
  public_street_address?: string;
  public_city?: string;
  public_state?: string;
  public_pin_code?: string;
  public_country?: string;
  public_latitude?: string;
  public_longitude?: string;
  public_google_maps_url?: string;
  public_sitemap_url?: string;
  public_gsc_verification?: string;
  public_twitter_card?: string;
  google_analytics_id?: string;
  google_tag_manager_id?: string;
  enable_google_indexing_default?: number;
};

export type SiteFooterPayload = {
  brand?: string;
  tagline?: string;
  seo_tagline?: string;
  seo_keywords?: string;
  subdomains?: SiteFooterLink[];
  company?: SiteFooterLink[];
  resources?: SiteFooterLink[];
  social?: SiteFooterLink[];
  legal?: Array<{ title: string; url: string }>;
  home_collection_helpline?: string;
  home_collection_hours?: string;
  home_collection_tel?: string;
  home_collection_cta_label?: string;
};

export type SiteCmsPage = {
  page_key: string;
  title: string;
  subtitle?: string;
  body?: string;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  is_published?: number | boolean;
};

export type SiteFaqSection = {
  id: string;
  title: string;
  items: Array<{ question: string; answer: string }>;
};

export type BlogPostSummary = {
  name: string;
  title: string;
  slug: string;
  excerpt?: string;
  featured_image?: string;
  featured_video_url?: string;
  author_name?: string;
  category?: string;
  published_on?: string;
  meta_title?: string;
  meta_description?: string;
  allow_google_index?: number | boolean;
};

export type BlogPostDetail = BlogPostSummary & {
  content?: string;
  meta_keywords?: string;
  og_image?: string;
  canonical_url?: string;
  status?: string;
};

export type PortalSeoSettings = {
  google_analytics_id?: string;
  google_tag_manager_id?: string;
  enable_google_indexing_default?: number | boolean;
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
    in_route_trf?: string | null;
    in_route_at?: string | null;
  } | null;
  stops: PhleboMapStop[];
  route: {
    distance_m?: number;
    duration_s?: number;
    geometry?: Array<[number, number]>;
    provider?: string;
  } | null;
  google_maps_configured?: boolean;
  google_maps_api_key?: string;
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

export type PeopleHrmsDashboard = {
  available: boolean;
  hr_available: boolean;
  is_manager: boolean;
  period: { start: string; end: string; as_of: string; label: string };
  employee: {
    id?: string | null;
    name: string;
    department?: string | null;
    designation?: string | null;
    wing?: string | null;
    division?: string | null;
    branch?: string | null;
    company?: string | null;
    status?: string;
    date_of_joining?: string;
    phone?: string | null;
    email?: string | null;
    gender?: string | null;
    reports_to?: string | null;
    reports_to_name?: string | null;
    photo?: string | null;
    image?: string | null;
    current_address?: string | null;
    permanent_address?: string | null;
    blood_group?: string | null;
    company_email?: string | null;
    personal_email?: string | null;
    date_of_birth?: string | null;
    emergency_phone?: string | null;
    employment_type?: string | null;
    grade?: string | null;
    holiday_list?: string | null;
    date_of_retirement?: string | null;
    marital_status?: string | null;
    pan_number?: string | null;
    passport_number?: string | null;
  };
  compensation: {
    monthly_ctc: number;
    ctc_from_erp: boolean;
    latest_net_pay: number;
  };
  kpis: {
    present_days: number;
    present_pct: number;
    leave_balance: number;
    expenses_claimed_mtd: number;
    expenses_pending: number;
    checkins_mtd: number;
    payslips_count: number;
  };
  attendance: {
    checkins_mtd: number;
    present_days: number;
    last_checkin: { name: string; time: string; log_type?: string } | null;
    today_status: string;
    checkin_available: boolean;
    geofence_enabled?: number;
    geofence_required?: number;
    geofence_label?: string;
    series: Array<{ day: number; label: string; count: number }>;
    records?: Array<{ name: string; time: string; log_type: string; date: string }>;
  };
  leave_balances: Array<{
    leave_type: string;
    allocated: number;
    taken: number;
    balance: number;
  }>;
  payslips: Array<{
    name: string;
    posting_date?: string;
    start_date?: string;
    end_date?: string;
    gross_pay: number;
    net_pay: number;
    status: string;
  }>;
  expenses: { count: number; claimed: number; pending: number };
  leave_applications: LeaveApplicationRow[];
  expense_claims: ExpenseClaimRow[];
  leave_types: Array<{ name: string; leave_type_name?: string; max_leaves_allowed?: number }>;
  expense_types: Array<{ name: string; expense_type?: string }>;
  org: {
    headcount_active: number;
    joined_mtd: number;
    left_mtd: number;
    leave_open: number;
    expense_pending: number;
    attendance_today: number;
    open_positions?: number;
    payroll: {
      salary_slips_mtd: number;
      payroll_ready: boolean;
      total_net?: number;
      total_gross?: number;
      total_deduction?: number;
    };
    payroll_summary?: {
      salary_slips_mtd: number;
      payroll_ready: boolean;
      total_gross: number;
      total_net: number;
      total_deduction: number;
      prev_total_net?: number;
    };
    attendance_breakdown?: {
      present: number;
      absent: number;
      leave: number;
      half_day: number;
      total: number;
    };
    attendance_series?: Array<{
      day: number;
      label: string;
      count: number;
      present?: number;
      absent?: number;
      leave?: number;
    }>;
    by_department: Array<{ department: string; headcount: number }>;
    recent_job_openings?: Array<{
      name: string;
      job_title: string;
      department: string;
      designation: string;
      status: string;
      applicants: number;
      posted: string;
    }>;
    recent_activities?: Array<{ type: string; text: string; when: string }>;
    period_label: string;
  } | null;
};

export type PeopleDepartmentRow = {
  department: string;
  headcount: number;
  label?: string;
  code?: string | null;
  parent?: string | null;
  company?: string | null;
  head?: string | null;
  head_name?: string | null;
  status?: string;
  created_on?: string | null;
  unlisted?: number;
};

export type AttendanceStatus = 'Present' | 'Absent' | 'On Leave' | 'Half Day' | 'Holiday';

export type AttendanceCounts = { present: number; absent: number; leave: number; half_day: number; holiday: number };

export type PeopleAttendanceRow = {
  id: string;
  name: string;
  photo?: string | null;
  department?: string | null;
  designation?: string | null;
  date_of_joining?: string | null;
  status: AttendanceStatus | null;
  check_in: string | null;
  check_out: string | null;
  period_minutes: number;
  avg_month_minutes: number;
  counts: AttendanceCounts;
  leave_period: Record<string, number>;
  log: Array<{ date: string; status: AttendanceStatus | null; check_in: string | null; check_out: string | null; minutes: number }>;
};

export type PeopleAttendanceRegister = {
  from_date: string;
  to_date: string;
  ref_day: string;
  checkin_available: boolean;
  employees: PeopleAttendanceRow[];
  series: Array<{ date: string } & AttendanceCounts>;
  leave_types: string[];
  kpis: {
    total_employees: number;
    joined_this_month: number;
    present: number;
    absent: number;
    on_leave: number;
    half_day: number;
    holiday: number;
    avg_working_minutes: number;
    prev_avg_working_minutes: number;
    approved_leave_period: number;
    open_leave_period: number;
    employees_on_leave_period: number;
    leave_days_ytd: number;
    leave_days_last_ytd: number;
  };
};

export type PeopleLeaveStage = 'Draft' | 'Manager Review' | 'HR Review' | 'Completed' | 'Rejected' | 'Cancelled';
export type PeopleLeaveStatus = 'Draft' | 'Pending' | 'Manager Rejected' | 'Approved' | 'Rejected' | 'Cancelled';
export type PeopleLeaveAction =
  | 'recommend'
  | 'decide_reject'
  | 'forward'
  | 'manager_reject'
  | 'return'
  | 'resubmit'
  | 'approve'
  | 'reject';

export type PeopleLeaveApplication = {
  id: string;
  employee: string;
  employee_name: string;
  photo?: string | null;
  department?: string | null;
  designation?: string | null;
  leave_type: string;
  from_date: string;
  to_date: string;
  days: number;
  half_day: number;
  half_day_date?: string | null;
  status: PeopleLeaveStatus;
  erp_status: string;
  stage: PeopleLeaveStage;
  in_range: number;
  reason?: string | null;
  posting_date: string;
  created_on: string;
  created_by: string;
  modified_on: string;
  modified_by: string;
  leave_approver?: string | null;
  leave_approver_name?: string | null;
  manager_decision?: 'Recommended' | 'Rejected' | null;
  manager_by?: string | null;
  manager_on?: string | null;
  manager_remark?: string | null;
  hr_remark?: string | null;
  original_from?: string | null;
  original_to?: string | null;
  unauthorized_dates?: string[];
};

export type PeopleLeaveBalanceSlot = { allocated: number; used: number; pending: number };

export type PeopleLeaveUnauthorized = {
  id: string;
  leave: string;
  employee: string;
  employee_name: string;
  department?: string | null;
  leave_type: string;
  date: string;
  status: string;
  reason?: string;
};

export type PeopleLeaveRegister = {
  available: boolean;
  from_date: string;
  to_date: string;
  year: number;
  me: string | null;
  applications: PeopleLeaveApplication[];
  unauthorized?: PeopleLeaveUnauthorized[];
  employees: Array<{ id: string; name: string; department?: string | null; designation?: string | null; photo?: string | null; active: number }>;
  leave_types: Array<{ name: string; max_leaves_allowed: number; is_lwp: number }>;
  balances: Record<string, Record<string, PeopleLeaveBalanceSlot>>;
  balance_summary: Array<{
    leave_type: string;
    allocated: number;
    used: number;
    pending: number;
    employees: number;
    max_per_employee: number;
    is_lwp: number;
  }>;
  type_distribution: Array<{ leave_type: string; days: number }>;
  kpis: {
    total: number;
    prev_total: number;
    draft: number;
    manager_review: number;
    hr_review: number;
    approved: number;
    rejected: number;
    unauthorized_days?: number;
    approved_days: number;
    on_leave_today: number;
  };
};

export type PeoplePayrollStatus = 'Processed' | 'Pending' | 'On Hold';
export type PeoplePayrollLine = { component: string; amount: number };

export type PeoplePayrollRow = {
  id: string;
  name: string;
  photo?: string | null;
  department?: string | null;
  designation?: string | null;
  employee_status?: string;
  date_of_joining?: string;
  structure?: string | null;
  base: number;
  status: PeoplePayrollStatus;
  stage: string;
  slip?: string | null;
  slip_status?: string | null;
  gross: number | null;
  deductions: number | null;
  net: number | null;
  payment_days?: number | null;
  working_days?: number | null;
  posting_date?: string | null;
  payroll_entry?: string | null;
  earnings: PeoplePayrollLine[];
  deduction_lines: PeoplePayrollLine[];
  statutory: Record<string, number>;
};

export type PeoplePayrollRegister = {
  available: boolean;
  missing: string[];
  month: string;
  label: string;
  from_date: string;
  to_date: string;
  months: Array<{ value: string; label: string }>;
  company?: string | null;
  batch_size: number;
  rows: PeoplePayrollRow[];
  kpis: {
    employees: number;
    joined: number;
    assigned: number;
    slips: number;
    drafts: number;
    processed: number;
    pending: number;
    on_hold: number;
    not_processed: number;
    gross: number;
    deductions: number;
    net: number;
    prev_gross: number;
    prev_deductions: number;
    prev_net: number;
    prev_label: string;
    projected_gross: number;
  };
  steps: Array<{ key: 'assign' | 'process' | 'approve' | 'payslips'; done: boolean; current: boolean; detail: string }>;
  statutory: Array<{ label: string; amount: number; employees: number }>;
  departments: Array<{ department: string; employees: number; processed: number; gross: number; deductions: number; net: number }>;
  activities: Array<{ kind: 'processed' | 'generated' | 'entry'; title: string; detail: string; at: string }>;
};

export type PeoplePerformanceBand = 'Top Performer' | 'High Performer' | 'Good Performer' | 'Average' | 'Needs Improvement' | 'No Data';
export type PeoplePerformanceComponent = 'hours' | 'attendance' | 'feedback';

export type PeoplePerformanceRow = {
  id: string;
  name: string;
  photo?: string | null;
  department?: string | null;
  designation?: string | null;
  date_of_joining?: string | null;
  working_days: number;
  present_days: number;
  leave_days: number;
  hours: number;
  expected_hours: number;
  attendance_pct: number | null;
  rating: number | null;
  hours_score: number | null;
  attendance_score: number | null;
  feedback_score: number | null;
  contrib: Record<PeoplePerformanceComponent, number>;
  score: number | null;
  prev_score: number | null;
  band: PeoplePerformanceBand;
  rank: number | null;
};

export type PeoplePerformanceReview = {
  name: string;
  period: string;
  rating: number;
  remarks?: string | null;
  recommendation?: string | null;
  reviewer?: string | null;
  modified: string;
};

export type PeoplePerformanceBoard = {
  available: boolean;
  feedback_available: boolean;
  from_date: string;
  to_date: string;
  prev_from: string;
  prev_to: string;
  review_period: string;
  weights: Record<PeoplePerformanceComponent, number>;
  target: number;
  day_hours: number;
  bands: Array<{ min: number; label: PeoplePerformanceBand }>;
  months: Array<{ value: string; label: string }>;
  rows: PeoplePerformanceRow[];
  reviews: Record<string, PeoplePerformanceReview[]>;
  kpis: {
    employees: number;
    prev_employees: number;
    scored: number;
    avg_score: number | null;
    prev_avg_score: number | null;
    above_target: number;
    rated: number;
    top: { id: string; name: string; designation?: string | null; score: number } | null;
  };
  breakdown: Record<PeoplePerformanceComponent, number>;
};

export type PeoplePayrollBatchResult = {
  month: string;
  created?: Array<{ employee: string; slip: string }>;
  existing?: Array<{ employee: string; slip: string }>;
  skipped?: Array<{ employee: string; reason: string }>;
  approved?: Array<{ employee: string; slip: string }>;
  already?: Array<{ employee: string; slip: string }>;
  errors: Array<{ employee?: string; slip?: string; error: string }>;
};

export type PeopleDesignationRow = {
  designation: string;
  headcount: number;
  grade?: string | null;
  grade_inferred?: number;
  grade_description?: string | null;
  structure?: string | null;
  indicative_base?: number | null;
  da_track?: string | null;
  status?: string;
  created_on?: string | null;
};

export type PeopleEmployeeRow = {
  id: string;
  name: string;
  department?: string | null;
  designation?: string | null;
  branch?: string | null;
  status?: string;
  date_of_joining?: string | null;
  phone?: string | null;
  email?: string | null;
  photo?: string | null;
  grade?: string | null;
  work_latitude?: number | null;
  work_longitude?: number | null;
  geofence_radius_m?: number | null;
  geofence_enabled?: number;
  geofence_label?: string | null;
};

export type HirePortal = 'Naukri' | 'WorkIndia';
export type HireStage = 'New' | 'Screening' | 'Interview' | 'Offer' | 'Hired' | 'Rejected' | 'Withdrawn';

export type HirePortalSlot = {
  portal: HirePortal;
  limit: number | null;
  used: number;
  available: number | null;
  employer_url: string;
  validity_days: number;
};

export type HireJob = {
  name: string;
  title: string;
  status: 'Draft' | 'Open' | 'Paused' | 'Closed';
  department?: string | null;
  location?: string | null;
  employment_type?: string;
  openings: number;
  salary_min?: number;
  salary_max?: number;
  experience_min?: number;
  experience_max?: number;
  qualification?: string | null;
  skills?: string | null;
  description?: string | null;
  is_public: number;
  closes_on?: string | null;
  candidates?: number;
  active_candidates?: number;
  hired?: number;
  active_portals?: HirePortal[];
};

export type HirePosting = {
  name: string;
  portal: HirePortal;
  status: 'Active' | 'Expired' | 'Closed';
  posted_on?: string | null;
  expires_on?: string | null;
  external_url?: string | null;
  external_ref?: string | null;
  notes?: string | null;
};

export type HireJobAds = {
  job: HireJob;
  ads: {
    Naukri: { title: string; body: string; key_skills: string[]; employer_url: string };
    WorkIndia: { title: string; body: string; key_skills: string[]; employer_url: string };
    Careers: { title: string; apply_url: string };
  };
  slots: HirePortalSlot[];
  postings: HirePosting[];
};

export type HireCandidateRow = {
  name: string;
  full_name: string;
  job?: string | null;
  job_title?: string | null;
  stage: HireStage;
  source: string;
  mobile?: string | null;
  email?: string | null;
  city?: string | null;
  experience_years?: number | null;
  expected_ctc?: number | null;
  rating: number;
  interview_at?: string | null;
  employee?: string | null;
  last_activity?: string | null;
  created: string;
};

export type HireActivity = {
  kind: string;
  body?: string | null;
  from_stage?: string | null;
  to_stage?: string | null;
  actor?: string | null;
  at: string;
};

export type HireCandidateDetail = HireCandidateRow & {
  qualification?: string | null;
  current_company?: string | null;
  current_ctc?: number | null;
  notice_period?: string | null;
  resume_url?: string | null;
  interview_mode?: string | null;
  offered_ctc?: number | null;
  joining_date?: string | null;
  reject_reason?: string | null;
  import_batch?: string | null;
  has_resume: boolean;
  allowed_stages: HireStage[];
  can_hire: boolean;
  activities: HireActivity[];
};

export type HiringOverview = {
  kpis: {
    open_jobs: number;
    active_candidates: number;
    new_today: number;
    new_7d: number;
    interviews_7d: number;
    hired_month: number;
  };
  stages: Array<{ stage: HireStage; count: number }>;
  sources_30d: Array<{ source: string; count: number }>;
  slots: HirePortalSlot[];
  upcoming_interviews: HireCandidateRow[];
  recent_activity: Array<{
    candidate: string;
    candidate_name?: string | null;
    kind: string;
    body?: string | null;
    to_stage?: string | null;
    actor?: string | null;
    at: string;
  }>;
};

export type HireImportResult = {
  dry_run: boolean;
  columns: Record<string, string>;
  total_rows: number;
  created: number;
  merged: number;
  skipped: number;
  errors: Array<{ row: number; name?: string; reason: string }>;
  preview: Array<Record<string, string | number>>;
  batch?: string | null;
};

export type PublicHireJob = HireJob & {
  job_title: string;
  salary_text: string;
  experience_text: string;
};

export type PeoplePayrollWorkflow = {
  ready: boolean;
  missing: string[];
  company?: string | null;
  salary_structure?: string | null;
  active_employees: number;
  assignments: number;
  period: { start: string; end: string };
  slips_mtd: number;
  entries: Array<{
    name: string;
    start_date?: string | null;
    end_date?: string | null;
    status?: string;
    docstatus: number;
    payroll_frequency?: string;
    company?: string;
  }>;
  steps: Array<{ id: string; label: string; done: boolean; detail?: string }>;
};

export type PeopleChecklistTodo = {
  name: string;
  kind: 'onboarding' | 'offboarding' | string;
  description: string;
  status: string;
  due?: string | null;
  allocated_to?: string | null;
  employee?: string | null;
  modified?: string | null;
};

export type PeopleOnboardingStatus = 'Not Started' | 'Pending' | 'In Progress' | 'Completed';

export type PeopleOnboardingTask = {
  name: string;
  label: string;
  stage: string;
  status: string;
  due?: string | null;
  allocated_to?: string | null;
  modified?: string | null;
};

export type PeopleOnboardingRow = {
  id: string;
  name: string;
  photo?: string | null;
  department?: string | null;
  designation?: string | null;
  email?: string | null;
  date_of_joining?: string | null;
  status: PeopleOnboardingStatus;
  progress: number;
  closed: number;
  total: number;
  current_stage?: string | null;
  tasks: PeopleOnboardingTask[];
};

export type PeopleOnboardingBoard = {
  available: boolean;
  from_date: string;
  to_date: string;
  stages: Array<{ key: string; label: string; hint: string }>;
  rows: PeopleOnboardingRow[];
  eligible: Array<{
    id: string;
    name: string;
    department?: string | null;
    designation?: string | null;
    date_of_joining?: string | null;
    email?: string | null;
  }>;
  kpis: {
    new_hires: number;
    prev_hires: number;
    in_progress: number;
    completed: number;
    pending: number;
  };
};

export type PeopleTrainingType = 'Video' | 'PDF' | 'Youtube' | 'Document';
export type PeopleTrainingMatStatus = 'Draft' | 'Published' | 'Archived';
export type PeopleTrainingAssignStatus = 'Pending' | 'In Progress' | 'Completed';

export type PeopleTrainingMaterial = {
  id: string;
  title: string;
  material_type: PeopleTrainingType;
  category: string;
  applicable: string;
  applicable_label: string;
  department?: string | null;
  designation?: string | null;
  duration_min?: number | null;
  status: PeopleTrainingMatStatus;
  url?: string | null;
  description?: string | null;
  assigned: number;
  legacy?: boolean;
  modified?: string | null;
};

export type PeopleTrainingPlan = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  material_ids: string[];
  modified?: string | null;
};

export type PeopleTrainingAssignment = {
  id: string;
  material: string;
  material_title?: string;
  plan?: string | null;
  employee: string;
  employee_name: string;
  department?: string | null;
  designation?: string | null;
  status: PeopleTrainingAssignStatus;
  assigned_on?: string | null;
  completed_on?: string | null;
};

export type PeopleTrainingBoard = {
  available: boolean;
  materials: PeopleTrainingMaterial[];
  plans: PeopleTrainingPlan[];
  assignments: PeopleTrainingAssignment[];
  categories: string[];
  employees: Array<{ id: string; name: string; department?: string | null; designation?: string | null }>;
  departments: string[];
  designations: string[];
  monthly: Array<{ key: string; label: string; completed: number; in_progress: number; pending: number }>;
  dept_bars: Array<{ name: string; total: number; completed: number; pct: number }>;
  kpis: {
    trainings: number;
    new_this_month: number;
    learners: number;
    prev_learners: number;
    in_progress: number;
    completed: number;
    pending: number;
  };
};

export type PeopleManpowerStatus = 'Pending HR Review' | 'Approved' | 'Rejected';
export type PeopleManpowerPriority = 'High' | 'Medium' | 'Low';

export type PeopleManpowerRequest = {
  id: string;
  requested_by: string;
  requested_by_id?: string | null;
  requested_role?: string;
  department?: string | null;
  designation: string;
  positions: number;
  priority: PeopleManpowerPriority;
  status: PeopleManpowerStatus;
  request_date?: string | null;
  notes?: string | null;
  plan_ref?: string | null;
};

export type PeopleCareerPlan = {
  id: string;
  title: string;
  department?: string | null;
  designation?: string | null;
  status: string;
  headcount: number;
  job_opening?: string | null;
  desired_ctc?: number | null;
};

export type PeopleCareerJob = {
  id: string;
  title: string;
  status: string;
  department?: string | null;
  employment_type: string;
  openings: number;
  is_public: number;
  applications: number;
  location?: string | null;
};

export type PeopleCareerBoard = {
  available: boolean;
  requests: PeopleManpowerRequest[];
  plans: PeopleCareerPlan[];
  jobs: PeopleCareerJob[];
  portals: Array<{ portal: string; employer_url: string }>;
  postings: Array<{
    id: string;
    job?: string | null;
    job_title?: string;
    portal: string;
    status?: string | null;
    posted_on?: string | null;
    external_url?: string | null;
  }>;
  departments: string[];
  designations: string[];
  employees: Array<{ id: string; name: string; department?: string | null; designation?: string | null }>;
  dept_bars: Array<{ name: string; planned: number; actual: number }>;
  funnel: Array<{ key: string; label: string; value: number; color: string }>;
  kpis: {
    total_positions: number;
    prev_positions: number;
    approved_positions: number;
    pending_requests: number;
    open_postings: number;
    hired_careers: number;
    prev_hired_careers: number;
  };
  careers_url?: string;
};

export type PeopleAssetStatus = 'Assigned' | 'Available' | 'In Repair' | 'Retired';
export type PeopleAssetRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export type PeopleAsset = {
  id: string;
  title: string;
  category: string;
  serial: string;
  status: PeopleAssetStatus | string;
  location: string;
  department: string;
  assigned_employee?: string;
  employee_name?: string;
  employee_id?: string;
  photo?: string | null;
  assign_date?: string | null;
  notes?: string;
  modified?: string | null;
};

export type PeopleAssetRequest = {
  id: string;
  title: string;
  employee?: string;
  employee_name?: string;
  employee_id?: string;
  status: PeopleAssetRequestStatus | string;
  note?: string;
  request_date?: string | null;
};

export type PeopleAssetActivity = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  asset?: string;
  actor?: string;
  happened_on?: string;
};

export type PeopleAssetsBoard = {
  available: boolean;
  is_manager: boolean;
  categories: Array<{ id: string; title: string; count: number }>;
  assets: PeopleAsset[];
  requests: PeopleAssetRequest[];
  activities: PeopleAssetActivity[];
  employees: Array<{ id: string; name: string; department?: string; photo?: string | null }>;
  locations: string[];
  by_department: Array<{ name: string; count: number }>;
  kpis: {
    total: number;
    assigned: number;
    available: number;
    repair: number;
    retired: number;
    prev_total?: number;
  };
};

export type PeopleAnnouncementStatus = 'Published' | 'Scheduled' | 'Draft' | 'Archived' | 'Expired';
export type PeopleAnnouncementType = 'Holiday' | 'Event' | 'Policy' | 'Notice' | 'HR Process' | 'General';
export type PeopleAnnouncementTarget = 'All Employees' | 'Department' | 'Designation' | 'Manager' | 'Individual';

export type PeopleAnnouncement = {
  id: string;
  title: string;
  subtitle?: string;
  body?: string;
  ann_type: PeopleAnnouncementType | string;
  status: PeopleAnnouncementStatus | string;
  stored_status?: string;
  target_mode: PeopleAnnouncementTarget | string;
  target_value: string;
  publish_date?: string | null;
  publish_time?: string;
  end_date?: string | null;
  published_by?: string;
  file_url?: string | null;
  file_name?: string;
  modified?: string | null;
};

export type PeopleAnnouncementsBoard = {
  available: boolean;
  is_manager: boolean;
  announcements: PeopleAnnouncement[];
  recent: PeopleAnnouncement[];
  departments: string[];
  designations: string[];
  managers: Array<{ id: string; name: string; department?: string; photo?: string | null }>;
  employees: Array<{ id: string; name: string; department?: string; designation?: string; photo?: string | null }>;
  by_type: Array<{ name: string; count: number }>;
  reach: {
    total: number;
    all_employees: number;
    departments: number;
    designations: number;
    managers: number;
    individual: number;
  };
  kpis: {
    total: number;
    published: number;
    scheduled: number;
    expired: number;
    draft?: number;
    archived?: number;
    prev_total?: number;
  };
};

export type PeopleCalendarEventType =
  | 'Holiday'
  | 'Meeting'
  | 'Training'
  | 'Payroll'
  | 'Birthday'
  | 'Work Anniversary'
  | 'Other';

export type PeopleCalendarEvent = {
  id: string;
  title: string;
  event_type: PeopleCalendarEventType | string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  all_day?: number;
  audience?: string;
  description?: string;
  modified?: string | null;
};

export type PeopleCalendarBoard = {
  available: boolean;
  is_manager: boolean;
  today: string;
  events: PeopleCalendarEvent[];
  kpis: {
    today: number;
    today_meetings: number;
    today_holidays: number;
    upcoming_7: number;
    upcoming_meetings: number;
    upcoming_holidays: number;
    upcoming_others: number;
    holidays_month: number;
    holidays_upcoming: number;
    birthdays_month: number;
    birthdays_today: number;
  };
};

export type PeopleReportTab =
  | 'overview'
  | 'employee'
  | 'attendance'
  | 'payroll'
  | 'recruitment'
  | 'performance'
  | 'training'
  | 'assets'
  | 'compliance';

export type PeopleReportRun = {
  id: string;
  title: string;
  report_type: string;
  date_from?: string | null;
  date_to?: string | null;
  department?: string;
  generated_by?: string;
  generated_on?: string | null;
  status?: string;
};

export type PeopleReportsBoard = {
  available: boolean;
  is_manager: boolean;
  from_date: string;
  to_date: string;
  departments: string[];
  employees: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
  kpis: {
    employees: number;
    employees_delta?: number | null;
    joiners: number;
    joiners_delta?: number | null;
    exits: number;
    exits_delta?: number | null;
    attendance_pct: number;
    attendance_delta?: number | null;
    leave_taken: number;
    leave_delta?: number | null;
  };
  headcount_trend: Array<{ label: string; value: number }>;
  by_department: Array<{ name: string; count: number }>;
  by_designation: Array<{ name: string; count: number }>;
  recent: PeopleReportRun[];
};

export type PeopleAnalyticsTab =
  | 'overview'
  | 'headcount'
  | 'attendance'
  | 'recruitment'
  | 'performance'
  | 'training'
  | 'payroll'
  | 'assets'
  | 'diversity'
  | 'custom';

export type PeopleAnalyticsBoard = {
  available: boolean;
  is_manager: boolean;
  from_date: string;
  to_date: string;
  departments: string[];
  employees: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
  kpis: {
    employees: number;
    employees_delta?: number | null;
    joiners: number;
    joiners_delta?: number | null;
    exits: number;
    exits_delta?: number | null;
    attendance_pct: number;
    attendance_delta?: number | null;
    leave_avg: number;
    leave_delta?: number | null;
    performance_avg: number;
    performance_delta?: number | null;
  };
  headcount_trend: Array<{ label: string; value: number }>;
  by_department: Array<{ name: string; count: number }>;
  joiners_exits: Array<{ label: string; joiners: number; exits: number }>;
  attendance_mix: Array<{ name: string; pct: number }>;
  leave_trend: Array<{ label: string; Casual: number; Sick: number; Earned: number; Other: number }>;
  tenure: Array<{ name: string; count: number }>;
  top_departments: Array<{ name: string; rating: number; employees: number }>;
  funnel: Array<{ name: string; value: number; color: string }>;
  insights: Array<{ tone: string; icon: string; text: string }>;
  diversity: Array<{ name: string; count: number }>;
  training: Array<{ name: string; count: number }>;
  payroll: { slips: number; net: number };
  assets: { total: number; assigned: number };
};

export type PeopleGeofence = {
  id: string;
  title: string;
  subtitle?: string;
  address?: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  status: 'Active' | 'Inactive' | string;
  department?: string;
  site_type?: string;
  tone?: string;
  employees: number;
};

export type PeopleGeofenceEmployee = {
  id: string;
  name: string;
  department?: string;
  geofence_enabled: number;
  geofence_label?: string;
  work_latitude?: number | null;
  work_longitude?: number | null;
  geofence_radius_m?: number | null;
  designation?: string;
  geofence_address?: string;
  override_active?: number;
  override_until?: string;
  override_reason?: string;
  override_by?: string;
  override_on?: string;
  geofence_state?: 'Enforced' | 'Override' | 'Incomplete' | 'Off' | string;
};

export type EmployeeGeofenceSettings = {
  geofence_enabled: number;
  geofence_label: string;
  geofence_address?: string;
  work_latitude: number | null;
  work_longitude: number | null;
  geofence_radius_m: number;
};

export type PeopleGeofencesBoard = {
  available: boolean;
  is_manager: boolean;
  can_edit_employee_geofence?: boolean;
  google_maps_api_key?: string;
  kpis: { total: number; assigned: number; active: number; inactive: number; overrides?: number };
  locations: PeopleGeofence[];
  employees: PeopleGeofenceEmployee[];
  departments: string[];
  sites: string[];
  hq: { latitude: number; longitude: number; label: string; radius_m: number };
};

export type PeopleAccessRole = {
  id: string;
  title: string;
  description?: string;
  portals: string[];
  portal_labels: string[];
  frappe_role?: string;
  status: 'Active' | 'Inactive' | string;
  tone?: string;
  permissions: string[];
  users: number;
};

export type PeopleAccessUser = {
  id: string;
  name: string;
  department?: string;
  designation?: string;
  email?: string;
  user_id?: string;
  login_id?: string;
  status: string;
  enabled: number;
  roles: string[];
  role_title?: string;
  portals: string[];
  permissions: string[];
  assignment?: string;
};

export type PeopleAccessEmployee = {
  id: string;
  name: string;
  department?: string;
  designation?: string;
  email?: string;
  user_id?: string;
};

export type PeopleAccessPortal = { id: string; label: string; hint?: string };
export type PeopleAccessModule = { id: string; label: string; children?: Array<{ id: string; label: string }> };
export type PeopleAccessAudit = { id: string; actor: string; action: string; target: string; detail: string; when: string };

export type PeopleRolesBoard = {
  available: boolean;
  is_manager: boolean;
  kpis: {
    employees: number;
    roles: number;
    active_users: number;
    inactive_users: number;
    portals: number;
    active_delta?: number;
    inactive_delta?: number;
  };
  roles: PeopleAccessRole[];
  users: PeopleAccessUser[];
  employees: PeopleAccessEmployee[];
  portals: PeopleAccessPortal[];
  modules: PeopleAccessModule[];
  frappe_roles: string[];
  audit: PeopleAccessAudit[];
};

export type PeoplePolicyStatus = 'Published' | 'Draft' | 'Archived';

export type PeoplePolicy = {
  id: string;
  title: string;
  slug?: string | null;
  category: string;
  version: string;
  status: PeoplePolicyStatus | string;
  body?: string;
  description?: string;
  key_points: string[];
  applicable: string[];
  related_docs: Array<{ title: string; file_type?: string; file_url?: string | null }>;
  versions: Array<{ version: string; updated_on?: string; updated_by?: string; current?: number }>;
  views: number;
  updated_on?: string | null;
  updated_by?: string | null;
  file_url?: string | null;
  modified?: string | null;
};

export type PeoplePoliciesBoard = {
  available: boolean;
  is_manager: boolean;
  categories: Array<{ id: string; title: string; count: number }>;
  policies: PeoplePolicy[];
  recent: PeoplePolicy[];
  popular: PeoplePolicy[];
  kpis: { total: number; published: number; draft: number; archived: number };
};

export type PeopleDocType = 'PDF' | 'DOC' | 'Video' | 'Image' | 'Other';
export type PeopleDocStatus = 'Active' | 'Expiring Soon' | 'Expired' | 'Deleted';
export type PeopleDocScope = 'Employee' | 'Company' | 'Template';
export type PeopleDocRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export type PeopleDocumentFolder = {
  id: string;
  title: string;
  parent?: string | null;
  scope?: string;
  count: number;
};

export type PeopleDocument = {
  id: string;
  title: string;
  file_type: PeopleDocType | string;
  folder?: string | null;
  scope: PeopleDocScope | string;
  applicable?: string;
  applicable_label?: string;
  department?: string | null;
  employee?: string | null;
  employee_name?: string | null;
  expiry_date?: string | null;
  status: PeopleDocStatus | string;
  file_url?: string | null;
  uploaded_on?: string | null;
  uploaded_by?: string | null;
  is_template?: number;
  last_accessed?: string | null;
  modified?: string | null;
};

export type PeopleDocumentRequest = {
  id: string;
  employee: string;
  employee_name?: string;
  employee_id?: string;
  photo?: string | null;
  title: string;
  request_date?: string | null;
  status: PeopleDocRequestStatus | string;
};

export type PeopleDocumentsBoard = {
  available: boolean;
  folders: PeopleDocumentFolder[];
  documents: PeopleDocument[];
  templates: PeopleDocument[];
  requests: PeopleDocumentRequest[];
  recent: PeopleDocument[];
  access_log: Array<{
    id: string;
    title: string;
    actor?: string | null;
    accessed_on?: string | null;
    file_url?: string | null;
  }>;
  departments: string[];
  employees: Array<{
    id: string;
    name: string;
    department?: string | null;
    designation?: string | null;
    photo?: string | null;
  }>;
  kpis: {
    total: number;
    prev_total: number;
    this_month?: number;
    last_month?: number;
    employee: number;
    company: number;
    expiring_soon: number;
    expired: number;
  };
};

export type StaffPlanResearch = {
  method?: string;
  disclaimer?: string;
  market_median_ctc: number;
  suggested_desired_ctc?: number;
  sources: Array<{ portal: string; weight: number; estimated_median_ctc: number; note?: string }>;
  matched_benchmark?: {
    staff_role?: string;
    designation?: string;
    department?: string;
    default_kpis?: string[];
    default_kras?: string[];
  };
};

export type StaffPlanDetail = {
  name: string;
  title: string;
  department?: string;
  designation?: string;
  staff_role?: string;
  location?: string;
  employment_type?: string;
  status?: string;
  headcount?: number;
  desired_ctc?: number;
  market_median_ctc?: number;
  job_opening?: string;
  kpis?: string[];
  kras?: string[];
  jd_text?: string;
  market_research?: StaffPlanResearch | null;
  notes?: string;
  published_on?: string;
  careers_url?: string;
  careers_apply_path?: string;
};

export type FranchiseeProfile = {
  name: string;
  branch_code?: string;
  franchise_name?: string;
  territory_region?: string;
  commission_percentage_rate?: number;
  franchisee_type?: string;
  franchisee_rate_label?: string;
  wallet_balance?: number;
  credit_limit?: number;
  available_to_bill?: number;
  parent_foco?: string;
  override_upsell_commission?: number;
  profit_from_centre?: number;
  pending_fofo_earnings?: number;
  address?: string;
  contact_phone?: string;
  contact_email?: string;
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
  hec_employee?: string | null;
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


export type VolumeHiringKpis = {
  days: number;
  target_per_day: number;
  applicants_today: number;
  applicants_period: number;
  avg_per_day: number;
  on_track: boolean;
  knockout: Record<string, number>;
  knockout_pass_rate_pct: number;
  in_interview_or_later: number;
  by_day: Array<{ date: string; count: number }>;
  by_source: Array<{ source: string; count: number }>;
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
    grade?: string;
    salary_structure?: string;
    letter_type?: string;
    email_status?: string;
    recipient_email?: string;
    email_subject?: string;
    email_queued_on?: string | null;
    email_sent_on?: string | null;
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

export type ClinicalEncounter = {
  name: string;
  patient?: string;
  patient_name?: string;
  doctor?: string;
  doctor_appointment?: string;
  department?: string;
  status?: string;
  specialty_template?: string;
  clinical_prescription?: string;
  chief_complaint?: string;
  history_of_present_illness?: string;
  examination?: string;
  assessment?: string;
  plan?: string;
  diagnosis?: string;
  vitals?: Record<string, unknown> | null;
  scribe_transcript?: string;
  cdss_suggestions?: {
    differentials?: Array<{ name: string; rationale?: string; urgency?: string }>;
    cautions?: string[];
  } | null;
  encounter_datetime?: string;
};

export type CareProgram = {
  program_code: string;
  name: string;
  title: string;
  condition?: string;
  description?: string;
  duration_days?: number;
  enabled?: number;
  task_library?: Array<{ code: string; title: string; cadence?: string }>;
  goal_metrics?: Record<string, number>;
};

export type CareEnrollment = {
  name: string;
  patient?: string;
  program?: CareProgram | null;
  assigned_doctor?: string;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  health_score?: number;
  adherence_percent?: number;
  study_protocol?: string;
  study_consent?: number;
};

export type CareVital = {
  name?: string;
  vital_type: string;
  value: number;
  unit?: string;
  recorded_at?: string | null;
  out_of_range?: number | boolean;
};

export type CareTask = {
  name: string;
  task_code: string;
  task_title?: string;
  completed?: number | boolean;
  task_date?: string | null;
};

export type CareVitalAlert = {
  vital_type: string;
  value: number;
  recorded_at?: string | null;
  enrollment?: string;
};

export type AbhaProfile = {
  patient?: string;
  patient_name?: string;
  abha_number?: string;
  abha_address?: string;
  abha_verification_status?: string;
  abha_consent_at?: string | null;
  abha_consent_note?: string;
};

export type RazorpayOrder = {
  order_id: string;
  amount: number;
  amount_paise: number;
  currency: string;
  razorpay_key_id?: string;
  test_mode?: boolean;
};

export type CollectionTubeRow = {
  tube_code?: string;
  cap_color?: string;
  accession_id?: string;
  volume_ml?: number;
  specimen?: string;
  status?: string;
  draw_order?: number;
  linked_tests?: string;
  destination?: string;
  spin_lane?: string;
};

export type AccessionPatient = {
  patient_name?: string | null;
  age?: string | null;
  age_months?: string | null;
  age_days?: string | null;
  gender?: string | null;
  patient_phone?: string | null;
  unique_barcode?: string | null;
  order_status?: string | null;
  sample_intake_channel?: string | null;
  hec_bill_datetime?: string | null;
  creation?: string | null;
};

export type AccessionSummary = {
  date: string;
  received_today: number;
  rejected_today: number;
  pending: number;
  total_today: number;
};

export type AccessionTrfHit = {
  trf_id: string;
  patient_name?: string;
  patient_phone?: string;
  barcode?: string;
  order_status?: string;
  creation?: string;
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
  collection_tubes?: CollectionTubeRow[];
  gender?: string | null;
  age?: number | string | null;
  age_months?: number | string | null;
  age_days?: number | string | null;
  age_label?: string;
  journey_id?: string | null;
  journey_status?: string | null;
  report_pdf?: boolean;
  authorized_on?: string | null;
  report_ready?: boolean;
  report_delivered_on?: string | null;
  delivery_status?: 'delivered' | 'pending_delivery' | 'pending_report';
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
  sales_invoice?: string;
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

export type PhlebotomistReportUiStatus = 'ready' | 'processing' | 'delivered' | 'failed';

export type PhlebotomistReport = {
  journey_id: string | null;
  trf_id: string;
  patient_name: string;
  patient_phone?: string;
  gender?: string | null;
  age?: number | string | null;
  age_months?: number | string | null;
  age_days?: number | string | null;
  age_label?: string;
  barcode?: string;
  status: string;
  report_ui_status?: PhlebotomistReportUiStatus;
  report_pdf?: string | boolean | null;
  authorized_on?: string | null;
  report_delivered_on?: string | null;
  collection_slot?: string | null;
  creation?: string;
  test_name?: string;
  test_labels?: string[];
  report_no?: string;
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
  public_path?: string;
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
  includes?: string;
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
  if (lower.includes('pdf generation failed') || lower.includes('protocolunknown') || lower.includes('wkhtmltopdf')) {
    return 'PDF generation failed. Please retry.';
  }
  if (
    lower.includes('unknown column') ||
    lower.includes('(1054') ||
    lower.includes('operationalerror')
  ) {
    return 'Could not look up the patient’s mobile number. Please retry.';
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
    const obj = nested as Record<string, unknown>;
    if (obj.status === 'error') {
      throw new Error(String(obj.message || 'Request failed'));
    }
    // Standard HEC envelope: { status, message, data }
    if (obj.status === 'success' && 'data' in obj) {
      return obj as ApiEnvelope<T>;
    }
    // Raw whitelist payloads: { ok, tests } / { tubes } / etc.
    return {
      status: 'success',
      message: typeof obj.message === 'string' ? obj.message : 'OK',
      data: ('data' in obj ? obj.data : nested) as T,
    };
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
  module: ApiModule = 'main',
): Promise<void> {
  const sid = getSid();
  const params = new URLSearchParams({
    ...body,
    ...(sid ? { sid } : {}),
  });
  const res = await fetch(apiUrl(method, module), {
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
      footer?: SiteFooterPayload;
    }>('get_home_content', { auth: false }),

  getSiteFooter: () => request<SiteFooterPayload>('get_site_footer', { auth: false }),

  getSiteCmsPage: (pageKey: string) =>
    request<SiteCmsPage>('get_site_cms_page', {
      auth: false,
      module: 'siteFooter',
      body: { page_key: pageKey },
    }),

  getPublicSeoSettings: () =>
    request<PublicSeoSettings>('get_public_seo_settings', {
      auth: false,
      module: 'siteFooter',
    }),

  getSiteFaqs: () =>
    request<{ sections: SiteFaqSection[] }>('get_site_faqs', {
      auth: false,
      module: 'siteFooter',
    }),

  listBlogPosts: (opts?: { limit?: number; offset?: number; category?: string }) =>
    request<{ posts: BlogPostSummary[]; total: number; limit: number; offset: number }>(
      'list_blog_posts',
      {
        auth: false,
        module: 'blog',
        body: {
          limit: opts?.limit ?? 20,
          offset: opts?.offset ?? 0,
          ...(opts?.category ? { category: opts.category } : {}),
        },
      },
    ),

  getBlogPost: (slug: string) =>
    request<BlogPostDetail>('get_blog_post', {
      auth: false,
      module: 'blog',
      body: { slug },
    }),

  getPortalSeoSettings: () =>
    request<PortalSeoSettings>('get_portal_seo_settings', { auth: false, module: 'blog' }),

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

  /** Onboarded FFMS franchise centres (public; no ERP guest session required). */
  listPublicCentres: async (params?: {
    latitude?: number | null;
    longitude?: number | null;
    radius_km?: number | null;
  }) => {
    const query = new URLSearchParams();
    if (params?.latitude != null && params?.longitude != null) {
      query.set('latitude', String(params.latitude));
      query.set('longitude', String(params.longitude));
    }
    if (params?.radius_km != null && Number.isFinite(params.radius_km) && params.radius_km > 0) {
      query.set('radius_km', String(params.radius_km));
    }
    const url = `${rfmsApiUrl('public/centres')}${query.toString() ? `?${query}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });
    const text = await response.text();
    let payload: {
      success?: boolean;
      data?: { centres?: AiPhysicianCenter[]; centers?: AiPhysicianCenter[]; count?: number };
      message?: string;
      error?: { message?: string };
    } = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      if (response.status === 502 || text.trim().startsWith('<')) {
        throw new Error(
          'Server is temporarily unavailable (502). Backend may be restarting — wait 1 minute and try again, or run emergency-fix-502.sh on the server.',
        );
      }
      throw new Error('Could not load franchise centres');
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error?.message || payload.message || `Centres request failed (${response.status})`);
    }
    const centres = payload.data?.centres || payload.data?.centers || [];
    return {
      status: 'success' as const,
      data: { centers: centres, centres, count: payload.data?.count ?? centres.length },
    };
  },

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
      body: isB2bPortalHost() ? { usr, pwd, portal: 'partners' } : isVaultLogin() ? { usr, pwd, portal: 'vault' } : { usr, pwd },
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

  verifyOtpLogin: async (mobile: string, otp: string, referralCode?: string) => {
    const envelope = await request<SessionUser>('verify_otp_and_login', {
      method: 'POST',
      body: {
        mobile,
        otp,
        ...(referralCode ? { referral_code: referralCode } : {}),
      },
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
    request<{ orders: Booking[]; franchisee: Franchisee | null; in_route_trf?: string | null }>(
      'get_phlebotomist_collection_queue',
      {
        body: { limit },
        auth: true,
      },
    ),

  markSampleCollected: (trfId: string) =>
    request<{ trf_id: string; order_status: string }>('phlebotomist_mark_sample_collected', {
      method: 'POST',
      body: { trf_id: trfId },
      auth: true,
    }),

  startPhlebotomistVisit: (trfId: string) =>
    request<{ in_route_trf?: string | null }>('phlebotomist_start_visit', {
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

  getVoiceDashboard: (days = 7, department = '') =>
    request<VoiceDashboard>('get_voice_dashboard', {
      body: { days, ...(department ? { department } : {}) },
      auth: true,
      module: 'voiceAgent',
    }),

  listVoiceCalls: (filters: VoiceCallFilters = {}) =>
    request<{ calls: VoiceCallRow[]; total: number }>('list_voice_calls', {
      body: Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== null),
      ) as Record<string, string | number | boolean>,
      auth: true,
      module: 'voiceAgent',
    }),

  getVoiceCall: (name: string) =>
    request<VoiceCallDetail>('get_voice_call', { body: { name }, auth: true, module: 'voiceAgent' }),

  setVoiceCallQa: (name: string, qaStatus: 'Pending' | 'Pass' | 'Fail', qaNotes = '') =>
    request<{ name: string; qa_status: string }>('set_voice_call_qa', {
      method: 'POST',
      body: { name, qa_status: qaStatus, qa_notes: qaNotes },
      auth: true,
      module: 'voiceAgent',
    }),

  listVoiceAgents: () =>
    request<{ agents: VoiceAgent[]; tools: string[] }>('list_voice_agents', { auth: true, module: 'voiceAgent' }),

  saveVoiceAgent: (data: Partial<VoiceAgent>) =>
    request<{ name: string; prompt_version: number }>('save_voice_agent', {
      method: 'POST',
      body: { data: JSON.stringify(data) },
      auth: true,
      module: 'voiceAgent',
    }),

  testVoiceAgent: (agent: string, phone: string) =>
    request<VoiceStartResult>('test_voice_agent', {
      method: 'POST',
      body: { agent, phone },
      auth: true,
      module: 'voiceAgent',
    }),

  listVoiceCampaigns: () =>
    request<{ campaigns: VoiceCampaign[] }>('list_voice_campaigns', { auth: true, module: 'voiceAgent' }),

  getVoiceCampaign: (name: string) =>
    request<{ campaign: VoiceCampaign; contacts: VoiceCampaignContact[]; status_counts: Record<string, number> }>(
      'get_voice_campaign',
      { body: { name }, auth: true, module: 'voiceAgent' },
    ),

  saveVoiceCampaign: (data: Partial<VoiceCampaign> & { campaign_name?: string }) =>
    request<{ name: string }>('save_voice_campaign', {
      method: 'POST',
      body: { data: JSON.stringify(data) },
      auth: true,
      module: 'voiceAgent',
    }),

  addVoiceCampaignContacts: (campaign: string, mode: 'leads' | 'csv', csvText = '', limit = 500) =>
    request<{ added: number; skipped: number; total: number }>('add_voice_campaign_contacts', {
      method: 'POST',
      body: { campaign, mode, csv_text: csvText, limit },
      auth: true,
      module: 'voiceAgent',
    }),

  setVoiceCampaignStatus: (campaign: string, status: VoiceCampaign['status']) =>
    request<{ name: string; status: string }>('set_voice_campaign_status', {
      method: 'POST',
      body: { campaign, status },
      auth: true,
      module: 'voiceAgent',
    }),

  searchVoiceLeads: (department: VoiceDepartment, query: string) =>
    request<{ leads: VoiceLeadHit[] }>('search_voice_leads', {
      body: { department, query },
      auth: true,
      module: 'voiceAgent',
    }),

  startAiCallForLead: (leadDoctype: string, leadName: string, agent = '') =>
    request<VoiceStartResult>('start_ai_call_for_lead', {
      method: 'POST',
      body: { lead_doctype: leadDoctype, lead_name: leadName, ...(agent ? { agent } : {}) },
      auth: true,
      module: 'voiceAgent',
    }),

  getLeadCallHistory: (leadDoctype: string, leadName: string) =>
    request<{ calls: VoiceLeadCall[] }>('get_lead_call_history', {
      body: { lead_doctype: leadDoctype, lead_name: leadName },
      auth: true,
      module: 'voiceAgent',
    }),

  listDoNotCall: (query = '') =>
    request<{ numbers: VoiceDncRow[] }>('list_do_not_call', {
      body: query ? { query } : {},
      auth: true,
      module: 'voiceAgent',
    }),

  addDoNotCall: (phone: string, reason: string, notes = '') =>
    request<{ added: number }>('add_do_not_call', {
      method: 'POST',
      body: { phone, reason, notes },
      auth: true,
      module: 'voiceAgent',
    }),

  removeDoNotCall: (phone: string) =>
    request<{ removed: string }>('remove_do_not_call', {
      method: 'POST',
      body: { phone },
      auth: true,
      module: 'voiceAgent',
    }),

  getMyVoiceSchedule: (days = 14) =>
    request<VoiceSchedule>('get_my_voice_schedule', { body: { days }, auth: true, module: 'voiceAgent' }),

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

  uploadPeopleLeaveAttachment: (leave: string, fileName: string, fileData: string) =>
    request<{ leave: string; attachments: Array<{ id: string; file_name: string; size: number; uploaded_on: string }> }>(
      'upload_people_leave_attachment',
      { method: 'POST', body: { leave, file_name: fileName, file_data: fileData }, auth: true, module: 'leaveAttach' },
    ),

  getPeopleLeaveAttachments: (leave: string) =>
    request<{ leave: string; attachments: Array<{ id: string; file_name: string; size: number; uploaded_on: string }> }>(
      'get_people_leave_attachments',
      { method: 'POST', body: { leave }, auth: true, module: 'leaveAttach' },
    ),

  openPeopleLeaveAttachment: (file: string) =>
    request<{ file_name: string; mime: string; data: string }>('open_people_leave_attachment', {
      method: 'POST',
      body: { file },
      auth: true,
      module: 'leaveAttach',
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

  markOfflinePaymentCollected: (
    referenceDoctype: string,
    referenceName: string,
    collectionMode: CollectionMode = 'cash',
    collectionReference = '',
  ) =>
    request<{
      status: string;
      payment_method?: string;
      hub_billing?: { status: 'billed' | 'pending' | 'already_billed'; reason?: string; wholesale_amount?: number } | null;
    }>('mark_offline_payment_collected', {
      method: 'POST',
      body: {
        reference_doctype: referenceDoctype,
        reference_name: referenceName,
        collection_mode: collectionMode,
        collection_reference: collectionReference,
      },
      auth: true,
    }),

  getPhlebotomistReports: (limit = 200) =>
    request<{ reports: PhlebotomistReport[] }>('get_phlebotomist_reports', {
      body: { limit },
      auth: true,
    }),

  getPhlebotomistMyCollections: (limit = 100) =>
    request<{ orders: Booking[] }>('get_phlebotomist_my_collections', {
      body: { limit },
      auth: true,
    }),

  deliverPhlebotomistReport: (trfId: string) =>
    request<{ trf_id: string; report_delivered_on?: string; journey_id?: string }>(
      'phlebotomist_deliver_report',
      {
        method: 'POST',
        body: { trf_id: trfId },
        auth: true,
      },
    ),

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

  getAllBookings: (query: AllBookingsQuery = {}) =>
    request<AllBookingsResponse>('get_all_bookings', {
      method: 'POST',
      body: Object.fromEntries(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
      ) as Record<string, string | number>,
      auth: true,
      module: 'bookingLifecycle',
    }),

  getBookingLifecycleDetail: (trfId: string) =>
    request<BookingLifecycleDetail>('get_booking_lifecycle_detail', {
      method: 'POST',
      body: { trf_id: trfId },
      auth: true,
      module: 'bookingLifecycle',
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

  getTeleconsultSession: (appointmentId: string, token?: string) =>
    request<{ session: TeleconsultSession }>('get_teleconsult_session', {
      method: 'POST',
      body: {
        appointment_id: appointmentId,
        ...(token ? { token } : {}),
      },
      auth: !token,
      module: 'telemedicine',
    }),

  joinVideoSession: (appointmentId: string, token?: string) =>
    request<{
      appointment_id: string;
      meeting_link: string;
      portal_join_url?: string;
      patient_name?: string;
      doctor_name?: string;
      appointment_date?: string;
      appointment_time?: string;
      provider?: string;
    }>('join_video_session', {
      method: 'POST',
      body: {
        appointment_id: appointmentId,
        ...(token ? { token } : {}),
      },
      auth: !token,
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
    request<{
      appointment_id: string;
      amount?: number;
      meeting_link?: string;
      portal_join_url?: string;
      consultation_mode?: string;
      session_card?: string;
      sessions_remaining?: number;
      wellness_wing?: string;
    }>('book_allied_health_appointment', {
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

  getOrCreateEncounter: (appointmentId: string) =>
    request<{
      encounter: ClinicalEncounter;
      appointment: {
        appointment_id: string;
        patient_name?: string;
        appointment_date?: string;
        appointment_time?: string;
        consultation_mode?: string;
        status?: string;
      };
      created: boolean;
    }>('get_or_create_encounter', {
      method: 'POST',
      body: { appointment_id: appointmentId },
      auth: true,
      module: 'clinicalEncounter',
    }),

  saveEncounter: (body: {
    encounter_id: string;
    chief_complaint?: string;
    history_of_present_illness?: string;
    examination?: string;
    assessment?: string;
    plan?: string;
    diagnosis?: string;
    vitals_json?: string | Record<string, unknown>;
    specialty_template?: string;
  }) =>
    request<{ encounter: ClinicalEncounter }>('save_encounter', {
      method: 'POST',
      body: {
        encounter_id: body.encounter_id,
        ...(body.chief_complaint != null ? { chief_complaint: body.chief_complaint } : {}),
        ...(body.history_of_present_illness != null
          ? { history_of_present_illness: body.history_of_present_illness }
          : {}),
        ...(body.examination != null ? { examination: body.examination } : {}),
        ...(body.assessment != null ? { assessment: body.assessment } : {}),
        ...(body.plan != null ? { plan: body.plan } : {}),
        ...(body.diagnosis != null ? { diagnosis: body.diagnosis } : {}),
        ...(body.vitals_json != null
          ? {
              vitals_json:
                typeof body.vitals_json === 'string'
                  ? body.vitals_json
                  : JSON.stringify(body.vitals_json),
            }
          : {}),
        ...(body.specialty_template != null ? { specialty_template: body.specialty_template } : {}),
      },
      auth: true,
      module: 'clinicalEncounter',
    }),

  finalizeEncounterAndRx: (body: {
    encounter_id: string;
    medicines?: PrescriptionMedicineLine[];
    diagnostics?: PrescriptionDiagnosticLine[];
    submit?: boolean;
  }) =>
    request<{ encounter: ClinicalEncounter; prescription?: ClinicalPrescription }>(
      'finalize_encounter_and_rx',
      {
        method: 'POST',
        body: {
          encounter_id: body.encounter_id,
          medicines: JSON.stringify(body.medicines || []),
          diagnostics: JSON.stringify(body.diagnostics || []),
          submit: body.submit === false ? 0 : 1,
        },
        auth: true,
        module: 'clinicalEncounter',
      },
    ),

  scribeConsultationAudio: (body: {
    audio_base64: string;
    filename?: string;
    encounter_id?: string;
  }) =>
    request<{
      transcript: string;
      structured: Record<string, string>;
      encounter_id?: string;
    }>('scribe_consultation_audio', {
      method: 'POST',
      body,
      auth: true,
      module: 'aiPractice',
    }),

  suggestDifferentials: (clinicalText: string, encounterId?: string) =>
    request<{
      suggestions: {
        differentials: Array<{ name: string; rationale?: string; urgency?: string }>;
        cautions?: string[];
        source?: string;
      };
    }>('suggest_differentials', {
      method: 'POST',
      body: {
        clinical_text: clinicalText,
        ...(encounterId ? { encounter_id: encounterId } : {}),
      },
      auth: true,
      module: 'aiPractice',
    }),

  smartsyncParsePrescription: (body: {
    image_base64?: string;
    mime_type?: string;
    raw_text?: string;
  }) =>
    request<{
      ocr_text: string;
      medicines: Array<{
        raw_name?: string;
        dosage?: string;
        frequency?: string;
        duration?: string;
        matches?: Array<{ name: string; item_name?: string }>;
        best?: { name: string; item_name?: string } | null;
      }>;
      diagnostics: Array<{
        raw_name?: string;
        matches?: Array<{ name: string; test_name?: string }>;
        best?: { name: string; test_name?: string } | null;
      }>;
      notes?: string;
    }>('smartsync_parse_prescription', {
      method: 'POST',
      body,
      auth: true,
      module: 'aiPractice',
    }),

  listCarePrograms: () =>
    request<{ programs: CareProgram[] }>('list_care_programs', {
      method: 'POST',
      auth: true,
      module: 'carePrograms',
    }),

  enrollCareProgram: (programCode: string, assessmentAnswers?: Record<string, unknown>) =>
    request<{ enrollment: CareEnrollment; already?: boolean }>('enroll_care_program', {
      method: 'POST',
      body: {
        program_code: programCode,
        ...(assessmentAnswers ? { assessment_answers: JSON.stringify(assessmentAnswers) } : {}),
      },
      auth: true,
      module: 'carePrograms',
    }),

  getMyCareEnrollments: () =>
    request<{ enrollments: CareEnrollment[] }>('get_my_care_enrollments', {
      method: 'POST',
      auth: true,
      module: 'carePrograms',
    }),

  getCareDashboard: (enrollmentId: string) =>
    request<{
      enrollment: CareEnrollment;
      vitals: CareVital[];
      tasks: CareTask[];
    }>('get_care_dashboard', {
      method: 'POST',
      body: { enrollment_id: enrollmentId },
      auth: true,
      module: 'carePrograms',
    }),

  logPatientVital: (body: {
    enrollment_id: string;
    vital_type: string;
    value: number;
    unit?: string;
    notes?: string;
  }) =>
    request<{
      vital: { name: string; vital_type: string; value: number; out_of_range: boolean };
      health_score: number;
      adherence_percent: number;
    }>('log_patient_vital', {
      method: 'POST',
      body,
      auth: true,
      module: 'carePrograms',
    }),

  completeCareTask: (taskId: string) =>
    request<{ task_id: string; health_score: number; adherence_percent: number }>(
      'complete_care_task',
      {
        method: 'POST',
        body: { task_id: taskId },
        auth: true,
        module: 'carePrograms',
      },
    ),

  getPatientCareStrip: (patientId: string) =>
    request<{ enrollments: CareEnrollment[]; alerts: CareVitalAlert[] }>('get_patient_care_strip', {
      method: 'POST',
      body: { patient_id: patientId },
      auth: true,
      module: 'carePrograms',
    }),

  getMyAbha: () =>
    request<{ abha: AbhaProfile | null }>('get_my_abha', {
      method: 'POST',
      auth: true,
      module: 'abha',
    }),

  linkAbhaId: (body: {
    abha_number?: string;
    abha_address?: string;
    consent?: boolean;
    consent_note?: string;
    patient_id?: string;
  }) =>
    request<{ abha: AbhaProfile }>('link_abha_id', {
      method: 'POST',
      body: {
        ...(body.abha_number ? { abha_number: body.abha_number } : {}),
        ...(body.abha_address ? { abha_address: body.abha_address } : {}),
        consent: body.consent === false ? 0 : 1,
        ...(body.consent_note ? { consent_note: body.consent_note } : {}),
        ...(body.patient_id ? { patient_id: body.patient_id } : {}),
      },
      auth: true,
      module: 'abha',
    }),

  getPatientAbha: (patientId: string) =>
    request<{ abha: AbhaProfile }>('get_patient_abha', {
      method: 'POST',
      body: { patient_id: patientId },
      auth: true,
      module: 'abha',
    }),

  getMyPracticeAnalytics: (days = 30) =>
    request<{
      doctor?: string;
      days: number;
      kpis: Record<string, number>;
    }>('get_my_practice_analytics', {
      method: 'POST',
      body: { days },
      auth: true,
      module: 'practiceAnalytics',
    }),

  listOpdVisitPacks: () =>
    request<{
      plans: Array<{
        name: string;
        plan_code?: string;
        title: string;
        description?: string;
        monthly_price?: number;
        included_opd_visits?: number;
        lab_discount_percent?: number;
        pharmacy_discount_percent?: number;
      }>;
    }>('list_opd_visit_packs', {
      method: 'POST',
      auth: true,
      module: 'practiceAnalytics',
    }),

  consumeOpdVisitEntitlement: (appointmentId: string) =>
    request<{
      appointment_id: string;
      subscription: string;
      opd_visits_remaining: number;
      amount: number;
    }>('consume_opd_visit_entitlement', {
      method: 'POST',
      body: { appointment_id: appointmentId },
      auth: true,
      module: 'practiceAnalytics',
    }),

  listSpecialtyTemplates: () =>
    request<{
      templates: Array<{
        code: string;
        title: string;
        chief_complaint_hint?: string;
        examination_hint?: string;
        plan_hint?: string;
      }>;
    }>('list_specialty_templates', {
      method: 'POST',
      auth: true,
      module: 'researchLite',
    }),

  listStudyProtocols: () =>
    request<{
      protocols: Array<{
        name: string;
        protocol_code?: string;
        title: string;
        condition?: string;
        description?: string;
      }>;
    }>('list_study_protocols', {
      method: 'POST',
      auth: true,
      module: 'researchLite',
    }),

  attachStudyConsent: (enrollmentId: string, protocolCode: string) =>
    request<{ enrollment_id: string; study_protocol: string }>('attach_study_consent', {
      method: 'POST',
      body: { enrollment_id: enrollmentId, protocol_code: protocolCode, consent: 1 },
      auth: true,
      module: 'researchLite',
    }),

  getAbdmStatus: () =>
    request<{
      enabled: boolean | number;
      environment: string;
      credentials_ready: boolean;
      otp_stub_mode: boolean | number;
      certification_status: string;
      marketing_claim_allowed: boolean | number;
      facility_id?: string;
      hip_id?: string;
    }>('get_abdm_status', {
      method: 'POST',
      body: {},
      auth: true,
      module: 'abdm',
    }),

  requestAbhaOtp: (payload?: { mobile?: string; abha_number?: string }) =>
    request<{ stub?: boolean; txn?: string; hint?: string; expires_in_sec?: number }>('request_abha_otp', {
      method: 'POST',
      body: payload || {},
      auth: true,
      module: 'abdm',
    }),

  verifyAbhaOtp: (payload: { otp: string; abha_number?: string; abha_address?: string }) =>
    request<{ abha?: { abha_number?: string; abha_address?: string; abha_verification_status?: string } }>(
      'verify_abha_otp',
      {
        method: 'POST',
        body: payload,
        auth: true,
        module: 'abdm',
      },
    ),

  buildDhisClaimPack: (month?: number, year?: number) =>
    request<{
      pack: {
        period: string;
        submitted_prescriptions: number;
        abha_verified_prescriptions: number;
        final_encounters: number;
        disclaimer: string;
      };
    }>('build_dhis_claim_pack', {
      method: 'POST',
      body: {
        ...(month != null ? { month } : {}),
        ...(year != null ? { year } : {}),
      },
      auth: true,
      module: 'abdm',
    }),

  listKnowledgeArticles: (specialty?: string) =>
    request<{
      articles: Array<{
        name: string;
        article_code: string;
        title: string;
        specialty: string;
        summary: string;
        source_name?: string;
        external_url?: string;
        pmid?: string;
      }>;
    }>('list_knowledge_articles', {
      method: 'POST',
      body: { specialty: specialty || '' },
      auth: true,
      module: 'knowledge',
    }),

  searchPubMed: (q: string) =>
    request<{
      results: Array<{
        pmid?: string | null;
        title: string;
        source?: string;
        pubdate?: string;
        authors?: string;
        external_url?: string;
        curated?: boolean;
      }>;
      cached?: boolean;
      fallback?: boolean;
    }>('search_pubmed', {
      method: 'POST',
      body: { q },
      auth: true,
      module: 'knowledge',
    }),

  listStudyOpsProtocols: () =>
    request<{
      protocols: Array<{
        name: string;
        protocol_code?: string;
        title?: string;
        condition?: string;
        description?: string;
        care_program?: string;
      }>;
    }>('list_study_ops_protocols', {
      method: 'POST',
      body: {},
      auth: true,
      module: 'studyOps',
    }),

  getStudyFunnel: (protocolCode: string) =>
    request<{
      protocol: string;
      funnel: Record<string, number>;
      subject_count: number;
      sites: Array<{ name: string; site_code: string; site_name: string; target_n?: number; status?: string }>;
      disclaimer?: string;
    }>('get_study_funnel', {
      method: 'POST',
      body: { protocol_code: protocolCode },
      auth: true,
      module: 'studyOps',
    }),

  exportStudyDataset: (protocolCode: string) =>
    request<{
      package: {
        protocol: string;
        exported_at: string;
        subjects: Array<Record<string, unknown>>;
        data_dictionary: Record<string, string>;
        disclaimer?: string;
      };
    }>('export_study_dataset', {
      method: 'POST',
      body: { protocol_code: protocolCode },
      auth: true,
      module: 'studyOps',
    }),

  getClinicalPrescription: (prescriptionId: string) =>
    request<{ prescription: ClinicalPrescription }>('get_clinical_prescription', {
      method: 'POST',
      body: { prescription_id: prescriptionId },
      auth: true,
      module: 'prescriptions',
    }),

  getPrescriptionPrintHtml: (prescriptionId: string, letterheadPlain = false) =>
    fetchRawMessage(
      'get_prescription_print_html',
      { prescription_id: prescriptionId, letterhead_plain: letterheadPlain ? '1' : '0' },
      'ePrescribeFormat',
    ),

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


  getPharmacyOrderInvoice: (orderId: string) =>
    request<{
      order_id: string;
      sales_invoice?: string;
      invoice_pdf_url?: string;
      items: unknown[];
      order_total: number;
      payment_id?: string;
      payment_mode?: string;
    }>('get_pharmacy_order_invoice', {
      method: 'POST',
      body: { order_id: orderId },
      auth: true,
    }),

  getFollowupSystem: () =>
    request<{ available: boolean; apis: Record<string, string> }>('get_followup_system', {
      method: 'POST',
      auth: false,
    }),

  listFollowups: (limit = 50) =>
    request<{ sessions?: unknown[] }>('list_followups', {
      method: 'POST',
      body: { limit },
      auth: true,
    }),

  scheduleFollowup: (body: Record<string, string | number | boolean>) =>
    request<Record<string, unknown>>('schedule_followup', {
      method: 'POST',
      body,
      auth: true,
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

  listWellnessSessionPacks: (wingId?: string) =>
    request<{
      packs: Array<{
        plan_code: string;
        title: string;
        description?: string;
        price: number;
        billing_interval?: string;
        wellness_wing?: string;
        included_sessions: number;
        unlimited?: boolean;
      }>;
      wings: string[];
    }>('list_wellness_session_packs', {
      method: 'POST',
      body: wingId ? { wing_id: wingId } : {},
      auth: false,
      module: 'wellnessSessions',
    }),

  getMySessionCards: (wingId?: string) =>
    request<{
      cards: Array<{
        subscription_id: string;
        status: string;
        plan_code?: string;
        title?: string;
        description?: string;
        wellness_wing?: string;
        sessions_total: number;
        sessions_remaining: number;
        sessions_used: number;
        unlimited?: boolean;
        last_session_on?: string | null;
      }>;
    }>('get_my_session_cards', {
      method: 'POST',
      body: wingId ? { wing_id: wingId } : {},
      auth: true,
      module: 'wellnessSessions',
    }),

  purchaseSessionCard: (planCode: string, paymentMethod?: string) =>
    request<{ card: Record<string, unknown>; pending_payment?: boolean }>('purchase_session_card', {
      method: 'POST',
      body: {
        plan_code: planCode,
        ...(paymentMethod ? { payment_method: paymentMethod } : {}),
      },
      auth: true,
      module: 'wellnessSessions',
    }),

  punchSessionCard: (subscriptionId: string, appointmentId?: string) =>
    request<{ card: Record<string, unknown>; sessions_remaining: number }>('punch_session_card', {
      method: 'POST',
      body: {
        subscription_id: subscriptionId,
        ...(appointmentId ? { appointment_id: appointmentId } : {}),
      },
      auth: true,
      module: 'wellnessSessions',
    }),

  listSessionCardOps: (wingId?: string, limit = 50) =>
    request<{ appointments: Array<Record<string, unknown>> }>('list_session_card_ops', {
      method: 'POST',
      body: {
        limit,
        ...(wingId ? { wing_id: wingId } : {}),
      },
      auth: true,
      module: 'wellnessSessions',
    }),

  ensureRemediumCareSetup: () =>
    request<{
      doctypes: string[];
      packs: string[];
      items: string[];
      zones: Record<string, unknown>;
    }>('ensure_remedium_care_setup', { method: 'POST', auth: true, module: 'remediumCare' }),

  getCareZones: () =>
    request<{ zones: Record<string, unknown>; packages: string[] }>('get_care_zones', {
      method: 'POST',
      auth: false,
      module: 'remediumCare',
    }),

  submitCareIntake: (payload: {
    appointment_id?: string;
    chief_complaint: string;
    history_json?: string;
    consent: string;
    sensory_notes?: string;
  }) =>
    request<{ intake: Record<string, unknown> }>('submit_care_intake', {
      method: 'POST',
      body: payload,
      auth: true,
      module: 'remediumCare',
    }),

  getCareIntake: (appointmentId?: string) =>
    request<{
      intake: {
        name: string;
        chief_complaint?: string;
        history?: Record<string, unknown>;
        status?: string;
      } | null;
    }>('get_care_intake', {
      method: 'POST',
      body: appointmentId ? { appointment_id: appointmentId } : {},
      auth: true,
      module: 'remediumCare',
    }),

  markCareCheckin: (appointmentId: string, arrived = true) =>
    request<{ appointment_id: string; care_arrived: number }>('mark_care_checkin', {
      method: 'POST',
      body: { appointment_id: appointmentId, arrived: arrived ? '1' : '0' },
      auth: true,
      module: 'remediumCare',
    }),

  createCareBlueprint: (payload: {
    patient: string;
    package?: string;
    chief_complaint?: string;
    timeline_weeks?: number | string;
    appointment_id?: string;
    baseline_pain?: number | string;
    baseline_mobility?: number | string;
    attach_pack?: string;
    clinical_notes?: string;
  }) =>
    request<{ blueprint: Record<string, unknown>; session_card?: string }>('create_care_blueprint', {
      method: 'POST',
      body: payload,
      auth: true,
      module: 'remediumCare',
    }),

  getMyCareBlueprints: () =>
    request<{ blueprints: Array<Record<string, unknown>> }>('get_my_care_blueprints', {
      method: 'POST',
      auth: true,
      module: 'remediumCare',
    }),

  getCareBlueprint: (blueprintId: string) =>
    request<{ blueprint: Record<string, unknown> }>('get_care_blueprint', {
      method: 'POST',
      body: { blueprint_id: blueprintId },
      auth: true,
      module: 'remediumCare',
    }),

  updateCareBlueprint: (blueprintId: string, fields: Record<string, string | number>) =>
    request<{ blueprint: Record<string, unknown> }>('update_care_blueprint', {
      method: 'POST',
      body: { blueprint_id: blueprintId, ...fields },
      auth: true,
      module: 'remediumCare',
    }),

  logCareZoneSession: (payload: {
    blueprint_id: string;
    zone: string;
    modality: string;
    therapist?: string;
    duration_minutes?: number | string;
    notes?: string;
    appointment_id?: string;
    punch_card?: string;
  }) =>
    request<{ log: Record<string, unknown>; blueprint: Record<string, unknown> }>('log_care_zone_session', {
      method: 'POST',
      body: payload,
      auth: true,
      module: 'remediumCare',
    }),

  listCareOpsQueue: (limit = 50) =>
    request<{
      blueprints: Array<Record<string, unknown>>;
      checkins: Array<Record<string, unknown>>;
      zone_board: Record<string, { label: string; ashoknagar_label?: string; today: number }>;
      zones: Record<string, unknown>;
    }>('list_care_ops_queue', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'remediumCare',
    }),

  generateCareProgressReport: (blueprintId: string) =>
    request<{ report: Record<string, unknown> }>('generate_care_progress_report', {
      method: 'POST',
      body: { blueprint_id: blueprintId },
      auth: true,
      module: 'remediumCare',
    }),

  getMyCareProgressReports: (blueprintId?: string) =>
    request<{ reports: Array<Record<string, unknown>> }>('get_my_care_progress_reports', {
      method: 'POST',
      body: blueprintId ? { blueprint_id: blueprintId } : {},
      auth: true,
      module: 'remediumCare',
    }),

  uploadCareGaitSnapshot: (payload: {
    blueprint_id: string;
    snapshot_url?: string;
    metadata_json?: string;
    red_zone_tags?: string;
  }) =>
    request<{ blueprint: Record<string, unknown> }>('upload_care_gait_snapshot', {
      method: 'POST',
      body: payload,
      auth: true,
      module: 'remediumCare',
    }),

  listWellnessVideos: (wingId?: string) =>
    request<{
      videos: Array<{
        name?: string;
        video_code?: string;
        wing_id?: string;
        title: string;
        topic?: string;
        youtube_id: string;
        youtube_url?: string;
        sort_order?: number;
      }>;
      wing_id?: string | null;
      count: number;
      wings?: string[];
    }>('list_wellness_videos', {
      method: 'POST',
      body: wingId ? { wing_id: wingId } : {},
      auth: false,
      module: 'wellnessVideos',
    }),

  setupWellnessVideoCms: (forceUpdate?: boolean) =>
    request<{
      doctype: string;
      created_doctype: boolean;
      seed: { created: string[]; updated: string[] };
      desk_path: string;
    }>('setup_wellness_video_cms', {
      method: 'POST',
      body: forceUpdate ? { force_update: '1' } : {},
      auth: true,
      module: 'wellnessVideos',
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


  getVolumeHiringKpis: (days = 7) =>
    request<VolumeHiringKpis>('get_volume_hiring_kpis', {
      method: 'POST',
      body: { days },
      auth: true,
      module: 'wbHiring',
    }),

  seedWbEvergreenRoles: () =>
    request<{ seeded: Array<Record<string, unknown>> }>('seed_wb_evergreen_roles', {
      method: 'POST',
      auth: true,
      module: 'wbHiring',
    }),

  setupWbHiring: () =>
    request<Record<string, unknown>>('setup_wb_hiring', {
      method: 'POST',
      auth: true,
      module: 'wbHiring',
    }),

  ingestHiringBiodata: (body: Record<string, string | number | boolean>) =>
    request<{ application_id: string; parsed?: Record<string, unknown>; source?: string }>(
      'ingest_hiring_biodata',
      { method: 'POST', body, auth: false, module: 'wbHiring' },
    ),
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
    request<{
      offer_id: string;
      status: string;
      pipeline_stage: string;
      email_status?: string;
      email_pack?: {
        ok?: boolean;
        letter_type?: string;
        grade?: string;
        structure?: string;
        subject?: string;
        recipient_email?: string;
      };
    }>('create_job_offer', {
      method: 'POST',
      body: {
        application: body.application,
        ...(body.designation ? { designation: body.designation } : {}),
        ...(body.department ? { department: body.department } : {}),
        ...(body.joining_date ? { joining_date: body.joining_date } : {}),
        ...(body.salary_offered != null ? { salary_offered: body.salary_offered } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
        send: body.send ?? 0,
      },
      auth: true,
      module: 'hiringPipeline',
    }),

  getJobOfferEmail: (offer: string) =>
    request<{
      offer_id: string;
      status?: string;
      email_status?: string;
      recipient_email?: string;
      email_subject?: string;
      grade?: string;
      salary_structure?: string;
      letter_type?: string;
      salary_offered?: number;
      designation?: string;
      joining_date?: string | null;
      html?: string;
    }>('get_job_offer_email', {
      method: 'POST',
      body: { offer },
      auth: true,
      module: 'hiringPipeline',
    }),

  sendJobOfferEmail: (offer: string) =>
    request<{
      ok: boolean;
      offer_id: string;
      status: string;
      email_status: string;
      recipient_email: string;
      subject?: string;
      via?: string;
    }>('send_job_offer_email', {
      method: 'POST',
      body: { offer },
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

  hireApplicantToPeople: (body: {
    application: string;
    designation?: string;
    department?: string;
    joining_date?: string;
    salary_offered?: number;
    roles?: string[];
  }) =>
    request<{
      application: string;
      user: string;
      user_created: boolean;
      temporary_password?: string;
      employee: string;
      roles: string[];
      monthly_ctc: number;
      people_path: string;
      people_sync?: { employee_id?: string; monthly_ctc?: number; hr_available?: boolean };
      pipeline_stage: string;
    }>('hire_applicant_to_people', {
      method: 'POST',
      body: {
        application: body.application,
        ...(body.designation ? { designation: body.designation } : {}),
        ...(body.department ? { department: body.department } : {}),
        ...(body.joining_date ? { joining_date: body.joining_date } : {}),
        ...(body.salary_offered != null ? { salary_offered: body.salary_offered } : {}),
        ...(body.roles?.length ? { roles: JSON.stringify(body.roles) } : {}),
        create_offer_if_missing: 1,
      },
      auth: true,
      module: 'hiringPipeline',
    }),

  getStaffPlanningCatalog: () =>
    request<{
      role_benchmarks: Array<{
        staff_role: string;
        designation: string;
        department: string;
        kpis: string[];
        kras: string[];
        median_ctc: number;
      }>;
      kra_library: Array<{ name: string; title?: string; description?: string }>;
      employment_types: string[];
      staff_roles: string[];
      disclaimer: string;
    }>('get_staff_planning_catalog', { method: 'POST', auth: true, module: 'staffPlanning' }),

  listStaffPlans: (status?: string) =>
    request<{
      plans: Array<{
        name: string;
        title: string;
        designation?: string;
        department?: string;
        status?: string;
        desired_ctc?: number;
        market_median_ctc?: number;
        job_opening?: string;
        headcount?: number;
      }>;
    }>('list_staff_plans', {
      method: 'POST',
      body: status ? { status } : {},
      auth: true,
      module: 'staffPlanning',
    }),

  getStaffPlan: (plan: string) =>
    request<StaffPlanDetail>('get_staff_plan', {
      method: 'POST',
      body: { plan },
      auth: true,
      module: 'staffPlanning',
    }),

  createStaffPlan: (body: {
    title?: string;
    designation: string;
    department?: string;
    staff_role?: string;
    location?: string;
    employment_type?: string;
    headcount?: number;
    kra_json?: string[];
    kpi_json?: string[];
    jd_text?: string;
    notes?: string;
  }) => {
    const payload: Record<string, string | number | boolean> = {
      designation: body.designation,
      headcount: body.headcount || 1,
    };
    if (body.title) payload.title = body.title;
    if (body.department) payload.department = body.department;
    if (body.staff_role) payload.staff_role = body.staff_role;
    if (body.location) payload.location = body.location;
    if (body.employment_type) payload.employment_type = body.employment_type;
    if (body.jd_text) payload.jd_text = body.jd_text;
    if (body.notes) payload.notes = body.notes;
    if (body.kra_json) payload.kra_json = JSON.stringify(body.kra_json);
    if (body.kpi_json) payload.kpi_json = JSON.stringify(body.kpi_json);
    return request<{ plan: StaffPlanDetail }>('create_staff_plan', {
      method: 'POST',
      body: payload,
      auth: true,
      module: 'staffPlanning',
    });
  },
  researchMarketCtc: (plan: string) =>
    request<{ plan?: StaffPlanDetail; research: StaffPlanResearch }>('research_market_ctc', {
      method: 'POST',
      body: { plan },
      auth: true,
      module: 'staffPlanning',
    }),

  setDesiredCtc: (plan: string, desiredCtc?: number, useMarketMedian?: boolean) =>
    request<{ plan: StaffPlanDetail }>('set_desired_ctc', {
      method: 'POST',
      body: {
        plan,
        ...(desiredCtc != null ? { desired_ctc: desiredCtc } : {}),
        ...(useMarketMedian ? { use_market_median: 1 } : {}),
      },
      auth: true,
      module: 'staffPlanning',
    }),

  publishStaffPlanToCareers: (plan: string) =>
    request<{
      plan: StaffPlanDetail;
      job_opening: string;
      careers_jobs_url: string;
      careers_apply_url: string;
      already_published?: boolean;
    }>('publish_staff_plan_to_careers', {
      method: 'POST',
      body: { plan },
      auth: true,
      module: 'staffPlanning',
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

  getB2bStatements: (limit = 200) =>
    request<{ lines: B2bStatementLine[]; summary: Record<string, number> }>(
      'get_b2b_statements',
      { method: 'POST', auth: true, body: { limit } },
    ),

  getB2bFocoCentres: () =>
    request<{
      foco: string;
      override_upsell_commission: number;
      profit_from_centre: number;
      pending_fofo_earnings: number;
      centres: B2bFocoCentreRow[];
    }>('get_b2b_foco_centres', { method: 'POST', auth: true }),

  getB2bFofoCommission: () =>
    request<{
      override_upsell_commission: number;
      lines: B2bFofoCommissionLine[];
      summary: Record<string, number>;
    }>('get_b2b_fofo_commission', { method: 'POST', auth: true }),

  getB2bWallet: (limit = 80) =>
    request<B2bWalletPayload>('get_b2b_wallet', { method: 'POST', auth: true, body: { limit } }),

  getPartnerCircuit: () => request<PartnerCircuit>('get_partner_circuit', { method: 'POST', auth: true }),

  getPartnerEarnings: (limit = 200) =>
    request<PartnerEarningsPayload>('get_partner_earnings', { method: 'POST', auth: true, body: { limit } }),

  getPartnerShipments: () =>
    request<PartnerShipmentsPayload>('get_partner_shipments', { method: 'POST', auth: true }),

  getPartnerVectorBills: () =>
    request<PartnerVectorBillsPayload>('get_partner_vector_bills', { method: 'POST', auth: true }),

  settlePartnerVectorBill: (bill: string, remarks?: string) =>
    request<PartnerVectorBill>('settle_partner_vector_bill', {
      method: 'POST',
      auth: true,
      body: { bill, remarks: remarks || '' },
    }),

  getPartnerPricingChart: (configuredOnly = false) =>
    request<PartnerPricingChart>('get_partner_pricing_chart', {
      method: 'POST',
      auth: true,
      body: { configured_only: configuredOnly ? 1 : 0 },
    }),

  savePartnerPricingRows: (rows: PartnerPricingRowInput[]) =>
    request<PartnerPricingImportReport>('save_partner_pricing_rows', {
      method: 'POST',
      auth: true,
      body: { rows: JSON.stringify(rows) },
    }),

  exportPartnerPricing: (fmt: 'xlsx' | 'pdf', configuredOnly = false) =>
    request<{ filename: string; mimetype: string; content_base64: string }>('export_partner_pricing', {
      method: 'POST',
      auth: true,
      body: { fmt, configured_only: configuredOnly ? 1 : 0 },
    }),

  importPartnerPricing: (filename: string, contentBase64: string, dryRun: boolean) =>
    request<PartnerPricingImportReport>('import_partner_pricing', {
      method: 'POST',
      auth: true,
      body: { filename, content: contentBase64, dry_run: dryRun ? 1 : 0 },
    }),

  createPartnerShipment: (shipment: {
    trfs: string[];
    lr_number?: string;
    courier?: string;
    icebox_temp_c?: number | string;
    remarks?: string;
  }) =>
    request<{ shipment: PartnerShipment; mf_credits_posted: number }>('create_partner_shipment', {
      method: 'POST',
      auth: true,
      body: { shipment: JSON.stringify(shipment) },
    }),

  receivePartnerShipment: (shipment: string) =>
    request<{ shipment: PartnerShipment; mf_credits_posted: number }>('receive_partner_shipment', {
      method: 'POST',
      auth: true,
      body: { shipment },
    }),

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

  getPaymentCoreStatus: () =>
    request<PaymentCoreStatus>('get_payment_core_status', { auth: true, module: 'paymentCore' }),

  uploadBankStatement: (filename: string, contentB64: string) =>
    request<{ rows: number; created: number; duplicates: number; auto_matched: number }>('upload_bank_statement', {
      method: 'POST',
      body: { filename, content_b64: contentB64 },
      auth: true,
      module: 'paymentCore',
    }),

  listBankTransactions: (limit = 100) =>
    request<{
      bank_account: string;
      transactions: BankStatementLine[];
      counts: Record<string, number>;
      razorpay_clearing_account?: string | null;
      razorpay_clearing_balance?: number | null;
    }>('list_bank_transactions', { body: { limit }, auth: true, module: 'paymentCore' }),

  uploadReconReport: (statementType: ReconStatementType, filename: string, contentB64: string) =>
    request<{ rows: number; created: number; updated: number; duplicates: number; skipped: number; auto_matched: number }>(
      'upload_recon_report',
      {
        method: 'POST',
        body: { statement_type: statementType, filename, content_b64: contentB64 },
        auth: true,
        module: 'recon',
      },
    ),

  listReconReport: (statementType: ReconStatementType, fromDate: string, toDate: string, show: 'open' | 'all' = 'open') =>
    request<ReconReport>('list_recon_report', {
      body: { statement_type: statementType, from_date: fromDate, to_date: toDate, show },
      auth: true,
      module: 'recon',
    }),

  matchReconLine: (line: string, voucherType: string, voucherName: string) =>
    request<{ line: string; recon_status: string }>('match_recon_line', {
      method: 'POST',
      body: { line, voucher_type: voucherType, voucher_name: voucherName },
      auth: true,
      module: 'recon',
    }),

  setReconLineStatus: (line: string, action: 'ignore' | 'reopen') =>
    request<{ line: string; recon_status: string }>('set_recon_line_status', {
      method: 'POST',
      body: { line, action },
      auth: true,
      module: 'recon',
    }),

  getCashInHand: (since?: string) =>
    request<CashInHand>('get_cash_in_hand', { body: since ? { since } : {}, auth: true, module: 'recon' }),

  recordCashDeposit: (vouchers: { voucher_type: string; voucher_name: string }[], slipNo: string, depositDate: string) =>
    request<{ journal_entry: string; amount: number; count: number }>('record_cash_deposit', {
      method: 'POST',
      body: { vouchers: JSON.stringify(vouchers), slip_no: slipNo, deposit_date: depositDate },
      auth: true,
      module: 'recon',
    }),

  undoCashDeposit: (journalEntry: string) =>
    request<{ journal_entry: string; cancelled: boolean }>('undo_cash_deposit', {
      method: 'POST',
      body: { journal_entry: journalEntry },
      auth: true,
      module: 'recon',
    }),

  listBankBookingAccounts: () =>
    request<BankBookingAccounts>('list_bank_booking_accounts', { auth: true, module: 'paymentCore' }),

  bookBankTransaction: (body: {
    bank_transaction: string;
    kind: 'razorpay_settlement' | 'account';
    account?: string;
    fee?: number;
  }) =>
    request<{ bank_transaction: string; journal_entry: string; status: string }>('book_bank_transaction', {
      method: 'POST',
      body,
      auth: true,
      module: 'paymentCore',
    }),

  matchBankTransaction: (bankTransaction: string, voucherType: string, voucherName: string) =>
    request<{ bank_transaction: string; status: string }>('match_bank_transaction', {
      method: 'POST',
      body: { bank_transaction: bankTransaction, voucher_type: voucherType, voucher_name: voucherName },
      auth: true,
      module: 'paymentCore',
    }),

  rechargeB2bWallet: (body: { amount: string; payment_reference: string; payment_mode?: string; remarks?: string }) =>
    request<{ request_id: string; status: string; amount: number; pending_review: boolean }>(
      'recharge_b2b_wallet',
      { method: 'POST', body, auth: true },
    ),

  createB2bWalkInOrder: (body: Record<string, string | number>) =>
    request<{
      trf_id: string;
      barcode: string;
      item_codes?: string[];
      line_items?: Array<{
        item_code: string;
        item_name: string;
        retail_amount: number;
        wholesale_amount: number;
        margin: number;
      }>;
      retail_amount: number;
      discount_amount?: number;
      payable_amount?: number;
      wholesale_amount: number;
      margin: number;
      wallet_balance: number;
      wallet_transaction?: string;
    }>('create_b2b_walk_in_order', { method: 'POST', body, auth: true }),

  getLabReagentDashboard: () =>
    request<LabReagentDashboard>('get_lab_reagent_dashboard', { method: 'POST', auth: true }),

  getLabCptDashboard: (limit = 50) =>
    request<LabCptDashboard>('get_lab_cpt_dashboard', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'cpt',
    }),

  getTestCpt: (body: { diagnostic_test?: string; item?: string }) =>
    request<{ cpt: LabCptTestRow }>('get_test_cpt', {
      method: 'POST',
      body: {
        ...(body.diagnostic_test ? { diagnostic_test: body.diagnostic_test } : {}),
        ...(body.item ? { item: body.item } : {}),
      },
      auth: true,
      module: 'cpt',
    }),

  createMappedReagent: (body: {
    reagent_name: string;
    lab_test_item: string;
    parameter_code: string;
    tests_per_consumption?: string | number;
    safety_stock?: string | number;
    reagent_item?: string;
  }) =>
    request<{
      reagent_item: string;
      reagent_name: string;
      lab_test_item: string;
      parameter_code: string;
      tests_per_consumption: number;
      safety_stock: number;
      rule_name: string;
    }>('create_mapped_reagent', { method: 'POST', body, auth: true }),

  registerLabConsumableBatch: (body: {
    consumable_item: string;
    lot_number: string;
    units_per_pack: string;
    expiry_date?: string;
    franchisee_id?: string;
    remarks?: string;
  }) =>
    request<LabConsumableBatch>('register_lab_consumable_batch', { method: 'POST', body, auth: true }),

  openLabConsumableBatch: (batchId: string) =>
    request<LabConsumableBatch>('open_lab_consumable_batch', {
      method: 'POST',
      body: { batch_id: batchId },
      auth: true,
    }),

  getSalesPortal: () =>
    request<SalesPortalPayload>('get_sales_portal', { method: 'POST', auth: true }),

  getSalesProfileDashboard: (seedIfMissing = true) =>
    request<SalesProfileDashboard>('get_sales_profile_dashboard', {
      method: 'POST',
      body: { seed_if_missing: seedIfMissing ? 1 : 0 },
      auth: true,
    }),

  getPeopleHrmsDashboard: () =>
    request<PeopleHrmsDashboard>('get_people_hrms_dashboard', { method: 'POST', auth: true }),

  updateMyEmployeePhoto: (body: { file_name: string; file_data: string }) =>
    request<{ photo: string; employee: string }>('update_my_employee_photo', {
      method: 'POST',
      body: { file_name: body.file_name, file_data: body.file_data },
      auth: true,
    }),

  updateMyEmployeeProfile: (body: {
    phone?: string;
    personal_email?: string;
    current_address?: string;
    permanent_address?: string;
    blood_group?: string;
    emergency_phone?: string;
  }) =>
    request<PeopleHrmsDashboard['employee']>('update_my_employee_profile', {
      method: 'POST',
      body,
      auth: true,
    }),

  listPeopleEmployees: (opts?: { limit?: number; department?: string; q?: string }) =>
    request<{ employees: PeopleEmployeeRow[]; total: number; q?: string }>('list_people_employees', {
      method: 'POST',
      body: { limit: opts?.limit ?? 100, department: opts?.department || '', q: opts?.q || '' },
      auth: true,
    }),

  getPeopleAttendanceRegister: (opts: { fromDate: string; toDate: string }) =>
    request<PeopleAttendanceRegister>('get_people_attendance_register', {
      method: 'POST',
      body: { from_date: opts.fromDate, to_date: opts.toDate },
      auth: true,
    }),

  listPeopleLeave: (opts: { fromDate: string; toDate: string }) =>
    request<PeopleLeaveRegister>('list_people_leave', {
      method: 'POST',
      body: { from_date: opts.fromDate, to_date: opts.toDate },
      auth: true,
    }),

  actPeopleLeave: (
    name: string,
    action: PeopleLeaveAction,
    remark?: string,
    dates?: { from_date?: string; to_date?: string; half_day?: number; half_day_date?: string },
  ) =>
    request<{
      name: string;
      stage: PeopleLeaveStage;
      from_date?: string;
      to_date?: string;
      unauthorized_dates?: string[];
      cut_dates?: string[];
    }>('act_people_leave', {
      method: 'POST',
      body: {
        name,
        action,
        remark: remark || '',
        from_date: dates?.from_date || '',
        to_date: dates?.to_date || '',
        half_day: dates?.half_day != null ? String(dates.half_day) : '',
        half_day_date: dates?.half_day_date || '',
      },
      auth: true,
    }),

  createPeopleLeaveRequest: (body: {
    employee: string;
    leave_type: string;
    from_date: string;
    to_date: string;
    half_day?: number;
    half_day_date?: string;
    reason?: string;
  }) =>
    request<{ name: string; days: number }>('create_people_leave_request', {
      method: 'POST',
      body,
      auth: true,
    }),

  getPeoplePayrollRegister: (month?: string) =>
    request<PeoplePayrollRegister>('get_people_payroll_register', {
      method: 'POST',
      body: { month: month || '' },
      auth: true,
    }),

  processPeoplePayroll: (month: string, employees: string[]) =>
    request<PeoplePayrollBatchResult>('process_people_payroll', {
      method: 'POST',
      body: { month, employees: JSON.stringify(employees) },
      auth: true,
    }),

  getPeoplePerformance: (opts: { fromDate: string; toDate: string }) =>
    request<PeoplePerformanceBoard>('get_people_performance', {
      method: 'POST',
      body: { from_date: opts.fromDate, to_date: opts.toDate },
      auth: true,
    }),

  savePeoplePerformanceReview: (body: { employee: string; period: string; rating: number; remarks?: string; recommendation?: string }) =>
    request<{ name: string; employee: string; period: string; rating: number; recommendation?: string; updated: boolean }>('save_people_performance_review', {
      method: 'POST',
      body,
      auth: true,
    }),

  downloadPeoplePerformanceReport: (body: { employee: string; period: string }) =>
    request<{ file_name: string; data: string; employee: string; period: string }>('download_performance_report_api', {
      method: 'POST',
      body,
      auth: true,
      module: 'peopleMyTeam',
    }),

  approvePeoplePayroll: (month: string, slips: string[]) =>
    request<PeoplePayrollBatchResult>('approve_people_payroll', {
      method: 'POST',
      body: { month, slips: JSON.stringify(slips) },
      auth: true,
    }),

  listEmployeeGeofences: (opts?: { limit?: number }) =>
    request<{
      employees: Array<{
        id: string;
        name: string;
        department?: string | null;
        geofence_enabled: number;
        geofence_label?: string | null;
        work_latitude?: number | null;
        work_longitude?: number | null;
        geofence_radius_m?: number | null;
      }>;
      total: number;
      fenced: number;
      hq: { latitude: number; longitude: number; label: string; radius_m: number };
    }>('list_employee_geofences', {
      method: 'POST',
      body: { limit: opts?.limit ?? 200 },
      auth: true,
    }),

  seedEmployeeGeofences: (opts?: { force?: boolean; radius_m?: number }) =>
    request<{
      updated: number;
      skipped: number;
      total_active: number;
      hq: { latitude: number; longitude: number; label: string; radius_m: number };
      radius_m: number;
    }>('seed_employee_geofences', {
      method: 'POST',
      body: { force: opts?.force ? 1 : 0, radius_m: opts?.radius_m || '' },
      auth: true,
    }),

  getPeopleGeofences: () => request<PeopleGeofencesBoard>('get_people_geofences', { method: 'POST', auth: true }),

  savePeopleGeofence: (geofence: Partial<PeopleGeofence> & { title: string }) =>
    request<PeopleGeofence>('save_people_geofence', {
      method: 'POST',
      body: { geofence: JSON.stringify(geofence) },
      auth: true,
    }),

  assignPeopleGeofence: (geofence: string, employees: string[]) =>
    request<{ updated: number; geofence: PeopleGeofence }>('assign_people_geofence', {
      method: 'POST',
      body: { geofence, employees: JSON.stringify(employees) },
      auth: true,
    }),

  saveEmployeeGeofence: (employee: string, settings: EmployeeGeofenceSettings) =>
    request<PeopleGeofenceEmployee>('save_employee_geofence', {
      method: 'POST',
      body: { employee, settings: JSON.stringify(settings) },
      auth: true,
    }),

  setEmployeeGeofenceOverride: (employee: string, enabled: boolean, reason?: string, until?: string) =>
    request<PeopleGeofenceEmployee>('set_employee_geofence_override', {
      method: 'POST',
      body: { employee, enabled: enabled ? 1 : 0, reason: reason || '', until: until || '' },
      auth: true,
    }),

  geocodePeopleGeofenceAddress: (address: string) =>
    request<{ latitude: number; longitude: number }>('geocode_people_geofence_address', {
      method: 'POST',
      body: { address },
      auth: true,
    }),

  getPeopleRoles: () => request<PeopleRolesBoard>('get_people_roles', { method: 'POST', auth: true }),

  savePeopleRole: (role: Partial<PeopleAccessRole> & { title: string }) =>
    request<PeopleAccessRole>('save_people_role', {
      method: 'POST',
      body: { role: JSON.stringify(role) },
      auth: true,
    }),

  assignPeopleAccess: (access: {
    employee: string;
    role?: string;
    portals?: string[];
    permissions?: string[];
    status?: string;
    generate?: number;
    password?: string;
    login_id?: string;
  }) =>
    request<{ assignment: string; employee: string; user: string; login_id: string; created_user: boolean; status: string; password?: string }>(
      'assign_people_access',
      { method: 'POST', body: { access: JSON.stringify(access) }, auth: true },
    ),

  exportPeopleRoles: (kind?: string) =>
    request<{ kind: string; header: string[]; lines: unknown[][] }>('export_people_roles', {
      method: 'POST',
      body: { kind: kind || 'roles' },
      auth: true,
    }),

  getPeoplePayrollWorkflow: () =>
    request<PeoplePayrollWorkflow>('get_people_payroll_workflow', { method: 'POST', auth: true }),

  ensurePeoplePayrollAssignments: (base = 35000) =>
    request<{
      assigned_count: number;
      structure?: string;
      created: string[];
      existing: string[];
      errors: Array<{ employee: string; error: string }>;
    }>('ensure_people_payroll_assignments', {
      method: 'POST',
      body: { base },
      auth: true,
    }),

  createPeoplePayrollEntry: (opts?: { start_date?: string; end_date?: string }) =>
    request<{
      payroll_entry: string;
      start_date: string;
      end_date: string;
      employees_filled: number;
      company?: string;
      payment_account?: string | null;
      docstatus: number;
    }>('create_people_payroll_entry', {
      method: 'POST',
      body: { start_date: opts?.start_date || '', end_date: opts?.end_date || '' },
      auth: true,
    }),

  generatePeopleSalarySlips: (opts?: { payroll_entry?: string; employee?: string }) =>
    request<{
      count: number;
      mode: string;
      payroll_entry?: string | null;
      created?: string[];
      slips?: Array<{ name: string; employee?: string; net_pay?: number; docstatus?: number }>;
      errors?: unknown[];
    }>('generate_people_salary_slips', {
      method: 'POST',
      body: {
        payroll_entry: opts?.payroll_entry || '',
        employee: opts?.employee || '',
      },
      auth: true,
    }),

  submitPeoplePayroll: (opts?: { payroll_entry?: string }) =>
    request<{
      ok: boolean;
      mode: string;
      count?: number;
      submitted?: string[];
      payroll_entry?: string | null;
      docstatus?: number;
      errors?: unknown[];
    }>('submit_people_payroll', {
      method: 'POST',
      body: { payroll_entry: opts?.payroll_entry || '' },
      auth: true,
    }),

  listOrgSalarySlips: (opts?: { limit?: number }) =>
    request<{
      slips: Array<{
        name: string;
        employee?: string;
        employee_name?: string;
        start_date?: string | null;
        end_date?: string | null;
        gross_pay?: number;
        net_pay?: number;
        status?: string;
        docstatus?: number;
      }>;
      total: number;
    }>('list_org_salary_slips', {
      method: 'POST',
      body: { limit: opts?.limit ?? 50 },
      auth: true,
    }),

  runPeoplePayrollFull: (opts?: { start_date?: string; end_date?: string }) =>
    request<{
      ok: boolean;
      steps: Array<{ step: string; result: Record<string, unknown> }>;
      workflow: PeoplePayrollWorkflow;
    }>('run_people_payroll_full', {
      method: 'POST',
      body: { start_date: opts?.start_date || '', end_date: opts?.end_date || '' },
      auth: true,
    }),

  createPeopleEmployee: (body: {
    application?: string;
    full_name?: string;
    email?: string;
    mobile?: string;
    dob?: string;
    gender?: string;
    department?: string;
    designation?: string;
    joining_date?: string;
    salary_offered?: number;
    franchisee?: string;
  }) =>
    request<{
      employee: string;
      user: string;
      user_created: boolean;
      temporary_password?: string;
      monthly_ctc?: number;
      people_path?: string;
      already_exists?: boolean;
      already_hired?: boolean;
      roles?: string[];
    }>('create_people_employee', {
      method: 'POST',
      body: {
        ...(body.application ? { application: body.application } : {}),
        ...(body.full_name ? { full_name: body.full_name } : {}),
        ...(body.email ? { email: body.email } : {}),
        ...(body.mobile ? { mobile: body.mobile } : {}),
        ...(body.dob ? { dob: body.dob } : {}),
        ...(body.gender ? { gender: body.gender } : {}),
        ...(body.department ? { department: body.department } : {}),
        ...(body.designation ? { designation: body.designation } : {}),
        ...(body.joining_date ? { joining_date: body.joining_date } : {}),
        ...(body.salary_offered != null ? { salary_offered: body.salary_offered } : {}),
        ...(body.franchisee ? { franchisee: body.franchisee } : {}),
      },
      auth: true,
    }),

  listEmployeeChecklists: (opts?: { employee?: string; kind?: string; limit?: number }) =>
    request<{ todos: PeopleChecklistTodo[]; count: number }>('list_employee_checklists', {
      method: 'POST',
      body: {
        employee: opts?.employee || '',
        kind: opts?.kind || '',
        limit: opts?.limit ?? 100,
      },
      auth: true,
    }),

  startEmployeeChecklist: (opts: { employee: string; kind?: 'onboarding' | 'offboarding' }) =>
    request<{ ok: boolean; employee: string; kind: string; todos: string[] }>('start_employee_checklist', {
      method: 'POST',
      body: { employee: opts.employee, kind: opts.kind || 'onboarding' },
      auth: true,
    }),

  startEmployeeSeparation: (opts: {
    employee: string;
    relieving_date?: string;
    mark_left?: boolean;
  }) =>
    request<{
      ok: boolean;
      employee: string;
      relieving_date?: string;
      todos: string[];
      user_disabled?: boolean;
    }>('start_employee_separation', {
      method: 'POST',
      body: {
        employee: opts.employee,
        relieving_date: opts.relieving_date || '',
        mark_left: opts.mark_left ? 1 : 0,
      },
      auth: true,
    }),

  completeChecklistTodo: (todo_name: string) =>
    request<{ ok: boolean; todo: string; status: string }>('complete_checklist_todo', {
      method: 'POST',
      body: { todo_name },
      auth: true,
    }),

  getPeopleOnboarding: (opts?: { fromDate?: string; toDate?: string }) =>
    request<PeopleOnboardingBoard>('get_people_onboarding', {
      method: 'POST',
      body: { from_date: opts?.fromDate || '', to_date: opts?.toDate || '' },
      auth: true,
    }),

  getPeopleTraining: () => request<PeopleTrainingBoard>('get_people_training', { method: 'POST', auth: true }),

  savePeopleTrainingMaterial: (material: Partial<PeopleTrainingMaterial> & { title: string }) =>
    request<{ id: string; title: string; status: string }>('save_people_training_material', {
      method: 'POST',
      body: { material: JSON.stringify(material) },
      auth: true,
    }),

  savePeopleTrainingPlan: (plan: Partial<PeopleTrainingPlan> & { title: string }) =>
    request<{ id: string; title: string; status: string }>('save_people_training_plan', {
      method: 'POST',
      body: { plan: JSON.stringify(plan) },
      auth: true,
    }),

  savePeopleTrainingCategory: (title: string) =>
    request<{ id: string; title: string; existing?: boolean }>('save_people_training_category', {
      method: 'POST',
      body: { title },
      auth: true,
    }),

  assignPeopleTraining: (opts: {
    material?: string;
    plan?: string;
    scope: 'all' | 'department' | 'designation' | 'employees';
    department?: string;
    designation?: string;
    employees?: string[];
  }) =>
    request<{ created: number; skipped: number; employees: number; materials: number }>('assign_people_training', {
      method: 'POST',
      body: {
        material: opts.material || '',
        plan: opts.plan || '',
        scope: opts.scope,
        department: opts.department || '',
        designation: opts.designation || '',
        employees: (opts.employees || []).join(','),
      },
      auth: true,
    }),

  updatePeopleTrainingAssignment: (assignment: string, status: PeopleTrainingAssignStatus) =>
    request<{ id: string; status: string }>('update_people_training_assignment', {
      method: 'POST',
      body: { assignment, status },
      auth: true,
    }),

  getPeopleCareer: () => request<PeopleCareerBoard>('get_people_career', { method: 'POST', auth: true }),

  savePeopleManpowerRequest: (manpower: Partial<PeopleManpowerRequest> & { designation: string }) =>
    request<PeopleManpowerRequest>('save_people_manpower_request', {
      method: 'POST',
      body: { manpower: JSON.stringify(manpower) },
      auth: true,
    }),

  updatePeopleManpowerRequest: (manpower: string, status: PeopleManpowerStatus) =>
    request<{ id: string; status: string }>('update_people_manpower_request', {
      method: 'POST',
      body: { manpower, status },
      auth: true,
    }),

  getPeopleDocuments: () => request<PeopleDocumentsBoard>('get_people_documents', { method: 'POST', auth: true }),

  savePeopleDocument: (document: Partial<PeopleDocument> & { title?: string }, file?: { file_name: string; file_data: string }) =>
    request<PeopleDocument>('save_people_document', {
      method: 'POST',
      body: {
        document: JSON.stringify(document),
        file_name: file?.file_name || '',
        file_data: file?.file_data || '',
      },
      auth: true,
    }),

  updatePeopleDocument: (document: string, opts?: { status?: PeopleDocStatus; touch?: number | string }) =>
    request<PeopleDocument>('update_people_document', {
      method: 'POST',
      body: { document, status: opts?.status || '', touch: opts?.touch ? 1 : '' },
      auth: true,
    }),

  savePeopleDocumentFolder: (folder: { title: string; parent?: string; scope?: string }) =>
    request<PeopleDocumentFolder>('save_people_document_folder', {
      method: 'POST',
      body: { folder: JSON.stringify(folder) },
      auth: true,
    }),

  generatePeopleLetter: (template: string, employee: string) =>
    request<PeopleDocument>('generate_people_letter', {
      method: 'POST',
      body: { template, employee },
      auth: true,
    }),

  savePeopleDocumentRequest: (docRequest: { employee: string; title: string; employee_name?: string }) =>
    request<PeopleDocumentRequest>('save_people_document_request', {
      method: 'POST',
      body: { doc_request: JSON.stringify(docRequest) },
      auth: true,
    }),

  updatePeopleDocumentRequest: (docRequest: string, status: PeopleDocRequestStatus) =>
    request<{ id: string; status: string }>('update_people_document_request', {
      method: 'POST',
      body: { doc_request: docRequest, status },
      auth: true,
    }),

  listPeopleDepartments: () =>
    request<{
      departments: PeopleDepartmentRow[];
      groups?: Array<{ name: string; parent: string | null }>;
      total: number;
      total_employees?: number;
    }>(
      'list_people_departments',
      { method: 'POST', auth: true },
    ),

  listPeopleDesignations: () =>
    request<{
      designations: PeopleDesignationRow[];
      total: number;
      total_employees?: number;
      unassigned?: number;
    }>(
      'list_people_designations',
      { method: 'POST', auth: true },
    ),

  listHrPolicySnippets: () =>
    request<{ policies: Array<{ name: string; slug: string; body: string }> }>('list_hr_policy_snippets', {
      method: 'POST',
      auth: true,
    }),

  getPeopleAnnouncements: () => request<PeopleAnnouncementsBoard>('get_people_announcements', { method: 'POST', auth: true }),

  savePeopleAnnouncement: (
    announcement: Partial<PeopleAnnouncement> & { title: string },
    file?: { file_name: string; file_data: string },
  ) =>
    request<PeopleAnnouncement>('save_people_announcement', {
      method: 'POST',
      body: {
        announcement: JSON.stringify(announcement),
        file_name: file?.file_name || '',
        file_data: file?.file_data || '',
      },
      auth: true,
    }),

  updatePeopleAnnouncement: (announcement: string, status: PeopleAnnouncementStatus) =>
    request<PeopleAnnouncement>('update_people_announcement', {
      method: 'POST',
      body: { announcement, status },
      auth: true,
    }),

  getPeopleCalendar: () => request<PeopleCalendarBoard>('get_people_calendar', { method: 'POST', auth: true }),

  savePeopleCalendarEvent: (event: Partial<PeopleCalendarEvent> & { title: string; event_date: string }) =>
    request<PeopleCalendarEvent>('save_people_calendar_event', {
      method: 'POST',
      body: { event: JSON.stringify(event) },
      auth: true,
    }),

  updatePeopleCalendarEvent: (event: string, status: string) =>
    request<PeopleCalendarEvent>('update_people_calendar_event', {
      method: 'POST',
      body: { event, status },
      auth: true,
    }),

  getPeopleReports: (opts?: { from_date?: string; to_date?: string; department?: string }) =>
    request<PeopleReportsBoard>('get_people_reports', {
      method: 'POST',
      body: {
        from_date: opts?.from_date || '',
        to_date: opts?.to_date || '',
        department: opts?.department || '',
      },
      auth: true,
    }),

  exportPeopleReport: (report: string, opts?: { from_date?: string; to_date?: string; department?: string }) =>
    request<{ title: string; header: string[]; rows: string[][]; run?: PeopleReportRun }>(
      'export_people_report',
      {
        method: 'POST',
        body: {
          report,
          from_date: opts?.from_date || '',
          to_date: opts?.to_date || '',
          department: opts?.department || '',
        },
        auth: true,
      },
    ),

  getPeopleAnalytics: (opts?: { from_date?: string; to_date?: string; department?: string }) =>
    request<PeopleAnalyticsBoard>('get_people_analytics', {
      method: 'POST',
      body: {
        from_date: opts?.from_date || '',
        to_date: opts?.to_date || '',
        department: opts?.department || '',
      },
      auth: true,
    }),

  exportPeopleAnalytics: (kind: string, opts?: { from_date?: string; to_date?: string; department?: string }) =>
    request<{ title: string; header: string[]; rows: string[][] }>('export_people_analytics', {
      method: 'POST',
      body: {
        kind,
        from_date: opts?.from_date || '',
        to_date: opts?.to_date || '',
        department: opts?.department || '',
      },
      auth: true,
    }),

  getPeopleAssets: () => request<PeopleAssetsBoard>('get_people_assets', { method: 'POST', auth: true }),

  savePeopleAsset: (asset: Partial<PeopleAsset> & { title: string }) =>
    request<PeopleAsset>('save_people_asset', {
      method: 'POST',
      body: { asset: JSON.stringify(asset) },
      auth: true,
    }),

  updatePeopleAsset: (
    asset: string,
    opts?: { status?: PeopleAssetStatus; action?: string; employee?: Record<string, string> },
  ) =>
    request<PeopleAsset>('update_people_asset', {
      method: 'POST',
      body: {
        asset,
        status: opts?.status || '',
        action: opts?.action || '',
        employee: opts?.employee ? JSON.stringify(opts.employee) : '',
      },
      auth: true,
    }),

  savePeopleAssetCategory: (category: { title: string }) =>
    request<{ id: string; title: string; count: number }>('save_people_asset_category', {
      method: 'POST',
      body: { category: JSON.stringify(category) },
      auth: true,
    }),

  savePeopleAssetRequest: (assetRequest: { title: string; employee?: string; employee_name?: string; note?: string }) =>
    request<PeopleAssetRequest>('save_people_asset_request', {
      method: 'POST',
      body: { asset_request: JSON.stringify(assetRequest) },
      auth: true,
    }),

  updatePeopleAssetRequest: (assetRequest: string, status: PeopleAssetRequestStatus) =>
    request<{ id: string; status: string }>('update_people_asset_request', {
      method: 'POST',
      body: { asset_request: assetRequest, status },
      auth: true,
    }),

  getPeoplePolicies: () => request<PeoplePoliciesBoard>('get_people_policies', { method: 'POST', auth: true }),

  savePeoplePolicy: (policy: Partial<PeoplePolicy> & { title: string }) =>
    request<PeoplePolicy>('save_people_policy', {
      method: 'POST',
      body: { policy: JSON.stringify(policy) },
      auth: true,
    }),

  updatePeoplePolicy: (policy: string, opts?: { status?: PeoplePolicyStatus; touch?: number | string }) =>
    request<PeoplePolicy>('update_people_policy', {
      method: 'POST',
      body: { policy, status: opts?.status || '', touch: opts?.touch ? 1 : '' },
      auth: true,
    }),

  savePeoplePolicyCategory: (category: { title: string }) =>
    request<{ id: string; title: string; count: number }>('save_people_policy_category', {
      method: 'POST',
      body: { category: JSON.stringify(category) },
      auth: true,
    }),

  listHrGradesMaster: () =>
    request<{
      grades: Array<{
        name: string;
        description: string;
        structure: string;
        base: number;
        designation: string;
        da_track?: string;
        da_slabs?: {
          label?: string;
          hq_day?: number;
          ex_hq_day?: number;
          os_day?: number;
          track?: string;
        };
      }>;
      food_allowance_fixed?: number;
      architecture?: Record<string, unknown>;
    }>('list_hr_grades_master', { method: 'POST', auth: true }),

  listHrDesignationsMaster: () =>
    request<{
      designations: Array<{
        designation: string;
        grade?: string;
        structure?: string;
        indicative_base?: number;
      }>;
    }>('list_hr_designations_master', { method: 'POST', auth: true }),

  getFranchiseTeamAttendance: () =>
    request<{
      franchisee: string | null;
      as_of?: string;
      employees: Array<{
        employee: string;
        employee_name?: string;
        designation?: string;
        checkins_today?: number;
        today_status?: string;
        last_log_type?: string | null;
        last_time?: string | null;
      }>;
      count: number;
    }>('get_franchise_team_attendance', { method: 'POST', auth: true }),

  getFranchiseTeamLeave: () =>
    request<{
      franchisee: string | null;
      leaves: Array<{
        name: string;
        employee: string;
        employee_name?: string;
        leave_type?: string;
        from_date?: string;
        to_date?: string;
        status?: string;
        days?: number;
      }>;
      count: number;
    }>('get_franchise_team_leave', { method: 'POST', auth: true }),

  getAppointmentLetterHtml: (employee: string, letterType = 'field') =>
    request<{ employee: string; letter_type: string; print_format: string; html: string }>(
      'get_appointment_letter_html',
      { method: 'POST', body: { employee, letter_type: letterType }, auth: true },
    ),

  submitEmployeeCheckin: (
    logType: 'IN' | 'OUT' = 'IN',
    location?: { latitude: number; longitude: number },
  ) =>
    request<{
      checkin: {
        name: string;
        employee: string;
        log_type: string;
        time: string;
        latitude?: number | null;
        longitude?: number | null;
        geofence?: {
          ok: boolean;
          distance_m?: number;
          radius_m: number;
          label?: string;
          work_latitude?: number;
          work_longitude?: number;
          override?: boolean;
          override_until?: string;
        };
      };
    }>('submit_employee_checkin', {
      method: 'POST',
      body: {
        log_type: logType,
        latitude: location?.latitude ?? '',
        longitude: location?.longitude ?? '',
      },
      auth: true,
    }),

  getSalesLeads: (limit = 50) =>
    request<{ leads: SalesLead[] }>('get_sales_leads', { method: 'POST', body: { limit }, auth: true }),

  createSalesLead: (body: Record<string, string | number>) =>
    request<{ lead_id: string }>('create_sales_lead', { method: 'POST', body, auth: true }),

  updateSalesLead: (body: Record<string, string | number>) =>
    request<{ lead_id: string; status?: string; changed?: string[] }>('update_sales_lead', {
      method: 'POST',
      body,
      auth: true,
    }),

  getSalesOnboarding: (limit = 50) =>
    request<{
      onboardings: Array<Record<string, unknown>>;
      applications: Array<Record<string, unknown>>;
      count: number;
    }>('get_sales_onboarding', { method: 'POST', body: { limit }, auth: true }),

  getSalesFranchiseeList: (period: 'month' | 'all' = 'month') =>
    request<SalesFranchiseeStats & { franchisee_list?: unknown[]; onboardings?: unknown[] }>(
      'get_sales_franchisee_list',
      { method: 'POST', body: { period }, auth: true },
    ),

  getWbGeoHierarchy: () =>
    request<WbGeoHierarchy>('get_wb_geo_hierarchy', { method: 'GET', auth: false }),

  resolveWbPincode: (pincode: string) =>
    request<{ pincode: string; matches: Array<Record<string, string>>; count: number }>(
      'resolve_wb_pincode',
      { method: 'GET', body: { pincode }, auth: false },
    ),

  getTerritorialSalesSummary: (period: 'month' | 'all' = 'month') =>
    request<TerritorialSalesSummary>('get_territorial_sales_summary', {
      method: 'POST',
      body: { period },
      auth: true,
    }),

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
    request<SalesClosingDraft>('draft_sales_closing_report', {
      method: 'POST',
      body: periodDate
        ? { report_type: reportType, period_date: periodDate }
        : { report_type: reportType },
      auth: true,
    }),

  submitSalesClosingReport: (body: Record<string, string | number>) =>
    request<{ report_id: string }>('submit_sales_closing_report', { method: 'POST', body, auth: true }),

  listB2bCollectionCentres: (limit = 100) =>
    request<{ centres: B2bCollectionCentre[] }>('list_b2b_collection_centres', {
      method: 'POST',
      body: { limit },
      auth: true,
    }),

  createB2bCollectionCentre: (body: {
    centre_name: string;
    wallet_amount?: number;
    total_deposit?: number;
    contact_number?: string;
    manual_address?: string;
    google_map_location?: string;
    remarks?: string;
    logistics_assignments?: B2bLogisticsAssignment[];
  }) =>
    request<{ centre: B2bCollectionCentre; rfms?: unknown }>('create_b2b_collection_centre', {
      method: 'POST',
      body: {
        centre_name: body.centre_name,
        wallet_amount: body.wallet_amount ?? 0,
        total_deposit: body.total_deposit ?? 0,
        contact_number: body.contact_number || '',
        manual_address: body.manual_address || '',
        google_map_location: body.google_map_location || '',
        remarks: body.remarks || '',
        logistics_assignments: JSON.stringify(body.logistics_assignments || []),
      },
      auth: true,
    }),

  listB2bSalesEntries: (limit = 100, salesDate?: string) =>
    request<{ entries: B2bSalesEntry[] }>('list_b2b_sales_entries', {
      method: 'POST',
      body: salesDate ? { limit, sales_date: salesDate } : { limit },
      auth: true,
    }),

  submitB2bSalesEntry: (body: Record<string, string | number | boolean>) =>
    request<{ entry: B2bSalesEntry; closing?: unknown; rfms?: unknown }>('submit_b2b_sales_entry', {
      method: 'POST',
      body,
      auth: true,
    }),

  getB2bClosingSummary: (periodDate?: string) =>
    request<B2bClosingSummary>('get_b2b_closing_summary', {
      method: 'POST',
      body: periodDate ? { period_date: periodDate } : {},
      auth: true,
    }),

  updateSalesRepLocation: (latitude: number, longitude: number, onDuty = true) =>
    request<{ rep_id: string; latitude: number; longitude: number }>('sales_rep_update_location', {
      method: 'POST',
      body: { latitude, longitude, on_duty: onDuty ? 1 : 0 },
      auth: true,
    }),

  getSalesTeamMap: () =>
    request<SalesTeamMapData>('get_sales_team_map', { method: 'POST', auth: true }),

  getSalesTeamPerformanceReports: (opts?: { limit?: number; activity_date?: string; sales_rep?: string }) =>
    request<SalesTeamPerformanceList>('get_sales_team_performance_reports', {
      method: 'POST',
      body: {
        limit: opts?.limit ?? 50,
        ...(opts?.activity_date ? { activity_date: opts.activity_date } : {}),
        ...(opts?.sales_rep ? { sales_rep: opts.sales_rep } : {}),
      },
      auth: true,
    }),

  getSalesTeamPortalActivity: (opts?: {
    activity_date?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    sales_rep?: string;
  }) =>
    request<{
      is_manager: boolean;
      activity_date?: string;
      date_from?: string;
      date_to?: string;
      counts: { leads: number; visits: number; onboardings: number; employees?: number; days?: number };
      today_counts: { leads: number; visits: number; onboardings: number };
      leads: Array<Record<string, unknown>>;
      visits: Array<Record<string, unknown>>;
      onboardings: Array<Record<string, unknown>>;
      daily: Array<Record<string, unknown>>;
      by_employee: Array<Record<string, unknown>>;
      prefill: Record<string, number>;
    }>('get_sales_team_portal_activity', {
      method: 'POST',
      body: {
        limit: opts?.limit ?? 500,
        ...(opts?.activity_date ? { activity_date: opts.activity_date } : {}),
        ...(opts?.date_from ? { date_from: opts.date_from } : {}),
        ...(opts?.date_to ? { date_to: opts.date_to } : {}),
        ...(opts?.sales_rep ? { sales_rep: opts.sales_rep } : {}),
      },
      auth: true,
    }),

  downloadSalesTeamPortalActivityCsv: (opts?: {
    activity_date?: string;
    date_from?: string;
    date_to?: string;
  }) =>
    request<{ filename: string; csv: string; count: number; counts?: Record<string, number> }>(
      'download_sales_team_portal_activity_csv',
      {
        method: 'POST',
        body: {
          ...(opts?.activity_date ? { activity_date: opts.activity_date } : {}),
          ...(opts?.date_from ? { date_from: opts.date_from } : {}),
          ...(opts?.date_to ? { date_to: opts.date_to } : {}),
        },
        auth: true,
      },
    ),

  submitSalesTeamPerformanceReport: (body: Record<string, string | number>) =>
    request<SalesTeamPerformanceReport>('submit_sales_team_performance_report', {
      method: 'POST',
      body,
      auth: true,
    }),

  downloadSalesTeamPerformanceCsv: (opts?: { activity_date?: string; sales_rep?: string }) =>
    request<{ filename: string; csv: string; count: number; is_manager?: boolean }>(
      'download_sales_team_performance_csv',
      {
        method: 'POST',
        body: {
          ...(opts?.activity_date ? { activity_date: opts.activity_date } : {}),
          ...(opts?.sales_rep ? { sales_rep: opts.sales_rep } : {}),
        },
        auth: true,
      },
    ),

  downloadSalesTeamPerformanceFile: (reportName: string, fileName?: string) =>
    request<{ file_name: string; file_content: string; content_type?: string }>(
      'download_sales_team_performance_file',
      {
        method: 'POST',
        body: {
          report_name: reportName,
          ...(fileName ? { file_name: fileName } : {}),
        },
        auth: true,
      },
    ),

  getAgencyDashboard: () =>
    request<AgencyDashboard>('get_agency_dashboard', {
      method: 'POST',
      auth: true,
      module: 'agencyAgents',
    }),

  getAgencyProfile: (agent_id?: string) =>
    request<AgencyProfilePayload>('get_agency_profile', {
      method: 'POST',
      body: agent_id ? { agent_id } : {},
      auth: true,
      module: 'agencyAgents',
    }),

  getAgencyTeam: () =>
    request<{ root: AgencyAgent | null; tree: AgencyTeamNode[] }>('get_agency_team', {
      method: 'POST',
      auth: true,
      module: 'agencyAgents',
    }),

  getAgencyCommissions: (limit = 50) =>
    request<AgencyCommissionPayload>('get_agency_commissions', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'agencyAgents',
    }),

  getAgencyLevels: () =>
    request<{ levels: AgencyLevel[]; conversion_base_inr: number }>('get_agency_levels', {
      method: 'POST',
      auth: true,
      module: 'agencyAgents',
    }),

  saveAgencyLevel: (body: {
    level_code: string;
    conversion_pct?: number;
    monthly_revenue_pct?: number;
    override_pct?: number;
    active?: number;
  }) =>
    request<{ level: AgencyLevel }>('save_agency_level', {
      method: 'POST',
      body,
      auth: true,
      module: 'agencyAgents',
    }),

  agencyAttributeFranchisee: (body: {
    agent_id?: string;
    franchisee_id: string;
    deal_value?: number;
    notes?: string;
  }) =>
    request<{ attribution_id: string; ledger_ids?: string[]; already?: boolean }>(
      'agency_attribute_franchisee',
      { method: 'POST', body, auth: true, module: 'agencyAgents' },
    ),

  agencyAccrueMonthly: (body: { period?: string; franchisee_id?: string; revenue_amount?: number }) =>
    request<{ period: string; ledger_ids: string[]; count: number }>('agency_accrue_monthly', {
      method: 'POST',
      body,
      auth: true,
      module: 'agencyAgents',
    }),

  submitAgencyFranchiseeOnboard: (body: {
    prospect_name: string;
    mobile: string;
    email?: string;
    territory?: string;
    franchise_model?: string;
    deal_value?: number;
    notes?: string;
    agent_id?: string;
  }) =>
    request<{
      request_id: string;
      status: string;
      ffms_request_id?: string;
      ffms_lead_id?: string;
      ffms_push?: { ok?: boolean; error?: string };
    }>('submit_agency_franchisee_onboard', {
      method: 'POST',
      body,
      auth: true,
      module: 'agencyAgents',
    }),

  completeAgencyFranchiseeOnboard: (request_id: string) =>
    request<{
      request_id: string;
      franchisee: string;
      franchise_name?: string;
      attribution?: unknown;
      already?: boolean;
    }>('complete_agency_franchisee_onboard', {
      method: 'POST',
      body: { request_id },
      auth: true,
      module: 'agencyAgents',
    }),

  getAgencyOnboardRequests: (limit = 50) =>
    request<{ requests: AgencyOnboardRequest[] }>('get_agency_onboard_requests', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'agencyAgents',
    }),

  getHiringOverview: () =>
    request<HiringOverview>('get_hiring_overview', { method: 'POST', auth: true, module: 'hiring' }),

  listHireJobs: (status?: string) =>
    request<{ jobs: HireJob[]; slots: HirePortalSlot[] }>('list_hire_jobs', {
      method: 'POST',
      body: { status: status || '' },
      auth: true,
      module: 'hiring',
    }),

  saveHireJob: (job: Partial<HireJob>) =>
    request<HireJob>('save_hire_job', {
      method: 'POST',
      body: { job: JSON.stringify(job) },
      auth: true,
      module: 'hiring',
    }),

  getHireJobAds: (job: string) =>
    request<HireJobAds>('get_hire_job_ads', { method: 'POST', body: { job }, auth: true, module: 'hiring' }),

  recordHirePosting: (body: {
    job: string;
    portal: HirePortal;
    external_url?: string;
    external_ref?: string;
    posted_on?: string;
    expires_on?: string;
  }) =>
    request<{ posting: string; slots: HirePortalSlot[] }>('record_hire_posting', {
      method: 'POST',
      body,
      auth: true,
      module: 'hiring',
    }),

  closeHirePosting: (posting: string, reason = '') =>
    request<{ posting: string; slots: HirePortalSlot[] }>('close_hire_posting', {
      method: 'POST',
      body: { posting, reason },
      auth: true,
      module: 'hiring',
    }),

  listHireCandidates: (opts: { job?: string; stage?: string; source?: string; q?: string; limit?: number } = {}) =>
    request<{ candidates: HireCandidateRow[]; total: number }>('list_hire_candidates', {
      method: 'POST',
      body: {
        job: opts.job || '',
        stage: opts.stage || '',
        source: opts.source || '',
        q: opts.q || '',
        limit: opts.limit ?? 200,
      },
      auth: true,
      module: 'hiring',
    }),

  getHireCandidate: (candidate: string) =>
    request<HireCandidateDetail>('get_hire_candidate', {
      method: 'POST',
      body: { candidate },
      auth: true,
      module: 'hiring',
    }),

  saveHireCandidate: (candidate: Record<string, unknown>, resume?: { filename: string; content_b64: string } | null) =>
    request<{ name: string; created?: boolean; changed?: string[] }>('save_hire_candidate', {
      method: 'POST',
      body: {
        candidate: JSON.stringify(candidate),
        resume_filename: resume?.filename || '',
        resume_b64: resume?.content_b64 || '',
      },
      auth: true,
      module: 'hiring',
    }),

  moveHireCandidate: (body: {
    candidate: string;
    to_stage: HireStage;
    note?: string;
    interview_at?: string;
    interview_mode?: string;
    offered_ctc?: number;
    joining_date?: string;
    reason?: string;
  }) =>
    request<HireCandidateDetail>('move_hire_candidate', { method: 'POST', body, auth: true, module: 'hiring' }),

  addHireNote: (candidate: string, body: string, kind: 'Note' | 'Call' = 'Note') =>
    request<HireCandidateDetail>('add_hire_note', {
      method: 'POST',
      body: { candidate, body, kind },
      auth: true,
      module: 'hiring',
    }),

  hireCandidate: (body: {
    candidate: string;
    work_email: string;
    department?: string;
    designation?: string;
    joining_date?: string;
    monthly_salary?: number;
  }) =>
    request<{
      candidate: string;
      employee: string;
      user?: string;
      temporary_password?: string;
      job_closed: boolean;
    }>('hire_candidate', { method: 'POST', body, auth: true, module: 'hiring' }),

  importHireCandidates: (body: {
    job?: string;
    source: string;
    filename: string;
    content_b64: string;
    dry_run: boolean;
  }) =>
    request<HireImportResult>('import_hire_candidates', {
      method: 'POST',
      body: { ...body, job: body.job || '', dry_run: body.dry_run ? 1 : 0 },
      auth: true,
      module: 'hiring',
    }),

  downloadHireResume: (candidate: string, fileName: string) =>
    downloadBinary('download_hire_resume', { candidate }, fileName, 'hiring'),

  listPublicHireJobs: () =>
    request<{ jobs: PublicHireJob[] }>('list_public_hire_jobs', { method: 'GET', auth: false, module: 'hiring' }),

  applyPublicHireJob: (
    application: Record<string, string | number>,
    resume?: { filename: string; content_b64: string } | null,
  ) =>
    request<{ reference: string }>('apply_public_hire_job', {
      method: 'POST',
      body: {
        application: JSON.stringify(application),
        resume_filename: resume?.filename || '',
        resume_b64: resume?.content_b64 || '',
      },
      auth: false,
      module: 'hiring',
    }),

  getAgencyOnboardForm: (formKey = 'agents_portal') =>
    request<{ form: AgencyOnboardFormSchema }>('get_agency_onboard_form', {
      method: 'POST',
      body: { form_key: formKey },
      auth: false,
      module: 'agencyOnboardForm',
    }),

  submitAgencyOnboardForm: (formKey: string, answers: Record<string, string | number | boolean>) =>
    request<{
      submission_id: string;
      form_key: string;
      status: string;
      linked_request?: string | null;
      message?: string;
    }>('submit_agency_onboard_form', {
      method: 'POST',
      body: {
        form_key: formKey,
        answers_json: JSON.stringify(answers),
      },
      // Include sid when present (franchisee); guests still allowed by backend allow_guest
      auth: true,
      module: 'agencyOnboardForm',
    }),

  setupAgencyOnboardForms: () =>
    request<{
      doctypes: string[];
      seeded: { forms: string[] };
      desk_list: string;
      desk_submissions: string;
      public_url: string;
    }>('setup_agency_onboard_forms', {
      method: 'POST',
      auth: true,
      module: 'agencyOnboardForm',
    }),

  getAgencyFranchisees: (limit = 50) =>
    request<{ franchisees: AgencyFranchiseeRow[] }>('get_agency_franchisees', {
      method: 'POST',
      body: { limit },
      auth: true,
      module: 'agencyAgents',
    }),

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

  getTrfDrawPlan: (trfId: string) =>
    request<{ trf_id: string; tubes: CollectionTubeRow[]; patient?: AccessionPatient }>('get_trf_draw_plan', {
      method: 'POST',
      body: { trf_id: trfId },
      auth: true,
      module: 'vialAccession',
    }),

  getAccessionSummary: () =>
    request<AccessionSummary>('get_accession_summary', {
      method: 'POST',
      body: {},
      auth: true,
      module: 'vialAccession',
    }),

  findTrfForAccession: (q: string) =>
    request<{ trfs: AccessionTrfHit[] }>('find_trf_for_accession', {
      method: 'POST',
      body: { q },
      auth: true,
      module: 'vialAccession',
    }),

  receiveTrfTube: (trfId: string, accessionId: string) =>
    request<{ ok: boolean; accession_id: string; status: string }>('receive_trf_tube', {
      method: 'POST',
      body: { trf_id: trfId, accession_id: accessionId },
      auth: true,
      module: 'vialAccession',
    }),

  rejectTrfTube: (trfId: string, accessionId: string, reason: string) =>
    request<{ ok: boolean; accession_id: string; status?: string }>('reject_trf_tube', {
      method: 'POST',
      body: { trf_id: trfId, accession_id: accessionId, reason },
      auth: true,
      module: 'vialAccession',
    }),

  rebuildTrfDrawPlan: (trfId: string) =>
    request<{ ok?: boolean; tubes?: CollectionTubeRow[] } | CollectionTubeRow[]>('rebuild_trf_draw_plan', {
      method: 'POST',
      body: { trf_id: trfId, preserve_received: 1 },
      auth: true,
      module: 'vialAccession',
    }),

  getMotherLabBillDefaults: () =>
    request<{
      mother_lab_franchisee?: string;
      mother_lab_label?: string;
      franchisee_type?: string;
      pricing_rule?: string;
      wallet_balance?: number | null;
      credit_limit?: number | null;
      available_to_bill?: number | null;
      channels?: string[];
      roles_ok?: boolean;
      default_phlebotomist?: string;
      default_phlebotomist_name?: string;
      collection_centres?: Array<{
        name: string;
        label: string;
        franchise_name?: string;
        franchisee_type?: string;
        is_mother_lab?: number;
      }>;
    }>('api_get_mother_lab_bill_defaults', {
      method: 'POST',
      body: {},
      auth: true,
      module: 'motherLabBill',
    }),

  listMotherLabBills: (limit = 40, txt = '') =>
    request<{
      bills: Array<{
        name: string;
        unique_barcode?: string;
        patient_name?: string;
        age?: number;
        gender?: string;
        patient_phone?: string;
        order_status?: string;
        creation?: string;
        hec_bill_datetime?: string;
        sample_intake_channel?: string;
        hec_net_amount?: number;
        hec_amount_paid?: number;
        hec_due_amount?: number;
        hec_receipt_mode?: string;
      }>;
      count?: number;
      mother_lab_franchisee?: string;
    }>('api_list_mother_lab_bills', {
      method: 'POST',
      body: { limit, ...(txt ? { txt } : {}) },
      auth: true,
      module: 'motherLabBill',
    }),

  getMotherLabBill: (name: string) =>
    request<{
      bill: Record<string, unknown> & {
        name: string;
        unique_barcode?: string;
        patient_name?: string;
        tests?: Array<Record<string, unknown>>;
        mother_lab_label?: string;
      };
    }>('api_get_mother_lab_bill', {
      method: 'POST',
      body: { name },
      auth: true,
      module: 'motherLabBill',
    }),

  searchMotherLabTests: async (
    txt: string,
    limit = 30,
    opts?: { franchisee_id?: string; intake_channel?: string },
  ) => {
    const q = txt.trim();
    const pricingBody = {
      txt: q,
      limit,
      ...(opts?.franchisee_id ? { franchisee_id: opts.franchisee_id } : {}),
      ...(opts?.intake_channel
        ? { intake_channel: opts.intake_channel, sample_intake_channel: opts.intake_channel }
        : {}),
    };
    type TestHit = {
      item_code: string;
      item_name: string;
      rate: number;
      mrp?: number;
      foco_rate?: number;
      show_mrp_slash?: boolean;
      price_basis?: string;
      kind?: string;
      item_group?: string;
    };
    // 1) Phase 94 (role-gated)
    try {
      return await request<{
        ok?: boolean;
        tests: TestHit[];
        count?: number;
      }>('api_search_mother_lab_tests', {
        method: 'POST',
        body: pricingBody,
        auth: true,
        module: 'motherLabBill',
      });
    } catch {
      // 2) Phase 70 desk search (same catalog Bill Entry uses)
      try {
        return await request<{
          ok?: boolean;
          tests: TestHit[];
        }>('api_search_hec_lab_tests', {
          method: 'POST',
          body: pricingBody,
          auth: true,
          module: 'labBillEntry',
        });
      } catch {
        // 3) Public lab catalog filter (always available when ERP is up)
        const catalog = await request<{ items: CatalogItem[] }>('get_lab_test_catalog', {
          auth: false,
          body: { q, limit },
        });
        const items = catalog.data?.items || [];
        const needle = q.toLowerCase();
        const tests = items
          .filter(
            (it) =>
              (it.item_name || '').toLowerCase().includes(needle) ||
              (it.name || '').toLowerCase().includes(needle),
          )
          .slice(0, limit)
          .map((it) => ({
            item_code: it.name,
            item_name: it.item_name || it.name,
            rate: Number(it.standard_rate || 0),
            mrp: itemMrp(it),
            show_mrp_slash: itemMrp(it) > itemRate(it),
            kind: 'test',
            item_group: it.item_group,
          }));
        return { status: 'success' as const, message: 'OK', data: { ok: true, tests } };
      }
    }
  },

  expandLabBillPanel: (panelId: string) =>
    request<{
      ok?: boolean;
      panel_id?: string;
      tests: Array<{ item: string; item_name?: string; qty?: number; rate?: number }>;
    }>('api_expand_hec_lab_panel', {
      method: 'POST',
      body: { panel_id: panelId },
      auth: true,
      module: 'labBillEntry',
    }),

  repriceMotherLabBillLines: (
    tests: Array<Record<string, unknown>>,
    sample_intake_channel: string,
    franchiseeId?: string,
  ) =>
    request<{ ok?: boolean; tests: Array<Record<string, unknown>> }>(
      'api_reprice_mother_lab_bill_lines',
      {
        method: 'POST',
        body: {
          data: JSON.stringify({
            tests,
            sample_intake_channel,
            ...(franchiseeId ? { franchisee_id: franchiseeId, coll_centre: franchiseeId } : {}),
          }),
        },
        auth: true,
        module: 'motherLabBill',
      },
    ),

  searchMotherLabDoctors: (txt: string, limit = 30) =>
    request<{
      ok?: boolean;
      doctors: Array<{
        name: string;
        doctor_name?: string;
        label?: string;
        mobile?: string;
        whatsapp?: string;
        commission_percent?: number;
      }>;
    }>('api_search_mother_lab_doctors', {
      method: 'POST',
      body: { txt, limit },
      auth: true,
      module: 'motherLabBill',
    }),

  searchReferringDoctors: (txt: string, limit = 30) =>
    request<{
      doctors: Array<{
        name: string;
        doctor_name?: string;
        label?: string;
        mobile?: string;
        whatsapp?: string;
        commission_percent?: number;
      }>;
    }>('api_search_referring_doctors', {
      method: 'POST',
      body: { txt, limit },
      auth: true,
      module: 'hubLabBill',
    }),

  upsertReferringDoctor: (data: Record<string, unknown>) =>
    request<{
      name: string;
      doctor_name: string;
      commission_percent?: number;
      whatsapp?: string;
      mobile?: string;
    }>('api_upsert_referring_doctor', {
      method: 'POST',
      body: { data: JSON.stringify(data) },
      auth: true,
      module: 'hubLabBill',
    }),

  getHubLabBillDefaults: () =>
    request<{
      hub_franchisee?: string;
      hub_label?: string;
      franchisee_type?: string;
      intake_channel?: string;
      wallet_balance?: number;
      credit_limit?: number;
      available_to_bill?: number;
      pricing_rule?: string;
      partner_circuit?: PartnerCircuit | null;
      can_bill_patient?: boolean;
      vector_entry?: VectorEntry | null;
      bill_to_vectors?: VectorOption[];
    }>('api_get_hub_lab_bill_defaults', {
      method: 'POST',
      body: {},
      auth: true,
      module: 'hubLabBill',
    }),

  listHubLabBills: (limit = 40, txt = '', payment_status = '') =>
    request<{
      bills: Array<Record<string, unknown>>;
      count?: number;
      hub_franchisee?: string;
    }>('api_list_hub_lab_bills', {
      method: 'POST',
      body: {
        limit,
        ...(txt ? { txt } : {}),
        ...(payment_status ? { payment_status } : {}),
      },
      auth: true,
      module: 'hubLabBill',
    }),

  getHubLabBill: (name: string) =>
    request<{ bill: Record<string, unknown> }>('api_get_hub_lab_bill', {
      method: 'POST',
      body: { name },
      auth: true,
      module: 'hubLabBill',
    }),

  updateHubPatientPayment: (body: {
    trf_name: string;
    amount_received: number;
    payment_mode: string;
    notes?: string;
  }) =>
    request<{
      trf: string;
      hec_net_amount: number;
      hec_amount_paid: number;
      hec_due_amount: number;
      hec_patient_payment_status: string;
      previous_paid?: number;
      new_payment?: number;
      payment_entry?: Record<string, unknown>;
      payment_history: Array<Record<string, unknown>>;
      bill: Record<string, unknown>;
      receipt?: {
        bill_total?: number;
        previous_payment?: number;
        new_payment?: number;
        total_received?: number;
        remaining_due?: number;
        payment_mode?: string;
        payment_date?: string;
        status?: string;
      };
      receipt_ready?: boolean;
    }>('api_update_hub_patient_payment', {
      method: 'POST',
      body: { data: JSON.stringify(body) },
      auth: true,
      module: 'hubLabBill',
    }),

  listHubDownloadReports: (limit = 50, txt = '') =>
    request<{
      reports: Array<{
        journey_id: string;
        trf_id: string;
        patient_name?: string;
        barcode?: string;
        phone?: string;
        status: string;
        report_pdf?: string;
        updated_at?: string;
        order_status?: string;
      }>;
      count?: number;
    }>('api_list_hub_download_reports', {
      method: 'POST',
      body: { limit, ...(txt ? { txt } : {}) },
      auth: true,
      module: 'hubLabBill',
    }),

  downloadHubReport: (journeyId: string, fileName?: string) =>
    downloadBinary(
      'api_download_hub_report',
      { journey_id: journeyId },
      fileName || `Lab_Report_${journeyId}.pdf`,
      'hubLabBill',
    ),

  searchHubLabTests: (
    txt: string,
    limit = 30,
    opts?: { franchisee_id?: string; intake_channel?: string },
  ) => {
    const body = {
      txt: txt.trim(),
      limit,
      ...(opts?.franchisee_id ? { franchisee_id: opts.franchisee_id } : {}),
      ...(opts?.intake_channel ? { intake_channel: opts.intake_channel } : {}),
    };
    return request<{
      tests: Array<{
        item_code: string;
        item_name: string;
        rate: number;
        mrp?: number;
        show_mrp_slash?: boolean;
      }>;
    }>('api_search_hub_lab_tests', {
      method: 'POST',
      body,
      auth: true,
      module: 'hubLabBill',
    });
  },

  repriceHubLabBillLines: (tests: Array<Record<string, unknown>>, billToVector?: string) =>
    request<{ tests: Array<Record<string, unknown>>; partner_tier?: PartnerTierPreview | null }>('api_reprice_hub_lab_bill_lines', {
      method: 'POST',
      body: { data: JSON.stringify(billToVector ? { tests, bill_to_vector: billToVector } : { tests }) },
      auth: true,
      module: 'hubLabBill',
    }),

  saveHubLabBill: (data: Record<string, unknown>) =>
    request<{
      name: string;
      unique_barcode: string;
      wallet_balance?: number;
      wholesale_amount?: number;
      settlement_error?: string;
    }>('api_save_hub_lab_bill', {
      method: 'POST',
      body: { data: JSON.stringify(data) },
      auth: true,
      module: 'hubLabBill',
    }),

  saveMotherLabBill: (data: Record<string, unknown>) =>
    request<{
      ok?: boolean;
      name: string;
      unique_barcode: string;
      totals?: Record<string, number>;
      sample_intake_channel?: string;
      mother_lab_franchisee?: string;
      phlebotomist?: string;
      phlebotomist_name?: string;
    }>('api_save_mother_lab_bill', {
      method: 'POST',
      body: { data: JSON.stringify(data) },
      auth: true,
      module: 'motherLabBill',
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

  getIqcLjChart: (params: { analyte_code: string; qc_level?: string; limit?: number; days?: number }) =>
    request<{
      analyte_code: string;
      qc_level: string;
      points: Array<{
        run_date: string;
        result_value: number;
        outcome?: string;
        name?: string;
        lab_mean?: number | null;
        lab_sd?: number | null;
        z_score?: number | null;
      }>;
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
    dob?: string;
    gender?: string;
    city?: string;
  }) =>
    request<{ email: string; verification_sent: boolean; patient_id?: string }>('register_patient', {
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

  createPatientWalletRazorpayOrder: (body: { amount: number | string }) =>
    request<RazorpayOrder & { patient_id?: string }>('create_patient_wallet_razorpay_order', {
      method: 'POST',
      body,
      auth: true,
    }),

  verifyPatientWalletRazorpayPayment: (body: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) =>
    request<{
      transaction_id: string;
      amount: number;
      wallet_balance: number;
      already_credited?: boolean;
    }>('verify_patient_wallet_razorpay_payment', { method: 'POST', body, auth: true }),

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
    city?: string;
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

  saveLabReportParameters: (
    labReport: string,
    parameters: LabReportParamEdit[],
    extras?: { comments?: string; report_note?: string },
  ) =>
    request<LabReportDetail>('save_lab_report_parameters', {
      method: 'POST',
      body: {
        lab_report: labReport,
        parameters: JSON.stringify(parameters),
        ...(extras?.comments != null ? { comments: extras.comments } : {}),
        ...(extras?.report_note != null ? { report_note: extras.report_note } : {}),
      },
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

  verifyLabUserPassword: (password: string) =>
    request<{ ok: boolean; user: string }>('verify_lab_user_password', {
      method: 'POST',
      body: { password, confirm_password: password },
      auth: true,
      module: 'labReport',
    }),

  listCommentPresets: (q = '') =>
    request<{ presets: CommentPresetRow[]; categories: string[] }>('list_comment_presets', {
      method: 'POST',
      body: { q },
      auth: true,
      module: 'commentPresets',
    }),

  saveCommentPreset: (payload: { title?: string; category?: string; text: string }) =>
    request<CommentPresetRow>('save_comment_preset', {
      method: 'POST',
      body: {
        title: payload.title || '',
        category: payload.category || 'General',
        text: payload.text,
      },
      auth: true,
      module: 'commentPresets',
    }),

  updateCommentPreset: (payload: { preset_id: string; title?: string; category?: string; text?: string }) =>
    request<CommentPresetRow>('update_comment_preset', {
      method: 'POST',
      body: {
        preset_id: payload.preset_id,
        title: payload.title || '',
        category: payload.category || 'General',
        text: payload.text || '',
      },
      auth: true,
      module: 'commentPresets',
    }),

  deleteCommentPreset: (preset_id: string) =>
    request<{ id: string }>('delete_comment_preset', {
      method: 'POST',
      body: { preset_id },
      auth: true,
      module: 'commentPresets',
    }),

  finalizeLabReport: (labReport: string, confirmPassword = '') =>
    request<{ lab_report: string; trf_id: string; journey_id?: string; complete: boolean }>(
      'finalize_lab_report',
      {
        method: 'POST',
        body: {
          lab_report: labReport,
          ...(confirmPassword ? { confirm_password: confirmPassword } : {}),
        },
        auth: true,
        module: 'labReport',
      },
    ),

  getLabReportPreviewHtml: (labReport: string, letterheadPlain = false) =>
    fetchRawMessage(
      'get_lab_report_preview_html',
      { lab_report: labReport, letterhead_plain: letterheadPlain ? '1' : '0' },
      'labReport',
    ),

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

  getPathologistQueue: (limit = 200) =>
    request<PathologistQueue>('get_pathologist_queue', {
      body: { limit },
      auth: true,
      module: 'reportLifecycle',
    }),

  pathologistSaveDraft: (body: { journey_id?: string; lab_report?: string; remarks?: string }) =>
    request<{ journey_id: string; lab_report?: string | null; stage: string }>('pathologist_save_draft', {
      method: 'POST',
      body: {
        ...(body.journey_id ? { journey_id: body.journey_id } : {}),
        ...(body.lab_report ? { lab_report: body.lab_report } : {}),
        remarks: body.remarks || '',
      },
      auth: true,
      module: 'reportLifecycle',
    }),

  pathologistFinalize: (body: { journey_id?: string; lab_report?: string; remarks?: string }) =>
    request<{
      journey_id: string;
      lab_report?: string | null;
      stage: string;
      report_status: string;
      status: string;
    }>('pathologist_finalize', {
      method: 'POST',
      body: {
        ...(body.journey_id ? { journey_id: body.journey_id } : {}),
        ...(body.lab_report ? { lab_report: body.lab_report } : {}),
        remarks: body.remarks || '',
      },
      auth: true,
      module: 'reportLifecycle',
    }),

  pathologistSendBack: (body: { journey_id?: string; lab_report?: string; reason: string }) =>
    request<{ journey_id: string; stage: string }>('pathologist_send_back', {
      method: 'POST',
      body: {
        ...(body.journey_id ? { journey_id: body.journey_id } : {}),
        ...(body.lab_report ? { lab_report: body.lab_report } : {}),
        reason: body.reason,
      },
      auth: true,
      module: 'reportLifecycle',
    }),

  getLabtechSettings: () =>
    request<LabtechSettingsPayload>('get_labtech_settings', {
      method: 'POST',
      auth: true,
      module: 'labtechSettings',
    }),

  saveLabtechReportingPad: (body: {
    identity?: Record<string, string | number>;
    images?: Record<string, { file_name: string; file_data: string }>;
  }) =>
    request<LabtechSettingsPayload>('save_labtech_reporting_pad', {
      method: 'POST',
      body: {
        identity: body.identity ? JSON.stringify(body.identity) : undefined,
        images: body.images ? JSON.stringify(body.images) : undefined,
      },
      auth: true,
      module: 'labtechSettings',
    }),

  saveLabtechWhatsapp: (body: { report_enabled?: number; report_message?: string }) =>
    request<LabtechSettingsPayload>('save_labtech_whatsapp', {
      method: 'POST',
      body,
      auth: true,
      module: 'labtechSettings',
    }),

  savePathologistSignature: (body: {
    employee: string;
    file_name?: string;
    file_data?: string;
    clear?: number;
  }) =>
    request<LabtechSettingsPayload>('save_pathologist_signature', {
      method: 'POST',
      body,
      auth: true,
      module: 'labtechSettings',
    }),

  saveDepartmentSignatureDefault: (body: {
    department_key: string;
    name?: string;
    qualification?: string;
    file_name?: string;
    file_data?: string;
    clear_image?: number;
  }) =>
    request<LabtechSettingsPayload>('save_department_signature_default', {
      method: 'POST',
      body,
      auth: true,
      module: 'labtechSettings',
    }),

  sendAuthorizedReportWhatsApp: (journeyId: string) =>
    request<ReportWhatsAppResult>('send_authorized_report_whatsapp', {
      method: 'POST',
      body: { journey_id: journeyId },
      auth: true,
      module: 'reportShare',
    }),

  downloadAuthorizedReport: (
    journeyId: string,
    template: ReportChromeTemplate = 'with_header',
    fileName?: string,
  ) =>
    downloadBinary(
      'download_authorized_report_pdf',
      { journey_id: journeyId, template },
      fileName || `Lab_Report_${journeyId}_${template}.pdf`,
      'reportShare',
    ),

  getMyAuthorizedReports: (limit = 50) =>
    request<{ reports: PatientAuthorizedReport[]; count: number }>('get_my_authorized_reports', {
      body: { limit },
      auth: true,
      module: 'reportShare',
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

  updateCriticalAlertsStatus: (alert_names: string[], status: 'Acknowledged' | 'Closed', notes?: string) =>
    request<{ updated: string[]; alert_status: string }>('update_critical_alerts_status', {
      method: 'POST',
      body: { alert_names: JSON.stringify(alert_names), status, notes: notes || '' },
      auth: true,
      module: 'criticalAlerts',
    }),

  resendCriticalAlertNotifications: (alert_names: string[]) =>
    request<{ sent: string[]; failed: string[] }>('resend_critical_alert_notifications', {
      method: 'POST',
      body: { alert_names: JSON.stringify(alert_names) },
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

  ...labInventoryApi(),
  ...foundationsApi(),
  ...phleboFirstApi(),
  ...teleporterApi(),
  ...uberDocApi(),
  ...vaultApi(),
};

/** Patient health vault: every call is scoped server-side to the signed-in account's own and family profiles. */
function vaultApi() {
  type Body = Record<string, string | number | boolean>;
  const call = (module: 'vault' | 'vaultEmr' | 'vaultLife') => <T>(method: string, body: Body = {}) =>
    request<T>(method, { method: 'POST', body, auth: true, module });
  const iam = call('vault');
  const emr = call('vaultEmr');
  const life = call('vaultLife');
  const guest = <T>(method: string, body: Body = {}) => request<T>(method, { method: 'POST', body, auth: false, cookies: true, module: 'vault' });
  const json = (value: unknown) => JSON.stringify(value ?? {});
  const pt = (patient?: string | null): Body => (patient ? { patient } : {});

  return {
    vaultMeta: () => guest<VaultMeta>('vault_meta'),
    vaultOtpLogin: (mobile: string, otp: string) => guest<VaultOtpLoginResult>('vault_otp_login', { mobile, otp }),
    vaultRegister: (mobile: string, data: VaultRegisterPayload, auth: { otp?: string; ticket?: string }) =>
      guest<VaultRegisterResult>('vault_register', {
        mobile,
        payload: json(data),
        ...(auth.otp ? { otp: auth.otp } : {}),
        ...(auth.ticket ? { ticket: auth.ticket } : {}),
      }),
    vaultPublicCard: (uid: string, k: string) => guest<VaultPublicCard>('vault_public_card', { uid, k }),

    vaultMe: () => iam<VaultMe>('vault_me'),
    vaultCreateSelf: (data: VaultRegisterPayload) => iam<VaultMe>('vault_create_self', { payload: json(data) }),
    vaultProfile: (patient?: string | null) => iam<VaultProfileDetail>('vault_profile', pt(patient)),
    vaultProfileSave: (patient: string, data: VaultProfilePayload) => iam<VaultProfileDetail>('vault_profile_save', { patient, payload: json(data) }),
    vaultAddFamily: (data: { patient_name: string; relation: string; gender: string; dob?: string; age?: number; consent: 1 }) =>
      iam<VaultProfile>('vault_add_family', { payload: json(data) }),
    vaultSettingsSave: (patient: string, data: VaultSettingsPayload) => iam<VaultProfileDetail>('vault_settings_save', { patient, payload: json(data) }),
    vaultCard: (patient?: string | null) => iam<VaultCard>('vault_card', pt(patient)),
    vaultCardSvg: (patient?: string | null) => iam<{ filename: string; svg: string }>('vault_card_svg', pt(patient)),
    vaultCardPdf: (patient?: string | null) => iam<VaultFile>('vault_card_pdf', pt(patient)),
    vaultCardRotate: (patient: string) => iam<VaultCard>('vault_card_rotate', { patient }),
    vaultLookupHistory: (patient?: string | null) => iam<{ rows: VaultLookupRow[] }>('vault_lookup_history', pt(patient)),
    vaultExport: (patient?: string | null) => iam<VaultExport>('vault_export', pt(patient)),
    vaultHome: (patient?: string | null) => iam<VaultHome>('vault_home', pt(patient)),

    vaultTimeline: (patient: string | null, filters: VaultTimelineFilters = {}, page = 1, pageSize = 30) =>
      emr<VaultTimeline>('vault_timeline', { ...pt(patient), filters: json(filters), page, page_size: pageSize }),
    vaultRecord: (name: string) => emr<VaultRecord>('vault_record', { name }),
    vaultRecordFile: (name: string) => emr<VaultFile>('vault_record_file', { name }),
    vaultTrends: (patient?: string | null) => emr<{ analytes: VaultTrendItem[] }>('vault_trends', pt(patient)),
    vaultTrend: (patient: string | null, key: string) => emr<VaultTrend>('vault_trend', { ...pt(patient), key }),
    vaultPrescriptions: (patient?: string | null) => emr<{ rows: VaultRxRow[] }>('vault_prescriptions', pt(patient)),
    vaultUpload: (patient: string, data: VaultUploadPayload, filename: string, contentBase64: string) =>
      emr<VaultRecord>('vault_upload', { patient, payload: json(data), filename, content_base64: contentBase64 }),
    vaultUploadDelete: (name: string) => emr<{ deleted: string }>('vault_upload_delete', { name }),

    vaultToday: (patient?: string | null, date = '') => life<VaultChecklist>('vault_today', { ...pt(patient), ...(date ? { date } : {}) }),
    vaultDoseLog: (schedule: string, date: string, slot: string, status: 'Taken' | 'Skipped' | '') =>
      life<VaultChecklist>('vault_dose_log', { schedule, date, slot, status }),
    vaultRoutineLog: (item: string, date: string, done: boolean, minutes?: number | null) =>
      life<VaultChecklist>('vault_routine_log', { item, date, done: done ? 1 : 0, ...(minutes ? { minutes } : {}) }),
    vaultMedications: (patient?: string | null) => life<VaultMedications>('vault_medications', pt(patient)),
    vaultMedicationUpdate: (name: string, data: { times?: string[]; reminders?: 0 | 1; status?: 'Active' | 'Stopped'; reason?: string }) =>
      life<VaultSchedule>('vault_medication_update', { name, payload: json(data) }),
    vaultRoutineUpdate: (name: string, status: 'Active' | 'Stopped' | 'Completed') => life<VaultRoutine>('vault_routine_update', { name, payload: json({ status }) }),
    vaultAdherence: (patient: string | null, days = 30) => life<VaultAdherence>('vault_adherence', { ...pt(patient), days }),
    vaultGoals: (patient?: string | null, includeArchived = false) => life<{ goals: VaultGoal[] }>('vault_goals', { ...pt(patient), include_archived: includeArchived ? 1 : 0 }),
    vaultGoalDetail: (name: string) => life<VaultGoal>('vault_goal_detail', { name }),
    vaultGoalSave: (patient: string | null, data: VaultGoalPayload) => life<VaultGoal>('vault_goal_save', { ...pt(patient), payload: json(data) }),
    vaultGoalEntry: (goal: string, data: { value?: number; value_2?: number; date?: string; notes?: string }) =>
      life<VaultGoal>('vault_goal_entry', { goal, payload: json(data) }),
    vaultGoalEntryDelete: (entry: string) => life<VaultGoal>('vault_goal_entry_delete', { entry }),
    vaultTipToday: (patient?: string | null) => life<{ tip: VaultTip | null; disclaimer: string }>('vault_tip_today', pt(patient)),
    vaultTips: (patient?: string | null) => life<{ rows: VaultTip[]; disclaimer: string }>('vault_tips', pt(patient)),
    vaultTipFeedback: (delivery: string, helpful: 'Yes' | 'No' | '') => life<VaultTip>('vault_tip_feedback', { delivery, helpful }),
  };
}

function labInventoryApi() {
  const post = <T>(method: string, body: Record<string, string | number | boolean> = {}) =>
    request<T>(method, { method: 'POST', body, auth: true, module: 'labInventory' });
  const json = (value: unknown) => JSON.stringify(value ?? {});
  return {
    getInventoryDashboard: () => post<InvDashboard>('get_inventory_dashboard'),
    listInventoryItems: (filters: InvItemFilters, page = 1, pageSize = 10) =>
      post<InvItemList>('list_inventory_items', { filters: json(filters), page, page_size: pageSize }),
    getInventoryItem: (item: string) => post<InvItemDetail>('get_inventory_item', { item }),
    saveInventoryItem: (item: Record<string, unknown>) => post<InvItemDetail>('save_inventory_item', { item: json(item) }),
    inventoryStockIn: (payload: {
      lines: Array<{ item: string; batch_no?: string; expiry_date?: string; location?: string; qty: number; unit_cost?: number; supplier?: string }>;
      supplier?: string;
      reference_no?: string;
      received_on?: string;
      remarks?: string;
    }) => post<{ posted: Array<{ transaction: string; item_name: string; batch_no: string; qty: number }>; count: number }>('inventory_stock_in', { payload: json(payload) }),
    inventoryAdjustStock: (payload: {
      batch: string;
      direction?: 'increase' | 'decrease';
      qty?: number;
      counted_qty?: number | string;
      reason: string;
      remarks?: string;
      reference_no?: string;
    }) => post<{ transaction: string; delta: number; balance: number }>('inventory_adjust_stock', { payload: json(payload) }),
    inventoryTransferStock: (payload: { batch: string; qty: number; to_location: string; remarks?: string }) =>
      post<{ reference_no: string; transactions: string[]; to_batch: string }>('inventory_transfer_stock', { payload: json(payload) }),
    listInventoryTransactions: (filters: InvHistoryFilters, page = 1, pageSize = 20) =>
      post<InvTransactionList>('list_inventory_transactions', { filters: json(filters), page, page_size: pageSize }),
    listInventoryCompanyUnits: (includeInactive = false) =>
      post<{ units: InvCompanyUnit[] }>('list_inventory_company_units', { include_inactive: includeInactive ? 1 : 0 }),
    saveInventoryCompanyUnit: (unit: Partial<InvCompanyUnit> & { grant_requester_role?: number }) =>
      post<InvCompanyUnit>('save_inventory_company_unit', { unit: json(unit) }),
    getMyMaterialRequests: () => post<InvMyRequestsPayload>('get_my_material_requests'),
    listInventoryFranchiseUnits: (q = '') => post<{ units: InvFranchiseUnit[] }>('list_inventory_franchise_units', { q }),
    listMaterialRequisitions: (filters: InvRequisitionFilters, page = 1, pageSize = 20) =>
      post<InvRequisitionList>('list_material_requisitions', { filters: json(filters), page, page_size: pageSize }),
    getMaterialRequisition: (name: string) => post<InvRequisition>('get_material_requisition', { name }),
    createMaterialRequisition: (payload: InvRequestPayload) =>
      post<InvRequisition>('create_material_requisition', { payload: json(payload) }),
    reviewMaterialRequisition: (payload: {
      name: string;
      decision: 'approve' | 'reject';
      lines?: Array<{ line: string; approved_qty: number }>;
      remarks?: string;
    }) => post<InvRequisition>('review_material_requisition', { payload: json(payload) }),
    prepareMaterialRequisition: (name: string) => post<InvRequisition>('prepare_material_requisition', { name }),
    cancelMaterialRequisition: (name: string, reason: string) =>
      post<InvRequisition>('cancel_material_requisition', { name, reason }),
    closeMaterialRequisition: (name: string, remarks: string) =>
      post<InvRequisition>('close_material_requisition', { name, remarks }),
    previewMaterialDispatch: (payload: InvDispatchPayload) =>
      post<{ allocations: InvAllocation[]; total_qty: number }>('preview_material_dispatch', { payload: json(payload) }),
    createMaterialDispatch: (payload: InvDispatchPayload) => post<InvDispatch>('create_material_dispatch', { payload: json(payload) }),
    cancelMaterialDispatch: (name: string, reason: string) => post<InvDispatch>('cancel_material_dispatch', { name, reason }),
    receiveMaterialDispatch: (name: string, remarks = '') => post<InvDispatch>('receive_material_dispatch', { name, remarks }),
    listMaterialDispatches: (filters: InvDispatchFilters, page = 1, pageSize = 20) =>
      post<InvPage<InvDispatch>>('list_material_dispatches', { filters: json(filters), page, page_size: pageSize }),
    getInventoryReports: (dateFrom = '', dateTo = '') =>
      post<InvReports>('get_inventory_reports', { date_from: dateFrom, date_to: dateTo }),
    exportLabInventory: (kind: InvExportKind, fmt: 'xlsx' | 'csv', filters: Record<string, unknown> = {}) =>
      post<InvExportFile>('export_lab_inventory', { kind, fmt, filters: json(filters) }),
    getPartnerMaterialRequests: () => post<InvPartnerPayload>('get_partner_material_requests'),
    createPartnerMaterialRequest: (payload: InvRequestPayload) =>
      post<InvRequisition>('create_partner_material_request', { payload: json(payload) }),
    cancelPartnerMaterialRequest: (name: string, reason = '') =>
      post<InvRequisition>('cancel_partner_material_request', { name, reason }),
    receivePartnerMaterialDispatch: (name: string, remarks = '') =>
      post<InvDispatch>('receive_partner_material_dispatch', { name, remarks }),
    getPartnerUnitStock: (filters: InvUnitStockFilters, page = 1, pageSize = 10) =>
      post<InvUnitStockList>('get_partner_unit_stock', { filters: json(filters), page, page_size: pageSize }),
    getPartnerUnitItem: (item: string) => post<InvUnitItemDetail>('get_partner_unit_item', { item }),
    recordPartnerUnitUsage: (payload: { item: string; qty: number; stock?: string; reason?: string; remarks?: string }) =>
      post<{ used: number; balance: number; batches: number }>('record_partner_unit_usage', { payload: json(payload) }),
    adjustPartnerUnitStock: (payload: {
      stock?: string;
      item?: string;
      batch_no?: string;
      expiry_date?: string;
      direction?: 'increase' | 'decrease';
      qty?: number;
      counted_qty?: number | string;
      reason: string;
      remarks?: string;
    }) => post<{ transaction: string; delta: number; balance: number }>('adjust_partner_unit_stock', { payload: json(payload) }),
    setPartnerUnitMinStock: (item: string, minStock: number | '') =>
      post<{ item: string; min_stock: number | null }>('set_partner_unit_min_stock', { item, min_stock: minStock }),
    listPartnerUnitTransactions: (filters: { q?: string; transaction_type?: string; item?: string; date_from?: string; date_to?: string }, page = 1, pageSize = 20) =>
      post<InvPage<InvUnitTxn>>('list_partner_unit_transactions', { filters: json(filters), page, page_size: pageSize }),
    listInventoryStockUnits: () => post<{ units: InvStockUnit[] }>('list_inventory_stock_units'),
    getInventoryUnitStock: (franchisee: string, filters: InvUnitStockFilters = {}, page = 1, pageSize = 20) =>
      post<InvUnitStockList>('get_inventory_unit_stock', { franchisee, filters: json(filters), page, page_size: pageSize }),
  };
}

function foundationsApi() {
  const post = <T>(method: string, body: Record<string, string | number | boolean> = {}) =>
    request<T>(method, { method: 'POST', body, auth: true, module: 'foundations' });
  const json = (value: unknown) => JSON.stringify(value ?? {});
  return {
    iamMe: () => post<IamMe>('iam_me'),
    iamListProfiles: () => post<{ profiles: PatientProfile[] }>('iam_list_profiles'),
    iamAddDependant: (payload: AddDependantPayload) => post<PatientProfile>('iam_add_dependant', { payload: json(payload) }),
    iamMergePatients: (source: string, target: string, notes = '') =>
      post<{ log: string; source: string; target: string; repointed: Record<string, number> }>('iam_merge_patients', {
        source,
        target,
        notes,
      }),
    issueHandoffCode: (targetHost: string) =>
      post<{ code: string; expires_in: number; target_host: string }>('iam_issue_handoff_code', { target_host: targetHost }),
    redeemHandoffCode: (code: string) =>
      request<HandoffSession>('iam_redeem_handoff_code', {
        method: 'POST',
        body: { code },
        auth: false,
        cookies: true,
        module: 'foundations',
      }),
    /** Private prescription uploads are streamed through rx_file (owner or pharmacy staff only). */
    fetchPrescriptionFile: async (fileUrl: string): Promise<Blob> => {
      const sid = getSid();
      const res = await fetch(apiUrl('rx_file', 'foundations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Frappe-Site-Name': import.meta.env.VITE_SITE_NAME || 'health.localhost',
        },
        body: new URLSearchParams({ file_url: fileUrl, ...(sid ? { sid } : {}) }).toString(),
        credentials: 'include',
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        let msg = 'Could not open the prescription';
        try {
          const body = (await res.json()) as { message?: { message?: string } | string };
          msg = (typeof body.message === 'object' ? body.message?.message : body.message) || msg;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      return res.blob();
    },
    printLabels: (codes: string[], fmt: LabelFormat = 'pdf', size = '50x25', captions: Record<string, string> = {}) =>
      post<LabelOutput>('barcode_labels', { codes: json(codes), fmt, size, captions: json(captions) }),
    getCustodyChain: (scanCode: string) => post<CustodyChain>('custody_chain', { scan_code: scanCode }),
    listFieldProviders: (filters: { status?: string; type?: 'rider' | 'runner'; q?: string } = {}, page = 1, pageSize = 20) =>
      post<{ rows: FieldProvider[]; total: number; page: number; page_size: number }>('fp_list', {
        filters: json(filters),
        page,
        page_size: pageSize,
      }),
    saveFieldProvider: (payload: Record<string, unknown>) => post<FieldProvider>('fp_save', { payload: json(payload) }),
    listPayouts: (filters: { provider?: string; status?: string; entry_type?: string; period?: string } = {}, page = 1, pageSize = 20) =>
      post<{ rows: PayoutRow[]; total: number; totals: Record<string, number> }>('payout_list', {
        filters: json(filters),
        page,
        page_size: pageSize,
      }),
    postPayout: (payload: { provider: string; entry_type: PayoutRow['entry_type']; amount: number; period?: string; source_doctype?: string; source_name?: string; remarks?: string }) =>
      post<PayoutRow>('payout_post', { payload: json(payload) }),
    setPayoutStatus: (name: string, status: PayoutRow['status'], paidRef = '') =>
      post<PayoutRow>('payout_set_status', { name, status, paid_ref: paidRef }),
    listApiClients: () => post<{ clients: ApiClientRow[] }>('api_client_list'),
    createApiClient: (clientName: string, clientType: ApiClientRow['client_type'], scopes: string[], linkedLab = '', notes = '') =>
      post<ApiClientSecret>('api_client_create', {
        client_name: clientName,
        client_type: clientType,
        scopes: json(scopes),
        linked_lab: linkedLab,
        notes,
      }),
    rotateApiClient: (name: string) => post<ApiClientSecret>('api_client_rotate', { name }),
    setApiClientActive: (name: string, active: boolean) =>
      post<{ name: string; active: number }>('api_client_set_active', { name, active: active ? 1 : 0 }),
    registerDevice: (deviceId: string, platform = 'Web', pushSubscription?: unknown) =>
      post<{ name: string; device_id: string; push: boolean }>('device_register', {
        device_id: deviceId,
        platform,
        ...(pushSubscription ? { push_subscription: json(pushSubscription) } : {}),
      }),
    unregisterDevice: (deviceId: string) => post<{ removed: boolean }>('device_unregister', { device_id: deviceId }),
  };
}

function phleboFirstApi() {
  const post = <T>(method: string, body: Record<string, string | number | boolean> = {}) =>
    request<T>(method, { method: 'POST', body, auth: true, module: 'phlebofirst' });
  const json = (value: unknown) => JSON.stringify(value ?? {});
  const coords = (lat?: number | null, lng?: number | null) =>
    lat != null && lng != null ? { lat, lng } : ({} as Record<string, number>);
  return {
    pfMe: () => post<PfMe>('pf_me'),
    pfCreateRequest: (payload: PfCreateRequestPayload) => post<PfRequestDetail>('pf_create_request', { payload: json(payload) }),
    pfMyRequests: (status = '', page = 1, pageSize = 20) =>
      post<PfMyRequests>('pf_my_requests', { status, page, page_size: pageSize }),
    pfRequestDetail: (name: string) => post<PfRequestDetail>('pf_request_detail', { name }),
    pfCancelRequest: (name: string, reason = '') => post<PfRequestDetail>('pf_cancel_request', { name, reason }),
    /** Private TRF / prescription upload, streamed to the customer, the assigned lab or operations. */
    fetchPfRequestFile: async (name: string): Promise<Blob> => {
      const sid = getSid();
      const res = await fetch(apiUrl('pf_request_file', 'phlebofirst'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Frappe-Site-Name': import.meta.env.VITE_SITE_NAME || 'health.localhost',
        },
        body: new URLSearchParams({ name, ...(sid ? { sid } : {}) }).toString(),
        credentials: 'include',
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        let msg = 'Could not open the file';
        try {
          const body = (await res.json()) as { message?: { message?: string } | string };
          msg = (typeof body.message === 'object' ? body.message?.message : body.message) || msg;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      return res.blob();
    },
    pfLabInbox: (status = 'pending', q = '', page = 1, pageSize = 30) =>
      post<PfLabInbox>('pf_lab_inbox', { status, q, page, page_size: pageSize }),
    pfOpenRequest: (name: string) => post<PfRequestDetail>('pf_open_request', { name }),
    pfRequestOcr: (name: string) => post<PfOcrResult>('pf_request_ocr', { name }),
    pfSearchTests: (q: string, limit = 25) => post<{ items: PfTestHit[] }>('pf_search_tests', { q, limit }),
    pfApproveRequest: (
      name: string,
      items: PfApproveItem[],
      fees: { collection_fee?: number; rider_payout?: number; discount?: number; notes?: string } = {},
    ) =>
      post<PfRequestDetail>('pf_approve_request', {
        name,
        items: json(items),
        ...(fees.collection_fee != null ? { collection_fee: fees.collection_fee } : {}),
        ...(fees.rider_payout != null ? { rider_payout: fees.rider_payout } : {}),
        ...(fees.discount != null ? { discount: fees.discount } : {}),
        notes: fees.notes || '',
      }),
    pfRejectRequest: (name: string, reason: string) => post<PfRequestDetail>('pf_reject_request', { name, reason }),
    pfLabJobs: () => post<PfJobBoard>('pf_lab_jobs'),
    pfOpenJobs: (lat?: number | null, lng?: number | null) => post<PfOpenJobs>('pf_open_jobs', coords(lat, lng)),
    pfAcceptJob: (name: string, lat?: number | null, lng?: number | null) =>
      post<PfJobDetail>('pf_accept_job', { name, ...coords(lat, lng) }),
    pfReleaseJob: (name: string, reason = '') => post<{ name: string; status: string }>('pf_release_job', { name, reason }),
    pfMyJobs: () => post<PfMyJobs>('pf_my_jobs'),
    pfJobDetail: (name: string) => post<PfJobDetail>('pf_job_detail', { name }),
    pfStartJob: (name: string) => post<PfJobDetail>('pf_start_job', { name }),
    pfJobDrawPlan: (name: string) => post<{ tubes: PfTube[] }>('pf_job_draw_plan', { name }),
    pfCheckBarcode: (name: string, tubeRow: string, code: string) =>
      post<PfBarcodeCheck>('pf_check_barcode', { name, tube_row: tubeRow, code }),
    pfBindBarcode: (name: string, tubeRow: string, code: string, lat?: number | null, lng?: number | null, deviceId = '') =>
      post<PfBindResult>('pf_bind_barcode', { name, tube_row: tubeRow, code, device_id: deviceId, ...coords(lat, lng) }),
    pfUnbindBarcode: (name: string, code: string, reason: string, deviceId = '') =>
      post<{ code: string; tubes: PfTube[] }>('pf_unbind_barcode', { name, code, reason, device_id: deviceId }),
    pfMarkCollected: (name: string) => post<PfJobDetail>('pf_mark_collected', { name }),
    pfHubLookup: (code: string) => post<PfHub>('pf_hub_lookup', { code }),
    pfDropAtHub: (name: string, hubCode: string, codes: string[], lat?: number | null, lng?: number | null, deviceId = '') =>
      post<PfJobDetail>('pf_drop_at_hub', { name, hub_code: hubCode, codes: json(codes), device_id: deviceId, ...coords(lat, lng) }),
    pfMyEarnings: () => post<PfEarnings>('pf_my_earnings'),
    pfOpsDashboard: (filters: { status?: string; lab?: string; all?: number } = {}, page = 1, pageSize = 50) =>
      post<PfJobBoard>('pf_ops_dashboard', { filters: json(filters), page, page_size: pageSize }),
    pfOpsRequests: (status = 'all', q = '', page = 1, pageSize = 30) =>
      post<PfLabInbox>('pf_ops_requests', { status, q, page, page_size: pageSize }),
    pfAssignLab: (name: string, lab: string) => post<PfRequestDetail>('pf_assign_lab', { name, lab }),
    pfAccountsList: (q = '') => post<{ rows: PfAccount[] }>('pf_accounts_list', { q }),
    pfAccountSave: (payload: Partial<PfAccount> & { add_users?: string[]; remove_users?: string[] }) =>
      post<PfAccount>('pf_account_save', { payload: json(payload) }),
    pfLabSettingsList: () => post<{ rows: PfLabSettings[] }>('pf_lab_settings_list'),
    pfLabSettingsSave: (payload: Partial<PfLabSettings> & { lab: string }) =>
      post<PfLabSettings>('pf_lab_settings_save', { payload: json(payload) }),
    pfHubsList: (includeInactive = true) => post<{ rows: PfHub[] }>('pf_hubs_list', { include_inactive: includeInactive ? 1 : 0 }),
    pfHubSave: (payload: Partial<PfHub>) => post<PfHub>('pf_hub_save', { payload: json(payload) }),
    pfIssueBarcodes: (tubeCode: string, count: number, kit = '', rider = '') =>
      post<{ codes: string[]; tube_code: string; batch: string }>('pf_issue_barcodes', { tube_code: tubeCode, count, kit, rider }),
    pfPrintCodes: (codes: string[], fmt: LabelFormat = 'pdf', size = '50x25') =>
      post<LabelOutput>('pf_print_codes', { codes: json(codes), fmt, size }),
    pfBarcodesList: (filters: { status?: string; tube_code?: string; kit?: string; rider?: string; q?: string } = {}, page = 1, pageSize = 50) =>
      post<{ rows: PfBarcodeRow[]; total: number; counts: Record<string, number> }>('pf_barcodes_list', {
        filters: json(filters),
        page,
        page_size: pageSize,
      }),
    pfVoidBarcode: (code: string, reason: string) => post<{ code: string; status: string }>('pf_void_barcode', { code, reason }),
    pfIssueKit: (rider: string, tubes: Record<string, number>, notes = '') =>
      post<{ kit: string; rider: string; contents: Record<string, number>; codes: string[] }>('pf_issue_kit', {
        rider,
        tubes: json(tubes),
        notes,
      }),
    pfKitsList: (rider = '') => post<{ rows: PfKitRow[] }>('pf_kits_list', { rider }),
    pfRidersList: (q = '') => post<{ rows: PfRiderRow[] }>('pf_riders_list', { q }),
    pfRiderEnable: (
      user: string,
      enable: boolean,
      opts: { home_lat?: number | null; home_lng?: number | null; service_radius_km?: number | null; mobile?: string } = {},
    ) =>
      post<{ name: string }>('pf_rider_enable', {
        user,
        enable: enable ? 1 : 0,
        ...(opts.home_lat != null && opts.home_lng != null ? { home_lat: opts.home_lat, home_lng: opts.home_lng } : {}),
        ...(opts.service_radius_km != null ? { service_radius_km: opts.service_radius_km } : {}),
        ...(opts.mobile ? { mobile: opts.mobile } : {}),
      }),
  };
}

function teleporterApi() {
  type Body = Record<string, string | number | boolean>;
  const post = <T>(method: string, body: Body = {}) =>
    request<T>(method, { method: 'POST', body, auth: true, module: 'teleporter' });
  const guest = <T>(method: string, body: Body = {}) =>
    request<T>(method, { method: 'POST', body, auth: false, cookies: true, module: 'teleporter' });
  /** Drops blank optional values so the backend sees its defaults. */
  const opt = (values: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
  };
  const json = (value: unknown) => JSON.stringify(value ?? {});
  const payload = (value: Record<string, unknown>) => ({ payload: json(opt(value)) });
  // Ops save payloads keep blank / null values so editing a record can clear a field.
  const record = (value: object) => ({ payload: json(value) });
  const filters = (value: Record<string, unknown> = {}) => ({ filters: json(opt(value)) });
  const scalars = (values: Record<string, string | number | boolean | null | undefined>) => opt(values) as Body;

  return {
    tpSignup: (kind: TpPartyKind, mobile: string, otp: string, data: TpSignupPayload) =>
      guest<TpSignupResult>('tp_signup', { kind, mobile, otp, payload: json(opt(data)) }),
    tpOtpLogin: (mobile: string, otp: string) => guest<TpAuthSession>('tp_otp_login', { mobile, otp }),

    tpMe: () => post<TpMe>('tp_me'),

    tpMyPoint: (center = '') => post<TpMyPoint>('tp_my_point', scalars({ center })),
    tpCreateManifest: (data: TpCreateManifestPayload) => post<TpManifestSamplesResult>('tp_create_manifest', payload(data)),
    tpManifestAddSamples: (manifest: string, samples: string[]) =>
      post<TpManifestSamplesResult>('tp_manifest_add_samples', { manifest, samples: json(samples) }),
    tpManifestRemoveSample: (manifest: string, code: string) => post<TpManifest>('tp_manifest_remove_sample', { manifest, code }),
    tpOriginScan: (data: TpOriginScanPayload) => post<TpOriginScanResult>('tp_origin_scan', payload(data)),
    tpMyManifests: (center = '', status = '', days = 14) =>
      post<{ rows: TpManifest[] }>('tp_my_manifests', scalars({ center, status, days })),
    tpCancelManifest: (name: string, reason: string) => post<TpManifest>('tp_cancel_manifest', { name, reason }),
    tpManifestDetail: (name: string) => post<TpManifest>('tp_manifest_detail', { name }),

    tpLabExpected: (lab = '') => post<{ labs: TpLab[]; expected: TpManifest[] }>('tp_lab_expected', scalars({ lab })),
    tpDestinationScan: (data: TpDestinationScanPayload) => post<TpDestinationScanResult>('tp_destination_scan', payload(data)),
    tpAccessionUnlocked: (manifest: string) => post<TpAccessionResult>('tp_accession_unlocked', { manifest }),
    tpLabReceived: (lab = '', days = 7) => post<{ rows: TpManifest[] }>('tp_lab_received', scalars({ lab, days })),

    tpRunnerToday: () => post<TpRunnerToday>('tp_runner_today'),
    tpRunnerBadge: () => post<TpRunnerBadge>('tp_runner_badge'),

    tpSignupsList: (kind: TpPartyKind | '' = '') => post<{ rows: TpParty[] }>('tp_signups_list', scalars({ kind })),
    tpSignupApprove: (kind: TpPartyKind, name: string) => post<TpParty>('tp_signup_approve', { kind, name }),
    tpSignupReject: (kind: TpPartyKind, name: string, reason: string) => post<TpParty>('tp_signup_reject', { kind, name, reason }),
    tpCentersList: (f: TpPartyFilters = {}) => post<{ rows: TpParty[] }>('tp_centers_list', filters(f)),
    tpCenterSave: (data: TpPartySavePayload) => post<TpParty>('tp_center_save', record(data)),
    tpLabsList: (f: TpPartyFilters = {}) => post<{ rows: TpParty[] }>('tp_labs_list', filters(f)),
    tpLabSave: (data: TpPartySavePayload) => post<TpParty>('tp_lab_save', record(data)),
    tpPartySetStatus: (kind: TpPartyKind, name: string, status: 'Active' | 'Suspended') =>
      post<TpParty>('tp_party_set_status', { kind, name, status }),

    tpTiersList: () => post<{ rows: TpTier[] }>('tp_tiers_list'),
    tpTierSave: (data: Partial<TpTier> & { tier: TpTier['tier'] }) => post<TpTier>('tp_tier_save', record(data)),

    tpIceboxRegister: (tier: string, count: number, notes = '') =>
      post<{ created: string[]; rows: TpIcebox[] }>('tp_icebox_register', { tier, count, ...scalars({ notes }) }),
    tpIceboxList: (f: TpIceboxFilters = {}, page = 1, pageSize = 50) =>
      post<{ rows: TpIcebox[]; total: number; page: number; page_size: number }>('tp_icebox_list', {
        ...filters(f),
        page,
        page_size: pageSize,
      }),
    // '' subscription / runner unassigns, so blanks are kept.
    tpIceboxAssign: (data: { carrier_code: string; subscription?: string; runner?: string }) =>
      post<TpIcebox>('tp_icebox_assign', record(data)),
    tpIceboxSetStatus: (carrierCode: string, status: 'In Stock' | 'Maintenance' | 'Retired', notes = '') =>
      post<TpIcebox>('tp_icebox_set_status', { carrier_code: carrierCode, status, ...scalars({ notes }) }),
    tpIceboxLabels: (codes: string[], fmt: LabelFormat = 'pdf', size = '50x25') =>
      post<LabelOutput>('tp_icebox_labels', { codes: json(codes), fmt, size }),

    tpRunnersList: (q = '') => post<{ rows: TpRunner[] }>('tp_runners_list', scalars({ q })),
    tpRunnerEnable: (user: string, enable: boolean, mobile = '') =>
      post<TpRunner>('tp_runner_enable', { user, enable: enable ? 1 : 0, ...scalars({ mobile }) }),

    tpLookup: (kind: TpLookupKind, q = '') => post<{ rows: TpLookupRow[] }>('tp_lookup', { kind, q }),

    tpMappingList: (f: { center?: string; lab?: string; active?: number } = {}) =>
      post<{ rows: TpMapping[] }>('tp_mapping_list', filters(f)),
    tpMappingSave: (data: TpMappingSavePayload) => post<TpMapping>('tp_mapping_save', record(data)),

    tpSubscriptionList: (f: { status?: string; center?: string; tier?: string } = {}) =>
      post<{ rows: TpSubscription[] }>('tp_subscription_list', filters(f)),
    tpSubscriptionSave: (data: TpSubscriptionSavePayload) => post<TpSubscription>('tp_subscription_save', record(data)),
    tpSubscriptionActivate: (name: string, paymentMode: TpPaymentMode, paymentRef = '', amountPaid?: number | null) =>
      post<TpSubscription>('tp_subscription_activate', {
        name,
        payment_mode: paymentMode,
        ...scalars({ payment_ref: paymentRef, amount_paid: amountPaid }),
      }),
    tpSubscriptionSetStatus: (name: string, status: 'Active' | 'Paused' | 'Cancelled', reason = '') =>
      post<TpSubscription>('tp_subscription_set_status', { name, status, ...scalars({ reason }) }),

    tpManifestsBoard: (f: TpBoardFilters = {}, page = 1, pageSize = 50) =>
      post<{ rows: TpManifest[]; total: number; counts: Record<string, number> }>('tp_manifests_board', {
        ...filters(f),
        page,
        page_size: pageSize,
      }),
    tpMarkException: (name: string, reason: string) => post<TpManifest>('tp_mark_exception', { name, reason }),
    tpCustodyChain: (code: string) => post<TpCustodyChain>('tp_custody_chain', { code }),
    tpTatReport: (dateFrom: string, dateTo: string, lab = '', center = '') =>
      post<TpTatReport>('tp_tat_report', { date_from: dateFrom, date_to: dateTo, ...scalars({ lab, center }) }),
  };
}

function uberDocApi() {
  type Body = Record<string, string | number | boolean>;
  const post = <T>(method: string, body: Body = {}) =>
    request<T>(method, { method: 'POST', body, auth: true, module: 'uberdoc' });
  const rxPost = <T>(method: string, body: Body = {}) =>
    request<T>(method, { method: 'POST', body, auth: true, module: 'uberdocRx' });
  const guest = <T>(method: string, body: Body = {}) =>
    request<T>(method, { method: 'POST', body, auth: false, cookies: true, module: 'uberdoc' });
  /** Drops blank optional values so the backend sees its defaults. */
  const opt = (values: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
  };
  const json = (value: unknown) => JSON.stringify(value ?? {});
  // Save payloads keep blank / null values so editing a record can clear a field.
  const record = (value: object) => ({ payload: json(value) });
  const filters = (value: Record<string, unknown> = {}) => ({ filters: json(opt(value)) });
  const scalars = (values: Record<string, string | number | boolean | null | undefined>) => opt(values) as Body;

  return {
    udMeta: () => guest<UdMeta>('ud_meta'),
    udOtpLogin: (mobile: string, otp: string) => guest<UdAuthSession>('ud_otp_login', { mobile, otp }),
    udProviderSignup: (mobile: string, otp: string, data: UdProviderSignupPayload) =>
      guest<UdSignupResult>('ud_provider_signup', { mobile, otp, payload: json(opt(data)) }),
    udClinicSignup: (mobile: string, otp: string, data: UdClinicSignupPayload) =>
      guest<UdSignupResult>('ud_clinic_signup', { mobile, otp, payload: json(data) }),
    udSearchProviders: (f: Record<string, unknown> = {}) =>
      guest<{ rows: UdProviderCard[]; total: number; page: number; page_size: number }>('ud_search_providers', filters(f)),
    udProviderProfile: (name: string, customerType = '') =>
      guest<UdProviderPublic>('ud_provider_profile', { name, ...scalars({ customer_type: customerType }) }),
    udSlots: (provider: string, dateFrom = '', days = 7, mode = '') =>
      guest<UdSlots>('ud_slots', { provider, days, ...scalars({ date_from: dateFrom, mode }) }),
    udPrograms: (f: Record<string, unknown> = {}) => guest<{ rows: UdProgramCard[] }>('ud_programs', filters(f)),
    /** Sends the session when signed in so enrolled modules unlock. */
    udProgramDetail: (name: string) => post<UdProgram>('ud_program_detail', { name }),
    udVerifyRx: (code: string) =>
      request<UdVerify>('ud_verify_rx', { method: 'POST', body: { code }, auth: false, module: 'uberdocRx' }),

    udMe: () => post<UdMe>('ud_me'),
    udBook: (data: UdBookPayload) => post<UdBooking>('ud_book', { payload: json(opt(data)) }),
    udMyBookings: (scope: 'upcoming' | 'past' | 'all' = 'upcoming') => post<{ rows: UdBookingRow[] }>('ud_my_bookings', { scope }),
    udBookingDetail: (name: string) => post<UdBooking>('ud_booking_detail', { name }),
    udCancelBooking: (name: string, reason = '') => post<UdBooking>('ud_cancel_booking', { name, ...scalars({ reason }) }),
    udJoinRoom: (name: string) => post<UdJoin>('ud_join_room', { name }),
    udPostMessage: (name: string, body: string) => post<UdBooking>('ud_post_message', { name, body }),
    udPayCreate: (kind: UdPayKind, name: string) => post<UdPayOrder>('ud_pay_create', { kind, name }),
    udPayVerify: (kind: UdPayKind, name: string, orderId: string, paymentId: string, signature = '') =>
      post<{ doctype: string; name: string; status: string; already_paid: boolean }>('ud_pay_verify', {
        kind,
        name,
        order_id: orderId,
        payment_id: paymentId,
        ...scalars({ signature }),
      }),
    udProgramEnroll: (program: string, patient = '', data: { patient_name?: string; gender?: string } = {}) =>
      post<UdEnrollment>('ud_program_enroll', { program, ...scalars({ patient }), payload: json(opt(data)) }),
    udMyEnrollments: () => post<{ rows: UdEnrollment[] }>('ud_my_enrollments'),
    udEnrollmentProgress: (name: string, moduleRow: string, done: boolean) =>
      post<UdEnrollment>('ud_enrollment_progress', { name, module_row: moduleRow, done: done ? 1 : 0 }),

    udProviderMe: () => post<UdProvider>('ud_provider_me'),
    udProviderProfileSave: (data: UdProviderProfilePayload) => post<UdProvider>('ud_provider_profile_save', record(data)),
    udProviderRatesSave: (rates: UdRate[]) => post<UdProvider>('ud_provider_rates_save', { rates: json(rates) }),
    udProviderCredentialUpload: (docType: UdCredentialType, filename: string, contentBase64: string, notes = '') =>
      post<UdProvider>('ud_provider_credential_upload', {
        doc_type: docType,
        filename,
        content_base64: contentBase64,
        ...scalars({ notes }),
      }),
    udProviderCredentialRemove: (row: string) => post<UdProvider>('ud_provider_credential_remove', { row }),
    udProviderPhotoUpload: (filename: string, contentBase64: string) =>
      post<UdProvider>('ud_provider_photo_upload', { filename, content_base64: contentBase64 }),
    udCredentialFile: (row: string, provider = '') => post<UdFileOut>('ud_credential_file', { row, ...scalars({ provider }) }),
    udProviderSubmit: () => post<UdProvider>('ud_provider_submit'),
    udAvailability: () => post<UdAvailability>('ud_availability'),
    udRuleSave: (data: UdRulePayload) => post<UdAvailability>('ud_rule_save', record(data)),
    udRuleDelete: (name: string) => post<UdAvailability>('ud_rule_delete', { name }),
    udTimeOffSave: (data: { starts_at: string; ends_at: string; reason?: string }) => post<UdAvailability>('ud_time_off_save', record(data)),
    udTimeOffDelete: (name: string) => post<UdAvailability>('ud_time_off_delete', { name }),
    udProviderCalendar: (dateFrom = '', days = 7) => post<UdCalendar>('ud_provider_calendar', { days, ...scalars({ date_from: dateFrom }) }),
    udProviderDashboard: (date = '', days = 14) => post<UdProviderDashboard>('ud_provider_dashboard', { days, ...scalars({ date }) }),
    udBookingSetStatus: (name: string, status: string, reason = '') =>
      post<UdBooking>('ud_booking_set_status', { name, status, ...scalars({ reason }) }),
    udProviderRespond: (name: string, accept: boolean, reason = '') =>
      post<UdBooking>('ud_provider_respond', { name, accept: accept ? 1 : 0, ...scalars({ reason }) }),
    udMyPrograms: () => post<{ rows: UdProgramCard[] }>('ud_my_programs'),
    udProgramSave: (data: UdProgramPayload) => post<UdProgram>('ud_program_save', record(data)),
    udProgramSubmit: (name: string) => post<UdProgram>('ud_program_submit', { name }),
    udProviderSettlements: () => post<{ rows: UdSettlement[] }>('ud_provider_settlements'),

    udClinicMe: (clinic = '') => post<{ clinics: UdClinic[] }>('ud_clinic_me', scalars({ clinic })),
    udClinicSave: (data: Partial<UdClinic> & { name: string }) => post<UdClinic>('ud_clinic_save', record(data)),
    udClinicRequestShift: (data: UdShiftPayload) => post<UdBooking>('ud_clinic_request_shift', record(data)),
    udClinicBookings: (clinic = '', scope: 'upcoming' | 'past' | 'all' = 'upcoming') =>
      post<{ rows: UdBookingRow[] }>('ud_clinic_bookings', { scope, ...scalars({ clinic }) }),
    udClinicSettlements: (clinic = '', status = '') => post<{ rows: UdSettlement[] }>('ud_clinic_settlements', scalars({ clinic, status })),

    udOpsOverview: () => post<UdOpsOverview>('ud_ops_overview'),
    udOpsConfig: () => post<UdConfig>('ud_ops_config'),
    udOpsProviders: (f: Record<string, unknown> = {}) =>
      post<{ rows: UdProvider[]; counts: Record<string, number> }>('ud_ops_providers', filters(f)),
    udOpsProviderAction: (name: string, action: UdProviderAction, reason = '') =>
      post<UdProvider>('ud_ops_provider_action', { name, action, ...scalars({ reason }) }),
    udOpsApplications: () => post<{ rows: UdApplicationRow[] }>('ud_ops_applications'),
    udOpsImportApplication: (application: string) => post<UdProvider>('ud_ops_import_application', { application }),
    udOpsClinics: (f: Record<string, unknown> = {}) => post<{ rows: UdClinic[]; counts: Record<string, number> }>('ud_ops_clinics', filters(f)),
    udOpsClinicAction: (name: string, action: UdClinicAction, reason = '') =>
      post<UdClinic>('ud_ops_clinic_action', { name, action, ...scalars({ reason }) }),
    udOpsClinicSave: (data: Omit<Partial<UdClinic>, 'users'> & { users?: string[] }) =>
      post<UdClinic>('ud_ops_clinic_save', record(data)),
    udOpsBookings: (f: UdBookingFilters = {}, page = 1, pageSize = 50) =>
      post<{ rows: UdBookingRow[]; total: number; page: number; page_size: number }>('ud_ops_bookings', {
        ...filters(f),
        page,
        page_size: pageSize,
      }),
    udOpsMarkPaid: (name: string, paymentMode: UdOfflineMode, paymentRef = '', kind: UdPayKind = 'booking') =>
      post<{ status: string }>('ud_ops_mark_paid', { name, kind, payment_mode: paymentMode, ...scalars({ payment_ref: paymentRef }) }),
    udOpsClearRefund: (name: string, refundRef: string) => post<UdBookingRow>('ud_ops_clear_refund', { name, refund_ref: refundRef }),
    udOpsPrograms: (status = '') => post<{ rows: UdProgramCard[]; counts: Record<string, number> }>('ud_ops_programs', scalars({ status })),
    udOpsProgramDetail: (name: string) => post<UdProgram>('ud_ops_program_detail', { name }),
    udOpsProgramAction: (name: string, action: UdProgramAction, notes = '') =>
      post<UdProgram>('ud_ops_program_action', { name, action, ...scalars({ notes }) }),
    udOpsSettlements: (f: { clinic?: string; provider?: string; status?: string } = {}) =>
      post<{ rows: UdSettlement[] }>('ud_ops_settlements', scalars(f)),
    udOpsSettlementAction: (
      name: string,
      action: UdSettlementAction,
      extra: { invoice_no?: string; payment_mode?: UdOfflineMode; payment_ref?: string; notes?: string } = {},
    ) => post<UdSettlement>('ud_ops_settlement_action', { name, action, ...scalars(extra) }),
    udOpsWebhooks: (status = '') =>
      request<UdWebhookList>('emr_deliveries', { method: 'POST', body: scalars({ status }), auth: true, module: 'emr' }),
    udOpsWebhookRetry: (name: string) =>
      request<UdWebhookDelivery>('emr_delivery_retry', { method: 'POST', body: { name }, auth: true, module: 'emr' }),
    udMyEmrRecords: (recordType = '') =>
      request<{ records: UdEmrRecord[] }>('emr_my_records', { method: 'POST', body: scalars({ record_type: recordType }), auth: true, module: 'emr' }),

    udRxStart: (booking: string) => rxPost<UdRx>('ud_rx_start', { booking }),
    udRxGet: (name: string) => rxPost<UdRx>('ud_rx_get', { name }),
    udRxSave: (name: string, data: UdRxSavePayload) => rxPost<UdRx>('ud_rx_save', { name, payload: json(data) }),
    udRxSign: (name: string) => rxPost<UdRx>('ud_rx_sign', { name }),
    udRxCancel: (name: string, reason: string) => rxPost<UdRx>('ud_rx_cancel', { name, reason }),
    udRxPdf: (name: string) => rxPost<UdFileOut>('ud_rx_pdf', { name }),
    udRxJson: (name: string) => rxPost<{ filename: string; rx: Record<string, unknown> }>('ud_rx_json', { name }),
    udMyPrescriptions: () => rxPost<{ rows: UdRxListRow[] }>('ud_my_prescriptions'),
    udProviderPrescriptions: (status = '') => rxPost<{ rows: UdRxListRow[] }>('ud_provider_prescriptions', scalars({ status })),
    udIcdSearch: (q: string) => rxPost<UdIcdSearch>('ud_icd_search', { q }),
    udMedSearch: (q: string) => rxPost<{ rows: UdMedRow[] }>('ud_med_search', { q }),
    udTestSearch: (q: string) => rxPost<{ rows: UdTestRow[] }>('ud_test_search', { q }),
    udRxPrograms: (q = '') => rxPost<{ rows: UdProgramPick[] }>('ud_rx_programs', scalars({ q })),
    udOpsIcdList: (q = '') => rxPost<{ rows: UdIcdRow[] }>('ud_ops_icd_list', scalars({ q })),
    udOpsIcdSave: (data: { code: string; description?: string; active?: number }) => rxPost<UdIcdRow>('ud_ops_icd_save', record(data)),
  };
}

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

export type VoiceDepartment = 'Franchise' | 'Patient' | 'B2B' | 'Hiring';

export type VoiceDepartmentStats = {
  department: string;
  calls: number;
  connected: number;
  hot: number;
  warm: number;
  meetings: number;
  cost: number;
  talk_seconds: number;
  connect_rate: number;
  cost_per_meeting: number | null;
};

export type VoiceDashboard = {
  departments: VoiceDepartmentStats[];
  totals: { calls: number; connected: number; hot: number; warm: number; meetings: number };
  qa_pending: number;
  follow_ups_due: number;
  status: {
    voice_agent_enabled: boolean;
    outbound_enabled: boolean;
    bolna_ready: boolean;
    webhook_secret_set: boolean;
    openai_ready: boolean;
    active_agents: number;
    agents_with_provider_id: number;
    active_calls: number;
  };
  endpoints: { precall: string; tool: string; postcall: string };
  is_manager: boolean;
};

export type VoiceCallFilters = {
  department?: string;
  campaign?: string;
  language?: string;
  status?: string;
  temperature?: string;
  qa?: number;
  limit?: number;
  start?: number;
};

export type VoiceCallRow = {
  name: string;
  creation: string;
  direction: string;
  status: string;
  department?: string | null;
  voice_agent?: string | null;
  campaign?: string | null;
  lead_doctype?: string | null;
  lead_name?: string | null;
  lead_display_name?: string | null;
  to_number?: string | null;
  from_number?: string | null;
  language?: string | null;
  duration_seconds?: number | null;
  lead_temperature?: string | null;
  interest_score?: number | null;
  meeting_ref?: string | null;
  follow_up_at?: string | null;
  opt_out?: number;
  qa_review?: number;
  qa_status?: string | null;
  cost?: number | null;
  prompt_version?: number | null;
};

export type VoiceCallDetail = VoiceCallRow & {
  summary?: string | null;
  objections?: string | null;
  next_action?: string | null;
  hangup_reason?: string | null;
  escalate_reason?: string | null;
  booking_doctype?: string | null;
  booking_ref?: string | null;
  qa_notes?: string | null;
  retention_purged?: number;
  recording_url?: string | null;
  full_transcript?: string | null;
  transcript_restricted?: boolean;
};

export type VoiceAgent = {
  name: string;
  agent_name?: string;
  department: VoiceDepartment;
  language: 'Hindi' | 'Bengali';
  auto_detect_language?: number;
  active?: number;
  provider?: string;
  provider_agent_id?: string | null;
  voice_name?: string | null;
  inbound_number?: string | null;
  transfer_number?: string | null;
  default_owner?: string | null;
  calling_start?: string | null;
  calling_end?: string | null;
  call_on_sundays?: number;
  max_attempts?: number;
  retry_no_answer_minutes?: number;
  retry_busy_minutes?: number;
  speed_to_lead?: number;
  auto_follow_up_calls?: number;
  meeting_day_start?: string | null;
  meeting_day_end?: string | null;
  meeting_slot_minutes?: number;
  enabled_tools?: string | null;
  opening_line?: string | null;
  prompt_template?: string | null;
  prompt_version?: number;
};

export type VoiceCampaign = {
  name: string;
  department: VoiceDepartment;
  voice_agent?: string | null;
  campaign_type: 'Manual' | 'Speed-to-lead' | 'Follow-up';
  status: 'Draft' | 'Active' | 'Paused' | 'Completed';
  start_date?: string | null;
  end_date?: string | null;
  daily_cap?: number;
  total_contacts?: number;
  called?: number;
  connected?: number;
  hot?: number;
  meetings?: number;
  lead_status_filter?: string | null;
  lead_source_filter?: string | null;
  notes?: string | null;
};

export type VoiceCampaignContact = {
  name: string;
  lead_doctype: string;
  lead_name: string;
  contact_name?: string | null;
  phone?: string | null;
  language?: string | null;
  status: string;
  attempts?: number;
  next_try?: string | null;
  last_result?: string | null;
  last_call?: string | null;
};

export type VoiceLeadHit = {
  name: string;
  title?: string | null;
  phone?: string | null;
  status?: string | null;
  lead_doctype: string;
};

export type VoiceStartResult = {
  ok: boolean;
  call: string;
  provider_call_id?: string;
  agent?: string;
  dry_run?: boolean;
};

export type VoiceLeadCall = {
  name: string;
  creation: string;
  direction: string;
  status: string;
  duration_seconds?: number | null;
  lead_temperature?: string | null;
  summary?: string | null;
  next_action?: string | null;
  follow_up_at?: string | null;
  meeting_ref?: string | null;
  language?: string | null;
};

export type VoiceDncRow = {
  name: string;
  phone: string;
  reason?: string | null;
  added_on?: string | null;
  source_call?: string | null;
  notes?: string | null;
};

export type VoiceSchedule = {
  meetings: { name: string; subject: string; starts_on: string; ends_on?: string | null; status?: string; description?: string | null }[];
  follow_ups: {
    name: string;
    description: string;
    date?: string | null;
    priority?: string;
    reference_type?: string | null;
    reference_name?: string | null;
  }[];
};
