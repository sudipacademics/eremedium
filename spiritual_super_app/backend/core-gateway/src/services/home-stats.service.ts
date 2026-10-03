import { prisma } from '../lib/prisma.js';
import { toHomeStatsView, type HomeStatsInput, type HomeStatsView } from './home-stats-rules.js';

export type { HomeStatsInput, HomeStatsView } from './home-stats-rules.js';

export const HomeStatsService = {
  async get(): Promise<HomeStatsView> {
    return toHomeStatsView(await prisma.homeStats.findUnique({ where: { id: 'default' } }));
  },

  async update(input: HomeStatsInput, adminUserId: string): Promise<HomeStatsView> {
    const data = { ...input, updatedBy: adminUserId };
    const row = await prisma.homeStats.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    return toHomeStatsView(row);
  },
};
