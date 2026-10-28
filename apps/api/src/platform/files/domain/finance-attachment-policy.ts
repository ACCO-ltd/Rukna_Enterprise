import { PERMISSIONS, type PermissionKey } from '@erp/types';

/**
 * Step 4 — who may see and change the evidence on a finance document, and when it freezes.
 *
 * Finance documents are org-level records: their controllers gate on one organization permission,
 * never project membership, so their evidence does the same. Each kind is changed by the
 * permission that runs its own workflow, and read by that permission or view:accounting — an
 * auditor reading the ledger must be able to open the scan behind a line.
 */
export const FINANCE_ATTACHMENT_KINDS = ['INVOICE', 'RECEIPT', 'BILL', 'PAYMENT', 'JOURNAL'] as const;
export type FinanceAttachmentKind = (typeof FINANCE_ATTACHMENT_KINDS)[number];

const MANAGE: Record<FinanceAttachmentKind, PermissionKey> = {
  INVOICE: PERMISSIONS.receivablesManage,
  RECEIPT: PERMISSIONS.receivablesManage,
  BILL: PERMISSIONS.payablesManage,
  PAYMENT: PERMISSIONS.payablesManage,
  JOURNAL: PERMISSIONS.journalsManage,
};

export function canChangeAttachments(permissions: readonly string[], kind: FinanceAttachmentKind): boolean {
  return permissions.includes(MANAGE[kind]);
}

export function canReadAttachments(permissions: readonly string[], kind: FinanceAttachmentKind): boolean {
  return canChangeAttachments(permissions, kind) || permissions.includes(PERMISSIONS.accountingView);
}

/**
 * A document is part of the books once it has posted — and stays so after a reversal, which is a
 * second entry, not an erasure. Its evidence then freezes: a file added afterwards is kept for good
 * as supplementary evidence (isPostSubmission), and nothing can be removed.
 */
export function isInTheBooks(status: string): boolean {
  return status === 'POSTED' || status === 'REVERSED';
}
