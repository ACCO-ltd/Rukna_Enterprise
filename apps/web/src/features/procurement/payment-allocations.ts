/**
 * ─── Allocate-on-create: selecting bills and splitting a payment across them ──────
 *
 * The product-owner flow (D9): create a payment and settle its bills in one step. This
 * module holds every rule that can be wrong at the cent, as a pure function over integer
 * minor units — the form renders what these return and sends what `buildAllocations`
 * produces. Siblings of `allocation-actions.ts` (the standalone reconciliation tool) and
 * `bill-po-match.ts`.
 *
 * ─── The backend contract this mirrors (A16, merged — commit eb826bb) ────────────
 *
 * `SupplierPaymentService.create` now writes allocation rows and reduces each target bill's
 * `outstandingAmount` inside the create transaction — the mitigation era, where `allocations[]`
 * was counted but never persisted, is over. It validates, per allocation:
 *
 *   1. the bill exists and is in this org
 *   2. `bill.supplierId === payment.supplierId`   (same supplier)
 *   3. `bill.currencyCode === payment.currencyCode` (currency match — USD-only here)
 *   4. `bill.postingStatus === 'POSTED'`           (a live AP liability)
 *   5. `amount ≤ bill.outstandingAmount`           (per-bill ceiling)
 *
 * and, across all of them, `Σ amount ≤ totalAmount`. The remainder (`totalAmount − Σ`) is
 * stored as `unallocatedAmount` — a supplier advance the standalone panel can later apply.
 *
 * Conditions 2–4 are made unreachable by the UI rather than merely refused: the "Apply to
 * bills" list is built from `apply-to-bills` below, which is already supplier-, currency- and
 * POSTED-scoped. That leaves the two amount ceilings (5 and Σ) as the only client validation
 * with anything to catch — the same shape as the standalone panel.
 */

import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

import { moneyToApi } from './quantities';
import type { PaymentAllocationPayload, SupplierBill } from './types';

// ─── The bills a new payment may settle ──────────────────────────────────────────

/**
 * The outstanding POSTED bills for the payment's supplier, in this currency — the "Apply to
 * bills" list. Oldest first, the order an accounts-payable clerk settles in.
 *
 * There is no server-side "outstanding POSTED bills" filter: `GET /bills?supplierId=` returns
 * every bill for the supplier regardless of status or balance (A7 — `status` is documented and
 * not implemented). So the scoping is done here, off the one filter that does exist. Mirrors
 * `allocatableBills`, minus the payment argument the standalone panel needs.
 */
export function applyToBills(
  supplierId: string,
  currencyCode: string,
  bills: readonly SupplierBill[],
): SupplierBill[] {
  return bills
    .filter(
      (bill) =>
        bill.supplierId === supplierId &&
        bill.currencyCode === currencyCode &&
        bill.postingStatus === 'POSTED' &&
        toMinorUnits(bill.outstandingAmount, MONEY_SCALE) > 0,
    )
    .sort((a, b) => a.billDate.localeCompare(b.billDate));
}

// ─── The full-settlement prefill ─────────────────────────────────────────────────

/**
 * What checking a bill prefills into its apply field, in minor units: whichever ceiling binds
 * first — the bill's outstanding balance, or what the payment has left unallocated.
 *
 * `min(outstanding, remaining)` is the whole D9 "intelligent prefill (especially full
 * settlement)" rule. `remaining` is the payment amount minus everything already applied to the
 * *other* checked bills, so ticking bills in turn walks the money down exactly, and the last
 * bill a payment cannot fully cover prefills to the partial remainder rather than overshooting.
 *
 * Returns `0` when nothing is left — checking a bill after the payment is spent selects it with
 * a zero apply, which `buildAllocations` then drops, so an over-selected bill is silently
 * harmless rather than an error.
 */
export function prefillAmountMinor(
  outstandingMinor: number,
  remainingUnallocatedMinor: number,
): number {
  return Math.max(0, Math.min(outstandingMinor, remainingUnallocatedMinor));
}

// ─── Live footer math: Applied · Unapplied ───────────────────────────────────────

