import { BadRequestException } from '@nestjs/common';

import {
  normaliseCountryCode,
  normaliseEmail,
  normaliseName,
  normaliseOptionalText,
  normalisePaymentTermsDays,
  normalisePhone,
  patchValue,
} from './client-input';

function errorOf(fn: () => unknown): { errorCode: string; field: string; details: { field: string } } {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as never;
  }
  throw new Error('expected a 400');
}

describe('normaliseName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normaliseName('  Ministry   of\tFinance \n')).toBe('Ministry of Finance');
  });
  it('rejects blank, non-string and over-long names with NAME_INVALID + field', () => {
    expect(errorOf(() => normaliseName('   ', 'primaryContact.name'))).toMatchObject({
      errorCode: 'NAME_INVALID',
      field: 'primaryContact.name',
      details: { field: 'primaryContact.name' },
    });
    expect(errorOf(() => normaliseName(42)).errorCode).toBe('NAME_INVALID');
    expect(errorOf(() => normaliseName('x'.repeat(256))).errorCode).toBe('NAME_INVALID');
    expect(normaliseName('x'.repeat(255))).toHaveLength(255);
  });
});

describe('normalisePhone', () => {
  it('accepts { country, number } and returns E.164', () => {
    expect(normalisePhone({ country: 'SO', number: '61 234 5678' })).toBe('+252612345678');
    expect(normalisePhone({ country: 'so', number: '0612345678' })).toBe('+252612345678');
    expect(normalisePhone({ country: 'KE', number: '0712 345 678' })).toBe('+254712345678');
  });
  it('accepts a full international string', () => {
    expect(normalisePhone('+252 61 234 5678')).toBe('+252612345678');
    expect(normalisePhone('+252612345678')).toBe('+252612345678');
  });
  it('rejects invalid numbers with PHONE_INVALID naming the field', () => {
    expect(errorOf(() => normalisePhone({ country: 'SO', number: '12' }, 'whatsappPhone'))).toMatchObject({
      errorCode: 'PHONE_INVALID',
      field: 'whatsappPhone',
    });
    expect(errorOf(() => normalisePhone('0612345678')).errorCode).toBe('PHONE_INVALID'); // no country
    expect(errorOf(() => normalisePhone('+252')).errorCode).toBe('PHONE_INVALID');
    expect(errorOf(() => normalisePhone('not a phone')).errorCode).toBe('PHONE_INVALID');
    expect(errorOf(() => normalisePhone({ country: 'XX', number: '612345678' })).errorCode).toBe('PHONE_INVALID');
    expect(errorOf(() => normalisePhone({ number: '612345678' })).errorCode).toBe('PHONE_INVALID');
    expect(errorOf(() => normalisePhone(null)).errorCode).toBe('PHONE_INVALID');
    expect(errorOf(() => normalisePhone(612345678)).errorCode).toBe('PHONE_INVALID');
  });
});

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Ahmed@Example.COM ')).toBe('ahmed@example.com');
  });
  it('rejects malformed and over-long addresses with EMAIL_INVALID', () => {
    expect(errorOf(() => normaliseEmail('ahmed@', 'invoiceEmail'))).toMatchObject({
      errorCode: 'EMAIL_INVALID',
      field: 'invoiceEmail',
    });
    expect(errorOf(() => normaliseEmail(`${'a'.repeat(250)}@x.com`)).errorCode).toBe('EMAIL_INVALID');
    expect(errorOf(() => normaliseEmail('')).errorCode).toBe('EMAIL_INVALID');
  });
  it('accepts personal webmail (the warning is web-only, never a block)', () => {
    expect(normaliseEmail('someone@gmail.com')).toBe('someone@gmail.com');
  });
});

describe('small field rules', () => {
  it('optional text: blank → null, bounded', () => {
    expect(normaliseOptionalText('  ', 'city', 100)).toBeNull();
    expect(normaliseOptionalText(null, 'city', 100)).toBeNull();
    expect(normaliseOptionalText(' Mogadishu ', 'city', 100)).toBe('Mogadishu');
    expect(errorOf(() => normaliseOptionalText('x'.repeat(101), 'city', 100)).field).toBe('city');
  });
  it('country code: two letters, upper-cased', () => {
    expect(normaliseCountryCode('so')).toBe('SO');
    expect(errorOf(() => normaliseCountryCode('SOM')).errorCode).toBe('COUNTRY_INVALID');
  });
  it('payment terms: whole days 0–365', () => {
    expect(normalisePaymentTermsDays(0)).toBe(0);
    expect(normalisePaymentTermsDays(365)).toBe(365);
    expect(errorOf(() => normalisePaymentTermsDays(366)).errorCode).toBe('PAYMENT_TERMS_INVALID');
    expect(errorOf(() => normalisePaymentTermsDays(-1)).errorCode).toBe('PAYMENT_TERMS_INVALID');
    expect(errorOf(() => normalisePaymentTermsDays(1.5)).errorCode).toBe('PAYMENT_TERMS_INVALID');
  });
  it('patchValue: undefined = leave, null = clear, else normalise', () => {
    expect(patchValue(undefined, () => 'x')).toBeUndefined();
    expect(patchValue(null, () => 'x')).toBeNull();
    expect(patchValue('a', (v) => `${String(v)}!`)).toBe('a!');
  });
});
