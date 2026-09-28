/**
 * ADR-021 CONST-PROG-002/009 — cumulative verified quantity on a BOQ leaf may not exceed the leaf's
 * measurable quantity. This is the pure half of that rule: given what a report measures per line
 * and what OTHER approved reports have already verified, name every line the report would push
 * over its BOQ quantity and say how much this report could still carry.
 *
 * The service runs it twice: at submit (early, so the site engineer fixes the entry while it is
 * still in their hands) and again at approve, which stays authoritative because other reports may
 * be approved in between.
 *
 * Pure and synchronous — the caller supplies the figures. Quantities are decimal-exact.
 */

import { Decimal } from '@prisma/client/runtime/library';

const ZERO = new Decimal(0);

/** Wire code carried on `error.code` when a report would exceed a BOQ line's quantity. */
export const DPR_EXCEEDS_BOQ_QUANTITY = 'DPR_EXCEEDS_BOQ_QUANTITY';

export interface OverQuantityInput {
  boqNodeId: string;
  boqCode: string | null;
  description: string | null;
  unit: string | null;
  /** The leaf's measurable quantity (null/absent reads as 0 — nothing can be measured). */
  boqQuantity: Decimal;
  /** Σ quantity already verified by OTHER approved reports on this line. */
  verifiedToDate: Decimal;
  /** Σ quantity this report measures on this line. */
  thisReport: Decimal;
}

/** One offending line, decimal strings on the wire (`error.details.lines[]`). */
export interface OverQuantityLine {
  boqNodeId: string;
  boqCode: string | null;
  description: string | null;
  unit: string | null;
  boqQuantity: string;
  verifiedToDate: string;
  thisReport: string;
  /** boqQuantity − verifiedToDate, floored at 0: the most this report may carry on the line. */
  maxForThisReport: string;
}

/** Every line where verifiedToDate + thisReport > boqQuantity, in input order. Empty ⇒ within scope. */
export function findOverQuantityLines(inputs: readonly OverQuantityInput[]): OverQuantityLine[] {
  const over: OverQuantityLine[] = [];
  for (const line of inputs) {
    if (!line.verifiedToDate.plus(line.thisReport).greaterThan(line.boqQuantity)) continue;
    const remaining = line.boqQuantity.minus(line.verifiedToDate);
    over.push({
      boqNodeId: line.boqNodeId,
      boqCode: line.boqCode,
      description: line.description,
      unit: line.unit,
      boqQuantity: line.boqQuantity.toString(),
      verifiedToDate: line.verifiedToDate.toString(),
      thisReport: line.thisReport.toString(),
      maxForThisReport: (remaining.greaterThan(ZERO) ? remaining : ZERO).toString(),
    });
  }
  return over;
}

/**
 * Plain-English message naming the first offending line, e.g.
 * "2.2 RC C30 slab: this report brings the total to 70 m³ but the BOQ has 60 m³. Enter 2 or less,
 * or raise a variation." When more than one line is over, the count of the rest is appended.
 */
export function overQuantityMessage(lines: readonly OverQuantityLine[]): string {
  const first = lines[0];
  if (!first) return 'This report exceeds the BOQ quantity on a line.';

  const label =
    [first.boqCode, first.description].filter((part) => part && part.trim()).join(' ') ||
    'A BOQ line';
  const unit = first.unit && first.unit.trim() ? ` ${first.unit.trim()}` : '';
  const total = new Decimal(first.verifiedToDate).plus(new Decimal(first.thisReport)).toString();
  const max = new Decimal(first.maxForThisReport);
  const advice = max.greaterThan(ZERO)
    ? `Enter ${max.toString()} or less, or raise a variation.`
    : 'Nothing more can be recorded on this line; raise a variation.';

  let message = `${label}: this report brings the total to ${total}${unit} but the BOQ has ${first.boqQuantity}${unit}. ${advice}`;
  const others = lines.length - 1;
  if (others > 0) message += ` ${others} other line${others === 1 ? ' is' : 's are'} also over.`;
  return message;
}
