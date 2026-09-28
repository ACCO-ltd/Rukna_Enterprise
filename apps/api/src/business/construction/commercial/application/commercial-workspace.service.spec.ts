import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { CommercialWorkspaceService } from './commercial-workspace.service.js';
import { CommercialService } from './commercial.service.js';

const moneyViewer: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 't',
  roles: [],
  permissions: [PERMISSIONS.contractsView, PERMISSIONS.receivablesManage, PERMISSIONS.financialPositionView],
};
const blind: RequestIdentity = { ...moneyViewer, permissions: [PERMISSIONS.contractsView] };

const contract = {
  id: 'c-1',
  contractNumber: 'ACC-HDN-26-0005-C1',
  status: 'ACTIVE',
  billingModel: 'MILESTONE',
  clientId: 'cl-1',
  clientNameSnapshot: 'Client Co',
  client: { id: 'cl-1', name: 'Client Co' },
  signedDate: new Date('2026-09-01'),
  startDate: new Date('2026-09-01'),
  expectedEndDate: null,
  paymentTerms: 'Net 30',
  baseContractValue: new Decimal('1000000'),
  contractValue: new Decimal('1020000'),
  currency: 'USD',
  boqVersionId: 'bv-1',
};

const asOf = new Date();
const daysAgo = (n: number) => new Date(asOf.getTime() - n * 86_400_000);

function invoiceRow(p: Record<string, unknown>) {
  return {
    id: 'inv',
    invoiceNumber: null,
    invoiceDate: daysAgo(40),
    dueDate: daysAgo(10),
    currencyCode: 'USD',
    subtotal: new Decimal(100),
    vatAmount: new Decimal(5),
    totalAmount: new Decimal(105),
    outstandingAmount: new Decimal(105),
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    createdAt: daysAgo(40),
    sourceInstallmentId: null,
    sourceInstallment: null,
    sourceIpcId: null,
    sourceIpc: null,
    sourceBoqNodeId: null,
    sourceBoqNode: null,
    allocations: [],
    deliveries: [],
    ...p,
  };
}

function installment(p: Record<string, unknown>) {
  return {
    id: 'i',
    name: 'Stage',
    amount: '100.00',
    dueDate: null,
    invoiceId: null,
    billingBlocker: null,
    releasedBy: { kind: 'ADVANCE' },
    ...p,
  };
}

function build(opts: { installments?: unknown[]; invoiceRows?: unknown[] } = {}) {
  const repo = {
    findMainContract: jest.fn().mockResolvedValue(contract),
    findProjectHeader: jest.fn().mockResolvedValue({ code: 'ACC-HDN-26-0005', currency: 'USD' }),
    findVariationAllocationsForContract: jest.fn().mockResolvedValue([
      {
        variationId: 'vo-1',
        amount: new Decimal('5000'),
        treatment: 'INVOICE',
        installmentId: 'st-1',
        clientInvoiceId: 'vo-inv',
        variation: { reference: 'VO-001', title: 'Extra' },
      },
    ]),
    findInvoicesForBilling: jest.fn().mockResolvedValue(opts.invoiceRows ?? []),
    findProjectOverviewData: jest.fn().mockResolvedValue({
      invoices: [
        {
          dueDate: daysAgo(3),
          totalAmount: new Decimal(1050),
          outstandingAmount: new Decimal(1050),
        },
      ],
      postedCreditNotesSum: new Decimal(50),
      collectedSum: new Decimal(0),
      collectionData: new Map(),
      draftInvoiceCount: 0,
    }),
    findSignedAgreement: jest.fn().mockResolvedValue({ fileId: 'f-1', fileName: 'signed.pdf' }),
    findBoqVersionNumber: jest.fn().mockResolvedValue(3),
    findLiveBoqVersion: jest.fn().mockResolvedValue({ versionId: 'bv-live', versionNumber: 4 }),
  };
  const variationRepo = {
    findValuationInputs: jest.fn().mockResolvedValue([
      { id: 'vo-1', reference: 'VO-001', title: 'Extra', status: 'CLIENT_APPROVED', lines: [{ amount: new Decimal('5000') }] },
      { id: 'vo-2', reference: 'VO-002', title: 'Omit', status: 'CLIENT_APPROVED', lines: [{ amount: new Decimal('-2000') }] },
      { id: 'vo-3', reference: 'VO-003', title: 'Pending', status: 'PENDING_INTERNAL', lines: [{ amount: new Decimal('900') }] },
    ]),
  };
  const commercial = {
    buildPaymentSchedule: jest.fn().mockResolvedValue({
      schedule: { installments: opts.installments ?? [] },
      hasFocus: true,
    }),
  };
  const service = new CommercialWorkspaceService(
    { getClient: () => ({}) } as never,
    { assertMember: jest.fn() } as never,
    repo as never,
    variationRepo as never,
    commercial as never,
    {} as never,
  );
  return { service, repo };
}