/**
 * Sum of the apply amounts across the checked bills, in minor units. Unchecked bills and
 * unparseable inputs contribute nothing — an in-progress edit never makes the footer jump.
 */
export function totalAppliedMinor(
  rows: readonly { checked: boolean; amountMinor: number | null }[],
): number {
  return rows.reduce(
    (sum, row) => (row.checked && row.amountMinor !== null ? sum + row.amountMinor : sum),
    0,
  );
}

/**
 * The unapplied balance — what the payment amount exceeds the sum of allocations by, which the
 * server stores as a supplier advance. Never negative: an over-application is a validation
 * error surfaced elsewhere, not a negative advance.
 */
export function unappliedMinor(paymentAmountMinor: number, appliedMinor: number): number {
  return Math.max(0, paymentAmountMinor - appliedMinor);
}

// ─── Client validation, mirroring the server ─────────────────────────────────────

export interface AllocationRowInput {
  billId: string;
  checked: boolean;
  /** The user's apply amount in minor units, or `null` when the field cannot be parsed. */
  amountMinor: number | null;
  /** The target bill's outstanding balance, in minor units. */
  outstandingMinor: number;
}

/**
 * Why a single checked row cannot be sent, or `null` when it can. Unchecked rows are always
 * `null` — an unticked bill is simply not part of the payment.
 *
 *  - `empty`         — checked but the apply field does not parse to a number
 *  - `not-positive`  — checked with a zero or negative amount (the DTO is `@Min(0.01)`)
 *  - `exceeds-bill`  — apply amount is more than that bill still owes (server ceiling 5)
 *
 * A zero on a checked row is reported rather than silently dropped: the user ticked it meaning
 * to pay it, so a blank or 0 is a mistake to point at, not an intention to honour.
 */
export type RowProblem = 'empty' | 'not-positive' | 'exceeds-bill';

export function rowProblem(row: AllocationRowInput): RowProblem | null {
  if (!row.checked) return null;
  if (row.amountMinor === null) return 'empty';
  if (row.amountMinor <= 0) return 'not-positive';
  if (row.amountMinor > row.outstandingMinor) return 'exceeds-bill';
  return null;
}

export type AllocationProblem = RowProblem | 'exceeds-amount';

/**
 * Whether the whole "Apply to bills" section is submittable, and why not.
 *
 * Two things can be wrong: a single row (see `rowProblem`), or the total — `Σ applied` may not
 * exceed the payment amount (server ceiling Σ). The per-row ceiling is checked first, because
 * a row that individually overshoots its bill is a clearer thing to fix than a total that is
 * off by that same amount.
 *
 * `exceeds-amount` fires only when every row is individually valid; otherwise the row errors
 * are the actionable ones. A pure advance (nothing checked) is always valid — `Σ = 0 ≤ amount`.
 */
export function allocationSectionProblem(
  rows: readonly AllocationRowInput[],
  paymentAmountMinor: number,
): AllocationProblem | null {
  for (const row of rows) {
    const problem = rowProblem(row);
    if (problem) return problem;
  }

  const applied = rows.reduce(
    (sum, row) => (row.checked && row.amountMinor !== null ? sum + row.amountMinor : sum),
    0,
  );
  if (applied > paymentAmountMinor) return 'exceeds-amount';

  return null;
}

// ─── The payload ─────────────────────────────────────────────────────────────────

/**
 * The `allocations[]` array for `POST /payments` — only the checked rows carrying a positive
 * amount. A checked row prefilled to 0 (the payment ran out before it) is dropped rather than
 * sent, since the DTO rejects `amount < 0.01` and a zero allocation means nothing anyway.
 *
 * `moneyToApi` is the one place minor units become the JSON number the DTO wants — shared with
 * every other procurement write path. Assumes the rows have already passed
 * `allocationSectionProblem`; it does not re-validate.
 */
export function buildAllocations(
  rows: readonly AllocationRowInput[],
): PaymentAllocationPayload[] {
  return rows
    .filter((row) => row.checked && row.amountMinor !== null && row.amountMinor > 0)
    .map((row) => ({
      supplierBillId: row.billId,
      amount: moneyToApi(row.amountMinor as number),
    }));
}
