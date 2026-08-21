import type { ClientInvoice } from '@/features/accounting/types';
import {
  MONEY_SCALE,
  fromMinorUnits as fromMinor,
  parseMinorUnits,
  sumMinorUnits,
  toMinorUnits as toMinor,
} from '@/lib/money';

import type { Receipt, ReceiptAllocation } from './types';

/**
 * ─── Money arithmetic on the receipt workspace ──────────────────────────────────
 *
 * Everything works in integer MINOR UNITS parsed from the API's decimal strings — the figure
 * being computed is "how much of this receipt is still unallocated", which decides whether an
 * allocation is accepted, and binary floating point has no business near it.
 *
 * ACC-SET-001: a receipt now settles ClientInvoices. The receipt's own `unallocatedAmount` is
 * authoritative once it is posted, so we read it directly rather than re-summing allocations.
 */

/** @deprecated Import from `@/lib/money` and pass `MONEY_SCALE` explicitly. */
export function toMinorUnits(value: string | null | undefined): number {
  return toMinor(value, MONEY_SCALE);
}

/** @deprecated Import from `@/lib/money` and pass `MONEY_SCALE` explicitly. */
export function fromMinorUnits(minor: number): string {
  return fromMinor(minor, MONEY_SCALE);
}

/** Total still applied to invoices from a receipt (reversed allocations excluded), minor units. */
export function allocatedMinor(allocations: readonly ReceiptAllocation[]): number {
  return sumMinorUnits(
    allocations.filter((a) => a.postingStatus !== 'REVERSED').map((a) => a.allocatedAmount),
    MONEY_SCALE,
  );
}

/** What is left of a receipt to allocate — the server maintains this on `unallocatedAmount`. */
export function unallocatedMinor(receipt: Pick<Receipt, 'unallocatedAmount'>): number {
  return toMinorUnits(receipt.unallocatedAmount);
}

/** True when the receipt is fully applied, with nothing left over. */
export function isFullyAllocated(receipt: Pick<Receipt, 'unallocatedAmount'>): boolean {
  return unallocatedMinor(receipt) === 0;
}

/** True when more has been applied than was received (a data-integrity signal, not normal). */
export function isOverAllocated(receipt: Pick<Receipt, 'unallocatedAmount'>): boolean {
  return unallocatedMinor(receipt) < 0;
}

export type AllocationProblem =
  | 'empty'
  | 'not-a-number'
  | 'not-positive'
  | 'exceeds-receipt'
  | 'exceeds-invoice';

/**
 * Validates a typed allocation against the receipt's remaining balance and the invoice's
 * outstanding amount. Mirrors the server guards (`assertAllocatable`) so an over-allocation is
 * caught before the round-trip.
 *
 * `not-positive` catches zero and negatives — `@IsNumber() @Min(0.01)` rejects them on the
 * server too, but a live message beats a 400.
 */
export function allocationProblem(
  typed: string,
  remainingMinor: number,
  invoiceOutstandingMinor?: number,
): AllocationProblem | null {
  const trimmed = typed.trim();
  if (!trimmed) return 'empty';

  const minor = parseMinorUnits(trimmed, MONEY_SCALE);
  if (minor === null) return 'not-a-number';
  if (minor <= 0) return 'not-positive';
  if (minor > remainingMinor) return 'exceeds-receipt';
  if (invoiceOutstandingMinor !== undefined && minor > invoiceOutstandingMinor) {
    return 'exceeds-invoice';
  }

  return null;
}

/**
 * ─── The invoices a receipt can settle ──────────────────────────────────────────
 *
 * A receipt settles the client's POSTED invoices that still have an outstanding balance.
 * `GET /invoices?clientId=` returns the client's invoices; we filter to the payable ones here
 * so the picker never offers a draft, an unposted or an already-settled invoice.
 */
export interface InvoiceOption {
  invoice: ClientInvoice;
  /** Outstanding balance on the invoice, in minor units. */
  outstandingMinor: number;
}

export function invoicesForClient(
  invoices: readonly ClientInvoice[],
  clientId: string,
): InvoiceOption[] {
  return invoices
    .filter(
      (invoice) =>
        invoice.clientId === clientId &&
        invoice.postingStatus === 'POSTED' &&
        toMinorUnits(invoice.outstandingAmount) > 0,
    )
    .map((invoice) => ({ invoice, outstandingMinor: toMinorUnits(invoice.outstandingAmount) }))
    .sort((a, b) => (a.invoice.invoiceNumber ?? '').localeCompare(b.invoice.invoiceNumber ?? ''));
}
