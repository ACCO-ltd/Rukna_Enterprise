import { Decimal } from '@prisma/client/runtime/library';
import type { FinanceApprovalSettings } from '@erp/types';

/**
 * ADR-046 §8 — the optional finance approvals, as organisation settings. Pure rules: the defaults
 * an organisation has before anyone saves, what a save may hold, and the three questions the
 * commands ask ("does this invoice / bill / payment need an approval click?").
 */
export interface ApprovalSettings {
  invoiceApprovalAbove: Decimal | null;
  billApprovalAbove: Decimal | null;
  autoPostToleratedBills: boolean;
  paymentAutoApproveUpTo: Decimal;
  writeOffApprovalAbove: Decimal;
}

/** ADR-022's lowest payment band (Finance Officer authority, ≤ $1,000). */
export const DEFAULT_PAYMENT_AUTO_APPROVE_UP_TO = new Decimal(1000);

/** AR-4 — owner decision 2026-10-29: write-offs up to $50 post at once. */
export const DEFAULT_WRITE_OFF_APPROVAL_ABOVE = new Decimal(50);

export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  invoiceApprovalAbove: null,
  billApprovalAbove: null,
  autoPostToleratedBills: false,
  paymentAutoApproveUpTo: DEFAULT_PAYMENT_AUTO_APPROVE_UP_TO,
  writeOffApprovalAbove: DEFAULT_WRITE_OFF_APPROVAL_ABOVE,
};

const MAX_AMOUNT = new Decimal('999999999999.99');

/** Every problem with a proposed save, at once — empty when it may be saved. */
export function approvalSettingsProblems(input: FinanceApprovalSettings): string[] {
  const problems: string[] = [];
  const amount = (label: string, raw: string | null, allowNull: boolean) => {
    if (raw === null) {
      if (!allowNull) problems.push(`${label} is required.`);
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) {
      problems.push(`${label} must be an amount with at most two decimals.`);
      return;
    }
    if (new Decimal(raw).gt(MAX_AMOUNT)) problems.push(`${label} is too large.`);
  };
  amount('The invoice approval amount', input.invoiceApprovalAbove, true);
  amount('The bill approval amount', input.billApprovalAbove, true);
  amount('The payment auto-approval limit', input.paymentAutoApproveUpTo, false);
  if (input.writeOffApprovalAbove !== undefined) amount('The write-off approval amount', input.writeOffApprovalAbove, false);
  return problems;
}

export function toApprovalSettings(input: FinanceApprovalSettings, current?: ApprovalSettings): ApprovalSettings {
  return {
    writeOffApprovalAbove:
      input.writeOffApprovalAbove !== undefined
        ? new Decimal(input.writeOffApprovalAbove)
        : (current?.writeOffApprovalAbove ?? DEFAULT_WRITE_OFF_APPROVAL_ABOVE),
    invoiceApprovalAbove: input.invoiceApprovalAbove === null ? null : new Decimal(input.invoiceApprovalAbove),
    billApprovalAbove: input.billApprovalAbove === null ? null : new Decimal(input.billApprovalAbove),
    autoPostToleratedBills: input.autoPostToleratedBills,
    paymentAutoApproveUpTo: new Decimal(input.paymentAutoApproveUpTo),
  };
}

export function toApprovalSettingsDto(settings: ApprovalSettings): FinanceApprovalSettings {
  return {
    invoiceApprovalAbove: settings.invoiceApprovalAbove?.toFixed(2) ?? null,
    billApprovalAbove: settings.billApprovalAbove?.toFixed(2) ?? null,
    autoPostToleratedBills: settings.autoPostToleratedBills,
    paymentAutoApproveUpTo: settings.paymentAutoApproveUpTo.toFixed(2),
    writeOffApprovalAbove: settings.writeOffApprovalAbove.toFixed(2),
  };
}

/** AR-4 — does this write-off wait for a second person? Above the limit; a 0 limit sends every one. */
export function writeOffNeedsApproval(settings: ApprovalSettings, amount: Decimal): boolean {
  return amount.gt(settings.writeOffApprovalAbove);
}

/** §2 — does issuing this invoice need an Approve click first? */
export function invoiceNeedsApproval(settings: ApprovalSettings, total: Decimal): boolean {
  return settings.invoiceApprovalAbove !== null && total.gte(settings.invoiceApprovalAbove);
}

/**
 * §3 — may this bill post on Save, with no approval click? A PO bill only when its three-way match
 * is exact (or within tolerance, when the setting allows); a non-PO bill below the approval amount.
 */
export function billPostsOnSave(
  settings: ApprovalSettings,
  bill: { hasPurchaseOrder: boolean; matchStatus: string; total: Decimal },
): boolean {
  if (bill.hasPurchaseOrder) {
    return bill.matchStatus === 'MATCHED' || (settings.autoPostToleratedBills && bill.matchStatus === 'MATCHED_WITH_TOLERANCE');
  }
  return settings.billApprovalAbove === null || bill.total.lt(settings.billApprovalAbove);
}

/** §4 — is this payment approved on Save? Within the limit; a 0 limit approves nothing. */
export function paymentApprovedOnSave(settings: ApprovalSettings, total: Decimal): boolean {
  return settings.paymentAutoApproveUpTo.gt(0) && total.lte(settings.paymentAutoApproveUpTo);
}
