import { accountName } from '@/features/accounting/account-display';
import { resolvePostingAccounts, type Resolution } from '@/features/accounting/posting-accounts';
import type { Account, BankAccount } from '@/features/accounting/types';
import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

import type { SupplierPayment, PostSupplierPaymentPayload } from './types';

/**
 * ─── What a supplier payment will let you do ────────────────────────────────────
 *
 * Sibling of `bill-actions.ts`, and a step shorter — a payment has no SUBMITTED state:
 *
 *   DRAFT ──approve──▶ APPROVED ──post──▶ (POSTED) ──reverse──▶ (REVERSED)
 *
 * The parenthesised states are `postingStatus`; the rest are `documentStatus`.
 */

export type PaymentAction = 'approve' | 'post' | 'reverse';

export type PaymentBlockReason =
  | 'not-draft'
  | 'not-approved'
  | 'already-posted'
  | 'not-posted'
  | 'already-reversed'
  | 'has-allocations';

/** `supplier-payment.service.ts:97` — approve requires DRAFT. */
export function canApprove(payment: SupplierPayment): boolean {
  return payment.documentStatus === 'DRAFT';
}

const POSTABLE_STATUSES: readonly SupplierPayment['postingStatus'][] = ['NOT_POSTED', 'FAILED'];

/**
 * `supplier-payment.service.ts:117,120`.
 *
 * Stricter than the server on `postingStatus`, exactly as `canPost` is for bills and invoices:
 * the server rejects only POSTED, so a REVERSED payment passes its guard and can be posted a
 * second time. Do not relax this — fix the server.
 */
export function canPost(payment: SupplierPayment): boolean {
  return (
    payment.documentStatus === 'APPROVED' && POSTABLE_STATUSES.includes(payment.postingStatus)
  );
}

/**
 * `supplier-payment.service.ts:312,317` — reversal requires POSTED and no POSTED advance
 * allocation against this payment.
 *
 * The allocation guard cannot be mirrored here: `GET /payments/:id` returns no allocations
 * despite its summary claiming otherwise, and no endpoint lists them. So Reverse stays offered
 * on a payment that has been allocated and the 400 is surfaced as a message. Revisit when the
 * payload carries them.
 */
export function canReverse(payment: SupplierPayment): boolean {
  return payment.postingStatus === 'POSTED';
}

export function availablePaymentActions(payment: SupplierPayment): PaymentAction[] {
  const actions: PaymentAction[] = [];
  if (canApprove(payment)) actions.push('approve');
  if (canPost(payment)) actions.push('post');
  if (canReverse(payment)) actions.push('reverse');
  return actions;
}

export function paymentBlockReason(
  payment: SupplierPayment,
  action: PaymentAction,
): PaymentBlockReason | null {
  switch (action) {
    case 'approve':
      return canApprove(payment) ? null : 'not-draft';

    case 'post': {
      if (canPost(payment)) return null;
      if (payment.postingStatus === 'POSTED') return 'already-posted';
      if (payment.postingStatus === 'REVERSED') return 'already-reversed';
      return 'not-approved';
    }

    case 'reverse':
      if (canReverse(payment)) return null;
      return payment.postingStatus === 'REVERSED' ? 'already-reversed' : 'not-posted';
  }
}

// ─── Bank accounts a payment may draw on ─────────────────────────────────────────

/**
 * The bank accounts offered when raising a payment.
 *
 * `allowsPayments` exists precisely so a receipts-only account cannot be paid from, and
 * `status` excludes the suspended and closed. Neither is enforced server-side — `create`
 * validates no foreign key at all (A16) — so this filter is the only thing between a user and
 * a payment drawn on a closed account.
 *
 * Sorted by bank then account name so the order is stable between renders and users.
 */
export function payableBankAccounts(accounts: readonly BankAccount[]): BankAccount[] {
  return accounts
    .filter((account) => account.status === 'ACTIVE' && account.allowsPayments)
    .sort((a, b) =>
      a.bankName === b.bankName
        ? a.accountName.localeCompare(b.accountName)
        : a.bankName.localeCompare(b.bankName),
    );
}

/** `Salaam Bank · Main Operating — ****4821`, with the account number masked to its last four. */
export function bankAccountLabel(account: BankAccount): string {
  const tail = account.accountNumber.slice(-4);
  return `${account.bankName} · ${account.accountName} — ****${tail}`;
}

