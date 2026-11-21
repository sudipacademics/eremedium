export type Level = 'none' | 'view' | 'create' | 'edit' | 'approve' | 'manage';

export type ModuleName =
  | 'Dashboard'
  | 'Appointments'
  | 'Doctors'
  | 'Physiotherapy'
  | 'Patients'
  | 'Test & Lab'
  | 'Diagnostics'
  | 'Billing & Invoice'
  | 'Pharmacy'
  | 'Inventory Management'
  | 'Branch Management'
  | 'Reports & Analytics'
  | 'Assets Management'
  | 'User & Access'
  | 'Settings';

export type Me = {
  user: string;
  full_name: string;
  roles: string[];
  exempt: boolean;
  role_label: string;
  modules: Record<ModuleName, Level>;
  /* Branch ids assigned in HRMS; null = every branch. */
  branches: number[] | null;
  branch_names: Array<{ id: number; name: string }>;
  branch_source?: string;
  unit?: string;
};

export type ApptType = 'consultation' | 'physiotherapy' | 'lab' | 'diagnostic';
export type InvoiceType = ApptType | 'pharmacy' | 'other';

export type Branch = {
  id: number;
  name: string;
  code: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  manager: string | null;
  email?: string | null;
  gst_registered?: number;
  gstin?: string | null;
  state?: string | null;
  state_code?: string | null;
  active: number;
  patients?: number;
  today?: number;
  revenue30?: number;
  staff?: number;
  assets?: number;
};

export type Service = {
  id: number;
  category: ApptType;
  name: string;
  price: number;
  duration: number;
  active: number;
  code?: string | null;
  mrp?: number | null;
  sample_type?: string | null;
  tat_hours?: number | null;
  lab_group?: string | null;
  preparation?: string | null;
  source?: 'local' | 'erp';
  price_override?: number;
  synced_at?: string | null;
  modality?: string | null;
  body_part?: string | null;
  needs_report?: number;
  description?: string | null;
};

export type SyncResult = { received: number; added: number; updated: number; linked: number; unchanged: number; hidden: number };

export type ServiceList = {
  total: number;
  items: Service[];
  groups: { name: string; n: number }[];
  modalities: { name: string; n: number }[];
  sync: { at: string | null; by: string | null; result: SyncResult | null };
};

export type Practitioner = {
  id: number;
  name: string;
  role: string;
  specialty: string | null;
  phone: string | null;
  email: string | null;
  branch_id: number | null;
  branch?: string;
  fee: number;
  active: number;
  completed30?: number;
  qualification?: string | null;
  registration_no?: string | null;
  slot_minutes?: number | null;
  availability?: string | Availability | null;
};

export type Slot = { from: string; to: string };
export type Availability = { weekly: Record<string, Slot>; extra: (Slot & { date: string })[]; leave: string[] };

export type Doctor = Practitioner & {
  availability: Availability | null;
  scheduled: boolean;
  today: number;
  upcoming: number;
  next14: { date: string; ok: boolean; reason: string | null; from: string | null; to: string | null }[];
};

export type Settings = Record<string, string>;

export type Meta = {
  branches: Branch[];
  services: Service[];
  practitioners: Practitioner[];
  settings: Settings;
  today: string;
  enums: {
    types: ApptType[];
    statuses: string[];
    planStatuses: string[];
    assetStatuses: string[];
    payModes: string[];
    roles: string[];
    itemCategories: string[];
  };
  has_demo: boolean;
  lab_catalog: { erp_tests: number; synced_at: string | null };
  diagnostic_tests: number;
};

export type Patient = {
  id: number;
  code: string;
  name: string;
  mobile: string | null;
  gender: string | null;
  age: number | null;
  email: string | null;
  address: string | null;
  condition: string | null;
  referred_by: string | null;
  branch_id: number | null;
  branch?: string;
  created_at: string;
  last_visit?: string | null;
  visits?: number;
  due?: number;
};

export type LabTest = { code?: string | null; name: string; price: number };

export type Appointment = {
  id: number;
  code: string;
  patient_id: number;
  patient: string;
  mobile?: string | null;
  patient_code?: string;
  patient_age?: number | null;
  patient_address?: string | null;
  patient_condition?: string | null;
  patient_referred_by?: string | null;
  type: ApptType;
  service: string;
  tests: string | null;
  practitioner_id: number | null;
  practitioner: string | null;
  plan_id: number | null;
  plan_code?: string | null;
  plan_billing?: 'per_session' | 'package' | null;
  plan_ref_type?: RefType | null;
  plan_ref_doctor_id?: number | null;
  plan_referred_by?: string | null;
  plan_ref_contact?: string | null;
  session_bill_id?: number | null;
  session_bill_number?: string | null;
  session_no: number | null;
  total_sessions: number | null;
  date: string;
  time: string;
  status: string;
  fee: number;
  notes: string | null;
  result: string | null;
  reported_by?: string | null;
  reported_at?: string | null;
  invoice_id: number | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  branch?: string;
};

