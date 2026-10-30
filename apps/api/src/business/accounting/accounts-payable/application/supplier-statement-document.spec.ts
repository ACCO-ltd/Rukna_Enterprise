/**
 * SS-2 / SS-3 — the supplier statement PDF and its WhatsApp message. Under Jest `@react-pdf/renderer`
 * is the CJS stub, so these assert on the document's element tree — what the PDF says.
 */
import type { SupplierStatement } from '@erp/types';

import { SupplierStatementDocument, supplierStatementPdfFilename } from './supplier-statement-document.service';
import { supplierStatementTemplateParams } from './supplier-statement-whatsapp.service';

const statement: SupplierStatement = {
  supplier: { id: 's1', name: 'Berbera Cement Supplies', code: 'SUP-BCS', address: 'Berbera port road' },
  organization: { name: 'ACCO Ltd' },
  from: '2026-01-01',
  to: '2026-10-30',
  openBills: [
    { billId: 'b1', number: 'BILL-000001', supplierInvoiceNumber: 'BCS-INV-77', billDate: '2026-10-01', dueDate: '2026-10-29', total: '1000.00', settled: '120.00', balance: '880.00', daysOverdue: 1, opening: false },
  ],
  openingBalance: '0.00',
  lines: [
    { date: '2026-10-01', kind: 'BILL', documentId: 'b1', reference: 'BILL-000001', description: 'BCS-INV-77', debit: null, credit: '1000.00', balance: '1000.00' },
    { date: '2026-10-28', kind: 'PAYMENT', documentId: 'p1', reference: 'PMT-000001', description: 'TT-2210', debit: '750.00', credit: null, balance: '250.00' },
  ],
  totals: { debits: '750.00', credits: '1000.00' },
  closingBalance: '250.00',
  aging: { current: '0.00', d1_30: '880.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00' },
  unapplied: '630.00',
  pendingPayments: '0.00',
};

const org = { name: 'ACCO Ltd', legalAddress: 'Mogadishu', taxRegistrationNumber: null, brandColorHex: null, template: 'STANDARD' as const, logo: null };

function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? texts(props.children) : [];
}

describe('SupplierStatementDocument (SS-2)', () => {
  it('carries the supplier, what we owe, the open bills in billed / paid order and the activity', () => {
    const all = texts(SupplierStatementDocument({ input: { statement, org } })).join(' | ');
    expect(all).toContain('STATEMENT');
    expect(all).toContain('Berbera Cement Supplies');
    expect(all).toContain('We Owe You');
    expect(all).toContain('USD 250.00');
    expect(all).toContain('Less paid in advance: −USD 630.00');
    expect(all).toContain('BILL-000001');
    expect(all).toContain('BCS-INV-77');
    expect(all).toContain('1 day');
    expect(all).toContain('Payment PMT-000001');
    expect(all).toContain('Owed at the end');
  });

  it('names the file by the supplier code and the date', () => {
    expect(supplierStatementPdfFilename(statement)).toBe('Supplier-statement-SUP-BCS-2026-10-30.pdf');
  });

  it('fills the WhatsApp template with the supplier, what we owe, the date and the company (SS-3)', () => {
    expect(supplierStatementTemplateParams({ supplierName: 'Berbera Cement Supplies', owed: '250.00', asOf: '2026-10-30', orgName: 'ACCO Ltd' })).toEqual([
      'Berbera Cement Supplies',
      expect.stringContaining('250.00'),
      expect.stringContaining('2026'),
      'ACCO Ltd',
    ]);
  });
});
