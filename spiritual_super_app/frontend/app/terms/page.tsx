import Link from 'next/link';

import { InfoPage, PolicySection } from '@/components/InfoPage';
import { LEGAL_CONTACT_EMAIL } from '@/lib/social';

export default function TermsPage() {
  return (
    <InfoPage eyebrow="Legal" title="Terms & Conditions" updated="24 September 2026">
      <PolicySection title="1. Acceptance">
        <p>
          By creating an account or using Vedsutra (the website, apps and related services), you agree
          to these Terms, our{' '}
          <Link href="/disclaimer" className="font-semibold text-ved-gold-600 hover:underline">
            Disclaimer
          </Link>
          ,{' '}
          <Link href="/refund-policy" className="font-semibold text-ved-gold-600 hover:underline">
            Refund Policy
          </Link>{' '}
          and{' '}
          <Link href="/data-protection" className="font-semibold text-ved-gold-600 hover:underline">
            Data Protection Policy
          </Link>
          . If you do not agree, please do not use the platform.
        </p>
      </PolicySection>
      <PolicySection title="2. Eligibility and account">
        <ul>
          <li>You must be at least 18 years old, or use Vedsutra under the supervision of a parent or guardian.</li>
          <li>You sign in with your mobile number and a one-time code. Keep access to that number secure; activity on your account is treated as yours.</li>
          <li>Provide accurate details, including birth information, for readings to be meaningful.</li>
        </ul>
      </PolicySection>
      <PolicySection title="3. Services">
        <p>
          Vedsutra offers astrology consultations by chat, voice and video, Kundali, Panchang, Gochar
          and compatibility tools, AI-assisted insights, E-Puja bookings with partner temples, a Virtual
          Temple, and an Ayurveda shop. Features may change, be suspended or be discontinued.
        </p>
      </PolicySection>
      <PolicySection title="4. Wallet and payments">
        <ul>
          <li>Paid services are charged from your Vedsutra wallet, which you top up through our payment partner.</li>
          <li>Consultations are billed per minute at the astrologer&apos;s displayed rate while the session is active, and end automatically if your balance runs out.</li>
          <li>E-Puja and Ayurveda prices are those shown at the time of booking or ordering.</li>
          <li>Wallet balance is not interest-bearing, cannot be transferred, and may only be used on Vedsutra.</li>
        </ul>
      </PolicySection>
      <PolicySection title="5. Acceptable use">
        <ul>
          <li>Treat astrologers, temple staff and other users with respect; abuse or harassment may lead to suspension.</li>
          <li>Do not misuse the platform, attempt to access other accounts, disrupt the service or scrape content.</li>
          <li>Do not record or republish consultations without the astrologer&apos;s consent.</li>
        </ul>
      </PolicySection>
      <PolicySection title="6. Intellectual property">
        <p>
          The Vedsutra name, logo, design and content belong to Vedsutra or its licensors. You may use
          them only for personal, non-commercial use of the platform.
        </p>
      </PolicySection>
      <PolicySection title="7. Limitation of liability">
        <p>
          Services are provided on an &quot;as is&quot; basis. To the extent permitted by law, Vedsutra&apos;s
          total liability for any claim is limited to the amount you paid for the service concerned.
        </p>
      </PolicySection>
      <PolicySection title="8. Suspension and termination">
        <p>
          We may suspend or close accounts that breach these Terms or the law. You may stop using
          Vedsutra at any time; unused wallet balance is handled as described in the Refund Policy.
        </p>
      </PolicySection>
      <PolicySection title="9. Governing law">
        <p>
          These Terms are governed by the laws of India. Disputes are subject to the jurisdiction of
          the competent courts in India.
        </p>
      </PolicySection>
      <PolicySection title="10. Changes and contact">
        <p>
          We may update these Terms; continued use after an update means you accept the revised
          version. Contact us at {LEGAL_CONTACT_EMAIL}.
        </p>
      </PolicySection>
    </InfoPage>
  );
}
