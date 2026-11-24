/** API helpers for Smilecure CRM — ERP session, Care/Aesthetic bookings, RFMS leads, partner unit bookings. */

import { readCrmSession, readCsrfToken, type CrmSession } from './security';

const SITE = 'health.localhost';

function session(): CrmSession | null {
  return readCrmSession();
}

function erpHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Frappe-Site-Name': SITE,
  };
  const csrf = readCsrfToken();
  if (csrf) headers['X-Frappe-CSRF-Token'] = csrf;
  return headers;
}

async function erpMethod<T = unknown>(
  method: string,
  data: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const s = session();
  const body = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => {
    if (v !== undefined && v !== null) body.set(k, String(v));
  });
  if (s?.sid) body.set('sid', s.sid);
  const res = await fetch(`/api/method/health_ecosystem_core.health_ecosystem_core.${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: erpHeaders(),
    body,
  });
  const json = await res.json().catch(() => ({}));
  const msg = json?.message && typeof json.message === 'object' ? json.message : json;
  if (!res.ok || !msg || msg.status === 'error') {
    throw new Error(String(msg?.message || 'Request failed').replace(/<[^>]+>/g, ''));
  }
  return (msg.data !== undefined ? msg.data : msg) as T;
}

async function jsonFetch<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  let body = init?.body;
  if (init?.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const s = session();
  /* Prefer cookie session; only send Care sid header when cookie auth is unavailable. */
  if (s?.sid && !document.cookie.includes('sid=')) {
    headers['X-Care-Sid'] = s.sid;
  }
  const csrf = readCsrfToken();
  if (csrf) headers['X-Frappe-CSRF-Token'] = csrf;
  const res = await fetch(url, { ...init, headers, body, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error || data?.message || data?.detail || `HTTP ${res.status}`;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }
  /* Care / Aesthetic APIs wrap payloads as { data: … }. */
  return (data && typeof data === 'object' && 'data' in data ? data.data : data) as T;
}

export type ClinicBranch = {
  id: number;
  name: string;
  code?: string;
  city?: string;
  address?: string;
  phone?: string;
  active?: number;
};

/** Live Care branches (public directory — Ashoknagar, Hasnabad, …). */
export async function listCareBranches(): Promise<ClinicBranch[]> {
  const rows = await jsonFetch<ClinicBranch[]>('/care-api/branch-directory');
  return (Array.isArray(rows) ? rows : []).filter((b) => b.active !== 0);
}

/** Live Aesthetic branches (Bongaon, Barasat, …). */
export async function listAestheticBranches(): Promise<ClinicBranch[]> {
  const rows = await jsonFetch<ClinicBranch[]>('/aes-api/branch-directory');
  return (Array.isArray(rows) ? rows : []).filter((b) => b.active !== 0);
}

export type CareDoctor = {
  id: number;
  name: string;
  role?: string;
  specialty?: string | null;
  fee?: number | null;
  branch_id?: number | null;
  branch?: string | null;
  active?: number;
};

async function listCareClinicians(role: 'Doctor' | 'Physiotherapist', branchId?: number): Promise<CareDoctor[]> {
  const params = new URLSearchParams({ role });
  if (branchId) params.set('branch', String(branchId));
  const rows = await jsonFetch<CareDoctor[]>(`/care-api/doctors?${params}`);
  const match = (d: CareDoctor) => d.active !== 0 && (!d.role || d.role === role);
  const list = (Array.isArray(rows) ? rows : []).filter(match);
  /* If the branch filter returns nobody, fall back to the full list (staff may be hub-based). */
  if (branchId && list.length === 0) {
    const all = await jsonFetch<CareDoctor[]>(`/care-api/doctors?role=${encodeURIComponent(role)}`);
    return (Array.isArray(all) ? all : []).filter(match);
  }
  return list;
}

/** Care doctors for consultation booking (needs Care Appointments / Doctors view on the session). */
export async function listCareDoctors(branchId?: number): Promise<CareDoctor[]> {
  return listCareClinicians('Doctor', branchId);
}

/** Care physiotherapists for CRM physiotherapy bookings. */
export async function listCarePhysios(branchId?: number): Promise<CareDoctor[]> {
  return listCareClinicians('Physiotherapist', branchId);
}

export type FranchiseLeadPayload = {
  name: string;
  email: string;
  mobile: string;
  franchise_model: 'FOFO' | 'FOCO';
  territory_query: string;
  notes?: string;
  source?: string;
};

/** Push a franchise enquiry into RFMS/FFMS (`POST /rfms-api/v1/leads/public`). */
export async function createRfmsLead(payload: FranchiseLeadPayload) {
  const res = await jsonFetch<{ data?: { lead_id?: string; message?: string }; lead_id?: string; message?: string }>(
    '/rfms-api/v1/leads/public',
    { method: 'POST', json: { ...payload, source: payload.source || 'telecaller' } },
  );
  const data = (res as { data?: { lead_id?: string; message?: string } }).data ?? res;
  return {
    leadId: data.lead_id || '',
    message: data.message || 'Franchise lead submitted to FFMS/RFMS.',
  };
}

export type CareBookingPayload = {
  name: string;
  mobile: string;
  age?: string;
  address?: string;
  concern?: string;
  referred_by?: string;
  tracking_tag?: string;
  executive?: string;
  date: string;
  time: string;
  type?: 'consultation' | 'physiotherapy';
  branch?: string;
  branch_id?: number;
  practitioner_id?: number;
  /** When true, Care/Aesthetic APIs may ignore slot capacity. Default false. */
  override_availability?: boolean;
};

function crmReferral(payload: { tracking_tag?: string; referred_by?: string; executive?: string }) {
  /* Referrer name only — CRM tag lives in appointment notes so portals can show a separate CRM Tag column. */
  const who = payload.referred_by?.trim() || payload.executive?.trim() || 'CRM Telecaller';
  return who.slice(0, 120);
}

function crmNotes(payload: { tracking_tag?: string; concern?: string; executive?: string }) {
  const tag = (payload.tracking_tag || '').trim().toUpperCase();
  /* Tag only here (bill close + portal CRM Tag column). Concern goes on patient.condition. */
  return tag ? `[CRM_TAG:${tag}]`.slice(0, 500) : '';
}

/** Book Care consultation / physio via Care API (session must have Care Backend access). */
export async function createCareBooking(payload: CareBookingPayload) {
  const mobile = payload.mobile.replace(/\D/g, '').slice(-10);
  const patientBody = {
    name: payload.name.trim(),
    mobile,
    age: payload.age || '',
    address: payload.address || '',
    condition: payload.concern || '',
    referred_by: crmReferral(payload),
    ...(payload.branch_id ? { branch_id: payload.branch_id } : {}),
  };
  let patient: { id: number };
  try {
    patient = await jsonFetch<{ id: number }>('/care-api/patients', { method: 'POST', json: patientBody });
  } catch (err) {
    const found = await jsonFetch<{ items: { id: number; mobile: string; name: string }[] }>(
      `/care-api/patients?q=${encodeURIComponent(mobile)}&limit=8`,
    );
    const match = found.items?.find((p) => (p.mobile || '').replace(/\D/g, '').slice(-10) === mobile);
    if (!match) throw err;
    patient = await jsonFetch<{ id: number }>(`/care-api/patients/${match.id}`, {
      method: 'PATCH',
      json: patientBody,
    }).catch(() => match);
  }
  const visitType = payload.type || 'consultation';
  return jsonFetch<{ id: number; code?: string; patient?: string }>('/care-api/appointments', {
    method: 'POST',
    json: {
      type: visitType,
      patient_id: patient.id,
      service: visitType === 'physiotherapy' ? 'Physiotherapy Consultation' : 'Consultation',
      fee: 0,
      date: payload.date,
      time: payload.time,
      notes: crmNotes(payload),
      /* Slot override only when explicitly marked (managers / forced walk-ins). */
      override_availability: Boolean(payload.override_availability),
      ...(payload.branch_id ? { branch_id: payload.branch_id } : {}),
      ...(payload.practitioner_id ? { practitioner_id: payload.practitioner_id } : {}),
    },
  });
}

/** Book Aesthetic consultation via aesthetic session API. */
export async function createAestheticBooking(payload: CareBookingPayload) {
  const mobile = payload.mobile.replace(/\D/g, '').slice(-10);
  const patientBody = {
    name: payload.name.trim(),
    mobile,
    age: payload.age || '',
    address: payload.address || '',
    condition: payload.concern || '',
    referred_by: crmReferral(payload),
    ...(payload.branch_id ? { branch_id: payload.branch_id } : {}),
  };
  let patient: { id: number };
  try {
    patient = await jsonFetch<{ id: number }>('/aes-api/patients', { method: 'POST', json: patientBody });
  } catch (err) {
    const found = await jsonFetch<{ items: { id: number; mobile: string; name: string }[] }>(
      `/aes-api/patients?q=${encodeURIComponent(mobile)}&limit=8`,
    );
    const match = found.items?.find((p) => (p.mobile || '').replace(/\D/g, '').slice(-10) === mobile);
    if (!match) throw err;
    patient = await jsonFetch<{ id: number }>(`/aes-api/patients/${match.id}`, {
      method: 'PATCH',
      json: patientBody,
    }).catch(() => match);
  }
  return jsonFetch<{ id: number; code?: string; patient?: string }>('/aes-api/appointments', {
    method: 'POST',
    json: {
      type: 'consultation',
      patient_id: patient.id,
      service: 'Consultation',
      fee: 0,
      date: payload.date,
      time: payload.time,
      notes: crmNotes(payload),
      override_availability: Boolean(payload.override_availability),
      ...(payload.branch_id ? { branch_id: payload.branch_id } : {}),
    },
  });
}

export type PartnerUnitBookingPayload = {
  patient_name: string;
  mobile: string;
  tests: string;
  franchisee_id?: string;
  franchise_unit?: string;
  preferred_date?: string;
  notes?: string;
  tracking_tag?: string;
  executive?: string;
};

/**
 * Register a lab booking against a franchise / partner unit.
 * Uses ERP `book_lab_test` when available; always returns a CRM-local reference on soft failure.
 */
export async function createPartnerUnitBooking(payload: PartnerUnitBookingPayload) {
  const tagNote = payload.tracking_tag ? `[CRM_TAG:${payload.tracking_tag}]` : '';
  const notes = [tagNote, payload.executive ? `Executive: ${payload.executive}` : '', payload.notes || 'CRM telecaller booking for franchise unit']
    .filter(Boolean)
    .join(' · ');
  try {
    const data = await erpMethod<{ trf_id?: string; name?: string }>('api.book_lab_test', {
      patient_name: payload.patient_name,
      patient_phone: payload.mobile.replace(/\D/g, '').slice(-10),
      test_required: payload.tests,
      franchisee_id: payload.franchisee_id || payload.franchise_unit,
      collection_slot: payload.preferred_date,
      promo_code: payload.tracking_tag || undefined,
    });
    return { externalId: data.trf_id || data.name || '', message: `Booking posted to partner / franchise unit. ${notes}` };
  } catch (err) {
    return {
      externalId: '',
      message: err instanceof Error ? err.message : 'Saved in CRM; partner sync pending.',
      soft: true as const,
    };
  }
}

export type CrmSalesCloseRow = {
  name?: string;
  tracking_tag?: string;
  booking_id?: string;
  executive?: string;
  executive_code?: string;
  amount?: number;
  bill_ref?: string;
  portal?: string;
  patient_name?: string;
  mobile?: string;
  closed_at?: string;
};

export async function recordCrmSalesClose(input: {
  trackingTag: string;
  bookingId?: string;
  executive?: string;
  executiveCode?: string;
  amount: number;
  billRef?: string;
  portal?: string;
  patientName?: string;
  mobile?: string;
  notes?: string;
}) {
  return erpMethod('api.record_crm_sales_close', {
    tracking_tag: input.trackingTag,
    booking_id: input.bookingId,
    executive: input.executive,
    executive_code: input.executiveCode,
    amount: input.amount,
    bill_ref: input.billRef,
    portal: input.portal || 'crm',
    patient_name: input.patientName,
    mobile: input.mobile,
    notes: input.notes,
  });
}

async function listPortalBillCloses(path: '/aes-api/crm-bill-closes' | '/care-api/crm-bill-closes') {
  try {
    const data = await jsonFetch<{ closes?: CrmSalesCloseRow[] }>(`${path}?limit=300`);
    return Array.isArray(data?.closes) ? data.closes : [];
  } catch {
    return [];
  }
}

function mergeSalesCloses(rows: CrmSalesCloseRow[]) {
  const byKey = new Map<string, CrmSalesCloseRow>();
  for (const row of rows) {
    const tag = String(row.tracking_tag || '').toUpperCase();
    if (!tag) continue;
    const key = `${tag}::${String(row.bill_ref || '').toUpperCase()}`;
    const prev = byKey.get(key);
    if (!prev || Number(row.amount || 0) >= Number(prev.amount || 0)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export type CrmTargetAchievement = {
  period: string;
  period_label: string;
  employee: string;
  employee_name: string;
  target_amount: number;
  achievement_amount: number;
  remaining_amount: number;
  percent: number;
  closes_count: number;
  set_by: string;
  has_target: boolean;
};

/** Monthly CRM ₹ target (My Team) vs achievement from synced Care/Aesthetic bills. */
export async function getCrmTargetAchievement(period?: string, employee?: string) {
  const data = await erpMethod<CrmTargetAchievement>('api.get_crm_target_achievement', {
    period,
    employee,
  });
  return {
    period: String(data?.period || ''),
    period_label: String(data?.period_label || ''),
    employee: String(data?.employee || ''),
    employee_name: String(data?.employee_name || ''),
    target_amount: Number(data?.target_amount) || 0,
    achievement_amount: Number(data?.achievement_amount) || 0,
    remaining_amount: Number(data?.remaining_amount) || 0,
    percent: Number(data?.percent) || 0,
    closes_count: Number(data?.closes_count) || 0,
    set_by: String(data?.set_by || ''),
    has_target: Boolean(data?.has_target),
  } satisfies CrmTargetAchievement;
}

/** ERP closes + live Care/Aesthetic tagged invoices (covers bills that failed silent ERP notify). */
export async function listCrmSalesCloses(limit = 200) {
  let erpCloses: CrmSalesCloseRow[] = [];
  let erpError: Error | null = null;
  try {
    const data = await erpMethod<{ closes?: CrmSalesCloseRow[]; total_amount?: number }>('api.list_crm_sales_closes', {
      limit,
    });
    erpCloses = Array.isArray(data?.closes) ? data.closes : [];
  } catch (err) {
    erpError = err instanceof Error ? err : new Error('Could not load ERP sales closes');
  }
  const [aesCloses, careCloses] = await Promise.all([
    listPortalBillCloses('/aes-api/crm-bill-closes'),
    listPortalBillCloses('/care-api/crm-bill-closes'),
  ]);
  const closes = mergeSalesCloses([...erpCloses, ...aesCloses, ...careCloses]);
  if (!closes.length && erpError) throw erpError;
  return {
    closes,
    totalAmount: closes.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  };
}

export type ReachRep = {
  name: string;
  full_name?: string;
  display_name?: string;
  reach_user_id?: string;
  linked_user?: string;
  user?: string;
  phone?: string;
  designation?: string;
  territory_region?: string;
  employee_id?: string;
  employee_number?: string;
  active?: number;
};

export type AssignCrmLeadToReachResult = {
  lead_id?: string;
  assigned_rep?: string;
  assigned_rep_name?: string;
  visit_id?: string;
  crm_lead_id?: string;
  rfms_lead_id?: string;
  reach?: {
    lead_id?: string;
    status?: string;
    crm_status?: string;
    assigned_rep?: string;
    assigned_rep_name?: string;
  };
};

export type CrmReachLeadSnapshot = {
  lead_id: string;
  crm_lead_id?: string;
  rfms_lead_id?: string;
  status?: string;
  crm_status?: string | null;
  assigned_rep?: string;
  assigned_rep_name?: string;
  notes?: string;
  modified?: string;
};

/** REACH / Sales Rep Profiles available for CRM lead assignment. */
export async function listCrmReachReps(): Promise<ReachRep[]> {
  const data = await erpMethod<{ reps?: ReachRep[] }>('api.list_crm_reach_reps');
  return Array.isArray(data?.reps) ? data.reps : [];
}

export type CrmPortalAssignee = {
  employee: string;
  employee_name: string;
  full_name: string;
  user?: string;
  designation?: string;
};

/** Employees HR assigned to Smilecure CRM via People → Portal Access. */
export async function listCrmPortalAssignees(): Promise<CrmPortalAssignee[]> {
  const data = await erpMethod<{ users?: CrmPortalAssignee[] }>('api.list_crm_portal_assignees');
  return Array.isArray(data?.users) ? data.users : [];
}

export type CrmOwnershipEntry = {
  owner: string;
  from_owner?: string;
  transferred_by?: string;
  transferred_at?: string;
  note?: string;
};

export type CrmOwnershipMap = {
  leads: Record<string, CrmOwnershipEntry>;
  activities: Record<string, CrmOwnershipEntry>;
  deals: Record<string, CrmOwnershipEntry>;
  contacts: Record<string, CrmOwnershipEntry>;
};

/** Shared ownership overrides so every CRM login sees the same owner after transfer. */
export async function listCrmOwnership(): Promise<CrmOwnershipMap> {
  const data = await erpMethod<Partial<CrmOwnershipMap>>('api.list_crm_ownership');
  return {
    leads: data?.leads && typeof data.leads === 'object' ? data.leads : {},
    activities: data?.activities && typeof data.activities === 'object' ? data.activities : {},
    deals: data?.deals && typeof data.deals === 'object' ? data.deals : {},
    contacts: data?.contacts && typeof data.contacts === 'object' ? data.contacts : {},
  };
}

export type CrmTransferHistoryRow = {
  id: string;
  lead_id: string;
  lead_name: string;
  previous_owner: string;
  new_owner: string;
  transferred_by: string;
  transferred_at: string;
  remarks: string;
  followups_moved: number;
  followup_ids: string[];
};

export type CrmTransferNotice = {
  id: string;
  recipient: string;
  title: string;
  body: string;
  lead_id: string;
  read: number;
  created_at: string;
};

export type CrmRecordSnapshots = {
  leads?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
  deals?: Record<string, unknown>[];
  contacts?: Record<string, unknown>[];
  count?: number;
};

export async function transferCrmOwnership(input: {
  fromOwner: string;
  toOwner: string;
  leadIds?: string[];
  activityIds?: string[];
  dealIds?: string[];
  contactIds?: string[];
  note: string;
  leadMeta?: Array<{ id: string; name: string; followup_ids?: string[] }>;
  transferredByName?: string;
  /** Full lead/follow-up payloads so the new owner's browser can load them. */
  snapshots?: CrmRecordSnapshots;
}) {
  return erpMethod<{
    saved?: number;
    leads?: number;
    activities?: number;
    snapshots?: number;
    history?: number;
    ownership?: CrmOwnershipMap;
    transfer_history?: { history?: CrmTransferHistoryRow[] };
    notices?: { notices?: CrmTransferNotice[]; unread?: number };
  }>('api.transfer_crm_ownership', {
    from_owner: input.fromOwner,
    to_owner: input.toOwner,
    lead_ids: input.leadIds?.length ? JSON.stringify(input.leadIds) : undefined,
    activity_ids: input.activityIds?.length ? JSON.stringify(input.activityIds) : undefined,
    deal_ids: input.dealIds?.length ? JSON.stringify(input.dealIds) : undefined,
    contact_ids: input.contactIds?.length ? JSON.stringify(input.contactIds) : undefined,
    note: input.note,
    lead_meta: input.leadMeta?.length ? JSON.stringify(input.leadMeta) : undefined,
    transferred_by_name: input.transferredByName,
    snapshots: input.snapshots ? JSON.stringify(input.snapshots) : undefined,
  });
}

/** Pull lead/follow-up payloads assigned to this owner (after transfer). */
export async function listCrmRecordSnapshots(owner?: string, includeAll = false): Promise<CrmRecordSnapshots> {
  const data = await erpMethod<CrmRecordSnapshots>('api.list_crm_record_snapshots', {
    owner: owner || undefined,
    include_all: includeAll ? 1 : 0,
    limit: 2000,
  });
  return {
    leads: Array.isArray(data?.leads) ? data.leads : [],
    activities: Array.isArray(data?.activities) ? data.activities : [],
    deals: Array.isArray(data?.deals) ? data.deals : [],
    contacts: Array.isArray(data?.contacts) ? data.contacts : [],
    count: Number(data?.count) || 0,
  };
}

/** Publish local records so other CRM logins can pull them (heal past transfers). */
export async function upsertCrmRecordSnapshots(snapshots: CrmRecordSnapshots, defaultOwner?: string) {
  return erpMethod<{ saved?: number }>('api.upsert_crm_record_snapshots', {
    snapshots: JSON.stringify(snapshots),
    default_owner: defaultOwner,
  });
}

export async function listCrmTransferHistory(leadId?: string): Promise<CrmTransferHistoryRow[]> {
  const data = await erpMethod<{ history?: CrmTransferHistoryRow[] }>('api.list_crm_transfer_history', {
    lead_id: leadId || undefined,
    limit: leadId ? 50 : 200,
  });
  return Array.isArray(data?.history) ? data.history : [];
}

export async function listCrmTransferNotices(recipient?: string): Promise<{
  notices: CrmTransferNotice[];
  unread: number;
}> {
  const data = await erpMethod<{ notices?: CrmTransferNotice[]; unread?: number }>(
    'api.list_crm_transfer_notices',
    { recipient: recipient || undefined, limit: 40 },
  );
  const notices = Array.isArray(data?.notices) ? data.notices : [];
  return { notices, unread: Number(data?.unread) || notices.filter((n) => !n.read).length };
}

export async function markCrmTransferNoticeRead(noticeId: string) {
  return erpMethod<{ ok?: boolean }>('api.mark_crm_transfer_notice_read', { notice_id: noticeId });
}

/** Push CRM lead + follow-up context to REACH and assign a Reach portal user. */
export async function assignCrmLeadToReach(input: {
  crmLeadId: string;
  salesRepId: string;
  assignedToName?: string;
  createVisit?: boolean;
  lead: Record<string, string | number | undefined>;
  followups?: Array<Record<string, string | number | boolean | undefined>>;
}): Promise<AssignCrmLeadToReachResult> {
  return erpMethod<AssignCrmLeadToReachResult>('api.assign_crm_lead_to_reach', {
    crm_lead_id: input.crmLeadId,
    sales_rep_id: input.salesRepId,
    assigned_to_name: input.assignedToName,
    create_visit: input.createVisit === false ? 0 : 1,
    lead_json: JSON.stringify(input.lead),
    followups_json: input.followups ? JSON.stringify(input.followups) : undefined,
  });
}

/** Pull REACH status for a CRM lead previously assigned to Reach. */
export async function getCrmReachLead(crmLeadId: string): Promise<CrmReachLeadSnapshot> {
  return erpMethod<CrmReachLeadSnapshot>('api.get_crm_reach_lead', { crm_lead_id: crmLeadId });
}

/** Push CRM status onto the linked REACH Franchise Sales Lead. */
export async function syncCrmLeadStatusToReach(crmLeadId: string, status: string) {
  return erpMethod('api.sync_crm_lead_status_to_reach', { crm_lead_id: crmLeadId, status });
}

export type CrmWhatsAppApiSettings = {
  configured?: boolean;
  enabled?: boolean;
  provider?: 'meta' | 'interakt' | 'aisensy' | 'custom';
  apiUrl?: string;
  apiKey?: string;
  phoneNumberId?: string;
  wabaId?: string;
  senderNumber?: string;
  webhookVerifyToken?: string;
  channel?: 'franchise' | 'service';
  franchiseFollowUp?: boolean;
  serviceFollowUp?: boolean;
};

/** Meta Cloud WhatsApp — Franchise (AI Workforce) or Service channel. CRM Managers only. */
export async function getCrmWhatsAppApi(channel: 'franchise' | 'service' = 'franchise'): Promise<CrmWhatsAppApiSettings> {
  return erpMethod<CrmWhatsAppApiSettings>('api.get_crm_whatsapp_api', { channel });
}

/** Persist Service Meta Cloud WhatsApp credentials (server-side). */
export async function saveCrmServiceWhatsAppApi(input: {
  enabled: boolean;
  provider?: string;
  apiUrl?: string;
  apiKey?: string;
  phoneNumberId?: string;
  wabaId?: string;
  senderNumber?: string;
  webhookVerifyToken?: string;
}) {
  return erpMethod<{ ok?: boolean; configured?: boolean }>('api.save_crm_service_whatsapp_api', {
    enabled: input.enabled ? 1 : 0,
    provider: input.provider,
    api_url: input.apiUrl,
    api_key: input.apiKey,
    phone_number_id: input.phoneNumberId,
    waba_id: input.wabaId,
    sender_number: input.senderNumber,
    webhook_verify_token: input.webhookVerifyToken,
  });
}

export type CrmWhatsAppConversation = {
  id: string;
  phone: string;
  status: string;
  contact_name: string;
  crm_wing: string;
  /** Franchise vs Service Meta number stream. */
  crm_channel?: 'franchise' | 'service' | string;
  channel?: 'franchise' | 'service' | string;
  crm_lead_id?: string;
  rfms_lead_id?: string;
  last_message_at?: string;
  last_direction?: string;
  crm_last_read_at?: string;
  /** Server shared-inbox flag: true only for unread inbound messages. */
  unread?: boolean;
  preview?: string;
};

export type CrmWhatsAppMessage = {
  id: string;
  direction: string;
  body: string;
  meta_message_id?: string;
  status?: string;
  created_at?: string;
  media_url?: string;
  media_kind?: string;
  media_mime?: string;
};

export type CrmWhatsAppCounts = Record<string, number>;

export async function listCrmWhatsAppConversations(input?: {
  wing?: string;
  q?: string;
  limit?: number;
  channel?: 'all' | 'franchise' | 'service' | string;
}): Promise<{
  conversations: CrmWhatsAppConversation[];
  counts: CrmWhatsAppCounts;
  wing: string;
  channel?: string;
}> {
  return erpMethod('api.list_crm_whatsapp_conversations', {
    wing: input?.wing || 'all',
    q: input?.q,
    limit: input?.limit ?? 100,
    channel: input?.channel || 'all',
  });
}

export async function getCrmWhatsAppThread(input: {
  conversationId?: string;
  phone?: string;
  wing?: string;
  channel?: 'franchise' | 'service' | string;
  crmLeadId?: string;
  contactName?: string;
}): Promise<{ conversation: CrmWhatsAppConversation | null; messages: CrmWhatsAppMessage[] }> {
  return erpMethod('api.get_crm_whatsapp_thread', {
    conversation_id: input.conversationId,
    phone: input.phone,
    wing: input.wing,
    channel: input.channel,
    crm_lead_id: input.crmLeadId,
    contact_name: input.contactName,
  });
}

/** Mark chat read for the whole CRM team (shared WhatsApp Centre badge). */
export async function markCrmWhatsAppConversationRead(conversationId: string) {
  return erpMethod<{ ok?: boolean; id?: string; crm_last_read_at?: string }>(
    'api.mark_crm_whatsapp_conversation_read',
    { conversation_id: conversationId },
  );
}

/** Send Meta Cloud WhatsApp — Franchise (AI) or Service (dedicated) channel. */
export async function sendCrmWhatsApp(input: {
  phone: string;
  message: string;
  contactName?: string;
  crmLeadId?: string;
  wing?: string;
  channel?: 'franchise' | 'service';
  conversationId?: string;
  template?: string;
  useTemplate?: boolean;
}): Promise<{
  ok?: boolean;
  message_id?: string;
  phone?: string;
  conversation_id?: string;
  crm_wing?: string;
  channel?: string;
  template?: string;
  sender?: string;
}> {
  const wing = String(input.wing || 'franchise').toLowerCase();
  /* Default Franchise (WA Centre brand tabs). Service follow-up/lead must pass channel: 'service'. */
  const channel = input.channel === 'service' ? 'service' : 'franchise';
  return erpMethod('api.send_crm_whatsapp', {
    phone: input.phone,
    message: input.message,
    contact_name: input.contactName,
    crm_lead_id: input.crmLeadId,
    wing,
    channel,
    conversation_id: input.conversationId,
    template: input.template,
    use_template: input.useTemplate ? 1 : undefined,
  });
}

export { session as crmSession };
