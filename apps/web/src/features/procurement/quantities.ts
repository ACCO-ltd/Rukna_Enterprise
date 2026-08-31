/**
 * ─── Procurement arithmetic and line rules ──────────────────────────────────────
 *
 * Every rule in this file can be wrong at the cent or the unit, so all of it lives here
 * as pure functions over integer minor units and none of it lives in a component. The
 * components render what these return.
 *
 * Scales are not interchangeable. Quantity is `Decimal(18,3)` and money is
 * `Decimal(18,2)` — `QUANTITY_SCALE` and `MONEY_SCALE` in `src/lib/money.ts`. Multiplying
 * a quantity by a price therefore changes scale, which is the one piece of arithmetic here
 * that is easy to get silently wrong; `extendedAmountMinor` is the only place it happens.
 *
 * ─── The API takes numbers (P17) ────────────────────────────────────────────────
 *
 * `toApiNumber` is the single boundary where minor units become the JSON numbers the
 * procurement write DTOs demand. Nothing else in the feature may produce a float. When
 * the API is fixed to take decimal strings, this function and its call sites are the
 * whole change.
 */

import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

/**
 * Minor units → the JSON number the API expects.
 *
 * Goes through `fromMinorUnits` rather than dividing, so the decimal string is produced
 * exactly and `Number()` is applied once, to a value that is already correctly rounded.
 * Dividing directly (`minor / 10 ** scale`) reintroduces binary float error before the
 * value ever leaves us — `2999 / 100` is `29.990000000000002`.
 */
export function toApiNumber(minor: number, scale: number): number {
  return Number(fromMinorUnits(minor, scale));
}

/** Convenience wrappers so call sites read as what they are rather than as a scale. */
export const moneyToApi = (minor: number): number => toApiNumber(minor, MONEY_SCALE);
export const quantityToApi = (minor: number): number => toApiNumber(minor, QUANTITY_SCALE);

/**
 * `extendedAmount = orderedQuantity × unitPrice`, in money minor units.
 *
 * Quantity carries three decimals and price two, so their product carries five and has to
 * come back to two: `(qtyMinor × priceMinor) / 10^3`. Rounded half-up, away from zero, to
 * match how the value lands in a `Decimal(18,2)` column.
 *
 * Returns `null` when the intermediate product exceeds `Number.MAX_SAFE_INTEGER`, rather
 * than returning a quietly wrong total. At two and three decimals that ceiling is around
 * nine billion currency units at a quantity of one — far outside any real order, but a
 * paste of a wrong number should show as "—" and not as a plausible figure.
 *
 * This is a display value. The server recomputes it and its answer is authoritative.
 */
export function extendedAmountMinor(
  quantityMinor: number,
  unitPriceMinor: number,
): number | null {
  const product = quantityMinor * unitPriceMinor;
  if (!Number.isSafeInteger(product)) return null;

  // qtyMinor is qty×10³ and priceMinor is price×10², so the product is qty·price×10⁵.
  // Money minor units are qty·price×10², so the excess to shed is exactly 10^QUANTITY_SCALE.
  const divisor = 10 ** QUANTITY_SCALE;
  const negative = product < 0;
  const rounded = Math.round(Math.abs(product) / divisor);

  return negative ? -rounded : rounded;
}

