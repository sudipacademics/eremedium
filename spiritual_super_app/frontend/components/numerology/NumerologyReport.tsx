'use client';

import Link from 'next/link';

import type { NumberMeaning, NumerologyNumbers, NumerologyReading } from '@/lib/api';

export const CORE_NUMBERS: readonly {
  key: Exclude<keyof NumerologyNumbers, 'personalYear'>;
  label: string;
  derived: string;
}[] = [
  { key: 'lifePath', label: 'Life Path Number', derived: 'From your full date of birth' },
  { key: 'destiny', label: 'Destiny Number', derived: 'From every letter of your name' },
  { key: 'soulUrge', label: 'Soul Urge Number', derived: 'From the vowels of your name' },
  { key: 'personality', label: 'Personality Number', derived: 'From the consonants of your name' },
  { key: 'birthday', label: 'Birthday Number', derived: 'From the day you were born' },
];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function NumberBadge({ value, size = 'md' }: { value: number; size?: 'md' | 'lg' }) {
  const master = value > 9;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-display font-semibold ${
        size === 'lg' ? 'h-24 w-24 text-5xl' : 'h-14 w-14 text-2xl'
      } ${
        master
          ? 'bg-gradient-to-br from-ved-gold-300 to-ved-gold-500 text-ved-green-950 ring-4 ring-ved-gold-200'
          : 'bg-ved-green-800 text-ved-gold-300 ring-4 ring-ved-green-100'
      }`}
    >
      {value}
    </span>
  );
}

function Chips({ items, tone = 'green' }: { items: readonly string[]; tone?: 'green' | 'gold' | 'rose' }) {
  const colours = {
    green: 'bg-ved-green-50 text-ved-green-800',
    gold: 'bg-ved-gold-50 text-ved-gold-700',
    rose: 'bg-rose-50 text-rose-700',
  }[tone];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className={`rounded-full px-2.5 py-1 text-xs font-medium ${colours}`}>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function NumerologyReport({ reading, onReset }: { reading: NumerologyReading; onReset: () => void }) {
  const meaning = (n: number): NumberMeaning => reading.meanings[String(n)]!;
  const lifePath = meaning(reading.numbers.lifePath);
  const destiny = meaning(reading.numbers.destiny);

  return (
    <section
      id="report"
      aria-label="Your numerology report"
      className="scroll-mt-20 border-y border-ved-gold-400/25 bg-gradient-to-b from-[#FBF6EA] to-[#F7F4EE]"
    >
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ved-gold-600">
              Your numerology report
            </p>
            <h2 className="mt-1 font-display text-3xl font-semibold text-ved-green-900 sm:text-4xl">
              Namaste, {reading.name}
            </h2>
            <p className="mt-1 text-sm text-ved-green-800/60">Born {formatDate(reading.birthDate)}</p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-ved-green-800/25 bg-white px-4 py-2 text-sm font-semibold text-ved-green-800 hover:bg-ved-cream-100"
          >
            Calculate for someone else
          </button>
        </div>

        <article
          id="report-lifePath"
          className="mt-8 scroll-mt-24 overflow-hidden rounded-3xl bg-ved-green-900 text-white shadow-xl"
        >
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <NumberBadge value={reading.numbers.lifePath} size="lg" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ved-gold-300">Life Path Number</p>
              <h3 className="mt-1 font-display text-3xl font-semibold">{lifePath.title}</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/75">{lifePath.summary}</p>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-center lg:grid-cols-1 lg:text-left">
              {(
                [
                  ['Ruling planet', lifePath.planet],
                  ['Lucky day', lifePath.luckyDay],
                  ['Lucky colour', lifePath.luckyColour],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-white/8 px-3 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-ved-gold-300/80">{label}</dt>
                  <dd className="text-sm font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </article>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CORE_NUMBERS.filter((n) => n.key !== 'lifePath').map(({ key, label, derived }) => {
            const value = reading.numbers[key];
            const m = meaning(value);
            return (
              <article
                key={key}
                id={`report-${key}`}
                className="scroll-mt-24 rounded-2xl border border-ved-green-900/8 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <NumberBadge value={value} />
                  <div>
                    <h3 className="text-sm font-semibold text-ved-green-900">{label}</h3>
                    <p className="text-[11px] text-ved-green-800/50">{derived}</p>
                  </div>
                </div>
                <p className="mt-4 font-display text-lg font-semibold text-ved-green-900">{m.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ved-green-800/65">{m.summary}</p>
                <div className="mt-3">
                  <Chips items={m.keywords} />
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-ved-green-900/8 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-ved-green-900">Strengths & challenges</h3>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-ved-green-800/50">Strengths</p>
            <div className="mt-1.5">
              <Chips items={[...new Set([...lifePath.strengths, ...destiny.strengths])]} />
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ved-green-800/50">Work on</p>
            <div className="mt-1.5">
              <Chips items={[...new Set([...lifePath.challenges, ...destiny.challenges])]} tone="rose" />
            </div>
          </article>

          <article id="report-career" className="scroll-mt-24 rounded-2xl border border-ved-green-900/8 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-ved-green-900">Career guidance</h3>
            <p className="mt-1 text-sm text-ved-green-800/60">
              Paths that suit your Life Path {reading.numbers.lifePath} and Destiny {reading.numbers.destiny}.
            </p>
            <div className="mt-3">
              <Chips items={[...new Set([...lifePath.careers, ...destiny.careers])]} tone="gold" />
            </div>
          </article>

          <article
            id="report-compatibility"
            className="scroll-mt-24 rounded-2xl border border-ved-green-900/8 bg-white p-5 shadow-sm"
          >
            <h3 className="font-semibold text-ved-green-900">Compatibility</h3>
            <p className="mt-1 text-sm leading-relaxed text-ved-green-800/65">{lifePath.relationships}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-ved-green-800/50">
              Most harmonious with
            </p>
            <div className="mt-2 flex gap-2">
              {reading.compatibleNumbers.map((n) => (
                <span key={n} className="grid h-9 w-9 place-items-center rounded-full bg-ved-green-50 font-semibold text-ved-green-800">
                  {n}
                </span>
              ))}
            </div>
          </article>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl bg-ved-gold-50 p-5 ring-1 ring-ved-gold-400/30">
            <h3 className="font-semibold text-ved-green-900">Your lucky numbers</h3>
            <div className="mt-3 flex gap-2">
              {reading.luckyNumbers.map((n) => (
                <span key={n} className="grid h-11 w-11 place-items-center rounded-full bg-white font-display text-xl font-semibold text-ved-gold-700 shadow-sm">
                  {n}
                </span>
              ))}
            </div>
          </article>
          <article className="rounded-2xl bg-ved-gold-50 p-5 ring-1 ring-ved-gold-400/30">
            <h3 className="font-semibold text-ved-green-900">
              Personal Year {reading.numbers.personalYear} · {new Date().getFullYear()}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ved-green-800/70">{reading.personalYearTheme}</p>
          </article>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ved-green-900/8 sm:flex-row sm:items-center">
          <p className="text-sm text-ved-green-800/75">
            Want remedies and a deeper reading of your numbers? A Vedsutra expert can walk you through your chart.
          </p>
          <Link
            href="/astrologers"
            className="shrink-0 rounded-lg bg-ved-green-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-ved-green-700"
          >
            Talk to a Numerologist →
          </Link>
        </div>
      </div>
    </section>
  );
}
