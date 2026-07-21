import { clearStoredSession, getSid, loadSession, saveSession } from './auth/session';
import { apiUrl, ApiModule } from './config';
import { CareJourney } from './types/journey';

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
};

export type HealthSubscription = {
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  amount?: number;
  plan?: SubscriptionPlan | null;
};

export type B2bCatalogItem = {
  item_code: string;
  item_name: string;
  item_group?: string;
  retail_rate: number;
  wholesale_rate: number;
  margin: number;
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

export type CatalogItem = {
  name: string;
  item_name: string;
  description?: string;
  standard_rate: number;
  rate?: number;
  mrp?: number;
  discount_percent?: number;
  coupon_label?: string | null;
  image?: string | null;
  item_group?: string;
  sample_type?: string;
  report_tat_hours?: number;
  test_count?: number;
  preparation?: string;
  also_known_as?: string[];
  lab_category?: string;
};

export type LabTestDetail = CatalogItem;

export type LabPanel = {
  panel_id: string;
  panel_name: string;
  description?: string;
  rate: number;
  tests: Array<{ item_code: string; item_name: string; rate: number }>;
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

export type PromoBanner = {
  title: string;
  subtitle?: string;
  color?: string;
  image_url?: string;
  icon?: string;
};

export type AlliedHealthWing = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  color?: string;
  image?: string;
  service_count?: number;
  starting_rate?: number;
};

export type AlliedHealthService = {
  service_code: string;
  service_name: string;
  wing_id: string;
  item_group?: string;
  short_description?: string;
  rate?: number;
  duration_minutes?: number;
};

export type AiPhysicianCenter = {
  name?: string;
  franchise_name?: string;
  distance_km?: number;
  address?: string;
};

export type AiPhysicianSuggestions = {
  diagnostic_workup?: Array<{
    item_code?: string;
    panel_id?: string;
    item_name: string;
    rate?: number;
    mrp?: number;
    reason?: string;
    book_path?: string;
  }>;
  physician_services?: Array<{
    service: string;
    department?: string;
    reason?: string;
    book_path?: string;
  }>;
  wellness?: Array<{
    title: string;
    subtitle?: string;
    book_path?: string;
  }>;
  nearby_centers?: AiPhysicianCenter[];
};

export type AiPhysicianTurn = {
  session_id: string;
  phase?: string;
  message: string;
  question?: string;
  question_index?: number;
  total_questions?: number;
  suggestions?: AiPhysicianSuggestions | null;
  disclaimer?: string;
  openai_enabled?: boolean;
};

export type InsuranceProduct = {
  product_code: string;
  product_name: string;
  insurer?: string;
  category?: string;
  sum_insured_from?: number;
  sum_insured_to?: number;
  premium_from?: number;
  highlights?: string[];
  description?: string;
};

export type TelephonyCallRow = {
  name: string;
  creation?: string;
  from_number?: string;
  path?: string;
  status?: string;
  patient_name?: string;
  caller_known?: number | boolean;
  service_intent?: string;
  booking_ref?: string;
  booking_doctype?: string;
  escalate_reason?: string;
};

export type TelephonyDashboard = {
  telephony_enabled?: boolean;
  agent_configured?: boolean;
  openai_configured?: boolean;
  counts?: {
    total?: number;
    booked?: number;
    escalated?: number;
    ai?: number;
    ivr?: number;
  };
  calls?: TelephonyCallRow[];
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

export type StaffKraRow = {
  name: string;
  title?: string;
  description?: string;
  weightage?: number;
  score?: number;
};

export type StaffAppraisalRow = {
  name: string;
  employee?: string;
  employee_name?: string;
  appraisal_cycle?: string;
  appraisal_template?: string;
  start_date?: string;
  end_date?: string;
  final_score?: number;
  total_score?: number;
  self_score?: number;
  reflections?: string;
  docstatus?: number;
  kras?: StaffKraRow[];
  self_ratings?: Array<{ criteria?: string; rating?: number; per_weightage?: number }>;
};

export type TrainingProgramRow = {
  name: string;
  training_program?: string;
  status?: string;
  description?: string;
};

export type TrainingEventRow = {
  name: string;
  event_name?: string;
  training_program?: string;
  event_status?: string;
  start_time?: string;
  end_time?: string;
  type?: string;
  introduction?: string;
};

export type StaffPerformanceHub = {
  performance_available: boolean;
  missing_modules?: string[];
  employee?: string | null;
  kras: StaffKraRow[];
  appraisals: StaffAppraisalRow[];
  training_programs: TrainingProgramRow[];
  training_events: TrainingEventRow[];
  feedback_criteria: Array<{ name: string; criteria?: string }>;
};

export type FranchiseeProfile = {
  name: string;
  branch_code?: string;
  franchise_name?: string;
  territory_region?: string;
  commission_percentage_rate?: number;
};

export type SessionUser = {
  user: string;
  full_name?: string;
  fullName?: string;
  roles: string[];
  sid?: string;
  franchisee?: FranchiseeProfile | null;
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

export type OAuthProvider = {
  provider: string;
  label?: string;
  client_id?: string;
  login_url: string;
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
  order_total?: number;
  delivery_status?: string;
  razorpay_payment_status?: string;
  payment_method?: string;
  creation?: string;
  items?: Array<{ item_name?: string; item_code?: string; qty?: number; rate?: number }>;
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

  getAlliedHealthWings: () =>
    request<{ wings: AlliedHealthWing[]; promo_banners?: PromoBanner[] }>('get_allied_health_wings', {
      auth: false,
      module: 'appointments',
    }),

  getAlliedHealthServices: (wingId?: string, q?: string) =>
    request<{ services: AlliedHealthService[]; count: number }>('get_allied_health_services', {
      body: {
        ...(wingId ? { wing_id: wingId } : {}),
        ...(q ? { q } : {}),
      },
      auth: false,
      module: 'appointments',
    }),

  getAlliedHealthService: (serviceCode: string) =>
    request<{ service: AlliedHealthService }>('get_allied_health_service', {
      body: { service_code: serviceCode },
      auth: false,
      module: 'appointments',
    }),

  bookAlliedHealthAppointment: (body: Record<string, string | number>) =>
    request<{ appointment_id?: string }>('book_allied_health_appointment', {
      method: 'POST',
      body,
      auth: true,
      module: 'appointments',
    }),

  createPharmacyQuoteRequest: (body: Record<string, string | number>) =>
    request<{ order_id: string; delivery_status?: string; message?: string }>(
      'create_pharmacy_quote_request',
      {
        method: 'POST',
        body,
        auth: true,
      },
    ),

  getInsuranceLanding: () =>
    request<{ products: InsuranceProduct[] }>('get_insurance_landing', {
      auth: false,
      module: 'insurance',
    }),

  submitInsuranceQuoteRequest: (body: Record<string, string | number>) =>
    request<{ request_id?: string }>('submit_insurance_quote_request', {
      method: 'POST',
      body,
      auth: true,
      module: 'insurance',
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

  verifyOtpLogin: (mobile: string, otp: string) =>
    request<SessionUser>('verify_otp_and_login', {
      method: 'POST',
      body: { mobile, otp },
      auth: false,
      module: 'otp',
    }),

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
    request<SessionUser & { sid?: string; full_name?: string }>('complete_oauth_login', {
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

  getStaffPerformanceHub: () =>
    request<StaffPerformanceHub>('get_staff_performance_hub', { body: {}, auth: true }),

  submitAppraisalSelfReview: (body: {
    appraisal: string;
    reflections?: string;
    ratings?: Array<{ criteria: string; rating: number; per_weightage?: number }>;
  }) =>
    request<{ appraisal: StaffAppraisalRow }>('submit_appraisal_self_review', {
      method: 'POST',
      body,
      auth: true,
    }),

  submitTrainingFeedback: (body: { training_event: string; rating?: number; feedback?: string }) =>
    request<{ ok: boolean; training_feedback?: string }>('submit_training_feedback', {
      method: 'POST',
      body,
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

  getTrfDetail: (trfIdOrOpts: string | { trfId?: string; barcode?: string }) => {
    const body =
      typeof trfIdOrOpts === 'string'
        ? { trf_id: trfIdOrOpts }
        : {
            ...(trfIdOrOpts.trfId ? { trf_id: trfIdOrOpts.trfId } : {}),
            ...(trfIdOrOpts.barcode ? { barcode: trfIdOrOpts.barcode } : {}),
          };
    return request<{ trf: Booking; results: unknown[] }>('get_trf_detail', {
      body,
      auth: true,
    });
  },

  updateOrderStatus: (trfId: string, orderStatus: string) =>
    request<{ trf_id: string; order_status: string }>('update_order_status', {
      method: 'POST',
      body: { trf_id: trfId, order_status: orderStatus },
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

  getMyAppointments: (limit = 50) =>
    request<{ appointments: Appointment[] }>('get_my_appointments', {
      body: { limit },
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

  getCircleLanding: () =>
    request<CircleLandingPayload>('get_circle_landing', { method: 'POST', auth: true }),

  previewCheckoutPrice: (subtotal: number, context: 'pharmacy' | 'lab', promoCode?: string) =>
    request<CheckoutPricing>('preview_checkout_price', {
      method: 'POST',
      body: {
        subtotal,
        context,
        ...(promoCode ? { promo_code: promoCode } : {}),
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

  registerPatient: (body: {
    email: string;
    password: string;
    full_name: string;
    mobile?: string;
  }) =>
    request<{ email: string; verification_sent: boolean }>('register_patient', {
      method: 'POST',
      body,
      auth: false,
      module: 'email',
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

  getTelephonyDashboard: () =>
    request<TelephonyDashboard>('get_telephony_dashboard', {
      auth: true,
      module: 'telephony',
    }),

  getMaskedCallContext: (referenceDoctype: string, referenceName: string) =>
    request<{
      available?: boolean;
      ready?: boolean;
      telephony_enabled?: boolean;
      masked_caller_id_display?: string | null;
      peer_label?: string | null;
      reason?: string | null;
    }>('get_masked_call_context', {
      body: { reference_doctype: referenceDoctype, reference_name: referenceName },
      auth: true,
    }),

  startMaskedCall: (referenceDoctype: string, referenceName: string) =>
    request<{ peer_label?: string; call_sid?: string }>('start_masked_call', {
      method: 'POST',
      body: { reference_doctype: referenceDoctype, reference_name: referenceName },
      auth: true,
    }),

  clearSession,
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
