export const WINGS = [
  { id: 'lab', name: 'Remedium Lab', short: 'Lab', color: '#16a34a', tone: 'lab' },
  { id: 'aesthetic', name: 'Remedium Aesthetic', short: 'Aesthetic', color: '#db2777', tone: 'aesthetic' },
  { id: 'care', name: 'Remedium Care', short: 'Care', color: '#2563eb', tone: 'care' },
  { id: 'nexilab', name: 'NexiLab', short: 'NexiLab', color: '#7c3aed', tone: 'nexilab' },
  { id: 'franchise', name: 'Franchise', short: 'Franchise', color: '#0ea5e9', tone: 'franchise' },
] as const;

export type WingId = (typeof WINGS)[number]['id'];

/** Franchise lead → which Remedium brand (stored as franchiseVertical). */
export const FRANCHISE_VERTICALS = [
  { id: 'lab', label: 'Remedium Lab' },
  { id: 'care', label: 'Remedium Care' },
  { id: 'aesthetic', label: 'Remedium Aesthetic' },
] as const;

export type FranchiseVerticalId = (typeof FRANCHISE_VERTICALS)[number]['id'];

export function franchiseVerticalLabel(id?: string | null) {
  const hit = FRANCHISE_VERTICALS.find((v) => v.id === id);
  return hit?.label || '';
}

export function wingById(id: WingId | string) {
  return WINGS.find((w) => w.id === id) ?? WINGS[0];
}

/**
 * Conversion credit owner for a Won lead.
 * Prefer convertedBy; else infer from transfer history (credit stays with pre-transfer owner).
 */
export function leadConversionCredit(lead: {
  status?: string;
  owner: string;
  convertedBy?: string;
  convertedAt?: string;
  transferHistory?: Array<{ previousOwner: string; transferredAt: string }>;
}) {
  if (lead.convertedBy?.trim()) return lead.convertedBy.trim();
  if (lead.status !== 'Won') return lead.owner;
  const hist = lead.transferHistory || [];
  if (hist.length) {
    const chronological = [...hist].reverse();
    if (lead.convertedAt) {
      const firstAfter = chronological.find((h) => h.transferredAt >= lead.convertedAt!);
      if (firstAfter?.previousOwner?.trim()) return firstAfter.previousOwner.trim();
    }
    const oldest = chronological[0];
    if (oldest?.previousOwner?.trim()) return oldest.previousOwner.trim();
  }
  return lead.owner;
}

/** Lead → Follow-up → Deal → Conversion → Closure */
export const LEAD_STATUSES = [
  'New',
  'Contacted',
  'Connected',
  'Not Reachable',
  'Interested',
  'Not Interested',
  'Qualified',
  'Proposal Required',
  'Discussion Ongoing',
  'Ready to Proceed',
  'Won',
  'Lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PIPELINE = [
  'New',
  'Contacted',
  'Interested',
  'Qualified',
  'Proposal Required',
  'Ready to Proceed',
  'Won',
] as const satisfies readonly LeadStatus[];

export type LeadPipelineStage = (typeof LEAD_PIPELINE)[number];

/** Related statuses selectable from each funnel stage dropdown. */
export const LEAD_PIPELINE_GROUPS: Record<LeadPipelineStage, LeadStatus[]> = {
  New: ['New'],
  Contacted: ['Contacted', 'Connected', 'Not Reachable'],
  Interested: ['Interested', 'Not Interested'],
  Qualified: ['Qualified'],
  'Proposal Required': ['Proposal Required', 'Discussion Ongoing'],
  'Ready to Proceed': ['Ready to Proceed'],
  Won: ['Won', 'Lost'],
};

