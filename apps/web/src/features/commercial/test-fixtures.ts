import type {
  CommercialInvoiceRow,
  CommercialPaymentScheduleInstallment,
  CommercialReceiptRow,
  CommercialTodoItem,
  CommercialWorkspaceResponse,
} from '@erp/types';

/** Test fixtures for the Commercial tab redesign. Defaults: an ACTIVE milestone contract, a biller. */

export function workspaceFixture(overrides: Partial<CommercialWorkspaceResponse> = {}): CommercialWorkspaceResponse {
  return {
    projectId: 'p1',
    currency: 'USD',
    financialsVisible: true,
    contract: {
      id: 'k1',
      contractNumber: 'ACC-HDN-26-0005-C1',
      shortRef: 'C1',
      status: 'ACTIVE',
      billingModel: 'MILESTONE',
      clientId: 'c1',
      clientName: 'Hayat Market',
      signedDate: '2026-05-20',
      startDate: '2026-06-01',
      expectedEndDate: '2027-01-20',
      paymentTermsDays: 30,
      signedValue: '412500.00',
      approvedVariationsValue: '25000.00',
      approvedVariationCount: 1,
      currentValue: '437500.00',
      signedBoq: { versionId: 'v1', versionNumber: 1 },
      signedAgreement: { fileId: 'f1', fileName: 'Hayat-Market-contract.pdf' },
    },
    signBoq: null,
    facts: {
      contractValue: '437500.00',
      invoiced: '185850.00',
      collected: '173250.00',
      outstanding: '12600.00',
      overdue: '12600.00',
    },
    todo: [],
    capabilities: {
      canRecordContract: false,
      canReopenContract: true,
      canBill: true,
      canRecordPayment: true,
      canRecordSignedDate: true,
      canReprofileSchedule: true,
      canExportStatement: true,
    },
    asOf: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

export function todoFixture(overrides: Partial<CommercialTodoItem> & Pick<CommercialTodoItem, 'id' | 'kind'>): CommercialTodoItem {
  return {
    invoiceId: null,
    invoiceNumber: null,
    installmentId: null,
    installmentName: null,
    stageNumber: null,
    stageCount: null,
    sourceLabel: null,
    amount: null,
    dueDate: null,
    daysOverdue: null,
    releasedBy: null,
    blocker: null,
    unbilledVariations: null,
    createdAt: null,
    ...overrides,
  };
}

export const OVERDUE = todoFixture({
  id: 'overdue:inv-130',
  kind: 'OVERDUE_INVOICE',
  invoiceId: 'inv-130',
  invoiceNumber: 'INV-2026-0130',
  sourceLabel: 'Separate charge · SC-01 Extra site mobilisation',
  amount: '12600.00',
  dueDate: '2026-09-19',
  daysOverdue: 9,
});

export const READY = todoFixture({
  id: 'ready:s2',
  kind: 'READY_TO_INVOICE',
  installmentId: 's2',
  installmentName: 'Substructure complete',
  stageNumber: 2,
  stageCount: 4,
  amount: '123750.00',
  releasedBy: { kind: 'MILESTONE', milestoneId: 'm1', milestoneCode: 'MS-01', milestoneName: 'Substructure', verifiedAt: '2026-09-26' },
  unbilledVariations: { count: 1, amount: '25000.00', references: ['VO-03'] },
});

export const DRAFT = todoFixture({
  id: 'draft:inv-draft',
  kind: 'DRAFT_INVOICE',
  invoiceId: 'inv-draft',
  sourceLabel: 'SC-02 Temporary site power',
  amount: '8400.00',
  createdAt: '2026-09-24',
});

export const BLOCKED = todoFixture({
  id: 'blocked:s3',
  kind: 'BLOCKED_STAGE',
  installmentId: 's3',
  installmentName: 'Frame complete',
  stageNumber: 3,
  stageCount: 4,
  blocker: 'MILESTONE_NOT_VERIFIED',
  releasedBy: { kind: 'MILESTONE', milestoneId: 'm2', milestoneCode: 'MS-02', milestoneName: 'Frame complete', verifiedAt: null },
});

export function invoiceRow(overrides: Partial<CommercialInvoiceRow> & Pick<CommercialInvoiceRow, 'id'>): CommercialInvoiceRow {
  return {
    invoiceNumber: null,
    source: { kind: 'SEPARATE_CHARGE', label: 'SC-02 Temporary site power', id: 'sc2' },
    invoiceDate: '2026-09-24',
    dueDate: null,
    currency: 'USD',
    subtotal: '8000.00',
    vatAmount: '400.00',
    totalAmount: '8400.00',
    paidAmount: '0.00',
    outstandingAmount: '8400.00',
    documentStatus: 'DRAFT',
    postingStatus: 'NOT_POSTED',
    status: 'DRAFT',
    daysOverdue: 0,
    sentAt: null,
    ...overrides,
  };
}

export function receiptRow(overrides: Partial<CommercialReceiptRow> = {}): CommercialReceiptRow {
  return {
    id: 'r1',
    receiptDate: '2026-06-12',
    currency: 'USD',
    totalAmount: '173250.00',
    allocatedAmount: '173250.00',
    unallocatedAmount: '0.00',
    allocatedToThisContract: '173250.00',
    paymentMethod: 'bank_transfer',
    reference: 'TT PB-99812',
    postingStatus: 'POSTED',
    allocations: [{ id: 'a1', invoiceId: 'inv-121', invoiceNumber: 'INV-2026-0121', allocatedAmount: '173250.00', allocationDate: '2026-06-12' }],
    receiptNumber: 'RCPT-2026-0044',
    depositAccountLabel: 'Premier Bank · USD ···4410',
    ...overrides,
  };
}

export function stageFixture(overrides: Partial<CommercialPaymentScheduleInstallment> & Pick<CommercialPaymentScheduleInstallment, 'id'>): CommercialPaymentScheduleInstallment {
  return {
    sortOrder: 0,
    name: 'Stage',
    percentage: '0.3000',
    amount: '123750.00',
    amountPaid: '0.00',
    triggerType: 'MILESTONE',
    milestoneLabel: null,
    dueOffsetDays: null,
    dueDate: null,
    status: 'UPCOMING',
    programmeMilestone: null,
    readyToBill: false,
    readyToBillAt: null,
    canMarkReadyToBill: false,
    canPrepareInvoice: false,
    billingBlocker: null,
    expectedDate: null,
    releasedBy: { kind: 'MILESTONE', milestoneId: null, milestoneCode: null, milestoneName: null, verifiedAt: null },
    invoiceId: null,
    invoiceState: null,
    billingEligibility: { installmentId: overrides.id, canPrepare: false, canIssue: false, blockedReason: null, steps: [] },
    ...overrides,
  };
}
