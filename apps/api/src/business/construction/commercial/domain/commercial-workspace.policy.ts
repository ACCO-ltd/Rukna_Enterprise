import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type CommercialClientStatementResponse,
  type CommercialInvoiceDocumentResponse,
  type CommercialInvoiceLifecycle,
  type CommercialTodoItem,
  type CommercialTodoKind,
  type CommercialWorkspaceCapabilities,
  type InstallmentReleasedBy,
} from '@erp/types';

/**
 * Commercial tab redesign (2026-09-28, docs/design/commercial-tab-implementation.md) — the pure rules
 * behind the workspace, invoice-document and statement read models. No Prisma, no Nest: every rule
 * here is decided once, server-side, and unit-tested on its own, so the browser never re-derives a
 * stage's release, an invoice's lifecycle, the To-do order, or who may press which button.
 */

const DAY_MS = 86_400_000;

/** Midnight UTC for a moment — so "days late" counts calendar days, not elapsed hours. */
export function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * THE overdue rule (D5 "one overdue rule"): whole UTC calendar days from the due date to the server's
 * today. Negative while not yet due, 0 on the due date. An invoice is overdue when this is > 0 and it
 * still carries a balance. The browser's clock never gets a vote.
 */
export function daysPastDue(dueDate: Date, asOf: Date): number {
  return Math.round((utcMidnight(asOf) - utcMidnight(dueDate)) / DAY_MS);
}

/** Overdue days for a posted invoice with a balance, else 0. */
export function overdueDays(
  inv: { posted: boolean; dueDate: Date | null; balance: Decimal },
  asOf: Date,
): number {
  if (!inv.posted || inv.dueDate === null || !inv.balance.gt(0)) return 0;
  return Math.max(0, daysPastDue(inv.dueDate, asOf));
}

const isoDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

export interface InstallmentReleaseFacts {
  triggerType: string;
  dueDate: Date | null;
  programmeMilestone?: {
    id: string;
    code: string;
    name: string;
    status: string;
    baselineDate?: Date | null;
    forecastDate?: Date | null;
    actualDate?: Date | null;
    verifiedAt?: Date | null;
  } | null;
}

/**
 * What releases a stage for billing (D5). A MILESTONE stage's `verifiedAt` is
 * `ProgrammeMilestone.verifiedAt` — the timestamp the verify command stamps (with `verifiedBy`) —
 * falling back to the milestone's `actualDate` for a row verified before that column was written.
 * Null while the milestone is not VERIFIED.
 */
export function deriveReleasedBy(inst: InstallmentReleaseFacts): InstallmentReleasedBy {
  if (inst.triggerType === 'ADVANCE') return { kind: 'ADVANCE' };
  if (inst.triggerType === 'MILESTONE') {
    const pm = inst.programmeMilestone ?? null;
    const verified = pm?.status === 'VERIFIED';
    return {
      kind: 'MILESTONE',
      milestoneId: pm?.id ?? null,
      milestoneCode: pm?.code ?? null,
      milestoneName: pm?.name ?? null,
      verifiedAt: verified ? ((pm?.verifiedAt ?? pm?.actualDate)?.toISOString() ?? null) : null,
    };
  }
  return { kind: 'DATE', date: isoDate(inst.dueDate) };
}

/**
 * D4 — when the stage is expected to bill. MILESTONE → the linked milestone's forecast, else its
 * baseline; TIME_BASED → the stage's due date; ADVANCE → none (billable while the contract is active).
 */
export function deriveExpectedDate(inst: InstallmentReleaseFacts): string | null {
  if (inst.triggerType === 'ADVANCE') return null;
  if (inst.triggerType === 'MILESTONE') {
    const pm = inst.programmeMilestone ?? null;
    return isoDate(pm?.forecastDate ?? pm?.baselineDate ?? null);
  }
  return isoDate(inst.dueDate);
}

