import { Decimal } from '@prisma/client/runtime/library';

/**
 * The sales-tax (VAT) rate every generated client invoice is raised at — the ONE place it lives.
 *
 * Before 2026-09-28 the four generation paths in `ClientInvoiceService` (IPC, installment, separate
 * charge, variation standalone) each carried their own `new Decimal('0.05')`. The Commercial "Prepare
 * invoice" dialog now previews the tax the server will charge, and it must read the same number the
 * invoice is actually raised at, so the literal was lifted here and both sides import it.
 *
 * Note: `TaxCode` / `AccountingConfiguration.defaultOutputTaxCodeId` exist in the schema but are not
 * wired into AR invoicing. Switching invoicing onto them is a posting-behaviour change (an ADR-level
 * decision), not part of this constant's job.
 */
export const CLIENT_INVOICE_SALES_TAX_RATE = '0.05';

/** Tax on an ex-tax subtotal at the invoice rate, rounded to money precision. */
export function clientInvoiceSalesTax(subtotal: Decimal): Decimal {
  return subtotal.mul(new Decimal(CLIENT_INVOICE_SALES_TAX_RATE)).toDecimalPlaces(2);
}
