import type { ProviderCategory } from './admin-types';

export type ProviderPresence = 'OFFLINE' | 'IDLE' | 'BUSY' | 'IN_CALL';
export type ProviderAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEBOARDING' | 'DEBOARDED';
export type ProviderKycStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type PayoutStatus = 'PROCESSING' | 'QUEUED' | 'PENDING' | 'PROCESSED' | 'FAILED' | 'REVERSED' | 'CANCELLED' | 'REJECTED';
export type ScheduleDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WeeklySchedule = Record<ScheduleDay, { start: string; end: string }[]>;

export interface ProviderItem {
  id: string;
  code: string;
  displayName: string;
  photoVersion: number | null;
  category: ProviderCategory;
  categoryLabel: string;
  presence: ProviderPresence;
  accountStatus: ProviderAccountStatus;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deboardReason: string | null;
  deboardEffectiveAt: string | null;
  kycStatus: ProviderKycStatus;
  identityVerified: boolean;
  profileApproved: boolean;
  languages: string[];
  expertise: string[];
  services: string[];
  experienceYears: number | null;
  perMinuteRate: string;
  commissionSplit: string;
  rating: number | null;
  ratingCount: number;
  sessions: number;
  totalEarnings: string;
  monthEarnings: string;
  grossRevenue: string;
  pendingPayout: string;
  availableDays: ScheduleDay[];
  phone: string;
  email: string | null;
  location: string | null;
  joinRequest: { id: string; applicationNo: string } | null;
  createdAt: string;
}

export interface ProviderKpis {
  totalProviders: { value: number; changePct: number | null };
  onlineNow: { value: number };
  pendingKyc: { value: number };
  joinRequests: { value: number; newThisMonth: number };
  payoutThisMonth: { value: string; changePct: number | null };
}

export interface ProviderList {
  kpis: ProviderKpis;
  payoutsEnabled: boolean;
  items: ProviderItem[];
}

export interface ProviderDetail extends ProviderItem {
  bio: string | null;
  weeklySchedule: WeeklySchedule | null;
  documents: { id: string; kind: 'PHOTO' | 'DOCUMENT'; label: string | null; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  reviews: { id: string; rating: number; comment: string | null; hidden: boolean; userName: string; createdAt: string }[];
  recentSessions: { id: string; status: string; minutes: number; amount: string; userName: string; createdAt: string }[];
  history: { id: string; action: string; summary: string; actorPhone: string | null; actorRole: string | null; createdAt: string }[];
}

export interface PayoutRecord {
  id: string;
  amount: string;
  method: 'RAZORPAYX' | 'MANUAL';
  status: PayoutStatus;
  mode: string | null;
  razorpayPayoutId: string | null;
  reference: string | null;
  failureReason: string | null;
  note: string | null;
  destination: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface PayoutSummary {
  payoutsEnabled: boolean;
  totalEarnings: string;
  monthEarnings: string;
  paidOut: string;
  inFlight: string;
  pendingPayout: string;
  account: {
    accountType: 'BANK' | 'UPI';
    accountName: string;
    accountNumberMasked: string | null;
    ifsc: string | null;
    vpa: string | null;
    destination: string;
    updatedAt: string;
  } | null;
  history: PayoutRecord[];
}

export type ProviderTab = 'all' | 'online' | 'offline' | 'pending' | 'suspended' | 'deboarding';

export const PROVIDER_TABS: readonly { value: ProviderTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deboarding', label: 'Deboarding' },
];

export const SCHEDULE_DAYS: readonly { value: ScheduleDay; short: string; label: string }[] = [
  { value: 'mon', short: 'Mon', label: 'Monday' },
  { value: 'tue', short: 'Tue', label: 'Tuesday' },
  { value: 'wed', short: 'Wed', label: 'Wednesday' },
  { value: 'thu', short: 'Thu', label: 'Thursday' },
  { value: 'fri', short: 'Fri', label: 'Friday' },
  { value: 'sat', short: 'Sat', label: 'Saturday' },
  { value: 'sun', short: 'Sun', label: 'Sunday' },
];

export const DEBOARD_REASONS = [
  'Provider requested to leave',
  'Policy or conduct violation',
  'Quality concerns',
  'Inactive for a long period',
  'KYC / verification failed',
  'Contract ended',
  'Other',
] as const;

export function emptySchedule(): WeeklySchedule {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

export function isLive(item: Pick<ProviderItem, 'accountStatus'>): boolean {
  return item.accountStatus === 'ACTIVE' || item.accountStatus === 'DEBOARDING';
}

export function isOnline(item: Pick<ProviderItem, 'presence' | 'accountStatus'>): boolean {
  return isLive(item) && item.presence !== 'OFFLINE';
}

export function inTab(item: ProviderItem, tab: ProviderTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'online':
      return isOnline(item);
    case 'offline':
      return isLive(item) && item.presence === 'OFFLINE';
    case 'pending':
      return item.kycStatus === 'PENDING' && item.accountStatus !== 'DEBOARDED';
    case 'suspended':
      return item.accountStatus === 'SUSPENDED';
    case 'deboarding':
      return item.accountStatus === 'DEBOARDING' || item.accountStatus === 'DEBOARDED';
  }
}

export interface ProviderFilters {
  search: string;
  category: string;
  status: string;
  language: string;
}

export const EMPTY_FILTERS: ProviderFilters = { search: '', category: '', status: '', language: '' };

/** Status filter values: the account lifecycle plus live presence. */
export const STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'DEBOARDING', label: 'Deboarding' },
  { value: 'DEBOARDED', label: 'Deboarded' },
  { value: 'kyc:PENDING', label: 'KYC pending' },
  { value: 'kyc:VERIFIED', label: 'KYC verified' },
];