// ─── The journal posting a payment will write ────────────────────────────────────

export interface PaymentPreviewLine {
  accountCode: string;
  accountName: string;
  debit: string | null;
  credit: string | null;
}

export interface PaymentPostPlan {
  lines: PaymentPreviewLine[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  payload: PostSupplierPaymentPayload;
}

export type PaymentPostPlanResult =
  | { ok: true; plan: PaymentPostPlan }
  | { ok: false; problems: Extract<Resolution, { ok: false }>[]; missingBank: boolean };

/**
 * The journal `POST /payments/:id/post` will write.
 *
 * `supplier-payment.service.ts:141-171` branches on the allocated/unallocated split:
 *
 *   Dr  Accounts Payable      allocatedAmount     ← only when > 0
 *   Dr  Supplier Advance      unallocatedAmount   ← only when > 0
 *     Cr  Bank                                    totalAmount
 *
 * A payment raised by this UI is always wholly unallocated (A16 — the create form cannot send
 * allocations), so in practice it writes two lines: Dr Supplier Advance / Cr Bank. The AP
 * branch is implemented anyway, because a payment created through another client, or after
 * #34 is fixed, will use it.
 *
 * **The bank GL comes from the chosen bank account, not from a subtype scan.** `BankAccount`
 * carries a `@unique` `glAccountId`, so the mapping is exact; `bankAccounts()` in
 * `posting-accounts.ts` would instead return every CASH_AND_BANK account in the chart and
 * could not tell which one this payment was drawn on.
 *
 * All three codes go in the payload even when a branch contributes no line — the DTO marks
 * each `@IsNotEmpty()` and the server resolves all three before it looks at the amounts.
 */
export function planPaymentPost(
  payment: SupplierPayment,
  accounts: readonly Account[],
  bankAccounts: readonly BankAccount[],
  locale: 'en' | 'ar',
): PaymentPostPlanResult {
  const { resolved, problems } = resolvePostingAccounts(accounts, [
    'AP_CONTROL',
    'SUPPLIER_ADVANCE',
  ]);

  const bank = bankAccounts.find((account) => account.id === payment.bankAccountId);
  const bankGl = bank ? accounts.find((account) => account.id === bank.glAccountId) : undefined;

  if (problems.length > 0 || !bankGl) {
    return { ok: false, problems, missingBank: !bankGl };
  }

  const ap = resolved.get('AP_CONTROL')!;
  const advance = resolved.get('SUPPLIER_ADVANCE')!;

  const totalMinor = toMinorUnits(payment.totalAmount, MONEY_SCALE);
  const allocatedMinor = toMinorUnits(payment.allocatedAmount, MONEY_SCALE);
  const unallocatedMinor = toMinorUnits(payment.unallocatedAmount, MONEY_SCALE);

  const lines: PaymentPreviewLine[] = [];

  if (allocatedMinor > 0) {
    lines.push({
      accountCode: ap.code,
      accountName: accountName(ap, locale),
      debit: fromMinorUnits(allocatedMinor, MONEY_SCALE),
      credit: null,
    });
  }

  if (unallocatedMinor > 0) {
    lines.push({
      accountCode: advance.code,
      accountName: accountName(advance, locale),
      debit: fromMinorUnits(unallocatedMinor, MONEY_SCALE),
      credit: null,
    });
  }

  lines.push({
    accountCode: bankGl.code,
    accountName: accountName(bankGl, locale),
    debit: null,
    credit: fromMinorUnits(totalMinor, MONEY_SCALE),
  });

  return {
    ok: true,
    plan: {
      lines,
      totalDebit: fromMinorUnits(allocatedMinor + unallocatedMinor, MONEY_SCALE),
      totalCredit: fromMinorUnits(totalMinor, MONEY_SCALE),
      // `allocated + unallocated = total` is set at creation and maintained by every
      // allocation. If it is ever false the payment row is inconsistent and the double-entry
      // validator would reject the journal anyway — better to refuse here and say why.
      balanced: allocatedMinor + unallocatedMinor === totalMinor,
      payload: {
        apAccountCode: ap.code,
        bankGlCode: bankGl.code,
        supplierAdvanceCode: advance.code,
      },
    },
  };
}
