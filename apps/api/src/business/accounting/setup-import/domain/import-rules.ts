import { Decimal } from '@prisma/client/runtime/library';
import type {
  SetupImportExisting,
  SetupImportField,
  SetupImportKind,
  SetupImportProblem,
  SetupImportProblemCode,
  SetupImportRow,
} from '@erp/types';

import {
  NAME_MAX,
  normaliseEmail,
  normalisePhone,
  PAYMENT_TERMS_MAX_DAYS,
} from '../../../../platform/clients/domain/client-input.js';

/**
 * Step 5 — the rules a spreadsheet row is read by. Pure: no Prisma, no Nest. The service runs them
 * once for the check and again, unchanged, inside the import transaction, so what the check showed
 * is what the import does.
 */

export const MAX_IMPORT_ROWS = 2000;
export const CODE_MAX = 30;
const TEXT_MAX = 500;

const CLIENT_TYPES = ['COMPANY', 'GOVERNMENT', 'NGO', 'INDIVIDUAL', 'OTHER'] as const;
export type ImportClientType = (typeof CLIENT_TYPES)[number];

/** A row read and normalised. Fields a problem was found in are left null. */
export interface ReadRow {
  name: string | null;
  code: string | null;
  taxNumber: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  paymentTermsDays: number | null;
  currency: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  clientType: ImportClientType | null;
  /** Null when the cell is blank or zero: nothing is owed. */
  openingBalance: Decimal | null;
  problems: SetupImportProblem[];
}

function problem(
  code: SetupImportProblemCode,
  field: SetupImportField | null,
  message: string,
  severity: 'ERROR' | 'WARNING' = 'ERROR',
): SetupImportProblem {
  return { code, field, message, severity };
}

