import { money, prisma } from '../lib/prisma.js';
import { decodePhotoDataUrl, sortForDirectory, type DirectoryStatus } from './astrologer-directory.js';

export interface DirectoryAstrologer {
  readonly id: string;
  readonly displayName: string;
  readonly status: DirectoryStatus;
  readonly languages: readonly string[];
  readonly expertise: readonly string[];
  readonly experienceYears: number | null;
  readonly perMinuteRate: string;
  /** Changes whenever the photo is replaced, so clients can cache-bust its URL. Null = no photo. */
  readonly photoVersion: number | null;
}

/** Public, unauthenticated astrologer directory for marketing surfaces such as the homepage. */
export const AstrologerDirectoryService = {
  async list(): Promise<DirectoryAstrologer[]> {
    const rows = await prisma.astrologer.findMany({
      take: 100,
      select: {
        id: true,
        displayName: true,
        status: true,
        languages: true,
        expertise: true,
        experienceYears: true,
        perMinuteRate: true,
        photoUpdatedAt: true,
      },
    });
    return sortForDirectory(rows).map((row) => ({
      id: row.id,
      displayName: row.displayName,
      status: row.status,
      languages: row.languages,
      expertise: row.expertise,
      experienceYears: row.experienceYears,
      perMinuteRate: money(row.perMinuteRate).toFixed(2),
      photoVersion: row.photoUpdatedAt?.getTime() ?? null,
    }));
  },

  async photo(astrologerId: string): Promise<{ contentType: string; bytes: Buffer } | null> {
    const row = await prisma.astrologer.findUnique({
      where: { id: astrologerId },
      select: { photoDataUrl: true },
    });
    return decodePhotoDataUrl(row?.photoDataUrl ?? null);
  },
};
