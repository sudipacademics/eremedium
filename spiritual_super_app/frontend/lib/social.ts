import type { FooterSettings } from '@/lib/api';

export type SocialPlatform = 'facebook' | 'instagram' | 'youtube' | 'x' | 'linkedin' | 'whatsapp';

export interface SocialPlatformInfo {
  platform: SocialPlatform;
  label: string;
  /** The footer settings field holding this profile's URL, managed from Admin → Footer. */
  field: keyof Pick<
    FooterSettings,
    'facebookUrl' | 'instagramUrl' | 'youtubeUrl' | 'xUrl' | 'linkedinUrl' | 'whatsappUrl'
  >;
  /** Always shown in the footer; the others appear only once a URL is set. */
  core: boolean;
  placeholder: string;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatformInfo[] = [
  { platform: 'facebook', label: 'Facebook', field: 'facebookUrl', core: true, placeholder: 'https://www.facebook.com/vedsutra' },
  { platform: 'instagram', label: 'Instagram', field: 'instagramUrl', core: true, placeholder: 'https://www.instagram.com/vedsutra' },
  { platform: 'youtube', label: 'YouTube', field: 'youtubeUrl', core: true, placeholder: 'https://www.youtube.com/@vedsutra' },
  { platform: 'x', label: 'X', field: 'xUrl', core: false, placeholder: 'https://x.com/vedsutra' },
  { platform: 'linkedin', label: 'LinkedIn', field: 'linkedinUrl', core: false, placeholder: 'https://www.linkedin.com/company/vedsutra' },
  { platform: 'whatsapp', label: 'WhatsApp', field: 'whatsappUrl', core: false, placeholder: 'https://wa.me/919000000000' },
];

/** Contact address quoted on the legal and support pages. */
export const LEGAL_CONTACT_EMAIL = 'support@vedsutra.in';
