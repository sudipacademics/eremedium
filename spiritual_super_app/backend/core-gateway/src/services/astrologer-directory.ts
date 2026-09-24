export type DirectoryStatus = 'IDLE' | 'BUSY' | 'IN_CALL' | 'OFFLINE';

/** Available first, then online-but-engaged, then offline. */
const STATUS_RANK: Readonly<Record<DirectoryStatus, number>> = { IDLE: 0, BUSY: 1, IN_CALL: 1, OFFLINE: 2 };

export interface DirectorySortable {
  readonly status: DirectoryStatus;
  readonly experienceYears: number | null;
  readonly displayName: string;
}

export function sortForDirectory<T extends DirectorySortable>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (b.experienceYears ?? -1) - (a.experienceYears ?? -1) ||
      a.displayName.localeCompare(b.displayName),
  );
}

export const ASTROLOGER_PHOTO_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export function decodePhotoDataUrl(dataUrl: string | null): { contentType: string; bytes: Buffer } | null {
  if (!dataUrl) return null;
  const match = ASTROLOGER_PHOTO_PATTERN.exec(dataUrl);
  if (!match) return null;
  return { contentType: `image/${match[1]}`, bytes: Buffer.from(match[2]!, 'base64') };
}

/** Trims, drops empties and case-insensitive duplicates, keeps the admin's order. */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}
