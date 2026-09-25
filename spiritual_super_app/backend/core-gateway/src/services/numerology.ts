import { ContentError } from './content-security.js';

/** Master numbers are kept whole instead of being reduced to a single digit. */
const MASTER_NUMBERS = new Set([11, 22, 33]);
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

export interface CoreNumbers {
  /** From the full date of birth — the life's main path. */
  readonly lifePath: number;
  /** From every letter of the full name (a.k.a. Expression number). */
  readonly destiny: number;
  /** From the vowels of the name (a.k.a. Heart's Desire). */
  readonly soulUrge: number;
  /** From the consonants of the name. */
  readonly personality: number;
  /** From the day of the month alone. */
  readonly birthday: number;
  /** Theme of the current calendar year for this person; always 1–9. */
  readonly personalYear: number;
}

export interface NumberMeaning {
  readonly number: number;
  readonly title: string;
  readonly keywords: readonly string[];
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly challenges: readonly string[];
  readonly careers: readonly string[];
  readonly relationships: string;
  /** Vedic numerology rules each root number 1–9 by a graha. */
  readonly planet: string;
  readonly luckyDay: string;
  readonly luckyColour: string;
}

export interface NumerologyReading {
  readonly name: string;
  readonly birthDate: string;
  readonly numbers: CoreNumbers;
  /** Keyed by number, one entry per distinct number in `numbers` (personal year excluded). */
  readonly meanings: Readonly<Record<string, NumberMeaning>>;
  readonly compatibleNumbers: readonly number[];
  readonly luckyNumbers: readonly number[];
  readonly personalYearTheme: string;
}

function digitSum(n: number): number {
  let sum = 0;
  for (const digit of String(n)) sum += Number(digit);
  return sum;
}

export function reduceNumber(n: number, keepMasters = true): number {
  let value = n;
  while (value > 9 && !(keepMasters && MASTER_NUMBERS.has(value))) value = digitSum(value);
  return value;
}

/** 11 → 2, 22 → 4, 33 → 6; single digits unchanged. */
export function rootOf(n: number): number {
  return reduceNumber(n, false);
}

export function letterValue(letter: string): number {
  return ((letter.charCodeAt(0) - 65) % 9) + 1;
}

/** Upper-case Latin letters of each word, with accents stripped ("Rénu" → "RENU"). */
export function nameWords(fullName: string): string[] {
  return fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((word) => word.length > 0);
}

/** Each word is reduced on its own before the words are added, as in the Pythagorean method. */
function nameNumber(words: readonly string[], include: (letter: string) => boolean): number {
  const total = words.reduce((sum, word) => {
    const letters = [...word].filter(include);
    return letters.length === 0 ? sum : sum + reduceNumber(letters.reduce((s, l) => s + letterValue(l), 0));
  }, 0);
  return total === 0 ? 0 : reduceNumber(total);
}

export interface BirthDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Parses YYYY-MM-DD and refuses impossible, future or pre-1900 dates. */
export function parseBirthDate(value: string, today: Date = new Date()): BirthDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ContentError('Enter your date of birth as DD/MM/YYYY');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ContentError('That date of birth does not exist');
  }
  if (year < 1900 || date.getTime() > today.getTime()) {
    throw new ContentError('Enter a date of birth between 1900 and today');
  }
  return { year, month, day };
}

export function computeCoreNumbers(fullName: string, birth: BirthDate, currentYear: number): CoreNumbers {
  const words = nameWords(fullName);
  const letterCount = words.reduce((n, word) => n + word.length, 0);
  if (letterCount < 2) throw new ContentError('Enter your full name in English letters');

  const month = reduceNumber(birth.month);
  const day = reduceNumber(birth.day);
  const destiny = nameNumber(words, () => true);
  const soulUrge = nameNumber(words, (l) => VOWELS.has(l));
  const personality = nameNumber(words, (l) => !VOWELS.has(l));

  return {
    lifePath: reduceNumber(month + day + reduceNumber(birth.year)),
    destiny,
    // A name with no vowels (or no consonants) falls back to the destiny number.
    soulUrge: soulUrge || destiny,
    personality: personality || destiny,
    birthday: day,
    personalYear: reduceNumber(rootOf(birth.month) + rootOf(birth.day) + rootOf(currentYear), false),
  };
}

/** Classic harmony triads: 1-5-7, 2-4-8 and 3-6-9. Master numbers join their root's triad. */
const TRIADS: readonly (readonly number[])[] = [
  [1, 5, 7],
  [2, 4, 8],
  [3, 6, 9],
];

export function compatibleNumbers(lifePath: number): number[] {
  const root = rootOf(lifePath);
  return [...(TRIADS.find((triad) => triad.includes(root)) ?? [])];
}

export function luckyNumbers(numbers: CoreNumbers): number[] {
  return [...new Set([numbers.lifePath, numbers.destiny, numbers.birthday].map(rootOf))].sort((a, b) => a - b);
}

