import { InfoPage, PolicySection } from '@/components/InfoPage';

const STEPS = [
  { title: 'Sign in with your mobile', text: 'Enter your mobile number and the one-time code we send. No password needed.' },
  { title: 'Add your birth details', text: 'Date, time and place of birth power your Kundali, Panchang and personalised readings.' },
  { title: 'Top up your wallet', text: 'Add money securely by UPI or card. Consultations, pujas and orders are paid from your wallet.' },
  { title: 'Consult, book or shop', text: 'Talk to a verified astrologer, book an e-puja at a temple, or order Ayurveda products.' },
] as const;

export default function HowItWorksPage() {
  return (
    <InfoPage
      eyebrow="Support"
      title="How It Works"
      intro="Vedsutra brings astrology, ritual and Ayurveda together in a few simple steps."
    >
      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-2xl border border-ved-green-900/10 bg-white/70 p-5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ved-green-900 text-sm font-semibold text-ved-gold-300">
              {index + 1}
            </span>
            <p className="mt-3 font-display text-xl font-semibold text-ved-green-900">{step.title}</p>
            <p className="mt-1 text-sm text-ved-green-800/70">{step.text}</p>
          </li>
        ))}
      </ol>

      <div className="mt-12">
        <PolicySection title="Consultations">
          <ul>
            <li>Each astrologer shows a per-minute rate before you connect.</li>
            <li>You are billed only while a session is active, and the session ends automatically if your balance runs out.</li>
            <li>Calls are connected in real time and are not recorded.</li>
          </ul>
        </PolicySection>
        <PolicySection title="E-Pujas">
          <p>
            Choose a puja and temple, share your name and gotra for the sankalp, and the temple performs it on the
            scheduled date. You can follow your booking status from your account.
          </p>
        </PolicySection>
        <PolicySection title="Ayurveda shop">
          <p>
            Order authentic products paid from your wallet. Orders are shipped to the address on your profile and
            can be cancelled until dispatch.
          </p>
        </PolicySection>
        <PolicySection title="Invoices">
          <p>Every paid transaction generates an invoice you can download from your profile.</p>
        </PolicySection>
      </div>
    </InfoPage>
  );
}
