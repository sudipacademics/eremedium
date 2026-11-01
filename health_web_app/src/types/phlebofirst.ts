export type PfRequestStatus =
  | 'Uploaded'
  | 'Under Review'
  | 'Quoted'
  | 'Broadcast'
  | 'Accepted'
  | 'En Route'
  | 'Collected'
  | 'Dropped At Hub'
  | 'Received At Lab'
  | 'Rejected'
  | 'Cancelled'
  | 'Expired';

export const PF_REQUEST_FLOW: PfRequestStatus[] = [
  'Uploaded',
  'Under Review',
  'Quoted',
  'Broadcast',
  'Accepted',
  'En Route',
  'Collected',
  'Dropped At Hub',
  'Received At Lab',
];

export type PfJobStatus = 'Open' | 'Accepted' | 'Started' | 'Collected' | 'Dropped' | 'Received' | 'Expired' | 'Cancelled';

export type PfTubeCode = 'BLU' | 'RED' | 'SST' | 'GRN' | 'LAV' | 'GRY' | 'RBL' | string;

export type PfAccount = {
  name: string;
  display_name: string;
  account_type: 'Doctor' | 'Pharmacy' | 'Small Lab' | 'Franchisee';
  status: 'Active' | 'Suspended';
  franchisee?: string | null;
  referring_doctor?: string | null;
  doctor?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  default_lab?: string | null;
  default_lab_name?: string | null;
  users: { user: string; full_name?: string | null; account_role?: string; active: number }[];
  granted_role_to?: string[];
};

export type PfMe = {
  user: string;
  customer: PfAccount | null;
  can_customer: boolean;
  rider: PfRiderProfile | null;
  lab_authoriser: boolean;
  labs: { lab: string; lab_name?: string | null }[] | null;
  manager: boolean;
};

export type PfCreateRequestPayload = {
  patient_name: string;
  patient_phone: string;
  patient_age: number;
  patient_gender: 'Male' | 'Female' | 'Other';
  pickup_address: string;
  pickup_area?: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  preferred_window_start?: string;
  preferred_window_end?: string;
  suggested_tests?: string;
  notes?: string;
  file_base64: string;
  file_name: string;
};

export type PfQuoteItem = {
  item_code: string;
  item_name?: string | null;
  mrp: number;
  rate: number;
  qty: number;
  amount: number;
  tube_hint?: string | null;
};

export type PfQuotation = {
  name: string;
  status: 'Draft' | 'Issued' | 'Accepted' | 'Expired' | 'Superseded' | 'Cancelled';
  lab: string;
  lab_name?: string | null;
  items: PfQuoteItem[];
  test_total: number;
  collection_fee: number;
  rider_payout: number;
  discount: number;
  grand_total: number;
  valid_until?: string | null;
  authorised_by?: string | null;
  authorised_on?: string | null;
  notes?: string | null;
};

export type PfTimelineStep = { status: PfRequestStatus; at?: string | null; done: boolean };

export type PfRiderCard = {
  name?: string | null;
  phone_masked?: string;
  phone?: string | null;
  rating?: number | null;
  vehicle_type?: string | null;
  eta_minutes?: number | null;
  distance_km?: number | null;
  location_at?: string | null;
};

export type PfTube = {
  row: string;
  tube_code: PfTubeCode;
  cap_color?: string | null;
  accession_id?: string | null;
  volume_ml?: number;
  status: 'Planned' | 'Drawn' | 'Received' | 'Rejected';
  linked_tests?: string | null;
  universal_barcode?: string | null;
  drawn_at?: string | null;
  received_at?: string | null;
};

export type PfRequestSummary = {
  name: string;
  status: PfRequestStatus;
  patient_name: string;
  patient_age?: number | null;
  patient_gender?: string | null;
  assigned_lab?: string | null;
  lab_name?: string | null;
  pickup_area?: string | null;
  preferred_window_start?: string | null;
  preferred_window_end?: string | null;
  submitted_on?: string | null;
  quotation?: string | null;
  job?: string | null;
  customer_trf?: string | null;
  grand_total?: number | null;
  account?: string;
  account_name?: string | null;
  account_type?: string | null;
  suggested_tests?: string | null;
  job_status?: PfJobStatus | null;
};

