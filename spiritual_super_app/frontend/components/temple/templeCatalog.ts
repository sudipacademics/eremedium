export type RitualFx =
  | 'glow'
  | 'cloth'
  | 'water-feet'
  | 'water-pour'
  | 'sip'
  | 'abhishek'
  | 'drape'
  | 'sparkle'
  | 'chandan'
  | 'flowers'
  | 'smoke'
  | 'flame'
  | 'prasad'
  | 'tambul'
  | 'aarti'
  | 'finale';

export type RitualSound = 'chime' | 'water' | 'ghanta' | 'conch' | 'soft';

export interface Deity {
  readonly id: string;
  readonly name: string;
  readonly epithet: string;
  readonly mantra: string;
  readonly glyph: string;
  readonly accent: string;
}

export interface Upachara {
  readonly id: string;
  readonly index: number;
  readonly sanskrit: string;
  readonly english: string;
  readonly icon: string;
  readonly fx: RitualFx;
  readonly sound: RitualSound;
}

export const DEITIES: readonly Deity[] = [
  {
    id: 'shiva',
    name: 'Shiva',
    epithet: 'Mahadev',
    mantra: 'Om Namah Shivaya',
    glyph: 'ॐ',
    accent: 'from-ved-green-900 to-ved-green-600',
  },
  {
    id: 'krishna',
    name: 'Krishna',
    epithet: 'Govinda',
    mantra: 'Om Namo Bhagavate Vasudevaya',
    glyph: 'flute',
    accent: 'from-[#1a3a6b] to-[#3d6bb3]',
  },
  {
    id: 'durga',
    name: 'Durga',
    epithet: 'Mahishasuramardini',
    mantra: 'Om Dum Durgayei Namaha',
    glyph: '⚔',
    accent: 'from-[#6b1a3a] to-[#b33d6b]',
  },
  {
    id: 'lakshmi',
    name: 'Lakshmi',
    epithet: 'Mahalakshmi',
    mantra: 'Om Shreem Mahalakshmiyei Namaha',
    glyph: '🪷',
    accent: 'from-[#6b4a1a] to-[#c9a227]',
  },
  {
    id: 'ganesha',
    name: 'Ganesha',
    epithet: 'Vighnaharta',
    mantra: 'Om Gam Ganapataye Namaha',
    glyph: '🐘',
    accent: 'from-[#5c3a1a] to-[#a67c3d]',
  },
  {
    id: 'hanuman',
    name: 'Hanuman',
    epithet: 'Bajrangbali',
    mantra: 'Om Hanumate Namaha',
    glyph: '🚩',
    accent: 'from-[#6b2a1a] to-[#c45a2d]',
  },
] as const;

export const UPACHARAS: readonly Upachara[] = [
  {
    id: 'dhyanam',
    index: 1,
    sanskrit: 'Dhyanam',
    english: 'Invoke with stillness',
    icon: '🧘',
    fx: 'glow',
    sound: 'soft',
  },
  {
    id: 'asanam',
    index: 2,
    sanskrit: 'Asanam',
    english: 'Offer a seat',
    icon: '🪑',
    fx: 'cloth',
    sound: 'soft',
  },
  {
    id: 'padyam',
    index: 3,
    sanskrit: 'Padyam',
    english: 'Wash the feet',
    icon: '🦶',
    fx: 'water-feet',
    sound: 'water',
  },
  {
    id: 'arghyam',
    index: 4,
    sanskrit: 'Arghyam',
    english: 'Offer water',
    icon: '💧',
    fx: 'water-pour',
    sound: 'water',
  },
  {
    id: 'achamaniyam',
    index: 5,
    sanskrit: 'Achamaniyam',
    english: 'Water for sipping',
    icon: '🥣',
    fx: 'sip',
    sound: 'water',
  },
  {
    id: 'snanam',
    index: 6,
    sanskrit: 'Snanam',
    english: 'Sacred bath',
    icon: '🚿',
    fx: 'abhishek',
    sound: 'water',
  },
  {
    id: 'vastram',
    index: 7,
    sanskrit: 'Vastram',
    english: 'Offer cloth',
    icon: '🧣',
    fx: 'drape',
    sound: 'soft',
  },
  {
    id: 'aabharanam',
    index: 8,
    sanskrit: 'Aabharanam',
    english: 'Adorn with ornaments',
    icon: '💎',
    fx: 'sparkle',
    sound: 'chime',
  },
  {
    id: 'gandham',
    index: 9,
    sanskrit: 'Gandham',
    english: 'Apply chandan',
    icon: '🟡',
    fx: 'chandan',
    sound: 'soft',
  },
  {
    id: 'pushpam',
    index: 10,
    sanskrit: 'Pushpam',
    english: 'Flower shower',
    icon: '🌸',
    fx: 'flowers',
    sound: 'chime',
  },
  {
    id: 'dhoopam',
    index: 11,
    sanskrit: 'Dhoopam',
    english: 'Incense smoke',
    icon: '🌫️',
    fx: 'smoke',
    sound: 'soft',
  },
  {
    id: 'deepam',
    index: 12,
    sanskrit: 'Deepam',
    english: 'Light the lamp',
    icon: '🪔',
    fx: 'flame',
    sound: 'chime',
  },
  {
    id: 'naivedyam',
    index: 13,
    sanskrit: 'Naivedyam',
    english: 'Offer prasad',
    icon: '🍬',
    fx: 'prasad',
    sound: 'soft',
  },
  {
    id: 'tambulam',
    index: 14,
    sanskrit: 'Tambulam',
    english: 'Betel offering',
    icon: '🍃',
    fx: 'tambul',
    sound: 'soft',
  },
  {
    id: 'neerajanam',
    index: 15,
    sanskrit: 'Neerajanam',
    english: 'Aarti',
    icon: '🔥',
    fx: 'aarti',
    sound: 'ghanta',
  },
  {
    id: 'pushpanjali',
    index: 16,
    sanskrit: 'Pushpanjali',
    english: 'Final petals & bell',
    icon: '🙏',
    fx: 'finale',
    sound: 'ghanta',
  },
] as const;

export function deityById(id: string): Deity | undefined {
  return DEITIES.find((d) => d.id === id);
}