export const LEAD_SOURCES = [
  'Meta Ads',
  'Website',
  'Referral',
  'Walk-in',
  'Telecaller',
  'Partner',
  'Reach',
  'Field Marketing',
  'CSV Import',
  'Portal',
  'Google Ads',
  'WhatsApp',
  'Google Sheets',
  'Offline Camp',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LOST_REASONS = [
  'Budget issue',
  'Competitor selected',
  'Not interested',
  'Invalid contact',
  'Location unavailable',
  'Investment not feasible',
  'No response after defined attempts',
  'Other',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const FOLLOW_UP_OUTCOMES = [
  'Interested',
  'Discussion ongoing',
  'Proposal required',
  'Not reachable',
  'Not interested',
  'Ready to proceed',
] as const;
export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];

export type LeadHistoryEntry = {
  at: string;
  actor: string;
  message: string;
};

export type CrmLead = {
  id: string;
  name: string;
  mobile: string;
  email: string;
  wing: WingId;
  source: LeadSource | string;
  status: LeadStatus;
  owner: string;
  ownerInitials: string;
  city?: string;
  notes?: string;
  value?: number;
  createdAt: string;
  updatedAt?: string;
  nextFollowUp?: string;
  franchiseModel?: 'FOFO' | 'FOCO' | 'Other' | '';
  /** Which franchise brand: Remedium Lab / Care / Aesthetic (Franchise wing only). */
  franchiseVertical?: 'aesthetic' | 'care' | 'lab';
  /** Meta / franchise survey: own_shop | rental_shop */
  propertyOwnership?: string;
  /** Meta / franchise survey: e.g. 2,00,000 */
  investmentCapacity?: string;
  /** Meta / franchise survey: e.g. 15_days, 6_month */
  timeline?: string;
  territory?: string;
  /** Franchise applicant geo + contact extras */
  alternateMobile?: string;
  state?: string;
  district?: string;
  subdivision?: string;
  village?: string;
  pinCode?: string;
  preferredLocation?: string;
  googleMapUrl?: string;
  rfmsLeadId?: string;
  /** Patient / service enquiry */
  serviceRequired?: string;
  preferredBranch?: string;
  budget?: string;
  appointmentPreference?: string;
  lostReason?: LostReason | string;
  conversionId?: string;
  conversionType?: 'aesthetic' | 'care' | 'lab' | 'franchise' | 'partner';
  convertedAt?: string;
  /**
   * Who earned the conversion — frozen at Won time.
   * Lead ownership may transfer later; conversion credit stays with this person.
   */
  convertedBy?: string;
  /** REACH Franchise Sales Lead name after CRM → Reach assign */
  reachLeadId?: string;
  reachRepId?: string;
  reachRepName?: string;
  reachVisitId?: string;
  reachAssignedAt?: string;
  history?: LeadHistoryEntry[];
  /** Server-backed ownership transfer log (newest first). */
  transferHistory?: LeadTransferRecord[];
  /** Campaign attribution (Google Sheets / ads sync) */
  campaignId?: string;
  campaignName?: string;
  /** Stable Google Sheet row reference — never delete CRM lead if sheet row is removed */
  sheetRowRef?: string;
  sheetKey?: string;
};

export type LeadTransferRecord = {
  id: string;
  previousOwner: string;
  newOwner: string;
  transferredBy: string;
  transferredAt: string;
  remarks: string;
  followupsMoved: number;
};

export type CrmContact = {
  id: string;
  name: string;
  mobile: string;
  email: string;
  wing: WingId;
  account?: string;
  role?: string;
  owner: string;
};

export type CrmAccount = {
  id: string;
  name: string;
  wing: WingId;
  type: 'Patient' | 'Clinic' | 'Franchise' | 'Partner' | 'Corporate';
  city: string;
  contacts: number;
  deals: number;
  owner: string;
};

export const DEAL_STAGES = [
  'Opportunity Created',
  'Discussion',
  'Proposal Shared',
  'Negotiation',
  'Approval',
  'Ready for Conversion',
  'Won',
  'Lost',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export type CrmDeal = {
  id: string;
  title: string;
  leadId?: string;
  leadName?: string;
  activityId?: string;
  /** Linked Care / Aesthetic / Lab / Partner booking when conversion starts */
  bookingId?: string;
  wing: WingId;
  stage: DealStage;
  value: number;
  owner: string;
  closeDate: string;
  createdAt?: string;
  product?: string;
  probability?: number;
  lostReason?: LostReason | string;
  conversionId?: string;
  conversionType?: 'aesthetic' | 'care' | 'lab' | 'franchise' | 'partner';
  /** Who closed the deal — does not change when the linked lead is transferred. */
  convertedBy?: string;
};

export const FOLLOW_UP_TYPES = [
  'Call',
  'WhatsApp',
  'Meeting',
  'Site Visit',
  'Email',
  'Video Meeting',
  'Follow-up',
] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export type FollowUpHistoryEntry = {
  at: string;
  type: string;
  message: string;
  actor: string;
};

export type CrmActivity = {
  id: string;
  type: FollowUpType | 'Booking' | 'Franchise';
  title: string;
  leadName: string;
  leadId?: string;
  mobile?: string;
  wing: WingId;
  branch?: string;
  dueAt: string;
  done: boolean;
  completedAt?: string;
  owner: string;
  notes?: string;
  leadStage?: string;
  dealId?: string;
  outcome?: FollowUpOutcome | string;
  expectedOutcome?: string;
  history?: FollowUpHistoryEntry[];
};

export function normalizeLeadStatus(raw: string): LeadStatus {
  const map: Record<string, LeadStatus> = {
    Proposal: 'Proposal Required',
    Negotiation: 'Discussion Ongoing',
    'Won / Converted': 'Won',
    'Lost / Closed': 'Lost',
  };
  if ((LEAD_STATUSES as readonly string[]).includes(raw)) return raw as LeadStatus;
  return map[raw] || 'New';
}

export function normalizeDealStage(raw: string): DealStage {
  const map: Record<string, DealStage> = {
    Qualification: 'Opportunity Created',
    Proposal: 'Proposal Shared',
    'Approval / Confirmation': 'Approval',
  };
  if ((DEAL_STAGES as readonly string[]).includes(raw)) return raw as DealStage;
  return map[raw] || 'Opportunity Created';
}

export function outcomeToLeadStatus(outcome: FollowUpOutcome | string): LeadStatus | null {
  switch (outcome) {
    case 'Interested':
      return 'Interested';
    case 'Discussion ongoing':
      return 'Discussion Ongoing';
    case 'Proposal required':
      return 'Proposal Required';
    case 'Not reachable':
      return 'Not Reachable';
    case 'Not interested':
      return 'Not Interested';
    case 'Ready to proceed':
      return 'Ready to Proceed';
    default:
      return null;
  }
}

export function dealStageToLeadStatus(stage: DealStage): LeadStatus {
  if (stage === 'Opportunity Created' || stage === 'Discussion') return 'Discussion Ongoing';
  if (stage === 'Proposal Shared') return 'Proposal Required';
  if (stage === 'Negotiation' || stage === 'Approval') return 'Discussion Ongoing';
  if (stage === 'Ready for Conversion') return 'Ready to Proceed';
  if (stage === 'Won') return 'Won';
  if (stage === 'Lost') return 'Lost';
  return 'Qualified';
}

/** Follow-up / lead status → open deal stage. Won is owned by portal billing (null). */
export function leadStatusToDealStage(status: LeadStatus | string): DealStage | null {
  const s = normalizeLeadStatus(String(status || ''));
  switch (s) {
    case 'New':
    case 'Contacted':
    case 'Connected':
    case 'Qualified':
      return 'Opportunity Created';
    case 'Interested':
    case 'Discussion Ongoing':
      return 'Discussion';
    case 'Proposal Required':
      return 'Proposal Shared';
    case 'Ready to Proceed':
      return 'Ready for Conversion';
    case 'Not Interested':
    case 'Lost':
      return 'Lost';
    case 'Won':
      return null;
    case 'Not Reachable':
      return null;
    default:
      return null;
  }
}

export function outcomeToDealStage(outcome: FollowUpOutcome | string): DealStage | null {
  const lead = outcomeToLeadStatus(outcome);
  return lead ? leadStatusToDealStage(lead) : null;
}

export function conversionTypeFromWing(
  wing: string | undefined,
  portal?: string | null,
): CrmDeal['conversionType'] {
  const p = String(portal || wing || '').toLowerCase();
  if (p.includes('partner')) return 'partner';
  if (p.includes('franchise') || p === 'ffms' || p === 'rfms') return 'franchise';
  if (p.includes('aes') || p === 'aesthetic') return 'aesthetic';
  if (p.includes('care')) return 'care';
  if (p.includes('lab')) return 'lab';
  if (wing === 'aesthetic' || wing === 'care' || wing === 'lab' || wing === 'franchise') return wing;
  return 'lab';
}

export type CrmSalesStatus = 'Open' | 'Billed' | 'Closed';

export type CrmBooking = {
  id: string;
  patient: string;
  mobile: string;
  wing: 'aesthetic' | 'care' | 'lab' | 'franchise';
  service: string;
  branch: string;
  franchiseUnit?: string;
  date: string;
  time: string;
  status: 'Scheduled' | 'Confirmed' | 'Completed' | 'Cancelled';
  channel: 'CRM Telecaller' | 'Partner Portal' | 'Walk-in';
  notes?: string;
  externalId?: string;
  createdAt: string;
  owner: string;
  /** Required closer tag stamped into Care / Aesthetic / lab bills */
  trackingTag: string;
  executive: string;
  executiveCode: string;
  salesStatus?: CrmSalesStatus;
  billedAmount?: number;
  billRef?: string;
  billPortal?: 'care' | 'aesthetic' | 'lab' | 'franchise' | 'crm';
  closedAt?: string;
};

/** Executive code from display name — Snehasish Ganguly → SG */
export function executiveCodeFromName(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'XX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** CRM-SG-BK0007 — unique per booking, searchable in portal bills */
export function makeTrackingTag(executiveName: string, bookingId: string) {
  const code = executiveCodeFromName(executiveName);
  const bk = (bookingId || 'BK-0000').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `CRM-${code}-${bk}`;
}

export function formatCrmTagNote(tag: string, extra?: string) {
  const base = `[CRM_TAG:${tag}]`;
  return extra?.trim() ? `${base} ${extra.trim()}` : base;
}

export function parseCrmTag(text?: string) {
  const m = String(text || '').match(/\[CRM_TAG:(CRM-[A-Z0-9-]+)\]/i) || String(text || '').match(/(CRM-[A-Z0-9]{2,6}-[A-Z0-9-]{3,24})/i);
  return m ? m[1].toUpperCase() : '';
}

export type CrmCampaign = {
  id: string;
  name: string;
  channel: 'Meta Ads' | 'Google Ads' | 'WhatsApp' | 'Referral';
  wing: WingId;
  spend: number;
  leads: number;
  cpl: number;
  roi: number;
};

export function formatNumber(value: number) {
  return value.toLocaleString('en-IN');
}

export function formatINR(value: number) {
  return `₹${value.toLocaleString('en-IN')}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export function nextId(prefix: string, existing: { id: string }[]) {
  const n = existing.length + 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export type CrmTeamRole = 'manager' | 'staff';

export type CrmTeamMember = {
  id: string;
  name: string;
  email?: string;
  role: CrmTeamRole;
  active: boolean;
};

export const SAMPLE_TEAM: CrmTeamMember[] = [
  { id: 'TM-0001', name: 'Snehasish Ganguly', email: 'snehasish@smilecure.in', role: 'manager', active: true },
  { id: 'TM-0002', name: 'Priya Sen', email: 'priya@smilecure.in', role: 'staff', active: true },
  { id: 'TM-0003', name: 'Rahul Dutta', email: 'rahul@smilecure.in', role: 'staff', active: true },
];

export const SAMPLE_LEADS: CrmLead[] = [
  {
    id: 'LD-0001',
    name: 'Riya Das',
    mobile: '9876543210',
    email: 'riya.das@example.com',
    wing: 'aesthetic',
    source: 'Meta Ads',
    status: 'Qualified',
    owner: 'Snehasish Ganguly',
    ownerInitials: 'SG',
    city: 'Barasat',
    value: 45000,
    createdAt: '2026-10-12T09:20:00+05:30',
    nextFollowUp: '2026-11-20T11:30:00+05:30',
  },
  {
    id: 'LD-0002',
    name: 'Amit Ghosh',
    mobile: '9830011223',
    email: 'amit.ghosh@example.com',
    wing: 'lab',
    source: 'Website',
    status: 'Proposal Required',
    owner: 'Priya Sen',
    ownerInitials: 'PS',
    city: 'Kolkata',
    value: 18500,
    createdAt: '2026-10-14T11:05:00+05:30',
  },
  {
    id: 'LD-0003',
    name: 'Meera Banerjee',
    mobile: '9007123456',
    email: 'meera.b@example.com',
    wing: 'care',
    source: 'Referral',
    status: 'Discussion Ongoing',
    owner: 'Rahul Dutta',
    ownerInitials: 'RD',
    city: 'Hasnabad',
    value: 22000,
    serviceRequired: 'Physiotherapy — knee pain',
    preferredBranch: 'Hasnabad',
    createdAt: '2026-10-18T16:40:00+05:30',
  },
  {
    id: 'LD-0004',
    name: 'Subhash Biswas',
    mobile: '9123456780',
    email: 'subhash.biswas@example.com',
    wing: 'franchise',
    source: 'Telecaller',
    status: 'Qualified',
    owner: 'Snehasish Ganguly',
    ownerInitials: 'SG',
    city: 'Bongaon',
    franchiseModel: 'FOFO',
    franchiseVertical: 'care',
    territory: 'North 24 Parganas',
    alternateMobile: '9123456781',
    state: 'West Bengal',
    district: 'North 24 Parganas',
    subdivision: 'Bangaon',
    village: 'Bongaon',
    pinCode: '743235',
    preferredLocation: 'Near Bongaon bus stand, North 24 Parganas',
    googleMapUrl: 'https://maps.google.com/?q=Bongaon,West+Bengal',
    value: 550000,
    createdAt: '2026-10-20T10:15:00+05:30',
    nextFollowUp: '2026-11-20T14:00:00+05:30',
  },
  {
    id: 'LD-0005',
    name: 'Nisha Roy',
    mobile: '9800123456',
    email: 'nisha.roy@example.com',
    wing: 'nexilab',
    source: 'Website',
    status: 'New',
    owner: 'Priya Sen',
    ownerInitials: 'PS',
    city: 'Howrah',
    createdAt: '2026-10-28T13:22:00+05:30',
  },
];

export const SAMPLE_CONTACTS: CrmContact[] = [
  { id: 'CT-0001', name: 'Riya Das', mobile: '9876543210', email: 'riya.das@example.com', wing: 'aesthetic', account: 'Riya Das', role: 'Patient', owner: 'Snehasish Ganguly' },
  { id: 'CT-0002', name: 'Dr. Ananya Mukherjee', mobile: '9831122334', email: 'ananya.m@clinic.in', wing: 'lab', account: 'Mukherjee Clinic', role: 'Referring Doctor', owner: 'Priya Sen' },
  { id: 'CT-0003', name: 'Subhash Biswas', mobile: '9123456780', email: 'subhash.biswas@example.com', wing: 'franchise', account: 'Biswas FOFO Hub', role: 'Franchise Applicant', owner: 'Snehasish Ganguly' },
];

export const SAMPLE_ACCOUNTS: CrmAccount[] = [
  { id: 'AC-0001', name: 'Mukherjee Clinic', wing: 'lab', type: 'Clinic', city: 'Kolkata', contacts: 2, deals: 3, owner: 'Priya Sen' },
  { id: 'AC-0002', name: 'Biswas FOFO Hub', wing: 'franchise', type: 'Franchise', city: 'Bongaon', contacts: 1, deals: 1, owner: 'Snehasish Ganguly' },
  { id: 'AC-0003', name: 'Hasnabad Care Walk-ins', wing: 'care', type: 'Patient', city: 'Hasnabad', contacts: 48, deals: 12, owner: 'Rahul Dutta' },
];

export const SAMPLE_DEALS: CrmDeal[] = [
  {
    id: 'DL-0001',
    title: 'HydraFacial package — Riya Das',
    leadId: 'LD-0001',
    leadName: 'Riya Das',
    wing: 'aesthetic',
    stage: 'Negotiation',
    value: 45000,
    owner: 'Snehasish Ganguly',
    closeDate: '2026-11-25',
    product: 'HydraFacial package',
    probability: 70,
  },
  {
    id: 'DL-0002',
    title: 'Corporate health package — Mukherjee Clinic',
    leadId: 'LD-0002',
    leadName: 'Amit Ghosh',
    wing: 'lab',
    stage: 'Proposal Shared',
    value: 18500,
    owner: 'Priya Sen',
    closeDate: '2026-11-30',
    product: 'Corporate health package',
    probability: 55,
  },
  {
    id: 'DL-0003',
    title: 'FOFO franchise — Subhash Biswas',
    leadId: 'LD-0004',
    leadName: 'Subhash Biswas',
    wing: 'franchise',
    stage: 'Opportunity Created',
    value: 550000,
    owner: 'Snehasish Ganguly',
    closeDate: '2026-12-15',
    product: 'FOFO',
    probability: 40,
  },
];

export const SAMPLE_ACTIVITIES: CrmActivity[] = [
  {
    id: 'ACT-0001',
    type: 'Call',
    title: 'Call back — Riya Das',
    leadName: 'Riya Das',
    leadId: 'LD-0001',
    mobile: '9876543210',
    wing: 'aesthetic',
    branch: 'Barasat',
    dueAt: '2026-11-20T11:30:00+05:30',
    done: false,
    owner: 'Snehasish Ganguly',
    leadStage: 'Qualified',
    notes: 'Interested in HydraFacial package. Asked for EMI option.',
    history: [
      { at: '2026-11-18T16:40:00+05:30', type: 'Call', message: 'Initial discussion. Shared package details.', actor: 'Snehasish Ganguly' },
      { at: '2026-11-15T11:05:00+05:30', type: 'WhatsApp', message: 'Sent brochure and clinic address.', actor: 'Snehasish Ganguly' },
    ],
  },
  {
    id: 'ACT-0002',
    type: 'Follow-up',
    title: 'Follow up for franchise — Subhash Biswas',
    leadName: 'Subhash Biswas',
    leadId: 'LD-0004',
    mobile: '9123456780',
    wing: 'franchise',
    branch: 'Bongaon',
    dueAt: '2026-11-20T14:00:00+05:30',
    done: false,
    owner: 'Snehasish Ganguly',
    leadStage: 'Qualified',
    notes: 'FOFO interest · North 24 Parganas territory.',
    history: [{ at: '2026-11-19T10:15:00+05:30', type: 'Call', message: 'Discussed FOFO investment band.', actor: 'Snehasish Ganguly' }],
  },
  {
    id: 'ACT-0003',
    type: 'WhatsApp',
    title: 'Send Care physio brochure — Meera Banerjee',
    leadName: 'Meera Banerjee',
    leadId: 'LD-0003',
    mobile: '9007123456',
    wing: 'care',
    branch: 'Hasnabad',
    dueAt: '2026-11-20T16:00:00+05:30',
    done: false,
    owner: 'Rahul Dutta',
    leadStage: 'Discussion Ongoing',
    notes: 'Needs physio plan quote for knee pain.',
  },
  {
    id: 'ACT-0004',
    type: 'Meeting',
    title: 'NexiLab demo call — Nisha Roy',
    leadName: 'Nisha Roy',
    leadId: 'LD-0005',
    mobile: '9800123456',
    wing: 'nexilab',
    dueAt: '2026-11-21T10:00:00+05:30',
    done: false,
    owner: 'Priya Sen',
    leadStage: 'New',
    notes: 'Demo of NexiLab partner console.',
  },
  {
    id: 'ACT-0005',
    type: 'Call',
    title: 'Overdue call — Amit Ghosh',
    leadName: 'Amit Ghosh',
    leadId: 'LD-0002',
    mobile: '9830011223',
    wing: 'lab',
    branch: 'Central Hub',
    dueAt: '2026-11-19T12:00:00+05:30',
    done: false,
    owner: 'Priya Sen',
    leadStage: 'Proposal',
    notes: 'Corporate package proposal pending reply.',
    history: [{ at: '2026-11-14T11:05:00+05:30', type: 'Email', message: 'Sent corporate health package proposal.', actor: 'Priya Sen' }],
  },
  {
    id: 'ACT-0006',
    type: 'Site Visit',
    title: 'Site visit — Surajit Dey',
    leadName: 'Surajit Dey',
    leadId: 'LD-0007',
    mobile: '9876501234',
    wing: 'aesthetic',
    branch: 'Bongaon',
    dueAt: '2026-11-20T17:30:00+05:30',
    done: false,
    owner: 'Ritesh Kumar',
    leadStage: 'Qualified',
    notes: 'Wants hair PRP consult at Bongaon Aesthetic.',
    history: [
      { at: '2026-11-18T14:10:00+05:30', type: 'Call', message: 'Initial discussion. Shared service details.', actor: 'Ritesh Kumar' },
      { at: '2026-11-17T09:40:00+05:30', type: 'WhatsApp', message: 'Shared Google Maps pin for Bongaon clinic.', actor: 'Ritesh Kumar' },
    ],
  },
  {
    id: 'ACT-0007',
    type: 'Call',
    title: 'Completed intro call — Walk-in lead',
    leadName: 'Ananya Bose',
    leadId: 'LD-0008',
    mobile: '9811122233',
    wing: 'care',
    branch: 'Ashoknagar',
    dueAt: '2026-11-10T11:00:00+05:30',
    done: true,
    completedAt: '2026-11-10T11:25:00+05:30',
    owner: 'Rahul Dutta',
    leadStage: 'Won',
    notes: 'Booked consultation successfully.',
    history: [{ at: '2026-11-10T11:25:00+05:30', type: 'Call', message: 'Completed — consultation booked.', actor: 'Rahul Dutta' }],
  },
];

/** Demo-only seeds — never use Care/Aesthetic rows here (they never hit the live portals). */
export const SAMPLE_BOOKINGS: CrmBooking[] = [];

/** Legacy localStorage demo IDs that looked like portal bookings but were never created in Care/Aesthetic. */
export const DEMO_PORTAL_BOOKING_IDS = new Set(['BK-0001', 'BK-0002']);

export const SAMPLE_CAMPAIGNS: CrmCampaign[] = [
  { id: 'CP-0001', name: 'Meta Ads — Aesthetic Q4', channel: 'Meta Ads', wing: 'aesthetic', spend: 124500, leads: 842, cpl: 148, roi: 20.1 },
  { id: 'CP-0002', name: 'Care pain relief — WhatsApp', channel: 'WhatsApp', wing: 'care', spend: 42000, leads: 310, cpl: 135, roi: 8.4 },
  { id: 'CP-0003', name: 'Franchise FOFO North 24P', channel: 'Meta Ads', wing: 'franchise', spend: 86000, leads: 96, cpl: 896, roi: 6.2 },
];

/* Fallback labels only — booking modal loads live lists from Care / Aesthetic APIs. */
export const AESTHETIC_BRANCHES = ['Bongaon', 'Barasat'];
export const CARE_BRANCHES = ['Ashoknagar', 'Hasnabad'];

export type WingUnit = {
  id: string;
  name: string;
  city: string;
  address: string;
  model?: string;
  code?: string;
};

/** Aesthetic clinic branches (fallback when /aes-api is offline). */
export const AESTHETIC_BRANCH_UNITS: WingUnit[] = [
  { id: 'AES-BGN', name: 'Bongaon', city: 'Bongaon', address: 'Bongaon, North 24 Parganas, West Bengal', code: 'BGN' },
  { id: 'AES-BRS', name: 'Barasat', city: 'Barasat', address: 'Barasat, North 24 Parganas, West Bengal', code: 'BRS' },
];

/** Care clinic branches (fallback when /care-api is offline). */
export const CARE_BRANCH_UNITS: WingUnit[] = [
  { id: 'CARE-ASK', name: 'Ashoknagar', city: 'Ashoknagar', address: 'Ashoknagar, North 24 Parganas, West Bengal', code: 'ASK' },
  { id: 'CARE-HAS', name: 'Hasnabad', city: 'Hasnabad', address: 'Hasnabad, North 24 Parganas, West Bengal', code: 'HAS' },
];

/** Lab wing — franchise / partner collection units. */
export const FRANCHISE_UNITS: WingUnit[] = [
  {
    id: 'FR-BON',
    name: 'Biswas FOFO Hub',
    city: 'Bongaon',
    model: 'FOFO',
    address: 'Biswas FOFO Hub, Bongaon, North 24 Parganas, West Bengal',
  },
  {
    id: 'FR-BAR',
    name: 'Barasat Vector Centre',
    city: 'Barasat',
    model: 'FOCO',
    address: 'Barasat Vector Centre, Barasat, North 24 Parganas, West Bengal',
  },
  {
    id: 'FR-HAS',
    name: 'Hasnabad Collection Point',
    city: 'Hasnabad',
    model: 'FOFO',
    address: 'Hasnabad Collection Point, Hasnabad, North 24 Parganas, West Bengal',
  },
];

export const TIMELINE_SAMPLE = [
  { at: '12 Oct · 09:20', title: 'Lead Created', detail: 'Meta Ads — Aesthetic enquiry' },
  { at: '13 Oct · 11:05', title: 'First Call', detail: 'Interested in HydraFacial package' },
  { at: '15 Oct · 16:40', title: 'Qualified', detail: 'Budget confirmed · Barasat branch' },
  { at: '18 Oct · 10:15', title: 'Proposal Sent', detail: 'Package quote ₹45,000' },
  { at: '20 Oct · 14:00', title: 'Negotiation', detail: 'Asked for EMI option' },
];
