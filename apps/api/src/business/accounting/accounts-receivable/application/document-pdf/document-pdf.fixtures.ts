import { deflateSync } from 'node:zlib';

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

/** A real, valid PNG of one colour — `width`×`height` RGB — built without image libraries. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The minimal invoice with a wide (6:1) logo, to prove the logo is sized to the header. */
export const logoInvoiceFixture: InvoiceDocumentInput = {
  ...minimalInvoiceFixture,
  org: { ...org, logo: { buffer: solidPng(240, 40, [31, 63, 168]), mimeType: 'image/png' } },
};

export const documentFixtures = {
  'invoice-minimal': { kind: 'invoice', input: minimalInvoiceFixture },
  'invoice-bank-notes': { kind: 'invoice', input: bankNotesInvoiceFixture },
  'invoice-40-lines': { kind: 'invoice', input: fortyLineInvoiceFixture },
  'invoice-logo': { kind: 'invoice', input: logoInvoiceFixture },
  receipt: { kind: 'receipt', input: receiptFixture },
} as const;

export type DocumentFixtureName = keyof typeof documentFixtures;
