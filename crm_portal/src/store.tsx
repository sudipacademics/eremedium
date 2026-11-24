import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  SAMPLE_ACCOUNTS,
  SAMPLE_ACTIVITIES,
  DEMO_PORTAL_BOOKING_IDS,
  SAMPLE_BOOKINGS,
  SAMPLE_CAMPAIGNS,
  SAMPLE_CONTACTS,
  SAMPLE_DEALS,
  SAMPLE_LEADS,
  conversionTypeFromWing,
  dealStageToLeadStatus,
  executiveCodeFromName,
  formatCrmTagNote,
  franchiseVerticalLabel,
  initials,
  leadConversionCredit,
  leadStatusToDealStage,
  makeTrackingTag,
  nextId,
  normalizeDealStage,
  normalizeLeadStatus,
  outcomeToDealStage,
  outcomeToLeadStatus,
  type CrmAccount,
  type CrmActivity,
  type CrmBooking,
  type CrmCampaign,
  type CrmContact,
  type CrmDeal,
  type CrmLead,
  type CrmTeamMember,
  type CrmTeamRole,
  type DealStage,
  type FollowUpOutcome,
  type LeadHistoryEntry,
  type LeadStatus,
  type LeadTransferRecord,
  type LostReason,
  type WingId,
} from './data';
import {
  looksLikeDateTimeValue,
  looksLikeSheetOrFormTitle,
  normalizeSheetMobile,
  stripMetaPrefix,
} from './campaignData';
import {
  listCrmOwnership,
  listCrmPortalAssignees,
  listCrmRecordSnapshots,
  listCrmTransferHistory,
  listCrmTransferNotices,
  markCrmTransferNoticeRead,
  transferCrmOwnership,
  upsertCrmRecordSnapshots,
  type CrmOwnershipMap,
  type CrmPortalAssignee,
  type CrmRecordSnapshots,
  type CrmTransferNotice,
} from './crmApi';
import { readCrmSession } from './security';

const LEADS_KEY = 'crm_leads_v1';
const CONTACTS_KEY = 'crm_contacts_v1';
const DEALS_KEY = 'crm_deals_v1';
const TEAM_KEY = 'crm_team_v1';
const BOOKINGS_KEY = 'crm_bookings_v1';

function ensureBookingTracking(b: CrmBooking): CrmBooking {
  const executive = b.executive || b.owner || 'CRM';
  const executiveCode = b.executiveCode || executiveCodeFromName(executive);
  const trackingTag = b.trackingTag || makeTrackingTag(executive, b.id);
  return {
    ...b,
    executive,
    executiveCode,
    trackingTag,
    salesStatus: b.salesStatus || (b.billedAmount && b.billedAmount > 0 ? 'Closed' : 'Open'),
  };
}

function isOrphanDemoBooking(b: CrmBooking) {
  /* Old seed Care/Aesthetic rows never received a portal AP- ref — drop them so CRM matches live portals. */
  if (!DEMO_PORTAL_BOOKING_IDS.has(b.id)) return false;
  if (b.externalId) return false;
  if (b.wing !== 'care' && b.wing !== 'aesthetic') return false;
  return b.salesStatus === 'Open' || !b.salesStatus;
}

function loadBookings(): CrmBooking[] {
  try {
    const raw = localStorage.getItem(BOOKINGS_KEY);
    if (!raw) return SAMPLE_BOOKINGS.map(ensureBookingTracking);
    const parsed = JSON.parse(raw) as CrmBooking[];
    if (!Array.isArray(parsed) || !parsed.length) return SAMPLE_BOOKINGS.map(ensureBookingTracking);
    const cleaned = parsed.map(ensureBookingTracking).filter((b) => !isOrphanDemoBooking(b));
    if (cleaned.length !== parsed.length) {
      try {
        localStorage.setItem(BOOKINGS_KEY, JSON.stringify(cleaned));
      } catch {
        /* ignore quota */
      }
    }
    return cleaned;
  } catch {
    return SAMPLE_BOOKINGS.map(ensureBookingTracking);
  }
}

type Toast = { id: number; text: string; tone?: 'ok' | 'err' };

type CrmState = {
  leads: CrmLead[];
  /**
   * Leads for Reports / conversion KPIs — includes Won leads the user converted
   * even after ownership was transferred away.
   */
  reportLeads: CrmLead[];
  contacts: CrmContact[];
  accounts: CrmAccount[];
  deals: CrmDeal[];
  activities: CrmActivity[];
  bookings: CrmBooking[];
  campaigns: CrmCampaign[];
  wingFilter: WingId | 'all';
  setWingFilter: (w: WingId | 'all') => void;
  toasts: Toast[];
  pushToast: (text: string, tone?: 'ok' | 'err') => void;
  addLead: (lead: Omit<CrmLead, 'id' | 'ownerInitials' | 'createdAt'> & { id?: string; createdAt?: string }) => CrmLead;
  updateLead: (id: string, patch: Partial<CrmLead>, note?: string) => CrmLead | null;
  /** Permanently remove leads (and their pending follow-ups). */
  deleteLeads: (ids: string[]) => { deleted: number };
  /** Permanently remove follow-up activities (manager-only). */
  deleteActivities: (ids: string[]) => { deleted: number };
  /** Update lead.status from a follow-up panel (uses full lead list, not executive scope). */
  setLeadStatusFromFollowUp: (activityId: string, status: LeadStatus) => CrmLead | null;
  importLeads: (
    rows: Array<{
      name: string;
      mobile: string;
      email?: string;
      wing?: WingId;
      source?: string;
      status?: LeadStatus;
      city?: string;
      owner?: string;
      notes?: string;
      value?: number;
      createdAt?: string;
    }>,
  ) => { added: number; skipped: number };
  /** Google Sheets / campaign sync — reuses lead store with duplicate rules + attribution. */
  importCampaignLeads: (input: {
    campaignId: string;
    campaignName: string;
    wing: WingId;
    franchiseVertical?: 'aesthetic' | 'care' | 'lab';
    source: string;
    owner: string;
    duplicateRule: 'skip' | 'update_notes' | 'update_empty';
    rows: Array<{
      rowIndex: number;
      fingerprint: string;
      name: string;
      mobile: string;
      email?: string;
      city?: string;
      district?: string;
      state?: string;
      pinCode?: string;
      serviceRequired?: string;
      notes?: string;
      franchiseModel?: string;
      propertyOwnership?: string;
      investmentCapacity?: string;
      timeline?: string;
      preferredLocation?: string;
      alternateMobile?: string;
      createdAt?: string;
      source?: string;
    }>;
  }) => {
    imported: number;
    duplicates: number;
    failed: number;
    updated: number;
    results: Array<{
      rowIndex: number;
      status: 'imported' | 'duplicate' | 'updated' | 'failed';
      leadId?: string;
      error?: string;
    }>;
  };
  addContact: (contact: Omit<CrmContact, 'id'> & { id?: string }) => CrmContact;
  importContacts: (rows: Array<Omit<CrmContact, 'id' | 'owner'> & { owner?: string }>) => { added: number; skipped: number };
  addBooking: (
    booking: Omit<CrmBooking, 'id' | 'createdAt' | 'trackingTag' | 'executive' | 'executiveCode'> & {
      id?: string;
      trackingTag?: string;
      executive?: string;
      executiveCode?: string;
    },
  ) => CrmBooking;
  updateBooking: (id: string, patch: Partial<CrmBooking>) => CrmBooking | null;
  /** Apply closes synced from Care / Aesthetic / lab bill generation only. */
  applySalesCloses: (
    rows: Array<{
      tracking_tag?: string;
      booking_id?: string;
      amount?: number;
      bill_ref?: string;
      portal?: string;
      closed_at?: string;
      executive?: string;
      mobile?: string;
      patient_name?: string;
    }>,
  ) => number;
  toggleActivity: (id: string) => void;
  updateActivity: (id: string, patch: Partial<CrmActivity>) => CrmActivity | null;
  logActivityUpdate: (
    id: string,
    input: {
      message: string;
      nextDueAt?: string;
      type?: CrmActivity['type'];
      outcome?: FollowUpOutcome | string;
      expectedOutcome?: string;
    },
  ) => CrmActivity | null;
  completeActivity: (id: string, note?: string) => CrmActivity | null;
  addActivity: (activity: Omit<CrmActivity, 'id'> & { id?: string }) => CrmActivity;
  addDeal: (deal: Omit<CrmDeal, 'id'> & { id?: string }) => CrmDeal;
  updateDeal: (id: string, patch: Partial<CrmDeal>) => CrmDeal | null;
  createDealFromFollowUp: (
    activityId: string,
    input: {
      title: string;
      stage: DealStage;
      value: number;
      closeDate: string;
      product?: string;
      probability?: number;
    },
  ) => CrmDeal | null;
  closeLeadLost: (leadId: string, reason: LostReason | string, note?: string) => CrmLead | null;
  convertDealWon: (
    dealId: string,
    input: {
      conversionType: 'aesthetic' | 'care' | 'lab' | 'franchise' | 'partner';
      conversionId: string;
      service?: string;
      branch?: string;
    },
  ) => CrmDeal | null;
  team: CrmTeamMember[];
  isManager: boolean;
  userRoleLabel: string;
  /** Reload roster from People → Portal Access → CRM (HR assigns staff). */
  refreshCrmTeam: () => Promise<CrmTeamMember[]>;
  transferOwnership: (input: {
    fromOwner: string;
    toOwner: string;
    scope: 'leads' | 'followups' | 'both';
    leadIds?: string[];
    activityIds?: string[];
    note: string;
  }) => Promise<{ leads: number; followups: number; deals: number } | null>;
  applyOwnershipMap: (map: CrmOwnershipMap) => void;
  refreshTransferHistory: (leadId?: string) => Promise<void>;
  transferNotices: CrmTransferNotice[];
  transferNoticeUnread: number;
  refreshTransferNotices: () => Promise<void>;
  markTransferNoticeRead: (id: string) => Promise<void>;
  userName: string;
};

function cstrEq(a: string, b: string) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** Session + roster aliases so transferred owner names match the logged-in user. */
function userOwnerAliases(userName: string, team: CrmTeamMember[]) {
  const s = readSession();
  const aliases = new Set<string>();
  const add = (v?: string) => {
    const t = String(v || '').trim().toLowerCase();
    if (t) aliases.add(t);
  };
  add(userName);
  add(s?.full_name);
  add(s?.user);
  if (s?.user?.includes('@')) add(s.user.split('@')[0]);
  for (const m of team) {
    if (
      cstrEq(m.name, userName) ||
      cstrEq(m.name, s?.full_name || '') ||
      cstrEq(m.email || '', s?.user || '')
    ) {
      add(m.name);
      add(m.email);
    }
  }
  return aliases;
}

function ownerIsMe(owner: string, userName: string, team: CrmTeamMember[] = []) {
  const o = String(owner || '').trim().toLowerCase();
  if (!o) return false;
  return userOwnerAliases(userName, team).has(o);
}