export type PfRequestDetail = {
  name: string;
  status: PfRequestStatus;
  account: string;
  account_name?: string | null;
  account_type?: string | null;
  assigned_lab?: string | null;
  lab_name?: string | null;
  payment_status: 'Pending' | 'Paid' | 'Waived';
  patient?: string | null;
  universal_patient_id?: string | null;
  patient_name: string;
  patient_phone?: string | null;
  patient_age?: number | null;
  patient_gender?: string | null;
  has_file: boolean;
  file_name?: string | null;
  file_type?: string | null;
  suggested_tests?: string | null;
  notes?: string | null;
  pickup_address?: string | null;
  pickup_area?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  preferred_window_start?: string | null;
  preferred_window_end?: string | null;
  status_reason?: string | null;
  customer_trf?: string | null;
  submitted_on?: string | null;
  quotation: PfQuotation | null;
  timeline: PfTimelineStep[];
  can_cancel: boolean;
  job: {
    name: string;
    status: PfJobStatus;
    accepted_on?: string | null;
    started_on?: string | null;
    collected_on?: string | null;
    dropped_on?: string | null;
    dropped_hub?: string | null;
    sla_due?: string | null;
    broadcast_round: number;
    broadcast_radius_km: number;
    tube_count: number;
  } | null;
  rider: PfRiderCard | null;
  ocr?: PfOcrResult | null;
  reviewed_by?: string | null;
  trf?: { name: string; barcode?: string | null; order_status?: string | null; payment_status?: string | null; tubes: PfTube[] } | null;
  defaults?: { collection_fee: number; rider_payout_pct: number; rider_payout: number; quote_validity_hours: number };
  offers?: number;
};

export type PfOcrResult = {
  text: string;
  diagnostics: { raw_name: string; matches: { item_code: string; test_name?: string | null }[] }[];
};

export type PfMyRequests = {
  account: PfAccount;
  rows: PfRequestSummary[];
  total: number;
  page: number;
  page_size: number;
};

export type PfLabInbox = {
  labs: { lab: string; lab_name?: string | null }[];
  rows: PfRequestSummary[];
  total: number;
  counts: { pending?: number; active?: number };
};

export type PfTestHit = { item_code: string; item_name: string; item_group?: string | null; mrp: number };

export type PfApproveItem = { item_code: string; rate?: number; qty?: number };

export type PfRiderProfile = {
  name: string;
  full_name?: string | null;
  mobile?: string | null;
  service_radius_km?: number;
  kit?: string | null;
  barcode_stock: Record<string, number>;
  active_jobs: number;
};

export type PfJobCard = {
  name: string;
  status: PfJobStatus;
  request: string;
  lab?: string | null;
  lab_name?: string | null;
  pickup_area?: string | null;
  distance_km?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  collection_fee: number;
  rider_payout: number;
  tube_count: number;
  test_count: number;
  sla_due?: string | null;
  offered: boolean;
  accepted_on?: string | null;
  started_on?: string | null;
  collected_on?: string | null;
  dropped_on?: string | null;
  mine: boolean;
  patient_name?: string | null;
  patient_age?: number | null;
  patient_gender?: string | null;
  patient_phone?: string | null;
  patient_phone_masked?: string;
  notes?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  pickup_address?: string | null;
};

export type PfJobDetail = PfJobCard & {
  tubes: PfTube[];
  trf?: string | null;
  dropped_hub?: string | null;
  payout_entry?: string | null;
  navigate_url?: string | null;
  geofence_warning?: boolean;
  distance_m?: number | null;
  hub_lab_mismatch?: boolean;
  payout?: { name: string; amount: number; created: boolean } | null;
};

export type PfOpenJobs = {
  jobs: PfJobCard[];
  position: { lat: number; lng: number; source: 'device' | 'live' | 'home' } | null;
  rider: PfRiderProfile;
};

export type PfMyJobs = { active: PfJobCard[]; recent: PfJobCard[]; rider: PfRiderProfile };

export type PfBarcodeCheck = { ok: boolean; code: string; error?: string | null; tube_code?: string };

export type PfBindResult = { code: string; tube?: PfTube; tubes: PfTube[] };

