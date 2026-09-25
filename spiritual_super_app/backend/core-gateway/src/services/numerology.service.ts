import type { NumerologyReport } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { buildReading, type NumerologyReading } from './numerology.js';
import { parseYouTubeId, youtubeWatchUrl } from './review-videos.js';

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export interface NumerologyRequest {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  /** YYYY-MM-DD */
  readonly birthDate: string;
  readonly gender: Gender;
}

export interface NumerologyLeadView {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly birthDate: string;
  readonly gender: string;
  readonly lifePath: number;
  readonly destiny: number;
  readonly soulUrge: number;
  readonly personality: number;
  readonly birthday: number;
  readonly createdAt: string;
}

export interface NumerologySettingsView {
  readonly videoYoutubeId: string | null;
  readonly videoUrl: string | null;
}

function leadView(row: NumerologyReport): NumerologyLeadView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    birthDate: row.birthDate.toISOString().slice(0, 10),
    gender: row.gender,
    lifePath: row.lifePath,
    destiny: row.destiny,
    soulUrge: row.soulUrge,
    personality: row.personality,
    birthday: row.birthday,
    createdAt: row.createdAt.toISOString(),
  };
}

function settingsView(videoYoutubeId: string | null): NumerologySettingsView {
  return { videoYoutubeId, videoUrl: videoYoutubeId ? youtubeWatchUrl(videoYoutubeId) : null };
}

export const NumerologyService = {
  /** Calculates the reading and records the request as a lead. */
  async createReport(input: NumerologyRequest): Promise<NumerologyReading> {
    const reading = buildReading(input.fullName, input.birthDate);
    await prisma.numerologyReport.create({
      data: {
        fullName: reading.name,
        email: input.email.trim().toLowerCase(),
        phone: input.phone.replace(/[\s-]/g, ''),
        birthDate: new Date(`${input.birthDate}T00:00:00.000Z`),
        gender: input.gender,
        lifePath: reading.numbers.lifePath,
        destiny: reading.numbers.destiny,
        soulUrge: reading.numbers.soulUrge,
        personality: reading.numbers.personality,
        birthday: reading.numbers.birthday,
      },
    });
    return reading;
  },

  async listLeads(limit: number): Promise<{ leads: NumerologyLeadView[]; total: number }> {
    const [rows, total] = await Promise.all([
      prisma.numerologyReport.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.numerologyReport.count(),
    ]);
    return { leads: rows.map(leadView), total };
  },

  async removeLead(id: string): Promise<boolean> {
    const deleted = await prisma.numerologyReport.deleteMany({ where: { id } });
    return deleted.count > 0;
  },

  async getSettings(): Promise<NumerologySettingsView> {
    const row = await prisma.numerologySettings.findUnique({ where: { id: 'default' } });
    return settingsView(row?.videoYoutubeId ?? null);
  },

  /** A blank URL clears the video. */
  async updateSettings(videoUrl: string | null, adminUserId: string): Promise<NumerologySettingsView> {
    const videoYoutubeId = videoUrl?.trim() ? parseYouTubeId(videoUrl) : null;
    const row = await prisma.numerologySettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', videoYoutubeId, updatedBy: adminUserId },
      update: { videoYoutubeId, updatedBy: adminUserId },
    });
    return settingsView(row.videoYoutubeId);
  },
};
