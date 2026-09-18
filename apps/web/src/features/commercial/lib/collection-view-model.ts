import type { CommercialInvoiceRow, CommercialReceiptRow } from '@erp/types';

export type CollectionPaymentState =
  | 'AWAITING_PAYMENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'DRAFT'
  | 'CANCELLED';

/** Overlay for approaching/past-due invoices. Null when PAID, CANCELLED, DRAFT, or no due date. */
export type InvoiceDueStatus = 'CURRENT' | 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE';

/** Overdue aging bucket. Null when the invoice is not overdue. */
export type AgingBucket = 'DAYS_1_7' | 'DAYS_8_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_90_PLUS';

export interface ClientReceivableView {
  invoiceId: string;
  invoiceNumber: string | null;
  sourceLabel: string;
  issuedAt: string;
  /** ISO timestamp of the first delivery event, or null if never sent to client. */
  sentAt: string | null;
  dueDate: string | null;
  total: string | null;
  paid: string | null;
  outstanding: string | null;
  paymentState: CollectionPaymentState;
  overdueDays: number;
  canRecordPayment: boolean;
  /** Due status overlay — null for closed/DRAFT invoices or when no due date is set. */
  dueStatus: InvoiceDueStatus | null;
  /** Aging bucket — non-null only when the invoice is OVERDUE. */
  agingBucket: AgingBucket | null;
}

export interface ClientPaymentView {
  receiptId: string;
  receivedAt: string;
  total: string | null;
  allocated: string | null;
  unallocated: string | null;
  method: string | null;
  reference: string | null;
  allocations: {
    invoiceId: string;
    invoiceNumber: string | null;
    amount: string | null;
  }[];
}

export interface AllocationLine {
  invoiceId: string;
  invoiceNumber: string | null;
  /** Suggested allocation amount — decimal string. */
  suggested: string;
  /** Maximum allocatable — equals the invoice's outstanding amount. Hard cap. */
  max: string;
}

// ─── Due-status & aging derivations ──────────────────────────────────────────

