import type { InvoiceDocumentInput, InvoiceDocumentLine } from './invoice-view-model.js';
import type { ReceiptDocumentInput } from '../receipt-document.service.js';

/**
 * Sample documents for the PDF tests and for rendering previews by hand
 * (`test/pdf/render-fixture.ts`). Illustrative data only — never used at runtime. The minimal
 * invoice reproduces the owner's mock.
 */

const LEGAL_ADDRESS = 'Olow Tower, Maka Al-Mukarama Road\nMogadishu, Somalia';

const org: InvoiceDocumentInput['org'] = {
  name: 'ACCO Ltd',
  legalAddress: LEGAL_ADDRESS,
  taxRegistrationNumber: '100045678',
  brandColorHex: null,
  template: 'STANDARD',
  logo: null,
  tagline: 'Construction & Development',
};

const footer: InvoiceDocumentInput['footer'] = {
  address: LEGAL_ADDRESS,
  phones: ['+252 61 234 5678', '+252 90 123 4567'],
  email: 'info@acco.com',
  website: 'www.acco.com',
};

/** The owner's minimal mock, field for field. */
export const minimalInvoiceFixture: InvoiceDocumentInput = {
  invoiceNumber: 'INV-000003',
  invoiceDate: new Date('2026-10-04T00:00:00Z'),
  dueDate: new Date('2026-11-03T00:00:00Z'),
  paymentTerms: 'Net 30',
  currencyCode: 'USD',
  subtotal: '8000.00',
  vatAmount: '400.00',
  totalAmount: '8400.00',
  taxRatePercent: '5',
  client: { name: 'Ahmed Shirie', address: null, city: 'Mogadishu', countryCode: 'SO', taxNumber: '254708023039' },
  project: { code: 'ACCO-DHL-26-0012', name: 'ABC', location: 'Dharkeynley, KM4, Mogadishu' },
  lines: [
    {
      title: 'Stage 1 of 4 – Advance (mobilisation)',
      detail: '40% of the contract value of USD 20,000.00',
      quantity: '1',
      unitPrice: '8000.00',
      amount: '8000.00',
    },
  ],
  paymentAccounts: [
    { bankName: 'Salaam Bank', accountNumber: '33020045871' },
    { bankName: 'Dahabshiil Bank', accountNumber: '100-2287-4410' },
    { bankName: 'Premier Bank', accountNumber: '0102 0033 4410' },
    { bankName: 'My Bank', accountNumber: '7700 5512 09' },
  ],
  notes: null,
  showBankDetails: false,
  showNotes: false,
  signatory: { name: 'Ahmed Abdi Hassan', title: 'CEO' },
  footer,
  org,
};

/** The same invoice with the optional Bank Account Details and Notes switched on. */
export const bankNotesInvoiceFixture: InvoiceDocumentInput = {
  ...minimalInvoiceFixture,
  showBankDetails: true,
  showNotes: true,
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
  ...minimalInvoiceFixture,
  invoiceNumber: 'INV-000125',
  lines: manyLines,
  subtotal: manySubtotal.toFixed(2),
  vatAmount: (manySubtotal * 0.05).toFixed(2),
  totalAmount: (manySubtotal * 1.05).toFixed(2),
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
  clientName: 'Ahmed Shirie',
  clientAddress: 'Mogadishu, Somalia',
  org,
  footer,
};

export const documentFixtures = {
  'invoice-minimal': { kind: 'invoice', input: minimalInvoiceFixture },
  'invoice-bank-notes': { kind: 'invoice', input: bankNotesInvoiceFixture },
  'invoice-40-lines': { kind: 'invoice', input: fortyLineInvoiceFixture },
  receipt: { kind: 'receipt', input: receiptFixture },
} as const;

export type DocumentFixtureName = keyof typeof documentFixtures;
