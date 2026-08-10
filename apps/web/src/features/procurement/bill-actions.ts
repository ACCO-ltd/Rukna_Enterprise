import { accountName, currentVersion } from '@/features/accounting/account-display';
import { resolvePostingAccount, type Resolution } from '@/features/accounting/posting-accounts';
import type { Account, PostingProfile } from '@/features/accounting/types';
import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

import { canPostBill } from './quantities';
import type { SupplierBill, PostSupplierBillPayload } from './types';

/**
 * ─── What a supplier bill will let you do ───────────────────────────────────────
 *
 * Same role as `invoice-actions.ts` on the AR side: the server is the authority, and this
 * exists so the UI offers only actions that will succeed. Each rule names the guard it mirrors.
 *
 * The lifecycle is one step longer than an invoice's — a bill is submitted before it is
 * approved, where an invoice goes straight to approval:
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──post──▶ (POSTED) ──reverse──▶ (REVERSED)
 *
 * The parenthesised states are `postingStatus`; the rest are `documentStatus`. The two axes
 * advance independently, which is why no single field drives this.
 *
 * ─── This module lives in procurement, and imports from accounting ──────────────
 *
 * A supplier bill is an accounts-payable document — its controller is in
 * `business/accounting/accounts-payable/` — but the frontend hosts its screens here, because
 * §12.8's Matching tab is a procurement concern that has to hang off the bill detail page.
 *
 * So the dependency runs procurement → accounting and never back, mirroring
 * ARCH-BOUNDARY-001's one-way rule on the server. Nothing in `features/accounting` imports
 * from here.
 */

// ─── Lifecycle ───────────────────────────────────────────────────────────────────

export type BillAction = 'submit' | 'approve' | 'post' | 'reverse';

export type BillBlockReason =
  | 'not-draft'
  | 'not-submitted'
  | 'not-approved'
  | 'already-posted'
  | 'not-posted'
  | 'already-reversed'
  | 'unmatched';

/** `supplier-bill.service.ts:116` — submit requires DRAFT. */
export function canSubmit(bill: SupplierBill): boolean {
  return bill.documentStatus === 'DRAFT';
}

/** `supplier-bill.service.ts:124` — approve requires SUBMITTED. */
export function canApprove(bill: SupplierBill): boolean {
  return bill.documentStatus === 'SUBMITTED';
}

/**
 * Posting statuses from which posting is safe.
 *
 * The same allowlist `canPost` uses for invoices, and for the same reason: NOT_POSTED is a
 * first attempt and FAILED is a retry, while PENDING means one is already in flight. REVERSED
 * and OPENING_BALANCE are excluded — see the note on `canPost` below.
 */
const POSTABLE_STATUSES: readonly SupplierBill['postingStatus'][] = ['NOT_POSTED', 'FAILED'];

/**
 * `supplier-bill.service.ts:140,143,150`.
 *
 * Three conditions, and the third is the match gate. `canPostBill` is stricter than the
 * server's `POSTABLE_MATCH_STATUSES` (P15) and is left that way deliberately.
 *
 * ⚠ **This is also stricter than the server on `postingStatus`, in the same way `canPost` is
 * for invoices (A11).** The server rejects only `POSTED`, so a REVERSED bill passes its guard
 * and can be posted a second time. Do not relax either check to match the server.
 *
 * Note what the match gate cannot protect: a bill created through the API never records a
 * `purchaseOrderRevisionId` (A14 / #33), so `hasPurchaseOrderLink` is false for every bill the
 * UI can create and the gate never engages. That is the reason Tier B creates non-PO bills
 * only — for those, "no matching required" is correct rather than merely unenforced.
 */
export function canPost(bill: SupplierBill): boolean {
  return (
    bill.documentStatus === 'APPROVED' &&
    POSTABLE_STATUSES.includes(bill.postingStatus) &&
    canPostBill(bill.matchStatus, bill.purchaseOrderRevisionId !== null)
  );
}

