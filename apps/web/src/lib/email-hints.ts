/**
 * Email checks for contact and billing fields (clients-redesign contract, 2026-10-02).
 *
 * The server validates format (`IsEmail`, max 254) and stores the address trimmed and
 * lower-cased. The two hints here are web-only and never block a save:
 *
 *  - a personal webmail address on an organisation (owner decision: a warning, not a block —
 *    plenty of small Somali companies run on Gmail), and
 *  - a likely typo in a common domain, offered as a one-click correction.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const EMAIL_MAX_LENGTH = 254;

/** Trim + lower-case — what the server will store. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Format check mirroring the server's RFC-ish rule. Empty is not valid — callers decide if it is optional. */
export function isEmailFormat(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);
}

/** Free webmail domains, the contract's list. */
export const PERSONAL_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'ymail.com',
  'mail.com',
  'gmx.com',
];

function domainOf(value: string): string | null {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

/** True for an address at a known free webmail domain. */
export function isPersonalEmail(value: string): boolean {
  const domain = domainOf(value);
  return domain !== null && PERSONAL_EMAIL_DOMAINS.includes(domain);
}

/** Client types for which a personal webmail address is worth a warning. */
export function expectsBusinessEmail(type: string | null | undefined): boolean {
  return type === 'COMPANY' || type === 'GOVERNMENT' || type === 'NGO';
}

/** Misspellings seen often enough to be worth naming, each mapped to the domain meant. */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
};

/**
 * The address with its domain corrected when the domain is a known misspelling —
 * `amina@gmial.com` → `amina@gmail.com`. `null` when there is nothing to suggest.
 */
export function suggestEmailCorrection(value: string): string | null {
  const email = normalizeEmail(value);
  const domain = domainOf(email);
  if (!domain) return null;
  const fixed = DOMAIN_TYPOS[domain];
  if (!fixed) return null;
  return `${email.slice(0, email.lastIndexOf('@'))}@${fixed}`;
}
