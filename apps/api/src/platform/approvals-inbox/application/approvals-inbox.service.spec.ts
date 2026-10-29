import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';

import { SegregationOfDutiesService } from '../../workflows/application/segregation-of-duties.service.js';
import { ApprovalsInboxService } from './approvals-inbox.service.js';

const who = (permissions: string[], roles: string[] = [], userId = 'me'): RequestIdentity => ({
  userId,
  activeOrganizationId: 'org-1',
  tenantSlug: 't',
  roles,
  permissions: permissions as never,
});

const ALL_RULES = new Set([
  'REQUESTER_CANNOT_APPROVE_OWN_REQUEST',
  'GOODS_RECEIVER_CANNOT_APPROVE_BILL',
  'BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT',
  'JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL',
  'QUOTE_UPLOADER_CANNOT_SELECT',
  'REQUESTER_CANNOT_SELECT',
  'SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION',
]);

const journal = (id: string, createdBy: string, submittedAt: string) => ({
  id,
  journalNumber: null,
  accountingDate: new Date('2026-10-28'),
  description: `Accrual ${id}`,
  currencyCode: 'USD',
  createdBy,
  submittedBy: createdBy,
  submittedAt: new Date(submittedAt),
  createdAt: new Date(submittedAt),
  lines: [{ debitAmount: new Decimal('150.00') }, { debitAmount: new Decimal('0') }],
});

function build(overrides: Record<string, unknown> = {}, rules = ALL_RULES) {
  const repo = {
    invoicesAwaitingApproval: jest.fn().mockResolvedValue([]),
    writeOffsAwaitingApproval: jest.fn().mockResolvedValue([]),
    refundsAwaitingApproval: jest.fn().mockResolvedValue([]),
    submittedJournals: jest.fn().mockResolvedValue([]),
    submittedBills: jest.fn().mockResolvedValue([]),
    goodsReceivers: jest.fn().mockResolvedValue(new Map()),
    draftPayments: jest.fn().mockResolvedValue([]),
    quotationsAwaitingDecision: jest.fn().mockResolvedValue([]),
    submittedMaterialRequests: jest.fn().mockResolvedValue([]),
    submittedProgressReports: jest.fn().mockResolvedValue([]),
    pendingWorkflowSteps: jest.fn().mockResolvedValue([]),
    userNames: jest.fn().mockResolvedValue([{ id: 'amina', firstName: 'Amina', lastName: 'Yusuf' }]),
    projectNames: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Reservoir Works' }]),
    ...overrides,
  };
  const sod = new SegregationOfDutiesService({ getClient: () => ({}) } as never);
  jest.spyOn(sod, 'activeRuleCodes').mockResolvedValue(rules);
  const access = { accessibleProjectIds: jest.fn().mockResolvedValue(['p1']) };
  const service = new ApprovalsInboxService({ getClient: () => ({}) } as never, repo as never, access as never, sod);
  return { service, repo, access };
}

