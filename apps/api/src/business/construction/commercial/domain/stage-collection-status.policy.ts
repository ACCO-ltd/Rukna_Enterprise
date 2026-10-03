import { Decimal } from '@prisma/client/runtime/library';
import type { StageCollectionStatus } from '@erp/types';

import {
  installmentBillingBlocker,
  type InstallmentBillingFacts,
} from '../../../accounting/accounts-receivable/domain/installment-billing-eligibility.js';
import { daysPastDue, deriveInvoiceState, overdueDays } from './commercial-workspace.policy.js';

/** The stage facts the status reads — the same facts the raise blocker and the schedule read. */
export interface StageCollectionFacts extends InstallmentBillingFacts {
  /** Set when the stage was marked ready to bill (Slice 3B). */
  readyToBillAt: Date | null;
  /** A TIME_BASED stage bills on this date. */
  dueDate: Date | null;
}

/** The stage's live invoice (a cancelled one reads as none, as everywhere else). */
export interface StageCollectionInvoice {
  documentStatus: string;
  postingStatus: string;
  totalAmount: Decimal | { toString(): string };
  outstandingAmount: Decimal | { toString(): string };
  dueDate: Date | null;
}

/**
 * ADR-043 Phase 3 — a payment-schedule stage's billing / collection status with NO amounts, so
 * project roles (who may not see money) still see "billed", "paid" or "overdue". One definition,
 * built only from existing rules:
 *
 *  - the invoice state is `deriveInvoiceState` (ISSUED = posted, reversed or opening balance);
 *  - paid / part paid read the posted invoice's stored `outstandingAmount` — the schedule's own
 *    PAID / PARTIALLY_PAID rule (`collectedFraction`), so the two never disagree;
 *  - overdue is THE overdue rule (`overdueDays`, D5: whole UTC days past due on the server clock,
 *    posted, with a balance) and wins over part paid;
 *  - before an invoice is issued, "ready" is the raise blocker (`installmentBillingBlocker`) being
 *    clear — the gate the prepare command enforces — plus a date stage's date having come; a stage
 *    marked ready, or with a draft Finance is preparing, is ready to bill.
 */
export function stageCollectionStatus(
  stage: StageCollectionFacts,
  invoice: StageCollectionInvoice | null | undefined,
  asOf: Date,
): StageCollectionStatus {
  const state = deriveInvoiceState(invoice);
  if (state === 'ISSUED' && invoice) {
    const posted = invoice.postingStatus === 'POSTED';
    const total = new Decimal(invoice.totalAmount.toString());
    const balance = new Decimal(invoice.outstandingAmount.toString());
    if (!posted) return 'BILLED';
    if (balance.lte(0)) return 'PAID';
    if (overdueDays({ posted, dueDate: invoice.dueDate, balance }, asOf) > 0) return 'OVERDUE';
    return balance.lt(total) ? 'PART_PAID' : 'BILLED';
  }
  if (state === 'DRAFT') return 'READY_TO_BILL';

  if (installmentBillingBlocker(stage) !== null) return 'NOT_READY';
  if (stage.readyToBillAt) return 'READY_TO_BILL';
  const beforeDate =
    stage.triggerType === 'TIME_BASED' && stage.dueDate !== null && daysPastDue(stage.dueDate, asOf) < 0;
  return beforeDate ? 'NOT_READY' : 'READY_TO_BILL';
}