function safeMapUrl(raw: unknown): string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/** Whitelist snapshot fields — never trust arbitrary server/client JSON keys. */
function asLeadSnapshot(raw: Record<string, unknown>, fallbackOwner: string): CrmLead | null {
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const owner = String(raw.owner || fallbackOwner || '').trim() || fallbackOwner;
  const wing = (['aesthetic', 'care', 'lab', 'franchise', 'nexilab'] as WingId[]).includes(raw.wing as WingId)
    ? (raw.wing as WingId)
    : 'lab';
  return {
    id,
    name: String(raw.name || id).slice(0, 200),
    mobile: String(raw.mobile || '').replace(/\D/g, '').slice(-15),
    email: String(raw.email || '').slice(0, 200),
    wing,
    source: String(raw.source || 'Other').slice(0, 80),
    status: normalizeLeadStatus(String(raw.status || 'New')),
    owner,
    ownerInitials: initials(owner),
    city: raw.city ? String(raw.city).slice(0, 120) : undefined,
    district: raw.district ? String(raw.district).slice(0, 120) : undefined,
    state: raw.state ? String(raw.state).slice(0, 120) : undefined,
    pinCode: raw.pinCode ? String(raw.pinCode).slice(0, 12) : undefined,
    notes: raw.notes ? String(raw.notes).slice(0, 4000) : undefined,
    franchiseModel: raw.franchiseModel as CrmLead['franchiseModel'],
    franchiseVertical: raw.franchiseVertical as CrmLead['franchiseVertical'],
    propertyOwnership: raw.propertyOwnership ? String(raw.propertyOwnership).slice(0, 80) : undefined,
    investmentCapacity: raw.investmentCapacity ? String(raw.investmentCapacity).slice(0, 80) : undefined,
    timeline: raw.timeline ? String(raw.timeline).slice(0, 80) : undefined,
    preferredLocation: raw.preferredLocation ? String(raw.preferredLocation).slice(0, 500) : undefined,
    alternateMobile: raw.alternateMobile ? String(raw.alternateMobile).slice(0, 20) : undefined,
    googleMapUrl: safeMapUrl(raw.googleMapUrl),
    serviceRequired: raw.serviceRequired ? String(raw.serviceRequired).slice(0, 200) : undefined,
    campaignId: raw.campaignId ? String(raw.campaignId).slice(0, 40) : undefined,
    campaignName: raw.campaignName ? String(raw.campaignName).slice(0, 200) : undefined,
    sheetRowRef: raw.sheetRowRef ? String(raw.sheetRowRef).slice(0, 40) : undefined,
    sheetKey: raw.sheetKey ? String(raw.sheetKey).slice(0, 120) : undefined,
    value: raw.value != null && Number.isFinite(Number(raw.value)) ? Number(raw.value) : undefined,
    conversionId: raw.conversionId ? String(raw.conversionId).slice(0, 120) : undefined,
    conversionType: raw.conversionType as CrmLead['conversionType'],
    convertedAt: raw.convertedAt ? String(raw.convertedAt) : undefined,
    convertedBy: raw.convertedBy ? String(raw.convertedBy).slice(0, 120) : undefined,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    history: Array.isArray(raw.history) ? (raw.history as CrmLead['history'])?.slice(0, 40) : undefined,
    transferHistory: Array.isArray(raw.transferHistory)
      ? (raw.transferHistory as CrmLead['transferHistory'])?.slice(0, 20)
      : undefined,
  };
}

/** Stamp conversion credit once — never overwrite after transfer. */
function withConversionCredit<T extends CrmLead>(lead: T, actor: string, at = new Date().toISOString()): T {
  return {
    ...lead,
    convertedAt: lead.convertedAt || at,
    convertedBy: lead.convertedBy?.trim() || actor,
  };
}

function asActivitySnapshot(raw: Record<string, unknown>, fallbackOwner: string): CrmActivity | null {
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const owner = String(raw.owner || fallbackOwner || '').trim() || fallbackOwner;
  const wing = (['aesthetic', 'care', 'lab', 'franchise', 'nexilab'] as WingId[]).includes(raw.wing as WingId)
    ? (raw.wing as WingId)
    : 'lab';
  return {
    id,
    type: (raw.type as CrmActivity['type']) || 'Follow-up',
    title: String(raw.title || 'Follow-up').slice(0, 200),
    leadName: String(raw.leadName || '').slice(0, 200),
    leadId: raw.leadId ? String(raw.leadId).slice(0, 40) : undefined,
    mobile: raw.mobile ? String(raw.mobile).replace(/\D/g, '').slice(-15) : undefined,
    wing,
    dueAt: String(raw.dueAt || new Date().toISOString()),
    done: Boolean(raw.done),
    owner,
    notes: raw.notes ? String(raw.notes).slice(0, 2000) : undefined,
  };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (!incoming.length) return existing;
  const map = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) {
    const cur = map.get(row.id);
    map.set(row.id, cur ? { ...cur, ...row } : row);
  }
  return Array.from(map.values());
}

function mapTransferRows(rows: Awaited<ReturnType<typeof listCrmTransferHistory>>): Record<string, LeadTransferRecord[]> {
  const byLead: Record<string, LeadTransferRecord[]> = {};
  for (const r of rows) {
    const lid = r.lead_id;
    if (!lid) continue;
    const entry: LeadTransferRecord = {
      id: r.id,
      previousOwner: r.previous_owner || '',
      newOwner: r.new_owner || '',
      transferredBy: r.transferred_by || '',
      transferredAt: r.transferred_at || '',
      remarks: r.remarks || '',
      followupsMoved: Number(r.followups_moved) || 0,
    };
    (byLead[lid] ||= []).push(entry);
  }
  return byLead;
}

const ACTIVITIES_KEY = 'crm_activities_v2';

function loadActivities(): CrmActivity[] {
  try {
    const raw = localStorage.getItem(ACTIVITIES_KEY);
    if (!raw) return SAMPLE_ACTIVITIES;
    const parsed = JSON.parse(raw) as CrmActivity[];
    return Array.isArray(parsed) && parsed.length ? parsed : SAMPLE_ACTIVITIES;
  } catch {
    return SAMPLE_ACTIVITIES;
  }
}

const DEMO_LEAD_IDS = new Set(SAMPLE_LEADS.map((l) => l.id));

/** Drop seeded demo leads once any real CRM lead exists (keeps Total Leads accurate). */
function withoutDemoSeedLeads(list: CrmLead[]) {
  const real = list.filter((l) => !DEMO_LEAD_IDS.has(l.id));
  return real.length ? real : list;
}

function loadLeads(): CrmLead[] {
  try {
    const raw = localStorage.getItem(LEADS_KEY);
    if (!raw) return SAMPLE_LEADS;
    const parsed = JSON.parse(raw) as CrmLead[];
    if (!Array.isArray(parsed) || !parsed.length) return SAMPLE_LEADS;
    return withoutDemoSeedLeads(
      parsed.map((l) => ({ ...l, status: normalizeLeadStatus(String(l.status || 'New')) })),
    );
  } catch {
    return SAMPLE_LEADS;
  }
}

function loadContacts(): CrmContact[] {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    if (!raw) return SAMPLE_CONTACTS;
    const parsed = JSON.parse(raw) as CrmContact[];
    return Array.isArray(parsed) && parsed.length ? parsed : SAMPLE_CONTACTS;
  } catch {
    return SAMPLE_CONTACTS;
  }
}

function loadDeals(): CrmDeal[] {
  try {
    const raw = localStorage.getItem(DEALS_KEY);
    if (!raw) return SAMPLE_DEALS;
    const parsed = JSON.parse(raw) as CrmDeal[];
    if (!Array.isArray(parsed) || !parsed.length) return SAMPLE_DEALS;
    return parsed.map((d) => ({ ...d, stage: normalizeDealStage(String(d.stage || 'Opportunity Created')) }));
  } catch {
    return SAMPLE_DEALS;
  }
}

function historyLine(actor: string, message: string): LeadHistoryEntry {
  return { at: new Date().toISOString(), actor, message };
}

/** Push follow-up / lead stage onto open deals. Won stays billing-owned; Lost is terminal. */
function syncOpenDealsStage(
  list: CrmDeal[],
  match: { leadId?: string; activityId?: string; leadName?: string; mobile?: string },
  stage: DealStage,
  extra?: Partial<CrmDeal>,
  leads?: CrmLead[],
): CrmDeal[] {
  return list.map((d) => {
    if (d.stage === 'Won' || d.stage === 'Lost') return d;
    const byLead = match.leadId && d.leadId === match.leadId;
    const byActivity = match.activityId && d.activityId === match.activityId;
    const byName = match.leadName && d.leadName === match.leadName;
    const lead = d.leadId && leads ? leads.find((l) => l.id === d.leadId) : undefined;
    const byMobile =
      match.mobile &&
      ((lead && normMobile(lead.mobile) === normMobile(match.mobile)) ||
        (d.leadName && match.leadName && d.leadName === match.leadName));
    if (!byLead && !byActivity && !byName && !byMobile) return d;
    if (d.stage === stage && !extra) return d;
    return { ...d, stage, ...extra };
  });
}

function dealMatchesBooking(d: CrmDeal, b: CrmBooking, leads: CrmLead[]) {
  if (d.bookingId && d.bookingId === b.id) return true;
  if (d.conversionId && b.externalId && d.conversionId === b.externalId) return true;
  const lead = d.leadId ? leads.find((l) => l.id === d.leadId) : undefined;
  const bMob = normMobile(b.mobile);
  if (bMob && lead && normMobile(lead.mobile) === bMob) return true;
  if (bMob && d.leadName && leads.some((l) => l.name === d.leadName && normMobile(l.mobile) === bMob)) return true;
  if (d.leadName && b.patient && d.leadName.toLowerCase() === b.patient.toLowerCase() && bMob) return true;
  return false;
}

function normMobile(m?: string) {
  return (m || '').replace(/\D/g, '').slice(-10);
}

function activityMatchesLead(a: CrmActivity, lead: CrmLead) {
  if (a.leadId && a.leadId === lead.id) return true;
  const aMob = normMobile(a.mobile);
  const lMob = normMobile(lead.mobile);
  if (aMob && lMob && aMob === lMob) return true;
  if (a.leadName === lead.name && (!aMob || !lMob || aMob === lMob)) return true;
  return false;
}

function resolveLeadForActivity(leads: CrmLead[], a: Pick<CrmActivity, 'leadId' | 'leadName' | 'mobile'>) {
  if (a.leadId) {
    const byId = leads.find((l) => l.id === a.leadId);
    if (byId) return byId;
  }
  const mob = normMobile(a.mobile);
  if (mob) {
    const byMobile = leads.find((l) => normMobile(l.mobile) === mob);
    if (byMobile) return byMobile;
  }
  if (a.leadName) {
    return leads.find((l) => l.name === a.leadName && (!mob || normMobile(l.mobile) === mob)) || null;
  }
  return null;
}

function nextOpenFollowUp(activities: CrmActivity[], lead: CrmLead) {
  return activities
    .filter((a) => !a.done && activityMatchesLead(a, lead))
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0]?.dueAt;
}

function applyLeadFollowUpSync(
  leads: CrmLead[],
  activities: CrmActivity[],
  hint: { leadId?: string; leadName?: string; mobile?: string },
  actor: string,
  message: string,
) {
  return leads.map((l) => {
    const match =
      (hint.leadId && l.id === hint.leadId) ||
      (hint.leadName && l.name === hint.leadName && (!hint.mobile || l.mobile === hint.mobile));
    if (!match) return l;
    const nextFollowUp = nextOpenFollowUp(activities, l);
    return {
      ...l,
      nextFollowUp,
      updatedAt: new Date().toISOString(),
      history: [historyLine(actor, message), ...(l.history || [])].slice(0, 40),
    };
  });
}

