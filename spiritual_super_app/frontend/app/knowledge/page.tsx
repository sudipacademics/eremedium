import Link from 'next/link';

import { InfoPage } from '@/components/InfoPage';

const TOPICS = [
  {
    icon: '☀',
    title: 'Panchang',
    body: 'The Vedic almanac of five limbs — tithi (lunar day), vaara (weekday), nakshatra, yoga and karana — used to pick auspicious times for rituals and new beginnings.',
    href: '/panchang',
    cta: "See today's Panchang",
  },
  {
    icon: '✦',
    title: 'Nakshatra',
    body: 'The 27 lunar mansions the Moon travels through each month. Your birth nakshatra shapes temperament, and decides where your Vimshottari dasha begins.',
    href: '/kundali',
    cta: 'Find your nakshatra',
  },
  {
    icon: '◎',
    title: 'Kundali & Dasha',
    body: 'A birth chart maps the sidereal positions of the planets at your moment of birth across twelve houses. Dashas are the planetary periods that time when those promises unfold.',
    href: '/kundali',
    cta: 'Generate your Kundali',
  },
  {
    icon: '☾',
    title: 'Gochar (transits)',
    body: 'Gochar tracks where the planets are today relative to your natal Moon and ascendant — the everyday lens for what the coming weeks may bring.',
    href: '/gochar',
    cta: 'Check current transits',
  },
  {
    icon: '⚭',
    title: 'Guna Milan',
    body: 'The traditional Ashtakoota compatibility check scores eight aspects of two charts out of 36 points, alongside a Manglik assessment.',
    href: '/match',
    cta: 'Match two charts',
  },
  {
    icon: '🌿',
    title: 'Doshas in Ayurveda',
    body: 'Vata, Pitta and Kapha are the three functional energies of the body. Knowing your prakriti (constitution) guides diet, routine and remedies.',
    href: '/ayurveda',
    cta: 'Explore Ayurveda',
  },
  {
    icon: '🕯',
    title: 'Puja & Sankalp',
    body: 'A puja begins with sankalp — a stated intention with your name and gotra — so the ritual is performed on your behalf by the temple priests.',
    href: '/pujas',
    cta: 'Book an E-Puja',
  },
  {
    icon: '🛕',
    title: 'Shodashopachar',
    body: 'The sixteen classic offerings made to a deity, from invocation and water to flowers, lamp, naivedyam and aarti.',
    href: '/temple',
    cta: 'Visit the Virtual Temple',
  },
] as const;

export default function KnowledgePage() {
  return (
    <InfoPage
      eyebrow="Knowledge"
      title="Understand the Vedic sciences"
      intro="Short, plain-language introductions to the ideas behind every Vedsutra tool — then try each one for yourself."
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOPICS.map((topic) => (
          <article
            key={topic.title}
            className="flex flex-col rounded-2xl border border-ved-green-900/8 bg-white p-5 shadow-sm"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-ved-green-50 text-xl text-ved-green-700">
              {topic.icon}
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold text-ved-green-900">{topic.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ved-green-800/65">{topic.body}</p>
            <Link href={topic.href} className="mt-4 text-xs font-semibold text-ved-green-700 hover:underline">
              {topic.cta} →
            </Link>
          </article>
        ))}
      </div>
      <p className="mt-10 text-center text-sm text-ved-green-800/60">
        Want to go deeper? Read the{' '}
        <Link href="/articles" className="font-semibold text-ved-gold-600 hover:underline">
          Vedsutra blog
        </Link>{' '}
        or{' '}
        <Link href="/astrologers" className="font-semibold text-ved-gold-600 hover:underline">
          consult an expert
        </Link>
        .
      </p>
    </InfoPage>
  );
}
