import type { InvoiceDocumentInput, InvoiceDocumentLine } from './invoice-view-model.js';
import type { ReceiptDocumentInput } from '../receipt-document.service.js';

/**
 * Sample documents for the PDF tests and for rendering previews by hand
 * (`test/pdf/render-fixture.ts`). Illustrative data only — never used at runtime.
 */

const org: InvoiceDocumentInput['org'] = {
  name: 'Example Construction Ltd',
  legalAddress: 'KM4 Business Centre, 3rd Floor\nMogadishu, Somalia',
  taxRegistrationNumber: 'TIN-100200300',
  brandColorHex: null,
  footerNote: null,
  template: 'STANDARD',
  logo: null,
};

const base: InvoiceDocumentInput = {
  invoiceNumber: 'INV-000123',
  invoiceDate: new Date('2026-10-01T00:00:00Z'),
  dueDate: new Date('2026-10-31T00:00:00Z'),
  paymentTerms: 'Net 30',
  currencyCode: 'USD',
  subtotal: '123750.00',
  vatAmount: '0.00',
  totalAmount: '123750.00',
  taxRatePercent: '0',
  client: {
    name: 'Hodan Real Estate Ltd',
    address: 'Maka Al Mukarama Road',
    city: 'Mogadishu',
    countryCode: 'SO',
    taxNumber: null,
  },
  project: { code: 'ACC-BN-26-004', name: 'Hodan Mixed-Use Building', location: 'Hodan District, Mogadishu' },
  lines: [
    {
      title: 'Stage 2 of 4 – Substructure complete',
      detail: '30% of the contract value of USD 412,500.00',
      quantity: '1',
      unitPrice: '123750.00',
      amount: '123750.00',
    },
  ],
  paymentAccounts: [
    { bankName: 'Salaam Bank', accountNumber: '33020045871' },
    { bankName: 'Dahabshiil Bank', accountNumber: '100-2287-4410' },
    { bankName: 'Premier Bank', accountNumber: '0102 0033 4410' },
    { bankName: 'My Bank', accountNumber: '7700 5512 09' },
  ],
  notes: null,
  signatory: { name: 'Ahmed Ali', title: 'Finance Manager' },
  org,
};

export const shortInvoiceFixture: InvoiceDocumentInput = base;

export const variationTaxInvoiceFixture: InvoiceDocumentInput = {
  ...base,
  invoiceNumber: 'INV-000124',
  subtotal: '18400.00',
  vatAmount: '920.00',
  totalAmount: '19320.00',
  taxRatePercent: '5',
  client: { ...base.client, taxNumber: 'TIN-555-0192' },
  lines: [
    {
      title: 'VO-03 Additional shop fronts to ground floor',
      detail: 'Client-approved variation',
      quantity: '1',
      unitPrice: '18400.00',
      amount: '18400.00',
    },
  ],
  notes: 'Please quote the invoice number in your payment.\nVariation billed separately from the stage invoices.',
};

const manyLines: InvoiceDocumentLine[] = Array.from({ length: 40 }, (_, i) => ({
  title: `Line item ${i + 1} – Blockwork and finishes, block ${String.fromCharCode(65 + (i % 26))}`,
  detail: i % 3 === 0 ? `Measured quantity for zone ${i + 1}` : null,
  quantity: String((i % 5) + 1),
  unitPrice: '250.00',
  amount: (((i % 5) + 1) * 250).toFixed(2),
}));
const manySubtotal = manyLines.reduce((sum, line) => sum + Number(line.amount), 0);

export const fortyLineInvoiceFixture: InvoiceDocumentInput = {
  ...base,
  invoiceNumber: 'INV-000125',
  lines: manyLines,
  subtotal: manySubtotal.toFixed(2),
  vatAmount: (manySubtotal * 0.05).toFixed(2),
  totalAmount: (manySubtotal * 1.05).toFixed(2),
  taxRatePercent: '5',
};

export const receiptFixture: ReceiptDocumentInput = {
  receiptNumber: 'RCP-000017',
  receiptDate: new Date('2026-10-02T00:00:00Z'),
  currencyCode: 'USD',
  totalAmount: '50000.00',
  allocations: [
    { invoiceNumber: 'INV-000121', amount: '30000.00' },
    { invoiceNumber: 'INV-000122', amount: '15000.00' },
  ],
  unallocatedAmount: '5000.00',
  paymentMethod: 'BANK_TRANSFER',
  bankAccountLabel: 'Premier Bank — Operating',
  reference: 'Stage 2',
  bankReference: 'TRX-88213',
  clientName: 'Hodan Real Estate Ltd',
  clientAddress: 'Maka Al Mukarama Road, Mogadishu',
  org: { ...org, footerNote: org.footerNote },
};

export const documentFixtures = {
  'invoice-short': { kind: 'invoice', input: shortInvoiceFixture },
  'invoice-variation-tax': { kind: 'invoice', input: variationTaxInvoiceFixture },
  'invoice-40-lines': { kind: 'invoice', input: fortyLineInvoiceFixture },
  receipt: { kind: 'receipt', input: receiptFixture },
} as const;

export type DocumentFixtureName = keyof typeof documentFixtures;