/**
 * `supplier-bill.service.ts:317` — reversal is refused while any allocation against this bill
 * is POSTED.
 *
 * Allocations are not on the bill payload, so this cannot be pre-empted any more than the
 * equivalent guard on invoices can. Reverse stays offered and the 400 is surfaced as a message.
 * Revisit when Tier D lands, which is what will start creating those allocations.
 */
export function canReverse(bill: SupplierBill): boolean {
  return bill.postingStatus === 'POSTED';
}

export function availableBillActions(bill: SupplierBill): BillAction[] {
  const actions: BillAction[] = [];
  if (canSubmit(bill)) actions.push('submit');
  if (canApprove(bill)) actions.push('approve');
  if (canPost(bill)) actions.push('post');
  if (canReverse(bill)) actions.push('reverse');
  return actions;
}

/** Why `action` is unavailable, or `null` when it is available. Drives the disabled tooltip. */
export function billBlockReason(
  bill: SupplierBill,
  action: BillAction,
): BillBlockReason | null {
  switch (action) {
    case 'submit':
      return canSubmit(bill) ? null : 'not-draft';

    case 'approve':
      return canApprove(bill) ? null : 'not-submitted';

    case 'post': {
      if (canPost(bill)) return null;
      if (bill.postingStatus === 'POSTED') return 'already-posted';
      if (bill.postingStatus === 'REVERSED') return 'already-reversed';
      if (
        bill.documentStatus === 'APPROVED' &&
        !canPostBill(bill.matchStatus, bill.purchaseOrderRevisionId !== null)
      ) {
        return 'unmatched';
      }
      return 'not-approved';
    }

    case 'reverse':
      if (canReverse(bill)) return null;
      return bill.postingStatus === 'REVERSED' ? 'already-reversed' : 'not-posted';
  }
}

// ─── Expense posting profiles ────────────────────────────────────────────────────

/**
 * The account classes a bill line may post its expense to.
 *
 * A supplier bill debits cost. COST_OF_SALES covers direct project cost — the seeded
 * `MATERIAL_PURCHASE` and `SUBCONTRACT_COST` both point at 50303 — and EXPENSE covers overhead
 * like `OFFICE_EXPENSE` at 60100.
 */
const EXPENSE_CLASSES = ['EXPENSE', 'COST_OF_SALES'] as const;

export interface ExpenseProfile {
  code: string;
  /** The version name, e.g. "Material Purchase (COGS)" — what the user actually reads. */
  name: string;
  /** The GL account the server will debit. Shown so the choice is not opaque. */
  account: Account;
}

/**
 * The posting profiles that may legally appear on a supplier bill line.
 *
 * **This filter is not cosmetic.** `GET /posting-profiles` returns every profile in the
 * organisation, and the seed creates four — one of which, `PROJECT_REVENUE`, resolves to
 * account 42600, an INCOME account. Offering it on a bill line would let a user credit-side
 * an account by debiting it: the journal still balances, the trial balance still ties, and
 * revenue is understated by the amount of the bill with nothing in any report to show it.
 *
 * The response cannot answer this on its own — it embeds `versions` but not the account behind
 * `accountId` — so the profiles are joined against the chart of accounts here.
 *
 * A profile is dropped, rather than shown disabled, when:
 *   - it is INACTIVE
 *   - it has no versions (possible: `versions` is a relation, not a required field)
 *   - its account is not in the chart, or is not ACTIVE
 *   - its account's class is not an expense class
 *
 * Dropped silently on purpose: "PROJECT_REVENUE — not selectable" invites the question of how
 * to select it, and the answer is that it is never right on this form.
 */