function addDaysToDate(date: string, days: number): string {
  const ms = Date.parse(date + 'T00:00:00Z') + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Derive the approaching/past-due overlay status from the invoice due date.
 *
 * - Returns null for closed invoices (PAID, CANCELLED, DRAFT) or when no due date is set.
 * - DUE_TODAY: dueDate equals today.
 * - DUE_SOON: dueDate is 1–7 days from today (exclusive).
 * - OVERDUE: dueDate is past today and the invoice has a non-zero outstanding balance.
 * - CURRENT: due date is set and more than 7 days away.
 */
export function deriveDueStatus(
  dueDate: string | null,
  outstanding: string | null,
  today: string,
): InvoiceDueStatus | null {
  if (!dueDate) return null;
  if (dueDate === today) return 'DUE_TODAY';

  const hasBalance = outstanding !== null && parseFloat(outstanding) > 0;
  if (dueDate < today && hasBalance) return 'OVERDUE';
  if (dueDate < today) return 'CURRENT'; // paid/zero — don't flag as overdue

  // Future due date — check 7-day window
  const sevenDaysOut = addDaysToDate(today, 7);
  if (dueDate <= sevenDaysOut) return 'DUE_SOON';
  return 'CURRENT';
}

/**
 * Map server-reported `daysOverdue` (whole UTC days, authoritative) to a display aging bucket.
 * Returns null when the invoice is not overdue (daysOverdue ≤ 0).
 */
export function deriveAgingBucket(daysOverdue: number): AgingBucket | null {
  if (daysOverdue <= 0) return null;
  if (daysOverdue <= 7) return 'DAYS_1_7';
  if (daysOverdue <= 30) return 'DAYS_8_30';
  if (daysOverdue <= 60) return 'DAYS_31_60';
  if (daysOverdue <= 90) return 'DAYS_61_90';
  return 'DAYS_90_PLUS';
}

/**
 * Derive the user-facing payment state from server fields.
 *
 * Evaluated in priority order so each state is unambiguous. DRAFT and AWAITING_POSTING are
 * both mapped to DRAFT because neither represents a live receivable the user can collect
 * against. OVERDUE is an overlay: a partially-paid or unpaid invoice past its due date reads
 * as OVERDUE, which carries more urgency than AWAITING_PAYMENT or PARTIALLY_PAID alone.
 */
export function derivePaymentState(
  row: CommercialInvoiceRow,
  today: string,
): CollectionPaymentState {
  if (row.status === 'DRAFT' || row.status === 'AWAITING_POSTING') return 'DRAFT';
  if (row.status === 'CANCELLED') return 'CANCELLED';
  if (row.status === 'PAID') return 'PAID';

  // Overdue: has an outstanding balance AND a due date that has already passed.
  // dueDate comparison is safe as an ISO date string lexicographic sort (YYYY-MM-DD).
  if (
    row.outstandingAmount !== null &&
    parseFloat(row.outstandingAmount) > 0 &&
    row.dueDate !== null &&
    row.dueDate < today
  ) {
    return 'OVERDUE';
  }

  if (row.status === 'PARTIALLY_PAID') return 'PARTIALLY_PAID';
  return 'AWAITING_PAYMENT';
}

function deriveSourceLabel(row: CommercialInvoiceRow): string {
  if (row.source.label) return row.source.label;
  switch (row.source.kind) {
    case 'INSTALLMENT':
      return 'Milestone invoice';
    case 'IPC':
      return 'IPC invoice';
    case 'SEPARATE_CHARGE':
      return 'Extra charge';
    default:
      return 'Invoice';
  }
}

export function toClientReceivableView(
  row: CommercialInvoiceRow,
  today: string,
): ClientReceivableView {
  const paymentState = derivePaymentState(row, today);
  const isActive = paymentState !== 'PAID' && paymentState !== 'CANCELLED' && paymentState !== 'DRAFT';
  return {
    invoiceId: row.id,
    invoiceNumber: row.invoiceNumber,
    sourceLabel: deriveSourceLabel(row),
    issuedAt: row.invoiceDate,
    sentAt: row.sentAt ?? null,
    dueDate: row.dueDate,
    total: row.totalAmount,
    paid: row.paidAmount,
    outstanding: row.outstandingAmount,
    paymentState,
    overdueDays: row.daysOverdue,
    canRecordPayment: isActive,
    dueStatus: isActive ? deriveDueStatus(row.dueDate, row.outstandingAmount, today) : null,
    agingBucket: deriveAgingBucket(row.daysOverdue),
  };
}

export function toClientPaymentView(row: CommercialReceiptRow): ClientPaymentView {
  return {
    receiptId: row.id,
    receivedAt: row.receiptDate,
    total: row.totalAmount,
    allocated: row.allocatedAmount,
    unallocated: row.unallocatedAmount,
    method: row.paymentMethod,
    reference: row.reference,
    allocations: row.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoiceNumber,
      amount: a.allocatedAmount,
    })),
  };
}

/**
 * Build a greedy allocation preview across payable invoices.
 *
 * Distributes `amount` across invoices (in order, canRecordPayment === true) by filling
 * each one up to its outstanding balance. Any remainder stays unallocated — callers should
 * display it as unapplied cash, not silently drop it. Returns only lines with a non-zero
 * suggestion.
 */
export function buildAllocationPreview(
  amount: string,
  invoices: ClientReceivableView[],
): AllocationLine[] {
  let remaining = parseFloat(amount) || 0;
  if (remaining <= 0) return [];

  const lines: AllocationLine[] = [];

  for (const inv of invoices) {
    if (!inv.canRecordPayment) continue;
    const outstanding = parseFloat(inv.outstanding ?? '0') || 0;
    if (outstanding <= 0) continue;

    const suggested = Math.min(outstanding, remaining);
    remaining = parseFloat((remaining - suggested).toFixed(2));

    lines.push({
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      suggested: suggested.toFixed(2),
      max: outstanding.toFixed(2),
    });

    if (remaining <= 0) break;
  }

  return lines;
}
