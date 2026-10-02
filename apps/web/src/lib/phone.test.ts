import { describe, expect, it } from 'vitest';

import {
  countryFlag,
  countryName,
  formatPhone,
  fromE164,
  isPhoneEmpty,
  isValidPhone,
  phoneCountries,
  telHref,
  toE164,
  whatsappHref,
} from './phone';

describe('phone helpers', () => {
  it('validates a Somali national number against the picked country', () => {
    expect(isValidPhone({ country: 'SO', number: '61 234 5678' })).toBe(true);
    expect(isValidPhone({ country: 'SO', number: '12' })).toBe(false);
    expect(isValidPhone({ country: 'SO', number: '' })).toBe(false);
    expect(isValidPhone({ country: 'XX', number: '61 234 5678' })).toBe(false);
  });

  it('emits E.164, or null when the number is not valid', () => {
    expect(toE164({ country: 'SO', number: '61 666 6666' })).toBe('+252616666666');
    expect(toE164({ country: 'SO', number: '61-234-5678' })).toBe('+252612345678');
    expect(toE164({ country: 'SO', number: 'abc' })).toBeNull();
  });

  it('lets a typed international prefix win over the picked country', () => {
    expect(toE164({ country: 'SO', number: '+254 712 345 678' })).toBe('+254712345678');
  });

  it('formats a stored number for display and leaves unparseable legacy text alone', () => {
    expect(formatPhone('+252612345678')).toBe('+252 61 234 5678');
    expect(formatPhone('+252616666666')).toBe('+252 61 666 6666');
    expect(formatPhone('call the office')).toBe('call the office');
    expect(formatPhone(null)).toBeNull();
  });

  it('splits a stored number back into the picker halves for editing', () => {
    expect(fromE164('+252612345678')).toEqual({ country: 'SO', number: '61 234 5678' });
    expect(fromE164('+254712345678').country).toBe('KE');
    expect(fromE164('0612 legacy')).toEqual({ country: 'SO', number: '0612 legacy' });
    expect(fromE164(null)).toEqual({ country: 'SO', number: '' });
  });

  it('builds tel: and wa.me links', () => {
    expect(telHref('+252612345678')).toBe('tel:+252612345678');
    expect(whatsappHref('+252612345678')).toBe('https://wa.me/252612345678');
  });

  it('knows when a field is empty', () => {
    expect(isPhoneEmpty({ country: 'SO', number: '  ' })).toBe(true);
    expect(isPhoneEmpty(undefined)).toBe(true);
    expect(isPhoneEmpty({ country: 'SO', number: '6' })).toBe(false);
  });

  it('lists countries with dial codes, Somalia first', () => {
    const countries = phoneCountries('en');
    expect(countries[0]).toEqual({ code: 'SO', name: 'Somalia', dialCode: '+252' });
    expect(countries.find((c) => c.code === 'KE')?.dialCode).toBe('+254');
    expect(countryFlag('SO')).toBe('\u{1F1F8}\u{1F1F4}');
    expect(countryName('SO')).toBe('Somalia');
  });
});
