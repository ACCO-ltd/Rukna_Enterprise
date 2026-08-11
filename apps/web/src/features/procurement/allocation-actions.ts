import { accountName } from '@/features/accounting/account-display';
import { resolvePostingAccounts, type Resolution } from '@/features/accounting/posting-accounts';
import type { Account } from '@/features/accounting/types';
import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

import { moneyToApi } from './quantities';
import type { AllocateAdvancePayload, SupplierBill, SupplierPayment } from './types';

/**
 * ─── Applying a posted advance to a posted bill ─────────────────────────────────
 *
 * `POST /payments/:id/allocations` is the only path that settles a bill correctly. It writes
 * the allocation row, moves the payment's allocated/unallocated pair, reduces the bill's
 * `outstandingAmount`, and posts `Dr AP / Cr Supplier Advance` — all four. The `allocations[]`
 * array on `POST /payments` does none of them (A16 / #34).
 *
 * ─── Two guards the server does not have ────────────────────────────────────────
 *
 * `allocateAdvance` checks that the bill exists and is POSTED, and stops there. It does not
 * check the supplier and it does not check the currency (A18 / #36), so an advance paid to one
 * supplier can settle another supplier's bill, in another currency, and nothing downstream
 * objects — the journal balances and the trial balance ties.
 *
 * `allocatableBills` therefore filters rather than warns. This is an affordance and not a
 * control: anyone can call the endpoint directly, so the server guard is still required.
 * C16 was this same defect on the AR side; the fix there is the shape the fix here should take.
 */

export type AllocationBlockReason =
  | 'payment-not-posted'
  | 'nothing-unallocated'
  | 'no-eligible-bills';

/** `supplier-payment.service.ts:215` — the advance has to be posted before it can be applied. */
export function canAllocate(payment: SupplierPayment): boolean {
  return (
    payment.postingStatus === 'POSTED' && toMinorUnits(payment.unallocatedAmount, MONEY_SCALE) > 0
  );
}

export function allocationBlockReason(
  payment: SupplierPayment,
  eligibleBillCount: number,
): AllocationBlockReason | null {
  if (payment.postingStatus !== 'POSTED') return 'payment-not-posted';
  if (toMinorUnits(payment.unallocatedAmount, MONEY_SCALE) <= 0) return 'nothing-unallocated';
  if (eligibleBillCount === 0) return 'no-eligible-bills';
  return null;
}

/**
 * The bills a given advance may legally settle.
 *
 * Four conditions, and only the first two are enforced server-side:
 *
 *   1. POSTED — an unposted bill has no AP balance to clear (server: yes)
 *   2. still outstanding — allocating to a settled bill would drive it negative (server: no,
 *      but the amount guard makes it hard to reach by accident)
 *   3. same supplier (server: **no** — A18)
 *   4. same currency (server: **no** — A18)
 *
 * Sorted oldest first, which is the order an accounts-payable clerk settles in.
 */
export function allocatableBills(
  payment: SupplierPayment,
  bills: readonly SupplierBill[],
): SupplierBill[] {
  return bills
    .filter(
      (bill) =>
        bill.postingStatus === 'POSTED' &&
        bill.supplierId === payment.supplierId &&
        bill.currencyCode === payment.currencyCode &&
        toMinorUnits(bill.outstandingAmount, MONEY_SCALE) > 0,
    )
    .sort((a, b) => a.billDate.localeCompare(b.billDate));
}

/**
 * The most that may be applied to `bill` from `payment`: whichever runs out first.
 *
 * Over-allocating past the bill's outstanding balance is not refused by the server — it
 * decrements straight through into a negative outstanding amount — so this ceiling is the only
 * thing preventing a bill from reporting that the supplier owes money back.
 */
export function maxAllocatable(payment: SupplierPayment, bill: SupplierBill): number {
  return Math.min(
    toMinorUnits(payment.unallocatedAmount, MONEY_SCALE),
    toMinorUnits(bill.outstandingAmount, MONEY_SCALE),
  );
}

export type AmountProblem = 'empty' | 'not-positive' | 'exceeds-unallocated' | 'exceeds-bill';

/**
 * Why `amountMinor` cannot be applied, or null when it can.
 *
 * The two ceilings are reported separately because the fix differs: one means reducing the
 * amount, the other means choosing a different bill.
 */
export function allocationAmountProblem(
  amountMinor: number | null,
  payment: SupplierPayment,
  bill: SupplierBill,
): AmountProblem | null {
  if (amountMinor === null) return 'empty';
  if (amountMinor <= 0) return 'not-positive';
  if (amountMinor > toMinorUnits(payment.unallocatedAmount, MONEY_SCALE)) {
    return 'exceeds-unallocated';
  }
  if (amountMinor > toMinorUnits(bill.outstandingAmount, MONEY_SCALE)) return 'exceeds-bill';
  return null;
}

// ─── The journal an allocation will write ────────────────────────────────────────

export interface AllocationPreviewLine {
  accountCode: string;
  accountName: string;
  debit: string | null;
  credit: string | null;
}

export interface AllocationPlan {
  lines: AllocationPreviewLine[];
  payload: AllocateAdvancePayload;
}

export type AllocationPlanResult =
  | { ok: true; plan: AllocationPlan }
  | { ok: false; problems: Extract<Resolution, { ok: false }>[] };

/**
 * `supplier-payment.service.ts:244-270` writes exactly two lines:
 *
 *   Dr  Accounts Payable    amount
 *     Cr  Supplier Advance          amount
 *
 * Debit and credit are the same figure, so the entry always balances — there is no unbalanced
 * case to surface, unlike a bill or a payment post.
 *
 * Preview and payload come from one resolution, as everywhere else in this module.
 */
export function planAllocation(
  amountMinor: number,
  billId: string,
  currencyLocale: 'en' | 'ar',
  accounts: readonly Account[],
): AllocationPlanResult {
  const { resolved, problems } = resolvePostingAccounts(accounts, [
    'AP_CONTROL',
    'SUPPLIER_ADVANCE',
  ]);
  if (problems.length > 0) return { ok: false, problems };

  const ap = resolved.get('AP_CONTROL')!;
  const advance = resolved.get('SUPPLIER_ADVANCE')!;
  const amount = fromMinorUnits(amountMinor, MONEY_SCALE);

  return {
    ok: true,
    plan: {
      lines: [
        {
          accountCode: ap.code,
          accountName: accountName(ap, currencyLocale),
          debit: amount,
          credit: null,
        },
        {
          accountCode: advance.code,
          accountName: accountName(advance, currencyLocale),
          debit: null,
          credit: amount,
        },
      ],
      payload: {
        supplierBillId: billId,
        // `moneyToApi` is the one place minor units become the JSON number the DTO wants.
        // Delete it when P17 is fixed; do not open a second conversion here.
        amount: moneyToApi(amountMinor),
        apAccountCode: ap.code,
        supplierAdvanceCode: advance.code,
      },
    },
  };
}