export type PfHub = {
  name?: string;
  hub_code: string;
  hub_name: string;
  active?: number;
  franchisee?: string | null;
  collection_centre?: string | null;
  receiving_lab?: string | null;
  receiving_lab_name?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  geofence_m?: number;
  hours?: string | null;
};

export type PfEarnings = {
  rows: {
    name: string;
    entry_type: string;
    amount: number;
    status: 'Accrued' | 'Approved' | 'Paid' | 'Reversed';
    source_doctype?: string | null;
    source_name?: string | null;
    period?: string | null;
    posted_on?: string | null;
    paid_ref?: string | null;
  }[];
  totals: Record<string, number>;
  this_month: number;
  jobs_done: number;
};

export type PfLabSettings = {
  lab: string;
  lab_name?: string | null;
  accepts_pf: number;
  catchment_radius_km: number;
  default_collection_fee: number;
  rider_payout_pct: number;
  quote_validity_hours: number;
  broadcast_radii_km: string;
  rebroadcast_minutes: number;
  sla_minutes: number;
  allow_unkitted_codes: number;
  lis_barcode_format?: string | null;
  lis_prefix?: string | null;
  lis_next_seq?: number;
  lat?: number | null;
  lng?: number | null;
  lab_lat?: number | null;
  lab_lng?: number | null;
  api_client?: string | null;
  outbound_webhook_url?: string | null;
  notes?: string | null;
  authorisers: string[];
};

export type PfBarcodeRow = {
  name: string;
  status: 'Issued' | 'Bound' | 'Dropped' | 'Received' | 'Rejected' | 'Void';
  tube_code: string;
  kit?: string | null;
  rider?: string | null;
  lab?: string | null;
  bound_trf?: string | null;
  bound_job?: string | null;
  bound_on?: string | null;
  drop_hub?: string | null;
  dropped_on?: string | null;
  received_on?: string | null;
  issued_on?: string | null;
};

export type PfKitRow = {
  name: string;
  rider?: string | null;
  rider_name?: string | null;
  status: string;
  issued_on?: string | null;
  contents: Record<string, number>;
  unused: number;
};

export type PfRiderRow = {
  user: string;
  full_name?: string | null;
  mobile?: string | null;
  provider?: string | null;
  status?: string | null;
  is_rider: boolean;
  home_lat?: number | null;
  home_lng?: number | null;
  service_radius_km?: number | null;
  active_jobs: number;
  unused_barcodes: number;
};

export type PfJobBoardRow = {
  name: string;
  status: PfJobStatus;
  request: string;
  lab?: string | null;
  lab_name?: string | null;
  pickup_area?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  collection_fee: number;
  rider_payout: number;
  tube_count: number;
  broadcast_round: number;
  broadcast_radius_km: number;
  sla_due?: string | null;
  rider?: string | null;
  rider_name?: string | null;
  accepted_on?: string | null;
  started_on?: string | null;
  collected_on?: string | null;
  dropped_on?: string | null;
  dropped_hub?: string | null;
  drop_geofence_warning?: number;
  offers: number;
  overdue: boolean;
  creation?: string;
};

export type PfJobBoard = {
  rows: PfJobBoardRow[];
  total: number;
  job_counts: Record<string, number>;
  request_counts: Record<string, number>;
  unassigned_requests: number;
};

/** Mirrors the backend check: PF- + 7 digits + Verhoeff; HUB- + 5 + check; KIT- + 6 + check. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(digits: string) {
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i += 1) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(rev[i])]];
  return c === 0;
}

const CODE_SPECS = { PF: ['PF-', 7], HUB: ['HUB-', 5], KIT: ['KIT-', 6] } as const;

/** Returns an error message, or null when the code passes prefix, length and check digit. */
export function pfCodeError(raw: string, kind: keyof typeof CODE_SPECS = 'PF'): string | null {
  const [prefix, digits] = CODE_SPECS[kind];
  const code = raw.trim().toUpperCase();
  if (!code.startsWith(prefix)) return `Code must start with ${prefix}`;
  const rest = code.slice(prefix.length);
  if (!/^\d+$/.test(rest) || rest.length !== digits + 1) return `${prefix} codes have ${digits + 1} digits after the prefix`;
  if (!verhoeffValid(rest)) return 'Check digit does not match; re-scan the label';
  return null;
}

export function normalizePfCode(raw: string) {
  return raw.trim().toUpperCase();
}
