/** GL-J — the document behind a journal, and where it opens. */
export const SOURCE_TYPES = [
  'MANUAL_JOURNAL', 'CLIENT_INVOICE', 'CREDIT_NOTE', 'PAYMENT_RECEIPT', 'CLIENT_REFUND', 'RECEIVABLE_WRITE_OFF',
  'SUPPLIER_BILL', 'SUPPLIER_DEBIT_NOTE', 'SUPPLIER_PAYMENT', 'SUPPLIER_REFUND', 'BANK_TRANSFER', 'BANK_STATEMENT',
  'OPENING_BALANCE', 'YEAR_END_CLOSE',
] as const;

/** A source type the screens name; anything else reads as "Other". */
export function sourceKey(type: string | null): string {
  return type && (SOURCE_TYPES as readonly string[]).includes(type) ? type : 'OTHER';
}

/**
 * The screen a source document opens on, or null when it has none of its own. Reversals carry
 * `reversal-<id>` and open the document they reversed.
 */
export function sourceDocumentHref(type: string | null, sourceId: string | null): string | null {
  const id = sourceId?.startsWith('reversal-') ? sourceId.slice('reversal-'.length) : sourceId;
  if (!id) return null;
  switch (type) {
    case 'SUPPLIER_PAYMENT':
      return `/finance/accounting/payments/${id}`;
    case 'PAYMENT_RECEIPT':
      return `/receipts/${id}`;
    case 'SUPPLIER_BILL':
      return `/finance/accounting/bills/${id}`;
    case 'CLIENT_INVOICE':
      return `/finance/accounting/invoices/${id}`;
    case 'BANK_TRANSFER':
      return `/finance/accounting/transfers?highlight=${id}`;
    default:
      return null;
  }
}

export const journalHref = (id: string) => `/finance/accounting/journals/${id}`;
