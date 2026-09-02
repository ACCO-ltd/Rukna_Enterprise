import { describe, expect, it } from 'vitest';

import { suggestDistrictCode } from './suggest-district-code';

describe('suggestDistrictCode', () => {
  it('reproduces the seeded code for the districts the rule covers', () => {
    // These are the real ADR-025 codes from prisma/seeds/districts.seed.ts. They are the
    // benchmark: a suggester that disagrees with the codes already issued would propose a
    // second spelling for a district the registry has had all along.
    expect(suggestDistrictCode('Waaberi')).toBe('WBR');
    expect(suggestDistrictCode('Hodan')).toBe('HDN');
    expect(suggestDistrictCode('Kaaraan')).toBe('KRN');
    expect(suggestDistrictCode('Kaxda')).toBe('KXD');
    expect(suggestDistrictCode('Shibis')).toBe('SHB');
    expect(suggestDistrictCode('Heliwaa')).toBe('HLW');
    expect(suggestDistrictCode('Dayniile')).toBe('DNL');
    expect(suggestDistrictCode('Xamar Jajab')).toBe('XJJ');
  });

  it('is a suggestion, not the house convention — some seeded codes are human choices', () => {
    // Documented rather than asserted-away: no mechanical rule recovers these, which is
    // exactly why the field stays editable.
    expect(suggestDistrictCode('Boondheere')).not.toBe('BDH');
    expect(suggestDistrictCode('Cabdicasiis')).not.toBe('CDS');
  });

  it('takes one initial per word once there are three or more', () => {
    expect(suggestDistrictCode('Xamar Weyne Koonfur')).toBe('XWK');
  });

  it('folds diacritics and ignores punctuation and digits', () => {
    expect(suggestDistrictCode('Dáyniile')).toBe('DNL');
    expect(suggestDistrictCode('  hodan-2  ')).toBe('HDN');
  });

  it('falls back to vowels when a word has too few consonants', () => {
    expect(suggestDistrictCode('Ea')).toBe('EA');
    expect(suggestDistrictCode('Ooa')).toBe('OOA');
  });

  it('returns nothing for a name with no letters', () => {
    expect(suggestDistrictCode('')).toBe('');
    expect(suggestDistrictCode('   ')).toBe('');
    expect(suggestDistrictCode('123 -- 456')).toBe('');
  });

  it('never proposes a code the registry already holds', () => {
    expect(suggestDistrictCode('Hodan', ['HDN'])).not.toBe('HDN');
    // The recognisable stem survives; only the last character moves.
    expect(suggestDistrictCode('Hodan', ['HDN'])).toMatch(/^HD/);
  });

  it('compares against taken codes case-insensitively', () => {
    expect(suggestDistrictCode('Waaberi', ['wbr'])).not.toBe('WBR');
  });

  it('still returns the base code when every variant on the stem is taken', () => {
    const everyStem = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `WB${letter}`);
    expect(suggestDistrictCode('Waaberi', everyStem)).toBe('WBR');
  });
});