export const PERSONAL_YEAR_THEMES: Readonly<Record<number, string>> = {
  1: 'A year of new beginnings — start the project, take the lead, plant seeds for the next nine years.',
  2: 'A year of patience and partnership — cooperate, nurture relationships and let things ripen.',
  3: 'A year of expression — create, socialise and share your ideas; joy opens doors.',
  4: 'A year of foundations — steady work, discipline and building structures that last.',
  5: 'A year of change — travel, freedom and fresh experiences; stay flexible.',
  6: 'A year of home and responsibility — family, love, service and healing take centre stage.',
  7: 'A year of reflection — study, spiritual practice and inner work bring clarity.',
  8: 'A year of achievement — career, money and recognition; act with integrity and ambition.',
  9: 'A year of completion — release what no longer serves, give back, and prepare for a new cycle.',
};

const MEANINGS: Readonly<Record<number, Omit<NumberMeaning, 'number'>>> = {
  1: {
    title: 'The Leader',
    keywords: ['Independent', 'Pioneering', 'Determined'],
    summary:
      'Number 1 carries the energy of beginnings. You are driven to stand on your own feet, lead from the front and turn ideas into action.',
    strengths: ['Natural leadership', 'Courage to begin', 'Strong willpower'],
    challenges: ['Impatience', 'Difficulty asking for help'],
    careers: ['Entrepreneur', 'Manager', 'Politics', 'Innovation & start-ups'],
    relationships: 'You need a partner who respects your independence and cheers on your ambitions.',
    planet: 'Sun (Surya)',
    luckyDay: 'Sunday',
    luckyColour: 'Gold, orange',
  },
  2: {
    title: 'The Peacemaker',
    keywords: ['Diplomatic', 'Sensitive', 'Cooperative'],
    summary:
      'Number 2 is the energy of harmony. You read people well, bring others together and thrive in partnership.',
    strengths: ['Empathy and intuition', 'Diplomacy', 'Loyal teamwork'],
    challenges: ['Over-sensitivity', 'Indecision'],
    careers: ['Counselling', 'Healthcare', 'HR & mediation', 'Music & arts'],
    relationships: 'Deeply devoted and romantic — you flourish with a gentle, emotionally present partner.',
    planet: 'Moon (Chandra)',
    luckyDay: 'Monday',
    luckyColour: 'White, silver, cream',
  },
  3: {
    title: 'The Communicator',
    keywords: ['Creative', 'Expressive', 'Optimistic'],
    summary:
      'Number 3 carries the wisdom and expansion of Guru. You inspire others with words, creativity and a generous, joyful spirit.',
    strengths: ['Eloquence', 'Creativity', 'Wisdom and optimism'],
    challenges: ['Scattered focus', 'Over-promising'],
    careers: ['Teaching', 'Writing & media', 'Law', 'Advisory & consulting'],
    relationships: 'You bring warmth and fun; a partner who shares your ideals keeps the spark alive.',
    planet: 'Jupiter (Guru)',
    luckyDay: 'Thursday',
    luckyColour: 'Yellow, saffron',
  },
  4: {
    title: 'The Builder',
    keywords: ['Practical', 'Disciplined', 'Unconventional'],
    summary:
      'Number 4 is the energy of structure. You work hard, think differently and build things that stand the test of time.',
    strengths: ['Reliability', 'Systematic thinking', 'Original ideas'],
    challenges: ['Rigidity', 'Sudden ups and downs'],
    careers: ['Engineering', 'Technology', 'Research', 'Operations & planning'],
    relationships: 'Steady and loyal — you value trust and a partner who shares long-term plans.',
    planet: 'Rahu',
    luckyDay: 'Saturday',
    luckyColour: 'Grey, electric blue',
  },
  5: {
    title: 'The Free Spirit',
    keywords: ['Adventurous', 'Versatile', 'Quick-witted'],
    summary:
      'Number 5, ruled by Budh, is the energy of movement and communication. You learn fast, adapt easily and crave variety.',
    strengths: ['Adaptability', 'Sharp intellect', 'Persuasive speech'],
    challenges: ['Restlessness', 'Inconsistency'],
    careers: ['Business & trade', 'Sales & marketing', 'Travel', 'Journalism'],
    relationships: 'You need freedom and stimulating conversation; boredom is your biggest enemy in love.',
    planet: 'Mercury (Budh)',
    luckyDay: 'Wednesday',
    luckyColour: 'Green',
  },
  6: {
    title: 'The Nurturer',
    keywords: ['Loving', 'Responsible', 'Artistic'],
    summary:
      'Number 6, ruled by Shukra, is the energy of love, beauty and care. Home, family and harmony matter deeply to you.',
    strengths: ['Compassion', 'Sense of beauty', 'Dependability'],
    challenges: ['Over-giving', 'Perfectionism'],
    careers: ['Design & fashion', 'Hospitality', 'Healthcare', 'Arts & entertainment'],
    relationships: 'Devoted and affectionate — you shine in a committed, beautiful partnership.',
    planet: 'Venus (Shukra)',
    luckyDay: 'Friday',
    luckyColour: 'White, pink, light blue',
  },
  7: {
    title: 'The Seeker',
    keywords: ['Spiritual', 'Analytical', 'Intuitive'],
    summary:
      'Number 7, ruled by Ketu, is the energy of inner wisdom. You question deeply, trust your intuition and seek truth beyond the surface.',
    strengths: ['Depth of thought', 'Intuition', 'Spiritual insight'],
    challenges: ['Detachment', 'Overthinking'],
    careers: ['Research & science', 'Spiritual teaching', 'Analysis', 'Healing arts'],
    relationships: 'You need space and a partner who understands your need for quiet reflection.',
    planet: 'Ketu',
    luckyDay: 'Monday',
    luckyColour: 'Smoky grey, light green',
  },
  8: {
    title: 'The Achiever',
    keywords: ['Ambitious', 'Resilient', 'Just'],
    summary:
      'Number 8, ruled by Shani, is the energy of karma and material mastery. Success comes through patience, effort and integrity.',
    strengths: ['Perseverance', 'Business sense', 'Authority'],
    challenges: ['Delays and tests', 'Workaholism'],
    careers: ['Finance & banking', 'Law & administration', 'Real estate', 'Leadership roles'],
    relationships: 'Serious and protective — you build lasting partnerships once trust is earned.',
    planet: 'Saturn (Shani)',
    luckyDay: 'Saturday',
    luckyColour: 'Dark blue, black',
  },
  9: {
    title: 'The Humanitarian',
    keywords: ['Courageous', 'Compassionate', 'Idealistic'],
    summary:
      'Number 9, ruled by Mangal, combines courage with compassion. You are here to serve a larger cause and complete cycles.',
    strengths: ['Courage and energy', 'Generosity', 'Big-picture vision'],
    challenges: ['Temper', 'Difficulty letting go'],
    careers: ['Defence & sports', 'Medicine & surgery', 'Social work', 'Public service'],
    relationships: 'Passionate and giving — you need a partner who shares your ideals and energy.',
    planet: 'Mars (Mangal)',
    luckyDay: 'Tuesday',
    luckyColour: 'Red, coral',
  },
  11: {
    title: 'The Illuminator (Master 11)',
    keywords: ['Visionary', 'Inspired', 'Highly intuitive'],
    summary:
      'Master number 11 amplifies the sensitivity of 2 into spiritual insight. You are here to inspire others and act as a channel for higher wisdom.',
    strengths: ['Powerful intuition', 'Inspiring presence', 'Idealism'],
    challenges: ['Nervous tension', 'Self-doubt'],
    careers: ['Spiritual guidance', 'Counselling', 'Arts', 'Teaching'],
    relationships: 'Soulful and devoted — you seek a deep spiritual connection with your partner.',
    planet: 'Moon (Chandra)',
    luckyDay: 'Monday',
    luckyColour: 'White, silver',
  },
  22: {
    title: 'The Master Builder (Master 22)',
    keywords: ['Visionary', 'Practical', 'Powerful'],
    summary:
      'Master number 22 turns big dreams into lasting reality. You combine vision with discipline to build something that serves many.',
    strengths: ['Large-scale vision', 'Organisation', 'Determination'],
    challenges: ['Pressure of expectations', 'Controlling tendencies'],
    careers: ['Architecture', 'Large enterprises', 'Public institutions', 'Engineering'],
    relationships: 'Loyal and dependable — you need a partner who supports your mission.',
    planet: 'Rahu',
    luckyDay: 'Saturday',
    luckyColour: 'Grey, blue',
  },
  33: {
    title: 'The Master Teacher (Master 33)',
    keywords: ['Compassionate', 'Healing', 'Selfless'],
    summary:
      'Master number 33 raises the love of 6 into service. You teach and heal through compassion and personal example.',
    strengths: ['Unconditional love', 'Healing ability', 'Guidance'],
    challenges: ['Self-sacrifice', 'Taking on others’ burdens'],
    careers: ['Teaching', 'Healing & wellness', 'Charitable work', 'Counselling'],
    relationships: 'Nurturing and selfless — remember to receive love as freely as you give it.',
    planet: 'Venus (Shukra)',
    luckyDay: 'Friday',
    luckyColour: 'Pink, white',
  },
};

export function meaningOf(n: number): NumberMeaning {
  const meaning = MEANINGS[n] ?? MEANINGS[rootOf(n)];
  if (!meaning) throw new Error(`No numerology meaning for ${n}`);
  return { number: n, ...meaning };
}

export function buildReading(fullName: string, birthDate: string, today: Date = new Date()): NumerologyReading {
  const birth = parseBirthDate(birthDate, today);
  const numbers = computeCoreNumbers(fullName, birth, today.getFullYear());
  const used = [numbers.lifePath, numbers.destiny, numbers.soulUrge, numbers.personality, numbers.birthday];
  return {
    name: fullName.trim().replace(/\s+/g, ' '),
    birthDate,
    numbers,
    meanings: Object.fromEntries([...new Set(used)].map((n) => [String(n), meaningOf(n)])),
    compatibleNumbers: compatibleNumbers(numbers.lifePath),
    luckyNumbers: luckyNumbers(numbers),
    personalYearTheme: PERSONAL_YEAR_THEMES[numbers.personalYear] ?? '',
  };
}