export function expenseProfiles(
  profiles: readonly PostingProfile[],
  accounts: readonly Account[],
): ExpenseProfile[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));

  const usable: ExpenseProfile[] = [];

  for (const profile of profiles) {
    if (profile.status !== 'ACTIVE') continue;

    // `take: 1` ordered by effectiveFrom desc, so index 0 is the newest version.
    const version = profile.versions[0];
    if (!version) continue;

    const account = byId.get(version.accountId);
    if (!account || account.status !== 'ACTIVE') continue;

    const accountClass = currentVersion(account)?.accountClass;
    if (!accountClass || !EXPENSE_CLASSES.includes(accountClass as never)) continue;

    usable.push({ code: profile.code, name: version.name, account });
  }

  return usable.sort((a, b) => a.code.localeCompare(b.code));
}

// ─── The journal posting a bill will write ───────────────────────────────────────

export interface BillPreviewLine {
  accountCode: string;
  accountName: string;
  debit: string | null;
  credit: string | null;
}

export interface BillPostPlan {
  lines: BillPreviewLine[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  payload: PostSupplierBillPayload;
}

export type BillPostPlanResult =
  | { ok: true; plan: BillPostPlan }
  | { ok: false; problem: Extract<Resolution, { ok: false }> };

/**
 * The journal `POST /bills/:id/post` will write, and the payload that asks for it.
 *
 * `supplier-bill.service.ts` builds one debit per line plus a single credit:
 *
 *   Dr  Expense (per line, from the line's posting profile)   grossAmount
 *     Cr  Accounts Payable                                                totalAmount
 *
 * Note it is **grossAmount**, not net: ACCO's VAT policy is non-recoverable, so the tax goes
 * to expense with the cost rather than to a recoverable VAT asset. A preview that showed net
 * would understate every line by its VAT.
 *
 * Preview and payload are returned together from one resolution, for the same reason
 * `planInvoicePost` does it: a preview computed separately from the request is a preview that
 * can lie about what is being sent.
 *
 * Only `apAccountCode` is in the payload. The expense accounts are resolved server-side from
 * each line's `expenseProfileCode`, which is why they are looked up here purely to be shown.
 *
 * Arithmetic is in integer minor units — summing decimal strings as floats is how a preview
 * ends up a cent away from the bill it describes.
 */
export function planBillPost(
  bill: SupplierBill,
  accounts: readonly Account[],
  profiles: readonly PostingProfile[],
  locale: 'en' | 'ar',
): BillPostPlanResult {
  const ap = resolvePostingAccount(accounts, 'AP_CONTROL');
  if (!ap.ok) return { ok: false, problem: ap };

  const expenseByCode = new Map(
    expenseProfiles(profiles, accounts).map((profile) => [profile.code, profile]),
  );

  const lines: BillPreviewLine[] = [];
  let debitMinor = 0;

  for (const line of bill.lines ?? []) {
    const profile = expenseByCode.get(line.expenseProfileCode);
    const gross = toMinorUnits(line.grossAmount, MONEY_SCALE);
    debitMinor += gross;

    lines.push({
      // A line naming a profile that no longer resolves still has to render. The server will
      // reject the post; showing the code beats showing an empty row and no explanation.
      accountCode: profile?.account.code ?? line.expenseProfileCode,
      accountName: profile ? accountName(profile.account, locale) : line.expenseProfileCode,
      debit: fromMinorUnits(gross, MONEY_SCALE),
      credit: null,
    });
  }

  const creditMinor = toMinorUnits(bill.totalAmount, MONEY_SCALE);

  lines.push({
    accountCode: ap.account.code,
    accountName: accountName(ap.account, locale),
    debit: null,
    credit: fromMinorUnits(creditMinor, MONEY_SCALE),
  });

  return {
    ok: true,
    plan: {
      lines,
      totalDebit: fromMinorUnits(debitMinor, MONEY_SCALE),
      totalCredit: fromMinorUnits(creditMinor, MONEY_SCALE),
      // ∑ line gross = totalAmount is enforced at creation, so a mismatch means the bill row
      // is itself inconsistent. Surfaced rather than assumed: posting a journal the engine
      // will reject is worse than refusing here.
      balanced: debitMinor === creditMinor,
      payload: { apAccountCode: ap.account.code },
    },
  };
}
