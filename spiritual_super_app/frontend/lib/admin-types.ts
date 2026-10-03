import type { AdminPermission } from './admin-nav';

export type StaffRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CONTENT_MANAGER' | 'FINANCE_MANAGER' | 'SUPPORT';

export interface AdminMe {
  name: string | null;
  phone: string;
  role: StaffRole;
  roleLabel: string;
  permissions: AdminPermission[];
  viaAdminPhones: boolean;
  badges: { joinRequestsPending: number };
}

export type ProviderCategory =
  | 'ASTROLOGER'
  | 'NUMEROLOGIST'
  | 'VASTU_EXPERT'
  | 'AYURVEDA_EXPERT'
  | 'PANDIT'
  | 'SPIRITUAL_GUIDE'
  | 'OTHER';

export const PROVIDER_CATEGORIES: readonly { value: ProviderCategory; label: string }[] = [
  { value: 'ASTROLOGER', label: 'Astrologer' },
  { value: 'NUMEROLOGIST', label: 'Numerologist' },
  { value: 'VASTU_EXPERT', label: 'Vastu Expert' },
  { value: 'AYURVEDA_EXPERT', label: 'Ayurveda Expert' },
  { value: 'PANDIT', label: 'Pandit' },
  { value: 'SPIRITUAL_GUIDE', label: 'Spiritual Guide' },
  { value: 'OTHER', label: 'Other' },
];

export type JoinRequestStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'MORE_INFO_REQUESTED';

export const JOIN_STATUSES: readonly { value: JoinRequestStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'MORE_INFO_REQUESTED', label: 'More Info Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export const STATUS_TONE: Record<JoinRequestStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  UNDER_REVIEW: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  MORE_INFO_REQUESTED: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

export interface JoinRequestListItem {
  id: string;
  applicationNo: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  category: ProviderCategory;
  categoryLabel: string;
  experienceYears: number;
  status: JoinRequestStatus;
  statusLabel: string;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface JoinRequestList {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<JoinRequestStatus, number>;
  items: JoinRequestListItem[];
}

export interface JoinRequestFile {
  id: string;
  kind: 'PHOTO' | 'DOCUMENT';
  label: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface JoinRequestEvent {
  id: string;
  actorKind: 'APPLICANT' | 'STAFF' | 'SYSTEM';
  actorName: string | null;
  action: string;
  fromStatus: JoinRequestStatus | null;
  toStatus: JoinRequestStatus | null;
  note: string | null;
  createdAt: string;
}

export interface JoinRequestDetail {
  id: string;
  applicationNo: string;
  userId: string | null;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  dateOfBirth: string;
  category: ProviderCategory;
  categoryLabel: string;
  categoryOther: string | null;
  expertise: string[];
  experienceYears: number;
  languages: string[];
  qualification: string;
  about: string;
  services: string[];
  status: JoinRequestStatus;
  statusLabel: string;
  allowedStatuses: JoinRequestStatus[];
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  providerAstrologerId: string | null;
  createdAt: string;
  updatedAt: string;
  files: JoinRequestFile[];
  events: JoinRequestEvent[];
}

export type DashboardPeriod = 'month' | 'quarter' | 'year' | 'all';

export const DASHBOARD_PERIODS: readonly { value: DashboardPeriod; label: string }[] = [
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
];

export interface Kpi {
  total: number;
  inPeriod: number;
  changePct: number | null;
}

export interface AdminDashboard {
  generatedAt: string;
  period: DashboardPeriod;
  periodLabel: string;
  kpis: {
    users: Kpi;
    providers: Kpi;
    joinRequests: Kpi & { pending: number };
    consultations: Kpi;
    pujaBookings: Kpi;
    shopOrders: Kpi;
    revenue: Kpi | null;
  };
  revenueTrend: {
    range: 'year' | '12m';
    months: { month: string; label: string; consultations: number; epuja: number; shop: number }[];
  } | null;
  serviceRevenue: { total: number; items: { key: string; label: string; amount: number; pct: number }[] } | null;
  userGrowth: { month: string; label: string; newUsers: number; total: number }[];
  pending: { joinRequests: number; pujaBookings: number; shopOrders: number; liveCalls: number };
  latestJoinRequests: {
    id: string;
    applicationNo: string;
    name: string;
    categoryLabel: string;
    city: string;
    status: JoinRequestStatus;
    statusLabel: string;
    createdAt: string;
  }[];
  recentConsultations: {
    id: string;
    userName: string;
    providerName: string;
    service: string;
    at: string;
    minutes: number;
    status: 'INITIATED' | 'ACTIVE' | 'COMPLETED' | 'DROPPED_INSUFFICIENT_FUNDS';
    statusLabel: string;
  }[];
  latestOrders: {
    id: string;
    productName: string;
    imageUrl: string | null;
    amount: number;
    status: 'CONFIRMED' | 'PACKED' | 'DISPATCHED';
    statusLabel: string;
    createdAt: string;
  }[];
  topLocations: { basis: number; items: { label: string; count: number; pct: number }[] };
  providersByCategory: { category: ProviderCategory; label: string; count: number }[];
  topServices: { label: string; kind: string; count: number }[];
  recentActivity: { kind: 'user' | 'join' | 'puja' | 'order' | 'call' | 'audit'; text: string; at: string; href: string | null }[];
}

const INR_FULL = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatInr(amount: number): string {
  return `₹${INR_FULL.format(amount)}`;
}

/** ₹8.92L / ₹1.2Cr / ₹45K, for chart axes and big totals. */
export function formatInrCompact(amount: number): string {
  const abs = Math.abs(amount);
  const trim = (value: number) => value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.?0+$/, '');
  if (abs >= 1e7) return `₹${trim(amount / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(amount / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(amount / 1e3)}K`;
  return `₹${INR_FULL.format(amount)}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

export interface StaffList {
  roles: { role: StaffRole; label: string; permissions: AdminPermission[] }[];
  builtIn: { phone: string; name: string | null; role: StaffRole; roleLabel: string }[];
  staff: {
    id: string;
    userId: string;
    name: string;
    phone: string;
    role: StaffRole;
    roleLabel: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
}

export interface AuditList {
  total: number;
  page: number;
  pageSize: number;
  entityTypes: string[];
  items: {
    id: string;
    actorPhone: string | null;
    actorRole: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    summary: string;
    metadata: unknown;
    ip: string | null;
    createdAt: string;
  }[];
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Saves a blob (CSV export, document) through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
