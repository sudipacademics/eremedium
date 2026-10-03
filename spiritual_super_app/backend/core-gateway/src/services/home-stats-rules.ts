import { z } from 'zod';

const count = z.number().int().min(0).max(1_000_000_000);

export const homeStatsBody = z
  .object({
    happyUsers: count,
    verifiedExperts: count,
    pujasPerformed: count,
    authenticProducts: count,
    userRating: z
      .number()
      .min(0)
      .max(5)
      .transform((rating) => Math.round(rating * 10) / 10),
  })
  .strict();

export type HomeStatsInput = z.infer<typeof homeStatsBody>;

export interface HomeStatsView extends HomeStatsInput {
  updatedAt: string | null;
}

/** Shown if the row is ever missing, so the homepage never renders empty cards. */
export const HOME_STATS_DEFAULTS: HomeStatsInput = {
  happyUsers: 50_000,
  verifiedExperts: 500,
  pujasPerformed: 10_000,
  authenticProducts: 1_000,
  userRating: 4.8,
};

export function toHomeStatsView(
  row: (Omit<HomeStatsInput, 'userRating'> & { userRating: { toString(): string }; updatedAt: Date }) | null,
): HomeStatsView {
  if (!row) return { ...HOME_STATS_DEFAULTS, updatedAt: null };
  return {
    happyUsers: row.happyUsers,
    verifiedExperts: row.verifiedExperts,
    pujasPerformed: row.pujasPerformed,
    authenticProducts: row.authenticProducts,
    userRating: Number(row.userRating.toString()),
    updatedAt: row.updatedAt.toISOString(),
  };
}
