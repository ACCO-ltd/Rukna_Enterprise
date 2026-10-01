import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-041 — tax on a client invoice comes from the tax code it is raised at, never from a constant.
 *
 * Rates are stored in PERCENT (`TaxCode.rate`, `ClientInvoice.taxRate`): 5 means 5%. Every
 * generation path and the "Prepare invoice" preview compute tax here, so the figure a user is shown
 * is the figure the invoice is raised at.
 */

/** Tax on an ex-tax subtotal at a percent rate, rounded to money precision. */
export function clientInvoiceTax(subtotal: Decimal, ratePercent: Decimal): Decimal {
  return subtotal.mul(ratePercent).div(100).toDecimalPlaces(2);
}

/**
 * The percent rate an invoice's own figures imply — for invoices that arrive with a tax amount
 * rather than a code (opening balances). Rounded to the column's 4 decimal places; 0 when there is
 * no subtotal to divide by.
 */
export function impliedTaxRatePercent(subtotal: Decimal, vatAmount: Decimal): Decimal {
  if (subtotal.isZero()) return new Decimal(0);
  // Clamped to the column (DECIMAL(7,4)) so a nonsensical imported ratio cannot fail the import.
  return Decimal.min(Decimal.max(vatAmount.div(subtotal).mul(100).toDecimalPlaces(4), 0), new Decimal('999.9999'));
}
