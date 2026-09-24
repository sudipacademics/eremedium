import Link from 'next/link';

import { InfoPage, PolicySection } from '@/components/InfoPage';
import { LEGAL_CONTACT_EMAIL } from '@/lib/social';

export default function RefundPolicyPage() {
  return (
    <InfoPage eyebrow="Legal" title="Refund Policy" updated="24 September 2026">
      <PolicySection title="Wallet top-ups">
        <ul>
          <li>If a payment is debited but does not reach your wallet, it is credited or reversed to the original payment method, usually within 5–7 working days.</li>
          <li>Duplicate payments for the same top-up are refunded to the original payment method.</li>
          <li>Other unused wallet balance can be refunded on request, less any payment-gateway charges, to the original payment method.</li>
        </ul>
      </PolicySection>
      <PolicySection title="Consultations">
        <ul>
          <li>You are billed only for minutes while a session is active; you are not charged if a session fails to connect.</li>
          <li>If a call drops because of a technical fault on our side, the affected minutes are credited back to your wallet after review.</li>
          <li>Dissatisfaction with the content of a reading is not by itself grounds for a refund.</li>
        </ul>
      </PolicySection>
      <PolicySection title="E-Puja bookings">
        <ul>
          <li>Bookings can be cancelled for a full wallet credit until the temple begins the puja.</li>
          <li>Once the puja is in progress or performed, the booking cannot be refunded.</li>
          <li>If the temple is unable to perform the puja, you receive a full wallet credit or an alternative date.</li>
        </ul>
      </PolicySection>
      <PolicySection title="Ayurveda shop">
        <ul>
          <li>Orders can be cancelled for a full wallet credit until they are dispatched.</li>
          <li>Damaged, defective or incorrect items reported within 7 days of delivery, with photos, are replaced or credited.</li>
          <li>Opened consumables cannot be returned for hygiene reasons.</li>
        </ul>
      </PolicySection>
      <PolicySection title="How to request a refund">
        <p>
          Email {LEGAL_CONTACT_EMAIL} from the details on your account with the invoice number (see{' '}
          <Link href="/profile" className="font-semibold text-ved-gold-600 hover:underline">
            Download invoices
          </Link>{' '}
          on your profile) and a short description. We respond within 3 working days. Approved wallet
          credits are applied immediately; refunds to a bank or card depend on your bank&apos;s processing
          time.
        </p>
      </PolicySection>
    </InfoPage>
  );
}
