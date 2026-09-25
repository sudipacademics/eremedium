import { describe, expect, it } from 'vitest';

import {
  buildReading,
  compatibleNumbers,
  computeCoreNumbers,
  letterValue,
  meaningOf,
  nameWords,
  parseBirthDate,
  reduceNumber,
} from '../src/services/numerology.js';

const TODAY = new Date('2026-09-25T12:00:00Z');

describe('numerology arithmetic', () => {
  it('maps letters with the Pythagorean table', () => {
    expect(['A', 'I', 'J', 'R', 'S', 'Z'].map(letterValue)).toEqual([1, 9, 1, 9, 1, 8]);
  });

  it('reduces to a single digit but keeps master numbers', () => {
    expect(reduceNumber(1990)).toBe(1);
    expect(reduceNumber(29)).toBe(11);
    expect(reduceNumber(22)).toBe(22);
    expect(reduceNumber(33)).toBe(33);
    expect(reduceNumber(29, false)).toBe(2);
  });

  it('strips accents and ignores punctuation in names', () => {
    expect(nameWords("  Rénu  D'Souza-Ño ")).toEqual(['RENU', 'D', 'SOUZA', 'NO']);
  });
});

describe('core numbers', () => {
  it('computes every number for a worked example', () => {
    // JOHN = 20 → 2, SMITH = 24 → 6; destiny 8. Vowels O + I = 15 → 6.
    // Consonants JHN = 14 → 5 and SMTH = 15 → 6 add up to master 11.
    // 15 May 1990: 5 + 6 + 1 = 12 → life path 3. Personal year 2026: 5 + 6 + 1 = 3.
    expect(computeCoreNumbers('John Smith', parseBirthDate('1990-05-15', TODAY), 2026)).toEqual({
      lifePath: 3,
      destiny: 8,
      soulUrge: 6,
      personality: 11,
      birthday: 6,
      personalYear: 3,
    });
  });

  it('keeps master numbers in the life path and birthday', () => {
    const numbers = computeCoreNumbers('Asha Rao', parseBirthDate('1990-05-05', TODAY), 2026);
    expect(numbers.lifePath).toBe(11);
    expect(computeCoreNumbers('Asha Rao', parseBirthDate('1990-05-29', TODAY), 2026).birthday).toBe(11);
    expect(computeCoreNumbers('Asha Rao', parseBirthDate('1990-05-22', TODAY), 2026).birthday).toBe(22);
  });

  it('asks for a Latin-script name', () => {
    expect(() => computeCoreNumbers('राम', parseBirthDate('1990-05-15', TODAY), 2026)).toThrow(/English letters/);
  });

  it('falls back to the destiny number when a name has no vowels', () => {
    const numbers = computeCoreNumbers('Brynn Styx', parseBirthDate('1990-05-15', TODAY), 2026);
    expect(numbers.soulUrge).toBe(numbers.destiny);
  });
});

describe('birth date', () => {
  it.each(['2023-02-29', '1990-13-01', '15/05/1990', '1899-12-31', '2026-09-26'])('refuses %s', (value) => {
    expect(() => parseBirthDate(value, TODAY)).toThrow();
  });

  it('accepts a leap day', () => {
    expect(parseBirthDate('2024-02-29', TODAY)).toEqual({ year: 2024, month: 2, day: 29 });
  });
});

describe('reading', () => {
  it('groups compatible numbers in harmony triads, with masters joining their root', () => {
    expect(compatibleNumbers(3)).toEqual([3, 6, 9]);
    expect(compatibleNumbers(11)).toEqual([2, 4, 8]);
    expect(compatibleNumbers(7)).toEqual([1, 5, 7]);
  });

  it('describes master numbers on their own and every root number with its graha', () => {
    expect(meaningOf(22).title).toMatch(/Master Builder/);
    for (let n = 1; n <= 9; n++) expect(meaningOf(n).planet).toBeTruthy();
  });

  it('bundles numbers, their meanings and lucky numbers', () => {
    const reading = buildReading('  John   Smith ', '1990-05-15', TODAY);
    expect(reading.name).toBe('John Smith');
    expect(Object.keys(reading.meanings).sort()).toEqual(['11', '3', '6', '8']);
    expect(reading.luckyNumbers).toEqual([3, 6, 8]);
    expect(reading.personalYearTheme).toMatch(/expression/);
  });
});
