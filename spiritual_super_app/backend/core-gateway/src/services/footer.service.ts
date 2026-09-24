import { prisma } from '../lib/prisma.js';
import {
  FOOTER_FIELDS,
  normaliseFooterInput,
  type FooterLinkField,
  type FooterSettingsInput,
} from './footer-links.js';

export type { FooterSettingsInput } from './footer-links.js';

export type FooterSettingsView = { readonly [K in FooterLinkField]: string | null } & {
  readonly updatedAt: string | null;
};

function view(row: ({ [K in FooterLinkField]: string | null } & { updatedAt: Date }) | null): FooterSettingsView {
  const links = Object.fromEntries(FOOTER_FIELDS.map((field) => [field, row?.[field] ?? null])) as {
    [K in FooterLinkField]: string | null;
  };
  return { ...links, updatedAt: row?.updatedAt.toISOString() ?? null };
}

export const FooterService = {
  async get(): Promise<FooterSettingsView> {
    return view(await prisma.footerSettings.findUnique({ where: { id: 'default' } }));
  },

  async update(input: FooterSettingsInput, adminUserId: string): Promise<FooterSettingsView> {
    const data = { ...normaliseFooterInput(input), updatedBy: adminUserId };
    const row = await prisma.footerSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    return view(row);
  },
};
