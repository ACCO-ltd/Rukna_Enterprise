/**
 * ADR-048 — the rules a hand-typed (non-contract) invoice's lines must satisfy. Pure: returns every
 * problem at once (empty = valid) and the priced lines, so the service rejects with all of them and
 * stores exactly what it checked. Money is Decimal, never a float.
 */

import { Decimal } from '@prisma/client/runtime/library';

export const MANUAL_INVOICE_MAX_LINES = 50;
export const MANUAL_LINE_DESCRIPTION_MAX = 300;

export interface ManualLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  revenueAccountCode: string;
}

export interface PricedManualLine {
  lineNo: number;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  /** quantity × unitPrice, rounded half-up to cents. */
  amount: Decimal;
  revenueAccountCode: string;
}

function parse(value: string): Decimal | null {
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function priceManualLines(lines: readonly ManualLineInput[]): {
  problems: string[];
  lines: PricedManualLine[];
  subtotal: Decimal;
} {
  const problems: string[] = [];
  if (lines.length === 0) problems.push('An invoice needs at least one line.');
  if (lines.length > MANUAL_INVOICE_MAX_LINES) {
    problems.push(`An invoice can have at most ${MANUAL_INVOICE_MAX_LINES} lines.`);
  }

  const priced: PricedManualLine[] = [];
  lines.forEach((line, i) => {
    const label = `Line ${i + 1}`;
    const description = line.description.trim();
    if (description === '') problems.push(`${label} needs a description.`);
    if (description.length > MANUAL_LINE_DESCRIPTION_MAX) {
      problems.push(`${label} description is longer than ${MANUAL_LINE_DESCRIPTION_MAX} characters.`);
    }
    if (line.revenueAccountCode.trim() === '') problems.push(`${label} needs an income account.`);

    const quantity = parse(line.quantity);
    const unitPrice = parse(line.unitPrice);
    const quantityOk = quantity !== null && quantity.gt(0) && quantity.decimalPlaces() <= 3;
    const unitPriceOk = unitPrice !== null && unitPrice.gt(0) && unitPrice.decimalPlaces() <= 2;
    if (!quantityOk) problems.push(`${label} quantity must be above 0, with up to 3 decimals.`);
    if (!unitPriceOk) problems.push(`${label} rate must be above 0, with up to 2 decimals.`);
    if (!quantityOk || !unitPriceOk) return;
    const amount = quantity.mul(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (amount.lte(0)) problems.push(`${label} amount rounds to zero.`);
    priced.push({
      lineNo: i + 1,
      description,
      quantity,
      unitPrice,
      amount,
      revenueAccountCode: line.revenueAccountCode.trim(),
    });
  });

  const subtotal = priced.reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
  return { problems, lines: priced, subtotal };
}
