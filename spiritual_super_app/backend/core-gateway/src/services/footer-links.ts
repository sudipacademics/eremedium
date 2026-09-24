import { assertSafeExternalUrl } from './content-security.js';

export const FOOTER_LINK_FIELDS = {
  facebookUrl: { label: 'Facebook', hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  instagramUrl: { label: 'Instagram', hosts: ['instagram.com'] },
  youtubeUrl: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  xUrl: { label: 'X', hosts: ['x.com', 'twitter.com'] },
  linkedinUrl: { label: 'LinkedIn', hosts: ['linkedin.com'] },
  whatsappUrl: { label: 'WhatsApp', hosts: ['wa.me', 'whatsapp.com'] },
  appStoreUrl: { label: 'App Store', hosts: ['apps.apple.com'] },
  playStoreUrl: { label: 'Google Play', hosts: ['play.google.com'] },
} as const;

export type FooterLinkField = keyof typeof FOOTER_LINK_FIELDS;

export type FooterSettingsInput = { readonly [K in FooterLinkField]?: string | null };

export const FOOTER_FIELDS = Object.keys(FOOTER_LINK_FIELDS) as FooterLinkField[];

/** Validates every supplied link; fields left out of the input are not touched. */
export function normaliseFooterInput(input: FooterSettingsInput): Partial<Record<FooterLinkField, string | null>> {
  const data: Partial<Record<FooterLinkField, string | null>> = {};
  for (const field of FOOTER_FIELDS) {
    if (input[field] === undefined) continue;
    const { label, hosts } = FOOTER_LINK_FIELDS[field];
    data[field] = assertSafeExternalUrl(input[field], hosts, label);
  }
  return data;
}
