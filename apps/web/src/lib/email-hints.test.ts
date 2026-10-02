import { describe, expect, it } from 'vitest';

import {
  expectsBusinessEmail,
  isEmailFormat,
  isPersonalEmail,
  normalizeEmail,
  suggestEmailCorrection,
} from './email-hints';

describe('email hints', () => {
  it('checks format the way the server does, after trimming', () => {
    expect(isEmailFormat(' amina@baraka.so ')).toBe(true);
    expect(isEmailFormat('amina@baraka')).toBe(false);
    expect(isEmailFormat('amina baraka.so')).toBe(false);
    expect(isEmailFormat('')).toBe(false);
    expect(isEmailFormat(`${'a'.repeat(250)}@x.so`)).toBe(false);
  });

  it('normalises to what is stored', () => {
    expect(normalizeEmail('  Amina@Baraka.SO ')).toBe('amina@baraka.so');
  });

  it('recognises free webmail domains', () => {
    expect(isPersonalEmail('amina@gmail.com')).toBe(true);
    expect(isPersonalEmail('AMINA@Hotmail.com')).toBe(true);
    expect(isPersonalEmail('amina@proton.me')).toBe(true);
    expect(isPersonalEmail('amina@baraka.so')).toBe(false);
  });

  it('warns only for organisations', () => {
    expect(expectsBusinessEmail('COMPANY')).toBe(true);
    expect(expectsBusinessEmail('GOVERNMENT')).toBe(true);
    expect(expectsBusinessEmail('NGO')).toBe(true);
    expect(expectsBusinessEmail('INDIVIDUAL')).toBe(false);
    expect(expectsBusinessEmail('OTHER')).toBe(false);
  });

  it('suggests the domain meant for a common misspelling', () => {
    expect(suggestEmailCorrection('amina@gmial.com')).toBe('amina@gmail.com');
    expect(suggestEmailCorrection('amina@yaho.com')).toBe('amina@yahoo.com');
    expect(suggestEmailCorrection('amina@hotmial.com')).toBe('amina@hotmail.com');
    expect(suggestEmailCorrection('amina@gmail.con')).toBe('amina@gmail.com');
    expect(suggestEmailCorrection('amina@gmail.com')).toBeNull();
    expect(suggestEmailCorrection('amina')).toBeNull();
  });
});