/** Posting states in which an invoice has not reached the ledger (a draft, whatever its approval). */
const UNPOSTED = new Set(['NOT_POSTED', 'PENDING', 'FAILED']);

export function isUnposted(postingStatus: string): boolean {
  return UNPOSTED.has(postingStatus);
}

/** A stage's invoice as the schedule shows it: DRAFT until posted, ISSUED after; cancelled = none. */
export function deriveInvoiceState(
  inv: { documentStatus: string; postingStatus: string } | null | undefined,
): 'DRAFT' | 'ISSUED' | null {
  if (!inv || inv.documentStatus === 'CANCELLED') return null;
  return isUnposted(inv.postingStatus) ? 'DRAFT' : 'ISSUED';
}

/**
 * The bar's short contract reference: the suffix after the project code ("ACC-HDN-26-0005-C1" under
 * project "ACC-HDN-26-0005" → "C1"). Falls back to a trailing "C<n>" segment, then the full number.
 */
export function shortContractRef(contractNumber: string, projectCode: string | null): string {
  if (projectCode && contractNumber.startsWith(`${projectCode}-`)) {
    const rest = contractNumber.slice(projectCode.length + 1);
    if (rest.length > 0) return rest;
  }
  const last = contractNumber.split('-').at(-1) ?? '';
  return /^C\d+$/i.test(last) ? last : contractNumber;
}

/**
 * `Contract.paymentTerms` is free text ("30 days", "Net 45"). The first whole number in it is the
 * term in days; no number → null (never a guessed default).
 */
