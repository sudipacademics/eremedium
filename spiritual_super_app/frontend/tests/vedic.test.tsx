import { describe, expect, it } from 'vitest';

import { SHODASHVARGA, vargaSign } from '@/components/kundali/vedic';

describe('vargaSign', () => {
  it('lists the sixteen Parashara vargas', () => {
    expect(SHODASHVARGA.map((v) => v.code)).toEqual([
      'D1', 'D2', 'D3', 'D4', 'D7', 'D9', 'D10', 'D12', 'D16', 'D20', 'D24', 'D27', 'D30', 'D40', 'D45', 'D60',
    ]);
  });

  it('places 0° Aries per each varga rule', () => {
    const at = (code: Parameters<typeof vargaSign>[1]) => vargaSign(0, code);
    expect(at('D1')).toBe(1);
    expect(at('D2')).toBe(5); // odd sign, first half → Sun's hora, Leo
    expect(at('D3')).toBe(1);
    expect(at('D9')).toBe(1);
    expect(at('D24')).toBe(5); // odd sign starts from Leo
    expect(at('D30')).toBe(1); // Mars
    expect(at('D40')).toBe(1);
    expect(at('D60')).toBe(1);
  });

  it('handles an even water sign (Pisces 0°30′)', () => {
    const lon = 330.5;
    expect(vargaSign(lon, 'D1')).toBe(12);
    expect(vargaSign(lon, 'D2')).toBe(4); // even sign, first half → Moon's hora, Cancer
    expect(vargaSign(lon, 'D7')).toBe(6); // even signs start from the 7th: Virgo
    expect(vargaSign(lon, 'D9')).toBe(4); // water signs start navamsha from Cancer
    expect(vargaSign(lon, 'D10')).toBe(8); // even signs start from the 9th: Scorpio
    expect(vargaSign(lon, 'D16')).toBe(9); // dual signs start from Sagittarius
    expect(vargaSign(lon, 'D27')).toBe(10); // water signs start from Capricorn
    expect(vargaSign(lon, 'D30')).toBe(2); // even sign, 0–5° → Venus, Taurus
    expect(vargaSign(lon, 'D60')).toBe(1); // second shashtiamsha counts one sign on
  });

  it('computes navamsha and drekkana mid-sign', () => {
    expect(vargaSign(45, 'D9')).toBe(2); // Taurus 15° → 5th navamsha from Capricorn = Taurus
    expect(vargaSign(45, 'D3')).toBe(6); // Taurus 15° → second drekkana, 5th sign = Virgo
    expect(vargaSign(95.9, 'D3')).toBe(4); // Cancer 5°54′ → first drekkana
    expect(vargaSign(29.999, 'D12')).toBe(12); // last dwadashamsha of Aries → Pisces
  });

  it('uses the unequal trimshamsha spans', () => {
    expect(vargaSign(12, 'D30')).toBe(9); // Aries 12° → Jupiter, Sagittarius
    expect(vargaSign(30 + 13, 'D30')).toBe(12); // Taurus 13° → Jupiter, Pisces
    expect(vargaSign(30 + 27, 'D30')).toBe(8); // Taurus 27° → Mars, Scorpio
  });
});
