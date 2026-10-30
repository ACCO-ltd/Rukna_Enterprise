import { Decimal } from '@prisma/client/runtime/library';

import { summariseAccount, type SummaryInvoice } from './client-account-summary';

const d = (v: string | number) => new Decimal(v);
const invoice = (over: Partial<SummaryInvoice>): SummaryInvoice => ({
  id: 'i', invoiceNumber: 'INV-1', invoiceDate: new Date('2026-09-01'), dueDate: new Date('2026-09-30'),
  totalAmount: d(0), outstandingAmount: d(0), subtotal: d(0), retentionAmount: d(0), retentionReleasedAmount: d(0),
  projectId: null, contractId: null, sourceRetentionContractId: null, sourceBoqNodeId: null, label: null, ...over,
});

describe('client account summary (ST-4)', () => {
  const contracts = [
    { id: 'c1', contractNumber: 'C-1', contractValue: d(500000), projectId: 'p1', status: 'ACTIVE' },
    { id: 'c2', contractNumber: 'C-2', contractValue: d(80000), projectId: 'p2', status: 'ACTIVE' },
  ];
  const projectNames = new Map([['p1', 'Reservoir'], ['p2', 'School']]);

  const result = summariseAccount({
    contracts,
    projectNames,
    invoices: [
      // IPC 1: 200k certified, 10k retention held, 190k due, paid in full.
      invoice({ id: 'a', contractId: 'c1', projectId: 'p1', subtotal: d(200000), retentionAmount: d(10000), totalAmount: d(190000), outstandingAmount: d(0) }),
      // IPC 2: 100k certified, 5k retention, 95k due, 40k paid, overdue.
      invoice({ id: 'b', contractId: 'c1', projectId: 'p1', subtotal: d(100000), retentionAmount: d(5000), totalAmount: d(95000), outstandingAmount: d(55000) }),
      // A separate charge on the contract: billed, owed, but not contract work.
      invoice({ id: 'c', contractId: 'c1', projectId: 'p1', sourceBoqNodeId: 'n1', subtotal: d(3000), totalAmount: d(3000), outstandingAmount: d(3000), dueDate: new Date('2026-12-31') }),
      // Release of 6k of the 15k held.
      invoice({ id: 'r', sourceRetentionContractId: 'c1', projectId: 'p1', subtotal: d(0), retentionReleasedAmount: d(6000), totalAmount: d(6000), outstandingAmount: d(6000), dueDate: null }),
      // A hand-typed sale.
      invoice({ id: 's', subtotal: d(400), totalAmount: d(420), outstandingAmount: d(400), label: 'Crane hire' }),
    ],
    receivedByInvoice: new Map([['a', d(190000)], ['b', d(40000)]]),
    creditedByInvoice: new Map([['s', d(20)]]),
    writtenOffByInvoice: new Map(),
    today: new Date('2026-10-30'),
  });

  it('a contract shows its value, work billed, left to bill, retention held, and ties', () => {
    const c1 = result.accounts.find((a) => a.contractId === 'c1')!;
    expect(c1).toMatchObject({
      kind: 'CONTRACT', projectName: 'Reservoir', contractNumber: 'C-1', contractValue: '500000.00',
      billedToDate: '300000.00', leftToBill: '200000.00',
      invoiced: '294000.00', received: '230000.00', balanceDue: '64000.00', overdue: '55000.00',
      retentionHeld: '9000.00', invoiceCount: 4,
    });
    expect(Number(c1.invoiced) - Number(c1.received) - Number(c1.credited) - Number(c1.writtenOff)).toBe(Number(c1.balanceDue));
  });

  it('a contract with nothing billed yet still shows, all of it left to bill', () => {
    expect(result.accounts.find((a) => a.contractId === 'c2')).toMatchObject({ billedToDate: '0.00', leftToBill: '80000.00', invoiceCount: 0, balanceDue: '0.00' });
  });

  it('hand-typed sales are grouped last', () => {
    expect(result.accounts.map((a) => a.kind)).toEqual(['CONTRACT', 'CONTRACT', 'OTHER_SALES']);
    expect(result.accounts.at(-1)).toMatchObject({ invoiced: '420.00', credited: '20.00', balanceDue: '400.00' });
  });

  it('open invoices list what is still owed, most overdue first', () => {
    expect(result.openInvoices.map((i) => i.id)).toEqual(['b', 's', 'r', 'c']);
    expect(result.openInvoices[0]).toMatchObject({ daysOverdue: 30, received: '40000.00', balance: '55000.00', contractNumber: 'C-1' });
    expect(result.openInvoices.find((i) => i.id === 's')).toMatchObject({ label: 'Crane hire', adjusted: '20.00' });
    expect(result.overdue).toBe('55400.00');
    expect(result.retentionHeld).toBe('9000.00');
  });
});