export function parsePaymentTermsDays(paymentTerms: string | null | undefined): number | null {
  if (!paymentTerms) return null;
  const match = /(\d+)/.exec(paymentTerms);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/** Whole days between an invoice date and its due date — the terms the invoice was actually raised on. */
export function termsDaysBetween(invoiceDate: Date | null, dueDate: Date | null): number | null {
  if (!invoiceDate || !dueDate) return null;
  return Math.round((utcMidnight(dueDate) - utcMidnight(invoiceDate)) / DAY_MS);
}

/**
 * Prepare-package dates: invoice date defaults to the server's UTC today; the due date defaults to the
 * invoice date + the terms (the request's days, else the number in the contract's payment terms,
 * else 0 — due on receipt). Returns null for `error` when the pair is valid.
 */
export function resolveInvoiceDates(
  input: { invoiceDate?: string; dueDate?: string; paymentTermsDays?: number },
  contractPaymentTerms: string | null | undefined,
  today: Date,
): { invoiceDate: string; dueDate: string; termsDays: number | null; error: string | null } {
  const invoiceDate = input.invoiceDate?.slice(0, 10) ?? today.toISOString().slice(0, 10);
  const termsDays = input.paymentTermsDays ?? parsePaymentTermsDays(contractPaymentTerms);
  const dueDate =
    input.dueDate?.slice(0, 10) ??
    new Date(Date.parse(`${invoiceDate}T00:00:00Z`) + (termsDays ?? 0) * DAY_MS)
      .toISOString()
      .slice(0, 10);
  const error = dueDate < invoiceDate ? 'The due date cannot be before the invoice date.' : null;
  return { invoiceDate, dueDate, termsDays, error };
}

/**
 * Owner decision (2026-09-28): an invoice is dated the day it is issued. A draft prepared earlier and
 * issued later moves to the issue day, and its due date moves by the same number of days so the
 * client keeps the payment terms it was prepared with. It then posts on the issue day (the posting
 * uses the invoice's own date) instead of landing in a past — possibly closed — period.
 * Returns null when the draft is already dated today or later (nothing to change).
 */
export function redateForIssue(
  invoiceDate: Date,
  dueDate: Date | null,
  today: Date,
): { invoiceDate: Date; dueDate: Date | null } | null {
  const day = (d: Date) => Date.parse(d.toISOString().slice(0, 10) + 'T00:00:00Z');
  const shift = day(today) - day(invoiceDate);
  if (shift <= 0) return null;
  return {
    invoiceDate: new Date(day(today)),
    dueDate: dueDate ? new Date(day(dueDate) + shift) : null,
  };
}

// ─── To do ranking ───────────────────────────────────────────────────────────────

const KIND_ORDER: Record<CommercialTodoKind, number> = {
  OVERDUE_INVOICE: 0,
  READY_TO_INVOICE: 1,
  DRAFT_INVOICE: 2,
  ISSUED_NOT_SENT: 3,
  BLOCKED_STAGE: 4,
};

/**
 * Spec §2 order: OVERDUE_INVOICE (most days overdue first) → READY_TO_INVOICE (stage order) →
 * DRAFT_INVOICE (oldest first) → ISSUED_NOT_SENT (earliest due first) → BLOCKED_STAGE. The builder
 * contributes at most one BLOCKED_STAGE (the first un-invoiced blocked stage); this also enforces it.
 * Stable: ties keep their input order.
 */
export function rankTodo(items: CommercialTodoItem[]): CommercialTodoItem[] {
  let blockedSeen = false;
  const kept = items.filter((item) => {
    if (item.kind !== 'BLOCKED_STAGE') return true;
    if (blockedSeen) return false;
    blockedSeen = true;
    return true;
  });
  const within = (a: CommercialTodoItem, b: CommercialTodoItem): number => {
    switch (a.kind) {
      case 'OVERDUE_INVOICE':
        return (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0);
      case 'READY_TO_INVOICE':
      case 'BLOCKED_STAGE':
        return (a.stageNumber ?? Number.MAX_SAFE_INTEGER) - (b.stageNumber ?? Number.MAX_SAFE_INTEGER);
      case 'DRAFT_INVOICE':
        return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
      case 'ISSUED_NOT_SENT':
        return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    }
  };
  return kept
    .map((item, index) => ({ item, index }))
    .sort(
      (x, y) =>
        KIND_ORDER[x.item.kind] - KIND_ORDER[y.item.kind] ||
        within(x.item, y.item) ||
        x.index - y.index,
    )
    .map(({ item }) => item);
}

// ─── Capabilities ────────────────────────────────────────────────────────────────

const TERMINAL = new Set(['CLOSED', 'TERMINATED', 'CANCELLED']);

/**
 * The workspace's affordances — each mirrors the guard of the command it offers, so the page never
 * shows a control the server refuses:
 * - canBill: `view:contract` + `manage:receivable` (prepare-package / issue / send routes).
 * - canRecordPayment: the same pair (the `POST …/commercial/billing/payment` route's guard) AND an
 *   ACTIVE contract (the command refuses without one).
 * - canExportStatement: a statement is money, so it needs financial visibility.
 */
export function workspaceCapabilities(
  permissions: readonly string[],
  contract: { status: string; billingModel: string } | null,
  canViewMargin: boolean,
): CommercialWorkspaceCapabilities {
  const has = (p: string) => permissions.includes(p);
  const status = contract?.status ?? null;
  const live = status !== null && !TERMINAL.has(status);
  const canBill = has(PERMISSIONS.contractsView) && has(PERMISSIONS.receivablesManage);
  return {
    canRecordContract:
      contract === null && has(PERMISSIONS.contractsCreate) && has(PERMISSIONS.contractsApprove),
    canReopenContract: has(PERMISSIONS.contractsApprove) && status === 'ACTIVE',
    canBill,
    canRecordPayment: canBill && status === 'ACTIVE',
    canRecordSignedDate: has(PERMISSIONS.contractsManage) && live,
    canReprofileSchedule:
      has(PERMISSIONS.contractsManage) && live && contract?.billingModel === 'MILESTONE',
    canExportStatement: contract !== null && canViewMargin,
  };
}

/**
 * An invoice as the client experiences it: DRAFT (not posted) → ISSUED (posted, never sent) → SENT
 * (≥1 delivery) → PAID (settled). CANCELLED for a cancelled draft or a reversed invoice (both are no
 * longer a claim on the client).
 */
export function invoiceLifecycle(inv: {
  documentStatus: string;
  postingStatus: string;
  balance: Decimal;
  deliveryCount: number;
}): CommercialInvoiceLifecycle {
  if (inv.documentStatus === 'CANCELLED' || inv.postingStatus === 'REVERSED') return 'CANCELLED';
  if (isUnposted(inv.postingStatus)) return 'DRAFT';
  if (inv.balance.lte(0)) return 'PAID';
  return inv.deliveryCount > 0 ? 'SENT' : 'ISSUED';
}

export function invoiceDocumentCapabilities(
  permissions: readonly string[],
  lifecycle: CommercialInvoiceLifecycle,
  balance: Decimal,
  /** The project has an ACTIVE contract — `recordProjectPayment` refuses otherwise (e.g. after a reopen). */
  contractActive: boolean,
): CommercialInvoiceDocumentResponse['capabilities'] {
  const has = (p: string) => permissions.includes(p);
  const canBill = has(PERMISSIONS.contractsView) && has(PERMISSIONS.receivablesManage);
  const draft = lifecycle === 'DRAFT';
  const posted = lifecycle === 'ISSUED' || lifecycle === 'SENT' || lifecycle === 'PAID';
  return {
    canIssue: draft && canBill,
    canSend: posted && canBill,
    canRecordPayment: posted && balance.gt(0) && canBill && contractActive,
    canEditDraft: draft && canBill,
    canDeleteDraft: draft && canBill,
    canIssueCreditNote: posted && has(PERMISSIONS.receivablesManage),
    canDownloadPdf: true,
  };
}

/** "Sales tax 5%" from the invoice's own amounts (the rate it was actually raised at); null when untaxed. */
export function taxLabelFor(subtotal: Decimal, tax: Decimal): string | null {
  if (subtotal.isZero() || tax.isZero()) return null;
  const pct = tax.div(subtotal).mul(100).toDecimalPlaces(2);
  return `Sales tax ${pct.toString()}%`;
}

// ─── Client statement ────────────────────────────────────────────────────────────

export interface StatementEntry {
  date: Date;
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'RECEIPT';
  reference: string | null;
  description: string;
  /** Positive magnitude; INVOICE debits, CREDIT_NOTE / RECEIPT credit. */
  amount: Decimal;
  /** Tie-breaker within a day (creation order). */
  sequence: number;
}

const STATEMENT_KIND_ORDER = { INVOICE: 0, CREDIT_NOTE: 1, RECEIPT: 2 } as const;

/**
 * Oldest first; on the same day an invoice precedes the credit/receipt against it. Running balance =
 * Σ debits − Σ credits. Money null without financial visibility (rows and dates stay: the fact that a
 * document exists is not the secret, its value is).
 */
export function buildStatementLines(
  entries: StatementEntry[],
  canViewMoney: boolean,
): Pick<CommercialClientStatementResponse, 'lines' | 'closingBalance'> {
  const sorted = [...entries].sort(
    (a, b) =>
      utcMidnight(a.date) - utcMidnight(b.date) ||
      STATEMENT_KIND_ORDER[a.kind] - STATEMENT_KIND_ORDER[b.kind] ||
      a.sequence - b.sequence,
  );
  let balance = new Decimal(0);
  const money = (d: Decimal | null) => (canViewMoney && d !== null ? d.toFixed(2) : null);
  const lines = sorted.map((e) => {
    const debit = e.kind === 'INVOICE' ? e.amount : null;
    const credit = e.kind === 'INVOICE' ? null : e.amount;
    balance = debit ? balance.plus(debit) : balance.minus(credit!);
    return {
      date: e.date.toISOString().slice(0, 10),
      kind: e.kind,
      reference: e.reference,
      description: e.description,
      debit: money(debit),
      credit: money(credit),
      balance: money(balance),
    };
  });
  return { lines, closingBalance: money(balance) };
}
