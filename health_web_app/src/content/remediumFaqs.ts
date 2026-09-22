/** Source: Website FAQ – Remedium Healthcare Ecosystem (Smilecure / Remedium). */

export type FaqSection = {
  id: string;
  title: string;
  items: Array<{ question: string; answer: string }>;
};

export const REMEDIUM_FAQ_SECTIONS: FaqSection[] = [
  {
    id: 'about-remedium',
    title: 'About Remedium',
    items: [
      {
        question: 'What is Remedium?',
        answer:
          'Remedium is a trusted healthcare brand committed to delivering quality diagnostic, wellness, and aesthetic services through its specialized divisions and a customer-first approach.',
      },
      {
        question: 'What are the main divisions of Remedium?',
        answer:
          'Remedium operates through three major healthcare divisions: Remedium Labs for diagnostics and pathology, Remedium Aesthetic for skin and aesthetic treatments, and Remedium Care for healthcare and patient-support services.',
      },
      {
        question: 'Who operates Remedium?',
        answer:
          'Remedium is operated by Smilecure Lifestyle Private Limited through its healthcare divisions, service centres and franchise network.',
      },
      {
        question: 'Where are Remedium services available?',
        answer:
          'Remedium services are available through participating centres and franchise locations. Service availability may vary depending on the city, branch and type of healthcare service required.',
      },
    ],
  },
  {
    id: 'remedium-labs',
    title: 'Remedium Labs',
    items: [
      {
        question: 'What services does Remedium Labs provide?',
        answer:
          'Remedium Labs provides diagnostic and pathology services including blood tests, urine and stool tests, preventive health checkups, home sample collection and digital diagnostic report access.',
      },
      {
        question: 'Can I book a blood test through Remedium Labs?',
        answer:
          'Yes. Patients can book available blood and pathology tests through participating Remedium Labs centres and supported digital booking channels.',
      },
      {
        question: 'Does Remedium Labs provide home sample collection?',
        answer:
          "Yes. Home sample collection is available in eligible service areas. Trained phlebotomy personnel collect blood and selected diagnostic samples from the patient's location.",
      },
      {
        question: 'What types of diagnostic tests are available?',
        answer:
          'Available tests may include CBC, blood sugar, thyroid profile, lipid profile, liver function, kidney function, urine testing, stool testing and other routine or specialized pathology investigations.',
      },
      {
        question: 'How can I receive my diagnostic report?',
        answer:
          'Diagnostic reports may be provided digitally or through the respective Remedium Labs centre after laboratory processing. Availability and turnaround time depend on the test performed.',
      },
    ],
  },
  {
    id: 'remedium-aesthetic',
    title: 'Remedium Aesthetic',
    items: [
      {
        question: 'What services does Remedium Aesthetic offer?',
        answer:
          'Remedium Aesthetic provides professional skin, hair and aesthetic services including laser hair reduction, skin rejuvenation, chemical peels, pigmentation care, acne and scar management and anti-ageing treatments.',
      },
      {
        question: 'Does Remedium Aesthetic provide laser hair reduction?',
        answer:
          'Yes. Remedium Aesthetic offers laser hair reduction for suitable facial and body areas. Treatment plans are selected after consultation based on skin type, hair characteristics and individual requirements.',
      },
      {
        question: 'Do I need a consultation before an aesthetic treatment?',
        answer:
          'Consultation is recommended before aesthetic procedures so that the appropriate treatment, suitability, expected outcome and required number of sessions can be assessed.',
      },
      {
        question: 'Does Remedium Aesthetic provide treatment for pigmentation and acne scars?',
        answer:
          'Yes. Suitable pigmentation, acne and scar-management procedures are available. The recommended treatment depends on the condition, skin type and professional assessment.',
      },
    ],
  },
  {
    id: 'remedium-care',
    title: 'Remedium Care',
    items: [
      {
        question: 'What is Remedium Care?',
        answer:
          'Remedium Care is the healthcare and patient-support division of the Remedium ecosystem, designed to provide accessible healthcare services and coordinated patient support.',
      },
      {
        question: 'What healthcare services are available through Remedium Care?',
        answer:
          'Services may include primary healthcare support, physiotherapy, home healthcare, pharmacy assistance, preventive healthcare and patient-care coordination depending on location and availability.',
      },
      {
        question: 'Does Remedium Care provide physiotherapy services?',
        answer:
          'Yes. Remedium Care at Ashoknagar offers assessment-led physiotherapy and rehab with a Recovery Blueprint, tech-led treatment zones, and session-tracked progress. Book at /wellness/care.',
      },
      {
        question: 'Are home healthcare services available?',
        answer:
          'Selected home healthcare and patient-support services are available in eligible locations. Availability depends on the type of care required and the service coverage of the local Remedium centre.',
      },
    ],
  },
  {
    id: 'remedium-franchise',
    title: 'Remedium Franchise',
    items: [
      {
        question: 'Does Remedium offer healthcare franchise opportunities?',
        answer:
          'Yes. Remedium offers franchise and business partnership opportunities for entrepreneurs interested in developing diagnostic and healthcare service centres under the Remedium brand.',
      },
      {
        question: 'What franchise models are available with Remedium?',
        answer:
          'Available franchise models may include FOCO, FOFO, Diagnostic Collection Centre and Master Franchise opportunities depending on territory, business eligibility and company expansion plans.',
      },
      {
        question: 'What is a Remedium FOCO franchise?',
        answer:
          'FOCO stands for Franchise Owned Company Operated. The franchise partner owns or invests in the centre while Remedium provides structured operational support according to the applicable franchise agreement.',
      },
      {
        question: 'What is a Remedium FOFO franchise?',
        answer:
          'FOFO stands for Franchise Owned Franchise Operated. The franchise partner owns and operates the centre while receiving approved branding, technology, operational and business support from Remedium.',
      },
      {
        question: 'Does Remedium provide franchise setup support?',
        answer:
          'Yes. Depending on the franchise model, support may include site planning, branding, technology, operational workflow, recruitment, training, logistics and local business development assistance.',
      },
      {
        question: 'Can I apply for a Remedium franchise in my pincode?',
        answer:
          'Yes. Applicants can enquire about franchise opportunities for their preferred pincode or territory. Availability depends on existing coverage, territorial eligibility and company approval.',
      },
      {
        question: 'How do I apply for a Remedium franchise?',
        answer:
          'You can submit a franchise enquiry through the official Remedium website. The franchise team will review your preferred location, business profile and selected model before proceeding with verification and onboarding.',
      },
    ],
  },
  {
    id: 'booking-support',
    title: 'Booking & Support',
    items: [
      {
        question: 'How can I contact Remedium?',
        answer:
          'Customers and franchise applicants can contact Remedium through the official website, participating centres or authorized customer-support channels.',
      },
      {
        question: 'Can I find the nearest Remedium centre online?',
        answer:
          'Yes. Customers can search for available Remedium Labs, Remedium Aesthetic and Remedium Care locations through the official website and supported location-search services.',
      },
      {
        question: 'Can I book Remedium services online?',
        answer:
          'Online booking may be available for selected diagnostic, aesthetic and healthcare services. Available booking options depend on the service and participating Remedium location.',
      },
      {
        question: 'Are all Remedium services available at every centre?',
        answer:
          'No. Services can vary by centre, location and division. Customers should check the respective centre page or contact the branch to confirm service availability before visiting.',
      },
    ],
  },
];

/** Flat FAQ row for Schema.org. */
export type FaqItem = { question: string; answer: string };

/** Flat list for Schema.org FAQPage JSON-LD. */
export function flatRemediumFaqs(): FaqItem[] {
  return REMEDIUM_FAQ_SECTIONS.flatMap((section) => section.items);
}
