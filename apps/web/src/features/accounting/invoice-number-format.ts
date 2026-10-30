import type { NumberResetPolicy } from './types';

/**
 * CI-8 — the invoice number a format gives, for the settings preview. Mirrors the server's
 * domain/document-number-format.ts: prefix, the invoice date when the count restarts, the padded
 * count. The server's own `nextInvoiceNumber` is what is saved; this only previews unsaved choices.
 */
export const RESET_POLICIES: readonly NumberResetPolicy[] = ['NEVER', 'YEARLY', 'MONTHLY', 'DAILY'];

/** The digits that read well with each format: a running count grows longest, a day's stays short. */
export const SUGGESTED_DIGITS: Record<NumberResetPolicy, number> = { NEVER: 6, YEARLY: 4, MONTHLY: 4, DAILY: 3 };

/** `wireDate` is a calendar date, YYYY-MM-DD. */
export function previewInvoiceNumber(
  format: { prefix: string; resetPolicy: NumberResetPolicy; paddingLength: number },
  wireDate: string,
  count: number,
): string {
  const period = { NEVER: '', YEARLY: wireDate.slice(0, 4), MONTHLY: wireDate.slice(0, 7), DAILY: wireDate.slice(0, 10) }[format.resetPolicy];
  const digits = String(Math.max(1, Math.trunc(count) || 1)).padStart(format.paddingLength, '0');
  return `${format.prefix}${period ? `${period}-` : ''}${digits}`;
}