/** Sums `extendedAmount` across lines. `null` if any line overflows. */
export function sumExtendedAmountMinor(
  lines: readonly { quantityMinor: number; unitPriceMinor: number }[],
): number | null {
  let total = 0;
  for (const line of lines) {
    const extended = extendedAmountMinor(line.quantityMinor, line.unitPriceMinor);
    if (extended === null) return null;
    total += extended;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

/** Total of a PO revision's lines, read off the API's own `extendedAmount` strings. */
export function revisionTotalMinor(
  lines: readonly { extendedAmount: string }[],
): number {
  return lines.reduce((sum, l) => sum + toMinorUnits(l.extendedAmount, MONEY_SCALE), 0);
}

// ─── Goods receipt line rules ────────────────────────────────────────────────────

/**
 * Why a GRN line cannot be sent, or `null` if it can.
 *
 * The returned value is an i18n key under `procurement.grn.lineError`, not a message —
 * this module is not allowed to know about locales.
 *
 * Three of these four rules are the server's. The fourth, `acceptedMustBePositive`, is a
 * defect being worked around: `@IsPositive()` on `acceptedQuantity` means a wholly
 * rejected line is refused with a `400` (P6). Catching it here turns an unexplained
 * server error into a sentence the user can act on.
 */
export type GrnLineError =
  | 'receivedMustBePositive'
  | 'acceptedMustBePositive'
  | 'negativeQuantity'
  | 'splitMustEqualReceived';

export interface GrnLineQuantities {
  receivedMinor: number;
  acceptedMinor: number;
  rejectedMinor: number;
}

export function validateGrnLine({
  receivedMinor,
  acceptedMinor,
  rejectedMinor,
}: GrnLineQuantities): GrnLineError | null {
  if (acceptedMinor < 0 || rejectedMinor < 0 || receivedMinor < 0) return 'negativeQuantity';
  if (receivedMinor <= 0) return 'receivedMustBePositive';
  if (acceptedMinor + rejectedMinor !== receivedMinor) return 'splitMustEqualReceived';
  // Must come after the split check: on a fully rejected line both fire, and the split is
  // satisfied, so the accepted-is-zero rule is the one the user needs to be told about.
  if (acceptedMinor <= 0) return 'acceptedMustBePositive';
  return null;
}

/**
 * True when a line carries nothing and should be dropped from the payload rather than
 * sent as zeros.
 *
 * §12.7 has the create screen pre-populate one row per PO line, but `receivedQuantity` is
 * `@IsPositive()`, so a partial delivery's untouched rows would `400` the whole request
 * (P6). They are filtered out instead.
 */
export function isEmptyGrnLine(line: GrnLineQuantities): boolean {
  return (
    line.receivedMinor === 0 && line.acceptedMinor === 0 && line.rejectedMinor === 0
  );
}

// ─── Over-receipt ────────────────────────────────────────────────────────────────

/**
 * The tolerance the server *probably* applies.
 *
 * It resolves an `OverReceiptPolicy` per organization and spend category and falls back to
 * 5% only when none is seeded — and no endpoint exposes the policy (P9). So this is a
 * guess, used to decide whether to show a warning. It must never be quoted as a number to
 * the user, and the message keyed off it does not quote one.
 */
export const ASSUMED_OVER_RECEIPT_PERCENT = 5;

/**
 * Percentage by which cumulative receipt exceeds the ordered quantity, or `null` when
 * nothing is ordered so the question has no answer.
 *
 * Computed in minor units, then divided once at the end — the only division, so the float
 * appears after all the exact arithmetic is done.
 */
export function overReceiptPercent(
  orderedMinor: number,
  previouslyReceivedMinor: number,
  receivedMinor: number,
): number | null {
  if (orderedMinor <= 0) return null;
  const totalAfter = previouslyReceivedMinor + receivedMinor;
  if (totalAfter <= orderedMinor) return 0;
  return ((totalAfter - orderedMinor) / orderedMinor) * 100;
}

/** True when this line would likely hold the whole receipt at `EXCEPTION_PENDING`. */
export function exceedsOverReceiptTolerance(
  orderedMinor: number,
  previouslyReceivedMinor: number,
  receivedMinor: number,
): boolean {
  const percent = overReceiptPercent(orderedMinor, previouslyReceivedMinor, receivedMinor);
  return percent !== null && percent > ASSUMED_OVER_RECEIPT_PERCENT;
}

/**
 * How this line's received quantity sits against the remaining balance, for the A1
 * over-receipt display. Three outcomes, one per D5/A1 case:
 *
 *  - `within`   — received ≤ remaining, the normal path, nothing to flag.
 *  - `tolerated`— received > remaining but within the assumed tolerance, so the server
 *                 will likely still accept and post it: show an inline over-receipt flag.
 *  - `exception`— received exceeds the assumed tolerance, so the server will route the
 *                 whole receipt to EXCEPTION_PENDING: warn that it will be held for review.
 *
 * `overByMinor` is the amount the delivery exceeds the remaining balance by — used to say
 * "exceeds remaining by N" without asserting a percentage the client cannot know (P9). It
 * is `0` in the `within` case.
 *
 * The client never caps the value (A1): the true received quantity is always what gets
 * sent, and the server is the authority on whether it becomes an exception.
 */
export type OverReceiptState = 'within' | 'tolerated' | 'exception';

export function overReceiptState(
  orderedMinor: number,
  previouslyReceivedMinor: number,
  receivedMinor: number,
): { state: OverReceiptState; overByMinor: number } {
  const remainingMinor = Math.max(orderedMinor - previouslyReceivedMinor, 0);
  const overByMinor = Math.max(receivedMinor - remainingMinor, 0);

  if (overByMinor === 0) return { state: 'within', overByMinor: 0 };

  return {
    state: exceedsOverReceiptTolerance(orderedMinor, previouslyReceivedMinor, receivedMinor)
      ? 'exception'
      : 'tolerated',
    overByMinor,
  };
}

// ─── Purchase order revision selection ───────────────────────────────────────────

/**
 * The revision a PO's status should be read from, or `null`.
 *
 * On a detail response this finds the genuinely `ACTIVE` revision. On a list response
 * there is only ever one revision embedded and it is the highest-numbered — the `DRAFT`
 * whenever a revision is in progress (P14) — so this returns `null` there and the list
 * says "latest" rather than implying it is active.
 */
export function activeRevision<T extends { status: string }>(
  revisions: readonly T[],
): T | null {
  return revisions.find((r) => r.status === 'ACTIVE') ?? null;
}

/** The highest-numbered revision — what the list response actually contains. */
export function latestRevision<T extends { revisionNumber: number }>(
  revisions: readonly T[],
): T | null {
  if (revisions.length === 0) return null;
  return revisions.reduce((max, r) => (r.revisionNumber > max.revisionNumber ? r : max));
}

// ─── Material request line rules ─────────────────────────────────────────────────

export type MrLineError = 'materialRequired' | 'descriptionRequired' | 'quantityMustBePositive';

export interface MrLineDraft {
  lineType: 'MATERIAL' | 'SERVICE' | 'OTHER';
  materialCode: string | null;
  description: string;
  quantityMinor: number | null;
}

/**
 * Mirrors `material-request.service.ts` rules MR-001 and CAT-001 so the editor refuses a
 * line the server would reject, with a message tied to the field the user touched.
 */
export function validateMrLine(line: MrLineDraft): MrLineError | null {
  if (line.lineType === 'MATERIAL' && !line.materialCode) return 'materialRequired';
  if (line.description.trim().length === 0) return 'descriptionRequired';
  if (line.quantityMinor === null || line.quantityMinor <= 0) return 'quantityMustBePositive';
  return null;
}

/** `PROJECT` scope requires a project; `ORGANIZATION` scope forbids one. */
export function validateMrScope(
  scope: 'PROJECT' | 'ORGANIZATION',
  projectId: string | null,
): 'projectRequired' | null {
  if (scope === 'PROJECT' && !projectId) return 'projectRequired';
  return null;
}

// ─── Bill matching gate ──────────────────────────────────────────────────────────

/**
 * Whether the Post button on a supplier bill should be enabled, per §6.31 and §12.8.
 *
 * The server disagrees: `POSTABLE_MATCH_STATUSES` includes `NOT_RUN`, so it will post an
 * unmatched bill (P15). This is deliberately the stricter of the two. It is an affordance
 * that makes the intended workflow obvious — it is not a control, because anyone can call
 * `POST /bills/:id/post` directly.
 */
export function canPostBill(matchStatus: string, hasPurchaseOrderLink: boolean): boolean {
  if (!hasPurchaseOrderLink) return true; // non-PO bills never require matching
  return (
    matchStatus === 'MATCHED' ||
    matchStatus === 'MATCHED_WITH_TOLERANCE' ||
    matchStatus === 'APPROVED_EXCEPTION'
  );
}
