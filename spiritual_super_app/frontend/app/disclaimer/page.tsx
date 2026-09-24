import { InfoPage, PolicySection } from '@/components/InfoPage';
import { LEGAL_CONTACT_EMAIL } from '@/lib/social';

export default function DisclaimerPage() {
  return (
    <InfoPage eyebrow="Legal" title="Disclaimer" updated="24 September 2026">
      <PolicySection title="Guidance, not guarantees">
        <p>
          Astrology, Panchang, Vastu and related Vedic sciences offered on Vedsutra are traditional
          systems of guidance. Readings, predictions, remedies and AI-generated insights reflect the
          interpretation of the astrologer or system involved and are provided for spiritual and
          informational purposes only. They are not a guarantee of any outcome.
        </p>
      </PolicySection>
      <PolicySection title="Not professional advice">
        <p>
          Nothing on Vedsutra is a substitute for professional medical, psychological, legal, financial
          or other expert advice. Do not delay seeking, or disregard, qualified professional advice
          because of anything you read or hear on the platform.
        </p>
      </PolicySection>
      <PolicySection title="Ayurveda products">
        <p>
          Ayurvedic products and dosha tags are traditional wellness suggestions, not medical claims.
          They are not intended to diagnose, treat, cure or prevent any disease. Consult a qualified
          physician before use, particularly if you are pregnant, nursing, taking medication or have a
          medical condition.
        </p>
      </PolicySection>
      <PolicySection title="Astrologers and temples">
        <p>
          Consultations are delivered by independent astrologers, and E-Pujas are performed by partner
          temples. Their views are their own. Vedsutra facilitates the service but does not endorse any
          specific prediction or advice.
        </p>
      </PolicySection>
      <PolicySection title="Your decisions">
        <p>
          You are solely responsible for decisions you make based on content or services from
          Vedsutra. To the extent permitted by law, Vedsutra is not liable for any loss arising from
          reliance on them.
        </p>
      </PolicySection>
      <PolicySection title="Contact">
        <p>Questions about this disclaimer can be sent to {LEGAL_CONTACT_EMAIL}.</p>
      </PolicySection>
    </InfoPage>
  );
}