const Ctx = createContext<CrmState | null>(null);

function readSession() {
  try {
    const live = readCrmSession();
    if (live) return live;
    return JSON.parse(localStorage.getItem('crm_session_meta') || 'null') as {
      full_name?: string;
      user?: string;
      roles?: string[];
    } | null;
  } catch {
    return null;
  }
}

function readUserName() {
  const s = readSession();
  return (s && (s.full_name || s.user)) || 'CRM Telecaller';
}

function assigneeToTeamMember(a: CrmPortalAssignee, index: number): CrmTeamMember {
  const name = String(a.full_name || a.employee_name || '').trim() || a.employee || `Member ${index + 1}`;
  const designation = String(a.designation || '').toLowerCase();
  const role: CrmTeamRole =
    designation.includes('manager') || designation.includes('head') ? 'manager' : 'staff';
  return {
    id: a.employee || `TM-${String(index + 1).padStart(4, '0')}`,
    name,
    email: a.user || undefined,
    role,
    active: true,
  };
}

function loadTeam(): CrmTeamMember[] {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CrmTeamMember[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function detectManager(_userName: string, _team: CrmTeamMember[]) {
  try {
    const access = typeof window !== 'undefined' ? window.__crmPortalAccess : undefined;
    if (access && typeof access.isManager === 'boolean') return access.isManager;
  } catch {
    /* ignore */
  }
  const s = readSession();
  const roles = (s?.roles || []).map((r) => String(r).toLowerCase());
  /* Do not treat designation or bare CRM Manager leftovers as manager — gate publishes isManager. */
  return roles.some((r) => r === 'system manager' || r === 'administrator');
}

export function CrmProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState(loadLeads);
  const [contacts, setContacts] = useState(loadContacts);
  const [accounts] = useState(SAMPLE_ACCOUNTS);
  const [deals, setDeals] = useState(loadDeals);
  const [activities, setActivities] = useState(loadActivities);
  const [bookings, setBookings] = useState(loadBookings);
  const [campaigns] = useState(SAMPLE_CAMPAIGNS);
  const [wingFilter, setWingFilter] = useState<WingId | 'all'>('all');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [team, setTeam] = useState(loadTeam);
  const [userName] = useState(readUserName);
  const [transferNotices, setTransferNotices] = useState<CrmTransferNotice[]>([]);
  const [transferNoticeUnread, setTransferNoticeUnread] = useState(0);
  const [portalAccessTick, setPortalAccessTick] = useState(0);

  useEffect(() => {
    const sync = () => setPortalAccessTick((n) => n + 1);
    window.addEventListener('crm-portal-access', sync);
    return () => window.removeEventListener('crm-portal-access', sync);
  }, []);

  /* Recompute after HRMS portal access publishes (Manager vs Executive). */
  void portalAccessTick;
  const isManager = detectManager(userName, team);
  const userRoleLabel = isManager ? 'CRM Manager' : 'CRM Executive';

  useEffect(() => {
    try {
      localStorage.setItem(LEADS_KEY, JSON.stringify(withoutDemoSeedLeads(leads)));
    } catch {
      /* ignore quota */
    }
  }, [leads]);

  /* One-shot: purge demo seed leads once real board data is present. */
  useEffect(() => {
    setLeads((list) => {
      const next = withoutDemoSeedLeads(list);
      return next === list ? list : next;
    });
  }, []);

  /* Backfill conversion credit on already-Won leads (including transferred ones). */
  useEffect(() => {
    setLeads((list) => {
      let changed = false;
      const next = list.map((l) => {
        if (l.status !== 'Won') return l;
        const credit = leadConversionCredit(l);
        if (l.convertedBy === credit) return l;
        changed = true;
        return { ...l, convertedBy: credit };
      });
      return changed ? next : list;
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
    } catch {
      /* ignore quota */
    }
  }, [contacts]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(activities));
    } catch {
      /* ignore quota */
    }
  }, [activities]);

  /* Pending follow-ups must follow the lead owner after transfer (heal local Munmum leftovers). */
  useEffect(() => {
    const byId = new Map(leads.map((l) => [l.id, l.owner]));
    setActivities((list) => {
      let changed = false;
      const next = list.map((a) => {
        if (a.done || !a.leadId) return a;
        const leadOwner = byId.get(a.leadId);
        if (!leadOwner || leadOwner === a.owner) return a;
        changed = true;
        return { ...a, owner: leadOwner };
      });
      return changed ? next : list;
    });
  }, [leads]);

  useEffect(() => {
    try {
      localStorage.setItem(DEALS_KEY, JSON.stringify(deals));
    } catch {
      /* ignore quota */
    }
  }, [deals]);

  useEffect(() => {
    try {
      localStorage.setItem(TEAM_KEY, JSON.stringify(team));
    } catch {
      /* ignore quota */
    }
  }, [team]);

  useEffect(() => {
    let cancelled = false;
    listCrmPortalAssignees()
      .then((users) => {
        if (cancelled || !users.length) return;
        setTeam(users.map(assigneeToTeamMember));
      })
      .catch(() => {
        /* keep cached roster if HRMS unreachable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
    } catch {
      /* ignore quota */
    }
  }, [bookings]);

  const applyOwnershipMap = (map: CrmOwnershipMap) => {
    const leadMap = map.leads || {};
    const actMap = map.activities || {};
    const dealMap = map.deals || {};
    const contactMap = map.contacts || {};
    if (Object.keys(leadMap).length) {
      setLeads((list) =>
        list.map((l) => {
          const hit = leadMap[l.id];
          if (!hit?.owner || hit.owner === l.owner) return l;
          /* Freeze conversion credit on the previous owner when a Won lead moves. */
          const convertedBy =
            l.status === 'Won'
              ? l.convertedBy?.trim() || hit.from_owner || l.owner
              : l.convertedBy;
          return {
            ...l,
            owner: hit.owner,
            ownerInitials: initials(hit.owner),
            updatedAt: hit.transferred_at || l.updatedAt,
            convertedBy,
          };
        }),
      );
    }
    /* Activities: explicit map entry, OR cascade from transferred lead (pending FUs follow the lead). */
    if (Object.keys(actMap).length || Object.keys(leadMap).length) {
      setActivities((list) =>
        list.map((a) => {
          const actHit = actMap[a.id];
          if (actHit?.owner && actHit.owner !== a.owner) return { ...a, owner: actHit.owner };
          if (!a.done && a.leadId) {
            const leadHit = leadMap[a.leadId];
            if (leadHit?.owner && leadHit.owner !== a.owner) return { ...a, owner: leadHit.owner };
          }
          return a;
        }),
      );
    }
    if (Object.keys(dealMap).length) {
      setDeals((list) =>
        list.map((d) => {
          const hit = dealMap[d.id];
          if (!hit?.owner || hit.owner === d.owner) return d;
          /* Won deals keep conversion credit with the closer — ownership does not move. */
          if (d.stage === 'Won') {
            return { ...d, convertedBy: d.convertedBy?.trim() || d.owner };
          }
          return { ...d, owner: hit.owner };
        }),
      );
    }
    if (Object.keys(contactMap).length) {
      setContacts((list) =>
        list.map((c) => {
          const hit = contactMap[c.id];
          if (!hit?.owner || hit.owner === c.owner) return c;
          return { ...c, owner: hit.owner };
        }),
      );
    }
  };

  /** Overlay ownership map onto rows before cloud publish (prevents stale Munmum overwrite). */
  const withOwnershipOverlay = <T extends { id: string; owner?: string; leadId?: string; done?: boolean; stage?: string }>(
    rows: T[],
    map: CrmOwnershipMap,
    kind: 'leads' | 'activities' | 'deals' | 'contacts',
  ): T[] => {
    const bucket = map[kind] || {};
    const leadMap = map.leads || {};
    return rows.map((row) => {
      const hit = bucket[row.id];
      if (hit?.owner) return { ...row, owner: hit.owner };
      if (kind === 'activities' && !row.done && row.leadId && leadMap[row.leadId]?.owner) {
        return { ...row, owner: leadMap[row.leadId].owner };
      }
      if (kind === 'deals' && row.stage === 'Won') return row;
      if (kind === 'deals' && row.leadId && leadMap[row.leadId]?.owner) {
        return { ...row, owner: leadMap[row.leadId].owner };
      }
      return row;
    });
  };

  const refreshTransferHistory = async (leadId?: string) => {
    try {
      const rows = await listCrmTransferHistory(leadId);
      const byLead = mapTransferRows(rows);
      setLeads((list) =>
        list.map((l) => {
          if (leadId && l.id !== leadId) return l;
          const hist = byLead[l.id];
          if (!hist) return leadId ? { ...l, transferHistory: [] } : l;
          return { ...l, transferHistory: hist };
        }),
      );
    } catch {
      /* offline soft */
    }
  };

  const refreshTransferNotices = async () => {
    try {
      const data = await listCrmTransferNotices(userName);
      setTransferNotices(data.notices);
      setTransferNoticeUnread(data.unread);
    } catch {
      /* offline soft */
    }
  };

  const markTransferNoticeRead = async (id: string) => {
    try {
      await markCrmTransferNoticeRead(id);
    } catch {
      /* still mark locally */
    }
    setTransferNotices((list) => list.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
    setTransferNoticeUnread((n) => Math.max(0, n - 1));
  };

  const mergeRemoteSnapshots = (snaps: CrmRecordSnapshots) => {
    const leadRows = (snaps.leads || [])
      .map((row) => asLeadSnapshot(row as Record<string, unknown>, userName))
      .filter((x): x is CrmLead => !!x);
    const actRows = (snaps.activities || [])
      .map((row) => asActivitySnapshot(row as Record<string, unknown>, userName))
      .filter((x): x is CrmActivity => !!x);
    const dealRows = (snaps.deals || [])
      .map((row) => {
        const id = String((row as { id?: string }).id || '').trim();
        if (!id) return null;
        const owner = String((row as { owner?: string }).owner || userName);
        return { ...(row as unknown as CrmDeal), id, owner };
      })
      .filter((x): x is CrmDeal => !!x);
    const contactRows = (snaps.contacts || [])
      .map((row) => {
        const id = String((row as { id?: string }).id || '').trim();
        if (!id) return null;
        const owner = String((row as { owner?: string }).owner || userName);
        return { ...(row as unknown as CrmContact), id, owner };
      })
      .filter((x): x is CrmContact => !!x);
    if (leadRows.length) setLeads((list) => withoutDemoSeedLeads(mergeById(list, leadRows)));
    if (actRows.length) setActivities((list) => mergeById(list, actRows));
    if (dealRows.length) setDeals((list) => mergeById(list, dealRows));
    if (contactRows.length) setContacts((list) => mergeById(list, contactRows));
  };

  const publishLocalBoardToCloud = async (ownership?: CrmOwnershipMap) => {
    const sig = `${leads.length}:${activities.length}:${deals.length}:${contacts.length}`;
    const metaKey = 'crm_full_snapshot_push_v1';
    try {
      const prev = JSON.parse(localStorage.getItem(metaKey) || '{}') as { sig?: string; at?: number };
      if (prev.sig === sig && Date.now() - (prev.at || 0) < 30 * 60 * 1000) {
        return;
      }
    } catch {
      /* continue */
    }

    const chunk = <T,>(rows: T[], size: number) => {
      const out: T[][] = [];
      for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
      return out;
    };

    const map = ownership || { leads: {}, activities: {}, deals: {}, contacts: {} };
    const pubLeads = withOwnershipOverlay(leads, map, 'leads');
    const pubActs = withOwnershipOverlay(activities, map, 'activities');
    const pubDeals = withOwnershipOverlay(deals, map, 'deals');
    const pubContacts = withOwnershipOverlay(contacts, map, 'contacts');

    /* Publish entire local board so other devices (mobile) can pull the same leads/follow-ups. */
    for (const part of chunk(pubLeads, 120)) {
      if (!part.length) continue;
      await upsertCrmRecordSnapshots(
        { leads: part as unknown as Record<string, unknown>[], activities: [], deals: [], contacts: [] },
        userName,
      ).catch(() => undefined);
    }
    for (const part of chunk(pubActs, 120)) {
      if (!part.length) continue;
      await upsertCrmRecordSnapshots(
        { leads: [], activities: part as unknown as Record<string, unknown>[], deals: [], contacts: [] },
        userName,
      ).catch(() => undefined);
    }
    for (const part of chunk(pubDeals, 120)) {
      if (!part.length) continue;
      await upsertCrmRecordSnapshots(
        { leads: [], activities: [], deals: part as unknown as Record<string, unknown>[], contacts: [] },
        userName,
      ).catch(() => undefined);
    }
    for (const part of chunk(pubContacts, 120)) {
      if (!part.length) continue;
      await upsertCrmRecordSnapshots(
        { leads: [], activities: [], deals: [], contacts: part as unknown as Record<string, unknown>[] },
        userName,
      ).catch(() => undefined);
    }

    try {
      localStorage.setItem(metaKey, JSON.stringify({ sig, at: Date.now() }));
    } catch {
      /* ignore */
    }
  };

  const syncTransferredRecords = async () => {
    const map = await listCrmOwnership();
    applyOwnershipMap(map);

    /* Heal past transfers: publish any local records that ownership already points elsewhere.
       Cascade pending follow-ups linked to transferred leads even when activity map is incomplete. */
    const ownLeads = map.leads || {};
    const ownActs = map.activities || {};
    const ownDeals = map.deals || {};
    const ownContacts = map.contacts || {};
    const pushLeads = withOwnershipOverlay(
      leads.filter((l) => ownLeads[l.id]),
      map,
      'leads',
    );
    const pushActs = withOwnershipOverlay(
      activities.filter(
        (a) =>
          Boolean(ownActs[a.id]) ||
          Boolean(a.leadId && ownLeads[a.leadId] && !a.done),
      ),
      map,
      'activities',
    );
    const pushDeals = withOwnershipOverlay(
      deals.filter((d) => ownDeals[d.id] || (d.leadId && ownLeads[d.leadId] && d.stage !== 'Won')),
      map,
      'deals',
    );
    const pushContacts = withOwnershipOverlay(
      contacts.filter((c) => ownContacts[c.id]),
      map,
      'contacts',
    );
    if (pushLeads.length || pushActs.length || pushDeals.length || pushContacts.length) {
      await upsertCrmRecordSnapshots({
        leads: pushLeads as unknown as Record<string, unknown>[],
        activities: pushActs as unknown as Record<string, unknown>[],
        deals: pushDeals as unknown as Record<string, unknown>[],
        contacts: pushContacts as unknown as Record<string, unknown>[],
      }).catch(() => undefined);
      /* Force a full board republish so healed owners replace stale Munmum snapshots. */
      try {
        localStorage.removeItem('crm_full_snapshot_push_v1');
      } catch {
        /* ignore */
      }
    }

    /* Push full local CRM board to cloud (desktop → mobile / other browsers). */
    await publishLocalBoardToCloud(map);

    /* Pull records assigned to this login (and all if manager, so board stays complete). */
    const snaps = await listCrmRecordSnapshots(userName, isManager);
    mergeRemoteSnapshots(snaps);
    /* Re-apply after merge so stale Munmum snapshots cannot win over the ownership map. */
    applyOwnershipMap(map);
  };

  useEffect(() => {
    let cancelled = false;
    syncTransferredRecords()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        refreshTransferHistory().catch(() => undefined);
        refreshTransferNotices().catch(() => undefined);
      });
    const poll = window.setInterval(() => {
      Promise.all([listCrmRecordSnapshots(userName, isManager), listCrmOwnership()])
        .then(([snaps, map]) => {
          if (cancelled) return;
          mergeRemoteSnapshots(snaps);
          applyOwnershipMap(map);
        })
        .catch(() => undefined);
      refreshTransferNotices().catch(() => undefined);
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
    // Re-pull when Manager/Executive resolves from HRMS portal access.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, userName]);

  const pushToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };

  /** Push CRM records to server snapshots so Leads / Follow-ups / Deals boards stay shared. */
  const publishSnapshots = (partial: {
    leads?: CrmLead[];
    activities?: CrmActivity[];
    deals?: CrmDeal[];
    contacts?: CrmContact[];
  }) => {
    const leadsPayload = partial.leads || [];
    const actsPayload = partial.activities || [];
    const dealsPayload = partial.deals || [];
    const contactsPayload = partial.contacts || [];
    if (!leadsPayload.length && !actsPayload.length && !dealsPayload.length && !contactsPayload.length) {
      return;
    }
    void upsertCrmRecordSnapshots(
      {
        leads: leadsPayload as unknown as Record<string, unknown>[],
        activities: actsPayload as unknown as Record<string, unknown>[],
        deals: dealsPayload as unknown as Record<string, unknown>[],
        contacts: contactsPayload as unknown as Record<string, unknown>[],
      },
      userName,
    ).catch(() => undefined);
  };

  const portalAccess = typeof window !== 'undefined' ? window.__crmPortalAccess : undefined;
  const byOwner = <T extends { owner?: string }>(rows: T[]) =>
    isManager ? rows : rows.filter((r) => ownerIsMe(String(r.owner || ''), userName, team));
  const byCategory = <T extends { wing?: string }>(rows: T[]) => {
    const cats = portalAccess?.categories;
    if (!cats || cats.all || (cats.ids || []).length >= 2) return rows;
    const ids = new Set(cats.ids || []);
    return rows.filter((r) => {
      const w = String(r.wing || '').toLowerCase();
      if (w === 'franchise' || w === 'nexilab') return ids.has('franchise');
      if (w === 'aesthetic' || w === 'care' || w === 'lab') return ids.has('service');
      return true;
    });
  };
  const hasRealLeads = leads.some((l) => !DEMO_LEAD_IDS.has(l.id));
  const liveLeads = hasRealLeads ? leads.filter((l) => !DEMO_LEAD_IDS.has(l.id)) : leads;
  const scopedLeads = byCategory(byOwner(liveLeads));
  /* Reports keep conversion credit with the closer after transfer. */
  const reportLeads = byCategory(
    isManager
      ? liveLeads
      : liveLeads.filter(
          (l) =>
            ownerIsMe(String(l.owner || ''), userName, team) ||
            ownerIsMe(String(leadConversionCredit(l) || ''), userName, team),
        ),
  );
  const scopedActivities = byCategory(
    byOwner(hasRealLeads ? activities.filter((a) => !(a.leadId && DEMO_LEAD_IDS.has(a.leadId))) : activities),
  );
  const scopedContacts = byCategory(byOwner(contacts));
  const liveDeals = hasRealLeads ? deals.filter((d) => !(d.leadId && DEMO_LEAD_IDS.has(d.leadId))) : deals;
  const scopedDeals = byCategory(
    isManager
      ? liveDeals
      : liveDeals.filter(
          (d) =>
            ownerIsMe(String(d.owner || ''), userName, team) ||
            (d.stage === 'Won' && ownerIsMe(String(d.convertedBy || d.owner || ''), userName, team)),
        ),
  );
  const ownerBookings = isManager
    ? bookings
    : bookings.filter(
        (b) => ownerIsMe(b.owner || '', userName, team) || ownerIsMe(b.executive || '', userName, team),
      );
  const scopedBookings = byCategory(ownerBookings);

  const value = useMemo<CrmState>(
    () => ({
      leads: scopedLeads,
      reportLeads,
      contacts: scopedContacts,
      accounts,
      deals: scopedDeals,
      activities: scopedActivities,
      bookings: scopedBookings,
      campaigns,
      wingFilter,
      setWingFilter,
      toasts,
      pushToast,
      team,
      isManager,
      userRoleLabel,
      userName,
      transferNotices,
      transferNoticeUnread,
      refreshTransferHistory,
      refreshTransferNotices,
      markTransferNoticeRead,
      addLead: (input) => {
        const now = new Date().toISOString();
        const lead: CrmLead = {
          ...input,
          id: input.id || nextId('LD', leads),
          ownerInitials: initials(input.owner || userName),
          createdAt: input.createdAt || now,
          updatedAt: now,
          history: [
            historyLine(input.owner || userName, `Lead created · ${input.status || 'New'} · ${input.wing}`),
            ...(input.history || []),
          ],
        };
        const contact: CrmContact = {
          id: nextId('CT', contacts),
          name: lead.name,
          mobile: lead.mobile,
          email: lead.email,
          wing: lead.wing,
          owner: lead.owner,
          role: lead.wing === 'franchise' ? 'Franchise Applicant' : 'Lead',
        };
        setLeads((list) => [lead, ...list]);
        setContacts((list) => [contact, ...list]);
        publishSnapshots({ leads: [lead], contacts: [contact] });
        return lead;
      },
      importLeads: (rows) => {
        let added = 0;
        let skipped = 0;
        const now = new Date().toISOString();
        const created: CrmLead[] = [];
        setLeads((list) => {
          const next = [...list];
          let seq = list.length;
          for (const row of rows) {
            const mobile = (row.mobile || '').replace(/\D/g, '').slice(-10);
            const name = (row.name || '').trim();
            const createdAt =
              row.createdAt && !Number.isNaN(new Date(row.createdAt).getTime()) ? row.createdAt : '';
            if (!name || !/^\d{10}$/.test(mobile) || !createdAt) {
              skipped += 1;
              continue;
            }
            if (next.some((l) => l.mobile === mobile && l.name.toLowerCase() === name.toLowerCase())) {
              skipped += 1;
              continue;
            }
            seq += 1;
            const owner = row.owner?.trim() || userName;
            const lead: CrmLead = {
              id: `LD-${String(seq).padStart(4, '0')}`,
              name,
              mobile,
              email: (row.email || '').trim(),
              wing: row.wing || 'lab',
              source: row.source || 'Telecaller',
              status: row.status || 'New',
              owner,
              ownerInitials: initials(owner),
              city: row.city?.trim() || undefined,
              notes: row.notes?.trim() || undefined,
              value: row.value,
              createdAt,
              updatedAt: now,
              history: [historyLine(owner, `Lead imported · ${row.status || 'New'} · ${row.wing || 'lab'} · entry ${createdAt.slice(0, 10)}`)],
            };
            next.unshift(lead);
            created.push(lead);
            added += 1;
          }
          return next;
        });
        if (created.length) {
          setContacts((list) => {
            const next = [...list];
            let seq = list.length;
            for (const lead of created) {
              if (next.some((c) => c.mobile === lead.mobile && c.name.toLowerCase() === lead.name.toLowerCase())) continue;
              seq += 1;
              next.unshift({
                id: `CT-${String(seq).padStart(4, '0')}`,
                name: lead.name,
                mobile: lead.mobile,
                email: lead.email,
                wing: lead.wing,
                owner: lead.owner,
                role: lead.wing === 'franchise' ? 'Franchise Applicant' : 'Lead',
              });
            }
            return next;
          });
        }
        return { added, skipped };
      },
      importCampaignLeads: (input) => {
        const results: Array<{
          rowIndex: number;
          status: 'imported' | 'duplicate' | 'updated' | 'failed';
          leadId?: string;
          error?: string;
        }> = [];
        let imported = 0;
        let duplicates = 0;
        let failed = 0;
        let updated = 0;
        const now = new Date().toISOString();
        const owner = input.owner.trim() || userName;
        const createdContacts: CrmLead[] = [];

        setLeads((list) => {
          const next = [...list];
          let seq = list.length;
          for (const row of input.rows) {
            let name = stripMetaPrefix(row.name || '').trim();
            const mobile = normalizeSheetMobile(row.mobile || '');
            let email = stripMetaPrefix(row.email || '').trim().toLowerCase();
            /* Swap if name/email columns were reversed in the sheet map */
            if (/@/.test(name) && (!email || !/@/.test(email))) {
              email = name.toLowerCase();
              name = '';
            }
            if (!name) {
              failed += 1;
              results.push({
                rowIndex: row.rowIndex,
                status: 'failed',
                error: 'Missing name — full_name column empty or CSV columns shifted',
              });
              continue;
            }
            if (
              /@/.test(name)
              || /^(own_shop|rental_shop|yes|no)$/i.test(name)
              || looksLikeSheetOrFormTitle(name)
              || looksLikeDateTimeValue(name)
            ) {
              failed += 1;
              results.push({
                rowIndex: row.rowIndex,
                status: 'failed',
                error: `Name looks invalid (“${name.slice(0, 40)}”) — map Name → full_name (not created_time / form_name)`,
              });
              continue;
            }
            if (name.toLowerCase().includes('franchise le')) {
              failed += 1;
              results.push({
                rowIndex: row.rowIndex,
                status: 'failed',
                error: 'Name looks like a campaign title — remap Name → full_name',
              });
              continue;
            }
            if (!/^[6-9]\d{9}$/.test(mobile)) {
              failed += 1;
              const raw = String(row.mobile || '').slice(0, 40);
              results.push({
                rowIndex: row.rowIndex,
                status: 'failed',
                error: raw
                  ? `Invalid mobile (need 10-digit IN number). Got “${raw}” — map Mobile → phone_number (Meta p:+91… is OK)`
                  : 'Invalid mobile — map Mobile → phone_number',
              });
              continue;
            }
            const existingIdx = next.findIndex((l) => {
              if (l.sheetKey && l.sheetKey === row.fingerprint) return true;
              if (
                l.campaignId === input.campaignId
                && l.sheetRowRef === `row:${row.rowIndex}`
              ) {
                return true;
              }
              if (normMobile(l.mobile) !== mobile) return false;
              /* Same mobile + same name → same person */
              if (l.name.toLowerCase() === name.toLowerCase()) return true;
              /* Same mobile + matching email (both present) */
              if (email && (l.email || '').toLowerCase() === email) return true;
              /* Same mobile alone — treat as duplicate (one lead per phone). */
              return true;
            });
            if (existingIdx >= 0) {
              const existing = next[existingIdx];
              if (input.duplicateRule === 'skip') {
                duplicates += 1;
                results.push({ rowIndex: row.rowIndex, status: 'duplicate', leadId: existing.id });
                continue;
              }
              const patch: Partial<CrmLead> = {
                campaignId: input.campaignId,
                campaignName: input.campaignName,
                sheetRowRef: `row:${row.rowIndex}`,
                sheetKey: row.fingerprint,
                updatedAt: now,
              };
              if (input.duplicateRule === 'update_notes') {
                const note = row.notes || row.serviceRequired;
                if (note) {
                  patch.notes = [existing.notes, `Sheet sync · ${note}`].filter(Boolean).join('\n').slice(0, 2000);
                }
              }
              if (input.duplicateRule === 'update_empty') {
                if (!existing.email && row.email) patch.email = row.email.trim();
                if (!existing.city && row.city) patch.city = row.city;
                if (!existing.district && row.district) patch.district = row.district;
                if (!existing.serviceRequired && row.serviceRequired) patch.serviceRequired = row.serviceRequired;
              }
              next[existingIdx] = {
                ...existing,
                ...patch,
                history: [
                  historyLine(owner, `Campaign sync · matched existing · ${input.campaignName}`),
                  ...(existing.history || []),
                ].slice(0, 40),
              };
              updated += 1;
              results.push({ rowIndex: row.rowIndex, status: 'updated', leadId: existing.id });
              continue;
            }

            seq += 1;
            const createdAt =
              row.createdAt && !Number.isNaN(new Date(row.createdAt).getTime())
                ? new Date(row.createdAt).toISOString()
                : now;
            const lead: CrmLead = {
              id: `LD-${String(seq).padStart(4, '0')}`,
              name,
              mobile,
              email: row.email?.trim() || '',
              wing: input.wing,
              source: row.source || input.source || 'Google Sheets',
              status: 'New',
              owner,
              ownerInitials: initials(owner),
              city: row.city?.trim() || undefined,
              district: row.district?.trim() || undefined,
              state: row.state?.trim() || undefined,
              pinCode: row.pinCode?.trim() || undefined,
              serviceRequired: row.serviceRequired?.trim() || undefined,
              notes: row.notes?.trim() || undefined,
              franchiseModel:
                input.wing === 'franchise'
                  ? ((row.franchiseModel || '').toUpperCase().includes('FOCO')
                      ? 'FOCO'
                      : (row.franchiseModel || '').toUpperCase().includes('FOFO')
                        ? 'FOFO'
                        : row.propertyOwnership && /rental/i.test(row.propertyOwnership)
                          ? 'FOCO'
                          : row.propertyOwnership && /own/i.test(row.propertyOwnership)
                            ? 'FOFO'
                            : 'Other')
                  : undefined,
              franchiseVertical:
                input.wing === 'franchise'
                  ? (input.franchiseVertical || 'lab')
                  : undefined,
              propertyOwnership:
                input.wing === 'franchise' ? row.propertyOwnership?.trim() || undefined : undefined,
              investmentCapacity:
                input.wing === 'franchise' ? row.investmentCapacity?.trim() || undefined : undefined,
              timeline: input.wing === 'franchise' ? row.timeline?.trim() || undefined : undefined,
              preferredLocation: row.preferredLocation?.trim() || undefined,
              alternateMobile: row.alternateMobile?.trim() || undefined,
              createdAt,
              updatedAt: now,
              campaignId: input.campaignId,
              campaignName: input.campaignName,
              sheetRowRef: `row:${row.rowIndex}`,
              sheetKey: row.fingerprint,
              history: [
                historyLine(
                  owner,
                  `Imported from Google Sheet · ${input.campaignName} · row ${row.rowIndex}`,
                ),
              ],
            };
            next.unshift(lead);
            createdContacts.push(lead);
            imported += 1;
            results.push({ rowIndex: row.rowIndex, status: 'imported', leadId: lead.id });
          }
          return next;
        });

        if (createdContacts.length) {
          setContacts((list) => {
            const next = [...list];
            let seq = list.length;
            for (const lead of createdContacts) {
              if (next.some((c) => c.mobile === lead.mobile && c.name.toLowerCase() === lead.name.toLowerCase())) {
                continue;
              }
              seq += 1;
              next.unshift({
                id: `CT-${String(seq).padStart(4, '0')}`,
                name: lead.name,
                mobile: lead.mobile,
                email: lead.email,
                wing: lead.wing,
                owner: lead.owner,
                role: lead.wing === 'franchise' ? 'Franchise Applicant' : 'Lead',
              });
            }
            return next;
          });
          /* Seed a first follow-up so wing follow-up boards see sheet leads. */
          setActivities((list) => {
            const next = [...list];
            let seq = list.length;
            const due = new Date(Date.now() + 86400000).toISOString();
            for (const lead of createdContacts) {
              seq += 1;
              next.unshift({
                id: `ACT-${String(seq).padStart(4, '0')}`,
                type: 'Call',
                title: `Call — ${lead.name}`,
                leadName: lead.name,
                leadId: lead.id,
                mobile: lead.mobile,
                wing: lead.wing,
                dueAt: due,
                done: false,
                owner: lead.owner,
                leadStage: 'New',
                notes: `Auto follow-up from campaign ${input.campaignName}`,
                history: [
                  {
                    at: now,
                    type: 'Call',
                    message: `Scheduled after sheet import · ${input.campaignName}`,
                    actor: owner,
                  },
                ],
              });
            }
            return next;
          });
        }

        return { imported, duplicates, failed, updated, results };
      },
      addContact: (input) => {
        const contact: CrmContact = {
          ...input,
          id: input.id || nextId('CT', contacts),
          owner: input.owner || userName,
        };
        setContacts((list) => [contact, ...list]);
        publishSnapshots({ contacts: [contact] });
        return contact;
      },
      importContacts: (rows) => {
        let added = 0;
        let skipped = 0;
        setContacts((list) => {
          const next = [...list];
          let seq = list.length;
          for (const row of rows) {
            const mobile = (row.mobile || '').replace(/\D/g, '').slice(-10);
            const name = (row.name || '').trim();
            if (!name || !/^\d{10}$/.test(mobile)) {
              skipped += 1;
              continue;
            }
            if (next.some((c) => c.mobile === mobile && c.name.toLowerCase() === name.toLowerCase())) {
              skipped += 1;
              continue;
            }
            seq += 1;
            next.unshift({
              id: `CT-${String(seq).padStart(4, '0')}`,
              name,
              mobile,
              email: (row.email || '').trim(),
              wing: row.wing || 'lab',
              role: row.role?.trim() || 'Contact',
              account: row.account?.trim() || undefined,
              owner: row.owner?.trim() || userName,
            });
            added += 1;
          }
          return next;
        });
        return { added, skipped };
      },
      updateLead: (id, patch, note) => {
        let updated: CrmLead | null = null;
        let previousWing: WingId | null = null;
        let previousOwner: string | null = null;
        const safePatch = { ...patch };
        /* Executives cannot change ownership outside Transfer Lead (manager-only). */
        if (!detectManager(userName, team) && safePatch.owner !== undefined) {
          delete safePatch.owner;
        }
        setLeads((list) =>
          list.map((l) => {
            if (l.id !== id) return l;
            previousWing = l.wing;
            previousOwner = l.owner;
            const nextOwner = safePatch.owner ?? l.owner;
            const changes: string[] = [];
            if (safePatch.status && safePatch.status !== l.status) changes.push(`Status ${l.status} → ${safePatch.status}`);
            if (safePatch.owner && safePatch.owner !== l.owner) changes.push(`Owner → ${safePatch.owner}`);
            if (safePatch.wing && safePatch.wing !== l.wing) changes.push(`Wing → ${safePatch.wing}`);
            if (
              safePatch.franchiseVertical &&
              safePatch.franchiseVertical !== l.franchiseVertical &&
              (safePatch.wing ?? l.wing) === 'franchise'
            ) {
              changes.push(
                `Franchise → ${franchiseVerticalLabel(safePatch.franchiseVertical) || safePatch.franchiseVertical}`,
              );
            }
            if (safePatch.source && safePatch.source !== l.source) changes.push(`Source → ${safePatch.source}`);
            if (safePatch.nextFollowUp && safePatch.nextFollowUp !== l.nextFollowUp) changes.push('Follow-up updated');
            if (note?.trim()) changes.push(note.trim());
            if (!changes.length && (safePatch.name || safePatch.mobile || safePatch.email || safePatch.city || safePatch.notes || safePatch.value !== undefined)) {
              changes.push('Lead details updated');
            }
            const entry = changes.length ? historyLine(userName, changes.join(' · ')) : null;
            updated = {
              ...l,
              ...safePatch,
              owner: nextOwner,
              ownerInitials: initials(nextOwner),
              updatedAt: new Date().toISOString(),
              history: entry ? [entry, ...(l.history || [])].slice(0, 40) : l.history,
            };
            /* Lock conversion credit when status first becomes Won. */
            if (updated.status === 'Won' && l.status !== 'Won') {
              updated = withConversionCredit(updated, l.owner || userName);
            } else if (updated.status === 'Won' && !updated.convertedBy) {
              updated = withConversionCredit(updated, leadConversionCredit(updated));
            }
            /* Never let a transfer patch clear convertedBy. */
            if (l.convertedBy && !updated.convertedBy) updated = { ...updated, convertedBy: l.convertedBy };
            return updated;
          }),
        );
        /* Keep linked follow-ups / deals on the same wing when Business wing changes. */
        if (updated && safePatch.wing && previousWing && safePatch.wing !== previousWing) {
          const nextWing = safePatch.wing;
          setActivities((list) =>
            list.map((a) => (a.leadId === id ? { ...a, wing: nextWing, leadName: updated!.name } : a)),
          );
          setDeals((list) =>
            list.map((d) => (d.leadId === id ? { ...d, wing: nextWing } : d)),
          );
        }
        /* Owner change (manager edit) must move pending follow-ups with the lead. */
        let movedActs: CrmActivity[] = [];
        if (updated && safePatch.owner && previousOwner && safePatch.owner !== previousOwner) {
          const nextOwner = safePatch.owner;
          setActivities((list) => {
            const next = list.map((a) => {
              if (a.leadId !== id || a.done || a.owner === nextOwner) return a;
              const row = { ...a, owner: nextOwner };
              movedActs.push(row);
              return row;
            });
            return movedActs.length ? next : list;
          });
        }
        if (updated) {
          publishSnapshots({
            leads: [updated],
            activities: movedActs.length ? movedActs : undefined,
          });
        }
        return updated;
      },
      deleteLeads: (ids) => {
        /* Managers / admins only — executives cannot delete leads. */
        if (!detectManager(userName, team)) {
          pushToast('Only CRM Managers can delete leads', 'err');
          return { deleted: 0 };
        }
        const idSet = new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean));
        if (!idSet.size) return { deleted: 0 };
        const allowed = leads.filter((l) => idSet.has(l.id));
        if (!allowed.length) {
          pushToast('No leads to delete', 'err');
          return { deleted: 0 };
        }
        const allowIds = new Set(allowed.map((l) => l.id));
        setLeads((list) => list.filter((l) => !allowIds.has(l.id)));
        setActivities((list) => list.filter((a) => !(a.leadId && allowIds.has(a.leadId))));
        return { deleted: allowed.length };
      },
      deleteActivities: (ids) => {
        if (!detectManager(userName, team)) {
          pushToast('Only CRM Managers can delete follow-ups', 'err');
          return { deleted: 0 };
        }
        const idSet = new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean));
        if (!idSet.size) return { deleted: 0 };
        const allowed = activities.filter((a) => idSet.has(a.id));
        if (!allowed.length) {
          pushToast('No follow-ups to delete', 'err');
          return { deleted: 0 };
        }
        const allowIds = new Set(allowed.map((a) => a.id));
        setActivities((list) => list.filter((a) => !allowIds.has(a.id)));
        return { deleted: allowed.length };
      },
      setLeadStatusFromFollowUp: (activityId, status) => {
        const activity = activities.find((a) => a.id === activityId);
        if (!activity) return null;
        const nextStatus = normalizeLeadStatus(status);
        const linked = resolveLeadForActivity(leads, activity);
        let updated: CrmLead | null = null;
        const now = new Date().toISOString();

        if (linked) {
          setLeads((list) =>
            list.map((l) => {
              if (l.id !== linked.id) return l;
              if (l.status === nextStatus) {
                updated = l;
                return l;
              }
              updated = {
                ...l,
                status: nextStatus,
                updatedAt: now,
                history: [
                  historyLine(userName, `Status ${l.status} → ${nextStatus} · via follow-up`),
                  ...(l.history || []),
                ].slice(0, 40),
              };
              if (nextStatus === 'Won') {
                updated = withConversionCredit(updated, l.owner || userName, now);
              }
              return updated;
            }),
          );
        }

        setActivities((list) =>
          list.map((a) => {
            const same =
              a.id === activityId ||
              (linked && activityMatchesLead(a, linked)) ||
              (activity.leadId && a.leadId === activity.leadId) ||
              (normMobile(a.mobile) && normMobile(a.mobile) === normMobile(activity.mobile));
            if (!same) return a;
            return {
              ...a,
              leadId: a.leadId || linked?.id || a.leadId,
              leadStage: nextStatus,
            };
          }),
        );

        const dealStage = leadStatusToDealStage(nextStatus);
        if (dealStage && dealStage !== 'Won') {
          setDeals((list) =>
            syncOpenDealsStage(
              list,
              {
                leadId: linked?.id || activity.leadId,
                activityId,
                leadName: activity.leadName,
                mobile: activity.mobile,
              },
              dealStage,
              dealStage === 'Lost' ? { lostReason: 'Not Interested' } : undefined,
              leads,
            ),
          );
        }

        if (updated) publishSnapshots({ leads: [updated] });
        return updated;
      },
      addBooking: (input) => {
        const id = input.id || nextId('BK', bookings);
        const executive = input.executive || input.owner || userName;
        const executiveCode = input.executiveCode || executiveCodeFromName(executive);
        const trackingTag = input.trackingTag || makeTrackingTag(executive, id);
        const booking = ensureBookingTracking({
          ...input,
          id,
          owner: input.owner || userName,
          executive,
          executiveCode,
          trackingTag,
          salesStatus: input.salesStatus || 'Open',
          createdAt: new Date().toISOString(),
        } as CrmBooking);
        setBookings((list) => [booking, ...list]);
        /* Portal booking created → linked open deal moves to Ready for Conversion. */
        setDeals((list) =>
          list.map((d) => {
            if (d.stage === 'Won' || d.stage === 'Lost') return d;
            const lead = d.leadId ? leads.find((l) => l.id === d.leadId) : undefined;
            const byMobile =
              normMobile(booking.mobile) &&
              lead &&
              normMobile(lead.mobile) === normMobile(booking.mobile);
            const byPatient =
              Boolean(normMobile(booking.mobile)) &&
              d.leadName &&
              booking.patient &&
              d.leadName.toLowerCase() === booking.patient.toLowerCase();
            if (!dealMatchesBooking(d, booking, leads) && !byMobile && !byPatient) return d;
            return {
              ...d,
              bookingId: booking.id,
              stage: 'Ready for Conversion',
              conversionType: conversionTypeFromWing(booking.wing),
            };
          }),
        );
        return booking;
      },
      updateBooking: (id, patch) => {
        let updated: CrmBooking | null = null;
        setBookings((list) =>
          list.map((b) => {
            if (b.id !== id) return b;
            updated = ensureBookingTracking({ ...b, ...patch });
            return updated;
          }),
        );
        return updated;
      },
      applySalesCloses: (rows) => {
        let matched = 0;
        const closedForDeals: CrmBooking[] = [];
        setBookings((list) =>
          list.map((b) => {
            const mobile = (b.mobile || '').replace(/\D/g, '').slice(-10);
            const hits = rows.filter((r) => {
              const tag = (r.tracking_tag || '').toUpperCase();
              const bookingId = (r.booking_id || '').toUpperCase();
              const closeMobile = (r.mobile || '').replace(/\D/g, '').slice(-10);
              if (tag && tag === b.trackingTag.toUpperCase()) return true;
              if (bookingId && bookingId === b.id.toUpperCase()) return true;
              /* Fallback: same patient mobile + portal wing when tag was mangled on older bills. */
              if (mobile && closeMobile === mobile && Number(r.amount) > 0) {
                const portal = (r.portal || '').toLowerCase();
                if (!portal || portal === b.wing) return true;
              }
              return false;
            });
            if (!hits.length) return b;
            matched += 1;
            const hit = [...hits].sort((a, c) => Number(c.amount || 0) - Number(a.amount || 0))[0];
            const amount = hits.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) || b.billedAmount || 0;
            const next = ensureBookingTracking({
              ...b,
              billedAmount: amount,
              billRef: hits.map((r) => r.bill_ref).filter(Boolean).join(', ') || b.billRef,
              billPortal: (hit.portal as CrmBooking['billPortal']) || b.billPortal,
              closedAt: hit.closed_at || b.closedAt || new Date().toISOString(),
              salesStatus: amount > 0 ? 'Closed' : 'Billed',
              status: b.status === 'Cancelled' ? b.status : 'Completed',
              executive: hit.executive || b.executive,
            });
            if (amount > 0) closedForDeals.push(next);
            return next;
          }),
        );
        /* Convert / Won syncs from portal billing — not from the Deals Convert button. */
        if (closedForDeals.length) {
          const now = new Date().toISOString();
          const wonLeadIds = new Set<string>();
          setDeals((list) =>
            list.map((d) => {
              if (d.stage === 'Won' || d.stage === 'Lost') return d;
              const booking = closedForDeals.find((b) => dealMatchesBooking(d, b, leads));
              if (!booking) return d;
              if (d.leadId) wonLeadIds.add(d.leadId);
              return {
                ...d,
                stage: 'Won' as DealStage,
                bookingId: booking.id,
                conversionId: booking.billRef || booking.externalId || booking.id,
                conversionType: conversionTypeFromWing(booking.wing, booking.billPortal),
                value: booking.billedAmount && booking.billedAmount > 0 ? booking.billedAmount : d.value,
              };
            }),
          );
          if (wonLeadIds.size) {
            setLeads((list) =>
              list.map((l) => {
                if (!wonLeadIds.has(l.id) || l.status === 'Won') return l;
                const booking = closedForDeals.find((b) => {
                  const mob = normMobile(b.mobile);
                  return mob && normMobile(l.mobile) === mob;
                });
                const conversionId = booking?.billRef || booking?.externalId || booking?.id || l.conversionId;
                return withConversionCredit(
                  {
                    ...l,
                    status: 'Won' as LeadStatus,
                    conversionId,
                    conversionType: conversionTypeFromWing(booking?.wing, booking?.billPortal),
                    convertedAt: now,
                    updatedAt: now,
                    history: [
                      historyLine(
                        userName,
                        `Won / Converted · portal billing${conversionId ? ` · ${conversionId}` : ''}`,
                      ),
                      ...(l.history || []),
                    ].slice(0, 40),
                  },
                  l.owner || userName,
                  now,
                );
              }),
            );
          }
        }
        return matched;
      },
      toggleActivity: (id) => {
        const hint: { leadId?: string; leadName: string; mobile?: string; done: boolean; type: string } = {
          leadName: '',
          done: false,
          type: 'Call',
        };
        let found = false;
        let nextList: CrmActivity[] = [];
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const next = {
              ...a,
              done: !a.done,
              completedAt: !a.done ? new Date().toISOString() : undefined,
            };
            found = true;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            hint.done = next.done;
            hint.type = next.type;
            return next;
          });
          return nextList;
        });
        if (found) {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              hint.done ? `Follow-up completed (${hint.type})` : `Follow-up reopened (${hint.type})`,
            ),
          );
        }
      },
      updateActivity: (id, patch) => {
        const hint: { leadId?: string; leadName: string; mobile?: string } = { leadName: '' };
        let nextList: CrmActivity[] = [];
        let result: CrmActivity | null = null;
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const next = { ...a, ...patch };
            result = next;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            return next;
          });
          return nextList;
        });
        if (result && (patch.dueAt !== undefined || patch.done !== undefined || patch.leadStage)) {
          setLeads((list) => {
            let next = applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              'Follow-up details synced',
            );
            if (patch.leadStage) {
              const stage = normalizeLeadStatus(String(patch.leadStage));
              const linked = resolveLeadForActivity(next, {
                leadId: hint.leadId,
                leadName: hint.leadName,
                mobile: hint.mobile,
              });
              if (linked) {
                next = next.map((l) =>
                  l.id === linked.id
                    ? {
                        ...l,
                        status: stage,
                        updatedAt: new Date().toISOString(),
                        history: [
                          historyLine(userName, `Status ${l.status} → ${stage} · via follow-up`),
                          ...(l.history || []),
                        ].slice(0, 40),
                      }
                    : l,
                );
              }
            }
            return next;
          });
        }
        if (result) {
          const act = result as CrmActivity;
          const linked = resolveLeadForActivity(leads, {
            leadId: act.leadId,
            leadName: act.leadName,
            mobile: act.mobile,
          });
          publishSnapshots({
            activities: [act],
            leads: linked ? [linked] : [],
          });
        }
        return result;
      },
      logActivityUpdate: (id, input) => {
        const now = new Date().toISOString();
        const message = input.message.trim();
        if (!message) return null;
        const hint: { leadId?: string; leadName: string; mobile?: string } = { leadName: '' };
        let nextList: CrmActivity[] = [];
        let result: CrmActivity | null = null;
        const outcome = input.outcome;
        const mappedStatus = outcome ? outcomeToLeadStatus(outcome) : null;
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const nextType = input.type || a.type;
            const histMsg = outcome ? `${outcome} · ${message}` : message;
            const next: CrmActivity = {
              ...a,
              type: nextType,
              title: `${nextType} — ${a.leadName}`,
              dueAt: input.nextDueAt || a.dueAt,
              notes: message,
              outcome: outcome || a.outcome,
              expectedOutcome: input.expectedOutcome || a.expectedOutcome,
              leadStage: mappedStatus || a.leadStage,
              history: [
                { at: now, type: nextType, message: histMsg, actor: userName },
                ...(a.history || []),
              ].slice(0, 40),
            };
            result = next;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            return next;
          });
          return nextList;
        });
        if (result) {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              outcome ? `Follow-up outcome · ${outcome} · ${message}` : `Follow-up update · ${message}`,
            ).map((l) => {
              if (!mappedStatus) return l;
              const match =
                (hint.leadId && l.id === hint.leadId) ||
                (l.name === hint.leadName && (!hint.mobile || l.mobile === hint.mobile));
              return match ? { ...l, status: mappedStatus } : l;
            }),
          );
          const dealStage = outcome ? outcomeToDealStage(outcome) : mappedStatus ? leadStatusToDealStage(mappedStatus) : null;
          if (dealStage && dealStage !== 'Won') {
            setDeals((list) =>
              syncOpenDealsStage(
                list,
                {
                  leadId: hint.leadId,
                  activityId: id,
                  leadName: hint.leadName,
                  mobile: hint.mobile,
                },
                dealStage,
                dealStage === 'Lost' ? { lostReason: 'Not Interested' } : undefined,
                leads,
              ),
            );
          }
        }
        return result;
      },
      completeActivity: (id, note) => {
        const now = new Date().toISOString();
        const hint: { leadId?: string; leadName: string; mobile?: string; type: string } = {
          leadName: '',
          type: 'Call',
        };
        let nextList: CrmActivity[] = [];
        let result: CrmActivity | null = null;
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const entry = {
              at: now,
              type: a.type,
              message: note?.trim() || 'Marked as completed',
              actor: userName,
            };
            const next: CrmActivity = {
              ...a,
              done: true,
              completedAt: now,
              notes: note?.trim() || a.notes,
              history: [entry, ...(a.history || [])].slice(0, 40),
            };
            result = next;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            hint.type = next.type;
            return next;
          });
          return nextList;
        });
        if (result) {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              `Follow-up completed (${hint.type})${note?.trim() ? ` · ${note.trim()}` : ''}`,
            ),
          );
        }
        return result;
      },
      addActivity: (input) => {
        const activity: CrmActivity = {
          ...input,
          id: input.id || nextId('ACT', activities),
          history: input.history || [
            {
              at: new Date().toISOString(),
              type: input.type,
              message: `Scheduled ${input.type} follow-up`,
              actor: input.owner || userName,
            },
          ],
        };
        const nextList = [activity, ...activities];
        setActivities(nextList);
        let syncedLeads: CrmLead[] = [];
        setLeads((list) => {
          const next = applyLeadFollowUpSync(
            list,
            nextList,
            { leadId: activity.leadId, leadName: activity.leadName, mobile: activity.mobile },
            userName,
            `Follow-up scheduled (${activity.type}) · ${new Date(activity.dueAt).toLocaleString('en-IN')}`,
          );
          if (activity.leadId) {
            const hit = next.find((l) => l.id === activity.leadId);
            if (hit) syncedLeads = [hit];
          }
          return next;
        });
        publishSnapshots({ activities: [activity], leads: syncedLeads });
        return activity;
      },
      addDeal: (input) => {
        const deal: CrmDeal = {
          ...input,
          id: input.id || nextId('DL', deals),
          createdAt: input.createdAt || new Date().toISOString(),
        };
        setDeals((list) => [deal, ...list]);
        publishSnapshots({ deals: [deal] });
        return deal;
      },
      updateDeal: (id, patch) => {
        let updated: CrmDeal | null = null;
        let syncedLead: CrmLead | null = null;
        setDeals((list) =>
          list.map((d) => {
            if (d.id !== id) return d;
            updated = { ...d, ...patch };
            return updated;
          }),
        );
        if (updated && patch.stage) {
          const deal = updated as CrmDeal;
          const leadStatus = dealStageToLeadStatus(patch.stage);
          if (deal.leadId) {
            setLeads((list) =>
              list.map((l) => {
                if (l.id !== deal.leadId) return l;
                syncedLead = {
                  ...l,
                  status: leadStatus,
                  lostReason: patch.lostReason || l.lostReason,
                  updatedAt: new Date().toISOString(),
                  history: [
                    historyLine(userName, `Deal ${deal.id} → ${patch.stage}`),
                    ...(l.history || []),
                  ].slice(0, 40),
                };
                return syncedLead;
              }),
            );
          }
        }
        if (updated) {
          publishSnapshots({
            deals: [updated],
            leads: syncedLead ? [syncedLead] : [],
          });
        }
        return updated;
      },
      closeLeadLost: (leadId, reason, note) => {
        let updated: CrmLead | null = null;
        const now = new Date().toISOString();
        setLeads((list) =>
          list.map((l) => {
            if (l.id !== leadId) return l;
            updated = {
              ...l,
              status: 'Lost',
              lostReason: reason,
              updatedAt: now,
              history: [
                historyLine(userName, `Lost / Closed · ${reason}${note?.trim() ? ` · ${note.trim()}` : ''}`),
                ...(l.history || []),
              ].slice(0, 40),
            };
            return updated;
          }),
        );
        setDeals((list) =>
          list.map((d) => {
            if (d.stage === 'Won' || d.stage === 'Lost') return d;
            const linkedActivity = activities.find((a) => a.dealId === d.id || a.id === d.activityId);
            const match =
              d.leadId === leadId ||
              (linkedActivity && (linkedActivity.leadId === leadId || resolveLeadForActivity(leads, linkedActivity)?.id === leadId));
            return match ? { ...d, stage: 'Lost' as DealStage, lostReason: reason } : d;
          }),
        );
        return updated;
      },
      convertDealWon: (dealId, input) => {
        const deal = deals.find((d) => d.id === dealId);
        if (!deal) return null;
        const now = new Date().toISOString();
        const conversionId = input.conversionId.trim();
        if (!conversionId) return null;
        const closer = deal.owner || userName;
        const updated: CrmDeal = {
          ...deal,
          stage: 'Won',
          conversionId,
          conversionType: input.conversionType,
          convertedBy: deal.convertedBy || closer,
        };
        setDeals((list) => list.map((d) => (d.id === dealId ? updated : d)));
        if (deal.leadId) {
          setLeads((list) =>
            list.map((l) =>
              l.id === deal.leadId
                ? withConversionCredit(
                    {
                      ...l,
                      status: 'Won',
                      conversionId,
                      conversionType: input.conversionType,
                      convertedAt: now,
                      updatedAt: now,
                      history: [
                        historyLine(
                          userName,
                          `Won / Converted · ${input.conversionType} · ${conversionId}`,
                        ),
                        ...(l.history || []),
                      ].slice(0, 40),
                    },
                    closer,
                    now,
                  )
                : l,
            ),
          );
        }
        const bookingWing =
          input.conversionType === 'partner' || input.conversionType === 'lab'
            ? 'lab'
            : input.conversionType === 'franchise'
              ? 'franchise'
              : input.conversionType;
        if (bookingWing === 'aesthetic' || bookingWing === 'care' || bookingWing === 'lab' || bookingWing === 'franchise') {
          setBookings((list) => {
            const id = nextId('BK', list);
            const owner = deal.owner || userName;
            return [
              ensureBookingTracking({
                id,
                patient: deal.leadName || deal.title,
                mobile: leads.find((l) => l.id === deal.leadId)?.mobile || '',
                wing: bookingWing,
                service: input.service || deal.product || deal.title,
                branch: input.branch || 'Central Hub',
                date: now.slice(0, 10),
                time: '10:00',
                status: 'Scheduled',
                channel: input.conversionType === 'partner' ? 'Partner Portal' : 'CRM Telecaller',
                notes: formatCrmTagNote(makeTrackingTag(owner, id), `Converted from deal ${deal.id}`),
                externalId: conversionId,
                createdAt: now,
                owner,
                trackingTag: makeTrackingTag(owner, id),
                executive: owner,
                executiveCode: executiveCodeFromName(owner),
                salesStatus: 'Open',
              }),
              ...list,
            ];
          });
        }
        return updated;
      },
      createDealFromFollowUp: (activityId, input) => {
        const activity = activities.find((a) => a.id === activityId);
        if (!activity) return null;
        const title = input.title.trim();
        if (!title) return null;
        if (activity.dealId) {
          const existing = deals.find((d) => d.id === activity.dealId);
          if (existing) return existing;
        }
        const now = new Date().toISOString();
        const deal: CrmDeal = {
          id: nextId('DL', deals),
          title,
          leadId: activity.leadId,
          leadName: activity.leadName,
          activityId: activity.id,
          wing: activity.wing,
          stage: input.stage || 'Opportunity Created',
          value: Number.isFinite(input.value) ? Math.max(0, input.value) : 0,
          owner: activity.owner || userName,
          closeDate: input.closeDate || now.slice(0, 10),
          createdAt: now,
          product: input.product,
          probability: input.probability,
        };
        setDeals((list) => [deal, ...list]);
        setActivities((list) =>
          list.map((a) =>
            a.id !== activityId
              ? a
              : {
                  ...a,
                  dealId: deal.id,
                  leadStage: input.stage,
                  history: [
                    {
                      at: now,
                      type: a.type,
                      message: `Marked as Deal & Opportunity · ${deal.id} · ${input.stage} · ₹${deal.value.toLocaleString('en-IN')}`,
                      actor: userName,
                    },
                    ...(a.history || []),
                  ].slice(0, 40),
                },
          ),
        );
        const leadStatus = dealStageToLeadStatus(input.stage);
        if (activity.leadId) {
          setLeads((list) =>
            list.map((l) =>
              l.id !== activity.leadId
                ? l
                : {
                    ...l,
                    status: leadStatus,
                    value: deal.value || l.value,
                    updatedAt: now,
                    history: [
                      historyLine(userName, `Converted to deal ${deal.id} · ${input.stage}`),
                      ...(l.history || []),
                    ].slice(0, 40),
                  },
            ),
          );
        } else {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              activities,
              { leadName: activity.leadName, mobile: activity.mobile },
              userName,
              `Converted to deal ${deal.id} · ${input.stage}`,
            ).map((l) =>
              l.name === activity.leadName && (!activity.mobile || l.mobile === activity.mobile)
                ? { ...l, status: leadStatus, value: deal.value || l.value }
                : l,
            ),
          );
        }
        return deal;
      },
      refreshCrmTeam: async () => {
        try {
          const users = await listCrmPortalAssignees();
          const next = users.map(assigneeToTeamMember);
          setTeam(next);
          return next;
        } catch (err) {
          pushToast(err instanceof Error ? err.message : 'Could not load CRM team from HR', 'err');
          return team;
        }
      },
      applyOwnershipMap,
      transferOwnership: async (input) => {
        if (!detectManager(userName, team)) {
          pushToast('Only CRM Managers can transfer leads', 'err');
          return null;
        }
        const fromOwner = input.fromOwner.trim();
        const toOwner = input.toOwner.trim();
        const note = input.note?.trim() || '';
        if (!fromOwner || !toOwner || fromOwner === toOwner) return null;
        if (!note) {
          pushToast('Transfer remarks are required', 'err');
          return null;
        }
        const now = new Date().toISOString();
        const msg = `Transferred ${fromOwner} → ${toOwner} · ${note}`;

        let moveLeads = input.scope === 'leads' || input.scope === 'both';
        const moveFollowups = input.scope === 'followups' || input.scope === 'both';

        const leadIdSet = new Set(
          moveLeads
            ? input.leadIds?.length
              ? input.leadIds
              : leads.filter((l) => l.owner === fromOwner).map((l) => l.id)
            : input.leadIds?.length
              ? input.leadIds
              : [],
        );
        /* Follow-up row selection may include completed FUs — still transfer their linked leads. */
        if (input.activityIds?.length) {
          for (const id of input.activityIds) {
            const a = activities.find((x) => x.id === id);
            const lid = a?.leadId?.trim();
            if (lid) leadIdSet.add(lid);
          }
          if (leadIdSet.size) moveLeads = true;
        }

        /* Only pending (not completed) follow-ups move with the lead. */
        const activityIdSet = new Set<string>();
        const pendingOf = (a: (typeof activities)[0]) => !a.done;
        if (moveFollowups) {
          if (input.activityIds?.length) {
            for (const id of input.activityIds) {
              const a = activities.find((x) => x.id === id);
              if (a && pendingOf(a)) activityIdSet.add(id);
            }
            /* Also move other pending FUs for the linked leads being transferred. */
            if (moveLeads && leadIdSet.size) {
              for (const a of activities) {
                if (pendingOf(a) && a.leadId && leadIdSet.has(a.leadId)) activityIdSet.add(a.id);
              }
            }
          } else {
            for (const a of activities) {
              if (!pendingOf(a)) continue;
              if (input.leadIds?.length || leadIdSet.size) {
                /* Specific lead selection — only their pending follow-ups. */
                if (a.leadId && leadIdSet.has(a.leadId)) activityIdSet.add(a.id);
              } else if (a.owner === fromOwner) {
                activityIdSet.add(a.id);
              }
            }
          }
        } else if (moveLeads) {
          for (const a of activities) {
            if (pendingOf(a) && a.leadId && leadIdSet.has(a.leadId)) activityIdSet.add(a.id);
          }
        }

        if (!leadIdSet.size && !activityIdSet.size) {
          pushToast('Select at least one lead or open follow-up to transfer', 'err');
          return null;
        }

        const dealIds: string[] = [];
        const contactIds: string[] = [];
        if (moveLeads && leadIdSet.size) {
          for (const d of deals) {
            /* Won deals stay with the closer — conversion credit must not move. */
            if (d.stage === 'Won') continue;
            if (d.leadId && leadIdSet.has(d.leadId)) dealIds.push(d.id);
            else if (!d.leadId && d.owner === fromOwner && !input.leadIds?.length) dealIds.push(d.id);
          }
          for (const c of contacts) {
            const linked = leads.find((l) => leadIdSet.has(l.id) && l.name === c.name && l.mobile === c.mobile);
            if (linked) contactIds.push(c.id);
          }
        }

        const leadMeta = [...leadIdSet].map((id) => {
          const lead = leads.find((l) => l.id === id);
          const followup_ids = activities
            .filter((a) => a.leadId === id && activityIdSet.has(a.id))
            .map((a) => a.id);
          return { id, name: lead?.name || id, followup_ids };
        });

        const snapshotLeads = leads
          .filter((l) => leadIdSet.has(l.id))
          .map((l) => {
            const convertedBy =
              l.status === 'Won' ? l.convertedBy?.trim() || fromOwner : l.convertedBy;
            return { ...l, owner: toOwner, ownerInitials: initials(toOwner), convertedBy };
          });
        const snapshotActs = activities
          .filter((a) => activityIdSet.has(a.id))
          .map((a) => ({ ...a, owner: toOwner }));
        const snapshotDeals = deals
          .filter((d) => dealIds.includes(d.id))
          .map((d) => ({ ...d, owner: toOwner }));
        const snapshotContacts = contacts
          .filter((c) => contactIds.includes(c.id))
          .map((c) => ({ ...c, owner: toOwner }));

        /* Persist first so every CRM login sees the new owner + lead payloads + history. */
        try {
          const remote = await transferCrmOwnership({
            fromOwner,
            toOwner,
            leadIds: [...leadIdSet],
            activityIds: [...activityIdSet],
            dealIds,
            contactIds,
            note,
            leadMeta,
            transferredByName: userName,
            snapshots: {
              leads: snapshotLeads as unknown as Record<string, unknown>[],
              activities: snapshotActs as unknown as Record<string, unknown>[],
              deals: snapshotDeals as unknown as Record<string, unknown>[],
              contacts: snapshotContacts as unknown as Record<string, unknown>[],
            },
          });
          if (remote?.ownership) applyOwnershipMap(remote.ownership);
        } catch (err) {
          pushToast(err instanceof Error ? err.message : 'Could not sync ownership to server', 'err');
          return null;
        }

        const leadsMoved = moveLeads ? leadIdSet.size : 0;
        const followupsMoved = activityIdSet.size;
        let dealsMoved = 0;

        if (moveLeads && leadIdSet.size) {
          setLeads((list) =>
            list.map((l) =>
              leadIdSet.has(l.id)
                ? {
                    ...l,
                    owner: toOwner,
                    ownerInitials: initials(toOwner),
                    /* Conversion credit stays with the closer (fromOwner if already Won). */
                    convertedBy:
                      l.status === 'Won' ? l.convertedBy?.trim() || fromOwner : l.convertedBy,
                    updatedAt: now,
                    history: [historyLine(userName, msg), ...(l.history || [])].slice(0, 40),
                    transferHistory: [
                      {
                        id: `local-${now}-${l.id}`,
                        previousOwner: fromOwner,
                        newOwner: toOwner,
                        transferredBy: userName,
                        transferredAt: now,
                        remarks: note,
                        followupsMoved: activities.filter((a) => a.leadId === l.id && activityIdSet.has(a.id)).length,
                      },
                      ...(l.transferHistory || []),
                    ].slice(0, 40),
                  }
                : l,
            ),
          );
          setContacts((list) =>
            list.map((c) => {
              const linked = leads.find((l) => leadIdSet.has(l.id) && l.name === c.name && l.mobile === c.mobile);
              return linked ? { ...c, owner: toOwner } : c;
            }),
          );
          setDeals((list) =>
            list.map((d) => {
              if (d.stage === 'Won') {
                /* Keep Won deal with closer; stamp convertedBy if missing. */
                return d.convertedBy ? d : { ...d, convertedBy: d.owner };
              }
              if (d.leadId && leadIdSet.has(d.leadId)) {
                dealsMoved += 1;
                return { ...d, owner: toOwner };
              }
              if (!d.leadId && d.owner === fromOwner && !input.leadIds?.length) {
                dealsMoved += 1;
                return { ...d, owner: toOwner };
              }
              return d;
            }),
          );
        }

        if (activityIdSet.size) {
          setActivities((list) =>
            list.map((a) =>
              activityIdSet.has(a.id)
                ? {
                    ...a,
                    owner: toOwner,
                    history: [
                      { at: now, type: a.type, message: msg, actor: userName },
                      ...(a.history || []),
                    ].slice(0, 40),
                  }
                : a,
            ),
          );
        }

        refreshTransferHistory().catch(() => undefined);
        refreshTransferNotices().catch(() => undefined);

        return { leads: leadsMoved, followups: followupsMoved, deals: dealsMoved };
      },
    }),
    [
      scopedLeads,
      reportLeads,
      scopedContacts,
      accounts,
      scopedDeals,
      scopedActivities,
      scopedBookings,
      campaigns,
      wingFilter,
      toasts,
      userName,
      team,
      isManager,
      userRoleLabel,
      transferNotices,
      transferNoticeUnread,
      leads,
      contacts,
      deals,
      activities,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCrm outside provider');
  return ctx;
}
