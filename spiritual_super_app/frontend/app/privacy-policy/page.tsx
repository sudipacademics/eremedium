import Link from 'next/link';

import { InfoPage, PolicySection } from '@/components/InfoPage';
import { LEGAL_CONTACT_EMAIL } from '@/lib/social';

const linkClass = 'font-semibold text-ved-gold-600 hover:underline';

export default function PrivacyPolicyPage() {
  return (
    <InfoPage eyebrow="Support" title="Privacy Policy" updated="24 September 2026">
      <PolicySection title="Overview">
        <p>
          Your privacy matters to us. This policy summarises how Vedsutra collects and uses your information when
          you use our website and apps. Full details, including your legal rights, are in our{' '}
          <Link href="/data-protection" className={linkClass}>Data Protection Policy</Link>.
        </p>
      </PolicySection>
      <PolicySection title="Information we collect">
        <ul>
          <li>Your mobile number, which is also how you sign in, plus the name and optional profile details you add.</li>
          <li>Birth details you provide for charts, Panchang and puja sankalp.</li>
          <li>Wallet, booking and order history. Card and UPI details are handled by our payment partner, not stored by us.</li>
          <li>Consultation times, durations and charges. We do not record calls.</li>
          <li>Basic device and usage information needed for security and reliability.</li>
        </ul>
      </PolicySection>
      <PolicySection title="How we use it">
        <ul>
          <li>To deliver the readings, consultations, pujas and orders you ask for, and to issue invoices.</li>
          <li>To share only what is needed with the astrologer, temple or courier serving you.</li>
          <li>To keep accounts secure, prevent fraud and meet legal obligations.</li>
        </ul>
        <p>We never sell your personal data.</p>
      </PolicySection>
      <PolicySection title="Cookies">
        <p>
          We use essential cookies and local storage to keep you signed in and remember preferences such as your
          chart style and language. We do not use them for third-party advertising.
        </p>
      </PolicySection>
      <PolicySection title="Your choices">
        <ul>
          <li>Review and update your details from your profile, and sign out of other devices at any time.</li>
          <li>Ask for a copy of your data, or for your account to be deleted, subject to records we must keep by law.</li>
        </ul>
      </PolicySection>
      <PolicySection title="Contact">
        <p>Questions about privacy? Email {LEGAL_CONTACT_EMAIL}.</p>
      </PolicySection>
    </InfoPage>
  );
}