function text(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Payment terms as people write them: "30", "30 days", "Net 30", "N30", or "due on receipt" /
 * "cash" / "immediate" / "COD" for zero. Anything else is unknown rather than guessed.
 * Returns undefined for unknown, null for blank.
 */
export function parsePaymentTerms(value: string | undefined): number | null | undefined {
  const raw = text(value)?.toLowerCase();
  if (!raw) return null;
  if (/^(due on receipt|on receipt|cash|immediate|immediately|cod|cash on delivery)$/.test(raw)) return 0;
  const match = /^(?:net\s*|n)?(\d{1,3})(?:\s*(?:days?|d))?$/.exec(raw);
  if (!match) return undefined;
  const days = Number(match[1]);
  return days <= PAYMENT_TERMS_MAX_DAYS ? days : undefined;
}

/**
 * Money as a spreadsheet shows it: "1,234.50", "$1,234.50", "1234.5", "(1,234.50)" or "-1234.50"
 * for a negative. At most two decimal places. Returns undefined for unreadable, null for blank.
 */
export function parseAmount(value: string | undefined): Decimal | null | undefined {
  const raw = text(value);
  if (!raw) return null;
  let body = raw.replace(/[\s,]/g, '').replace(/^([A-Za-z]{3}|\$)/, '').replace(/([A-Za-z]{3}|\$)$/, '');
  let negative = false;
  if (/^\(.*\)$/.test(body)) {
    negative = true;
    body = body.slice(1, -1).replace(/^\$/, '');
  }
  if (body.startsWith('-')) {
    negative = !negative;
    body = body.slice(1).replace(/^\$/, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(body)) return undefined;
  const amount = new Decimal(body);
  return negative ? amount.negated() : amount;
}

const NAME_NOISE = /\b(the|ltd|limited|co|company|inc|llc|plc|corp|corporation|group)\b/g;

/** The key two names are "the same" by: case, punctuation and company suffixes ignored. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function taxKey(taxNumber: string): string {
  return taxNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Reads one row by the rules of the kind it is. Never throws: every rule failure is a problem. */
export function readRow(kind: SetupImportKind, row: SetupImportRow, defaultCountry: string): ReadRow {
  const problems: SetupImportProblem[] = [];
  const bounded = (field: SetupImportField, max: number): string | null => {
    const value = text(row[field]);
    if (value && value.length > max) {
      problems.push(problem('TEXT_TOO_LONG', field, `Must be at most ${max} characters`));
      return null;
    }
    return value;
  };

  const name = bounded('name', NAME_MAX);
  if (!name && !problems.some((p) => p.field === 'name')) problems.push(problem('NAME_REQUIRED', 'name', 'A name is required'));

  let code: string | null = null;
  if (kind === 'suppliers') {
    code = bounded('code', CODE_MAX);
    if (code && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(code)) {
      problems.push(problem('CODE_INVALID', 'code', 'Use letters, numbers, dots, dashes or slashes'));
      code = null;
    }
  }

  let countryCode: string | null = null;
  const countryCell = text(row.country);
  if (countryCell) {
    if (/^[A-Za-z]{2}$/.test(countryCell)) countryCode = countryCell.toUpperCase();
    else problems.push(problem('COUNTRY_INVALID', 'country', 'Use the two-letter country code (e.g. KE)'));
  }

  let phone: string | null = null;
  const phoneCell = text(row.phone);
  if (phoneCell) {
    try {
      phone = phoneCell.startsWith('+')
        ? normalisePhone(phoneCell)
        : normalisePhone({ country: countryCode ?? defaultCountry, number: phoneCell });
    } catch {
      problems.push(problem('PHONE_INVALID', 'phone', `"${phoneCell}" is not a valid phone number`));
    }
  }

  let email: string | null = null;
  const emailCell = text(row.email);
  if (emailCell) {
    try {
      email = normaliseEmail(emailCell);
    } catch {
      problems.push(problem('EMAIL_INVALID', 'email', `"${emailCell}" is not a valid email address`));
    }
  }

  const contactName = bounded('contactName', NAME_MAX);
  if (kind === 'clients') {
    // A client always has a primary contact, reached by phone (the same rule as adding one by hand).
    if (!contactName) problems.push(problem('CONTACT_REQUIRED', 'contactName', 'A client needs a contact person'));
    if (!phoneCell) problems.push(problem('PHONE_REQUIRED', 'phone', 'A client needs a contact phone number'));
  }

  const terms = parsePaymentTerms(row.paymentTerms);
  if (terms === undefined) {
    problems.push(problem('PAYMENT_TERMS_UNKNOWN', 'paymentTerms', `"${text(row.paymentTerms)}" is not payment terms we know — write the number of days, e.g. 30`));
  }

  let currency: string | null = null;
  const currencyCell = text(row.currency);
  if (currencyCell) {
    if (/^[A-Za-z]{3}$/.test(currencyCell)) currency = currencyCell.toUpperCase();
    else problems.push(problem('CURRENCY_INVALID', 'currency', 'Use the three-letter currency code (e.g. USD)'));
  }

  let clientType: ImportClientType | null = null;
  if (kind === 'clients') {
    const typeCell = text(row.clientType)?.toUpperCase().replace(/[\s-]+/g, '_');
    if (typeCell) {
      const known = CLIENT_TYPES.find((t) => t === typeCell || (t === 'INDIVIDUAL' && typeCell === 'PERSON'));
      if (known) clientType = known;
      else problems.push(problem('CLIENT_TYPE_UNKNOWN', 'clientType', `"${text(row.clientType)}" is not a client type — use Company, Government, NGO, Individual or Other`));
    }
  }

  let openingBalance: Decimal | null = null;
  const amount = parseAmount(row.openingBalance);
  if (amount === undefined) {
    problems.push(problem('AMOUNT_INVALID', 'openingBalance', `"${text(row.openingBalance)}" is not an amount`));
  } else if (amount && amount.isNegative()) {
    problems.push(problem('BALANCE_NEGATIVE', 'openingBalance',
      kind === 'suppliers'
        ? 'A negative balance means the supplier owes you (an advance). Enter it in the trial balance instead'
        : 'A negative balance means you owe the client (a credit). Enter it in the trial balance instead'));
  } else if (amount && !amount.isZero()) {
    openingBalance = amount;
    // The ledger is kept in USD; an opening item in another currency could not tie out to it.
    if (currency && currency !== 'USD') {
      problems.push(problem('BALANCE_CURRENCY', 'openingBalance', 'Opening balances are recorded in USD — convert it first'));
    }
  }

  return {
    name,
    code,
    taxNumber: bounded('taxNumber', 100),
    contactName,
    phone,
    email,
    paymentTermsDays: terms ?? null,
    currency,
    address: bounded('address', TEXT_MAX),
    city: kind === 'clients' ? bounded('city', 100) : null,
    countryCode,
    clientType,
    openingBalance,
    problems,
  };
}

export interface ExistingParty extends SetupImportExisting {
  taxNumber: string | null;
}

/** The existing record a row most likely is: the same tax number first, else the same name. */
export function findLikelyDuplicate(read: Pick<ReadRow, 'name' | 'taxNumber'>, existing: ExistingParty[]): ExistingParty | null {
  if (read.taxNumber) {
    const key = taxKey(read.taxNumber);
    const byTax = existing.find((e) => e.taxNumber && taxKey(e.taxNumber) === key);
    if (byTax) return byTax;
  }
  if (read.name) {
    const key = nameKey(read.name);
    if (key) return existing.find((e) => nameKey(e.name) === key) ?? null;
  }
  return null;
}
