import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

/**
 * The Prepare invoice dialog's arithmetic, in integer minor units. The tax RATE comes from the
 * server (`CommercialPreparePreviewResponse.taxRate`) — nothing here knows a rate.
 */

/** Rates arrive as fraction strings ("0.05"); six places covers any statutory rate exactly. */
const RATE_SCALE = 6;

/** `amount × rate`, rounded half away from zero to the cent, without leaving integer maths. */
export function taxMinor(subtotalMinor: number, taxRate: string | null): number {
  if (!taxRate) return 0;
  const rate = parseMinorUnits(taxRate, RATE_SCALE);
  if (rate === null || rate === 0) return 0;
  const product = BigInt(subtotalMinor) * BigInt(rate);
  const divisor = BigInt(10 ** RATE_SCALE);
  const negative = product < BigInt(0);
  const magnitude = negative ? -product : product;
  const rounded = (magnitude * BigInt(2) + divisor) / (divisor * BigInt(2));
  return Number(negative ? -rounded : rounded);
}

export interface PrepareTotals {
  subtotal: string;
  tax: string | null;
  total: string;
}

export function prepareTotals(
  stageAmount: string,
  selectedVariationAmounts: Array<string | null>,
  taxRate: string | null,
): PrepareTotals {
  const subtotalMinor =
    toMinorUnits(stageAmount, MONEY_SCALE) +
    selectedVariationAmounts.reduce<number>((sum, amount) => sum + toMinorUnits(amount, MONEY_SCALE), 0);
  const tax = taxRate ? taxMinor(subtotalMinor, taxRate) : null;
  return {
    subtotal: fromMinorUnits(subtotalMinor, MONEY_SCALE),
    tax: tax === null ? null : fromMinorUnits(tax, MONEY_SCALE),
    total: fromMinorUnits(subtotalMinor + (tax ?? 0), MONEY_SCALE),
  };
}

/** "0.05" → "5%", "0.075" → "7.5%". Display only. */
export function formatRate(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 3 }).format(n);
}