export type Plan = {
  id: number;
  code: string;
  patient_id: number;
  patient: string;
  mobile: string | null;
  condition: string | null;
  practitioner_id: number | null;
  practitioner: string | null;
  total_sessions: number;
  completed: number;
  booked: number;
  fee: number;
  start_date: string;
  frequency: string;
  status: string;
  notes: string | null;
  next_session: string | null;
  billing?: 'per_session' | 'package';
  package_id?: number | null;
  package_name?: string | null;
  package_price?: number | null;
  valid_until?: string | null;
  invoice_id?: number | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_total?: number | null;
  invoice_paid?: number | null;
} & PlanReferral;

export type RefType = 'self' | 'doctor' | 'outside';

export type PlanReferral = {
  ref_type?: RefType | null;
  ref_doctor_id?: number | null;
  referred_by?: string | null;
  ref_contact?: string | null;
};

export type PackageUsage = {
  plan_code: string;
  total_sessions: number;
  completed: number;
  remaining: number;
  per_session: number;
  value_used: number;
  paid: number;
  due_for_used: number;
  advance: number;
  sessions: { id: number; session_no: number; date: string; time: string; status: string; session_bill_id: number | null; session_bill_number: string | null }[];
};

export type SessionBill = {
  id: number;
  number: string;
  appointment_id: number;
  plan_id: number;
  package_invoice_id: number;
  patient: string;
  patient_code?: string | null;
  patient_address?: string | null;
  mobile?: string | null;
  session_no: number;
  amount: number;
  branch?: string | null;
  created_at: string;
  updated_at?: string | null;
  snapshot: {
    session: { no: number; of: number; date: string; time: string; service: string; therapist: string | null; value: number; status: string };
    package: {
      name: string;
      code: string;
      invoice_number: string;
      sessions: number;
      subtotal: number;
      discount: number;
      discount_type?: string | null;
      discount_value?: number | null;
      gst_rate?: number | null;
      gst_amount?: number | null;
      total: number;
      valid_until?: string | null;
      referred_by?: string | null;
    };
    payments: { amount: number; mode: string | null; reference: string | null; at: string; by: string }[];
    paid_to_date: number;
    balance: number;
    sessions_completed: number;
    value_used: number;
  };
};

export type LabStage = { stage: string; reached: boolean; at: string | null; source: string | null; current: boolean; reason?: string | null };

export type LabBooking = {
  id: number;
  trf_id: string;
  barcode: string | null;
  patient_id: number | null;
  patient: string;
  patient_code?: string | null;
  mobile: string | null;
  branch?: string | null;
  tests: { item: string; item_name: string; qty?: number; rate?: number; amount?: number }[];
  referred_by: string | null;
  net: number;
  paid: number;
  due: number;
  payment_status: string | null;
  status: string | null;
  order_status: string | null;
  stage_index: number;
  report_ready: boolean;
  report_status: string | null;
  authorized_on: string | null;
  booked_at: string | null;
  created_by: string | null;
  synced_at: string | null;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_status: string | null;
  timeline: LabStage[] | null;
  tubes: { tube_code: string; status: string; drawn_at: string | null; received_at: string | null; rejected_reason: string | null }[] | null;
  reports: { name: string; report_status: string; department: string | null; report_date: string | null }[] | null;
  payment_history: { at: string; event: string; amount: number; mode: string; notes: string; running_due: number; by: string }[] | null;
  subtotal: number | null;
  discount: number | null;
  terminal_reason: string | null;
  remarks: string | null;
  offline?: string | null;
};

export type LabList = {
  items: LabBooking[];
  counts: Record<string, number>;
  centre: { name: string; type: string; pricing_rule: string; active: boolean } | null;
  offline: string | null;
};

export type LabQuote = {
  centre_name: string;
  franchisee_type: string;
  pricing_rule: string;
  active: boolean;
  tests: { item: string; item_name: string; rate: number; mrp: number | null; sample_type: string | null }[];
  subtotal: number;
};

export type PackageTherapy = { service_id: number; name: string; price: number };

export type PhysioPackage = {
  id: number;
  code: string;
  name: string;
  sessions: number;
  therapies: PackageTherapy[];
  price: number;
  validity_days: number | null;
  description: string | null;
  active: number;
  list_value: number;
  per_session: number;
  saving_pct: number;
  sold: number;
};

export type InvoiceLine = { item_id?: number; med?: string; item?: string; batches?: string; name: string; qty: number; rate: number; amount: number };

