/**
 * ST-6 — the statement PDF and its WhatsApp message. Under Jest `@react-pdf/renderer` is the CJS
 * stub, so these assert on the document's element tree — what the PDF says.
 */
import type { ClientStatement } from '@erp/types';

import { StatementDocument, StatementDocumentService, statementPdfFilename } from './statement-document.service';
import { statementTemplateParams } from './client-statement-whatsapp.service';

const statement: ClientStatement = {
  client: { id: 'c1', name: 'Hargeisa Water Agency', code: 'CLI-HRG', address: 'Road 1, Hargeisa', taxNumber: 'TIN-77' },
  organization: { name: 'ACCO Ltd', address: 'Mogadishu', taxNumber: null },
  asOf: '2026-10-30',
  from: '2026-01-01',
  to: '2026-10-30',
  accounts: [
    {
      key: 'contract:k1', kind: 'CONTRACT', projectId: 'p1', projectName: 'Hargeisa Reservoir Works', contractId: 'k1',
      contractNumber: 'ACC-HRG-26-01-C1', contractStatus: 'ACTIVE', contractValue: '500000.00', billedToDate: '450000.00',
      leftToBill: '50000.00', invoiced: '450000.00', received: '0.00', credited: '0.00', writtenOff: '0.00',
      balanceDue: '450000.00', overdue: '0.00', retentionHeld: '12500.00', invoiceCount: 3,
    },
  ],
  openInvoices: [
    { id: 'i1', invoiceNumber: 'INV-000005', invoiceDate: '2026-10-29', dueDate: '2026-10-29', projectName: null, contractNumber: null, label: 'Crane hire 3 days', total: '1400.00', received: '1000.00', adjusted: '3.00', balance: '397.00', daysOverdue: 1 },
  ],
  overdue: '397.00',
  retentionHeld: '12500.00',
  openingBalance: '0.00',
  lines: [
    { date: '2026-10-29', kind: 'RECEIPT', documentId: 'r1', reference: 'RCP-000015', description: 'Cheque 204118 (Premier Bank)', debit: null, credit: '1500.00', balance: '-1500.00' },
  ],
  totals: { debits: '0.00', credits: '1500.00' },
  closingBalance: '-1500.00',
  aging: { current: '0.00', d1_30: '397.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00' },
  onAccount: '100.00',
};

const org = { name: 'ACCO Ltd', legalAddress: 'Mogadishu', taxRegistrationNumber: null, brandColorHex: null, template: 'STANDARD' as const, logo: null };

function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? texts(props.children) : [];
}

describe('StatementDocument (ST-6)', () => {
  it('renders a buffer', async () => {
    const pdf = await new StatementDocumentService().render({ statement, org });
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  it('carries the client, the balance due, the contract, the open invoices and the activity', () => {
    const all = texts(StatementDocument({ input: { statement, org } })).join(' | ');
    expect(all).toContain('STATEMENT');
    expect(all).toContain('Hargeisa Water Agency');
    expect(all).toContain('Tax no. TIN-77');
    // 397 open − 100 paid in advance.
    expect(all).toContain('Balance Due');
    expect(all).toContain('USD 297.00');
    expect(all).toContain('Hargeisa Reservoir Works · ACC-HRG-26-01-C1');
    expect(all).toContain('500,000.00');
    expect(all).toContain('Retention held (due later): USD 12,500.00');
    expect(all).toContain('INV-000005');
    expect(all).toContain('1 days');
    expect(all).toContain('Currency');
    expect(all).toContain('Payment RCP-000015');
    expect(all).toContain('Cheque 204118 (Premier Bank)');
    expect(all).toContain('Closing balance');
  });

  it('names the file by the client code and the date', () => {
    expect(statementPdfFilename(statement)).toBe('Statement-CLI-HRG-2026-10-30.pdf');
    expect(statementPdfFilename({ ...statement, client: { ...statement.client, code: null, name: 'Berbera Port Services' } })).toBe(
      'Statement-Berbera-Port-Services-2026-10-30.pdf',
    );
  });

  it('fills the WhatsApp template: client, balance due, statement date, company', () => {
    expect(statementTemplateParams({ clientName: 'Hargeisa Water Agency', balanceDue: '452917.00', asOf: '2026-10-30', orgName: 'ACCO Ltd' })).toEqual([
      'Hargeisa Water Agency',
      'USD 452,917.00',
      '30 Oct 2026',
      'ACCO Ltd',
    ]);
  });
});
