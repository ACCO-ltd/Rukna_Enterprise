import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

/** The Prepare invoice dialog's arithmetic, in integer minor units. */
export interface PrepareTotals {
  subtotal: string;
  total: string;
}

export function prepareTotals(stageAmount: string, selectedVariationAmounts: Array<string | null>): PrepareTotals {
  const subtotalMinor =
    toMinorUnits(stageAmount, MONEY_SCALE) +
    selectedVariationAmounts.reduce<number>((sum, amount) => sum + toMinorUnits(amount, MONEY_SCALE), 0);
  const subtotal = fromMinorUnits(subtotalMinor, MONEY_SCALE);
  return { subtotal, total: subtotal };
}

/** "0.05" → "5%", "0.075" → "7.5%". Display only. */
export function formatRate(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 3 }).format(n);
}
