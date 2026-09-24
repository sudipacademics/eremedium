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
  /** Transliterated mantra, shown under the Devanagari. */
  readonly mantra: string;
  readonly mantraDevanagari: string;
  readonly symbol: string;
  readonly image: string;
  /** Sanctum glow behind the murti. */
  readonly glow: string;
  /** Mandala and halo tint. */
  readonly halo: string;
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

const img = (id: string) => `/temple/deities/${id}.webp`;

export const DEITIES: readonly Deity[] = [
  {
    id: 'ganesha',
    name: 'Ganesha',
    epithet: 'Vighnaharta · Remover of obstacles',
    mantra: 'Om Gam Ganapataye Namaha',
    mantraDevanagari: 'ॐ गं गणपतये नमः',
    symbol: '🐘',
    image: img('ganesha'),
    glow: '#7a3b0c',
    halo: '#e0a84a',
  },
  {
    id: 'durga',
    name: 'Durga',
    epithet: 'Mahishasuramardini',
    mantra: 'Om Dum Durgayei Namaha',
    mantraDevanagari: 'ॐ दुं दुर्गायै नमः',
    symbol: '🦁',
    image: img('durga'),
    glow: '#7f1d1d',
    halo: '#f0a060',
  },
  {
    id: 'surya',
    name: 'Surya',
    epithet: 'Aditya · The Sun',
    mantra: 'Om Suryaya Namaha',
    mantraDevanagari: 'ॐ सूर्याय नमः',
    symbol: '☀️',
    image: img('surya'),
    glow: '#9a4a12',
    halo: '#ffc85a',
  },
  {
    id: 'shiva',
    name: 'Shiva',
    epithet: 'Mahadeva · The auspicious one',
    mantra: 'Om Namah Shivaya',
    mantraDevanagari: 'ॐ नमः शिवाय',
    symbol: '🔱',
    image: img('shiva'),
    glow: '#0d3b4f',
    halo: '#9fd3e6',
  },
  {
    id: 'kartikeya',
    name: 'Kartikeya',
    epithet: 'Skanda · Murugan',
    mantra: 'Om Saravanabhavaya Namaha',
    mantraDevanagari: 'ॐ शरवणभवाय नमः',
    symbol: '🦚',
    image: img('kartikeya'),
    glow: '#6b1740',
    halo: '#f2a3c4',
  },
  {
    id: 'vishnu',
    name: 'Vishnu',
    epithet: 'Narayana · The preserver',
    mantra: 'Om Namo Bhagavate Vasudevaya',
    mantraDevanagari: 'ॐ नमो भगवते वासुदेवाय',
    symbol: '🐚',
    image: img('vishnu'),
    glow: '#232a6b',
    halo: '#b7c0ff',
  },
  {
    id: 'krishna',
    name: 'Krishna',
    epithet: 'Govinda · Giridhari',
    mantra: 'Om Kleem Krishnaya Namaha',
    mantraDevanagari: 'ॐ क्लीं कृष्णाय नमः',
    symbol: '🪈',
    image: img('krishna'),
    glow: '#123f63',
    halo: '#8ecbf0',
  },
  {
    id: 'dakshinamurti',
    name: 'Dakshinamurti',
    epithet: 'Adi Guru · Cosmic teacher',
    mantra: 'Om Dakshinamurtaye Namaha',
    mantraDevanagari: 'ॐ दक्षिणामूर्तये नमः',
    symbol: '🧘',
    image: img('dakshinamurti'),
    glow: '#6b4a0e',
    halo: '#f3d27a',
  },
  {
    id: 'lakshmi',
    name: 'Lakshmi',
    epithet: 'Sri · Goddess of abundance',
    mantra: 'Om Shreem Mahalakshmiyei Namaha',
    mantraDevanagari: 'ॐ श्रीं महालक्ष्म्यै नमः',
    symbol: '🪷',
    image: img('lakshmi'),
    glow: '#6d1a5e',
    halo: '#f7b6e3',
  },
  {
    id: 'hanuman',
    name: 'Hanuman',
    epithet: 'Bajrangbali',
    mantra: 'Om Hanumate Namaha',
    mantraDevanagari: 'ॐ हनुमते नमः',
    symbol: '🚩',
    image: img('hanuman'),
    glow: '#8a3510',
    halo: '#ffb070',
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
