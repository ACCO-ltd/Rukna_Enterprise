import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Phone numbers, the way the server stores them (clients-redesign contract, 2026-10-02):
 * parsed with `libphonenumber-js`, valid by its rules, stored and returned as E.164
 * (`+252612345678`). The server is the authority; this mirrors it so a bad number is caught
 * at the field rather than as a 400 after Save.
 */

/** What a phone field holds while someone types: the country picked, and the national number. */
export interface PhoneValue {
  /** ISO-3166 alpha-2 — the dial code comes from it. */
  country: string;
  /** As typed. May also be a full international number (`+254…`), which wins over `country`. */
  number: string;
}

/** ACCO works in Somalia; every new phone field starts there. */
export const DEFAULT_PHONE_COUNTRY = 'SO';

export const EMPTY_PHONE: PhoneValue = { country: DEFAULT_PHONE_COUNTRY, number: '' };

function isCountryCode(value: string): value is CountryCode {
  return (getCountries() as string[]).includes(value);
}

function parse(value: PhoneValue) {
  const number = value.number.trim();
  if (!number) return undefined;
  const country = isCountryCode(value.country) ? value.country : undefined;
  return parsePhoneNumberFromString(number, country);
}

/** True when nothing has been typed. */
export function isPhoneEmpty(value: PhoneValue | null | undefined): boolean {
  return !value || value.number.trim() === '';
}

/** Valid by libphonenumber's rules for the picked country (or the number's own `+` prefix). */
export function isValidPhone(value: PhoneValue): boolean {
  const number = value.number.trim();
  if (!number) return false;
  if (number.startsWith('+')) return isValidPhoneNumber(number);
  return isCountryCode(value.country) && isValidPhoneNumber(number, value.country);
}

/** The E.164 string the API takes, or `null` when the number is empty or invalid. */
export function toE164(value: PhoneValue): string | null {
  if (!isValidPhone(value)) return null;
  return parse(value)?.number ?? null;
}

/**
 * Splits a stored number back into the picker's two halves, for an edit form. A stored value
 * that does not parse (a legacy free-text number, kept as entered until next edited) lands in
 * the number box unchanged, under the default country, so the person can correct it.
 */
export function fromE164(stored: string | null | undefined): PhoneValue {
  if (!stored) return { ...EMPTY_PHONE };
  const parsed = parsePhoneNumberFromString(stored);
  if (!parsed || !parsed.country) return { country: DEFAULT_PHONE_COUNTRY, number: stored };
  return { country: parsed.country, number: parsed.formatNational() };
}

/**
 * Display form of a stored number: `+252612345678` → `+252 61 234 5678`. A value that does not
 * parse is shown exactly as stored — reformatting a number we cannot read would only garble it.
 */
export function formatPhone(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parsed = parsePhoneNumberFromString(stored);
  return parsed ? parsed.formatInternational() : stored;
}

/** `tel:` target — the E.164 digits when parseable, the stored text otherwise. */
export function telHref(stored: string): string {
  const parsed = parsePhoneNumberFromString(stored);
  return `tel:${parsed ? parsed.number : stored.replace(/\s+/g, '')}`;
}

/** `https://wa.me/<digits>` — WhatsApp's click-to-chat link takes the number without `+`. */
export function whatsappHref(stored: string): string {
  return `https://wa.me/${stored.replace(/\D/g, '')}`;
}

/** Regional-indicator flag for an ISO country code: `SO` → the Somali flag glyph. */
export function countryFlag(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return '';
  return String.fromCodePoint(...[...country].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

export interface CountryOption {
  code: string;
  name: string;
  dialCode: string;
}

const countryCache = new Map<string, CountryOption[]>();

/**
 * Every country libphonenumber knows, named in the UI language and sorted by name — with the
 * default country first, because it is the one nearly every number is in.
 */
export function phoneCountries(locale = 'en'): CountryOption[] {
  const cached = countryCache.get(locale);
  if (cached) return cached;
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const all = getCountries()
    .map((code) => ({
      code,
      name: names.of(code) ?? code,
      dialCode: `+${getCountryCallingCode(code)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const first = all.filter((c) => c.code === DEFAULT_PHONE_COUNTRY);
  const rest = all.filter((c) => c.code !== DEFAULT_PHONE_COUNTRY);
  const result = [...first, ...rest];
  countryCache.set(locale, result);
  return result;
}

/** A country's name in the UI language, for read-only display (`SO` → `Somalia`). */
export function countryName(code: string | null | undefined, locale = 'en'): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
