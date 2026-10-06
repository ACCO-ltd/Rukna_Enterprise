import type { InvoiceDocumentInput } from './invoice-view-model.js';

/**
 * The invoice the settings preview prints: a sample client, project and stage (clearly not a real
 * document — the number reads "SAMPLE"), dated today. Only the organisation's own identity and the
 * settings being edited are real, so the preview shows exactly what those settings change.
 */
export function previewSampleInvoice(
  today: Date,
): Omit<
  InvoiceDocumentInput,
  'org' | 'footer' | 'signatory' | 'paymentAccounts' | 'notes' | 'showBankDetails' | 'showNotes'
> {
  const invoiceDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dueDate = new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    invoiceNumber: 'SAMPLE',
    invoiceDate,
    dueDate,
    paymentTerms: 'Net 30',
    currencyCode: 'USD',
    subtotal: '8000.00',
    vatAmount: '400.00',
    totalAmount: '8400.00',
    taxRatePercent: '5',
    client: {
      name: 'Sample Client',
      address: null,
      city: 'Mogadishu',
      countryCode: 'SO',
      taxNumber: null,
    },
    project: { code: 'PRJ-SAMPLE', name: 'Sample Project', location: 'Mogadishu' },
    lines: [
      {
        title: 'Stage 1 of 4 – Advance (mobilisation)',
        detail: '40% of the contract value of USD 20,000.00',
        quantity: '1',
        unitPrice: '8000.00',
        amount: '8000.00',
      },
    ],
  };
}
