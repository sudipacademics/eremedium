'use client';

import { useEffect, useState } from 'react';
import { appPath } from '@rfms/utils';

export type CompanyProfile = {
  company_name: string;
  legal_name: string;
  logo_url: string;
  franchise_hub_name: string;
  office_address: string;
  company_email: string;
  company_phone: string;
  whatsapp_number: string;
  google_map_embed_url: string;
  why_remedium_eyebrow: string;
  why_remedium_title: string;
  why_remedium_intro: string;
  why_remedium_body: string;
  why_remedium_point_one: string;
  why_remedium_point_two: string;
  why_remedium_point_three: string;
  why_remedium_badge_url: string;
  brochure_url: string;
  footer_disclaimer: string;
  footer_terms: string;
};

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  company_name: 'Remedium Lab',
  legal_name: 'Remedium Lab',
  logo_url: '/remedium-lab-logo.png',
  franchise_hub_name: 'Remedium Lab Franchisee Hub',
  office_address: 'ASO210, Astra Towers, 2C/1, AA II, C, Newtown, Reckjoani, Kolkata, West Bengal 700156',
  company_email: '',
  company_phone: '',
  whatsapp_number: '',
  google_map_embed_url: 'https://www.google.com/maps?q=ASO210%2C%20Astra%20Towers%2C%20Newtown%2C%20Kolkata%20700156&output=embed',
  why_remedium_eyebrow: 'Why Remedium Lab',
  why_remedium_title: 'Build a diagnostic business that serves society.',
  why_remedium_intro: "Partner with Eastern India's fair-price diagnostics brand and bring dependable testing closer to every community.",
  why_remedium_body: 'Remedium Lab combines an NABL-accredited quality approach with structured franchise support, transparent processes and a patient-first purpose. Our franchise model helps local entrepreneurs build a trusted diagnostic business while supporting accessible healthcare in their communities.',
  why_remedium_point_one: 'NABL-accredited quality systems designed for reliable diagnostic reporting.',
  why_remedium_point_two: 'Fair-price diagnostics that help make essential testing more accessible.',
  why_remedium_point_three: 'Training, launch guidance and ongoing operational support for every franchise partner.',
  why_remedium_badge_url: '/nabl-accreditation-badge.svg',
  brochure_url: '',
  footer_disclaimer: 'Information on this website is for franchise opportunity discussion only. Financial estimates, territory availability, timelines and approval outcomes are indicative and subject to Remedium Lab review, applicable law and the final signed agreement.',
  footer_terms: 'By using this website or submitting an enquiry, you agree that the information you provide may be used by Remedium Lab to assess and respond to your franchise enquiry. This website does not constitute an offer, guarantee of franchise approval, financial advice or a promise of business performance.',
};

const API_BASE = process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1';
const DEFAULT_LOGO_SRC = appPath(DEFAULT_COMPANY_PROFILE.logo_url);
const DEFAULT_BADGE_SRC = appPath(DEFAULT_COMPANY_PROFILE.why_remedium_badge_url);

function mediaUrl(value: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return trimmed;
  // Old CMS uploads were saved as localhost URLs; browsers cannot load those from production.
  const localUpload = trimmed.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/uploads\/[A-Za-z0-9._-]+)$/i);
  if (localUpload) {
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return `${window.location.origin}${localUpload[1]}`;
    }
  }
  return appPath(trimmed);
}

function normaliseProfile(value: unknown): CompanyProfile {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_COMPANY_PROFILE,
      logo_url: DEFAULT_LOGO_SRC,
      why_remedium_badge_url: DEFAULT_BADGE_SRC,
    };
  }
  const source = value as Record<string, unknown>;
  const profile = Object.fromEntries(
    Object.entries(DEFAULT_COMPANY_PROFILE).map(([key, fallback]) => [key, typeof source[key] === 'string' && source[key].trim() ? source[key].trim() : fallback]),
  ) as CompanyProfile;
  profile.logo_url = mediaUrl(profile.logo_url);
  profile.why_remedium_badge_url = mediaUrl(profile.why_remedium_badge_url);
  profile.brochure_url = profile.brochure_url ? mediaUrl(profile.brochure_url) : '';
  return profile;
}

export function useCompanyProfile() {
  const [profile, setProfile] = useState<CompanyProfile>(() => normaliseProfile(null));

  useEffect(() => {
    let current = true;
    void fetch(`${API_BASE}/content/settings`)
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (current && response.ok && body?.success) setProfile(normaliseProfile(body.data));
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, []);

  return profile;
}

function isLegacyCanvasLogo(logoUrl: string) {
  const value = logoUrl.trim().toLowerCase();
  return value.includes('remedium-lab-logo.png')
    || value.includes('/uploads/company-logo-')
    || /company-logo-[a-z0-9.-]+\.(png|jpe?g|webp)(?:\?|$)/i.test(value);
}

export function CompanyLogo({ profile, className }: { profile: CompanyProfile; className?: string }) {
  const legacyCanvas = isLegacyCanvasLogo(profile.logo_url);
  const classes = [className, legacyCanvas ? 'legacy-canvas-logo' : ''].filter(Boolean).join(' ') || undefined;

  return <img
    className={classes}
    src={profile.logo_url || DEFAULT_LOGO_SRC}
    alt={`${profile.company_name} logo`}
    onLoad={(event) => {
      const image = event.currentTarget;
      if (image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth / image.naturalHeight >= 1.7) {
        image.classList.add('legacy-canvas-logo');
      }
    }}
    onError={(event) => {
      if (event.currentTarget.src.includes(DEFAULT_LOGO_SRC)) return;
      event.currentTarget.src = DEFAULT_LOGO_SRC;
      event.currentTarget.classList.add('legacy-canvas-logo');
    }}
  />;
}
