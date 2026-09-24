import { InfoPage, PolicySection } from '@/components/InfoPage';
import { LEGAL_CONTACT_EMAIL } from '@/lib/social';

export default function DataProtectionPage() {
  return (
    <InfoPage eyebrow="Legal" title="Data Protection Policy" updated="24 September 2026">
      <PolicySection title="Our commitment">
        <p>
          Vedsutra processes personal data in line with India&apos;s Digital Personal Data Protection
          Act, 2023 and the Information Technology Act, 2000. This policy explains what we collect, why,
          and the choices you have.
        </p>
      </PolicySection>
      <PolicySection title="What we collect">
        <ul>
          <li><strong>Account:</strong> mobile number (your login), name, and optionally email, address and profile photo.</li>
          <li><strong>Birth details:</strong> date, time and place of birth and gotra, used to compute charts, Panchang and sankalp.</li>
          <li><strong>Orders and payments:</strong> wallet transactions, bookings, orders and shipping details. Card and UPI details are handled by our payment partner and never stored by Vedsutra.</li>
          <li><strong>Consultations:</strong> session times, duration and charges. Calls are connected in real time; we do not record audio or video.</li>
          <li><strong>Technical:</strong> device, browser and IP information needed for security and to keep the service running.</li>
        </ul>
      </PolicySection>
      <PolicySection title="How we use it">
        <ul>
          <li>To provide readings, charts, consultations, pujas, orders and invoices you request.</li>
          <li>To share necessary details with the astrologer you consult (such as your name and birth chart) and with temples and couriers fulfilling your booking or order.</li>
          <li>To secure accounts, prevent fraud and meet legal, tax and accounting obligations.</li>
        </ul>
        <p>We do not sell your personal data.</p>
      </PolicySection>
      <PolicySection title="Storage and security">
        <p>
          Data is stored on secured servers with encrypted connections, access controls and one-time
          codes for sign-in. You can sign out of all other devices from your profile at any time.
          Records are kept only as long as needed for the purposes above or as required by law.
        </p>
      </PolicySection>
      <PolicySection title="Your rights">
        <ul>
          <li>Access and correct your details from your profile, or ask us for a copy of your data.</li>
          <li>Withdraw consent or request deletion of your account, subject to records we must keep by law.</li>
          <li>Nominate a person to exercise these rights on your behalf, and raise a grievance with us or, after that, the Data Protection Board of India.</li>
        </ul>
      </PolicySection>
      <PolicySection title="Grievance officer">
        <p>
          Contact our grievance officer at {LEGAL_CONTACT_EMAIL}. We acknowledge requests within 72
          hours and aim to resolve them within 30 days.
        </p>
      </PolicySection>
    </InfoPage>
  );
}
