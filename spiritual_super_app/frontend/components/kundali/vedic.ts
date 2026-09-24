/** Sign numbers are 1 (Mesha/Aries) .. 12 (Meena/Pisces) throughout. */

export const SIGN_SHORT = ['Ar', 'Ta', 'Ge', 'Cn', 'Le', 'Vi', 'Li', 'Sc', 'Sg', 'Cp', 'Aq', 'Pi'] as const;

export const SIGN_NAMES = [
  'Mesha',
  'Vrishabha',
  'Mithuna',
  'Karka',
  'Simha',
  'Kanya',
  'Tula',
  'Vrishchika',
  'Dhanu',
  'Makara',
  'Kumbha',
  'Meena',
] as const;

export const GRAHA_SHORT: Record<string, string> = {
  Sun: 'Su',
  Moon: 'Mo',
  Mars: 'Ma',
  Mercury: 'Me',
  Jupiter: 'Ju',
  Venus: 'Ve',
  Saturn: 'Sa',
  Rahu: 'Ra',
  Ketu: 'Ke',
};

export const GRAHA_COLOR: Record<string, string> = {
  Sun: '#c2410c',
  Moon: '#475569',
  Mars: '#b91c1c',
  Mercury: '#15803d',
  Jupiter: '#b45309',
  Venus: '#be185d',
  Saturn: '#1e3a8a',
  Rahu: '#57534e',
  Ketu: '#78716c',
};

export function grahaShort(body: string): string {
  return GRAHA_SHORT[body] ?? body.slice(0, 2);
}

/** Wraps any integer onto 1..12. */
export function normSign(value: number): number {
  return ((((value - 1) % 12) + 12) % 12) + 1;
}

const isOdd = (sign: number) => sign % 2 === 1;
const modality = (sign: number): 'movable' | 'fixed' | 'dual' =>
  (['movable', 'fixed', 'dual'] as const)[(sign - 1) % 3]!;
const element = (sign: number): 'fire' | 'earth' | 'air' | 'water' =>
  (['fire', 'earth', 'air', 'water'] as const)[(sign - 1) % 4]!;

export type VargaCode =
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D7'
  | 'D9'
  | 'D10'
  | 'D12'
  | 'D16'
  | 'D20'
  | 'D24'
  | 'D27'
  | 'D30'
  | 'D40'
  | 'D45'
  | 'D60';

export interface VargaInfo {
  code: VargaCode;
  division: number;
  name: string;
  signifies: string;
}

/** Parashara's Shodashvarga, in the traditional order. */
export const SHODASHVARGA: readonly VargaInfo[] = [
  { code: 'D1', division: 1, name: 'Rasi', signifies: 'Body, personality and life as a whole' },
  { code: 'D2', division: 2, name: 'Hora', signifies: 'Wealth and resources' },
  { code: 'D3', division: 3, name: 'Drekkana', signifies: 'Siblings, courage and initiative' },
  { code: 'D4', division: 4, name: 'Chaturthamsha', signifies: 'Home, property and fortune' },
  { code: 'D7', division: 7, name: 'Saptamsha', signifies: 'Children and progeny' },
  { code: 'D9', division: 9, name: 'Navamsha', signifies: 'Marriage, dharma and inner strength' },
  { code: 'D10', division: 10, name: 'Dashamsha', signifies: 'Career, status and achievements' },
  { code: 'D12', division: 12, name: 'Dwadashamsha', signifies: 'Parents and lineage' },
  { code: 'D16', division: 16, name: 'Shodashamsha', signifies: 'Vehicles, comforts and happiness' },
  { code: 'D20', division: 20, name: 'Vimshamsha', signifies: 'Spiritual practice and devotion' },
  { code: 'D24', division: 24, name: 'Chaturvimshamsha', signifies: 'Education and learning' },
  { code: 'D27', division: 27, name: 'Saptavimshamsha', signifies: 'Strength, stamina and vitality' },
  { code: 'D30', division: 30, name: 'Trimshamsha', signifies: 'Misfortunes, health and hidden challenges' },
  { code: 'D40', division: 40, name: 'Khavedamsha', signifies: 'Maternal legacy and auspicious effects' },
  { code: 'D45', division: 45, name: 'Akshavedamsha', signifies: 'Paternal legacy and character' },
  { code: 'D60', division: 60, name: 'Shashtiamsha', signifies: 'Past karma and the chart as a whole' },
];

/**
 * The sign a sidereal longitude falls in for a given divisional chart, per Brihat Parashara Hora
 * Shastra. Each varga splits a sign into equal parts and maps each part to a sign by its own rule.
 */
export function vargaSign(longitude: number, code: VargaCode): number {
  const lon = ((longitude % 360) + 360) % 360;
  const sign = Math.floor(lon / 30) + 1;
  const deg = lon - (sign - 1) * 30;
  const part = (division: number) => Math.min(division - 1, Math.floor(deg / (30 / division)));

  switch (code) {
    case 'D1':
      return sign;
    case 'D2':
      // Odd signs: Sun's hora (Leo) then Moon's (Cancer); even signs the reverse.
      return (deg < 15) === isOdd(sign) ? 5 : 4;
    case 'D3':
      return normSign(sign + 4 * part(3));
    case 'D4':
      return normSign(sign + 3 * part(4));
    case 'D7':
      return normSign((isOdd(sign) ? sign : sign + 6) + part(7));
    case 'D9':
      // Continuous from Aries: fire signs start at Aries, earth at Capricorn, air at Libra, water at Cancer.
      return normSign(Math.floor(lon / (30 / 9)) + 1);
    case 'D10':
      return normSign((isOdd(sign) ? sign : sign + 8) + part(10));
    case 'D12':
      return normSign(sign + part(12));
    case 'D16':
      return normSign({ movable: 1, fixed: 5, dual: 9 }[modality(sign)] + part(16));
    case 'D20':
      return normSign({ movable: 1, fixed: 9, dual: 5 }[modality(sign)] + part(20));
    case 'D24':
      return normSign((isOdd(sign) ? 5 : 4) + part(24));
    case 'D27':
      return normSign({ fire: 1, earth: 4, air: 7, water: 10 }[element(sign)] + part(27));
    case 'D30':
      return trimshamsha(sign, deg);
    case 'D40':
      return normSign((isOdd(sign) ? 1 : 7) + part(40));
    case 'D45':
      return normSign({ movable: 1, fixed: 5, dual: 9 }[modality(sign)] + part(45));
    case 'D60':
      return normSign(sign + part(60));
  }
}

/** Unequal five-fold division ruled by Mars, Saturn, Jupiter, Mercury and Venus. */
function trimshamsha(sign: number, deg: number): number {
  if (isOdd(sign)) {
    if (deg < 5) return 1; // Mars — Aries
    if (deg < 10) return 11; // Saturn — Aquarius
    if (deg < 18) return 9; // Jupiter — Sagittarius
    if (deg < 25) return 3; // Mercury — Gemini
    return 7; // Venus — Libra
  }
  if (deg < 5) return 2; // Venus — Taurus
  if (deg < 12) return 6; // Mercury — Virgo
  if (deg < 20) return 12; // Jupiter — Pisces
  if (deg < 25) return 10; // Saturn — Capricorn
  return 8; // Mars — Scorpio
}