function matchesStatus(item: ProviderItem, status: string): boolean {
  if (!status) return true;
  if (status === 'online') return isOnline(item);
  if (status === 'offline') return !isOnline(item);
  if (status.startsWith('kyc:')) return item.kycStatus === status.slice(4);
  return item.accountStatus === status;
}

export function filterProviders(items: readonly ProviderItem[], filters: ProviderFilters): ProviderItem[] {
  const query = filters.search.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  return items.filter((item) => {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.language && !item.languages.some((lang) => lang.toLowerCase() === filters.language.toLowerCase())) return false;
    if (!matchesStatus(item, filters.status)) return false;
    if (!query) return true;
    return (
      item.displayName.toLowerCase().includes(query) ||
      item.code.toLowerCase().includes(query) ||
      item.categoryLabel.toLowerCase().includes(query) ||
      item.expertise.some((tag) => tag.toLowerCase().includes(query)) ||
      (digits.length >= 4 && item.phone.replace(/\D/g, '').includes(digits))
    );
  });
}

export function tabCounts(items: readonly ProviderItem[]): Record<ProviderTab, number> {
  const counts = { all: 0, online: 0, offline: 0, pending: 0, suspended: 0, deboarding: 0 } as Record<ProviderTab, number>;
  for (const item of items) {
    for (const tab of PROVIDER_TABS) if (inTab(item, tab.value)) counts[tab.value] += 1;
  }
  return counts;
}

export function languageOptions(items: readonly ProviderItem[]): string[] {
  const seen = new Map<string, string>();
  for (const item of items) for (const lang of item.languages) if (!seen.has(lang.toLowerCase())) seen.set(lang.toLowerCase(), lang);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Commission is stored as the provider's share; the platform keeps the rest. */
export function platformCommissionPct(commissionSplit: string): number {
  return Math.round((1 - Number(commissionSplit)) * 1000) / 10;
}

export function providerSharePct(commissionSplit: string): number {
  return Math.round(Number(commissionSplit) * 1000) / 10;
}

export const PRESENCE_LABEL: Record<ProviderPresence, string> = {
  OFFLINE: 'Offline',
  IDLE: 'Online',
  BUSY: 'Busy',
  IN_CALL: 'In call',
};

export function statusBadge(item: Pick<ProviderItem, 'presence' | 'accountStatus'>): { label: string; tone: string; dot: string } {
  switch (item.accountStatus) {
    case 'SUSPENDED':
      return { label: 'Suspended', tone: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' };
    case 'DEBOARDED':
      return { label: 'Deboarded', tone: 'bg-stone-100 text-stone-600 ring-stone-200', dot: 'bg-stone-400' };
    case 'DEBOARDING':
      return { label: 'Deboarding', tone: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' };
    default:
      if (item.presence === 'OFFLINE') return { label: 'Offline', tone: 'bg-stone-100 text-stone-600 ring-stone-200', dot: 'bg-stone-400' };
      if (item.presence === 'IDLE') return { label: 'Online', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' };
      return { label: PRESENCE_LABEL[item.presence], tone: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' };
  }
}

export const KYC_BADGE: Record<ProviderKycStatus, { label: string; tone: string }> = {
  PENDING: { label: 'KYC Pending', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  VERIFIED: { label: 'KYC Verified', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'KYC Rejected', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

export const PAYOUT_BADGE: Record<PayoutStatus, { label: string; tone: string }> = {
  PROCESSING: { label: 'Processing', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  QUEUED: { label: 'Queued', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  PENDING: { label: 'Pending approval', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  PROCESSED: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  FAILED: { label: 'Failed', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  REVERSED: { label: 'Reversed', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-stone-100 text-stone-600 ring-stone-200' },
  REJECTED: { label: 'Rejected', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

const CATEGORY_TONE: Record<string, string> = {
  ASTROLOGER: 'bg-violet-50 text-violet-700',
  NUMEROLOGIST: 'bg-sky-50 text-sky-700',
  VASTU_EXPERT: 'bg-amber-50 text-amber-800',
  AYURVEDA_EXPERT: 'bg-emerald-50 text-emerald-700',
  PANDIT: 'bg-orange-50 text-orange-700',
  SPIRITUAL_GUIDE: 'bg-rose-50 text-rose-700',
  OTHER: 'bg-stone-100 text-stone-700',
};

export function categoryTone(category: string): string {
  return CATEGORY_TONE[category] ?? CATEGORY_TONE.OTHER!;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function providersCsv(items: readonly ProviderItem[]): string {
  const header = [
    'ID', 'Name', 'Category', 'Phone', 'Email', 'Languages', 'Expertise', 'Rate per min', 'Provider share %', 'Account status',
    'Presence', 'KYC', 'Rating', 'Ratings', 'Sessions', 'Total earnings', 'This month', 'Pending payout', 'Joined',
  ];
  const rows = items.map((item) => [
    item.code, item.displayName, item.categoryLabel, item.phone, item.email, item.languages.join('; '), item.expertise.join('; '),
    item.perMinuteRate, providerSharePct(item.commissionSplit), item.accountStatus, PRESENCE_LABEL[item.presence], item.kycStatus,
    item.rating, item.ratingCount, item.sessions, item.totalEarnings, item.monthEarnings, item.pendingPayout, item.createdAt.slice(0, 10),
  ]);
  return [header, ...rows].map((row) => row.map((cell) => csvCell(cell as string | number | null)).join(',')).join('\n');
}

/** Today's date in India as YYYY-MM-DD, for date inputs. */
export function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