describe('ApprovalsInboxService (Step 3, ADR-049)', () => {
  it('runs only the queues the caller holds the deciding permission for', async () => {
    const { service, repo } = build();
    await service.inbox(who([PERMISSIONS.materialRequestsApprove]));
    expect(repo.submittedMaterialRequests).toHaveBeenCalledWith({}, 'org-1', ['p1']);
    expect(repo.submittedJournals).not.toHaveBeenCalled();
    expect(repo.submittedBills).not.toHaveBeenCalled();
    expect(repo.draftPayments).not.toHaveBeenCalled();
    expect(repo.quotationsAwaitingDecision).not.toHaveBeenCalled();
    expect(repo.submittedProgressReports).not.toHaveBeenCalled();
  });

  it("leaves out the caller's own journal, unless they hold post-own:journal (ADR-046 §1)", async () => {
    const journals = jest.fn().mockResolvedValue([journal('j1', 'me', '2026-10-01'), journal('j2', 'amina', '2026-10-02')]);
    const { service } = build({ submittedJournals: journals });

    const plain = await service.inbox(who([PERMISSIONS.journalsManage]));
    expect(plain.items.map((i) => i.id)).toEqual(['j2']);
    expect(plain.items[0]).toMatchObject({ kind: 'JOURNAL', title: 'Dated 2026-10-28', amount: '150.00', requestedByName: 'Amina Yusuf' });

    const postOwn = await service.inbox(who([PERMISSIONS.journalsManage, PERMISSIONS.journalsPostOwn]));
    expect(postOwn.items.map((i) => i.id)).toEqual(['j1', 'j2']);
  });

  it('shows the caller their own journal when the four-eyes rule is switched off', async () => {
    const journals = jest.fn().mockResolvedValue([journal('j1', 'me', '2026-10-01')]);
    const { service } = build({ submittedJournals: journals }, new Set());
    const res = await service.inbox(who([PERMISSIONS.journalsManage]));
    expect(res.count).toBe(1);
  });

  it('leaves out a bill for goods the caller received, and a payment settling a bill they approved', async () => {
    const { service } = build({
      submittedBills: jest.fn().mockResolvedValue([
        { id: 'b1', billNumber: null, supplierInvoiceNumber: 'S-1', totalAmount: new Decimal('10'), currencyCode: 'USD', purchaseOrderId: 'po1', projectId: 'p1', createdBy: 'amina', updatedAt: new Date('2026-10-01'), supplier: { name: 'Cement Co' } },
        { id: 'b2', billNumber: null, supplierInvoiceNumber: 'S-2', totalAmount: new Decimal('20'), currencyCode: 'USD', purchaseOrderId: null, projectId: null, createdBy: 'amina', updatedAt: new Date('2026-10-02'), supplier: { name: 'Cement Co' } },
      ]),
      goodsReceivers: jest.fn().mockResolvedValue(new Map([['po1', new Set(['me'])]])),
      draftPayments: jest.fn().mockResolvedValue([
        { id: 'pay1', paymentNumber: null, paymentDate: new Date('2026-10-03'), totalAmount: new Decimal('5'), currencyCode: 'USD', createdBy: 'amina', createdAt: new Date('2026-10-03'), supplier: { name: 'Cement Co' }, allocations: [{ bill: { approvedBy: 'me' } }] },
        { id: 'pay2', paymentNumber: null, paymentDate: new Date('2026-10-04'), totalAmount: new Decimal('6'), currencyCode: 'USD', createdBy: 'amina', createdAt: new Date('2026-10-04'), supplier: { name: 'Cement Co' }, allocations: [] },
      ]),
    });
    const res = await service.inbox(who([PERMISSIONS.payablesManage]));
    expect(res.items.map((i) => i.id)).toEqual(['b2', 'pay2']);
  });

  it("leaves out the caller's own material request and a quotation whose evidence they touched", async () => {
    const { service } = build({
      submittedMaterialRequests: jest.fn().mockResolvedValue([
        { id: 'mr1', mrNumber: 'MR-1', title: null, projectId: 'p1', requestedBy: 'me', updatedAt: new Date('2026-10-01') },
        { id: 'mr2', mrNumber: 'MR-2', title: 'Cement', projectId: 'p1', requestedBy: 'amina', updatedAt: new Date('2026-10-02') },
      ]),
      quotationsAwaitingDecision: jest.fn().mockResolvedValue([
        { id: 'q1', number: 'QR-1', projectId: 'p1', createdBy: 'amina', updatedAt: new Date('2026-10-03'), materialRequest: { mrNumber: 'MR-2', title: 'Cement', requestedBy: 'amina' }, quotes: [{ uploadedBy: 'amina', withdrawnBy: null, photos: [{ uploadedBy: 'me' }] }] },
        { id: 'q2', number: 'QR-2', projectId: 'p1', createdBy: 'amina', updatedAt: new Date('2026-10-04'), materialRequest: { mrNumber: 'MR-3', title: null, requestedBy: 'amina' }, quotes: [{ uploadedBy: 'amina', withdrawnBy: null, photos: [] }] },
      ]),
    });
    const res = await service.inbox(who([PERMISSIONS.materialRequestsApprove, PERMISSIONS.quotationsAward]));
    expect(res.items.map((i) => i.id)).toEqual(['mr2', 'q2']);
    expect(res.items[0]).toMatchObject({ projectName: 'Reservoir Works', detail: 'Cement' });
  });

  it('lists a governed approval whose current step needs one of the caller roles, once', async () => {
    const step = (transactionId: string, transactionType: string, current: number, initiatedBy = 'amina') => ({
      id: `inst-${transactionId}`,
      transactionType,
      transactionId,
      currentStepOrder: current,
      evaluatedAmount: new Decimal('4200'),
      initiatedBy,
      updatedAt: new Date('2026-10-05'),
      definition: { name: 'Purchase order approval', steps: [{ stepOrder: 1, roleRequired: 'PROCUREMENT_MANAGER' }, { stepOrder: 2, roleRequired: 'CFO' }] },
    });
    const { service } = build({
      pendingWorkflowSteps: jest.fn().mockResolvedValue([
        step('po1', 'PURCHASE_ORDER', 2),
        step('po2', 'PURCHASE_ORDER', 1), // waiting on a different role
        step('po3', 'PURCHASE_ORDER', 2, 'me'), // the caller started it
        step('mr2', 'MATERIAL_REQUEST', 2), // already listed from its own queue
      ]),
      submittedMaterialRequests: jest.fn().mockResolvedValue([
        { id: 'mr2', mrNumber: 'MR-2', title: null, projectId: null, requestedBy: 'amina', updatedAt: new Date('2026-10-01') },
      ]),
    });
    const res = await service.inbox(who([PERMISSIONS.materialRequestsApprove], ['CFO']));
    expect(res.items.map((i) => `${i.kind}:${i.id}`)).toEqual(['MATERIAL_REQUEST:mr2', 'WORKFLOW:po1']);
    expect(res.items[1]).toMatchObject({ transactionType: 'PURCHASE_ORDER', amount: '4200.00' });
  });

  it('puts what has waited longest first', async () => {
    const journals = jest.fn().mockResolvedValue([journal('late', 'amina', '2026-10-09'), journal('early', 'amina', '2026-10-01')]);
    const reports = jest.fn().mockResolvedValue([
      { id: 'dpr', reportDate: new Date('2026-10-04'), projectId: 'p1', preparedBy: 'amina', submittedBy: 'amina', submittedAt: new Date('2026-10-05'), createdAt: new Date('2026-10-04') },
    ]);
    const { service } = build({ submittedJournals: journals, submittedProgressReports: reports });
    const res = await service.inbox(who([PERMISSIONS.journalsManage, PERMISSIONS.progressApprove]));
    expect(res.items.map((i) => i.id)).toEqual(['early', 'dpr', 'late']);
  });

  it("lists a large draft invoice for a second person, never its preparer (ADR-046 §8)", async () => {
    const { service } = build({
      invoicesAwaitingApproval: jest.fn().mockResolvedValue([
        { id: 'inv-mine', invoiceDate: new Date('2026-10-20'), totalAmount: new Decimal('9000'), currencyCode: 'USD', projectId: null, createdBy: 'me', createdAt: new Date('2026-10-20'), client: { name: 'Water Agency' } },
        { id: 'inv-theirs', invoiceDate: new Date('2026-10-21'), totalAmount: new Decimal('12000'), currencyCode: 'USD', projectId: null, createdBy: 'amina', createdAt: new Date('2026-10-21'), client: { name: 'Water Agency' } },
      ]),
    });
    const res = await service.inbox(who([PERMISSIONS.receivablesManage]));
    expect(res.items.map((i) => i.id)).toEqual(['inv-theirs']);
    expect(res.items[0]).toMatchObject({ kind: 'INVOICE', title: 'Water Agency', amount: '12000.00' });
  });

  it('lists a write-off above the limit for a second person, opening its invoice (AR-4)', async () => {
    const pending = (id: string, requestedBy: string) => ({
      id,
      invoiceId: 'inv-9',
      amount: new Decimal('600'),
      reason: 'BAD_DEBT',
      requestedBy,
      requestedAt: new Date('2026-10-22'),
      invoice: { invoiceNumber: 'INV-000009', currencyCode: 'USD', projectId: null, client: { name: 'Water Agency' } },
    });
    const { service } = build({ writeOffsAwaitingApproval: jest.fn().mockResolvedValue([pending('wo-mine', 'me'), pending('wo-theirs', 'amina')]) });
    const res = await service.inbox(who([PERMISSIONS.receivablesManage]));
    expect(res.items.map((i) => i.id)).toEqual(['wo-theirs']);
    expect(res.items[0]).toMatchObject({ kind: 'WRITE_OFF', parentId: 'inv-9', detail: 'INV-000009 · Bad debt', amount: '600.00' });
  });
});
