/**
 * ─── Tax codes (ADR-041) ─────────────────────────────────────────────────────────
 *
 * A client invoice is raised at a configured tax code, never at a rate written into the code.
 * Finance keeps the codes on Accounting → Tax: a code's rate never changes once created (a new
 * rate is a new code made the default), and "no tax" is a 0% sales code.
 *
 * Rates travel as PERCENT strings here ("5", "12.5"). The invoice totals preview works on
 * fractions ("0.05"), so the conversion lives in one place — `percentToFraction` — rather than
 * as a `/ 100` at each call site.
 *
 * Pure functions only — screens render, this module decides.
 */

import { fromMinorUnits, parseMinorUnits } from '@/lib/money';

// ─── API shapes ──────────────────────────────────────────────────────────────────

export type TaxDirection = 'OUTPUT' | 'INPUT';
export type TaxCodeStatus = 'ACTIVE' | 'INACTIVE' | 'SUPERSEDED';

/** One row of `GET /tax-codes`. */
export interface TaxCode {
  id: string;
  code: string;
  name: string;
  /** Percent: "5", "0", "12.5". */
  ratePercent: string;
  direction: TaxDirection;
  status: TaxCodeStatus;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** The organisation's default sales tax code. */
  isDefault: boolean;
}

/** `GET /tax-codes`, and the answer of every tax-code command. */
export interface TaxCodesView {
  codes: TaxCode[];
  defaultOutputTaxCodeId: string | null;
}

/** The default sales tax code as the commercial prepare preview reports it. */
export interface InvoiceTaxCode {
  id: string;
  code: string;
  name: string;
  ratePercent: string;
}

/** Body of `POST /tax-codes`. */
export interface CreateTaxCodeBody {
  code: string;
  name: string;
  ratePercent: string;
  direction: TaxDirection;
  effectiveFrom?: string;
}

// ─── Rates ───────────────────────────────────────────────────────────────────────

/** Percent rates carry at most four decimals (server: Decimal, ≤ 4 dp). */
const PERCENT_SCALE = 4;
/** Percent ÷ 100 needs two more places than the percent itself. */
const FRACTION_SCALE = PERCENT_SCALE + 2;

/**
 * `"5"` → `"0.050000"`, `"12.5"` → `"0.125000"` — exactly, in integer maths. `null` for anything
 * that is not a non-negative decimal.
 */
export function percentToFraction(ratePercent: string | null | undefined): string | null {
  const scaled = parseMinorUnits(ratePercent, PERCENT_SCALE);
  if (scaled === null || scaled < 0) return null;
  // percent × 10^4 is already fraction × 10^6.
  return fromMinorUnits(scaled, FRACTION_SCALE);
}

/** `"5.0000"` → `"5"`, `"12.50"` → `"12.5"`. Display only. */
export function formatRatePercent(ratePercent: string | null | undefined): string {
  if (ratePercent === null || ratePercent === undefined) return '';
  const text = ratePercent.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return text;
  const [whole = '0', fraction = ''] = text.split('.');
  const kept = fraction.replace(/0+$/, '');
  return `${String(Number(whole))}${kept ? `.${kept}` : ''}`;
}

/** What an invoice may be raised at: ACTIVE sales (OUTPUT) codes, the default first. */
export function invoiceTaxOptions(codes: readonly TaxCode[]): TaxCode[] {
  return codes
    .filter((code) => code.status === 'ACTIVE' && code.direction === 'OUTPUT')
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code));
}

/** The default sales code in a list, or null. */
export function defaultTaxCodeOf(view: TaxCodesView | undefined): TaxCode | null {
  if (!view) return null;
  return (
    view.codes.find((code) => code.id === view.defaultOutputTaxCodeId) ??
    view.codes.find((code) => code.isDefault) ??
    null
  );
}

/** Whether "Make default" makes sense for this row. */
export function canMakeDefault(code: TaxCode): boolean {
  return code.direction === 'OUTPUT' && code.status === 'ACTIVE' && !code.isDefault;
}

// ─── New tax code ────────────────────────────────────────────────────────────────

export interface TaxCodeDraft {
  code: string;
  name: string;
  ratePercent: string;
  direction: TaxDirection | '';
  effectiveFrom: string;
}

export type TaxCodeProblem = 'code' | 'code-taken' | 'name' | 'rate' | 'direction';

export const TAX_CODE_PATTERN = /^[A-Z0-9_.]{1,10}$/;

/** 0–100 with at most four decimals. */
export function isValidRatePercent(raw: string): boolean {
  const text = raw.trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(text)) return false;
  return Number(text) <= 100;
}

export function taxCodeProblems(
  draft: TaxCodeDraft,
  takenCodes: ReadonlySet<string>,
): TaxCodeProblem[] {
  const problems: TaxCodeProblem[] = [];
  const code = draft.code.trim().toUpperCase();
  if (!TAX_CODE_PATTERN.test(code)) problems.push('code');
  else if (takenCodes.has(code)) problems.push('code-taken');
  if (!draft.name.trim()) problems.push('name');
  if (!isValidRatePercent(draft.ratePercent)) problems.push('rate');
  if (draft.direction === '') problems.push('direction');
  return problems;
}

/** The exact `POST /tax-codes` body. Only call once `taxCodeProblems` is empty. */
export function toCreateTaxCodeBody(draft: TaxCodeDraft): CreateTaxCodeBody {
  return {
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
    ratePercent: formatRatePercent(draft.ratePercent.trim()),
    direction: draft.direction === '' ? 'OUTPUT' : draft.direction,
    ...(draft.effectiveFrom ? { effectiveFrom: draft.effectiveFrom } : {}),
  };
}

// ─── Invoice generation errors ───────────────────────────────────────────────────

/** The ADR-041 refusals an invoice-raising call can answer with. */
export type InvoiceTaxErrorCode =
  'TAX_CODE_OVERRIDE_FORBIDDEN' | 'TAX_NOT_CONFIGURED' | 'TAX_CODE_NOT_APPLICABLE';

const INVOICE_TAX_ERRORS: readonly InvoiceTaxErrorCode[] = [
  'TAX_CODE_OVERRIDE_FORBIDDEN',
  'TAX_NOT_CONFIGURED',
  'TAX_CODE_NOT_APPLICABLE',
];

/** The tax refusal behind an error, or null when it is something else. */
export function invoiceTaxErrorCode(error: unknown): InvoiceTaxErrorCode | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (INVOICE_TAX_ERRORS as readonly string[]).includes(code)
    ? (code as InvoiceTaxErrorCode)
    : null;
}
