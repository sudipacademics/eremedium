/**
 * Schema.org JSON-LD for Remedium public properties.
 * Used by StructuredData and available for prerender / index.html injection.
 */

export type LeadershipPerson = {
  name: string;
  jobTitle: string;
  /** LinkedIn or company bio URL */
  url?: string;
};

import type { FaqItem } from '../content/remediumFaqs';
import { flatRemediumFaqs } from '../content/remediumFaqs';

/** Canonical brand facts — update leadership here when publishing executive names. */
export const REMEDIUM_BRAND = {
  brandName: 'Remedium',
  legalName: 'Smilecure Lifestyle Pvt. Ltd.',
  tagline: 'Transparency, Accuracy & Speed – Our Promise to You',
  seoTagline: "India's First Fair Price Diagnostic Lab",
  focusKeywords:
    'Remedium, Remedium Lab, Remedium Aesthetic, Remedium Care, India\'s First fair price Diagnostic Lab',
  siteUrl: 'https://www.remediumlabs.in',
  logoUrl: 'https://www.remediumlabs.in/icon.svg',
  email: 'support@e-remedium.in',
  labsEmail: 'labs@remedium.smilecure.info',
  phone: '+91-8100149231',
  homeCollectionHelpline: '+91-8100149230',
  homeCollectionHours: '09:00-20:00',
  address: {
    streetAddress: 'ASO210, Astra Towers, 2C/1, AA II, C, Newtown, Reckjoani',
    addressLocality: 'Kolkata',
    addressRegion: 'West Bengal',
    postalCode: '700156',
    addressCountry: 'IN',
  },
  geo: {
    latitude: 22.5726,
    longitude: 88.3639,
  },
  foundingDate: '2001',
  accreditation: 'NABL Accredited | ISO 9001:2015 Certified',
  sameAs: [
    'https://www.facebook.com/remedium.health',
    'https://www.instagram.com/remedium.health',
    'https://www.youtube.com/@remediumhealth',
    'https://www.linkedin.com/company/remedium-health',
    'https://career.e-remedium.in',
  ],
  /** Add verified executive names when publishing (shown as schema.org Person). */
  leadership: [] as LeadershipPerson[],
  services: [
    'Diagnostic laboratory testing',
    'Home sample collection',
    'Doctor consultations and telemedicine',
    'Pharmacy and e-prescription fulfillment',
    'Health Circle membership plans',
    'Diagnostic franchise (FOCO / FOFO)',
  ],
} as const;

export type { FaqItem };

export const REMEDIUM_FAQS: FaqItem[] = flatRemediumFaqs();

function siteRoot(url: string) {
  return url.replace(/\/+$/, '');
}

function orgId(baseUrl: string) {
  return `${siteRoot(baseUrl)}/#organization`;
}

function medicalId(baseUrl: string) {
  return `${siteRoot(baseUrl)}/#medicalbusiness`;
}

function faqId(baseUrl: string) {
  return `${siteRoot(baseUrl)}/#faq`;
}

function postalAddress(base = REMEDIUM_BRAND) {
  return {
    '@type': 'PostalAddress',
    streetAddress: base.address.streetAddress,
    addressLocality: base.address.addressLocality,
    addressRegion: base.address.addressRegion,
    postalCode: base.address.postalCode,
    addressCountry: base.address.addressCountry,
  };
}

function contactPoints(base = REMEDIUM_BRAND) {
  return [
    {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: base.email,
      telephone: base.homeCollectionHelpline,
      availableLanguage: ['English', 'Bengali', 'Hindi'],
      hoursAvailable: {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ],
        opens: '09:00',
        closes: '20:00',
      },
    },
    {
      '@type': 'ContactPoint',
      contactType: 'corporate',
      email: base.labsEmail,
      telephone: base.phone,
    },
  ];
}

function leadershipPeople(base = REMEDIUM_BRAND) {
  return base.leadership.map((person) => ({
    '@type': 'Person',
    name: person.name,
    jobTitle: person.jobTitle,
    ...(person.url ? { url: person.url } : {}),
    worksFor: { '@id': orgId(base.siteUrl) },
  }));
}

/** Build @graph with Organization, MedicalBusiness, and FAQPage. */
export function buildStructuredDataGraph(options?: { pageUrl?: string }) {
  const base = REMEDIUM_BRAND;
  const root = siteRoot(base.siteUrl);
  const pageUrl = (options?.pageUrl || base.siteUrl).split('#')[0] || base.siteUrl;
  const leaders = leadershipPeople(base);

  const organization: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': orgId(root),
    name: base.legalName,
    legalName: base.legalName,
    alternateName: [base.brandName, 'Remedium Health', 'Remedium Labs'],
    url: base.siteUrl,
    logo: base.logoUrl,
    description: `${base.brandName} — ${base.tagline} ${base.accreditation}.`,
    foundingDate: base.foundingDate,
    email: base.email,
    telephone: base.phone,
    address: postalAddress(base),
    sameAs: base.sameAs,
    contactPoint: contactPoints(base),
  };

  if (leaders.length) {
    organization.employee = leaders;
  }

  const medicalBusiness: Record<string, unknown> = {
    '@type': 'MedicalBusiness',
    '@id': medicalId(root),
    name: base.brandName,
    legalName: base.legalName,
    url: base.siteUrl,
    logo: base.logoUrl,
    image: base.logoUrl,
    description:
      'Remedium provides NABL-aligned diagnostic laboratory services, home phlebotomy, telemedicine, and pharmacy across West Bengal.',
    telephone: base.homeCollectionHelpline,
    email: base.email,
    address: postalAddress(base),
    geo: {
      '@type': 'GeoCoordinates',
      latitude: base.geo.latitude,
      longitude: base.geo.longitude,
    },
    openingHours: 'Mo-Su 09:00-20:00',
    priceRange: '₹₹',
    parentOrganization: { '@id': orgId(root) },
    sameAs: base.sameAs,
    contactPoint: contactPoints(base),
    knowsAbout: base.services,
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Remedium health services',
      itemListElement: base.services.map((name, index) => ({
        '@type': 'Offer',
        position: index + 1,
        itemOffered: {
          '@type': 'Service',
          name,
          provider: { '@id': medicalId(root) },
        },
      })),
    },
  };

  if (leaders.length) {
    medicalBusiness.employee = leaders;
  }

  const faqPage: Record<string, unknown> = {
    '@type': 'FAQPage',
    '@id': faqId(root),
    url: pageUrl,
    mainEntity: REMEDIUM_FAQS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [organization, medicalBusiness, faqPage],
  };
}

export function structuredDataJson(options?: { pageUrl?: string }): string {
  return JSON.stringify(buildStructuredDataGraph(options));
}