describe('CommercialWorkspaceService.getWorkspace', () => {
  it('derives the contract facts: short ref, signed BOQ, signed + approved variations = current value', async () => {
    const { service } = build();
    const ws = await service.getWorkspace(moneyViewer, 'p-1');
    expect(ws.contract).toMatchObject({
      shortRef: 'C1',
      signedValue: '1000000.00',
      approvedVariationsValue: '3000.00',
      approvedVariationCount: 2,
      currentValue: '1003000.00',
      paymentTermsDays: 30,
      signedBoq: { versionId: 'bv-1', versionNumber: 3 },
      signedAgreement: { fileId: 'f-1', fileName: 'signed.pdf' },
    });
    expect(ws.facts).toEqual({
      contractValue: '1003000.00',
      invoiced: '1000.00',
      collected: '0.00',
      outstanding: '1050.00',
      overdue: '1050.00',
    });
    expect(ws.capabilities).toMatchObject({ canBill: true, canRecordPayment: true, canExportStatement: true });
  });

  it('nulls every money figure without financial visibility (never "0")', async () => {
    const { service } = build({
      installments: [installment({ id: 'st-9', amount: null })],
      invoiceRows: [invoiceRow({ id: 'late', invoiceNumber: 'INV-1' })],
    });
    const ws = await service.getWorkspace(blind, 'p-1');
    expect(ws.financialsVisible).toBe(false);
    expect(ws.facts).toEqual({ contractValue: null, invoiced: null, collected: null, outstanding: null, overdue: null });
    expect(ws.contract).toMatchObject({ signedValue: null, approvedVariationsValue: null, currentValue: null });
    expect(ws.todo.length).toBeGreaterThan(0);
    for (const row of ws.todo) {
      expect(row.amount).toBeNull();
      if (row.unbilledVariations) expect(row.unbilledVariations.amount).toBeNull();
    }
    expect(ws.capabilities.canBill).toBe(false);
    expect(ws.capabilities.canExportStatement).toBe(false);
  });

  it('builds the ranked To do: overdue, ready (with unbilled VOs), one package draft row, unsent, first blocked stage', async () => {
    const { service } = build({
      installments: [
        installment({ id: 'st-1', name: 'Advance', invoiceId: 'stage-draft' }),
        installment({ id: 'st-2', name: 'Structure' }),
        installment({ id: 'st-3', name: 'Roof', billingBlocker: 'MILESTONE_NOT_VERIFIED' }),
        installment({ id: 'st-4', name: 'Finish', billingBlocker: 'MILESTONE_NOT_LINKED' }),
      ],
      invoiceRows: [
        invoiceRow({ id: 'late', invoiceNumber: 'INV-1', dueDate: daysAgo(12) }),
        invoiceRow({ id: 'unsent', invoiceNumber: 'INV-2', dueDate: daysAgo(-10) }),
        invoiceRow({ id: 'sent', invoiceNumber: 'INV-3', dueDate: daysAgo(-10), deliveries: [{ sentAt: asOf }] }),
        invoiceRow({
          id: 'stage-draft',
          documentStatus: 'DRAFT',
          postingStatus: 'NOT_POSTED',
          sourceInstallmentId: 'st-1',
          sourceInstallment: { id: 'st-1', name: 'Advance', sortOrder: 0 },
          totalAmount: new Decimal(1000),
        }),
        invoiceRow({ id: 'vo-inv', documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', totalAmount: new Decimal(525) }),
        invoiceRow({ id: 'gone', documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED' }),
      ],
    });
    const ws = await service.getWorkspace(moneyViewer, 'p-1');
    expect(ws.todo.map((t) => t.id)).toEqual([
      'overdue:late',
      'ready:st-2',
      'draft:stage-draft',
      'unsent:unsent',
      'blocked:st-3',
    ]);
    const draft = ws.todo.find((t) => t.kind === 'DRAFT_INVOICE')!;
    expect(draft.amount).toBe('1525.00'); // the stage draft + its VO draft
    expect(draft).toMatchObject({ stageNumber: 1, stageCount: 4, sourceLabel: 'Stage 1 · Advance' });
    const ready = ws.todo.find((t) => t.kind === 'READY_TO_INVOICE')!;
    // VO-001 is fully allocated; VO-002 (omission) is still to bill; VO-003 is not client-approved.
    expect(ready.unbilledVariations).toEqual({ count: 1, amount: '-2000.00', references: ['VO-002'] });
    expect(ws.todo[0]!.daysOverdue).toBe(12);
  });

  it('never offers READY_TO_INVOICE on a contract that is not ACTIVE', async () => {
    const { service, repo } = build({ installments: [installment({ id: 'st-2' })] });
    repo.findMainContract.mockResolvedValue({ ...contract, status: 'DRAFT' });
    const ws = await service.getWorkspace(moneyViewer, 'p-1');
    expect(ws.todo.some((t) => t.kind === 'READY_TO_INVOICE')).toBe(false);
  });

  it('keeps a Date stage out of To do until its date arrives (server clock)', async () => {
    const { service } = build({
      installments: [
        installment({ id: 'st-past', triggerType: 'TIME_BASED', dueDate: daysAgo(1).toISOString().slice(0, 10) }),
        installment({ id: 'st-future', triggerType: 'TIME_BASED', dueDate: daysAgo(-30).toISOString().slice(0, 10) }),
      ],
    });
    const ws = await service.getWorkspace(moneyViewer, 'p-1');
    expect(ws.todo.filter((t) => t.kind === 'READY_TO_INVOICE').map((t) => t.id)).toEqual(['ready:st-past']);
  });

  it('no contract: the live BOQ version to sign against, nothing else', async () => {
    const { service, repo } = build();
    repo.findMainContract.mockResolvedValue(null);
    const ws = await service.getWorkspace(moneyViewer, 'p-1');
    expect(ws.contract).toBeNull();
    expect(ws.signBoq).toEqual({ versionId: 'bv-live', versionNumber: 4 });
    expect(ws.todo).toEqual([]);
  });
});

describe('CommercialService.getOverview — money-visibility leaks closed (D5)', () => {
  function overview(identity: RequestIdentity) {
    const repo = {
      findMainContract: jest.fn().mockResolvedValue(contract),
      findProjectOverviewData: jest.fn().mockResolvedValue({
        invoices: [
          {
            id: 'inv-1',
            invoiceNumber: 'INV-1',
            invoiceDate: daysAgo(40),
            dueDate: daysAgo(5),
            totalAmount: new Decimal(1050),
            outstandingAmount: new Decimal(1050),
            sourceInstallmentId: null,
            deliveryCount: 1,
          },
          {
            id: 'inv-2',
            invoiceNumber: 'INV-2',
            invoiceDate: daysAgo(40),
            dueDate: daysAgo(-5),
            totalAmount: new Decimal(500),
            outstandingAmount: new Decimal(500),
            sourceInstallmentId: null,
            deliveryCount: 1,
          },
        ],
        postedCreditNotesSum: new Decimal(0),
        collectedSum: new Decimal(0),
        collectionData: new Map([
          [
            'inv-2',
            {
              followUps: [],
              promises: [],
              openDispute: { disputedAmount: new Decimal(200) },
            },
          ],
        ]),
        draftInvoiceCount: 0,
      }),
    };
    const service = new CommercialService(
      { getClient: () => ({}) } as never,
      { assertMember: jest.fn() } as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'getCurrentCycle').mockResolvedValue({ stage: 'TERMINAL', blockers: [] } as never);
    return service.getOverview(identity, 'p-1');
  }

  it('withholds contract values and attention amounts without financial visibility', async () => {
    const res = await overview(blind);
    expect(res.contract.baseContractValue).toBeNull();
    expect(res.contract.currentContractValue).toBeNull();
    expect(res.attention.length).toBe(2);
    for (const item of res.attention) {
      expect(item.amount).toBeNull();
      if ('disputedAmount' in item && item.disputedAmount !== undefined) expect(item.disputedAmount).toBeNull();
    }
  });

  it('shows them to a money viewer, and counts overdue by the one rule (past due only)', async () => {
    const res = await overview(moneyViewer);
    expect(res.contract.baseContractValue).toBe('1000000.00');
    expect(res.contract.currentContractValue).toBe('1020000.00');
    expect(res.financialPosition.overdue).toBe('1050.00');
    const dispute = res.attention.find((a) => a.kind === 'OPEN_DISPUTE')!;
    expect(dispute.amount).toBe('500.00');
    expect(dispute.disputedAmount).toBe('200.00');
    expect(res.attention.find((a) => a.kind === 'OVERDUE_INVOICE')).toMatchObject({ daysOverdue: 5, amount: '1050.00' });
  });
});
