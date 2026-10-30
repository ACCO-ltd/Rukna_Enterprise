/**
 * CI-8 — how a document number is built: prefix, then the document date when the count restarts
 * each year, month or day, then the count padded to its digits.
 *
 *   NEVER    INV-000124            one running count
 *   YEARLY   INV-2026-0001         restarts on 1 January
 *   MONTHLY  INV-2026-10-0001      restarts on the 1st of each month
 *   DAILY    INV-2026-10-30-001    restarts each day
 *
 * The date is the document's own date (an invoice's invoice date), read in UTC: dates are calendar
 * dates (@db.Date). Pure: the repository claims the count, this file only names it.
 */

export type NumberResetPolicy = 'NEVER' | 'YEARLY' | 'MONTHLY' | 'DAILY';

export const RESET_POLICIES: readonly NumberResetPolicy[] = ['NEVER', 'YEARLY', 'MONTHLY', 'DAILY'];

export interface NumberFormat {
  prefix: string;
  resetPolicy: NumberResetPolicy;
  paddingLength: number;
}

export const PREFIX_MAX_LENGTH = 10;
export const MIN_PADDING = 3;
export const MAX_PADDING = 8;
/** `client_invoices.invoice_number` is VARCHAR(30). */
export const NUMBER_MAX_LENGTH = 30;
/** Letters, digits and the separators people put in numbers; no spaces, which break search and copy. */
const PREFIX = /^[A-Za-z0-9/_.-]*$/;

/** The period a document falls in: '' for one running count, else "2026", "2026-10" or "2026-10-30". */
export function periodKey(policy: NumberResetPolicy, documentDate: Date): string {
  const iso = documentDate.toISOString();
  switch (policy) {
    case 'NEVER':
      return '';
    case 'YEARLY':
      return iso.slice(0, 4);
    case 'MONTHLY':
      return iso.slice(0, 7);
    case 'DAILY':
      return iso.slice(0, 10);
  }
}

/** Everything before the count: "INV-", "INV-2026-", "INV-2026-10-". */
export function numberStem(format: Pick<NumberFormat, 'prefix'>, period: string): string {
  return period ? `${format.prefix}${period}-` : format.prefix;
}

export function formatDocumentNumber(format: NumberFormat, period: string, count: number): string {
  return `${numberStem(format, period)}${String(count).padStart(format.paddingLength, '0')}`;
}

/**
 * The highest count already used under this stem, from existing numbers that start with it: only a
 * number whose remainder is all digits counts, so "INV-2026-0007" is not read as running number
 * 2026 when the stem is "INV-". 0 when none.
 */
export function highestCountUsed(stem: string, existing: readonly string[]): number {
  let highest = 0;
  for (const number of existing) {
    if (!number.startsWith(stem)) continue;
    const rest = number.slice(stem.length);
    if (!/^\d+$/.test(rest)) continue;
    highest = Math.max(highest, Number(rest));
  }
  return highest;
}

/** Every problem with a format and next number, in plain words; empty when it can be saved. */
export function numberFormatProblems(format: NumberFormat, nextNumber: number, documentDate: Date): string[] {
  const problems: string[] = [];
  if (!PREFIX.test(format.prefix)) {
    problems.push('The prefix can hold letters, digits and - / _ . only, with no spaces.');
  }
  if (format.prefix.length > PREFIX_MAX_LENGTH) {
    problems.push(`The prefix can be at most ${PREFIX_MAX_LENGTH} characters.`);
  }
  if (!RESET_POLICIES.includes(format.resetPolicy)) problems.push('Choose a number format.');
  if (!Number.isInteger(format.paddingLength) || format.paddingLength < MIN_PADDING || format.paddingLength > MAX_PADDING) {
    problems.push(`The number can have ${MIN_PADDING} to ${MAX_PADDING} digits.`);
  }
  if (!Number.isInteger(nextNumber) || nextNumber < 1) problems.push('The next number must be a whole number of 1 or more.');
  if (problems.length === 0) {
    const sample = formatDocumentNumber(format, periodKey(format.resetPolicy, documentDate), nextNumber);
    if (sample.length > NUMBER_MAX_LENGTH) {
      problems.push(`An invoice number can be at most ${NUMBER_MAX_LENGTH} characters; ${sample} is longer.`);
    }
  }
  return problems;
}