export type PharmMedicine = { name: string; item_code: string; medicine_name: string; generic_name?: string; strength?: string; pack_size?: string; uom?: string; schedule?: string; mrp?: number; reorder_branch?: number };
export type PharmStock = { location: string; item: string; batch: string; qty: number; batch_no: string; expiry_date: string; mfg_date?: string; mrp: number; rate?: number; expired: boolean; days_left: number | null };
export type PharmAlert = { kind: 'low' | 'near' | 'expired'; item: string; text: string; qty?: number; reorder?: number; days?: number };
export type PharmReqLine = { item: string; item_name: string; uom?: string; qty: number; approved: number; dispatched: number; delivered: number };
export type PharmRequisition = { name: string; req_no: string; priority: string; required_by?: string; status: string; lines: PharmReqLine[]; note?: string; requested_by_name?: string; decided_by?: string; decided_on?: string; decision_note?: string; creation: string };
export type PharmDispatch = {
  name: string;
  challan_no: string;
  requisition?: string;
  status: string;
  lines: { item: string; item_name: string; uom?: string; batch: string; batch_no: string; expiry: string; qty: number; mrp: number }[];
  carrier?: string;
  vehicle_no?: string;
  driver_phone?: string;
  expected_on?: string;
  events: { status: string; at: string; by: string; note?: string }[];
  dispatched_on?: string;
  delivered_on?: string;
  received_by?: string;
};
export type PharmBatchLine = { item: string; item_name: string; batch: string; batch_no: string; expiry: string; qty: number; reason: string };
export type PharmReturn = { name: string; return_no: string; status: string; lines: PharmBatchLine[]; reason?: string; note?: string; actor?: string; creation: string; received_by?: string; received_on?: string };
export type PharmAdjustment = { name: string; adj_no: string; lines: PharmBatchLine[]; reason?: string; note?: string; actor?: string; creation: string };
export type PharmBoard = {
  me: { user: string; name: string; manager: boolean; write: boolean };
  location: { name: string; location_name: string; active: number };
  items: PharmMedicine[];
  central_qty: Record<string, number>;
  stock: PharmStock[];
  alerts: PharmAlert[];
  requisitions: PharmRequisition[];
  dispatches: PharmDispatch[];
  returns: PharmReturn[];
  adjustments: PharmAdjustment[];
  external_requests?: PharmExternal[];
  constants: { adj_reasons: string[]; return_reasons: string[]; near_days: number; priorities: string[] };
};
export type PharmExternal = {
  name: string;
  ext_no: string;
  item?: string;
  medicine_name: string;
  qty: number;
  unit_price: number;
  vendor_name: string;
  vendor_gstin?: string;
  vendor_phone?: string;
  reason: string;
  urgency?: string;
  status: string;
  requested_by_name?: string;
  approved_qty?: number;
  approved_price?: number;
  valid_until?: string;
  decided_by?: string;
  decided_on?: string;
  decision_note?: string;
  received_qty?: number;
  receipts: { purchase_no: string; invoice_no: string; qty: number; at: string; by: string; batches: { batch_no: string; expiry: string; qty: number; rate: number }[] }[];
  creation: string;
  expired_approval?: boolean;
};
export type PharmLedgerRow = { posted_on: string; item: string; batch_no?: string; expiry_date?: string; qty: number; balance: number; voucher_type: string; voucher_no: string; note?: string; actor?: string };
export type Sellable = { item: string; name: string; generic?: string; strength?: string; uom: string; qty: number; mrp: number; next_expiry: string; schedule?: string };

export type Invoice = {
  id: number;
  number: string;
  patient_id: number | null;
  patient: string;
  mobile?: string | null;
  patient_code?: string | null;
  patient_address?: string | null;
  customer: string | null;
  service_type: InvoiceType;
  items: string | InvoiceLine[];
  subtotal: number;
  discount: number;
  discount_type?: 'flat' | 'percent' | null;
  discount_value?: number | null;
  gst_rate?: number | null;
  gst_amount?: number | null;
  total: number;
  paid: number;
  status: string;
  payment_mode: string | null;
  appointment_id: number | null;
  notes: string | null;
  branch?: string;
  created_at: string;
  created_by: string;
  practitioner_id?: number | null;
  doctor?: string | null;
  doctor_specialty?: string | null;
  doctor_qualification?: string | null;
  doctor_registration?: string | null;
  referred_by?: string | null;
  trf_id?: string | null;
};

export type Payment = { id: number; amount: number; mode: string; reference: string | null; at: string; by: string };

export type Item = {
  id: number;
  name: string;
  sku: string;
  category: string;
  unit: string;
  stock: number;
  reorder_level: number;
  cost: number;
  price: number;
  expiry: string | null;
  vendor: string | null;
  branch_id: number | null;
  /* Set on medicines from the branch pharmacy stock (ERP item code). */
  med?: string;
};

export type StockAlert = Item & { level: 'out' | 'low' | 'reorder' | 'expiry' | 'expired' };

export type Asset = {
  id: number;
  tag: string;
  name: string;
  category: string | null;
  branch_id: number | null;
  branch?: string;
  status: string;
  purchase_date: string | null;
  cost: number | null;
  vendor: string | null;
  last_service: string | null;
  next_service: string | null;
  notes: string | null;
  model?: string | null;
  serial?: string | null;
  description?: string | null;
  photo?: string | null;
  amc_vendor?: string | null;
  amc_ref?: string | null;
  amc_start?: string | null;
  amc_end?: string | null;
  amc_cost?: number | null;
};

export type AlertNote = { id: string; tone: 'danger' | 'warn' | 'info'; text: string; href: string };
