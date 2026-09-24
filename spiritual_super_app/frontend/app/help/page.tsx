import Link from 'next/link';

import { InfoPage, PolicySection } from '@/components/InfoPage';
import { LEGAL_CONTACT_EMAIL } from '@/lib/social';

const TOPICS = [
  { href: '/how-it-works', title: 'How It Works', text: 'Signing in, adding money to your wallet and starting a consultation.' },
  { href: '/faq', title: 'FAQ', text: 'Quick answers about charges, pujas, orders and your account.' },
  { href: '/refund-policy', title: 'Refunds', text: 'When and how wallet top-ups, sessions, pujas and orders are refunded.' },
  { href: '/privacy-policy', title: 'Privacy', text: 'What we collect, why, and how to control your data.' },
] as const;

const linkClass = 'font-semibold text-ved-gold-600 hover:underline';

export default function HelpCentrePage() {
  return (
    <InfoPage
      eyebrow="Support"
      title="Help Centre"
      intro="Find answers, manage your account, or reach our support team."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {TOPICS.map((topic) => (
          <Link
            key={topic.href}
            href={topic.href}
            className="rounded-2xl border border-ved-green-900/10 bg-white/70 p-5 transition hover:border-ved-gold-400/60 hover:shadow-sm"
          >
            <p className="font-display text-xl font-semibold text-ved-green-900">{topic.title}</p>
            <p className="mt-1 text-sm text-ved-green-800/70">{topic.text}</p>
          </Link>
        ))}
      </div>

      <div className="mt-12">
        <PolicySection title="Your account">
          <ul>
            <li>
              Update your name, birth details and address, download invoices, or sign out of other devices from your{' '}
              <Link href="/profile" className={linkClass}>profile</Link>.
            </li>
            <li>
              Check your balance and transactions, or add money, from your{' '}
              <Link href="/wallet" className={linkClass}>wallet</Link>.
            </li>
          </ul>
        </PolicySection>
        <PolicySection title="Contact support">
          <p>
            Email {LEGAL_CONTACT_EMAIL} from the mobile number or email on your account. For a payment, session or
            order issue, include the invoice or order number. We respond within 3 working days.
          </p>
        </PolicySection>
      </div>
    </InfoPage>
  );
}
