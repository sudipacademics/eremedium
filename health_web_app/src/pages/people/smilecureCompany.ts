/** Official Smilecure letterhead used on HRMS payslips and related prints. */
export const SMILECURE_COMPANY = {
  legalName: 'Smilecure Lifestyle Private Limited',
  registeredOffice: 'Q60, Fortune Plaza, Fortune Township, Kazipara, Barasat, Kolkata – 700125',
  corporateOffice:
    'QUBE – 319, PS QUBE Building, Street No. 1111 (Major Arterial Road), Mouza – Noapara, J.L., Plot No. IID/31/1, NH 12, Rajarhat, Kolkata, West Bengal – 700161',
  hrEmail: 'hr@smilecurelifestyle.in',
  hrPhone: '8100149228',
  logoPath: '/brand/smilecure-lifestyle.png',
} as const;

export function smilecureLogoUrl() {
  if (typeof window === 'undefined') return SMILECURE_COMPANY.logoPath;
  return new URL(SMILECURE_COMPANY.logoPath, window.location.origin).href;
}
