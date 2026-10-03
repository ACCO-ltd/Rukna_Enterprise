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
 * THE paid rule for a stage's invoice (0..1): the share of a POSTED invoice already collected,
 * from its stored `outstandingAmount`. A non-posted or zero-total invoice reads 0. The schedule's
 * PAID / PARTIALLY_PAID status and `stageCollectionStatus` both use this one definition.
 */
export function invoiceCollectedFraction(inv: {
  postingStatus: string;
  totalAmount: Decimal | { toString(): string };
  outstandingAmount: Decimal | { toString(): string };
}): Decimal {
  if (inv.postingStatus !== 'POSTED') return new Decimal(0);
  const total = new Decimal(inv.totalAmount.toString());
  if (total.lte(0)) return new Decimal(0);
  return total.minus(new Decimal(inv.outstandingAmount.toString())).div(total);
}

/**
 * ADR-043 Phase 3 — a payment-schedule stage's billing / collection status with NO amounts, so
 * project roles (who may not see money) still see "billed", "paid" or "overdue". One definition,
 * built only from existing rules:
 *
 *  - the invoice state is `deriveInvoiceState` (ISSUED = posted, reversed or opening balance);
 *  - paid / part paid are `invoiceCollectedFraction` — the schedule's own PAID / PARTIALLY_PAID
 *    rule, the same function, so the two never disagree (a zero-total invoice reads Billed);
 *  - overdue is THE overdue rule (`overdueDays`, D5: whole UTC days past due on the server clock,
 *    posted, with a balance) and wins over part paid;
 *  - before an invoice is issued: NOT_READY while the raise blocker (`installmentBillingBlocker`)
 *    stands or a date stage's date has not come; VERIFIED once nothing blocks raising it but
 *    Construction has not marked it; READY_TO_BILL only once it is marked (`readyToBillAt`,
 *    ADR-043 decision 1) or Finance has a draft invoice for it. This matches Finance's *To bill*
 *    queue, which counts marked stages. (Finance may still prepare an unmarked VERIFIED stage —
 *    preparing records readiness itself, D2 — so the label is not a gate.)
 */
export function stageCollectionStatus(
  stage: StageCollectionFacts,
  invoice: StageCollectionInvoice | null | undefined,
  asOf: Date,
): StageCollectionStatus {
  const state = deriveInvoiceState(invoice);
  if (state === 'ISSUED' && invoice) {
    const posted = invoice.postingStatus === 'POSTED';
    if (!posted) return 'BILLED';
    const collected = invoiceCollectedFraction(invoice);
    if (collected.gte(1)) return 'PAID';
    const balance = new Decimal(invoice.outstandingAmount.toString());
    if (overdueDays({ posted, dueDate: invoice.dueDate, balance }, asOf) > 0) return 'OVERDUE';
    return collected.gt(0) ? 'PART_PAID' : 'BILLED';
  }
  if (state === 'DRAFT') return 'READY_TO_BILL';

  if (installmentBillingBlocker(stage) !== null) return 'NOT_READY';
  if (stage.readyToBillAt) return 'READY_TO_BILL';
  const beforeDate =
    stage.triggerType === 'TIME_BASED' && stage.dueDate !== null && daysPastDue(stage.dueDate, asOf) < 0;
  return beforeDate ? 'NOT_READY' : 'VERIFIED';
}
