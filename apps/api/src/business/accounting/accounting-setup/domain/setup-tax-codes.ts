/**
 * ADR-040 — the tax codes an install creates when the organisation charges VAT.
 *
 * Mirrors the development seed (`VAT5_OUT` / `VAT5_IN`) and ACC-TAX-001 (ADR-006): input VAT is
 * NON_RECOVERABLE — absorbed into the expense, which is exactly how supplier bills post today
 * (gross to the expense account) — so the input code carries no input-tax account.
 *
 * `TaxCode.code` is VARCHAR(10). `VAT{rate}_OUT` fits for every integer rate up to 100 and for
 * one-decimal rates below 10; a longer rate (e.g. 12.5) drops to the short suffix `VAT12.5_O`.
 */

const TAX_CODE_MAX_LENGTH = 10;

export interface SetupTaxCodePlan {
  code: string;
  name: string;
  rate: number;
  direction: 'OUTPUT' | 'INPUT';
  recoveryMethod: 'FULLY_RECOVERABLE' | 'NON_RECOVERABLE';
}

/** A rate as a code token: 5 → "5", 7.5 → "7.5", 12.25 → "12.25". */
export function rateToken(ratePercent: number): string {
  return String(Number(ratePercent.toFixed(2)));
}

export function vatTaxCode(ratePercent: number, direction: 'OUTPUT' | 'INPUT'): string {
  const token = rateToken(ratePercent);
  const long = `VAT${token}_${direction === 'OUTPUT' ? 'OUT' : 'IN'}`;
  if (long.length <= TAX_CODE_MAX_LENGTH) return long;
  return `VAT${token}_${direction === 'OUTPUT' ? 'O' : 'I'}`;
}

export function planVatTaxCodes(ratePercent: number): SetupTaxCodePlan[] {
  const token = rateToken(ratePercent);
  return [
    {
      code: vatTaxCode(ratePercent, 'OUTPUT'),
      name: `Output VAT ${token}%`,
      rate: Number(token),
      direction: 'OUTPUT',
      // Output tax is never "recovered"; the seed records it as FULLY_RECOVERABLE — mirrored.
      recoveryMethod: 'FULLY_RECOVERABLE',
    },
    {
      code: vatTaxCode(ratePercent, 'INPUT'),
      name: `Input VAT ${token}% (non-recoverable)`,
      rate: Number(token),
      direction: 'INPUT',
      recoveryMethod: 'NON_RECOVERABLE',
    },
  ];
}
