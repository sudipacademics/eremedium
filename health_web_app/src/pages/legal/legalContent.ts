export type LegalDocId =
  | 'privacy-policy'
  | 'disclaimer'
  | 'terms-and-conditions'
  | 'refund-policy'
  | 'data-use-policy';

export type LegalSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type LegalDoc = {
  id: LegalDocId;
  title: string;
  updated: string;
  summary: string;
  sections: LegalSection[];
};

export const LEGAL_NAV: Array<{ id: LegalDocId; title: string; path: string }> = [
  { id: 'privacy-policy', title: 'Privacy Policy', path: '/legal/privacy-policy' },
  { id: 'disclaimer', title: 'Disclaimer', path: '/legal/disclaimer' },
  { id: 'terms-and-conditions', title: 'Terms & Conditions', path: '/legal/terms-and-conditions' },
  { id: 'refund-policy', title: 'Refund Policy', path: '/legal/refund-policy' },
  { id: 'data-use-policy', title: 'Data Use Policy', path: '/legal/data-use-policy' },
];

const ORG = 'Remedium (a unit of Smilecure Lifestyle Pvt. Ltd)';
const BRAND = 'Remedium';
const SITE = 'https://www.e-remedium.in';
const SUPPORT = 'support@e-remedium.in';
const UPDATED = '25 July 2026';

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  'privacy-policy': {
    id: 'privacy-policy',
    title: 'Privacy Policy',
    updated: UPDATED,
    summary: `How ${BRAND} collects, uses, stores, and protects personal information when you use ${SITE} and related apps.`,
    sections: [
      {
        heading: '1. Who we are',
        paragraphs: [
          `${ORG} (“we”, “us”, “our”) operates the ${BRAND} digital health platform at ${SITE} and related mobile/web experiences for diagnostics, pharmacy, wellness, appointments, and memberships.`,
          `For privacy questions, contact ${SUPPORT}.`,
        ],
      },
      {
        heading: '2. Information we collect',
        paragraphs: ['Depending on how you use Remedium, we may collect:'],
        bullets: [
          'Identity and contact details (name, mobile, email, date of birth, gender, address)',
          'Health-related information needed to fulfil services (test bookings, prescriptions, symptoms you share, reports)',
          'Account and authentication data (OTP sessions, login identifiers)',
          'Order, payment, and wallet transaction records (payment gateway references; we do not store full card numbers)',
          'Device and usage data (browser/app type, IP address, pages viewed, crash logs)',
          'Location data when you allow it (for centre discovery or collection routing)',
        ],
      },
      {
        heading: '3. How we use information',
        paragraphs: ['We use personal data to:'],
        bullets: [
          'Provide booked services (labs, home collection, pharmacy, consultations, wellness)',
          'Process payments, refunds, wallet credits, and invoices',
          'Send transactional OTP, booking, report, and delivery notifications',
          'Improve safety, quality, fraud prevention, and platform reliability',
          'Honour memberships, referrals, and eligible offers you choose to use',
          'Meet legal, regulatory, and audit obligations applicable to healthcare platforms in India',
        ],
      },
      {
        heading: '4. Sharing',
        paragraphs: [
          'We do not sell your personal data. We may share limited data with:',
        ],
        bullets: [
          'Franchisee centres, labs, phlebotomists, and clinicians fulfilling your order',
          'Payment, SMS/OTP, maps, and cloud infrastructure providers under contract',
          'Regulators or law enforcement when required by applicable law',
        ],
      },
      {
        heading: '5. Retention & security',
        paragraphs: [
          'We retain records for as long as needed to deliver services, resolve disputes, and meet medical/legal retention requirements, then delete or anonymise where feasible.',
          'We use access controls, encrypted transport (HTTPS), and operational safeguards. No method of transmission or storage is 100% secure.',
        ],
      },
      {
        heading: '6. Your choices',
        paragraphs: [
          `You may request access, correction, or deletion of account data (subject to legal retention for medical/payment records) by writing to ${SUPPORT}. You can withdraw non-essential consents and manage notification preferences in your account where available.`,
        ],
      },
      {
        heading: '7. Children',
        paragraphs: [
          'Guardians should book and manage services for minors. We do not knowingly create independent accounts for children without guardian involvement.',
        ],
      },
      {
        heading: '8. Changes',
        paragraphs: [
          'We may update this policy. The “Last updated” date above will change when we do. Continued use after updates means you accept the revised policy.',
        ],
      },
    ],
  },

  disclaimer: {
    id: 'disclaimer',
    title: 'Disclaimer',
    updated: UPDATED,
    summary: `Important limits on medical advice, content, and third-party services on the ${BRAND} platform.`,
    sections: [
      {
        heading: '1. Not a substitute for medical care',
        paragraphs: [
          `${ORG} provides technology and logistics to book diagnostics, pharmacy fulfilment, wellness, and related services. Content on the website (including AI-assisted suggestions, articles, and package descriptions) is for general information only and is not a diagnosis, prescription, or personalised medical advice.`,
          'Always consult a qualified clinician for medical decisions. In an emergency, call local emergency services immediately.',
        ],
      },
      {
        heading: '2. Reports & results',
        paragraphs: [
          'Laboratory reports are generated by participating labs/centres based on samples collected. Turnaround times are estimates. Interpret results only with a registered medical practitioner.',
        ],
      },
      {
        heading: '3. Medicines & wellness',
        paragraphs: [
          'Pharmacy and wellness offerings depend on prescription rules, stock, and local regulations. Schedule and outcome of wellness/aesthetic services may vary by centre and clinical assessment.',
        ],
      },
      {
        heading: '4. Third parties',
        paragraphs: [
          'Payment gateways, maps, messaging, and partner franchisees operate under their own terms. We are not responsible for outages or acts outside our reasonable control.',
        ],
      },
      {
        heading: '5. No warranties',
        paragraphs: [
          'The platform is provided on an “as available” basis. To the fullest extent permitted by law, we disclaim implied warranties of uninterrupted access, merchantability, or fitness for a particular purpose, except where we expressly commit in a service contract or invoice.',
        ],
      },
    ],
  },

  'terms-and-conditions': {
    id: 'terms-and-conditions',
    title: 'Terms & Conditions',
    updated: UPDATED,
    summary: `Rules for using ${SITE}, creating an account, and placing orders with ${BRAND}.`,
    sections: [
      {
        heading: '1. Acceptance',
        paragraphs: [
          `By accessing ${SITE} or related apps, creating an account, or placing an order, you agree to these Terms & Conditions, our Privacy Policy, Refund Policy, and Data Use Policy.`,
        ],
      },
      {
        heading: '2. Eligibility & accounts',
        paragraphs: [
          'You must provide accurate mobile/email details and keep OTP credentials confidential. You are responsible for activity under your account. We may suspend accounts for fraud, abuse, or legal risk.',
        ],
      },
      {
        heading: '3. Services',
        paragraphs: [
          `${BRAND} may offer lab tests, home sample collection, pharmacy orders, doctor appointments, wellness/aesthetic bookings, insurance assistance, memberships, and referrals. Availability varies by city, centre capacity, and regulatory rules.`,
          'Prices shown may include promotional FOCO/offer rates, membership discounts, coupons, or wallet credits. Final payable amount is confirmed at checkout.',
        ],
      },
      {
        heading: '4. Bookings & fulfilment',
        paragraphs: [
          'You authorise us and our partners to contact you for scheduling, collection, delivery, and clinical follow-up related to your order. Sample collection and in-centre services depend on your availability and accurate address/ID details.',
        ],
      },
      {
        heading: '5. Payments',
        paragraphs: [
          'Payments are processed via authorised gateways. Wallet points and coupons apply only as displayed at checkout and may have expiry or category limits. Taxes, if applicable, will be shown where required.',
        ],
      },
      {
        heading: '6. Acceptable use',
        paragraphs: [
          'You agree not to misuse the platform, scrape data, reverse-engineer systems, submit false prescriptions/identity, or interfere with other users or centres.',
        ],
      },
      {
        heading: '7. Liability',
        paragraphs: [
          'To the extent permitted by Indian law, our aggregate liability for a claim relating to a specific paid order is limited to the amount you paid for that order. We are not liable for indirect or consequential losses.',
        ],
      },
      {
        heading: '8. Governing law',
        paragraphs: [
          `These terms are governed by the laws of India. Courts at Kolkata, West Bengal shall have exclusive jurisdiction, subject to mandatory consumer protections.`,
          `Questions: ${SUPPORT}.`,
        ],
      },
    ],
  },

  'refund-policy': {
    id: 'refund-policy',
    title: 'Refund Policy',
    updated: UPDATED,
    summary: `When ${BRAND} issues refunds, cancellations, or wallet credits for paid orders.`,
    sections: [
      {
        heading: '1. General',
        paragraphs: [
          `Refunds depend on service type and fulfilment stage. Approved refunds are returned to the original payment method or ${BRAND} wallet within 5–10 business days after approval (bank timelines may vary).`,
        ],
      },
      {
        heading: '2. Lab tests & home collection',
        paragraphs: [
          'Full refund (or wallet credit) if we cancel due to operational inability, or if you cancel before the phlebotomist is dispatched / before sample collection starts.',
          'After sample collection, fees are generally non-refundable because consumables and processing have begun. Partial exceptions may apply for failed draws attributable to us, duplicate charges, or test cancellation by the lab before processing.',
        ],
      },
      {
        heading: '3. Pharmacy',
        paragraphs: [
          'Cancellations before dispatch may be refunded in full. After dispatch, returns follow applicable pharmacy/drug regulations; opened or cold-chain items usually cannot be returned.',
        ],
      },
      {
        heading: '4. Appointments & wellness',
        paragraphs: [
          'Doctor or wellness bookings cancelled within the centre’s notice window may be refunded or rescheduled. Late cancellations or no-shows may attract fees as shown at booking.',
        ],
      },
      {
        heading: '5. Memberships, coupons & wallet',
        paragraphs: [
          'Membership fees follow the plan terms at purchase. Promo discounts and wallet rewards are not cash-withdrawable unless required by law. Refunds of the cash component of an order may reverse proportional wallet earn where applicable.',
        ],
      },
      {
        heading: '6. How to request',
        paragraphs: [
          `Email ${SUPPORT} with order ID, payment reference, and reason. We may ask for identity verification before processing.`,
        ],
      },
    ],
  },

  'data-use-policy': {
    id: 'data-use-policy',
    title: 'Data Use Policy',
    updated: UPDATED,
    summary: `How ${BRAND} processes personal and health data across product verticals, aligned with Indian privacy expectations.`,
    sections: [
      {
        heading: '1. Purpose limitation',
        paragraphs: [
          'We process data only for clear purposes: delivering healthcare logistics and digital services you request, securing the platform, complying with law, and—only with appropriate notice/consent—improving products or sending optional marketing.',
        ],
      },
      {
        heading: '2. Categories of processing',
        paragraphs: [],
        bullets: [
          'Account & authentication — to create and secure your login',
          'Orders & clinical fulfilment — to schedule collection, run tests, dispense medicines, and share reports with you',
          'Payments & wallet — to settle charges, refunds, and loyalty credits',
          'Support & quality — to resolve tickets and investigate incidents',
          'Analytics (aggregated/de-identified where possible) — to improve reliability and catalogue relevance',
        ],
      },
      {
        heading: '3. Health data',
        paragraphs: [
          'Health-related data is treated as sensitive. Access is limited to personnel and partners who need it to fulfil your request. We do not use your identifiable health reports for advertising.',
        ],
      },
      {
        heading: '4. Legal bases',
        paragraphs: [
          'We rely on your consent (e.g., OTP, optional marketing), performance of a contract (fulfilling bookings), legitimate interests (security, fraud prevention), and legal obligations (tax, healthcare record retention).',
        ],
      },
      {
        heading: '5. Cross-border & subprocessors',
        paragraphs: [
          'Primary operations are in India. If a cloud or messaging subprocessor stores data outside India, we seek contractual safeguards consistent with applicable law.',
        ],
      },
      {
        heading: '6. Your rights',
        paragraphs: [
          `Subject to law, you may request access, correction, erasure, withdrawal of consent, or a copy of data we hold. Contact ${SUPPORT}. We may refuse or limit requests where retention is legally required (for example, completed lab records or invoices).`,
        ],
      },
      {
        heading: '7. Relationship to Privacy Policy',
        paragraphs: [
          'This Data Use Policy complements our Privacy Policy. If there is a conflict on a specific processing activity, the more specific description in the Privacy Policy or in-product notice applies.',
        ],
      },
    ],
  },
};
