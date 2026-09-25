export const AI_ASTROLOGER_IDS = ['vedic', 'nadi', 'western', 'numerology'] as const;
export type AiAstrologerId = (typeof AI_ASTROLOGER_IDS)[number];

export interface AiAstrologerPersona {
  id: AiAstrologerId;
  name: string;
  tradition: string;
  tagline: string;
  about: string;
  avatar: string;
  /** Chart-based personas read the saved kundali; numerology needs only name + date of birth. */
  usesChart: boolean;
  placeholder: string;
  thinking: string;
  suggestions: string[];
}

export const AI_ASTROLOGERS: Record<AiAstrologerId, AiAstrologerPersona> = {
  vedic: {
    id: 'vedic',
    name: 'Acharya Veda',
    tradition: 'Vedic Astrology',
    tagline: 'Lagna, dashas & gochar',
    about:
      'Reads your sidereal (Lahiri) kundali the Parashari way — houses, lordships, yogas, Vimshottari dasha and today\'s gochar.',
    avatar: '/ai-astrologers/vedic.webp',
    usesChart: true,
    placeholder: 'Ask about career, relationships, dasha timing, strengths…',
    thinking: 'Acharya Veda is studying your kundali…',
    suggestions: [
      'What does my current dasha emphasise for career?',
      'Summarise my Lagna and Moon for personality and mind.',
      'Any gochar themes I should watch this month?',
      'Which yogas or strengths stand out in my chart?',
    ],
  },
  nadi: {
    id: 'nadi',
    name: 'Nadi Rishi',
    tradition: 'Nadi Astrology',
    tagline: 'Planetary links & karmic stories',
    about:
      'Follows the Bhrigu Nandi Nadi method — planets read through the signs they share, trine and oppose, with Jupiter and Saturn transits as timers.',
    avatar: '/ai-astrologers/nadi.webp',
    usesChart: true,
    placeholder: 'Ask about the story your planets tell together…',
    thinking: 'Nadi Rishi is reading the planetary links…',
    suggestions: [
      'What do my planetary links say about my career?',
      'Which natal planets is transiting Jupiter activating now?',
      'Tell me the story of Saturn in my chart.',
      'What do the links around Venus say about relationships?',
    ],
  },
  western: {
    id: 'western',
    name: 'Stella',
    tradition: 'Western Astrology',
    tagline: 'Big Three, aspects & transits',
    about:
      'Converts your chart to the tropical zodiac and reads Sun, Moon and Rising, whole-sign houses, major aspects and current transits.',
    avatar: '/ai-astrologers/western.webp',
    usesChart: true,
    placeholder: 'Ask about your Big Three, aspects, transits…',
    thinking: 'Stella is looking at your tropical chart…',
    suggestions: [
      'Explain my Big Three — Sun, Moon and Rising.',
      'What do my tightest aspects say about me?',
      'What are the current transits highlighting for me?',
      'How does my Venus shape the way I love?',
    ],
  },
  numerology: {
    id: 'numerology',
    name: 'Ank Guru',
    tradition: 'Numerology',
    tagline: 'Life Path, Destiny & Personal Year',
    about:
      'Works from your full name and date of birth — Life Path, Destiny, Soul Urge, Personality and your Personal Year, with each number\'s ruling planet.',
    avatar: '/ai-astrologers/numerology.webp',
    usesChart: false,
    placeholder: 'Ask about your numbers, career, compatibility, this year…',
    thinking: 'Ank Guru is working out your numbers…',
    suggestions: [
      'What does my Life Path number mean for my career?',
      'What is the theme of my Personal Year?',
      'Which numbers am I most compatible with?',
      'How do my Soul Urge and Personality numbers differ?',
    ],
  },
};

export function isAiAstrologerId(value: string | null | undefined): value is AiAstrologerId {
  return (AI_ASTROLOGER_IDS as readonly string[]).includes(value ?? '');
}
