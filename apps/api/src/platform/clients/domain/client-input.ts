import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { isSupportedCountry, parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js';
import type { PhoneInput } from '@erp/types';

/**
 * Clients redesign — the shared input rules (docs/design/clients-redesign-contract.md, "Shared
 * validation"). The server is the authority; the web mirrors these. Pure functions: no Prisma, no
 * Nest beyond the 400 they throw, so each rule is unit-tested on its own.
 *
 * Every rejection is a 400 whose body names the offending field:
 * `{ errorCode: 'PHONE_INVALID' | 'EMAIL_INVALID' | 'NAME_INVALID' | ..., field, details: { field } }`.
 * (`details.field` is what survives the global exception filter onto the wire.)
 */

export const NAME_MAX = 255;
export const EMAIL_MAX = 254;
export const PAYMENT_TERMS_MAX_DAYS = 365;

export function invalid(errorCode: string, field: string, message: string): BadRequestException {
  return new BadRequestException({ errorCode, field, message, details: { field } });
}

/** Trimmed, inner whitespace collapsed; 1–255 characters. */
export function normaliseName(value: unknown, field = 'name'): string {
  if (typeof value !== 'string') throw invalid('NAME_INVALID', field, 'Name is required');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > NAME_MAX) {
    throw invalid('NAME_INVALID', field, `Name must be 1–${NAME_MAX} characters`);
  }
  return name;
}

/**
 * A phone as E.164 (`+252612345678`). Accepts `{ country: 'SO', number: '61 234 5678' }` or a full
 * international string (`'+25261…'`). Parsed with libphonenumber-js and must be `isValid()`.
 */
export function normalisePhone(value: unknown, field = 'phone'): string {
  const fail = () => invalid('PHONE_INVALID', field, 'Enter a valid phone number');
  let text: string;
  let country: CountryCode | undefined;
  if (typeof value === 'string') {
    text = value.trim();
    // A bare string must carry its own country code — there is no default to guess from.
    if (!text.startsWith('+')) throw fail();
  } else if (value !== null && typeof value === 'object') {
    const { country: c, number: n } = value as { country?: unknown; number?: unknown };
    if (typeof n !== 'string' || typeof c !== 'string') throw fail();
    const upper = c.trim().toUpperCase();
    if (!isSupportedCountry(upper)) throw fail();
    country = upper;
    text = n.trim();
  } else {
    throw fail();
  }
  if (text.length === 0 || text.length > 50) throw fail();
  try {
    const parsed = parsePhoneNumberWithError(text, country);
    if (!parsed.isValid()) throw fail();
    return parsed.number;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw fail();
  }
}

/** Trimmed, lower-cased, RFC-ish (`isEmail`), at most 254 characters. */
export function normaliseEmail(value: unknown, field = 'email'): string {
  const fail = () => invalid('EMAIL_INVALID', field, 'Enter a valid email address');
  if (typeof value !== 'string') throw fail();
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX || !isEmail(email)) throw fail();
  return email;
}

/** Optional free text: trimmed; blank → null; bounded. */
export function normaliseOptionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalid('FIELD_INVALID', field, `${field} must be text`);
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > max) throw invalid('FIELD_INVALID', field, `${field} must be at most ${max} characters`);
  return text;
}

/** ISO-3166 alpha-2, upper-cased. */
export function normaliseCountryCode(value: unknown, field = 'countryCode'): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value.trim())) {
    throw invalid('COUNTRY_INVALID', field, 'Country must be a two-letter ISO code');
  }
  return value.trim().toUpperCase();
}

/** Whole days, 0–365. */
export function normalisePaymentTermsDays(value: unknown, field = 'paymentTermsDays'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > PAYMENT_TERMS_MAX_DAYS) {
    throw invalid('PAYMENT_TERMS_INVALID', field, `Payment terms must be 0–${PAYMENT_TERMS_MAX_DAYS} days`);
  }
  return value;
}

/** Optional-and-clearable: `undefined` = leave alone, `null` = clear, otherwise normalise. */
export function patchValue<T>(value: unknown, normalise: (v: unknown) => T): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalise(value);
}

export type { PhoneInput };
