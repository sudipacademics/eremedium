export type SocialPlatform = 'instagram' | 'facebook' | 'youtube' | 'x' | 'linkedin' | 'whatsapp';

export interface SocialLink {
  platform: SocialPlatform;
  label: string;
  /** Full profile URL. Links with an empty href are not rendered. */
  href: string;
  /** Shown beside the icon on wider screens, e.g. "@vedsutra". */
  handle: string;
}

/** Vedsutra's official profiles. Fill in `href` and `handle` to publish an icon in the footer. */
export const SOCIAL_LINKS: readonly SocialLink[] = [
  { platform: 'instagram', label: 'Instagram', href: '', handle: '' },
  { platform: 'facebook', label: 'Facebook', href: '', handle: '' },
  { platform: 'youtube', label: 'YouTube', href: '', handle: '' },
  { platform: 'x', label: 'X', href: '', handle: '' },
  { platform: 'linkedin', label: 'LinkedIn', href: '', handle: '' },
  { platform: 'whatsapp', label: 'WhatsApp', href: '', handle: '' },
];

/** Contact address quoted on the legal pages. */
export const LEGAL_CONTACT_EMAIL = 'support@vedsutra.in';
