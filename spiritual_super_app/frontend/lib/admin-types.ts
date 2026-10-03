import type { AdminPermission } from './admin-nav';

export type StaffRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CONTENT_MANAGER' | 'FINANCE_MANAGER' | 'SUPPORT';

export interface AdminMe {
  role: StaffRole;
  roleLabel: string;
  permissions: AdminPermission[];
  viaAdminPhones: boolean;
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
  PENDING: 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/30',
  UNDER_REVIEW: 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-300/30',
  MORE_INFO_REQUESTED: 'bg-violet-400/15 text-violet-200 ring-1 ring-violet-300/30',
  APPROVED: 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30',
  REJECTED: 'bg-rose-400/15 text-rose-200 ring-1 ring-rose-300/30',
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

export interface AdminOverview {
  generatedAt: string;
  users: { total: number; new7d: number };
  providers: { total: number; online: number; byCategory: { category: ProviderCategory; label: string; count: number }[] };
  joinRequests: { open: number; pending: number };
  operations: { pujaBookingsOpen: number; shopOrdersOpen: number; callsToday: number; callsActive: number };
  finance: {
    walletRecharges30d: string;
    walletRechargeCount30d: number;
    consultationGross30d: string;
    platformFee30d: string;
  } | null;
  recentJoinRequests: {
    id: string;
    applicationNo: string;
    name: string;
    categoryLabel: string;
    city: string;
    status: JoinRequestStatus;
    statusLabel: string;
    createdAt: string;
  }[];
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
