import { randomInt } from 'node:crypto';

import { JoinRequestStatus, ProviderCategory } from '@prisma/client';

export const CATEGORY_LABELS: Readonly<Record<ProviderCategory, string>> = {
  [ProviderCategory.ASTROLOGER]: 'Astrologer',
  [ProviderCategory.NUMEROLOGIST]: 'Numerologist',
  [ProviderCategory.VASTU_EXPERT]: 'Vastu Expert',
  [ProviderCategory.AYURVEDA_EXPERT]: 'Ayurveda Expert',
  [ProviderCategory.PANDIT]: 'Pandit',
  [ProviderCategory.SPIRITUAL_GUIDE]: 'Spiritual Guide',
  [ProviderCategory.OTHER]: 'Other',
};

export const STATUS_LABELS: Readonly<Record<JoinRequestStatus, string>> = {
  [JoinRequestStatus.PENDING]: 'Pending',
  [JoinRequestStatus.UNDER_REVIEW]: 'Under Review',
  [JoinRequestStatus.APPROVED]: 'Approved',
  [JoinRequestStatus.REJECTED]: 'Rejected',
  [JoinRequestStatus.MORE_INFO_REQUESTED]: 'More Information Requested',
};

export const OPEN_STATUSES: readonly JoinRequestStatus[] = [
  JoinRequestStatus.PENDING,
  JoinRequestStatus.UNDER_REVIEW,
  JoinRequestStatus.MORE_INFO_REQUESTED,
];

/** Approval is final: it may have created a provider account, which is managed from the roster. */
const TRANSITIONS: Readonly<Record<JoinRequestStatus, readonly JoinRequestStatus[]>> = {
  [JoinRequestStatus.PENDING]: [
    JoinRequestStatus.UNDER_REVIEW,
    JoinRequestStatus.APPROVED,
    JoinRequestStatus.REJECTED,
    JoinRequestStatus.MORE_INFO_REQUESTED,
  ],
  [JoinRequestStatus.UNDER_REVIEW]: [
    JoinRequestStatus.PENDING,
    JoinRequestStatus.APPROVED,
    JoinRequestStatus.REJECTED,
    JoinRequestStatus.MORE_INFO_REQUESTED,
  ],
  [JoinRequestStatus.MORE_INFO_REQUESTED]: [
    JoinRequestStatus.PENDING,
    JoinRequestStatus.UNDER_REVIEW,
    JoinRequestStatus.APPROVED,
    JoinRequestStatus.REJECTED,
  ],
  [JoinRequestStatus.REJECTED]: [JoinRequestStatus.UNDER_REVIEW],
  [JoinRequestStatus.APPROVED]: [],
};

export function allowedTransitions(from: JoinRequestStatus): readonly JoinRequestStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: JoinRequestStatus, to: JoinRequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// No 0/O or 1/I/L, so an ID read out over the phone is unambiguous.
const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** e.g. VSJ-261003-7KQ2M: prefix, submission date (UTC, yymmdd), five random characters. */
export function generateApplicationNo(now: Date = new Date(), pick: (max: number) => number = randomInt): string {
  const date = `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  let suffix = '';
  for (let i = 0; i < 5; i += 1) suffix += ID_ALPHABET[pick(ID_ALPHABET.length)];
  return `VSJ-${date}-${suffix}`;
}

export const APPLICATION_NO_PATTERN = /^VSJ-\d{6}-[2-9A-HJKMNP-Z]{5}$/;

/** Trims, drops blanks and case-insensitive duplicates, and caps the list. */
export function cleanList(values: readonly string[], max: number, maxLength = 60): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading =, +, - or @ makes spreadsheets evaluate the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
