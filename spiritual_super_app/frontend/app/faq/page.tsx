import { InfoPage } from '@/components/InfoPage';
import { LEGAL_CONTACT_EMAIL } from '@/lib/social';

const FAQS = [
  {
    q: 'How do I sign in?',
    a: 'Enter your mobile number and the one-time code we send by SMS. There is no password to remember.',
  },
  {
    q: 'How am I charged for a consultation?',
    a: 'Each astrologer shows a per-minute rate. You are billed only for minutes while the session is active, from your wallet balance. You are not charged if a session fails to connect.',
  },
  {
    q: 'Are my calls recorded?',
    a: 'No. Calls are connected in real time and we do not record audio or video.',
  },
  {
    q: 'Why do you need my birth time and place?',
    a: 'They are used to calculate your Kundali, divisional charts and Panchang accurately. The more precise your birth time, the more accurate the chart.',
  },
  {
    q: 'Can I cancel an e-puja booking?',
    a: 'Yes, for a full wallet credit until the temple begins the puja. Once it is in progress or performed it cannot be refunded.',
  },
  {
    q: 'How do I get a refund on my wallet balance?',
    a: `Email ${LEGAL_CONTACT_EMAIL} with your request. Unused balance can be refunded to the original payment method, less any payment-gateway charges. See the Refund Policy for details.`,
  },
  {
    q: 'Where can I find my invoices?',
    a: 'Every paid transaction has an invoice you can download from your profile.',
  },
  {
    q: 'I think someone else is signed in to my account. What should I do?',
    a: 'Open your profile and choose “Sign out other devices”. You will confirm with a one-time code, and every other session is ended immediately.',
  },
] as const;

export default function FaqPage() {
  return (
    <InfoPage eyebrow="Support" title="Frequently Asked Questions" intro="Quick answers to the questions we hear most.">
      <div className="space-y-3">
        {FAQS.map((item) => (
          <details
            key={item.q}
            className="group rounded-2xl border border-ved-green-900/10 bg-white/70 px-5 py-4 open:border-ved-gold-400/50"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold text-ved-green-900 [&::-webkit-details-marker]:hidden">
              {item.q}
              <span aria-hidden className="text-ved-gold-600 transition group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-ved-green-800/80">{item.a}</p>
          </details>
        ))}
      </div>
    </InfoPage>
  );
}
